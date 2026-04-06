/**
 * Deep Research Tool — Cascading Research Pipeline
 *
 * Inspired by Claude Code's research architecture where WebSearch → WebFetch →
 * analysis → synthesis happens as a single composite operation, saving 3-5
 * agent turns per research task.
 *
 * This tool chains:
 *   1. web_search (find relevant URLs)
 *   2. web_fetch in parallel (retrieve top N results)
 *   3. Synthesis (combine findings into a structured research summary)
 *
 * Designed for research-heavy roles: competitive-research-analyst,
 * market-research-analyst, content-creator, cmo, vp-research.
 */

import { buildTool, type SafeToolDefinition } from '@glyphor/agent-runtime';
import { searchWeb, searchNews } from '@glyphor/integrations';

const MAX_SOURCES = 8;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_CONTENT_PER_SOURCE = 4000;

/**
 * Fetch a single URL with timeout and content extraction.
 * Returns null on failure (non-throwing).
 */
async function fetchPageContent(
  url: string,
  maxLength: number,
): Promise<{ url: string; title: string; text: string } | null> {
  // Basic URL validation
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Glyphor-Research-Agent/1.0',
        Accept: 'text/html,application/xhtml+xml,text/plain',
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const html = await response.text();

    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);

    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || '';

    return { url, title, text };
  } catch {
    return null;
  }
}

export function createDeepResearchTool(): SafeToolDefinition {
  return buildTool({
    name: 'deep_research',
    description:
      'Perform deep research on a topic in a single call. Searches the web, fetches the ' +
      'top results in parallel, and returns a structured research summary with source content. ' +
      'Use this instead of calling web_search + web_fetch repeatedly when you need comprehensive ' +
      'research on a topic. Returns search results, fetched content from top sources, and metadata.',
    parameters: {
      query: {
        type: 'string',
        description: 'The research topic or question. Be specific — include company names, dates, or domain terms.',
        required: true,
      },
      max_sources: {
        type: 'number',
        description: `Max number of sources to fetch and read (default: 5, max: ${MAX_SOURCES}). Higher = more thorough but slower.`,
      },
      include_news: {
        type: 'boolean',
        description: 'Also search news sources for recent coverage (default: false).',
      },
      time_range: {
        type: 'string',
        description: 'Limit to recent results: "day", "week", "month", or "year".',
        enum: ['day', 'week', 'month', 'year'],
      },
    },
    isReadOnly: true,
    isConcurrencySafe: true,
    timeoutMs: 120_000, // 2 minutes for full pipeline
    categoryHint: 'research',
    async execute(params): Promise<import('@glyphor/agent-runtime').ToolResult> {
      const query = params.query as string;
      if (!query) {
        return { success: false, error: 'Missing required parameter: query' };
      }

      const maxSources = Math.min(Math.max(1, (params.max_sources as number) || 5), MAX_SOURCES);
      const includeNews = (params.include_news as boolean) ?? false;
      const timeRange = params.time_range as string | undefined;

      const startMs = Date.now();

      try {
        // ── Step 1: Search (web + optional news, in parallel) ──
        const searchPromises: Promise<Array<{ title: string; url: string; snippet: string; date?: string | null }>>[] = [
          searchWeb(query, { num: maxSources * 2, timeRange }).catch(() => []),
        ];

        if (includeNews) {
          searchPromises.push(
            searchNews(query, { num: Math.min(maxSources, 10) })
              .then(results => results.map(r => ({
                title: r.title,
                url: r.url,
                snippet: r.snippet,
                date: r.date ?? null,
              })))
              .catch(() => []),
          );
        }

        const [webResults, newsResults = []] = await Promise.all(searchPromises);

        // Deduplicate by URL, prefer web results
        const urlSet = new Set<string>();
        const allResults: Array<{ title: string; url: string; snippet: string; date?: string | null; source: 'web' | 'news' }> = [];

        for (const r of webResults) {
          if (!urlSet.has(r.url)) {
            urlSet.add(r.url);
            allResults.push({ ...r, source: 'web' });
          }
        }
        for (const r of newsResults) {
          if (!urlSet.has(r.url)) {
            urlSet.add(r.url);
            allResults.push({ ...r, source: 'news' });
          }
        }

        if (allResults.length === 0) {
          return {
            success: true,
            data: {
              query,
              searchResultCount: 0,
              fetchedSources: 0,
              message: 'No search results found for this query. Try broadening or rephrasing.',
              sources: [],
              durationMs: Date.now() - startMs,
            },
          };
        }

        // ── Step 2: Fetch top N sources in parallel ──
        const toFetch = allResults.slice(0, maxSources);

        const fetchResults = await Promise.allSettled(
          toFetch.map(r => fetchPageContent(r.url, MAX_CONTENT_PER_SOURCE)),
        );

        const sources: Array<{
          url: string;
          title: string;
          snippet: string;
          date: string | null;
          source: 'web' | 'news';
          content: string | null;
          fetchSuccess: boolean;
        }> = [];

        for (let i = 0; i < toFetch.length; i++) {
          const searchResult = toFetch[i];
          const fetchOutcome = fetchResults[i];
          const fetched = fetchOutcome.status === 'fulfilled' ? fetchOutcome.value : null;

          sources.push({
            url: searchResult.url,
            title: fetched?.title || searchResult.title,
            snippet: searchResult.snippet,
            date: searchResult.date ?? null,
            source: searchResult.source,
            content: fetched?.text ?? null,
            fetchSuccess: !!fetched,
          });
        }

        const fetchedCount = sources.filter(s => s.fetchSuccess).length;

        return {
          success: true,
          data: {
            query,
            searchResultCount: allResults.length,
            fetchedSources: fetchedCount,
            totalSourcesAttempted: toFetch.length,
            sources,
            // Include remaining search results not fetched (for reference)
            additionalResults: allResults.slice(maxSources).map(r => ({
              title: r.title,
              url: r.url,
              snippet: r.snippet,
              source: r.source,
            })),
            durationMs: Date.now() - startMs,
          },
        };
      } catch (err) {
        return {
          success: false,
          error: `Deep research failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });
}

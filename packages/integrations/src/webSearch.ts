/**
 * Web Search Integration
 *
 * Provides real web search capability for agent research threads.
 * Uses OpenAI's Responses API with web_search_preview tool (GPT-5.2)
 * to perform grounded web searches. No external search API key needed —
 * uses the existing OPENAI_API_KEY.
 *
 * Environment variables:
 *   OPENAI_API_KEY — OpenAI API key (already configured in Cloud Run)
 */

/* ── Types ──────────────────────────────────── */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  source?: string;
}

export interface NewsResult {
  title: string;
  url: string;
  snippet: string;
  date: string;
  source: string;
}

export interface WebSearchOptions {
  /** Number of results to return (default: 10) */
  num?: number;
  /** Country code for localization (default: 'us') */
  gl?: string;
  /** Time range: 'day' | 'week' | 'month' | 'year' */
  timeRange?: string;
}

/* ── OpenAI Responses API types ─────────────── */

interface OpenAIResponseItem {
  type: string;
  id?: string;
  status?: string;
  // web_search_call items
  // message items
  role?: string;
  content?: Array<{
    type: string;
    text?: string;
    annotations?: Array<{
      type: string;
      url?: string;
      title?: string;
      start_index?: number;
      end_index?: number;
    }>;
  }>;
}

interface OpenAIResponsesResult {
  id: string;
  output: OpenAIResponseItem[];
}

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

import { WEB_SEARCH_MODEL } from '@glyphor/shared/models';
const SEARCH_MODEL = WEB_SEARCH_MODEL;

/**
 * Build the Responses API URL and auth headers.
 * Uses Azure Foundry when AZURE_FOUNDRY_ENDPOINT + AZURE_FOUNDRY_API are set,
 * otherwise falls back to direct OpenAI with OPENAI_API_KEY.
 */
function getResponsesEndpoint(): { url: string; headers: Record<string, string> } | null {
  const azureEndpoint = process.env.AZURE_FOUNDRY_ENDPOINT;
  const azureApiKey = process.env.AZURE_FOUNDRY_API;
  if (azureEndpoint && azureApiKey) {
    return {
      url: `${azureEndpoint}/openai/responses?api-version=2025-04-01-preview`,
      headers: {
        'Content-Type': 'application/json',
        'api-key': azureApiKey,
      },
    };
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    return {
      url: OPENAI_RESPONSES_URL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    };
  }
  return null;
}

/**
 * Call OpenAI Responses API with web_search_preview to get grounded search results.
 * Routes through Azure OpenAI when configured.
 */
async function openaiWebSearch(
  prompt: string,
  searchContextSize: 'low' | 'medium' | 'high' = 'medium',
): Promise<{ text: string; annotations: Array<{ url: string; title: string }> }> {
  const endpoint = getResponsesEndpoint();
  if (!endpoint) {
    console.warn('[WebSearch] No OpenAI or Azure OpenAI API key configured — returning empty results');
    return { text: '', annotations: [] };
  }

  const res = await fetch(endpoint.url, {
    method: 'POST',
    headers: endpoint.headers,
    body: JSON.stringify({
      model: SEARCH_MODEL,
      tools: [{ type: 'web_search_preview', search_context_size: searchContextSize }],
      input: prompt,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown');
    console.error(`[WebSearch] OpenAI Responses API error: ${res.status} ${errText}`);
    return { text: '', annotations: [] };
  }

  const data = await res.json() as OpenAIResponsesResult;

  // Extract text and URL annotations from the response output
  const annotations: Array<{ url: string; title: string }> = [];
  let text = '';

  for (const item of data.output ?? []) {
    if (item.type === 'message' && item.content) {
      for (const block of item.content) {
        if (block.type === 'output_text' && block.text) {
          text += block.text;
        }
        if (block.annotations) {
          for (const ann of block.annotations) {
            if (ann.type === 'url_citation' && ann.url) {
              annotations.push({ url: ann.url, title: ann.title ?? '' });
            }
          }
        }
      }
    }
  }

  return { text, annotations };
}

/**
 * Parse the OpenAI grounded response into structured SearchResult items.
 * Each URL citation becomes a search result, with the surrounding text as a snippet.
 */
function parseSearchResults(
  text: string,
  annotations: Array<{ url: string; title: string }>,
  maxResults: number,
): SearchResult[] {
  // Deduplicate by URL, preserve order
  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const ann of annotations) {
    if (seen.has(ann.url) || results.length >= maxResults) continue;
    seen.add(ann.url);
    results.push({
      title: ann.title || ann.url,
      url: ann.url,
      snippet: '', // Will fill below
    });
  }

  // Use the full response text as context — split into rough per-source snippets
  // by finding text near each citation
  if (text && results.length > 0) {
    // Simple approach: give each result the full summary text (it's already grounded)
    // For better UX, try to extract relevant chunks
    const sentences = text.split(/(?<=[.!?])\s+/);
    for (const result of results) {
      // Find sentences that reference this source's domain or title
      const domain = new URL(result.url).hostname.replace('www.', '');
      const relevant = sentences.filter(
        s => s.toLowerCase().includes(domain.toLowerCase())
          || (result.title && s.toLowerCase().includes(result.title.toLowerCase().slice(0, 30))),
      );
      result.snippet = relevant.length > 0
        ? relevant.slice(0, 3).join(' ')
        : text.slice(0, 300);
    }
  }

  return results;
}

/**
 * Execute a web search and return structured results.
 * Uses OpenAI GPT-5.2 with web_search_preview for grounded results.
 */
export async function searchWeb(
  query: string,
  options: WebSearchOptions = {},
): Promise<SearchResult[]> {
  const maxResults = options.num ?? 10;
  const timeContext = options.timeRange
    ? ` Focus on results from the last ${options.timeRange}.`
    : '';
  const prompt = `Search the web for: ${query}${timeContext}\n\nProvide comprehensive results with specific sources and URLs.`;

  const { text, annotations } = await openaiWebSearch(prompt, 'medium');
  if (!text && annotations.length === 0) return [];

  return parseSearchResults(text, annotations, maxResults);
}

/**
 * Search for recent news articles.
 * Uses OpenAI GPT-5.2 with web_search_preview, prompting for news specifically.
 */
export async function searchNews(
  query: string,
  options: WebSearchOptions = {},
): Promise<NewsResult[]> {
  const maxResults = options.num ?? 10;
  const prompt = `Search for the latest news about: ${query}\n\nFocus on recent news articles, press releases, and breaking developments. Include publication dates and source names.`;

  const { text, annotations } = await openaiWebSearch(prompt, 'high');
  if (!text && annotations.length === 0) return [];

  // Parse into news results
  const seen = new Set<string>();
  const results: NewsResult[] = [];

  for (const ann of annotations) {
    if (seen.has(ann.url) || results.length >= maxResults) continue;
    seen.add(ann.url);

    // Extract domain as source name
    let source = '';
    try { source = new URL(ann.url).hostname.replace('www.', ''); } catch { /* skip */ }

    results.push({
      title: ann.title || ann.url,
      url: ann.url,
      snippet: '',
      date: new Date().toISOString().split('T')[0], // Best-effort — OpenAI doesn't give per-result dates
      source,
    });
  }

  // Fill snippets from the grounded text
  if (text && results.length > 0) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    for (const result of results) {
      const domain = new URL(result.url).hostname.replace('www.', '');
      const relevant = sentences.filter(
        s => s.toLowerCase().includes(domain.toLowerCase())
          || (result.title && s.toLowerCase().includes(result.title.toLowerCase().slice(0, 30))),
      );
      result.snippet = relevant.length > 0
        ? relevant.slice(0, 3).join(' ')
        : text.slice(0, 300);
    }
  }

  return results;
}

/**
 * Run multiple searches in parallel and deduplicate results.
 */
export async function batchSearch(
  queries: string[],
  options: WebSearchOptions = {},
): Promise<{ query: string; results: SearchResult[] }[]> {
  const outcomes = await Promise.allSettled(
    queries.map((q) => searchWeb(q, options)),
  );

  return queries.map((query, i) => ({
    query,
    results: outcomes[i].status === 'fulfilled' ? outcomes[i].value : [],
  }));
}

/**
 * Flatten batch search results into a context string suitable for LLM prompts.
 * Deduplicates by URL.
 */
export function searchResultsToContext(
  batches: { query: string; results: SearchResult[] }[],
): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const batch of batches) {
    lines.push(`### Search: "${batch.query}"`);
    for (const r of batch.results) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      lines.push(`- **${r.title}** (${r.url})${r.date ? ` [${r.date}]` : ''}`);
      lines.push(`  ${r.snippet}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

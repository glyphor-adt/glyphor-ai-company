/**
 * Web Search Integration
 *
 * Provides real web search capability for agent research threads.
 * Supports Serper (Google SERP) as the primary provider, with a
 * fallback stub when no API key is configured.
 *
 * Environment variables:
 *   SERPER_API_KEY — API key from serper.dev
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

/* ── Implementation ─────────────────────────── */

const SERPER_BASE = 'https://google.serper.dev';

/**
 * Execute a web search and return structured results.
 * Uses Serper (Google SERP API) when SERPER_API_KEY is set.
 */
export async function searchWeb(
  query: string,
  options: WebSearchOptions = {},
): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn('[WebSearch] No SERPER_API_KEY configured — returning empty results');
    return [];
  }

  const body: Record<string, unknown> = {
    q: query,
    num: options.num ?? 10,
    gl: options.gl ?? 'us',
  };
  if (options.timeRange) {
    const rangeMap: Record<string, string> = { day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' };
    body.tbs = rangeMap[options.timeRange] ?? options.timeRange;
  }

  const res = await fetch(`${SERPER_BASE}/search`, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(`[WebSearch] Serper API error: ${res.status} ${res.statusText}`);
    return [];
  }

  const data = await res.json() as {
    organic?: { title: string; link: string; snippet: string; date?: string }[];
    knowledgeGraph?: { title: string; description: string };
  };

  return (data.organic ?? []).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    date: r.date,
  }));
}

/**
 * Search for recent news articles.
 */
export async function searchNews(
  query: string,
  options: WebSearchOptions = {},
): Promise<NewsResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn('[WebSearch] No SERPER_API_KEY configured — returning empty news results');
    return [];
  }

  const res = await fetch(`${SERPER_BASE}/news`, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: query,
      num: options.num ?? 10,
      gl: options.gl ?? 'us',
    }),
  });

  if (!res.ok) {
    console.error(`[WebSearch] Serper news API error: ${res.status} ${res.statusText}`);
    return [];
  }

  const data = await res.json() as {
    news?: { title: string; link: string; snippet: string; date: string; source: string }[];
  };

  return (data.news ?? []).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    date: r.date,
    source: r.source,
  }));
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

/**
 * Web Search Integration
 *
 * Provides real web search capability for agent research threads.
 * Uses OpenAI's Responses API with web search to perform grounded searches.
 *
 * Prefers Azure OpenAI when endpoint + key are set; otherwise direct OpenAI:
 *   Azure (preferred when configured):
 *     AZURE_OPENAI_ENDPOINT or AZURE_FOUNDRY_ENDPOINT — e.g. https://my-resource.openai.azure.com
 *     AZURE_OPENAI_API_KEY or AZURE_FOUNDRY_API — API key
 *     WEB_SEARCH_AZURE_DEPLOYMENT (optional) — deployment name (default: gpt-5.4-mini)
 *   Direct OpenAI (fallback):
 *     OPENAI_API_KEY — direct API key
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
  /**
   * When true, logs the exact Responses API `input` (full prompt) to stdout.
   * Also enabled if env `WEB_SEARCH_DEBUG=1`.
   */
  logPrompt?: boolean;
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
  output?: OpenAIResponseItem[];
  error?: { message?: string; type?: string };
  status?: string;
  [key: string]: unknown;
}

const WEB_SEARCH_DEBUG =
  typeof process !== 'undefined' && process.env.WEB_SEARCH_DEBUG?.trim() === '1';

function logEmptySearchDebug(
  phase: string,
  promptSent: string,
  data: OpenAIResponsesResult,
  textLen: number,
  annotationCount: number,
): void {
  const output = data.output ?? [];
  const itemTypes = output.map((i) => i.type);
  const rawJson = JSON.stringify(data);
  const truncated = rawJson.length > 12_000 ? `${rawJson.slice(0, 12_000)}…(truncated ${rawJson.length} chars)` : rawJson;

  console.warn(
    `[WebSearch] ${phase}: no structured results. ` +
      `textLen=${textLen} annotationCount=${annotationCount} outputItemTypes=${JSON.stringify(itemTypes)} status=${String(data.status ?? '')}`,
  );
  console.warn(`[WebSearch] Responses API input (exact prompt sent):\n---\n${promptSent}\n---`);
  console.warn(`[WebSearch] Raw Responses API JSON (full body):\n${truncated}`);
}

/** Extract http(s) URLs from model text when url_citation annotations are missing. */
function extractUrlsFromText(text: string, max: number): string[] {
  const re = /https?:\/\/[^\s\])"'<>]+/gi;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && out.length < max) {
    const u = m[0].replace(/[.,;:!?)]+$/g, '');
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

import { WEB_SEARCH_MODEL } from '@glyphor/shared/models';
const SEARCH_MODEL = WEB_SEARCH_MODEL;

function getPreferredDirectOpenAIServiceTier(): 'flex' | undefined {
  const configured = process.env.OPENAI_SERVICE_TIER?.trim().toLowerCase();
  if (!configured || configured === 'flex') return 'flex';
  if (['auto', 'default', 'standard', 'off', 'disabled'].includes(configured)) {
    return undefined;
  }
  return 'flex';
}

function shouldRetryWithoutFlex(status: number, body: string): boolean {
  return (status === 429 && /resource unavailable|insufficient resources/i.test(body))
    || (/service[_\s-]?tier/i.test(body) && /invalid|unsupported|unknown|not available/i.test(body));
}

/**
 * Build the Responses API endpoint — Azure when configured, else direct OpenAI.
 */
function getResponsesEndpoint(): {
  url: string;
  headers: Record<string, string>;
  isAzure: boolean;
  model: string;
} | null {
  const azureEndpoint = (
    process.env.AZURE_OPENAI_ENDPOINT?.trim() ||
    process.env.AZURE_FOUNDRY_ENDPOINT?.trim()
  ) || undefined;
  const azureApiKey = (
    process.env.AZURE_OPENAI_API_KEY?.trim() ||
    process.env.AZURE_FOUNDRY_API?.trim()
  ) || undefined;

  if (azureEndpoint && azureApiKey) {
    const base = azureEndpoint.replace(/\/$/, '');
    const url = `${base}/openai/v1/responses`;
    const deployment = process.env.WEB_SEARCH_AZURE_DEPLOYMENT?.trim() || SEARCH_MODEL;
    return {
      url,
      headers: {
        'Content-Type': 'application/json',
        'api-key': azureApiKey,
      },
      isAzure: true,
      model: deployment,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (apiKey) {
    return {
      url: OPENAI_RESPONSES_URL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      isAzure: false,
      model: SEARCH_MODEL,
    };
  }

  return null;
}

/**
 * Call OpenAI Responses API with web_search_preview to get grounded search results.
 */
async function openaiWebSearch(
  prompt: string,
  searchContextSize: 'low' | 'medium' | 'high' = 'medium',
): Promise<{
  text: string;
  annotations: Array<{ url: string; title: string }>;
  rawResponse: OpenAIResponsesResult | null;
}> {
  const endpoint = getResponsesEndpoint();
  if (!endpoint) {
    console.warn('[WebSearch] No OpenAI or Azure OpenAI configured — set AZURE_OPENAI_ENDPOINT+AZURE_OPENAI_API_KEY or OPENAI_API_KEY');
    return { text: '', annotations: [], rawResponse: null };
  }

  const isDirectOpenAI = !endpoint.isAzure;
  const preferredTier = isDirectOpenAI ? getPreferredDirectOpenAIServiceTier() : undefined;
  // Azure recommends web_search; direct OpenAI uses web_search_preview
  const tools = endpoint.isAzure
    ? [{ type: 'web_search' as const }]
    : [{ type: 'web_search_preview' as const, search_context_size: searchContextSize }];
  const requestBody = {
    model: endpoint.model,
    tools,
    input: prompt,
  };

  // [DIAG] Temporary logging for discover_keywords empty-array diagnosis
  console.log('[WebSearch DIAG] Before fetch:');
  console.log('[WebSearch DIAG]   provider:', endpoint.isAzure ? 'Azure' : 'OpenAI');
  console.log('[WebSearch DIAG]   prompt:', JSON.stringify(prompt, null, 2).slice(0, 800));
  console.log('[WebSearch DIAG]   model:', endpoint.model);
  console.log('[WebSearch DIAG]   tools:', JSON.stringify(requestBody.tools, null, 2));

  let res = await fetch(endpoint.url, {
    method: 'POST',
    headers: endpoint.headers,
    body: JSON.stringify(
      isDirectOpenAI && preferredTier
        ? { ...requestBody, service_tier: preferredTier }
        : requestBody,
    ),
  });

  if (!res.ok && preferredTier) {
    const errText = await res.text().catch(() => 'unknown');
    if (shouldRetryWithoutFlex(res.status, errText)) {
      console.warn(`[WebSearch] Flex unavailable for ${SEARCH_MODEL} — retrying with standard tier`);
      res = await fetch(endpoint.url, {
        method: 'POST',
        headers: endpoint.headers,
        body: JSON.stringify({ ...requestBody, service_tier: 'auto' }),
      });
    } else {
      console.error(`[WebSearch] OpenAI Responses API error: ${res.status} ${errText}`);
      return { text: '', annotations: [], rawResponse: null };
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown');
    console.error(`[WebSearch] OpenAI Responses API error: ${res.status} ${errText}`);
    return { text: '', annotations: [], rawResponse: null };
  }

  const data = (await res.json()) as OpenAIResponsesResult;

  // [DIAG] Temporary logging after response
  console.log('[WebSearch DIAG] After response:');
  console.log('[WebSearch DIAG]   raw response keys:', Object.keys(data));
  console.log('[WebSearch DIAG]   output exists:', Array.isArray(data.output));
  console.log('[WebSearch DIAG]   output length:', data.output?.length ?? 0);
  console.log('[WebSearch DIAG]   error:', data.error ?? '(none)');
  console.log('[WebSearch DIAG]   status:', data.status ?? '(none)');
  if (data.output?.length) {
    console.log('[WebSearch DIAG]   first output item type:', data.output[0]?.type);
  }

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

  return { text, annotations, rawResponse: data };
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

  // Fallback: model sometimes returns output_text with URLs but no url_citation annotations
  if (results.length === 0 && text.trim()) {
    for (const url of extractUrlsFromText(text, maxResults)) {
      if (seen.has(url)) continue;
      seen.add(url);
      results.push({
        title: url,
        url,
        snippet: text.slice(0, 400),
      });
    }
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
 * Build the exact `input` string sent to the Responses API (natural language, not API-style keywords).
 */
export function buildSearchWebPrompt(query: string, options: WebSearchOptions = {}): string {
  const timeContext = options.timeRange
    ? ` Prefer sources and facts from the last ${options.timeRange}.`
    : '';
  const q = query.trim();
  return `${q}${timeContext}

Answer with current web information, name your sources, and include specific page URLs in the answer so they can be cited.`;
}

/**
 * Execute a web search and return structured results.
 * Uses the shared OpenAI web-search model with grounded results.
 */
export async function searchWeb(
  query: string,
  options: WebSearchOptions = {},
): Promise<SearchResult[]> {
  const maxResults = options.num ?? 10;
  const prompt = buildSearchWebPrompt(query, options);

  if (options.logPrompt || WEB_SEARCH_DEBUG) {
    console.log(`[WebSearch] Responses API input (exact prompt):\n---\n${prompt}\n---`);
  }

  const { text, annotations, rawResponse } = await openaiWebSearch(prompt, 'medium');

  if (!text && annotations.length === 0) {
    if (rawResponse) {
      logEmptySearchDebug('openaiWebSearch:empty_text_and_annotations', prompt, rawResponse, 0, 0);
    }
    return [];
  }

  const parsed = parseSearchResults(text, annotations, maxResults);

  if (parsed.length === 0) {
    const raw = rawResponse ?? ({ id: '', output: [] } as OpenAIResponsesResult);
    logEmptySearchDebug('searchWeb:parse_yielded_empty', prompt, raw, text.length, annotations.length);
  }

  return parsed;
}

/**
 * Search for recent news articles.
 * Uses the shared OpenAI web-search model, prompting for news specifically.
 */
export async function searchNews(
  query: string,
  options: WebSearchOptions = {},
): Promise<NewsResult[]> {
  const maxResults = options.num ?? 10;
  const prompt = `Latest news about: ${query.trim()}

Focus on recent articles and press releases; name outlets and include specific article URLs.`;

  const { text, annotations, rawResponse } = await openaiWebSearch(prompt, 'high');
  if (!text && annotations.length === 0) {
    if (rawResponse) {
      logEmptySearchDebug('searchNews:empty', prompt, rawResponse, 0, 0);
    }
    return [];
  }

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

  if (results.length === 0 && text.trim()) {
    for (const url of extractUrlsFromText(text, maxResults)) {
      if (seen.has(url)) continue;
      seen.add(url);
      let source = '';
      try { source = new URL(url).hostname.replace('www.', ''); } catch { /* skip */ }
      results.push({
        title: url,
        url,
        snippet: text.slice(0, 300),
        date: new Date().toISOString().split('T')[0],
        source,
      });
    }
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

  if (results.length === 0 && (text || annotations.length)) {
    const raw = rawResponse ?? ({ id: '', output: [] } as OpenAIResponsesResult);
    logEmptySearchDebug('searchNews:yielded_empty', prompt, raw, text.length, annotations.length);
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

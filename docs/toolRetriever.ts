/**
 * toolRetriever.ts
 * 
 * Replaces toolSubsets.ts with semantic tool retrieval.
 * Sits between tool assembly (run.ts) and model invocation.
 * 
 * Architecture:
 *   All 156 tools from 5 layers → ToolRetriever → 10-25 relevant tools → model
 * 
 * Instead of priority-bucket capping (pinned → Agent365 → rest → slice to 128),
 * this module:
 *   1. Maintains a Tool2Vec index (usage-query embeddings, not descriptions)
 *   2. Runs hybrid BM25 + vector search per task
 *   3. Merges pinned department tools
 *   4. Applies model-aware caps
 * 
 * Drop-in location: packages/agent-runtime/src/routing/toolRetriever.ts
 */

import { createHash } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  /** Source layer for logging/debugging */
  source?: 'agent-specific' | 'shared-static' | 'agent365-mcp' | 'glyphor-mcp' | 'dynamic';
  /** Tags for BM25 boosting (e.g., ['sharepoint', 'files', 'documents']) */
  tags?: string[];
}

export interface ToolIndexEntry {
  tool: ToolDefinition;
  /** Tool2Vec embedding: average of usage-query embeddings */
  embedding: number[];
  /** Tokenized fields for BM25 */
  bm25Tokens: string[];
  /** Pre-computed usage queries for re-indexing */
  usageQueries: string[];
}

export interface RetrievalConfig {
  /** Model being used — determines cap and whether native tool search is available */
  model: string;
  /** Agent's department context for pinned tools */
  department?: string;
  /** Agent role for role-specific pins */
  agentRole?: string;
  /** Override: max tools to return (otherwise model-aware default) */
  maxTools?: number;
  /** Weight for BM25 vs vector (0 = pure vector, 1 = pure BM25). Default: 0.3 */
  bm25Weight?: number;
}

export interface RetrievalResult {
  tools: ToolDefinition[];
  /** Debug info: which tools were selected and why */
  trace: {
    totalCandidates: number;
    pinnedTools: string[];
    retrievedTools: Array<{ name: string; score: number; method: 'bm25' | 'vector' | 'hybrid' }>;
    modelCap: number;
    model: string;
  };
}

// ─── Model Caps ──────────────────────────────────────────────────────────────

/**
 * Model-aware tool caps. Models with native tool search get higher caps
 * because they can defer-load. Smaller models get aggressive caps because
 * tool definitions eat their limited context.
 */
const MODEL_CAPS: Record<string, number> = {
  // Frontier models with native tool search support
  'gpt-5.4':           128,
  'gpt-5.4-turbo':     128,
  'claude-opus-4-6':   128,
  'claude-sonnet-4-6': 100,
  
  // Strong models without native tool search
  'gpt-4.1':           64,
  'gpt-4.1-mini':      40,
  'claude-sonnet-4-5': 64,
  'gemini-3.1-pro-preview': 64,
  'gemini-2.5-flash':  40,
  
  // Smaller / nano models — tight caps
  'gpt-4.1-nano':      20,
  'claude-haiku-4-5':  25,
  'gemini-2.0-flash':  30,
};

const DEFAULT_CAP = 40;

/** Models that support Anthropic's native tool search (defer_loading) */
const NATIVE_TOOL_SEARCH_MODELS = new Set([
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-opus-4-5',
  'claude-sonnet-4-5',
]);

/** Models that support OpenAI's tool search equivalent */
const OPENAI_TOOL_SEARCH_MODELS = new Set([
  'gpt-5.4',
  'gpt-5.4-turbo',
]);

// ─── Department Pin Configuration ────────────────────────────────────────────

/**
 * Tools that are ALWAYS included for a given department, regardless of
 * retrieval scores. These bypass search entirely.
 * 
 * Keep this list SHORT (3-5 per department). These are tools the department
 * literally cannot function without.
 */
const DEPARTMENT_PINS: Record<string, string[]> = {
  marketing: [
    'search_sharepoint',      // Marketing collateral lives here
    'create_social_post',
    'canva_generate',
    'seo_audit',
  ],
  finance: [
    'search_sharepoint',
    'create_invoice',
    'revenue_lookup',
    'cost_analysis',
  ],
  engineering: [
    'search_sharepoint',
    'github_search',
    'create_pull_request',
    'run_ci_pipeline',
  ],
  operations: [
    'search_sharepoint',
    'assign_task',
    'send_message',
  ],
  executive: [
    'search_sharepoint',
    'send_message',
    'assign_task',
    'revenue_lookup',
  ],
};

/**
 * Core tools included for EVERY agent regardless of department or task.
 * These are the 3-5 tools that define basic agent functionality.
 */
const ALWAYS_ON_TOOLS = [
  'memory_recall',
  'memory_store',
  'send_message',
  'assign_task',
  'request_tool_access',  // Self-service: agent can ask for tools it doesn't have
];

// ─── BM25 Implementation ────────────────────────────────────────────────────

/**
 * Lightweight BM25 scorer. No external deps.
 * Works on pre-tokenized documents (tool descriptions + tags + usage queries).
 */
class BM25Index {
  private docs: string[][] = [];
  private docFreq: Map<string, number> = new Map();
  private avgDocLen = 0;
  private k1 = 1.5;
  private b = 0.75;

  constructor(private toolNames: string[]) {}

  addDocument(tokens: string[]) {
    this.docs.push(tokens);
    const seen = new Set<string>();
    for (const token of tokens) {
      if (!seen.has(token)) {
        this.docFreq.set(token, (this.docFreq.get(token) || 0) + 1);
        seen.add(token);
      }
    }
    // Recompute average
    this.avgDocLen = this.docs.reduce((sum, d) => sum + d.length, 0) / this.docs.length;
  }

  search(query: string, topK: number = 20): Array<{ index: number; score: number }> {
    const queryTokens = tokenize(query);
    const N = this.docs.length;
    const scores: Array<{ index: number; score: number }> = [];

    for (let i = 0; i < this.docs.length; i++) {
      let score = 0;
      const doc = this.docs[i];
      const dl = doc.length;

      for (const qt of queryTokens) {
        const tf = doc.filter(t => t === qt).length;
        const df = this.docFreq.get(qt) || 0;
        if (df === 0) continue;

        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
        const tfNorm = (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (dl / this.avgDocLen)));
        score += idf * tfNorm;
      }

      if (score > 0) {
        scores.push({ index: i, score });
      }
    }

    return scores.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}

// ─── Vector Search ───────────────────────────────────────────────────────────

/**
 * Cosine similarity between two vectors.
 * Both vectors should already be normalized for best performance,
 * but we normalize here as a safety net.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Simple brute-force vector search. At 156 tools, this is <1ms.
 * Swap for HNSW/Annoy if you ever hit 10k+ tools.
 */
function vectorSearch(
  queryEmbedding: number[],
  entries: ToolIndexEntry[],
  topK: number = 20
): Array<{ index: number; score: number }> {
  const scores = entries.map((entry, index) => ({
    index,
    score: cosineSimilarity(queryEmbedding, entry.embedding),
  }));
  return scores.sort((a, b) => b.score - a.score).slice(0, topK);
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

// ─── Embedding Provider Interface ────────────────────────────────────────────

/**
 * Abstract embedding provider. Implement for your preferred embedding service.
 * 
 * For Glyphor, recommended options:
 *   - OpenAI text-embedding-3-small (cheapest, good enough for 156 tools)
 *   - Vertex AI text-embedding-005 (you're already on GCP)
 *   - Local: run a small model via Ollama if you want zero external deps
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

/**
 * Example: OpenAI embedding provider.
 * Replace with your preferred service.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  dimensions = 1536;

  constructor(
    private apiKey: string,
    private model: string = 'text-embedding-3-small'
  ) {}

  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data.map(d => d.embedding);
  }
}

// ─── Tool Retriever ──────────────────────────────────────────────────────────

export class ToolRetriever {
  private entries: ToolIndexEntry[] = [];
  private bm25Index: BM25Index;
  private toolNameToIndex: Map<string, number> = new Map();
  private initialized = false;

  constructor(private embeddingProvider: EmbeddingProvider) {
    this.bm25Index = new BM25Index([]);
  }

  /**
   * Index all tools. Call once at startup, or when tools change.
   * 
   * @param tools - All assembled tools from the 5 layers
   * @param usageQueriesMap - Pre-generated Tool2Vec queries per tool name.
   *   Generate these with generateUsageQueries() below.
   *   If not provided for a tool, falls back to description-based embedding.
   */
  async indexTools(
    tools: ToolDefinition[],
    usageQueriesMap?: Map<string, string[]>
  ): Promise<void> {
    this.entries = [];
    this.toolNameToIndex.clear();
    const toolNames: string[] = [];

    // Prepare all texts for batch embedding
    const embeddingTexts: string[] = [];
    const embeddingToolIndices: number[] = []; // which tool each embedding belongs to
    const queriesPerTool: string[][] = [];

    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i];
      toolNames.push(tool.name);

      const usageQueries = usageQueriesMap?.get(tool.name) || [
        // Fallback: construct synthetic queries from description
        tool.description,
        `use ${tool.name}`,
        `${tool.name} ${tool.tags?.join(' ') || ''}`.trim(),
      ];

      queriesPerTool.push(usageQueries);

      for (const query of usageQueries) {
        embeddingTexts.push(query);
        embeddingToolIndices.push(i);
      }
    }

    // Batch embed all usage queries
    const allEmbeddings = await this.embeddingProvider.embedBatch(embeddingTexts);

    // Build entries with averaged Tool2Vec embeddings
    const dims = this.embeddingProvider.dimensions;

    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i];

      // Average the embeddings for this tool's usage queries
      const toolEmbeddingIndices = embeddingToolIndices
        .map((ti, ei) => ti === i ? ei : -1)
        .filter(ei => ei >= 0);

      const avgEmbedding = new Array(dims).fill(0);
      for (const ei of toolEmbeddingIndices) {
        const emb = allEmbeddings[ei];
        for (let d = 0; d < dims; d++) {
          avgEmbedding[d] += emb[d];
        }
      }
      const count = toolEmbeddingIndices.length;
      for (let d = 0; d < dims; d++) {
        avgEmbedding[d] /= count;
      }

      // Build BM25 tokens from name + description + tags + usage queries
      const bm25Text = [
        tool.name.replace(/_/g, ' '),
        tool.description,
        ...(tool.tags || []),
        ...queriesPerTool[i],
      ].join(' ');

      const bm25Tokens = tokenize(bm25Text);

      const entry: ToolIndexEntry = {
        tool,
        embedding: avgEmbedding,
        bm25Tokens,
        usageQueries: queriesPerTool[i],
      };

      this.entries.push(entry);
      this.toolNameToIndex.set(tool.name, i);
    }

    // Build BM25 index
    this.bm25Index = new BM25Index(toolNames);
    for (const entry of this.entries) {
      this.bm25Index.addDocument(entry.bm25Tokens);
    }

    this.initialized = true;
    console.log(`[ToolRetriever] Indexed ${tools.length} tools with ${embeddingTexts.length} usage queries`);
  }

  /**
   * Retrieve relevant tools for a given task.
   * This is the main entry point — call this where toolSubsets.ts was called.
   */
  async retrieve(
    taskContext: string,
    config: RetrievalConfig
  ): Promise<RetrievalResult> {
    if (!this.initialized) {
      throw new Error('[ToolRetriever] Not initialized. Call indexTools() first.');
    }

    const bm25Weight = config.bm25Weight ?? 0.3;
    const modelCap = config.maxTools || MODEL_CAPS[config.model] || DEFAULT_CAP;

    // ── Step 1: Determine pinned tools ─────────────────────────────────────
    const pinnedNames = new Set<string>(ALWAYS_ON_TOOLS);

    // Add department-specific pins
    if (config.department && DEPARTMENT_PINS[config.department]) {
      for (const name of DEPARTMENT_PINS[config.department]) {
        pinnedNames.add(name);
      }
    }

    // Resolve pinned tools (filter to tools that actually exist in the index)
    const pinnedTools: ToolDefinition[] = [];
    const pinnedToolNames: string[] = [];
    for (const name of pinnedNames) {
      const idx = this.toolNameToIndex.get(name);
      if (idx !== undefined) {
        pinnedTools.push(this.entries[idx].tool);
        pinnedToolNames.push(name);
      }
    }

    // ── Step 2: Hybrid retrieval for remaining slots ───────────────────────
    const remainingSlots = modelCap - pinnedTools.length;
    if (remainingSlots <= 0) {
      // Model cap is so low that pinned tools fill it entirely
      return {
        tools: pinnedTools.slice(0, modelCap),
        trace: {
          totalCandidates: this.entries.length,
          pinnedTools: pinnedToolNames,
          retrievedTools: [],
          modelCap,
          model: config.model,
        },
      };
    }

    // Embed the task context
    const queryEmbedding = await this.embeddingProvider.embed(taskContext);

    // BM25 search
    const bm25Results = this.bm25Index.search(taskContext, remainingSlots * 2);

    // Vector search
    const vectorResults = vectorSearch(queryEmbedding, this.entries, remainingSlots * 2);

    // ── Step 3: Fuse scores (Reciprocal Rank Fusion) ───────────────────────
    const fusedScores = new Map<number, { score: number; method: 'bm25' | 'vector' | 'hybrid' }>();
    const k = 60; // RRF constant

    // Add BM25 scores
    for (let rank = 0; rank < bm25Results.length; rank++) {
      const { index } = bm25Results[rank];
      const rrfScore = bm25Weight / (k + rank + 1);
      fusedScores.set(index, {
        score: rrfScore,
        method: 'bm25',
      });
    }

    // Add vector scores
    const vectorWeight = 1 - bm25Weight;
    for (let rank = 0; rank < vectorResults.length; rank++) {
      const { index } = vectorResults[rank];
      const rrfScore = vectorWeight / (k + rank + 1);
      const existing = fusedScores.get(index);
      if (existing) {
        existing.score += rrfScore;
        existing.method = 'hybrid';
      } else {
        fusedScores.set(index, {
          score: rrfScore,
          method: 'vector',
        });
      }
    }

    // Sort by fused score, exclude pinned tools
    const rankedResults = Array.from(fusedScores.entries())
      .filter(([index]) => !pinnedNames.has(this.entries[index].tool.name))
      .sort(([, a], [, b]) => b.score - a.score)
      .slice(0, remainingSlots);

    // ── Step 4: Assemble final tool list ───────────────────────────────────
    const retrievedTools = rankedResults.map(([index, { score, method }]) => ({
      tool: this.entries[index].tool,
      name: this.entries[index].tool.name,
      score,
      method,
    }));

    const finalTools = [
      ...pinnedTools,
      ...retrievedTools.map(r => r.tool),
    ];

    return {
      tools: finalTools,
      trace: {
        totalCandidates: this.entries.length,
        pinnedTools: pinnedToolNames,
        retrievedTools: retrievedTools.map(r => ({
          name: r.name,
          score: r.score,
          method: r.method,
        })),
        modelCap,
        model: config.model,
      },
    };
  }

  /**
   * Check if a specific tool would be retrievable for a given query.
   * Useful for debugging "why didn't search_sharepoint show up?"
   */
  async debugToolRetrieval(
    toolName: string,
    taskContext: string
  ): Promise<{
    exists: boolean;
    bm25Rank: number | null;
    vectorRank: number | null;
    vectorScore: number | null;
    bm25Score: number | null;
  }> {
    const idx = this.toolNameToIndex.get(toolName);
    if (idx === undefined) {
      return { exists: false, bm25Rank: null, vectorRank: null, vectorScore: null, bm25Score: null };
    }

    const queryEmbedding = await this.embeddingProvider.embed(taskContext);
    const bm25Results = this.bm25Index.search(taskContext, this.entries.length);
    const vectorResults = vectorSearch(queryEmbedding, this.entries, this.entries.length);

    const bm25Entry = bm25Results.find(r => r.index === idx);
    const vectorEntry = vectorResults.find(r => r.index === idx);

    return {
      exists: true,
      bm25Rank: bm25Entry ? bm25Results.indexOf(bm25Entry) + 1 : null,
      vectorRank: vectorEntry ? vectorResults.indexOf(vectorEntry) + 1 : null,
      vectorScore: vectorEntry?.score ?? null,
      bm25Score: bm25Entry?.score ?? null,
    };
  }

  /** Get current index stats */
  getStats(): { totalTools: number; indexed: boolean } {
    return {
      totalTools: this.entries.length,
      indexed: this.initialized,
    };
  }
}

// ─── Tool2Vec Query Generator ────────────────────────────────────────────────

/**
 * Generate Tool2Vec usage queries for a tool.
 * Run this offline / at build time, store results in DB or JSON.
 * 
 * Uses an LLM to generate realistic queries a user/agent would send
 * when they need this specific tool.
 * 
 * @param tool - The tool definition
 * @param llmCall - Your existing LLM call function
 * @param count - Number of usage queries to generate (default: 8)
 */
export async function generateUsageQueries(
  tool: ToolDefinition,
  llmCall: (prompt: string) => Promise<string>,
  count: number = 8
): Promise<string[]> {
  const prompt = `You are generating training data for a tool retrieval system.

Given this tool definition:
  Name: ${tool.name}
  Description: ${tool.description}
  Tags: ${tool.tags?.join(', ') || 'none'}
  Source: ${tool.source || 'unknown'}

Generate exactly ${count} diverse, realistic queries that a user or AI agent would send when they need THIS specific tool (not a similar tool).

Requirements:
- Queries should be natural language task descriptions, NOT tool names
- Include variations: direct requests, indirect references, different phrasings
- Include at least 2 queries that DON'T mention the tool by name
- Include at least 1 query that uses domain jargon specific to the tool's purpose
- Each query should be 5-20 words

Return ONLY the queries, one per line, no numbering or bullets.`;

  const response = await llmCall(prompt);
  return response
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .slice(0, count);
}

/**
 * Batch generate usage queries for all tools.
 * Run this as a setup script, save to tool_registry or a JSON file.
 */
export async function generateAllUsageQueries(
  tools: ToolDefinition[],
  llmCall: (prompt: string) => Promise<string>,
  count: number = 8
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();

  // Process in batches to avoid rate limits
  const batchSize = 5;
  for (let i = 0; i < tools.length; i += batchSize) {
    const batch = tools.slice(i, i + batchSize);
    const promises = batch.map(tool => generateUsageQueries(tool, llmCall, count));
    const batchResults = await Promise.all(promises);

    for (let j = 0; j < batch.length; j++) {
      result.set(batch[j].name, batchResults[j]);
    }

    console.log(`[Tool2Vec] Generated queries for ${Math.min(i + batchSize, tools.length)}/${tools.length} tools`);
  }

  return result;
}

// ─── Integration Helpers ─────────────────────────────────────────────────────

/**
 * For models that support native tool search (Claude 4.5+, 4.6),
 * wrap the retrieved tools with defer_loading for a second safety net.
 * 
 * The retriever already filtered to relevant tools, but native tool search
 * provides an additional layer: if the retrieved set missed something,
 * the model can discover it via its built-in search.
 */
export function applyNativeToolSearch(
  tools: ToolDefinition[],
  model: string,
  pinnedToolNames: Set<string>
): any[] {
  if (NATIVE_TOOL_SEARCH_MODELS.has(model)) {
    return [
      // Add the tool search tool itself
      {
        type: 'tool_search_tool_bm25_20251119',
        name: 'tool_search_tool_bm25',
      },
      // Pinned tools load immediately, others are deferred
      ...tools.map(t => ({
        ...t,
        defer_loading: !pinnedToolNames.has(t.name),
      })),
    ];
  }

  // Non-Claude models: return tools as-is
  return tools;
}

/**
 * Build the task context string from available information.
 * The richer this is, the better retrieval works.
 */
export function buildTaskContext(
  userMessage: string,
  agentRole?: string,
  department?: string,
  recentToolCalls?: string[],
  standingOrders?: string[]
): string {
  const parts = [userMessage];

  if (agentRole) {
    parts.push(`Agent role: ${agentRole}`);
  }
  if (department) {
    parts.push(`Department: ${department}`);
  }
  if (recentToolCalls?.length) {
    parts.push(`Recent tools used: ${recentToolCalls.slice(-3).join(', ')}`);
  }
  if (standingOrders?.length) {
    parts.push(`Standing orders: ${standingOrders.slice(0, 2).join('; ')}`);
  }

  return parts.join('\n');
}

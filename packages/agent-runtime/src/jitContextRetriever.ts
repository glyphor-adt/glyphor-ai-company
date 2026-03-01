/**
 * JIT Context Retriever — Task-aware semantic retrieval across all
 * knowledge stores.
 *
 * Replaces the tier-based "load everything" approach with targeted
 * retrieval: embeds the task, queries all stores in parallel, scores
 * by relevance, and trims to a token budget.
 */

import { systemQuery } from '@glyphor/shared/db';
import type { RedisCache } from './redisCache.js';

/** Minimal interface to avoid circular dependency on @glyphor/company-memory */
export interface EmbeddingClient {
  embed(text: string): Promise<number[]>;
}
import { CACHE_KEYS, CACHE_TTL } from './redisCache.js';
import { createHash } from 'node:crypto';

// ─── Types ──────────────────────────────────────────────────────

export interface JitContextItem {
  source: 'memory' | 'graph' | 'episode' | 'procedure' | 'knowledge';
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface JitContext {
  relevantMemories: JitContextItem[];
  relevantGraphNodes: JitContextItem[];
  relevantEpisodes: JitContextItem[];
  relevantProcedures: JitContextItem[];
  relevantKnowledge: JitContextItem[];
  tokenEstimate: number;
  fromCache: boolean;
}

// ─── JitContextRetriever ────────────────────────────────────────

const DEFAULT_TOKEN_BUDGET = 3000;
const DEFAULT_MATCH_COUNT = 5;
const DEFAULT_MATCH_THRESHOLD = 0.65;

export class JitContextRetriever {
  constructor(
    private embeddingClient: EmbeddingClient,
    private cache?: RedisCache,
  ) {}

  /**
   * Retrieve task-relevant context from all knowledge stores.
   * Results are cached in Redis keyed by agent + task hash.
   */
  async retrieve(
    agentRole: string,
    task: string,
    tokenBudget: number = DEFAULT_TOKEN_BUDGET,
  ): Promise<JitContext> {
    const taskHash = this.hashTask(task);
    const cacheKey = CACHE_KEYS.jit(agentRole, taskHash);

    // Check cache first
    if (this.cache) {
      const cached = await this.cache.get<JitContext>(cacheKey);
      if (cached) {
        return { ...cached, fromCache: true };
      }
    }

    const result = await this.retrieveFromStores(agentRole, task, tokenBudget);

    // Cache the result
    if (this.cache) {
      await this.cache.set(cacheKey, result, CACHE_TTL.jit);
    }

    return result;
  }

  /**
   * Core retrieval — embeds the task and queries all stores in parallel.
   */
  private async retrieveFromStores(
    agentRole: string,
    task: string,
    tokenBudget: number,
  ): Promise<JitContext> {
    // Embed the task for semantic search
    let embedding: number[];
    try {
      embedding = await this.embeddingClient.embed(`${agentRole}: ${task}`);
    } catch (err) {
      console.warn(`[JitContext] Embedding failed:`, (err as Error).message);
      return this.emptyContext();
    }

    const embeddingStr = `[${embedding.join(',')}]`;

    // Query all stores in parallel
    const [memories, graphNodes, episodes, procedures, knowledge] = await Promise.allSettled([
      this.queryMemories(embeddingStr, agentRole),
      this.queryGraphNodes(embeddingStr),
      this.queryEpisodes(embeddingStr),
      this.queryProcedures(task),
      this.queryKnowledge(embeddingStr),
    ]);

    const relevantMemories = memories.status === 'fulfilled' ? memories.value : [];
    const relevantGraphNodes = graphNodes.status === 'fulfilled' ? graphNodes.value : [];
    const relevantEpisodes = episodes.status === 'fulfilled' ? episodes.value : [];
    const relevantProcedures = procedures.status === 'fulfilled' ? procedures.value : [];
    const relevantKnowledge = knowledge.status === 'fulfilled' ? knowledge.value : [];

    // Combine all items, sort by score, and trim to token budget
    const allItems = [
      ...relevantMemories,
      ...relevantGraphNodes,
      ...relevantEpisodes,
      ...relevantProcedures,
      ...relevantKnowledge,
    ].sort((a, b) => b.score - a.score);

    let tokenCount = 0;
    const trimmed: JitContextItem[] = [];
    for (const item of allItems) {
      const itemTokens = this.estimateTokens(item.content);
      if (tokenCount + itemTokens > tokenBudget) break;
      trimmed.push(item);
      tokenCount += itemTokens;
    }

    // Re-separate by source
    const result: JitContext = {
      relevantMemories: trimmed.filter(i => i.source === 'memory'),
      relevantGraphNodes: trimmed.filter(i => i.source === 'graph'),
      relevantEpisodes: trimmed.filter(i => i.source === 'episode'),
      relevantProcedures: trimmed.filter(i => i.source === 'procedure'),
      relevantKnowledge: trimmed.filter(i => i.source === 'knowledge'),
      tokenEstimate: tokenCount,
      fromCache: false,
    };

    return result;
  }

  /** Query agent memories by embedding similarity. */
  private async queryMemories(embeddingStr: string, agentRole: string): Promise<JitContextItem[]> {
    try {
      const data = await systemQuery<{ content: string; importance: number; similarity: number }>(
        'SELECT * FROM match_memories($1, $2, $3, $4)',
        [embeddingStr, DEFAULT_MATCH_COUNT, DEFAULT_MATCH_THRESHOLD, agentRole],
      );

      return data.map(row => ({
        source: 'memory' as const,
        content: row.content,
        score: row.similarity * (row.importance ?? 1),
        metadata: { importance: row.importance },
      }));
    } catch {
      return [];
    }
  }

  /** Query knowledge graph nodes by embedding similarity. */
  private async queryGraphNodes(embeddingStr: string): Promise<JitContextItem[]> {
    try {
      const data = await systemQuery<{ name: string; description: string; similarity: number }>(
        'SELECT * FROM match_kg_nodes($1, $2, $3)',
        [embeddingStr, DEFAULT_MATCH_COUNT, DEFAULT_MATCH_THRESHOLD],
      );

      return data.map(row => ({
        source: 'graph' as const,
        content: `${row.name}: ${row.description}`,
        score: row.similarity,
      }));
    } catch {
      return [];
    }
  }

  /** Query shared episodes by embedding similarity. */
  private async queryEpisodes(embeddingStr: string): Promise<JitContextItem[]> {
    try {
      const data = await systemQuery<{ summary: string; confidence: number; similarity: number; outcome?: string }>(
        'SELECT * FROM match_shared_episodes($1, $2, $3)',
        [embeddingStr, DEFAULT_MATCH_COUNT, DEFAULT_MATCH_THRESHOLD],
      );

      return data.map(row => ({
        source: 'episode' as const,
        content: row.outcome ? `${row.summary} → ${row.outcome}` : row.summary,
        score: row.similarity * (row.confidence ?? 1),
        metadata: { confidence: row.confidence },
      }));
    } catch {
      return [];
    }
  }

  /** Query shared procedures by text similarity (keyword match). */
  private async queryProcedures(task: string): Promise<JitContextItem[]> {
    // Use ilike for keyword matching on procedures (they may not have embeddings)
    const keywords = task.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
    if (keywords.length === 0) return [];

    const conditions = keywords.map((_, i) => `(title ILIKE $${i + 1} OR description ILIKE $${i + 1})`).join(' OR ');
    const params = keywords.map(k => `%${k}%`);

    try {
      const data = await systemQuery<{ title: string; description: string; steps?: string[]; confidence?: number }>(
        `SELECT title, description, steps, confidence FROM shared_procedures WHERE ${conditions} LIMIT ${DEFAULT_MATCH_COUNT}`,
        params,
      );

      return data.map(row => ({
        source: 'procedure' as const,
        content: `${row.title}: ${row.description}${row.steps ? '\nSteps: ' + row.steps.join(' → ') : ''}`,
        score: row.confidence ?? 0.7,
      }));
    } catch {
      return [];
    }
  }

  /** Query company knowledge base by embedding similarity. */
  private async queryKnowledge(embeddingStr: string): Promise<JitContextItem[]> {
    try {
      const data = await systemQuery<{ title: string; content: string; section: string; similarity: number }>(
        'SELECT * FROM match_company_knowledge($1, $2, $3)',
        [embeddingStr, DEFAULT_MATCH_COUNT, DEFAULT_MATCH_THRESHOLD],
      );

      return data.map(row => ({
        source: 'knowledge' as const,
        content: `[${row.section}] ${row.title}: ${row.content}`,
        score: row.similarity,
      }));
    } catch {
      return [];
    }
  }

  /** Invalidate cached context for an agent. */
  async invalidateAgent(agentRole: string): Promise<void> {
    if (this.cache) {
      await this.cache.invalidatePattern(`jit:${agentRole}:*`);
    }
  }

  /** Hash a task string for cache key generation. */
  private hashTask(task: string): string {
    return createHash('sha256').update(task).digest('hex').slice(0, 12);
  }

  /** Rough token estimate (~4 chars per token). */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** Return an empty context object. */
  private emptyContext(): JitContext {
    return {
      relevantMemories: [],
      relevantGraphNodes: [],
      relevantEpisodes: [],
      relevantProcedures: [],
      relevantKnowledge: [],
      tokenEstimate: 0,
      fromCache: false,
    };
  }
}

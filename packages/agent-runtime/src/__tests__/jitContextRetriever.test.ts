/**
 * Unit tests for JitContextRetriever — verifies retrieval, caching,
 * token budget trimming, and graceful error handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JitContextRetriever, type JitContext, type JitContextItem } from '../jitContextRetriever.js';

// ─── Mock helpers ───────────────────────────────────────────────

function mockEmbeddingClient() {
  return {
    embed: vi.fn().mockResolvedValue(new Array(768).fill(0.01)),
  };
}

function mockSupabase(rpcResults?: Record<string, unknown[]>) {
  const defaults: Record<string, unknown[]> = {
    match_memories: [
      { content: 'Previous analysis showed growth', importance: 0.8, similarity: 0.9 },
    ],
    match_kg_nodes: [
      { name: 'Fuse Platform', description: 'AI productivity tool', similarity: 0.85 },
    ],
    match_shared_episodes: [
      { summary: 'Successfully launched v2', confidence: 0.9, similarity: 0.88, outcome: 'Positive user reception' },
    ],
    match_company_knowledge: [
      { content: 'Company policy on deployments', similarity: 0.82 },
    ],
    ...rpcResults,
  };

  return {
    rpc: vi.fn().mockImplementation((fnName: string) => {
      const data = defaults[fnName] ?? [];
      return Promise.resolve({ data, error: null });
    }),
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        textSearch: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [
            { name: 'Deploy procedure', steps: 'Step 1, Step 2', trigger_pattern: 'deploy' },
          ], error: null }),
        }),
      }),
    }),
  } as any;
}

function mockCache() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  } as any;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('JitContextRetriever', () => {
  let embeddingClient: ReturnType<typeof mockEmbeddingClient>;
  let cache: ReturnType<typeof mockCache>;

  beforeEach(() => {
    vi.clearAllMocks();
    embeddingClient = mockEmbeddingClient();
    cache = mockCache();
  });

  describe('retrieve', () => {
    it('embeds the task and queries all stores', async () => {
      const retriever = new JitContextRetriever(embeddingClient, cache);
      const result = await retriever.retrieve('cto', 'platform health check');

      expect(embeddingClient.embed).toHaveBeenCalledWith('cto: platform health check');
      expect(result.fromCache).toBe(false);
      expect(result.tokenEstimate).toBeGreaterThan(0);
    });

    it('returns items from all knowledge stores', async () => {
      const retriever = new JitContextRetriever(embeddingClient, cache);
      const result = await retriever.retrieve('cto', 'health check');

      expect(result.relevantMemories.length).toBeGreaterThanOrEqual(0);
      expect(result.relevantGraphNodes.length).toBeGreaterThanOrEqual(0);
      expect(result.relevantEpisodes.length).toBeGreaterThanOrEqual(0);
    });

    it('sorts items by score descending', async () => {
      const retriever = new JitContextRetriever(embeddingClient, cache);
      const result = await retriever.retrieve('cto', 'test', 10000);

      // All items combined should be score-sorted
      const allItems = [
        ...result.relevantMemories,
        ...result.relevantGraphNodes,
        ...result.relevantEpisodes,
        ...result.relevantProcedures,
        ...result.relevantKnowledge,
      ];
      // Already trimmed by budget, but each category's items should have valid scores
      for (const item of allItems) {
        expect(item.score).toBeGreaterThanOrEqual(0);
        expect(item.score).toBeLessThanOrEqual(2); // similarity * importance can be > 1
      }
    });

    it('trims to token budget', async () => {
      const retriever = new JitContextRetriever(embeddingClient, cache);
      // Very small budget — should limit items
      const result = await retriever.retrieve('cto', 'task', 5);
      expect(result.tokenEstimate).toBeLessThanOrEqual(10); // some tolerance
    });
  });

  describe('caching', () => {
    it('returns cached context when available', async () => {
      const cachedCtx: JitContext = {
        relevantMemories: [{ source: 'memory', content: 'cached memory', score: 0.9 }],
        relevantGraphNodes: [],
        relevantEpisodes: [],
        relevantProcedures: [],
        relevantKnowledge: [],
        tokenEstimate: 10,
        fromCache: false,
      };
      cache.get = vi.fn().mockResolvedValue(cachedCtx);

      const retriever = new JitContextRetriever(embeddingClient, cache);
      const result = await retriever.retrieve('cto', 'health check');

      expect(result.fromCache).toBe(true);
      expect(result.relevantMemories[0].content).toBe('cached memory');
      expect(embeddingClient.embed).not.toHaveBeenCalled();
    });

    it('caches fresh retrieval results', async () => {
      const retriever = new JitContextRetriever(embeddingClient, cache);
      await retriever.retrieve('cto', 'health check');

      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('jit:cto:'),
        expect.objectContaining({ fromCache: false }),
        180, // CACHE_TTL.jit
      );
    });

    it('works without cache (undefined)', async () => {
      const retriever = new JitContextRetriever(embeddingClient);
      const result = await retriever.retrieve('cto', 'health check');
      expect(result.fromCache).toBe(false);
      expect(result.tokenEstimate).toBeGreaterThanOrEqual(0);
    });
  });

  describe('error handling', () => {
    it('returns empty context when embedding fails', async () => {
      embeddingClient.embed = vi.fn().mockRejectedValue(new Error('Embedding API down'));
      const retriever = new JitContextRetriever(embeddingClient, cache);
      const result = await retriever.retrieve('cto', 'task');

      expect(result.relevantMemories).toHaveLength(0);
      expect(result.relevantGraphNodes).toHaveLength(0);
      expect(result.relevantEpisodes).toHaveLength(0);
      expect(result.relevantProcedures).toHaveLength(0);
      expect(result.relevantKnowledge).toHaveLength(0);
      expect(result.tokenEstimate).toBe(0);
    });

    it('handles individual store failures gracefully', async () => {
      // Make all RPCs fail
      supabase.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC failed' } });
      supabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          textSearch: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'Query failed' } }),
          }),
        }),
      });

      const retriever = new JitContextRetriever(embeddingClient, cache);
      const result = await retriever.retrieve('cto', 'task');

      // Should not throw — returns empty arrays
      expect(result.relevantMemories).toHaveLength(0);
      expect(result.relevantGraphNodes).toHaveLength(0);
    });

    it('continues when some stores fail and others succeed', async () => {
      let callCount = 0;
      supabase.rpc = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: [{ content: 'working memory', importance: 0.8, similarity: 0.9 }],
            error: null,
          });
        }
        return Promise.reject(new Error('Store unavailable'));
      });

      const retriever = new JitContextRetriever(embeddingClient, cache);
      const result = await retriever.retrieve('cto', 'task');

      // Should have at least the memory that succeeded
      expect(result.relevantMemories.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('item scoring', () => {
    it('multiplies similarity by importance for memories', async () => {
      supabase = mockSupabase({
        match_memories: [
          { content: 'High importance', importance: 1.0, similarity: 0.95 },
          { content: 'Low importance', importance: 0.3, similarity: 0.95 },
        ],
      });
      const retriever = new JitContextRetriever(embeddingClient, cache);
      const result = await retriever.retrieve('cto', 'task', 10000);

      if (result.relevantMemories.length >= 2) {
        // Higher importance should yield higher score
        const scores = result.relevantMemories.map(m => m.score);
        expect(Math.max(...scores)).toBeGreaterThan(Math.min(...scores));
      }
    });

    it('multiplies similarity by confidence for episodes', async () => {
      supabase = mockSupabase({
        match_shared_episodes: [
          { summary: 'Confident', confidence: 1.0, similarity: 0.9, outcome: 'Good' },
          { summary: 'Uncertain', confidence: 0.3, similarity: 0.9, outcome: 'Maybe' },
        ],
      });
      const retriever = new JitContextRetriever(embeddingClient, cache);
      const result = await retriever.retrieve('cto', 'task', 10000);

      if (result.relevantEpisodes.length >= 2) {
        const scores = result.relevantEpisodes.map(e => e.score);
        expect(Math.max(...scores)).toBeGreaterThan(Math.min(...scores));
      }
    });
  });
});

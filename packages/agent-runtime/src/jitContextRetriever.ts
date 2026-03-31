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
import { TemporalKnowledgeGraph } from './temporalKnowledgeGraph.js';

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
const MIN_FALLBACK_KEYWORDS = 2;
const TRANSFERABLE_SKILL_LIMIT = 3;
const TRANSFERABLE_REGEX_BUDGET = 2;
const TRANSFERABLE_SEMANTIC_BUDGET = 2;

const SOURCE_TOKEN_BUDGET_RATIO: Record<JitContextItem['source'], number> = {
  memory: 0.24,
  graph: 0.16,
  episode: 0.14,
  procedure: 0.30,
  knowledge: 0.16,
};

const TASK_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'your', 'have',
  'will', 'about', 'after', 'before', 'within', 'without', 'need', 'needs',
  'should', 'could', 'would', 'task', 'tasks', 'agent', 'run', 'runs',
]);

export class JitContextRetriever {
  constructor(
    private embeddingClient: EmbeddingClient,
    private cache?: RedisCache,
  ) {}

  private async getGlobalCachedItems(
    contentKey: string,
    factory: () => Promise<JitContextItem[]>,
  ): Promise<JitContextItem[]> {
    if (!this.cache) return factory();

    const cacheKey = CACHE_KEYS.global_extraction(contentKey);
    const cached = await this.cache.get<JitContextItem[]>(cacheKey);
    if (cached) return cached;

    const items = await factory();
    await this.cache.set(cacheKey, items, CACHE_TTL.globalExtraction);
    return items;
  }

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
    const queryHash = this.hashTask(task);

    // Query all stores in parallel
    const [memories, graphNodes, episodes, procedures, transferableSkills, knowledge] = await Promise.allSettled([
      this.queryMemories(embeddingStr, agentRole),
      this.queryGraphNodes(embeddingStr, agentRole, task),
      this.queryEpisodes(queryHash, embeddingStr),
      this.queryProcedures(queryHash, task),
      this.queryTransferableSkills(task, agentRole),
      this.queryKnowledge(queryHash, embeddingStr),
    ]);

    const relevantMemories = memories.status === 'fulfilled' ? memories.value : [];
    const relevantGraphNodes = graphNodes.status === 'fulfilled' ? graphNodes.value : [];
    const relevantEpisodes = episodes.status === 'fulfilled' ? episodes.value : [];
    const relevantProcedures = [
      ...(procedures.status === 'fulfilled' ? procedures.value : []),
      ...(transferableSkills.status === 'fulfilled' ? transferableSkills.value : []),
    ];
    const relevantKnowledge = knowledge.status === 'fulfilled' ? knowledge.value : [];

    // Combine all items and trim with source budgets so procedural skills
    // and semantic memory both retain representation.
    const allItems = [
      ...relevantMemories,
      ...relevantGraphNodes,
      ...relevantEpisodes,
      ...relevantProcedures,
      ...relevantKnowledge,
    ];

    const { items: trimmed, tokenCount } = this.trimItemsWithSourceBudgets(allItems, tokenBudget);

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
  private async queryGraphNodes(embeddingStr: string, agentRole: string, task: string): Promise<JitContextItem[]> {
    const [legacyGraph, temporalGraph] = await Promise.allSettled([
      this.queryLegacyGraphNodes(embeddingStr, agentRole),
      this.queryTemporalGraph(task, agentRole),
    ]);

    return [
      ...(legacyGraph.status === 'fulfilled' ? legacyGraph.value : []),
      ...(temporalGraph.status === 'fulfilled' ? temporalGraph.value : []),
    ].sort((left, right) => right.score - left.score);
  }

  private async queryLegacyGraphNodes(embeddingStr: string, agentRole: string): Promise<JitContextItem[]> {
    try {
      const data = await systemQuery<{ name: string; description: string; similarity: number }>(
        `WITH allowed_scope AS (
           SELECT
             CASE
               WHEN $4 = 'system' THEN ARRAY['*']::text[]
               ELSE COALESCE(
                 (SELECT knowledge_access_scope FROM company_agents WHERE role = $4 LIMIT 1),
                 ARRAY['general']::text[]
               )
             END AS scopes
         )
         SELECT
           n.title AS name,
           n.content AS description,
           (1 - (n.embedding <=> $1::vector))::DECIMAL AS similarity
         FROM kg_nodes n
         CROSS JOIN allowed_scope s
         WHERE n.status = 'active'
           AND n.embedding IS NOT NULL
           AND 1 - (n.embedding <=> $1::vector) > $3
           AND (
             $4 = 'system'
             OR COALESCE(NULLIF(n.metadata->>'category', ''), NULLIF(n.department, ''), 'general') = ANY(s.scopes)
             OR COALESCE(NULLIF(n.metadata->>'category', ''), NULLIF(n.department, ''), 'general') = 'general'
           )
         ORDER BY n.embedding <=> $1::vector
         LIMIT $2`,
        [embeddingStr, DEFAULT_MATCH_COUNT, DEFAULT_MATCH_THRESHOLD, agentRole],
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

  private async queryTemporalGraph(task: string, agentRole: string): Promise<JitContextItem[]> {
    try {
      const graph = new TemporalKnowledgeGraph(this.embeddingClient);
      const entities = await graph.semanticSearch(task, undefined, DEFAULT_MATCH_COUNT, agentRole);
      const items: JitContextItem[] = [];

      for (const entity of entities.slice(0, DEFAULT_MATCH_COUNT)) {
        const [facts, traversal] = await Promise.all([
          graph.getCurrentFacts(entity.id),
          graph.traverseGraph(entity.id, [], 2, agentRole),
        ]);

        const factLines = facts.slice(0, 5).map((fact) => {
          const value = typeof fact.factValue === 'string' ? fact.factValue : JSON.stringify(fact.factValue);
          return `- ${fact.factKey}: ${value}`;
        });
        const relatedLines = traversal.nodes
          .filter((node) => node.id !== entity.id)
          .slice(0, 6)
          .map((node) => `- depth ${node.depth}: ${node.name} (${node.entityType})${node.viaEdgeType ? ` via ${node.viaEdgeType}` : ''}`);
        const propertyText = Object.keys(entity.properties ?? {}).length > 0
          ? JSON.stringify(entity.properties)
          : '{}';

        items.push({
          source: 'graph' as const,
          score: entity.similarity,
          metadata: {
            temporal: true,
            entityId: entity.id,
            entityType: entity.entityType,
          },
          content: [
            `[temporal_entity] ${entity.name} (${entity.entityType}:${entity.entityId})`,
            `Properties: ${propertyText}`,
            factLines.length > 0 ? 'Current facts:' : 'Current facts: none',
            ...factLines,
            relatedLines.length > 0 ? 'Connected context:' : 'Connected context: none',
            ...relatedLines,
          ].join('\n'),
        });
      }

      return items;
    } catch {
      return [];
    }
  }

  /** Query shared episodes by embedding similarity. */
  private async queryEpisodes(queryHash: string, embeddingStr: string): Promise<JitContextItem[]> {
    return this.getGlobalCachedItems(`episodes:${queryHash}`, async () => {
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
    });
  }

  /** Query shared procedures by text similarity (keyword match). */
  private async queryProcedures(queryHash: string, task: string): Promise<JitContextItem[]> {
    // Use ilike for keyword matching on procedures (they may not have embeddings)
    const keywords = task.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
    if (keywords.length === 0) return [];

    const conditions = keywords.map((_, i) => `(title ILIKE $${i + 1} OR description ILIKE $${i + 1})`).join(' OR ');
    const params = keywords.map(k => `%${k}%`);

    return this.getGlobalCachedItems(`procedures:${queryHash}`, async () => {
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
    });
  }

  /** Query high-proficiency skills from other agents and inject them as reusable procedures. */
  private async queryTransferableSkills(task: string, agentRole: string): Promise<JitContextItem[]> {
    const keywords = this.extractTaskKeywords(task);
    const regexMatchedSlugs = await this.matchTaskSkillSlugs(task);
    const semanticFallbackSlugs = regexMatchedSlugs.length === 0 && keywords.length >= MIN_FALLBACK_KEYWORDS
      ? await this.matchTaskSkillSlugsSemantically(task, keywords, TRANSFERABLE_SEMANTIC_BUDGET)
      : [];

    const prioritizedSlugs = [
      ...regexMatchedSlugs.slice(0, TRANSFERABLE_REGEX_BUDGET),
      ...semanticFallbackSlugs.filter((slug) => !regexMatchedSlugs.includes(slug)),
    ].slice(0, TRANSFERABLE_SKILL_LIMIT);

    if (prioritizedSlugs.length === 0 && keywords.length === 0) return [];

    const regexSlugSet = new Set(regexMatchedSlugs);
    const semanticSlugSet = new Set(semanticFallbackSlugs);

    const keywordConditions = keywords
      .map((_, index) => `(s.name ILIKE $${index + 4} OR s.description ILIKE $${index + 4} OR s.methodology ILIKE $${index + 4})`)
      .join(' OR ');
    const keywordParams = keywords.map((keyword) => `%${keyword}%`);

    try {
      const data = await systemQuery<{
        slug: string;
        name: string;
        methodology: string;
        description: string;
        source_agent: string;
        proficiency: string;
        times_used: number;
        successes: number;
      }>(
        `WITH current_agent_skills AS (
           SELECT skill_id FROM agent_skills WHERE agent_role = $1
         )
         SELECT
           s.slug,
           s.name,
           s.methodology,
           s.description,
           ags.agent_role AS source_agent,
           ags.proficiency,
           ags.times_used,
           ags.successes
         FROM agent_skills ags
         JOIN skills s ON s.id = ags.skill_id
         WHERE ags.agent_role != $1
           AND ags.proficiency = ANY($2::text[])
           AND ags.skill_id NOT IN (SELECT skill_id FROM current_agent_skills)
           AND (
             s.slug = ANY($3::text[])
             ${keywordConditions ? `OR ${keywordConditions}` : ''}
           )
         ORDER BY
           CASE ags.proficiency WHEN 'master' THEN 4 WHEN 'expert' THEN 3 WHEN 'competent' THEN 2 ELSE 1 END DESC,
           ags.successes DESC,
           ags.times_used DESC
         LIMIT ${TRANSFERABLE_SKILL_LIMIT}`,
        [
          agentRole,
          ['expert', 'master'],
          prioritizedSlugs,
          ...keywordParams,
        ],
      );

      return data.map((row) => ({
        source: 'procedure' as const,
        content: `Recommended procedure from ${row.source_agent} (${row.name}, ${row.proficiency}): ${row.description}\nMethodology: ${row.methodology}`,
        score: row.proficiency === 'master' ? 0.92 : 0.86,
        metadata: {
          skill_slug: row.slug,
          source_agent: row.source_agent,
          proficiency: row.proficiency,
          transfer_type: 'cross_agent_skill',
          transfer_match_source: regexSlugSet.has(row.slug)
            ? 'regex'
            : semanticSlugSet.has(row.slug)
              ? 'semantic'
              : 'keyword',
        },
      }));
    } catch {
      return [];
    }
  }

  /** Query company knowledge base by embedding similarity. */
  private async queryKnowledge(queryHash: string, embeddingStr: string): Promise<JitContextItem[]> {
    return this.getGlobalCachedItems(`knowledge:${queryHash}`, async () => {
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
    });
  }

  private async matchTaskSkillSlugs(task: string): Promise<string[]> {
    try {
      const mappings = await systemQuery<{ task_regex: string; skill_slug: string }>(
        'SELECT task_regex, skill_slug FROM task_skill_map',
        [],
      );

      const matches = new Set<string>();
      for (const mapping of mappings) {
        try {
          if (new RegExp(mapping.task_regex, 'i').test(task)) {
            matches.add(mapping.skill_slug);
          }
        } catch {
          // Ignore invalid regex rows instead of failing the whole retrieval.
        }
      }

      return [...matches];
    } catch {
      return [];
    }
  }

  private extractTaskKeywords(task: string): string[] {
    return Array.from(new Set(
      task
        .toLowerCase()
        .split(/\s+/)
        .map((word) => word.replace(/[^a-z0-9-]/g, ''))
        .filter((word) => word.length > 3 && !TASK_STOP_WORDS.has(word)),
    )).slice(0, 8);
  }

  private async matchTaskSkillSlugsSemantically(
    task: string,
    keywords: string[],
    maxCount: number,
  ): Promise<string[]> {
    if (keywords.length < MIN_FALLBACK_KEYWORDS) return [];

    try {
      const skills = await systemQuery<{ slug: string; name: string; description: string; methodology: string }>(
        'SELECT slug, name, description, methodology FROM skills',
        [],
      );

      const taskText = task.toLowerCase();
      const scored = skills
        .map((skill) => {
          const haystack = `${skill.slug} ${skill.name} ${skill.description ?? ''} ${skill.methodology ?? ''}`.toLowerCase();
          let score = 0;
          for (const keyword of keywords) {
            if (skill.slug.toLowerCase().includes(keyword)) score += 3;
            if (skill.name.toLowerCase().includes(keyword)) score += 2;
            if (haystack.includes(keyword)) score += 1;
          }
          if (taskText.includes(skill.slug.toLowerCase())) score += 2;
          return { slug: skill.slug, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, maxCount)
        .map((entry) => entry.slug);

      return scored;
    } catch {
      return [];
    }
  }

  private trimItemsWithSourceBudgets(
    items: JitContextItem[],
    tokenBudget: number,
  ): { items: JitContextItem[]; tokenCount: number } {
    if (items.length === 0 || tokenBudget <= 0) {
      return { items: [], tokenCount: 0 };
    }

    const bySource = new Map<JitContextItem['source'], JitContextItem[]>();
    for (const item of items) {
      const list = bySource.get(item.source) ?? [];
      list.push(item);
      bySource.set(item.source, list);
    }

    for (const [source, list] of bySource.entries()) {
      bySource.set(source, [...list].sort((a, b) => b.score - a.score));
    }

    const selected: JitContextItem[] = [];
    const selectedSet = new Set<JitContextItem>();
    let tokenCount = 0;

    for (const source of Object.keys(SOURCE_TOKEN_BUDGET_RATIO) as JitContextItem['source'][]) {
      const sourceItems = bySource.get(source) ?? [];
      if (sourceItems.length === 0) continue;

      const sourceBudget = Math.max(0, Math.floor(tokenBudget * SOURCE_TOKEN_BUDGET_RATIO[source]));
      let sourceTokenCount = 0;
      for (const item of sourceItems) {
        const itemTokens = this.estimateTokens(item.content);
        if (sourceTokenCount + itemTokens > sourceBudget) continue;
        if (tokenCount + itemTokens > tokenBudget) continue;
        selected.push(item);
        selectedSet.add(item);
        sourceTokenCount += itemTokens;
        tokenCount += itemTokens;
      }
    }

    const remaining = items
      .filter((item) => !selectedSet.has(item))
      .sort((a, b) => b.score - a.score);
    for (const item of remaining) {
      const itemTokens = this.estimateTokens(item.content);
      if (tokenCount + itemTokens > tokenBudget) continue;
      selected.push(item);
      tokenCount += itemTokens;
    }

    return {
      items: selected.sort((a, b) => b.score - a.score),
      tokenCount,
    };
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

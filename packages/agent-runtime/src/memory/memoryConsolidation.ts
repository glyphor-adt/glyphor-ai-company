/**
 * Memory Consolidation Pipeline — Background Memory Lifecycle Manager
 *
 * Inspired by Claude Code's auto-dream 4-stage consolidation:
 *
 *   Phase 1 – Orient:  Inventory current memories (count, types, ages)
 *   Phase 2 – Gather:  Fetch memories + reflections since last consolidation
 *   Phase 3 – Consolidate: LLM-driven merge of duplicates, resolve
 *                           contradictions, synthesize new learnings
 *   Phase 4 – Prune:   Remove low-value stale memories, enforce caps
 *
 * Adapted from Claude Code's file-based model to Glyphor's DB-backed
 * memory system (AgentMemory + AgentReflection stored in PostgreSQL).
 *
 * The pipeline operates through the AgentMemoryStore interface so it
 * works with any backing store implementation. Direct DB queries are
 * used only for bulk operations not on the store interface (delete,
 * bulk updates, counting).
 */

import { systemQuery } from '@glyphor/shared/db';
import { getTierModel } from '@glyphor/shared';
import type { CompanyAgentRole, AgentMemory, AgentReflection } from '../types.js';
import type { AgentMemoryStore } from '../companyAgentRunner.js';
import type { ModelClient } from '../modelClient.js';
import {
  tryAcquireConsolidationLock,
  releaseConsolidationLock,
  getLastConsolidatedAt,
  recordMemoryCountAtConsolidation,
} from './consolidationLock.js';

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

export interface ConsolidationConfig {
  /** Maximum memories per agent after pruning. Default: 100. */
  maxMemoriesPerAgent: number;
  /** Importance threshold below which stale memories are prunable. Default: 0.3. */
  pruneImportanceThreshold: number;
  /** Days after which a low-importance memory is considered stale. Default: 30. */
  staleDaysThreshold: number;
  /** Maximum memories to consolidate per LLM call. Default: 20. */
  consolidationBatchSize: number;
  /** Model to use for consolidation LLM calls. Default: tier 'fast'. */
  model: string;
}

const DEFAULT_CONFIG: ConsolidationConfig = {
  maxMemoriesPerAgent: 100,
  pruneImportanceThreshold: 0.3,
  staleDaysThreshold: 30,
  consolidationBatchSize: 20,
  model: getTierModel('fast'),
};

// ═══════════════════════════════════════════════════════════════════
// RESULT TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ConsolidationResult {
  role: CompanyAgentRole;
  success: boolean;
  /** Phase 1: memory inventory snapshot. */
  inventory: MemoryInventory;
  /** Phase 2: how many items were gathered for review. */
  gatheredMemories: number;
  gatheredReflections: number;
  /** Phase 3: consolidation stats. */
  merged: number;
  synthesized: number;
  contradictionsResolved: number;
  /** Phase 4: pruning stats. */
  pruned: number;
  /** Total memories remaining after all phases. */
  remainingCount: number;
  /** Wall-clock duration in ms. */
  durationMs: number;
  error?: string;
}

export interface MemoryInventory {
  total: number;
  byType: Record<string, number>;
  avgImportance: number;
  oldestDaysAgo: number;
  newestDaysAgo: number;
}

// ═══════════════════════════════════════════════════════════════════
// LLM PROMPT
// ═══════════════════════════════════════════════════════════════════

function buildConsolidationPrompt(
  role: CompanyAgentRole,
  memories: AgentMemory[],
  reflections: AgentReflection[],
  inventory: MemoryInventory,
): string {
  const memoryBlock = memories
    .map((m, i) => `[${i}] id=${m.id} type=${m.memoryType} importance=${m.importance} age=${daysSince(m.createdAt)}d\n    ${m.content}`)
    .join('\n');

  const reflectionBlock = reflections
    .slice(0, 5)
    .map(r => `• [q=${r.qualityScore}] ${r.summary}\n  Improve: ${r.whatCouldImprove.slice(0, 2).join('; ')}`)
    .join('\n');

  return `You are a memory librarian for the "${role}" agent in the Glyphor platform.

## Current Inventory
Total: ${inventory.total} memories | By type: ${JSON.stringify(inventory.byType)}
Avg importance: ${inventory.avgImportance.toFixed(2)} | Age range: ${inventory.newestDaysAgo}–${inventory.oldestDaysAgo} days

## Memories to Review
${memoryBlock}

## Recent Reflections (for context)
${reflectionBlock || '(none)'}

## Your Task
Review these memories and produce a JSON response (no markdown fencing):

{
  "merge_groups": [
    {
      "source_ids": ["id1", "id2"],
      "merged_content": "single merged memory text",
      "merged_type": "observation|learning|preference|fact",
      "merged_importance": 0.0-1.0,
      "reason": "why these were merged"
    }
  ],
  "synthesized": [
    {
      "content": "new insight derived from multiple memories",
      "type": "learning|fact",
      "importance": 0.0-1.0,
      "source_ids": ["ids that contributed"]
    }
  ],
  "contradictions_resolved": [
    {
      "keep_id": "id of the correct/newer memory",
      "remove_ids": ["ids of contradicted memories"],
      "reason": "brief explanation"
    }
  ],
  "prune_ids": ["ids of memories that are redundant, trivial, or fully captured elsewhere"],
  "prune_reasons": { "id": "reason" }
}

Rules:
- Merge memories that say the same thing in different words
- Synthesize cross-cutting patterns into new learnings
- When memories contradict, keep the most recent or highest-importance one
- Prune memories that are trivial, ephemeral task state, or already captured better in another memory
- Preserve ALL high-importance (>= 0.7) memories unless they're contradicted
- Be conservative — when uncertain, keep the memory`;
}

// ═══════════════════════════════════════════════════════════════════
// PIPELINE
// ═══════════════════════════════════════════════════════════════════

/**
 * Run the full 4-stage memory consolidation pipeline for a single agent role.
 *
 * This acquires a consolidation lock, runs all phases, and releases the lock.
 * If the lock cannot be acquired (another instance is consolidating), returns
 * immediately with `success: false`.
 *
 * @param role      - The agent role to consolidate
 * @param store     - Memory store for reading memories/reflections
 * @param modelClient - Model client for LLM consolidation calls
 * @param configOverrides - Optional config overrides
 */
export async function runConsolidation(
  role: CompanyAgentRole,
  store: AgentMemoryStore,
  modelClient: ModelClient,
  configOverrides?: Partial<ConsolidationConfig>,
): Promise<ConsolidationResult> {
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  const startMs = Date.now();

  const emptyResult = (error?: string): ConsolidationResult => ({
    role,
    success: false,
    inventory: { total: 0, byType: {}, avgImportance: 0, oldestDaysAgo: 0, newestDaysAgo: 0 },
    gatheredMemories: 0,
    gatheredReflections: 0,
    merged: 0,
    synthesized: 0,
    contradictionsResolved: 0,
    pruned: 0,
    remainingCount: 0,
    durationMs: Date.now() - startMs,
    error,
  });

  // ─── Acquire lock ──────────────────────────────────────────
  const lockToken = await tryAcquireConsolidationLock(role);
  if (!lockToken) {
    return emptyResult('Lock not acquired — another consolidation is running');
  }

  try {
    // ─── Phase 1: Orient ─────────────────────────────────────
    const inventory = await orientPhase(role, store);
    if (inventory.total === 0) {
      await releaseConsolidationLock(role, lockToken);
      return { ...emptyResult(), success: true, inventory, durationMs: Date.now() - startMs };
    }

    // ─── Phase 2: Gather ─────────────────────────────────────
    const lastAt = await getLastConsolidatedAt(role);
    const { memories, reflections } = await gatherPhase(role, store, lastAt, config);

    if (memories.length === 0) {
      await releaseConsolidationLock(role, lockToken);
      await recordMemoryCountAtConsolidation(role, inventory.total);
      return {
        ...emptyResult(),
        success: true,
        inventory,
        remainingCount: inventory.total,
        durationMs: Date.now() - startMs,
      };
    }

    // ─── Phase 3: Consolidate ────────────────────────────────
    const consolidation = await consolidatePhase(
      role, memories, reflections, inventory, modelClient, config,
    );

    // ─── Phase 4: Prune ──────────────────────────────────────
    const pruneCount = await prunePhase(role, store, inventory, config);

    // Get final count
    const finalMemories = await store.getMemories(role, { limit: 1 });
    const remainingCount = inventory.total
      - consolidation.removedIds.size
      - pruneCount
      + consolidation.synthesizedCount;

    // ─── Stamp completion ────────────────────────────────────
    await releaseConsolidationLock(role, lockToken);
    await recordMemoryCountAtConsolidation(role, Math.max(0, remainingCount));

    console.log(
      `[MemoryConsolidation] ${role}: merged=${consolidation.mergeCount} ` +
      `synthesized=${consolidation.synthesizedCount} contradictions=${consolidation.contradictionsResolved} ` +
      `pruned=${pruneCount} remaining≈${remainingCount} (${Date.now() - startMs}ms)`,
    );

    return {
      role,
      success: true,
      inventory,
      gatheredMemories: memories.length,
      gatheredReflections: reflections.length,
      merged: consolidation.mergeCount,
      synthesized: consolidation.synthesizedCount,
      contradictionsResolved: consolidation.contradictionsResolved,
      pruned: pruneCount,
      remainingCount: Math.max(0, remainingCount),
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    // Always release the lock, even on failure
    await releaseConsolidationLock(role, lockToken).catch(() => {});
    console.error(
      `[MemoryConsolidation] Pipeline failed for ${role}:`,
      (err as Error).message,
    );
    return emptyResult((err as Error).message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 1 — ORIENT
// ═══════════════════════════════════════════════════════════════════

async function orientPhase(
  role: CompanyAgentRole,
  store: AgentMemoryStore,
): Promise<MemoryInventory> {
  const allMemories = await store.getMemories(role, { limit: 500 });

  if (allMemories.length === 0) {
    return { total: 0, byType: {}, avgImportance: 0, oldestDaysAgo: 0, newestDaysAgo: 0 };
  }

  const byType: Record<string, number> = {};
  let importanceSum = 0;
  let oldestMs = Infinity;
  let newestMs = 0;

  for (const mem of allMemories) {
    byType[mem.memoryType] = (byType[mem.memoryType] ?? 0) + 1;
    importanceSum += mem.importance;
    const ts = new Date(mem.createdAt).getTime();
    if (ts < oldestMs) oldestMs = ts;
    if (ts > newestMs) newestMs = ts;
  }

  const now = Date.now();
  return {
    total: allMemories.length,
    byType,
    avgImportance: importanceSum / allMemories.length,
    oldestDaysAgo: Math.round((now - oldestMs) / 86_400_000),
    newestDaysAgo: Math.round((now - newestMs) / 86_400_000),
  };
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 2 — GATHER
// ═══════════════════════════════════════════════════════════════════

interface GatherResult {
  memories: AgentMemory[];
  reflections: AgentReflection[];
}

async function gatherPhase(
  role: CompanyAgentRole,
  store: AgentMemoryStore,
  lastConsolidatedAt: number,
  config: ConsolidationConfig,
): Promise<GatherResult> {
  // Fetch ALL memories for consolidation (we need the full picture)
  // but batch the LLM calls in consolidatePhase
  const allMemories = await store.getMemories(role, { limit: 500 });

  // If this is the first consolidation, only process recent + low-importance
  const sinceDate = lastConsolidatedAt > 0
    ? new Date(lastConsolidatedAt).toISOString()
    : null;

  // Gather memories that are candidates for consolidation:
  // 1. All memories created since last consolidation (new signal)
  // 2. Old low-importance memories (pruning candidates)
  // 3. Duplicate-looking memories (content overlap)
  const candidates = allMemories.filter(mem => {
    if (sinceDate && mem.createdAt > sinceDate) return true; // new
    if (mem.importance < config.pruneImportanceThreshold) return true; // low-value
    if (daysSince(mem.createdAt) > config.staleDaysThreshold) return true; // old
    return false;
  });

  // If very few candidates, include all memories for full review
  const memories = candidates.length < 5 ? allMemories : candidates;

  const reflections = await store.getReflections(role, 10);

  return { memories: memories.slice(0, 200), reflections };
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 3 — CONSOLIDATE (LLM-driven)
// ═══════════════════════════════════════════════════════════════════

interface ConsolidateResult {
  mergeCount: number;
  synthesizedCount: number;
  contradictionsResolved: number;
  removedIds: Set<string>;
}

async function consolidatePhase(
  role: CompanyAgentRole,
  memories: AgentMemory[],
  reflections: AgentReflection[],
  inventory: MemoryInventory,
  modelClient: ModelClient,
  config: ConsolidationConfig,
): Promise<ConsolidateResult> {
  const result: ConsolidateResult = {
    mergeCount: 0,
    synthesizedCount: 0,
    contradictionsResolved: 0,
    removedIds: new Set(),
  };

  // Process in batches to stay within context limits
  for (let i = 0; i < memories.length; i += config.consolidationBatchSize) {
    const batch = memories.slice(i, i + config.consolidationBatchSize);
    const prompt = buildConsolidationPrompt(role, batch, reflections, inventory);

    try {
      const response = await modelClient.generate({
        model: config.model,
        systemInstruction: 'You are a precise memory librarian. Respond with valid JSON only.',
        contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
        tools: [],
        temperature: 0.2,
        thinkingEnabled: false,
        metadata: {
          modelConfig: {
            model: config.model,
            routingRule: 'memory_consolidation',
            capabilities: ['structured_extraction'],
            reasoningEffort: 'low',
            verbosity: 'low',
          },
        },
      });

      if (!response.text) continue;

      const parsed = JSON.parse(
        response.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim(),
      );

      // Apply merge groups
      if (Array.isArray(parsed.merge_groups)) {
        for (const group of parsed.merge_groups) {
          if (!Array.isArray(group.source_ids) || group.source_ids.length < 2) continue;
          if (!group.merged_content) continue;

          // Keep the first source, update it with merged content
          const keepId = group.source_ids[0];
          const removeIds = group.source_ids.slice(1);

          await updateMemoryContent(
            keepId,
            group.merged_content,
            group.merged_type ?? 'learning',
            Math.max(0, Math.min(1, group.merged_importance ?? 0.5)),
          );

          for (const id of removeIds) {
            await deleteMemory(id);
            result.removedIds.add(id);
          }
          result.mergeCount++;
        }
      }

      // Apply synthesized memories
      if (Array.isArray(parsed.synthesized)) {
        for (const synth of parsed.synthesized.slice(0, 3)) {
          if (!synth.content) continue;
          try {
            await systemQuery(
              `INSERT INTO agent_memories
                 (id, agent_role, memory_type, content, importance, source_run_id, tags, created_at)
               VALUES (gen_random_uuid(), $1, $2, $3, $4, 'consolidation', $5, NOW())`,
              [
                role,
                synth.type ?? 'learning',
                synth.content,
                Math.max(0, Math.min(1, synth.importance ?? 0.6)),
                JSON.stringify(['consolidated', 'synthesized']),
              ],
            );
            result.synthesizedCount++;
          } catch {
            // Insertion failure is non-critical
          }
        }
      }

      // Apply contradiction resolutions
      if (Array.isArray(parsed.contradictions_resolved)) {
        for (const cr of parsed.contradictions_resolved) {
          if (!Array.isArray(cr.remove_ids)) continue;
          for (const id of cr.remove_ids) {
            await deleteMemory(id);
            result.removedIds.add(id);
          }
          result.contradictionsResolved++;
        }
      }

      // Apply prune recommendations
      if (Array.isArray(parsed.prune_ids)) {
        for (const id of parsed.prune_ids) {
          if (typeof id === 'string' && !result.removedIds.has(id)) {
            await deleteMemory(id);
            result.removedIds.add(id);
          }
        }
      }
    } catch (err) {
      console.warn(
        `[MemoryConsolidation] LLM batch ${i / config.consolidationBatchSize} ` +
        `failed for ${role}:`,
        (err as Error).message,
      );
      // Continue with next batch — partial consolidation is better than none
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 4 — PRUNE (rule-based, no LLM)
// ═══════════════════════════════════════════════════════════════════

async function prunePhase(
  role: CompanyAgentRole,
  store: AgentMemoryStore,
  inventory: MemoryInventory,
  config: ConsolidationConfig,
): Promise<number> {
  let pruned = 0;

  // 1. Delete expired memories (built-in TTL field)
  try {
    const expiredRows = await systemQuery<{ id: string }>(
      `DELETE FROM agent_memories
       WHERE agent_role = $1
         AND expires_at IS NOT NULL
         AND expires_at < NOW()
       RETURNING id`,
      [role],
    );
    pruned += expiredRows.length;
  } catch {
    // Table may not have expires_at column yet
  }

  // 2. Delete very old, low-importance memories
  try {
    const staleRows = await systemQuery<{ id: string }>(
      `DELETE FROM agent_memories
       WHERE agent_role = $1
         AND importance < $2
         AND created_at < NOW() - ($3::int * INTERVAL '1 day')
       RETURNING id`,
      [role, config.pruneImportanceThreshold, config.staleDaysThreshold * 2],
    );
    pruned += staleRows.length;
  } catch (err) {
    console.warn(`[MemoryConsolidation] Stale prune failed for ${role}:`, (err as Error).message);
  }

  // 3. Enforce per-agent memory cap (keep highest importance)
  try {
    const overflowRows = await systemQuery<{ id: string }>(
      `DELETE FROM agent_memories
       WHERE id IN (
         SELECT id FROM agent_memories
         WHERE agent_role = $1
         ORDER BY importance ASC, created_at ASC
         OFFSET $2
       )
       RETURNING id`,
      [role, config.maxMemoriesPerAgent],
    );
    pruned += overflowRows.length;
  } catch (err) {
    console.warn(`[MemoryConsolidation] Cap prune failed for ${role}:`, (err as Error).message);
  }

  return pruned;
}

// ═══════════════════════════════════════════════════════════════════
// DB HELPERS
// ═══════════════════════════════════════════════════════════════════

async function deleteMemory(id: string): Promise<void> {
  await systemQuery(
    `DELETE FROM agent_memories WHERE id = $1`,
    [id],
  ).catch(() => {});
}

async function updateMemoryContent(
  id: string,
  content: string,
  memoryType: string,
  importance: number,
): Promise<void> {
  await systemQuery(
    `UPDATE agent_memories
     SET content = $2, memory_type = $3, importance = $4, updated_at = NOW()
     WHERE id = $1`,
    [id, content, memoryType, importance],
  ).catch(() => {});
}

function daysSince(dateStr: string): number {
  return Math.round((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

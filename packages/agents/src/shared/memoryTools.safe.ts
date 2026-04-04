/**
 * Memory Tools — Migrated to buildTool() factory pattern
 *
 * Demonstrates how to convert existing ToolDefinition objects to use
 * the fail-closed buildTool() factory for explicit safety metadata.
 *
 * Before (raw ToolDefinition):
 *   { name: 'recall_memories', ..., execute: ... }
 *   → isReadOnly? isConcurrencySafe? rateLimit? Unknown. Defaults to unsafe.
 *
 * After (buildTool):
 *   buildTool({ name: 'recall_memories', isReadOnly: true, isConcurrencySafe: true, ... })
 *   → Explicit safety contract. ToolExecutor uses metadata for rate limits, timeouts.
 *
 * Migration guide:
 *   1. Import { buildTool } from '@glyphor/agent-runtime'
 *   2. Wrap each tool definition in buildTool({ ... })
 *   3. Add isReadOnly, isConcurrencySafe, isDestructive flags
 *   4. Optionally set rateLimit, timeoutMs, allowedRoles, deniedRoles
 *   5. Return SafeToolDefinition[] instead of ToolDefinition[]
 */

import type { ToolResult, MemoryType, CompanyAgentRole } from '@glyphor/agent-runtime';
import { buildTool } from '@glyphor/agent-runtime';
import type { SafeToolDefinition } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';

/**
 * Patterns that indicate an agent is saving a catastrophic narrative
 * based on its own prior (often hallucinated) assessments rather than
 * ground-truth tool results.
 */
const TOXIC_MEMORY_PATTERNS: RegExp[] = [
  /P0.*(?:blackout|collapse|total|critical)/i,
  /(?:management|comms?|communications?|telemetry)\s*blackout/i,
  /(?:total|complete)\s*(?:infrastructure|platform)\s*(?:collapse|failure|outage)/i,
  /Phantom\s*(?:Pipeline|Recovery)/i,
  /(?:trapped|stuck)\s*in.*hallucination/i,
  /CRITICAL\s*FAILURE.*hallucin/i,
  /(?:100%|all)\s*(?:user|users)\s*(?:dormancy|dormant|locked out)/i,
  /telemetry\s*(?:is\s*)?severed/i,
  /operational\s*deadlock/i,
  /Deployment\s*Deadlock/i,
  /Compute\s*Ghosting/i,
  /0\s*(?:active\s*)?(?:Cloud\s*Run\s*)?instances.*(?:critical|P0|outage|blackout)/i,
];

function isToxicMemory(content: string): boolean {
  return TOXIC_MEMORY_PATTERNS.some(p => p.test(content));
}

function normalizeSourceRunId(runId: string | undefined): string | undefined {
  if (!runId) return undefined;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidPattern.test(runId) ? runId : undefined;
}

// ═══════════════════════════════════════════════════════════════════
// MIGRATED TOOLS — using buildTool() factory
// ═══════════════════════════════════════════════════════════════════

export function createMemoryToolsSafe(memory: CompanyMemoryStore): SafeToolDefinition[] {
  return [
    // ── save_memory: WRITE tool, NOT concurrency-safe ──
    buildTool({
      name: 'save_memory',
      description:
        'Save a memory that will persist across runs. Use for important observations, ' +
        'learnings, and facts you want to remember. Memories with unverified catastrophic ' +
        'claims will be rejected — only save what tools have confirmed.',
      parameters: {
        memory_type: {
          type: 'string',
          description: 'Type of memory',
          required: true,
          enum: ['observation', 'learning', 'preference', 'fact'],
        },
        content: {
          type: 'string',
          description: 'The memory content — what you learned or observed',
          required: true,
        },
        importance: {
          type: 'number',
          description: 'How important is this memory (0.0-1.0, where 1.0 is critical)',
          required: true,
        },
        tags: {
          type: 'array',
          description: 'Optional tags for categorization',
          required: false,
          items: { type: 'string', description: 'Tag' },
        },
      },
      // Explicit safety metadata
      isReadOnly: false,          // Writes to DB
      isConcurrencySafe: false,   // Memory writes should be serialized
      isDestructive: false,       // Append-only — doesn't delete data
      rateLimit: 30,              // 30 saves/hr per agent (prevent memory spam)
      timeoutMs: 10_000,          // 10s — simple DB write

      execute: async (params: Record<string, unknown>, ctx): Promise<ToolResult> => {
        if (!memory || typeof memory.saveMemory !== 'function') {
          return { success: false, error: 'Memory store is not configured' };
        }

        const content = typeof params.content === 'string' ? params.content : '';
        if (!content.trim()) {
          return { success: false, error: 'content is required' };
        }

        if (isToxicMemory(content)) {
          console.warn(`[MemoryGuard] Blocked toxic memory from ${ctx.agentRole}: ${content.slice(0, 80)}...`);
          return {
            success: false,
            error: 'Memory rejected: contains unverified catastrophic claims.',
          };
        }

        const id = await memory.saveMemory({
          agentRole: ctx.agentRole,
          memoryType: params.memory_type as MemoryType,
          content,
          importance: Math.max(0, Math.min(1, params.importance as number)),
          sourceRunId: normalizeSourceRunId(ctx.runId ?? ctx.assignmentId ?? ctx.agentId),
          tags: (params.tags as string[]) ?? undefined,
        });
        return { success: true, data: { memoryId: id }, memoryKeysWritten: 1 };
      },
    }),

    // ── recall_memories: READ-ONLY, concurrency-safe ──
    buildTool({
      name: 'recall_memories',
      description: 'Recall your past memories. Use to check what you have learned or observed before.',
      parameters: {
        memory_type: {
          type: 'string',
          description: 'Filter by memory type (optional)',
          required: false,
          enum: ['observation', 'learning', 'preference', 'fact'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of memories to retrieve (default: 10)',
          required: false,
        },
      },
      // Explicit safety metadata
      isReadOnly: true,            // Pure read — no mutations
      isConcurrencySafe: true,     // Safe to run in parallel
      rateLimit: 120,              // Generous for reads

      execute: async (params: Record<string, unknown>, ctx): Promise<ToolResult> => {
        if (!memory || typeof memory.getMemories !== 'function') {
          return { success: false, error: 'Memory store is not configured' };
        }
        const memories = await memory.getMemories(ctx.agentRole, {
          limit: (params.limit as number) ?? 10,
          memoryType: params.memory_type as MemoryType | undefined,
        });
        return { success: true, data: memories };
      },
    }),

    // ── search_memories: READ-ONLY, concurrency-safe ──
    buildTool({
      name: 'search_memories',
      description: 'Search your past memories by text query. Returns matching memories ordered by relevance.',
      parameters: {
        query: {
          type: 'string',
          description: 'Text to search for in memory content',
          required: true,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of matches to return (default: 10)',
          required: false,
        },
      },
      isReadOnly: true,
      isConcurrencySafe: true,
      rateLimit: 60,
      timeoutMs: 15_000,           // Vector search can be slower

      execute: async (params: Record<string, unknown>, ctx): Promise<ToolResult> => {
        if (!memory || typeof memory.getMemories !== 'function') {
          return { success: false, error: 'Memory store is not configured' };
        }
        const query = String(params.query ?? '').trim();
        if (!query) {
          return { success: false, error: 'query is required' };
        }
        const limit = (params.limit as number) ?? 10;
        const nativeSearch = (memory as any).searchMemories;
        if (typeof nativeSearch === 'function') {
          const matches = await nativeSearch(ctx.agentRole, query, { limit });
          return { success: true, data: matches ?? [] };
        }
        // Fallback: load all and filter client-side
        const all = await memory.getMemories(ctx.agentRole, { limit: 100 });
        const lowerQuery = query.toLowerCase();
        const filtered = all
          .filter((m: any) => (m.content ?? '').toLowerCase().includes(lowerQuery))
          .slice(0, limit);
        return { success: true, data: filtered };
      },
    }),
  ];
}

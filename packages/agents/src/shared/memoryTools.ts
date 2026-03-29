/**
 * Shared Memory Tools — Available to all agents
 *
 * Provides save_memory and recall_memories tools that persist
 * agent-specific memories via AgentMemoryStore.
 */

import type { ToolDefinition, ToolResult, CompanyAgentRole, MemoryType } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';

/**
 * Patterns that indicate an agent is saving a catastrophic narrative
 * based on its own prior (often hallucinated) assessments rather than
 * ground-truth tool results. These create self-reinforcing feedback
 * loops via JIT context retrieval.
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

export function createMemoryTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'save_memory',
      description: 'Save a memory that will persist across runs. Use for important observations, learnings, and facts you want to remember. Memories with unverified catastrophic claims (P0 blackouts, total collapses, etc.) will be rejected — only save what tools have confirmed.',
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
      execute: async (params, ctx): Promise<ToolResult> => {
        if (!memory || typeof memory.saveMemory !== 'function') {
          return { success: false, error: 'Memory store is not configured' };
        }

        const content = typeof params.content === 'string' ? params.content : '';
        if (!content.trim()) {
          return { success: false, error: 'content is required' };
        }

        // Block catastrophic narrative memories that create feedback loops
        if (isToxicMemory(content)) {
          console.warn(`[MemoryGuard] Blocked toxic memory from ${ctx.agentRole}: ${content.slice(0, 80)}...`);
          return {
            success: false,
            error: 'Memory rejected: contains unverified catastrophic claims. Only save observations confirmed by tool results, not narrative escalations.',
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
    },

    {
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
      execute: async (params, ctx): Promise<ToolResult> => {
        if (!memory || typeof memory.getMemories !== 'function') {
          return { success: false, error: 'Memory store is not configured' };
        }
        const memories = await memory.getMemories(ctx.agentRole, {
          limit: (params.limit as number) ?? 10,
          memoryType: params.memory_type as MemoryType | undefined,
        });
        return { success: true, data: memories };
      },
    },

    {
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
      execute: async (params, ctx): Promise<ToolResult> => {
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

        const memories = await memory.getMemories(ctx.agentRole, { limit: Math.max(limit, 50) });
        const q = query.toLowerCase();
        const matches = (memories ?? [])
          .filter((m: any) => String(m?.content ?? '').toLowerCase().includes(q))
          .slice(0, limit);

        return { success: true, data: matches };
      },
    },
  ];
}

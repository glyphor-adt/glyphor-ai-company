/**
 * Shared Memory Tools — Available to all agents
 *
 * Provides save_memory and recall_memories tools that persist
 * agent-specific memories via AgentMemoryStore.
 */

import type { ToolDefinition, ToolResult, CompanyAgentRole, MemoryType } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';

export function createMemoryTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'save_memory',
      description: 'Save a memory that will persist across runs. Use for important observations, learnings, and facts you want to remember.',
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
        const id = await memory.saveMemory({
          agentRole: ctx.agentRole,
          memoryType: params.memory_type as MemoryType,
          content: params.content as string,
          importance: Math.max(0, Math.min(1, params.importance as number)),
          sourceRunId: ctx.agentId,
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
        const memories = await memory.getMemories(ctx.agentRole, {
          limit: (params.limit as number) ?? 10,
          memoryType: params.memory_type as MemoryType | undefined,
        });
        return { success: true, data: memories };
      },
    },
  ];
}

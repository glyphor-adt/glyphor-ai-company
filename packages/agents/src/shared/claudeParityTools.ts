/**
 * Claude Code–parity helpers for executive agents (Marcus, Mia):
 * - run_todo_write — multi-step checklist (like TodoWrite)
 * - delegate_codebase_explore — async handoff to frontend/platform engineer (Explore-like)
 */

import type { GlyphorEventBus, ToolDefinition, ToolResult, ToolContext } from '@glyphor/agent-runtime';
import { buildTool } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { randomUUID } from 'node:crypto';
import { normalizeAssigneeRole } from './assigneeRouting.js';
import { queueAgentMessageWake } from './queueAgentMessageWake.js';

export interface RunTodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

const runTodoStore = new Map<string, RunTodoItem[]>();

function todoKey(ctx: ToolContext): string {
  return (ctx.runId ?? ctx.agentId ?? 'unknown').trim();
}

async function assertActiveRole(role: string): Promise<boolean> {
  const rows = await systemQuery<{ role: string }>(
    "SELECT role FROM company_agents WHERE status = 'active' AND role = $1 LIMIT 1",
    [role],
  );
  return rows.length > 0;
}

export function createClaudeParityTools(glyphorEventBus: GlyphorEventBus): ToolDefinition[] {
  const runTodoWrite = buildTool({
    name: 'run_todo_write',
    description:
      'Update a structured task list for this run (Claude Code–style todos). ' +
      'Use for multi-step implementation: mark items pending → in_progress → completed. ' +
      'Pass merge=true to upsert by id; merge=false replaces the whole list.',
    parameters: {
      merge: {
        type: 'boolean',
        description: 'If true, merge items by id with existing todos; if false, replace the list.',
        required: false,
      },
      todos: {
        type: 'string',
        description:
          'JSON array of { id, content, status } where status is pending | in_progress | completed',
        required: true,
      },
    },
    isReadOnly: false,
    isConcurrencySafe: false,
    execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
      const raw = String(params.todos ?? '').trim();
      if (!raw) {
        return { success: false, error: 'todos is required (JSON array)' };
      }
      let parsed: RunTodoItem[];
      try {
        parsed = JSON.parse(raw) as RunTodoItem[];
        if (!Array.isArray(parsed)) throw new Error('not an array');
      } catch {
        return { success: false, error: 'todos must be valid JSON array of { id, content, status }' };
      }
      for (const t of parsed) {
        if (!t.id || !t.content || !['pending', 'in_progress', 'completed'].includes(t.status)) {
          return {
            success: false,
            error: 'Each todo needs id, content, and status (pending|in_progress|completed)',
          };
        }
      }
      const key = todoKey(ctx);
      const merge = params.merge !== false;
      if (!merge) {
        runTodoStore.set(key, parsed);
      } else {
        const prev = runTodoStore.get(key) ?? [];
        const byId = new Map(prev.map((p) => [p.id, p]));
        for (const t of parsed) {
          byId.set(t.id, t);
        }
        runTodoStore.set(key, [...byId.values()]);
      }
      const list = runTodoStore.get(key) ?? [];
      return {
        success: true,
        data: {
          todos: list,
          total: list.length,
          completed: list.filter((x) => x.status === 'completed').length,
        },
      };
    },
  });

  const delegateCodebaseExplore = buildTool({
    name: 'delegate_codebase_explore',
    description:
      'Delegate a read-only codebase exploration to a specialist agent (Claude Code Explore–style). ' +
      'Queues a message to **platform-engineer** with your question. ' +
      'They will use their sandbox and tools on the next run. Use for large repo maps when you should not burn turns on grep yourself.',
    parameters: {
      query: {
        type: 'string',
        description: 'What to find or understand (e.g. "where is Cloud Run deploy configured?")',
        required: true,
      },
      thoroughness: {
        type: 'string',
        description: 'How deep the specialist should go',
        required: false,
        enum: ['quick', 'medium', 'very thorough'],
      },
      target_agent: {
        type: 'string',
        description: 'Specialist to wake',
        required: false,
        enum: ['platform-engineer'],
      },
      workspace_hint: {
        type: 'string',
        description: 'Which repo context to emphasize',
        required: false,
        enum: ['glyphor-ai-company', 'glyphor-site', 'both'],
      },
    },
    isReadOnly: false,
    isConcurrencySafe: false,
    timeoutMs: 45_000,
    execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
      const query = String(params.query ?? '').trim();
      if (!query) return { success: false, error: 'query is required' };

      const requested = 'platform-engineer';
      const toAgent = normalizeAssigneeRole(requested);
      if (toAgent === ctx.agentRole) {
        return { success: false, error: 'Cannot delegate to yourself' };
      }
      if (!(await assertActiveRole(toAgent))) {
        return { success: false, error: `Agent role not active: ${toAgent}` };
      }

      const thoroughness = (params.thoroughness as string) || 'medium';
      const workspaceHint = (params.workspace_hint as string) || 'both';

      const message = [
        `[CODEBASE_EXPLORE — delegated by ${ctx.agentRole}]`,
        `Thoroughness: ${thoroughness}`,
        `Workspace hint: ${workspaceHint}`,
        '',
        `Brief:`,
        query,
        '',
        'Instructions: Prefer read-only exploration (sandbox, grep, file reads). Report concrete paths and key symbols. Escalate blockers via send_agent_message.',
      ].join('\n');

      const threadId = randomUUID();
      const [row] = await systemQuery<{ id: string }>(
        'INSERT INTO agent_messages (from_agent, to_agent, thread_id, message, message_type, priority, status, context) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
        [
          ctx.agentRole,
          toAgent,
          threadId,
          message,
          'request',
          'urgent',
          'pending',
          { run_id: ctx.agentId, kind: 'delegate_codebase_explore' },
        ],
      );

      await glyphorEventBus.emit({
        type: 'message.sent',
        source: ctx.agentRole,
        payload: {
          message_id: row.id,
          to_agent: toAgent,
          message_type: 'request',
          priority: 'urgent',
          thread_id: threadId,
        },
        priority: 'high',
      });

      await queueAgentMessageWake({
        toAgent,
        fromAgent: ctx.agentRole,
        messageId: row.id,
        message,
        priority: 'urgent',
        threadId,
        messageType: 'request',
      });

      return {
        success: true,
        data: {
          message_id: row.id,
          to_agent: toAgent,
          note: `${toAgent} will be woken to explore the codebase read-only.`,
        },
      };
    },
  });

  return [runTodoWrite, delegateCodebaseExplore];
}

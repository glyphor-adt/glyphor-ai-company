/**
 * Shared Communication Tools — Inter-Agent Messaging & Meetings
 *
 * Tools:
 *   send_agent_message — Send a direct message to another agent
 *   check_messages     — Check for pending messages
 *   call_meeting       — Convene a multi-agent meeting
 */

import type { ToolDefinition, ToolResult, CompanyAgentRole } from '@glyphor/agent-runtime';
import type { GlyphorEventBus } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

/* ── Rate Limits ──────────────────────────── */

const MESSAGE_RATE_LIMIT = 5;         // Per agent per hour
const MEETING_RATE_PER_AGENT = 2;     // Per agent per day
const MESSAGE_RATE_WINDOW_MS = 60 * 60 * 1000;

const messageRateMap = new Map<string, number[]>();
const meetingRateMap = new Map<string, number[]>();

function checkMessageRate(agent: string): boolean {
  const now = Date.now();
  const timestamps = messageRateMap.get(agent) ?? [];
  const recent = timestamps.filter((t) => now - t < MESSAGE_RATE_WINDOW_MS);
  if (recent.length >= MESSAGE_RATE_LIMIT) return false;
  recent.push(now);
  messageRateMap.set(agent, recent);
  return true;
}

function checkMeetingRate(agent: string): boolean {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const timestamps = meetingRateMap.get(agent) ?? [];
  const recent = timestamps.filter((t) => now - t < dayMs);
  if (recent.length >= MEETING_RATE_PER_AGENT) return false;
  recent.push(now);
  meetingRateMap.set(agent, recent);
  return true;
}

/* ── Valid Agent Roles ────────────────────── */

const VALID_ROLES: CompanyAgentRole[] = [
  'chief-of-staff', 'cto', 'cpo', 'cmo', 'cfo',
  'vp-customer-success', 'vp-sales', 'vp-design',
  'platform-engineer', 'quality-engineer', 'devops-engineer',
  'user-researcher', 'competitive-intel', 'revenue-analyst',
  'cost-analyst', 'content-creator', 'seo-analyst',
  'social-media-manager', 'onboarding-specialist', 'support-triage',
  'account-research', 'ui-ux-designer', 'frontend-engineer',
  'design-critic', 'template-architect', 'ops',
];

/* ── Factory ──────────────────────────────── */

export function createCommunicationTools(
  glyphorEventBus: GlyphorEventBus,
  schedulerUrl?: string,
): ToolDefinition[] {
  return [
    /* ── send_agent_message ──────────────── */
    {
      name: 'send_agent_message',
      description:
        'Send a direct message to another agent. The recipient will see it on their next run, or be woken immediately if priority is urgent. Use for requesting information, delegating tasks, or sharing updates across departments.',
      parameters: {
        to_agent: {
          type: 'string',
          description: 'The recipient agent role slug',
          required: true,
          enum: VALID_ROLES as string[],
        },
        message: {
          type: 'string',
          description: 'The message content — be specific and actionable',
          required: true,
        },
        message_type: {
          type: 'string',
          description: 'Message type',
          required: false,
          enum: ['request', 'response', 'info', 'followup'],
        },
        priority: {
          type: 'string',
          description: 'Priority — use urgent sparingly (wakes recipient immediately)',
          required: false,
          enum: ['normal', 'urgent'],
        },
        thread_id: {
          type: 'string',
          description: 'Thread ID to continue an existing conversation (UUID)',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const toAgent = params.to_agent as string;
        const fromAgent = ctx.agentRole;

        if (toAgent === fromAgent) {
          return { success: false, error: 'Cannot send a message to yourself' };
        }
        if (!VALID_ROLES.includes(toAgent as CompanyAgentRole)) {
          return { success: false, error: `Unknown agent: ${toAgent}` };
        }
        if (!checkMessageRate(fromAgent)) {
          return { success: false, error: `Rate limit exceeded (${MESSAGE_RATE_LIMIT}/hr)` };
        }

        const threadId = (params.thread_id as string) || crypto.randomUUID();

        const messageType = (params.message_type as string) ?? 'info';
        const priority = (params.priority as string) ?? 'normal';

        const [row] = await systemQuery(
          'INSERT INTO agent_messages (from_agent, to_agent, thread_id, message, message_type, priority, status, context) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
          [fromAgent, toAgent, threadId, params.message as string, messageType, priority, 'pending', { run_id: ctx.agentId }],
        );

        // Emit event
        await glyphorEventBus.emit({
          type: 'message.sent',
          source: fromAgent,
          payload: {
            message_id: row.id,
            to_agent: toAgent,
            message_type: messageType,
            priority,
            thread_id: threadId,
          },
          priority: (params.priority as string) === 'urgent' ? 'high' : 'normal',
        });

        return {
          success: true,
          data: {
            messageId: row.id,
            threadId,
            delivered: true,
            note: (params.priority as string) === 'urgent'
              ? `Urgent message sent — ${toAgent} will be woken`
              : `Message queued — ${toAgent} will see it on their next run`,
          },
        };
      },
    },

    /* ── check_messages ──────────────────── */
    {
      name: 'check_messages',
      description:
        'Check for pending messages sent to you. Returns unread messages sorted by priority and time.',
      parameters: {
        include_read: {
          type: 'boolean',
          description: 'Include already-read messages (default: false)',
          required: false,
        },
        limit: {
          type: 'number',
          description: 'Max messages to return (default: 10)',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const includeRead = params.include_read === true;
        const limit = Math.min(50, Math.max(1, (params.limit as number) ?? 10));

        const conditions = [`to_agent = $1`];
        const params_q: unknown[] = [ctx.agentRole];
        if (!includeRead) {
          conditions.push(`status = $${params_q.length + 1}`);
          params_q.push('pending');
        }

        const data = await systemQuery(
          `SELECT * FROM agent_messages WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${params_q.length + 1}`,
          [...params_q, limit],
        );

        const messages = (data ?? []).map((m: Record<string, unknown>) => ({
          id: m.id,
          from: m.from_agent,
          message: m.message,
          type: m.message_type,
          priority: m.priority,
          thread_id: m.thread_id,
          sent_at: m.created_at,
          status: m.status,
        }));

        // Mark retrieved messages as read
        const pendingIds = (data ?? [])
          .filter((m: Record<string, unknown>) => m.status === 'pending')
          .map((m: Record<string, unknown>) => m.id as string);
        if (pendingIds.length > 0) {
          await systemQuery(
            'UPDATE agent_messages SET status = $1 WHERE id = ANY($2)',
            ['read', pendingIds],
          );
        }

        return {
          success: true,
          data: {
            count: messages.length,
            unread: pendingIds.length,
            messages,
          },
        };
      },
    },

    /* ── call_meeting ────────────────────── */
    {
      name: 'call_meeting',
      description:
        'Convene a meeting with other agents. All attendees will contribute over multiple rounds, and Sarah (chief-of-staff) will synthesize action items. Max 5 attendees, 2-5 rounds. Use for cross-departmental decisions, incident response, or strategic planning.',
      parameters: {
        title: {
          type: 'string',
          description: 'Meeting title',
          required: true,
        },
        purpose: {
          type: 'string',
          description: 'What this meeting should accomplish',
          required: true,
        },
        attendees: {
          type: 'array',
          description: 'Agent roles to include (max 5)',
          required: true,
          items: {
            type: 'string',
            description: 'Agent role slug',
            enum: VALID_ROLES as string[],
          },
        },
        meeting_type: {
          type: 'string',
          description: 'Type of meeting',
          required: false,
          enum: ['discussion', 'review', 'planning', 'incident', 'standup'],
        },
        rounds: {
          type: 'number',
          description: 'Number of discussion rounds (2-5, default: 3)',
          required: false,
        },
        agenda: {
          type: 'array',
          description: 'Agenda items',
          required: false,
          items: {
            type: 'string',
            description: 'Agenda item',
          },
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const attendees = params.attendees as string[];

        if (attendees.length > 5) {
          return { success: false, error: 'Max 5 attendees per meeting' };
        }
        if (attendees.length < 2) {
          return { success: false, error: 'Need at least 2 attendees' };
        }
        if (!checkMeetingRate(ctx.agentRole)) {
          return { success: false, error: `Meeting rate limit exceeded (${MEETING_RATE_PER_AGENT}/day)` };
        }

        // Validate all attendees
        for (const a of attendees) {
          if (!VALID_ROLES.includes(a as CompanyAgentRole)) {
            return { success: false, error: `Unknown agent: ${a}` };
          }
        }

        // Call the meeting via scheduler API
        const url = schedulerUrl ?? 'http://localhost:8080';
        const response = await fetch(`${url}/meetings/call`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: params.title,
            purpose: params.purpose,
            calledBy: ctx.agentRole,
            attendees,
            meetingType: (params.meeting_type as string) ?? 'discussion',
            rounds: params.rounds as number | undefined,
            agenda: params.agenda as string[] | undefined,
          }),
        });

        if (!response.ok) {
          const err = await response.text();
          return { success: false, error: `Meeting request failed: ${err}` };
        }

        const result = await response.json() as { success: boolean; id: string };

        // Emit event
        await glyphorEventBus.emit({
          type: 'meeting.called',
          source: ctx.agentRole,
          payload: {
            meeting_id: result.id,
            title: params.title,
            attendees,
            meeting_type: (params.meeting_type as string) ?? 'discussion',
          },
          priority: 'normal',
        });

        return {
          success: true,
          data: {
            meetingId: result.id,
            status: 'scheduled',
            attendees,
            note: `Meeting "${params.title}" scheduled with ${attendees.length} attendees. Results will be available at /meetings/${result.id}`,
          },
        };
      },
    },
  ];
}

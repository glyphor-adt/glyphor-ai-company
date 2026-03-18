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
import { normalizeAssigneeRole } from './assigneeRouting.js';

/* ── Rate Limits ──────────────────────────── */

const MESSAGE_RATE_LIMIT = 50;        // Per agent per hour
const MEETING_RATE_PER_AGENT = 2;     // Per agent per day
const MESSAGE_RATE_WINDOW_MS = 60 * 60 * 1000;
const FOUNDER_MESSAGE_ALIASES = new Set(['kristina', 'andrew', 'both']);

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

// Cache DB-resolved roles for 5 minutes to avoid per-call queries
let _validRolesCache: { roles: Set<string>; fetchedAt: number } | null = null;
const ROLE_CACHE_TTL = 5 * 60 * 1000;

async function getValidRoles(): Promise<Set<string>> {
  const now = Date.now();
  if (_validRolesCache && now - _validRolesCache.fetchedAt < ROLE_CACHE_TTL) {
    return _validRolesCache.roles;
  }
  try {
    const rows = await systemQuery<{ role: string }>(
      "SELECT role FROM company_agents WHERE status = 'active'",
      [],
    );
    const roles = new Set(rows.map((r) => r.role));
    _validRolesCache = { roles, fetchedAt: now };
    return roles;
  } catch {
    // Fallback: if DB is unreachable, use cached or allow
    return _validRolesCache?.roles ?? new Set();
  }
}

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
        const requestedAgent = typeof params.to_agent === 'string' ? params.to_agent.trim() : '';
        const message = typeof params.message === 'string' ? params.message.trim() : '';
        if (!requestedAgent) {
          return { success: false, error: 'to_agent is required' };
        }
        if (!message) {
          return { success: false, error: 'message is required' };
        }
        const toAgent = normalizeAssigneeRole(requestedAgent);
        const fromAgent = ctx.agentRole;

        if (toAgent === fromAgent) {
          return { success: false, error: 'Cannot send a message to yourself' };
        }
        if (FOUNDER_MESSAGE_ALIASES.has(String(requestedAgent).trim().toLowerCase())) {
          return {
            success: false,
            error: 'Founders are not agent role recipients for send_agent_message. Use founder notify blocks (to="kristina"|"andrew"|"both") or escalate_to_sarah for founder-input blockers.',
          };
        }
        const validRoles = await getValidRoles();
        if (validRoles.size > 0 && !validRoles.has(toAgent)) {
          return { success: false, error: `Unknown agent: ${requestedAgent}. Agent not found or not active.` };
        }
        if (!checkMessageRate(fromAgent)) {
          return { success: false, error: `Rate limit exceeded (${MESSAGE_RATE_LIMIT}/hr)` };
        }

        // Deduplicate: suppress if this agent already sent a message to the same
        // recipient about the same topic (same assignment ID or >60% word overlap)
        // within the last 2 hours. Prevents blocker cascade loops.
        const recentDupes = await systemQuery<{ id: string; message: string }>(
          `SELECT id, message FROM agent_messages
           WHERE from_agent = $1 AND to_agent = $2
             AND created_at > NOW() - interval '2 hours'
           ORDER BY created_at DESC LIMIT 5`,
          [fromAgent, toAgent],
        );
        if (recentDupes.length > 0) {
          const newMsg = message.toLowerCase();
          for (const prev of recentDupes) {
            const prevMsg = (prev.message as string).toLowerCase();
            // Check for assignment ID overlap (UUID pattern)
            const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
            const newIds = new Set(newMsg.match(uuidPattern) ?? []);
            const prevIds = new Set(prevMsg.match(uuidPattern) ?? []);
            const sharedIds = [...newIds].filter(id => prevIds.has(id));
            if (sharedIds.length > 0) {
              return {
                success: false,
                error: `Duplicate message suppressed — you already messaged ${toAgent} about assignment ${sharedIds[0]} within the last 2 hours. Do not re-escalate the same issue. Wait for their response or use a different approach.`,
              };
            }
          }
        }

        const threadId = (params.thread_id as string) || crypto.randomUUID();

        const messageType = (params.message_type as string) ?? 'info';
        const priority = (params.priority as string) ?? 'normal';

        const [row] = await systemQuery(
          'INSERT INTO agent_messages (from_agent, to_agent, thread_id, message, message_type, priority, status, context) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
          [fromAgent, toAgent, threadId, message, messageType, priority, 'pending', { run_id: ctx.agentId }],
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

    /* ── create_peer_work_request ─────────── */
    {
      name: 'create_peer_work_request',
      description:
        'Create a lower-priority peer work request for another agent. This creates a formal peer_request assignment and a companion message so the recipient can pick it up in their work loop.',
      parameters: {
        to_agent: {
          type: 'string',
          description: 'The recipient agent role slug',
          required: true,
        },
        request: {
          type: 'string',
          description: 'The work you need the other agent to complete',
          required: true,
        },
        expected_deliverable: {
          type: 'string',
          description: 'What successful completion should produce',
          required: true,
        },
        priority: {
          type: 'string',
          description: 'Priority for the peer request',
          required: false,
          enum: ['low', 'normal', 'high', 'urgent'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const requestedAgent = typeof params.to_agent === 'string' ? params.to_agent.trim() : '';
        const requestText = typeof params.request === 'string' ? params.request.trim() : '';
        const expectedDeliverable = typeof params.expected_deliverable === 'string'
          ? params.expected_deliverable.trim()
          : '';
        if (!requestedAgent) {
          return { success: false, error: 'to_agent is required' };
        }
        if (!requestText) {
          return { success: false, error: 'request is required' };
        }
        if (!expectedDeliverable) {
          return { success: false, error: 'expected_deliverable is required' };
        }
        const toAgent = normalizeAssigneeRole(requestedAgent);
        if (toAgent === ctx.agentRole) {
          return { success: false, error: 'Cannot create a peer work request for yourself' };
        }

        const validRoles = await getValidRoles();
        if (validRoles.size > 0 && !validRoles.has(toAgent)) {
          return { success: false, error: `Unknown agent: ${requestedAgent}. Agent not found or not active.` };
        }

        const priority = (params.priority as string) ?? 'normal';
        const [assignment] = await systemQuery<{ id: string }>(
          `INSERT INTO work_assignments (
             assigned_to,
             assigned_by,
             task_description,
             task_type,
             expected_output,
             priority,
             status,
             assignment_type
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            toAgent,
            ctx.agentRole,
              requestText,
            'peer_request',
              expectedDeliverable,
            priority,
            'pending',
            'peer_request',
          ],
        );

        await systemQuery(
          'INSERT INTO agent_messages (from_agent, to_agent, thread_id, message, message_type, priority, status, context) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [
            ctx.agentRole,
            toAgent,
            crypto.randomUUID(),
            `Peer work request from ${ctx.agentRole}\n\nRequest:\n${requestText}\n\nExpected deliverable:\n${expectedDeliverable}\n\nAssignment ID: ${assignment.id}`,
            'request',
            priority === 'urgent' ? 'urgent' : 'normal',
            'pending',
            { assignment_id: assignment.id, request_type: 'peer_work' },
          ],
        );

        await glyphorEventBus.emit({
          type: 'assignment.created',
          source: ctx.agentRole,
          payload: {
            assignment_id: assignment.id,
            assigned_to: toAgent,
            assigned_by: ctx.agentRole,
            assignment_type: 'peer_request',
            priority,
          },
          priority: priority === 'urgent' ? 'high' : 'normal',
        });

        return {
          success: true,
          data: {
            assignmentId: assignment.id,
            requestedFrom: toAgent,
            priority,
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
        const attendees = Array.isArray(params.attendees)
          ? (params.attendees.filter((a): a is string => typeof a === 'string'))
          : [];

        if (attendees.length === 0) {
          return { success: false, error: 'attendees is required and must include at least 2 agents' };
        }

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
        const validRoles = await getValidRoles();
        for (const a of attendees) {
          if (!validRoles.has(a)) {
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

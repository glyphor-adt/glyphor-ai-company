/**
 * Peer Coordination Tools — Cross-Executive Collaboration
 *
 * Tools for executive agents to coordinate with peer executives:
 *   request_peer_work   — Formal cross-domain work request
 *   create_handoff      — Multi-team project coordination
 *   peer_data_request   — Lightweight info exchange via DM
 *
 * Peer coordination avoids routing through Sarah for lateral requests.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import type { GlyphorEventBus } from '@glyphor/agent-runtime';
import { assertWorkAssignmentDispatchAllowed } from '@glyphor/shared';
import { systemQuery } from '@glyphor/shared/db';
import { normalizeAssigneeRole } from './assigneeRouting.js';

export function createPeerCoordinationTools(
  glyphorEventBus: GlyphorEventBus,
): ToolDefinition[] {
  return [
    /* ── request_peer_work ────────────────── */
    {
      name: 'request_peer_work',
      description:
        'Request work from a peer executive\'s team. Creates a formal assignment of type "peer_request" ' +
        'assigned to the peer executive, who will decompose it for their team. ' +
        'Use this for cross-functional needs (e.g., CTO needs design assets from VP-Design).',
      parameters: {
        peer_role: {
          type: 'string',
          description: 'The executive peer to request work from (e.g., "vp-design", "cto", "cpo")',
          required: true,
        },
        request_description: {
          type: 'string',
          description: 'What you need from their team',
          required: true,
        },
        expected_deliverable: {
          type: 'string',
          description: 'What you expect to receive back',
          required: true,
        },
        context: {
          type: 'string',
          description: 'Why you need this and any relevant background',
          required: false,
        },
        priority: {
          type: 'string',
          description: 'Request priority',
          required: false,
          enum: ['urgent', 'high', 'normal', 'low'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const requestedPeerRole = typeof params.peer_role === 'string' ? params.peer_role.trim() : '';
        const requestDescription = typeof params.request_description === 'string'
          ? params.request_description.trim()
          : '';
        const expectedDeliverable = typeof params.expected_deliverable === 'string'
          ? params.expected_deliverable.trim()
          : '';
        if (!requestedPeerRole) {
          return { success: false, error: 'peer_role is required' };
        }
        if (!requestDescription) {
          return { success: false, error: 'request_description is required' };
        }
        if (!expectedDeliverable) {
          return { success: false, error: 'expected_deliverable is required' };
        }
        const peerRole = normalizeAssigneeRole(requestedPeerRole);
        const priority = (params.priority as string) || 'normal';

        try {
          // Validate: peer must be an executive (reports_to chief-of-staff)
          const [peer] = await systemQuery<{ role: string }>(
            "SELECT role FROM company_agents WHERE role = $1 AND reports_to = 'chief-of-staff' AND status = 'active'",
            [peerRole],
          );
          if (!peer) {
            return { success: false, error: `${requestedPeerRole} is not an active peer executive` };
          }
          if (peerRole === ctx.agentRole) {
            return { success: false, error: 'Cannot request work from yourself' };
          }

          const dup = await assertWorkAssignmentDispatchAllowed({
            taskDescription: requestDescription,
            assignedTo: peerRole,
          });
          if (!dup.ok) {
            return { success: false, error: dup.error };
          }

          // Create peer_request assignment
          const [assignment] = await systemQuery<{ id: string }>(
            `INSERT INTO work_assignments (assigned_to, assigned_by, task_description, task_type,
              expected_output, priority, status, assignment_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [
              peerRole, ctx.agentRole,
              requestDescription, 'peer_request',
              expectedDeliverable, priority,
              'pending', 'peer_request',
            ],
          );

          // Send inter-agent message with full context
          const contextStr = params.context ? `\n\n**Context:**\n${params.context}` : '';
          await systemQuery(
            'INSERT INTO agent_messages (from_agent, to_agent, message, message_type, priority, status) VALUES ($1,$2,$3,$4,$5,$6)',
            [
              ctx.agentRole, peerRole,
              `**Peer Work Request from ${ctx.agentRole}**\n\n` +
              `**Request:**\n${requestDescription}\n\n` +
              `**Expected Deliverable:**\n${expectedDeliverable}${contextStr}\n\n` +
              `Assignment ID: ${assignment.id}`,
              'task', priority === 'urgent' ? 'urgent' : 'normal', 'pending',
            ],
          );

          await glyphorEventBus.emit({
            type: 'assignment.created',
            source: ctx.agentRole,
            payload: {
              assignment_id: assignment.id,
              assigned_to: peerRole,
              assigned_by: ctx.agentRole,
              assignment_type: 'peer_request',
              priority,
            },
            priority: priority === 'urgent' ? 'high' : 'normal',
          });

          return {
            success: true,
            data: { assignment_id: assignment.id, requested_from: peerRole, priority },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── create_handoff ───────────────────── */
    {
      name: 'create_handoff',
      description:
        'Create a multi-team handoff for projects requiring coordination across multiple executive domains. ' +
        'Tracks deliverables, participants, and completion status.',
      parameters: {
        title: {
          type: 'string',
          description: 'Brief title for the handoff',
          required: true,
        },
        description: {
          type: 'string',
          description: 'What needs to be coordinated across teams',
          required: true,
        },
        participants: {
          type: 'array',
          description: 'Executive roles involved (e.g., ["cto", "cpo", "vp-design"])',
          required: true,
        },
        deliverables: {
          type: 'array',
          description: 'List of deliverables as objects with owner, description, and deadline fields',
          required: false,
        },
        directive_id: {
          type: 'string',
          description: 'Related founder directive (optional)',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          const participants = params.participants as string[];
          const deliverables = params.deliverables ?? [];

          const [handoff] = await systemQuery<{ id: string }>(
            `INSERT INTO handoffs (title, description, initiated_by, participants, deliverables, status, directive_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [
              params.title as string,
              params.description as string,
              ctx.agentRole,
              participants,
              JSON.stringify(deliverables),
              'open',
              (params.directive_id as string) ?? null,
            ],
          );

          // Notify all participants
          for (const participant of participants) {
            if (participant === ctx.agentRole) continue;
            await systemQuery(
              'INSERT INTO agent_messages (from_agent, to_agent, message, message_type, priority, status) VALUES ($1,$2,$3,$4,$5,$6)',
              [
                ctx.agentRole, participant,
                `**Cross-Team Handoff Created:** ${params.title}\n\n` +
                `${params.description}\n\n` +
                `**Participants:** ${participants.join(', ')}\n` +
                `**Handoff ID:** ${handoff.id}`,
                'notification', 'normal', 'pending',
              ],
            );
          }

          return {
            success: true,
            data: { handoff_id: handoff.id, participants, status: 'open' },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── peer_data_request ────────────────── */
    {
      name: 'peer_data_request',
      description:
        'Send a lightweight data or information request to a peer executive. ' +
        'Use for quick questions that don\'t require a formal assignment — just a DM.',
      parameters: {
        peer_role: {
          type: 'string',
          description: 'The executive to ask (e.g., "cfo", "cpo")',
          required: true,
        },
        question: {
          type: 'string',
          description: 'What information you need',
          required: true,
        },
        context: {
          type: 'string',
          description: 'Why you need this (helps them prioritize)',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const peerRole = params.peer_role as string;

        try {
          const contextStr = params.context ? `\n\n**Context:** ${params.context}` : '';
          await systemQuery(
            'INSERT INTO agent_messages (from_agent, to_agent, message, message_type, priority, status) VALUES ($1,$2,$3,$4,$5,$6)',
            [
              ctx.agentRole, peerRole,
              `**Info Request from ${ctx.agentRole}:**\n\n${params.question}${contextStr}`,
              'request', 'normal', 'pending',
            ],
          );

          return {
            success: true,
            data: { sent_to: peerRole, type: 'data_request' },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}

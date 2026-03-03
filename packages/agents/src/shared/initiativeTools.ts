/**
 * Initiative Tools — Self-Directed Work Generation
 *
 * Tool for executive agents to propose new initiatives during proactive work.
 * Sarah evaluates proposals and either creates directives or provides feedback.
 *
 *   propose_initiative — Propose a new initiative with justification and assignments
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import type { GlyphorEventBus } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createInitiativeTools(
  glyphorEventBus: GlyphorEventBus,
): ToolDefinition[] {
  return [
    {
      name: 'propose_initiative',
      description:
        'Propose a new initiative to Sarah Chen for evaluation. ' +
        'Use this when you identify a recurring problem, untapped opportunity, or systemic ' +
        'inefficiency that warrants a multi-agent project. Include data-backed justification ' +
        'from your recent runs. Sarah will evaluate and either create a directive or provide feedback.',
      parameters: {
        title: {
          type: 'string',
          description: 'Initiative name — concise and action-oriented',
          required: true,
        },
        justification: {
          type: 'string',
          description: 'Why this matters now, what data supports it, and what is the cost of inaction',
          required: true,
        },
        proposed_assignments: {
          type: 'string',
          description: 'JSON array of {agent_role, task_description} objects — suggested work breakdown',
          required: true,
        },
        expected_outcome: {
          type: 'string',
          description: 'What success looks like — measurable if possible',
          required: true,
        },
        priority: {
          type: 'string',
          description: 'Priority: critical, high, medium, or low',
          required: true,
        },
        estimated_days: {
          type: 'number',
          description: 'Estimated number of days to complete',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const { title, justification, proposed_assignments, expected_outcome, priority, estimated_days } = params;

        // Validate priority
        const validPriorities = ['critical', 'high', 'medium', 'low'];
        if (!validPriorities.includes(priority as string)) {
          return { success: false, error: `Invalid priority '${priority}'. Use: ${validPriorities.join(', ')}` };
        }

        // Parse and validate proposed_assignments
        let assignments: Array<{ agent_role: string; task_description: string }>;
        try {
          assignments = typeof proposed_assignments === 'string'
            ? JSON.parse(proposed_assignments as string)
            : proposed_assignments as Array<{ agent_role: string; task_description: string }>;
          if (!Array.isArray(assignments) || assignments.length === 0) {
            return { success: false, error: 'proposed_assignments must be a non-empty array of {agent_role, task_description}' };
          }
        } catch {
          return { success: false, error: 'proposed_assignments must be valid JSON array of {agent_role, task_description}' };
        }

        // Insert the initiative proposal
        const [row] = await systemQuery<{ id: string }>(
          `INSERT INTO proposed_initiatives (proposed_by, title, justification, proposed_assignments, expected_outcome, priority, estimated_days, tenant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            ctx.agentRole,
            title,
            justification,
            JSON.stringify(assignments),
            expected_outcome,
            priority,
            estimated_days ?? null,
            'glyphor',
          ],
        );

        // Notify Sarah via agent message
        await systemQuery(
          `INSERT INTO agent_messages (from_agent, to_agent, id, content, category, priority, status, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            ctx.agentRole,
            'chief-of-staff',
            (await import('crypto')).randomUUID(),
            `INITIATIVE PROPOSAL: ${title}\n\nJustification: ${justification}\n\nExpected Outcome: ${expected_outcome}\n\nProposed ${assignments.length} assignments across ${[...new Set(assignments.map(a => a.agent_role))].join(', ')}.\n\nPriority: ${priority}${estimated_days ? ` | Est. ${estimated_days} days` : ''}\n\nInitiative ID: ${row.id}`,
            'initiative',
            priority === 'critical' ? 'urgent' : 'normal',
            'pending',
            JSON.stringify({ initiative_id: row.id }),
          ],
        );

        // Emit event for wake rules
        await glyphorEventBus.emit({
          type: 'assignment.created',
          source: ctx.agentRole,
          payload: {
            title: `Initiative proposed: ${title}`,
            initiative_id: row.id,
            proposed_by: ctx.agentRole,
            priority,
          },
          priority: priority === 'critical' ? 'high' : 'normal',
        });

        return {
          success: true,
          data: `Initiative "${title}" proposed successfully (ID: ${row.id}). Sarah will evaluate it during her next orchestration cycle.`,
        };
      },
    },
  ];
}

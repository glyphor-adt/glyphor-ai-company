/**
 * Initiative Tools — Self-Directed Work Generation
 *
 * Executive agents use propose_initiative to send vetted opportunities to Sarah.
 * The stored payload supports both the legacy assignment-array format and the
 * richer schema needed for initiatives/directives activation.
 */

import { randomUUID } from 'node:crypto';
import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import type { GlyphorEventBus } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export interface ProposedInitiativeAssignment {
  agent_role: string;
  task_description: string;
}

export interface InitiativeDirectiveDraft {
  title: string;
  description: string;
  category?: string;
  target_agents?: string[];
  depends_on_directive?: number;
}

export interface InitiativeProposalContext {
  description?: string;
  doctrine_alignment?: string;
  owner_role?: string;
  success_criteria?: string[];
  dependencies?: string[];
  target_date?: string;
  initial_directives?: InitiativeDirectiveDraft[];
}

export interface InitiativeProposalPayload {
  assignments: ProposedInitiativeAssignment[];
  initiative_context?: InitiativeProposalContext;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDirectiveDrafts(value: unknown): InitiativeDirectiveDraft[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      title: String(item.title ?? '').trim(),
      description: String(item.description ?? '').trim(),
      category: typeof item.category === 'string' ? item.category.trim() : undefined,
      target_agents: normalizeStringArray(item.target_agents),
      depends_on_directive:
        typeof item.depends_on_directive === 'number'
          ? item.depends_on_directive
          : undefined,
    }))
    .filter((item) => item.title && item.description);
}

function normalizeProposalContext(value: unknown): InitiativeProposalContext | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const context: InitiativeProposalContext = {
    description: typeof raw.description === 'string' ? raw.description.trim() : undefined,
    doctrine_alignment:
      typeof raw.doctrine_alignment === 'string' ? raw.doctrine_alignment.trim() : undefined,
    owner_role: typeof raw.owner_role === 'string' ? raw.owner_role.trim() : undefined,
    success_criteria: normalizeStringArray(raw.success_criteria),
    dependencies: normalizeStringArray(raw.dependencies),
    target_date: typeof raw.target_date === 'string' ? raw.target_date.trim() : undefined,
    initial_directives: normalizeDirectiveDrafts(raw.initial_directives),
  };

  if (
    !context.description &&
    !context.doctrine_alignment &&
    !context.owner_role &&
    !(context.success_criteria?.length) &&
    !(context.dependencies?.length) &&
    !context.target_date &&
    !(context.initial_directives?.length)
  ) {
    return undefined;
  }

  return context;
}

export function parseInitiativeProposalPayload(raw: unknown): InitiativeProposalPayload {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

  if (Array.isArray(parsed)) {
    return {
      assignments: parsed.filter(
        (item): item is ProposedInitiativeAssignment =>
          !!item &&
          typeof item === 'object' &&
          typeof (item as Record<string, unknown>).agent_role === 'string' &&
          typeof (item as Record<string, unknown>).task_description === 'string',
      ),
    };
  }

  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    const assignmentsSource = Array.isArray(record.assignments)
      ? record.assignments
      : Array.isArray(record.proposed_assignments)
        ? record.proposed_assignments
        : [];

    return {
      assignments: assignmentsSource.filter(
        (item): item is ProposedInitiativeAssignment =>
          !!item &&
          typeof item === 'object' &&
          typeof (item as Record<string, unknown>).agent_role === 'string' &&
          typeof (item as Record<string, unknown>).task_description === 'string',
      ),
      initiative_context: normalizeProposalContext(
        record.initiative_context ?? record.context ?? record.metadata,
      ),
    };
  }

  return { assignments: [] };
}

function buildProposalPayload(
  assignments: ProposedInitiativeAssignment[],
  context?: InitiativeProposalContext,
): InitiativeProposalPayload {
  const normalizedContext = normalizeProposalContext(context);
  return normalizedContext
    ? { assignments, initiative_context: normalizedContext }
    : { assignments };
}

export function createInitiativeTools(
  glyphorEventBus?: GlyphorEventBus,
): ToolDefinition[] {
  return [
    {
      name: 'propose_initiative',
      description:
        'Propose a new initiative to Sarah Chen for evaluation. ' +
        'Use this when you identify a recurring problem, untapped opportunity, or systemic ' +
        'inefficiency that warrants a multi-agent project. Include data-backed justification ' +
        'and, when available, initiative context aligned to the new initiatives schema.',
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
        description: {
          type: 'string',
          description: 'Optional richer initiative description for later activation into the initiatives table',
          required: false,
        },
        doctrine_alignment: {
          type: 'string',
          description: 'Optional doctrine principle or operating objective this initiative supports',
          required: false,
        },
        owner_role: {
          type: 'string',
          description: 'Optional executive owner role for the eventual initiative record',
          required: false,
        },
        success_criteria: {
          type: 'array',
          description: 'Optional measurable outcomes for the eventual initiative record',
          required: false,
          items: { type: 'string', description: 'Success criterion' },
        },
        dependencies: {
          type: 'array',
          description: 'Optional dependency initiative IDs',
          required: false,
          items: { type: 'string', description: 'Initiative UUID' },
        },
        target_date: {
          type: 'string',
          description: 'Optional ISO date for the desired completion target',
          required: false,
        },
        initial_directives: {
          type: 'array',
          description: 'Optional founder-directive drafts Sarah can use when activating the initiative',
          required: false,
          items: {
            type: 'object',
            description: 'Draft founder directive to create after initiative approval',
            properties: {
              title: { type: 'string', description: 'Directive title' },
              description: { type: 'string', description: 'Directive description' },
              category: { type: 'string', description: 'Directive category' },
              target_agents: {
                type: 'array',
                description: 'Suggested target agent roles',
                items: { type: 'string', description: 'Agent role' },
              },
              depends_on_directive: {
                type: 'number',
                description: 'Optional index dependency on another draft directive',
              },
            },
          },
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const {
          title,
          justification,
          proposed_assignments,
          expected_outcome,
          priority,
          estimated_days,
        } = params;

        const validPriorities = ['critical', 'high', 'medium', 'low'];
        if (!validPriorities.includes(priority as string)) {
          return {
            success: false,
            error: `Invalid priority '${priority}'. Use: ${validPriorities.join(', ')}`,
          };
        }

        let parsedPayload: InitiativeProposalPayload;
        try {
          parsedPayload = parseInitiativeProposalPayload(proposed_assignments);
        } catch {
          return {
            success: false,
            error: 'proposed_assignments must be valid JSON array of {agent_role, task_description}',
          };
        }

        if (!parsedPayload.assignments.length) {
          return {
            success: false,
            error: 'proposed_assignments must be a non-empty array of {agent_role, task_description}',
          };
        }

        const proposalPayload = buildProposalPayload(parsedPayload.assignments, {
          description: params.description as string | undefined,
          doctrine_alignment: params.doctrine_alignment as string | undefined,
          owner_role: params.owner_role as string | undefined,
          success_criteria: params.success_criteria as string[] | undefined,
          dependencies: params.dependencies as string[] | undefined,
          target_date: params.target_date as string | undefined,
          initial_directives: params.initial_directives as InitiativeDirectiveDraft[] | undefined,
        });

        const [row] = await systemQuery<{ id: string }>(
          `INSERT INTO proposed_initiatives
             (proposed_by, title, justification, proposed_assignments, expected_outcome, priority, estimated_days, tenant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            ctx.agentRole,
            title,
            justification,
            JSON.stringify(proposalPayload),
            expected_outcome,
            priority,
            estimated_days ?? null,
            'glyphor',
          ],
        );

        const assignmentRoles = [...new Set(proposalPayload.assignments.map((a) => a.agent_role))];
        const contextLines: string[] = [];
        if (proposalPayload.initiative_context?.doctrine_alignment) {
          contextLines.push(`Doctrine alignment: ${proposalPayload.initiative_context.doctrine_alignment}`);
        }
        if (proposalPayload.initiative_context?.owner_role) {
          contextLines.push(`Suggested owner: ${proposalPayload.initiative_context.owner_role}`);
        }
        if (proposalPayload.initiative_context?.success_criteria?.length) {
          contextLines.push(
            `Success criteria: ${proposalPayload.initiative_context.success_criteria.join('; ')}`,
          );
        }

        await systemQuery(
          `INSERT INTO agent_messages
             (id, from_agent, to_agent, thread_id, message, message_type, priority, status, context)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
          [
            randomUUID(),
            ctx.agentRole,
            'chief-of-staff',
            randomUUID(),
            `INITIATIVE PROPOSAL: ${title}\n\n` +
              `Justification: ${justification}\n\n` +
              `Expected Outcome: ${expected_outcome}\n\n` +
              `Proposed ${proposalPayload.assignments.length} assignments across ${assignmentRoles.join(', ')}.\n` +
              `Priority: ${priority}${estimated_days ? ` | Est. ${estimated_days} days` : ''}` +
              `${contextLines.length ? `\n${contextLines.join('\n')}` : ''}\n\n` +
              `Initiative proposal ID: ${row.id}`,
            'request',
            priority === 'critical' ? 'urgent' : 'normal',
            'pending',
            JSON.stringify({
              category: 'initiative',
              proposal_id: row.id,
              expected_outcome,
              initiative_context: proposalPayload.initiative_context ?? null,
            }),
          ],
        );

        if (glyphorEventBus) {
          await glyphorEventBus.emit({
            type: 'assignment.created',
            source: ctx.agentRole,
            payload: {
              title: `Initiative proposed: ${title}`,
              proposal_id: row.id,
              proposed_by: ctx.agentRole,
              priority,
            },
            priority: priority === 'critical' ? 'high' : 'normal',
          });
        }

        return {
          success: true,
          data: `Initiative "${title}" proposed successfully (proposal ID: ${row.id}). Sarah will evaluate it during her next orchestration cycle.`,
        };
      },
    },
  ];
}

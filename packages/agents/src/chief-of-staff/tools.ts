/**
 * Chief of Staff — Tool Definitions
 *
 * Tools for: reading company state, generating briefings,
 * routing decisions, posting to Teams.
 */

import type { ToolDefinition, ToolContext, ToolResult, BriefingData, CompanyAgentRole, StructuredReflection, OrchestratorGrade } from '@glyphor/agent-runtime';
import {
  DEFAULT_HANDOFF_CONFIDENCE_THRESHOLD,
  buildDefaultExpectedOutputSchema,
  buildRequiredInputs,
  getActiveContractForTask,
  getRedisCache,
  invalidateGrantCache,
  issueContract,
} from '@glyphor/agent-runtime';
import { isKnownTool } from '@glyphor/agent-runtime';
import type { GlyphorEventBus } from '@glyphor/agent-runtime';
import { markOutcomeRevised, markOutcomeAccepted } from '@glyphor/agent-runtime';
import { assertBatchWorkAssignmentsDeduped, assertWorkAssignmentDispatchAllowed } from '@glyphor/shared';
import { systemQuery } from '@glyphor/shared/db';
import { CompanyMemoryStore, SharedMemoryLoader, WorldModelUpdater, EmbeddingClient } from '@glyphor/company-memory';
import type { KnowledgeGraphReader } from '@glyphor/company-memory';
import {
  sendTeamsWebhook,
  postCardToChannel,
  formatBriefingCard,
  formatDirectiveProposalCard,
  GraphTeamsClient,
  buildChannelMap,
  GraphCalendarClient,
  buildFounderDirectory,
  A365TeamsChatClient,
  type AdaptiveCard,
} from '@glyphor/integrations';
import {
  parseInitiativeProposalPayload,
  type InitiativeDirectiveDraft,
} from '../shared/initiativeTools.js';
import {
  normalizeAssigneeRole,
  resolveActiveAssigneeBatch,
  resolveAssigneeForWorkAssignment,
} from '../shared/assigneeRouting.js';
import { evaluateToolPermissionGate } from '../shared/toolPermissionPolicy.js';

const INITIATIVE_OWNER_CATEGORY: Record<string, string> = {
  cto: 'engineering',
  cpo: 'product',
  cmo: 'marketing',
  cfo: 'revenue',
  'vp-sales': 'sales',
  ops: 'operations',
  'vp-design': 'general',
  'vp-research': 'general',
};

function inferInitiativeCategory(ownerRole: string | null | undefined): string {
  if (!ownerRole) return 'general';
  return INITIATIVE_OWNER_CATEGORY[ownerRole] ?? 'general';
}

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDirectiveDraftArray(value: unknown): InitiativeDirectiveDraft[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is InitiativeDirectiveDraft => !!item && typeof item === 'object')
    .map((item) => ({
      title: String(item.title ?? '').trim(),
      description: String(item.description ?? '').trim(),
      category: typeof item.category === 'string' ? item.category.trim() : undefined,
      target_agents: normalizeTextArray(item.target_agents),
      depends_on_directive:
        typeof item.depends_on_directive === 'number' ? item.depends_on_directive : undefined,
    }))
    .filter((item) => item.title && item.description);
}

function parseDecisionData(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const DIRECTIVE_PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  urgent: 0,
  high: 1,
  medium: 2,
  normal: 2,
  low: 3,
};

function getDirectivePriorityRank(priority: string | null | undefined): number {
  if (!priority) return 99;
  return DIRECTIVE_PRIORITY_RANK[priority] ?? 99;
}

function truncateDeliverableReference(value: string | null | undefined, limit: number = 240): string {
  if (!value) return '';
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}…`;
}

function appendContextBlock(base: string | null | undefined, block: string | null): string {
  const normalizedBase = (base ?? '').trim();
  if (!block) return normalizedBase;
  return normalizedBase ? `${normalizedBase}\n\n${block}` : block;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface DirectiveInitiativeContext {
  directive: any;
  initiative: any | null;
  prerequisite: any | null;
  completedDirectives: any[];
  deliverables: any[];
  deliverableContext: string | null;
  readyForAssignments: boolean;
  blockedReason?: string;
}

async function loadDirectiveInitiativeContext(
  directiveId: string,
): Promise<DirectiveInitiativeContext | null> {
  const [directive] = await systemQuery<any>(
    `SELECT fd.id, fd.title, fd.description, fd.status, fd.priority, fd.initiative_id, fd.source_directive_id,
            fd.source, fd.target_agents, i.title AS initiative_title, i.owner_role AS initiative_owner_role,
            i.status AS initiative_status, i.priority AS initiative_priority
     FROM founder_directives fd
     LEFT JOIN initiatives i ON i.id = fd.initiative_id
     WHERE fd.id = $1`,
    [directiveId],
  );

  if (!directive) return null;

  let prerequisite: any | null = null;
  if (directive.source_directive_id) {
    [prerequisite] = await systemQuery<any>(
      'SELECT id, title, status, completion_summary FROM founder_directives WHERE id = $1',
      [directive.source_directive_id],
    );
  }

  const readyForAssignments = !prerequisite || prerequisite.status === 'completed';
  const blockedReason =
    !readyForAssignments && prerequisite
      ? `Directive "${directive.title}" is waiting on prerequisite "${prerequisite.title}" (${prerequisite.id}) to complete.`
      : undefined;

  if (!directive.initiative_id) {
    return {
      directive,
      initiative: directive.initiative_id
        ? {
            id: directive.initiative_id,
            title: directive.initiative_title,
            owner_role: directive.initiative_owner_role,
            status: directive.initiative_status,
            priority: directive.initiative_priority,
          }
        : null,
      prerequisite,
      completedDirectives: [],
      deliverables: [],
      deliverableContext: null,
      readyForAssignments,
      blockedReason,
    };
  }

  const completedDirectives = await systemQuery<any>(
    `SELECT id, title, status, completion_summary, created_at
     FROM founder_directives
     WHERE initiative_id = $1
       AND id <> $2
       AND status = 'completed'
     ORDER BY created_at ASC`,
    [directive.initiative_id, directiveId],
  );

  const completedDirectiveIds = completedDirectives.map((item: any) => item.id);
  const deliverables = completedDirectiveIds.length > 0
    ? await systemQuery<any>(
        `SELECT d.id, d.title, d.type, d.content, d.storage_url, d.producing_agent, d.directive_id,
                d.created_at, fd.title AS directive_title
         FROM deliverables d
         LEFT JOIN founder_directives fd ON fd.id = d.directive_id
         WHERE d.initiative_id = $1
           AND d.status = 'published'
           AND (d.directive_id = ANY($2) OR d.directive_id IS NULL)
         ORDER BY
           CASE WHEN d.directive_id = $3 THEN 0 ELSE 1 END,
           d.created_at DESC
         LIMIT 12`,
        [directive.initiative_id, completedDirectiveIds, directive.source_directive_id ?? null],
      )
    : [];

  const deliverableContext = deliverables.length > 0
    ? [
        'AVAILABLE DELIVERABLES FROM PRIOR WORK:',
        ...deliverables.map((item: any) => {
          const reference = item.storage_url || truncateDeliverableReference(item.content);
          return `- ${item.title} (${item.type}, by ${item.producing_agent}${item.directive_title ? `, from "${item.directive_title}"` : ''}): ${reference || 'No inline reference recorded.'}`;
        }),
        'Use these deliverables as inputs. Do not recreate work that already exists.',
      ].join('\n')
    : null;

  return {
    directive,
    initiative: {
      id: directive.initiative_id,
      title: directive.initiative_title,
      owner_role: directive.initiative_owner_role,
      status: directive.initiative_status,
      priority: directive.initiative_priority,
    },
    prerequisite,
    completedDirectives,
    deliverables,
    deliverableContext,
    readyForAssignments,
    blockedReason,
  };
}

export function createChiefOfStaffTools(
  memory: CompanyMemoryStore,
  glyphorEventBus?: GlyphorEventBus,
): ToolDefinition[] {
  // Initialize Graph API client if Azure credentials are configured
  let graphClient: GraphTeamsClient | null = null;
  try {
    graphClient = GraphTeamsClient.fromEnv();
  } catch {
    // Graph API not configured — will fall back to webhooks
  }
  const channels = buildChannelMap();

  // Initialize A365 MCP client for DMs (Agent 365 is the primary DM path)
  const a365Client = A365TeamsChatClient.fromEnv('chief-of-staff');

  let calendarClient: GraphCalendarClient | null = null;
  if (graphClient) {
    calendarClient = GraphCalendarClient.fromEnv(graphClient);
  }
  const founderDir = buildFounderDirectory();
  const dashboardUrl = (process.env.DASHBOARD_URL || 'https://dashboard.glyphor.com').replace(/\/$/, '');

  const sendFounderBriefingDm = async (
    recipient: 'kristina' | 'andrew',
    markdown: string,
    metrics: BriefingData['metrics'],
    actionItems: string[],
  ): Promise<void> => {
    if (!a365Client) {
      throw new Error('Agent 365 Teams DM client not configured.');
    }

    const recipientContact = founderDir[recipient];
    const recipientUpn = recipientContact?.email
      ?? (recipient === 'kristina' ? 'kristina@glyphor.ai' : 'andrew@glyphor.ai');
    const chatId = await a365Client.createOrGetOneOnOneChat(recipientUpn, undefined, 'chief-of-staff');

    const metricLines = (metrics || []).slice(0, 4).map((metric) => `- ${metric.label}: ${metric.value}`);
    const actionLines = actionItems.map((item) => `- ${item}`);
    const message = [
      `Glyphor daily brief for ${capitalize(recipient)} — ${new Date().toLocaleDateString('en-US')}`,
      '',
      'Key metrics:',
      ...(metricLines.length > 0 ? metricLines : ['- No metrics attached']),
      '',
      markdown,
      ...(actionLines.length > 0 ? ['', 'Needs your attention:', ...actionLines] : []),
      '',
      `Open dashboard: ${dashboardUrl}`,
      `Operations: ${dashboardUrl}/operations`,
      `Ora: ${dashboardUrl}/ora`,
      `Directives: ${dashboardUrl}/directives`,
    ].join('\n');

    await a365Client.postChatMessage(chatId, message, 'chief-of-staff');
  };

  return [
    // ─── READ COMPANY STATE ─────────────────────────────────────

    {
      name: 'get_recent_activity',
      description: 'Get all agent activity from the last N hours. Returns a list of actions taken by all executive agents.',
      parameters: {
        hours: {
          type: 'number',
          description: 'Number of hours to look back (default: 24)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const hours = (params.hours as number) || 24;
        const activity = await memory.getRecentActivity(hours);
        return { success: true, data: activity, memoryKeysWritten: 0 };
      },
    },

    {
      name: 'get_pending_decisions',
      description: 'Get all pending decisions that need founder approval. Returns yellow and red tier items.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        const [yellow, red] = await Promise.all([
          memory.getDecisions({ tier: 'yellow', status: 'pending' }),
          memory.getDecisions({ tier: 'red', status: 'pending' }),
        ]);
        return { success: true, data: { yellow, red } };
      },
    },

    {
      name: 'read_proposed_initiatives',
      description: 'Read initiative proposals submitted by executives so you can evaluate, defer, reject, or elevate them into founder approval.',
      parameters: {
        status_filter: {
          type: 'string',
          description: 'Filter proposal status',
          required: false,
          enum: ['pending', 'approved', 'deferred', 'rejected', 'all'],
        },
        proposed_by: {
          type: 'string',
          description: 'Optional agent role filter',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const statusFilter = (params.status_filter as string | undefined) ?? 'pending';
        const proposedBy = params.proposed_by as string | undefined;
        const queryParams: unknown[] = [];
        const conditions: string[] = [];

        if (statusFilter !== 'all') {
          queryParams.push(statusFilter);
          conditions.push(`pi.status = $${queryParams.length}`);
        }

        if (proposedBy) {
          queryParams.push(proposedBy);
          conditions.push(`pi.proposed_by = $${queryParams.length}`);
        }

        const rows = await systemQuery(
          `SELECT
             pi.*,
             i.id AS initiative_id,
             i.status AS initiative_status,
             i.owner_role AS initiative_owner_role
           FROM proposed_initiatives pi
           LEFT JOIN initiatives i ON i.proposed_initiative_id = pi.id
           ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
           ORDER BY pi.created_at DESC`,
          queryParams,
        );

        const proposals = (rows as any[]).map((row) => {
          let parsed;
          try {
            parsed = parseInitiativeProposalPayload(row.proposed_assignments);
          } catch {
            parsed = { assignments: [] };
          }

          return {
            id: row.id,
            title: row.title,
            justification: row.justification,
            expected_outcome: row.expected_outcome,
            priority: row.priority,
            estimated_days: row.estimated_days,
            status: row.status,
            proposed_by: row.proposed_by,
            evaluation_notes: row.evaluation_notes,
            evaluated_by: row.evaluated_by,
            evaluated_at: row.evaluated_at,
            created_at: row.created_at,
            assignments: parsed.assignments,
            initiative_context: parsed.initiative_context ?? null,
            linked_initiative: row.initiative_id
              ? {
                  id: row.initiative_id,
                  status: row.initiative_status,
                  owner_role: row.initiative_owner_role,
                }
              : null,
          };
        });

        return { success: true, data: proposals };
      },
    },

    {
      name: 'propose_initiative',
      description: 'Create a founder-facing initiative proposal, store it in initiatives, and route approval through the existing decision queue.',
      parameters: {
        title: {
          type: 'string',
          description: 'Initiative title. If source_proposal_id is provided, defaults to that proposal title.',
          required: false,
        },
        description: {
          type: 'string',
          description: 'Detailed initiative description',
          required: false,
        },
        doctrine_alignment: {
          type: 'string',
          description: 'Doctrine principle or operating objective this initiative supports',
          required: false,
        },
        owner_role: {
          type: 'string',
          description: 'Executive role accountable for the initiative',
          required: false,
        },
        priority: {
          type: 'string',
          description: 'Priority level',
          required: false,
          enum: ['critical', 'high', 'medium', 'low'],
        },
        dependencies: {
          type: 'array',
          description: 'Dependency initiative IDs',
          required: false,
          items: { type: 'string', description: 'Initiative UUID' },
        },
        target_date: {
          type: 'string',
          description: 'Optional ISO target date',
          required: false,
        },
        success_criteria: {
          type: 'array',
          description: 'Measurable outcomes for approval and later evaluation',
          required: false,
          items: { type: 'string', description: 'Success criterion' },
        },
        reasoning: {
          type: 'string',
          description: 'Why this initiative should be approved now',
          required: true,
        },
        source_proposal_id: {
          type: 'string',
          description: 'Optional executive proposal UUID to elevate into founder approval',
          required: false,
        },
        initial_directives: {
          type: 'array',
          description: 'Optional draft directives to activate once founders approve the initiative',
          required: false,
          items: {
            type: 'object',
            description: 'Draft founder directive to create after approval',
            properties: {
              title: { type: 'string', description: 'Directive title' },
              description: { type: 'string', description: 'Directive description' },
              category: { type: 'string', description: 'Directive category' },
              target_agents: {
                type: 'array',
                description: 'Target agent roles for the directive',
                items: { type: 'string', description: 'Agent role' },
              },
              depends_on_directive: {
                type: 'number',
                description: 'Optional dependency on another draft directive index',
              },
            },
          },
        },
        assigned_to: {
          type: 'array',
          description: 'Founders who should approve this initiative. Defaults to ["kristina"].',
          required: false,
          items: { type: 'string', description: 'Founder name' },
        },
        approval_tier: {
          type: 'string',
          description: 'Decision tier for approval',
          required: false,
          enum: ['yellow', 'red'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const sourceProposalId = params.source_proposal_id as string | undefined;
        let sourceProposal: any | null = null;
        let sourcePayload: ReturnType<typeof parseInitiativeProposalPayload> = {
          assignments: [],
          initiative_context: undefined,
        };

        if (sourceProposalId) {
          const [proposal] = await systemQuery('SELECT * FROM proposed_initiatives WHERE id = $1', [sourceProposalId]);
          if (!proposal) {
            return { success: false, error: `Proposal ${sourceProposalId} not found.` };
          }
          sourceProposal = proposal;
          try {
            sourcePayload = parseInitiativeProposalPayload(proposal.proposed_assignments);
          } catch {
            sourcePayload = { assignments: [], initiative_context: undefined };
          }
        }

        const title =
          (params.title as string | undefined)?.trim() ||
          (sourceProposal?.title as string | undefined)?.trim();
        const description =
          (params.description as string | undefined)?.trim() ||
          sourcePayload.initiative_context?.description ||
          (sourceProposal?.justification as string | undefined)?.trim();
        const doctrineAlignment =
          (params.doctrine_alignment as string | undefined)?.trim() ||
          sourcePayload.initiative_context?.doctrine_alignment;
        const ownerRole =
          (params.owner_role as string | undefined)?.trim() ||
          sourcePayload.initiative_context?.owner_role ||
          (sourceProposal?.proposed_by as string | undefined)?.trim();
        const priority =
          ((params.priority as string | undefined) ||
            (sourceProposal?.priority as string | undefined) ||
            'medium').trim();
        const targetDate =
          (params.target_date as string | undefined)?.trim() ||
          sourcePayload.initiative_context?.target_date ||
          null;
        const successCriteria = normalizeTextArray(
          (params.success_criteria as string[] | undefined) ??
            sourcePayload.initiative_context?.success_criteria,
        );
        const dependencies = normalizeTextArray(
          (params.dependencies as string[] | undefined) ??
            sourcePayload.initiative_context?.dependencies,
        );
        const initialDirectives = normalizeDirectiveDraftArray(
          (params.initial_directives as InitiativeDirectiveDraft[] | undefined) ??
            sourcePayload.initiative_context?.initial_directives,
        );
        const assignedTo = normalizeTextArray(params.assigned_to as string[] | undefined);
        const finalAssignedTo = assignedTo.length ? assignedTo : ['kristina'];
        const approvalTier =
          ((params.approval_tier as string | undefined) ||
            (finalAssignedTo.length > 1 ? 'red' : 'yellow')) as 'yellow' | 'red';

        if (!title || !description || !doctrineAlignment || !ownerRole) {
          return {
            success: false,
            error: 'title, description, doctrine_alignment, and owner_role are required to create a founder-facing initiative proposal.',
          };
        }

        // Dedup guard: reject if a similar initiative already exists in proposed/active status
        const [existingInitiative] = await systemQuery<{ id: string; title: string; status: string; created_at: string }>(
          `SELECT id, title, status, created_at FROM initiatives
           WHERE status IN ('proposed', 'active') AND LOWER(title) = LOWER($1)
           ORDER BY created_at DESC LIMIT 1`,
          [title],
        );
        if (existingInitiative) {
          return {
            success: true,
            data: `An initiative with the same title already exists (id=${existingInitiative.id}, status=${existingInitiative.status}, created=${existingInitiative.created_at}). ` +
              `No duplicate created. If you need to update it, modify the existing initiative instead.`,
          };
        }

        const [initiative] = await systemQuery<{ id: string }>(
          `INSERT INTO initiatives
             (proposed_initiative_id, title, description, doctrine_alignment, owner_role, status, priority, dependencies, target_date, success_criteria, created_by)
           VALUES ($1, $2, $3, $4, $5, 'proposed', $6, $7::uuid[], $8, $9::text[], $10)
           RETURNING id`,
          [
            sourceProposalId ?? null,
            title,
            description,
            doctrineAlignment,
            ownerRole,
            priority,
            dependencies,
            targetDate,
            successCriteria,
            ctx.agentRole,
          ],
        );

        const decisionSummary = [
          description,
          `Doctrine alignment: ${doctrineAlignment}`,
          `Owner: ${ownerRole}`,
          `Priority: ${priority}`,
          successCriteria.length ? `Success criteria: ${successCriteria.join('; ')}` : null,
          dependencies.length ? `Dependencies: ${dependencies.join(', ')}` : null,
          initialDirectives.length ? `Planned directives: ${initialDirectives.map((item) => item.title).join('; ')}` : null,
        ]
          .filter(Boolean)
          .join('\n');

        const decisionId = await memory.createDecision({
          tier: approvalTier,
          status: 'pending',
          title: `Approve initiative: ${title}`,
          summary: decisionSummary,
          proposedBy: ctx.agentRole,
          reasoning: params.reasoning as string,
          assignedTo: finalAssignedTo,
          data: {
            decision_type: 'initiative_approval',
            initiative_id: initiative.id,
            source_proposal_id: sourceProposalId ?? null,
            initial_directives: initialDirectives,
          },
        });

        const decisionsChannel = channels.decisions;
        const { formatDecisionCard } = await import('@glyphor/integrations');
        const card = formatDecisionCard({
          id: decisionId,
          tier: approvalTier,
          title: `Approve initiative: ${title}`,
          summary: decisionSummary,
          proposedBy: ctx.agentRole,
          reasoning: params.reasoning as string,
          assignedTo: finalAssignedTo,
          actionMode: graphClient && decisionsChannel ? 'execute' : 'openUrl',
        });

        let teamsNotifyError: string | null = null;
        try {
          const result = await postCardToChannel('decisions', card, graphClient, 'chief-of-staff');
          if (result.method === 'none') {
            console.warn(`[ChiefOfStaff] No channel posting method available for decisions: ${result.error}`);
          }
        } catch (notifyErr) {
          teamsNotifyError = notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
          console.error(`[ChiefOfStaff] Teams notification failed for initiative ${initiative.id}:`, teamsNotifyError);
        }

        if (sourceProposalId) {
          await systemQuery(
            `UPDATE proposed_initiatives
             SET status = 'approved',
                 evaluation_notes = $2,
                 evaluated_by = $3,
                 evaluated_at = NOW()
             WHERE id = $1`,
            [sourceProposalId, params.reasoning as string, ctx.agentRole],
          );
        }

        await systemQuery(
          'INSERT INTO activity_log (agent_role, action, product, summary, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
          [
            ctx.agentRole,
            'initiative.proposed',
            'company',
            `Proposed initiative for approval: ${title}`,
            JSON.stringify({
              initiative_id: initiative.id,
              decision_id: decisionId,
              source_proposal_id: sourceProposalId ?? null,
            }),
          ],
        );

        return {
          success: true,
          data: {
            initiative_id: initiative.id,
            decision_id: decisionId,
            status: 'proposed',
            ...(teamsNotifyError ? { note_teams_notification_failed_but_action_succeeded: teamsNotifyError } : {}),
          },
          memoryKeysWritten: 1,
        };
      },
    },

    {
      name: 'read_initiatives',
      description: 'Read initiatives with approval, directive, and deliverable summaries so you can sequence company work.',
      parameters: {
        status_filter: {
          type: 'string',
          description: 'Optional status filter',
          required: false,
          enum: ['proposed', 'approved', 'active', 'completed', 'rejected', 'all'],
        },
        owner_role: {
          type: 'string',
          description: 'Optional owner role filter',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const statusFilter = (params.status_filter as string | undefined) ?? 'all';
        const ownerRole = params.owner_role as string | undefined;
        const queryParams: unknown[] = [];
        const conditions: string[] = [];

        if (statusFilter !== 'all') {
          queryParams.push(statusFilter);
          conditions.push(`i.status = $${queryParams.length}`);
        }
        if (ownerRole) {
          queryParams.push(ownerRole);
          conditions.push(`i.owner_role = $${queryParams.length}`);
        }

        const rows = await systemQuery(
          `SELECT
             i.*,
             COUNT(DISTINCT fd.id)::int AS directive_count,
             COUNT(DISTINCT CASE WHEN fd.status = 'completed' THEN fd.id END)::int AS completed_directive_count,
             COUNT(DISTINCT d.id)::int AS deliverable_count,
             MAX(dec.status) FILTER (WHERE dec.data->>'initiative_id' = i.id::text) AS latest_decision_status
           FROM initiatives i
           LEFT JOIN founder_directives fd ON fd.initiative_id = i.id
           LEFT JOIN deliverables d ON d.initiative_id = i.id
           LEFT JOIN decisions dec ON dec.data->>'initiative_id' = i.id::text
           ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
            GROUP BY i.id
            ORDER BY
              CASE i.priority
                WHEN 'critical' THEN 1
                WHEN 'high' THEN 2
               WHEN 'medium' THEN 3
               ELSE 4
             END,
              i.created_at DESC`,
          queryParams,
        );

        const dependencyIds = Array.from(
          new Set(
            (rows as any[])
              .flatMap((row) => Array.isArray(row.dependencies) ? row.dependencies : [])
              .filter(Boolean),
          ),
        );

        const dependencyRows = dependencyIds.length > 0
          ? await systemQuery<any>(
              'SELECT id, title, status FROM initiatives WHERE id = ANY($1)',
              [dependencyIds],
            )
          : [];
        const dependencyMap = new Map<string, any>(
          dependencyRows.map((row: any) => [row.id, row]),
        );

        const enriched = (rows as any[]).map((row: any) => {
          const dependencyDetails = (Array.isArray(row.dependencies) ? row.dependencies : [])
            .map((id: string) => dependencyMap.get(id))
            .filter(Boolean);
          const blockedBy = dependencyDetails.filter((item: any) => item.status !== 'completed');
          return {
            ...row,
            dependency_details: dependencyDetails,
            blocked_by_initiatives: blockedBy,
            ready_for_activation: blockedBy.length === 0,
          };
        });

        return { success: true, data: enriched };
      },
    },

    {
      name: 'activate_initiative',
      description: 'Activate an approved initiative by creating its founder directives and marking the initiative active.',
      parameters: {
        initiative_id: {
          type: 'string',
          description: 'Initiative UUID to activate',
          required: true,
        },
        directive_title: {
          type: 'string',
          description: 'Optional title override when creating a single directive',
          required: false,
        },
        directive_description: {
          type: 'string',
          description: 'Optional description override when creating a single directive',
          required: false,
        },
        category: {
          type: 'string',
          description: 'Optional directive category override',
          required: false,
          enum: ['engineering', 'product', 'marketing', 'sales', 'revenue', 'customer_success', 'operations', 'general', 'design'],
        },
        target_agents: {
          type: 'array',
          description: 'Optional target agent roles override',
          required: false,
          items: { type: 'string', description: 'Agent role' },
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const initiativeId = params.initiative_id as string;
        const [initiative] = await systemQuery<any>(
          'SELECT * FROM initiatives WHERE id = $1',
          [initiativeId],
        );

        if (!initiative) {
          return { success: false, error: `Initiative ${initiativeId} not found.` };
        }

        const dependencyIds = Array.isArray(initiative.dependencies)
          ? (initiative.dependencies as string[]).filter(Boolean)
          : [];
        if (dependencyIds.length > 0) {
          const dependencyRows = await systemQuery<any>(
            'SELECT id, title, status FROM initiatives WHERE id = ANY($1)',
            [dependencyIds],
          );
          const incompleteDependencies = dependencyRows.filter((row: any) => row.status !== 'completed');
          if (incompleteDependencies.length > 0) {
            return {
              success: false,
              error: `Initiative ${initiativeId} is waiting on dependencies: ${incompleteDependencies.map((row: any) => `${row.title} (${row.status})`).join(', ')}`,
            };
          }
        }

        const approvedDecisionRows = await systemQuery<any>(
          `SELECT *
           FROM decisions
           WHERE status = 'approved'
             AND data->>'initiative_id' = $1
           ORDER BY resolved_at DESC NULLS LAST, created_at DESC`,
          [initiativeId],
        );
        const approvedDecision = approvedDecisionRows[0] ?? null;
        const approvedDecisionData = approvedDecision ? parseDecisionData(approvedDecision.data) : {};

        if (!['approved', 'active'].includes(initiative.status)) {
          if (!approvedDecision) {
            return {
              success: false,
              error: `Initiative ${initiativeId} is not approved yet. Approve it through the decision flow or dashboard first.`,
            };
          }

          await systemQuery(
            `UPDATE initiatives
             SET status = 'approved',
                 approved_by = COALESCE(approved_by, $2),
                 approved_at = COALESCE(approved_at, $3),
                 updated_at = NOW()
             WHERE id = $1`,
            [
              initiativeId,
              (approvedDecision.resolved_by as string | null) ?? 'founder',
              (approvedDecision.resolved_at as string | null) ?? new Date().toISOString(),
            ],
          );

          initiative.status = 'approved';
          initiative.approved_by = initiative.approved_by ?? approvedDecision.resolved_by ?? 'founder';
          initiative.approved_at = initiative.approved_at ?? approvedDecision.resolved_at ?? new Date().toISOString();
        }

        const existingDirectives = await systemQuery<any>(
          `SELECT id, title, status
           FROM founder_directives
           WHERE initiative_id = $1
           ORDER BY created_at ASC`,
          [initiativeId],
        );

        if (existingDirectives.length > 0) {
          if (initiative.status !== 'active') {
            await systemQuery(
              `UPDATE initiatives
               SET status = 'active',
                   progress_summary = COALESCE(progress_summary, $2),
                   updated_at = NOW()
               WHERE id = $1`,
              [initiativeId, `Activated with ${existingDirectives.length} linked directive(s).`],
            );
          }

          return {
            success: true,
            data: {
              initiative_id: initiativeId,
              already_active: true,
              directives: existingDirectives,
            },
          };
        }

        const draftDirectives = normalizeDirectiveDraftArray(
          approvedDecisionData.initial_directives as InitiativeDirectiveDraft[] | undefined,
        );
        const defaultTargetAgents = normalizeTextArray(
          (params.target_agents as string[] | undefined) ?? [initiative.owner_role],
        );
        const directiveInputs = draftDirectives.length
          ? draftDirectives
          : [
              {
                title: ((params.directive_title as string | undefined)?.trim() || initiative.title) as string,
                description:
                  ((params.directive_description as string | undefined)?.trim() || initiative.description) as string,
                category:
                  ((params.category as string | undefined)?.trim() ||
                    inferInitiativeCategory(initiative.owner_role)) as string,
                target_agents: defaultTargetAgents,
              },
            ];

        const created: Array<{ id: string; title: string; source_directive_id: string | null }> = [];
        for (const [index, draft] of directiveInputs.entries()) {
          const dependencyDirective =
            typeof draft.depends_on_directive === 'number' &&
            draft.depends_on_directive >= 0 &&
            draft.depends_on_directive < created.length
              ? created[draft.depends_on_directive]
              : null;

          const targetAgents = draft.target_agents?.length ? draft.target_agents : defaultTargetAgents;
          const directiveDescription = dependencyDirective
            ? `${draft.description}\n\nDependency: Execute after directive "${dependencyDirective.title}" (${dependencyDirective.id}) completes.`
            : draft.description;

          const [directive] = await systemQuery<{ id: string }>(
            `INSERT INTO founder_directives
               (created_by, title, description, priority, category, target_agents, status, due_date, initiative_id, source, source_directive_id)
             VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, 'initiative_derived', $9)
             RETURNING id`,
            [
              initiative.approved_by ?? ctx.agentRole,
              draft.title,
              directiveDescription,
              initiative.priority,
              draft.category ?? inferInitiativeCategory(initiative.owner_role),
              targetAgents,
              initiative.target_date ?? null,
              initiativeId,
              dependencyDirective?.id ?? null,
            ],
          );

          created.push({
            id: directive.id,
            title: draft.title,
            source_directive_id: dependencyDirective?.id ?? null,
          });
        }

        await systemQuery(
          `UPDATE initiatives
           SET status = 'active',
               progress_summary = $2,
               updated_at = NOW()
           WHERE id = $1`,
          [initiativeId, `Activated with ${created.length} directive(s).`],
        );

        await systemQuery(
          'INSERT INTO activity_log (agent_role, action, product, summary, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
          [
            ctx.agentRole,
            'initiative.activated',
            'company',
            `Activated initiative: ${initiative.title as string}`,
            JSON.stringify({
              initiative_id: initiativeId,
              directive_ids: created.map((item) => item.id),
            }),
          ],
        );

        if (glyphorEventBus) {
          await glyphorEventBus.emit({
            type: 'initiative.activated',
            source: ctx.agentRole,
            payload: {
              initiative_id: initiativeId,
              directive_ids: created.map((item) => item.id),
            },
            priority: 'high',
          });
        }

        return {
          success: true,
          data: {
            initiative_id: initiativeId,
            directives_created: created.length,
            directives: created,
          },
        };
      },
    },

    {
      name: 'get_product_metrics',
      description: 'Get current metrics for an internal engine. Returns MRR, active users, build stats. The only external product is the AI Marketing Department.',
      parameters: {
        product: {
          type: 'string',
          description: 'Internal engine slug',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const metrics = await memory.getProductMetrics(params.product as 'web-build' | 'pulse');
        return { success: true, data: metrics };
      },
    },

    {
      name: 'get_financials',
      description: 'Get financial snapshots for the last N days. Returns MRR, costs, margins.',
      parameters: {
        days: {
          type: 'number',
          description: 'Number of days to look back (default: 7)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const days = (params.days as number) || 7;
        const financials = await memory.getFinancials(days);
        return { success: true, data: financials };
      },
    },

    {
      name: 'read_company_memory',
      description: 'Read a value from company shared memory by key. Use namespace keys like "company.vision", "product.metrics".',
      parameters: {
        key: {
          type: 'string',
          description: 'Memory namespace key to read',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read(params.key as string);
        return { success: true, data: value };
      },
    },

    // ─── BRIEFING GENERATION ────────────────────────────────────

    {
      name: 'send_briefing',
      description: 'Post the morning/EOD briefing to the #briefings Teams channel. Both founders see it there — do NOT call this twice. IMPORTANT: Every metric value MUST come from a tool call result in this run (get_product_metrics, read_company_vitals, get_financials). Do NOT invent burn rates, dollar amounts, or percentages. If data is unavailable, omit the metric entirely.',
      parameters: {
        briefing_markdown: {
          type: 'string',
          description: 'The full briefing content in markdown. Must only contain facts retrieved from tool calls — never fabricate numbers.',
          required: true,
        },
        metrics: {
          type: 'array',
          description: 'Key metrics from tool results ONLY. Each metric MUST have been returned by a tool call (get_product_metrics, read_company_vitals, get_financials). Do NOT invent values.',
          required: true,
          items: {
            type: 'object',
            description: 'A single metric entry',
            properties: {
              label: { type: 'string', description: 'Metric name' },
              value: { type: 'string', description: 'Metric value' },
              trend: { type: 'string', description: 'Trend direction', enum: ['up', 'down', 'flat'] },
            },
          },
        },
        action_items: {
          type: 'array',
          description: 'Items requiring founder attention',
          required: false,
          items: { type: 'string', description: 'An action item' },
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const markdown = params.briefing_markdown as string;
        let metrics = params.metrics as BriefingData['metrics'];
        const actionItems = (params.action_items as string[]) || [];

        // ── Fabrication guard: strip metrics that look hallucinated ──
        // Known fabricated patterns from prior runs — aggressive filter
        const SUSPECT_PATTERNS = [
          /\d+%\s*MoM/i,        // "164% MoM" — no tool produces this
          /\$\d{2,}k/i,         // "$60k" — no tool produces this format
          /burn\s*(rate|increase)/i,
          /cash\s*reserve/i,
          /runway/i,
        ];
        if (Array.isArray(metrics)) {
          const originalCount = metrics.length;
          metrics = metrics.filter((m) => {
            const text = `${m.label ?? ''} ${m.value ?? ''}`;
            return !SUSPECT_PATTERNS.some((p) => p.test(text));
          });
          if (metrics.length < originalCount) {
            console.warn(
              `[send_briefing] Stripped ${originalCount - metrics.length} suspect metric(s) — likely fabricated`,
            );
          }
        }

        // Format as Teams Adaptive Card
        const card = formatBriefingCard({
          recipient: 'both',
          metrics,
          markdown,
          actionItems,
          date: new Date().toISOString().split('T')[0],
        });

        // Post to #briefings channel — both founders see it there
        let deliveryMode: 'channel' | 'dm' = 'channel';
        let channelError: string | null = null;

        try {
          const result = await postCardToChannel('briefings', card, graphClient, 'chief-of-staff');
          if (result.method === 'none') {
            throw new Error(
              `No Teams briefing channel configured. ${result.error}`,
            );
          }
        } catch (err) {
          channelError = err instanceof Error ? err.message : String(err);
          // Fall back to DM to both founders via A365
          try {
            await sendFounderBriefingDm('kristina', markdown, metrics, actionItems);
            await sendFounderBriefingDm('andrew', markdown, metrics, actionItems);
            deliveryMode = 'dm';
          } catch (dmErr) {
            // If DM also fails, still archive and log the failure
            console.error('[send_briefing] Both channel and DM delivery failed:', (dmErr as Error).message);
          }
        }

        // Archive to GCS
        const date = new Date().toISOString().split('T')[0];
        await memory.writeDocument(
          `briefings/both/${date}.md`,
          markdown,
        );

        // Log activity
        await memory.appendActivity({
          agentRole: 'chief-of-staff',
          action: 'briefing',
          product: 'company',
          summary: `${deliveryMode === 'channel' ? 'Briefing posted to #briefings channel' : 'Briefing DM fallback sent to both founders'}`,
          createdAt: new Date().toISOString(),
        });

        return {
          success: true,
          data: {
            sent: true,
            archived: true,
            delivery_mode: deliveryMode,
            ...(channelError ? { channel_error: channelError } : {}),
          },
          memoryKeysWritten: 1,
        };
      },
    },

    // ─── DECISION MANAGEMENT ────────────────────────────────────

    {
      name: 'create_decision',
      description: 'Create a new decision that requires founder approval. Routes to the appropriate founder(s) based on tier.',
      parameters: {
        tier: {
          type: 'string',
          description: 'Decision tier: yellow (one founder) or red (both founders)',
          required: true,
          enum: ['yellow', 'red'],
        },
        title: {
          type: 'string',
          description: 'Short decision title',
          required: true,
        },
        summary: {
          type: 'string',
          description: 'Decision summary and context',
          required: true,
        },
        reasoning: {
          type: 'string',
          description: 'Why this decision is being proposed',
          required: true,
        },
        assigned_to: {
          type: 'array',
          description: 'Founders to assign: ["kristina"], ["andrew"], or ["kristina","andrew"]',
          required: true,
          items: { type: 'string', description: 'Founder name' },
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const id = await memory.createDecision({
          tier: params.tier as 'yellow' | 'red',
          status: 'pending',
          title: params.title as string,
          summary: params.summary as string,
          proposedBy: ctx.agentRole,
          reasoning: params.reasoning as string,
          assignedTo: params.assigned_to as string[],
        });

        // Send to Teams #Decisions channel (webhook preferred, Graph API fallback)
        let teamsError: string | null = null;
        try {
          const { formatDecisionCard } = await import('@glyphor/integrations');
          const card = formatDecisionCard({
            id,
            tier: params.tier as string,
            title: params.title as string,
            summary: params.summary as string,
            proposedBy: ctx.agentRole,
            reasoning: params.reasoning as string,
            assignedTo: params.assigned_to as string[],
            actionMode: 'openUrl',
          });
          const result = await postCardToChannel('decisions', card, graphClient, 'chief-of-staff');
          if (result.method === 'none') {
            console.warn(`[ChiefOfStaff] No channel posting method for decisions: ${result.error}`);
          }
        } catch (notifyErr) {
          teamsError = notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
          console.error(`[ChiefOfStaff] Teams notification failed for decision ${id}:`, teamsError);
        }

        return {
          success: true,
          data: {
            decisionId: id,
            ...(teamsError ? { note_teams_notification_failed_but_action_succeeded: teamsError } : {}),
          },
          memoryKeysWritten: 1,
        };
      },
    },

    // ─── ACTIVITY LOGGING ───────────────────────────────────────

    {
      name: 'log_activity',
      description: 'Log an activity to the company activity feed.',
      parameters: {
        action: {
          type: 'string',
          description: 'Action type',
          required: true,
          enum: ['analysis', 'decision', 'alert', 'briefing'],
        },
        summary: {
          type: 'string',
          description: 'Short summary of the activity',
          required: true,
        },
        product: {
          type: 'string',
          description: 'Related engine or company-wide',
          required: false,
          enum: ['web-build', 'pulse', 'company'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: params.action as 'analysis' | 'decision' | 'alert' | 'briefing',
          product: (params.product as 'web-build' | 'pulse' | 'company') ?? 'company',
          summary: params.summary as string,
          createdAt: new Date().toISOString(),
        });
        return { success: true, memoryKeysWritten: 1 };
      },
    },

    // ─── ESCALATION CHECK ───────────────────────────────────────

    {
      name: 'check_escalations',
      description: 'Check for decisions that need escalation (yellow items older than 72h, unresponsive founders).',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        const pending = await memory.getDecisions({ status: 'pending' });
        const now = Date.now();

        const escalations = pending
          .filter((d) => {
            const ageMs = now - new Date(d.createdAt).getTime();
            const ageHours = ageMs / (1000 * 60 * 60);
            return d.tier === 'yellow' && ageHours > 72;
          })
          .map((d) => ({
            id: d.id,
            title: d.title,
            tier: d.tier,
            ageHours: Math.round(
              (now - new Date(d.createdAt).getTime()) / (1000 * 60 * 60),
            ),
            shouldEscalateToRed: true,
          }));

        return { success: true, data: { escalations, count: escalations.length } };
      },
    },

    // ─── DIRECT MESSAGES ────────────────────────────────────────

    {
      name: 'send_dm',
      description: 'Send a direct message to a founder via Teams 1:1 chat. GREEN for Sarah — use for urgent alerts, briefing follow-ups, or time-sensitive items. Include image_url to show an image inline.',
      parameters: {
        recipient: {
          type: 'string',
          description: 'Founder to DM',
          required: true,
          enum: ['kristina', 'andrew'],
        },
        message: {
          type: 'string',
          description: 'Message content (supports markdown bold/italic)',
          required: true,
        },
        image_url: {
          type: 'string',
          description: 'Optional image URL to display inline in the message (e.g. from Pulse image generation)',
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        if (!a365Client) {
          return {
            success: false,
            error: 'A365 MCP client not configured. Set AGENT365_ENABLED=true and Agent 365 credentials.',
          };
        }

        const recipient = params.recipient as 'kristina' | 'andrew';
        const recipientContact = founderDir[recipient];
        const recipientUpn = recipientContact?.email
          ?? (recipient === 'kristina' ? 'kristina@glyphor.ai' : 'andrew@glyphor.ai');
        const imageUrl = params.image_url as string | undefined;

        // ── Dedup: suppress if we already DMed this recipient with similar content recently ──
        try {
          const recentDms = await systemQuery<{ details: unknown }>(
            `SELECT details FROM activity_log
             WHERE agent_role = $1 AND action = 'alert'
               AND summary = $2
               AND details IS NOT NULL
               AND created_at > NOW() - interval '4 hours'
             ORDER BY created_at DESC LIMIT 5`,
            [ctx.agentRole, `DM sent to ${recipient}`],
          );
          const newMsg = (params.message as string).toLowerCase();
          const newWords = new Set(newMsg.split(/\s+/).filter(w => w.length > 3));
          for (const prev of recentDms) {
            try {
              const prevContent = typeof prev.details === 'string' ? JSON.parse(prev.details) : prev.details;
              const prevMsg = ((prevContent as Record<string, unknown>)?.message as string ?? '').toLowerCase();
              const prevWords = new Set(prevMsg.split(/\s+/).filter((w: string) => w.length > 3));
              if (newWords.size === 0 || prevWords.size === 0) continue;
              const overlap = [...newWords].filter(w => prevWords.has(w)).length;
              if (overlap / Math.max(newWords.size, prevWords.size) > 0.5) {
                return {
                  success: false,
                  error: `Duplicate DM suppressed — you already sent a similar message to ${recipient} within the last 4 hours. Wait for their response instead of re-sending.`,
                };
              }
            } catch { continue; }
          }
        } catch (err) {
          console.warn('[send_dm] dedup check failed, proceeding:', (err as Error).message);
        }

        const chatId = await a365Client.createOrGetOneOnOneChat(recipientUpn);

        let messageText = params.message as string;
        if (imageUrl) {
          messageText += `\n\n📷 Image: ${imageUrl}`;
        }
        await a365Client.postChatMessage(chatId, messageText, 'chief-of-staff');

        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: 'alert',
          product: 'company',
          summary: `DM sent to ${recipient}`,
          details: { message: messageText },
          createdAt: new Date().toISOString(),
        });

        return { success: true, data: { sent: true, recipient } };
      },
    },

    // ─── EMAIL (moved to shared/emailTools.ts) ──────────────────

    // ─── CALENDAR ───────────────────────────────────────────────

    {
      name: 'create_calendar_event',
      description: 'Create a calendar event on a founder\'s calendar. Always YELLOW — requires founder approval.',
      parameters: {
        founder: {
          type: 'string',
          description: 'Whose calendar to create the event on',
          required: true,
          enum: ['kristina', 'andrew'],
        },
        subject: {
          type: 'string',
          description: 'Event title',
          required: true,
        },
        start: {
          type: 'string',
          description: 'Start datetime (ISO 8601, e.g. "2025-06-20T10:00:00")',
          required: true,
        },
        end: {
          type: 'string',
          description: 'End datetime (ISO 8601)',
          required: true,
        },
        body: {
          type: 'string',
          description: 'Event description (HTML)',
          required: false,
        },
        attendees: {
          type: 'array',
          description: 'Attendee email addresses',
          required: false,
          items: { type: 'string', description: 'Email address' },
        },
        location: {
          type: 'string',
          description: 'Meeting location or "online" for Teams meeting',
          required: false,
        },
        is_online: {
          type: 'boolean',
          description: 'Create as Teams meeting with join link (default: false)',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        if (!calendarClient) {
          return {
            success: false,
            error: 'Calendar client not configured. Ensure Azure Graph API credentials are set.',
          };
        }

        const founder = params.founder as 'kristina' | 'andrew';
        const contact = founderDir[founder];
        if (!contact) {
          return {
            success: false,
            error: `Founder "${founder}" not configured. Set TEAMS_USER_${founder.toUpperCase()}_ID.`,
          };
        }

        const attendees = params.attendees
          ? (params.attendees as string[]).map(email => ({ email }))
          : undefined;

        const isOnline = params.location === 'online' || (params.is_online as boolean);

        const event = await calendarClient.createEvent({
          userId: contact.userId,
          agentRole: ctx.agentRole,
          toolName: 'create_calendar_event',
          subject: params.subject as string,
          start: params.start as string,
          end: params.end as string,
          body: params.body as string | undefined,
          attendees,
          location: params.location === 'online' ? undefined : (params.location as string | undefined),
          isOnlineMeeting: isOnline,
        });

        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: 'alert',
          product: 'company',
          summary: `Calendar event created for ${founder}: ${params.subject}`,
          createdAt: new Date().toISOString(),
        });

        return { success: true, data: { eventId: event.id, webLink: event.webLink, onlineMeetingUrl: event.onlineMeetingUrl } };
      },
    },
  ];
}

// ============================================================
// ORCHESTRATION TOOLS — Founder directive management
// ============================================================

export function createOrchestrationTools(
  schedulerUrl: string,
  glyphorEventBus?: GlyphorEventBus,
  allTools?: ToolDefinition[],
  graphReader?: KnowledgeGraphReader | null,
): ToolDefinition[] {
  // allTools allows propose_directive to call send_dm from the CoS tool set
  const tools = allTools ?? [];
  return [
    // ─── READ FOUNDER DIRECTIVES ──────────────────────────────

    {
      name: 'read_founder_directives',
      description: 'Read strategic directives from the founders. Returns directives with assignment summaries and initiative sequencing context. Use this at the start of every orchestration run to understand current priorities.',
      parameters: {
        status: {
          type: 'string',
          description: 'Filter by directive status. Default: open (proposed, active, paused)',
          required: false,
          enum: ['open', 'proposed', 'active', 'paused', 'completed', 'rejected', 'all'],
        },
        created_by: {
          type: 'string',
          description: 'Filter by founder. Default: all',
          required: false,
          enum: ['kristina', 'andrew', 'all'],
        },
        initiative_id: {
          type: 'string',
          description: 'Optional initiative UUID to inspect a specific initiative chain',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const status = (params.status as string) || 'open';
        const createdBy = (params.created_by as string) || 'all';
        const initiativeId = params.initiative_id as string | undefined;

        // 1. Get directives
        let sql = 'SELECT * FROM founder_directives';
        const conditions: string[] = [];
        const queryParams: unknown[] = [];
        if (status === 'open') {
          conditions.push(`status IN ('proposed', 'active', 'paused')`);
        } else if (status !== 'all') {
          queryParams.push(status);
          conditions.push(`status = $${queryParams.length}`);
        }
        if (createdBy !== 'all') { queryParams.push(createdBy); conditions.push(`created_by = $${queryParams.length}`); }
        if (initiativeId) { queryParams.push(initiativeId); conditions.push(`initiative_id = $${queryParams.length}`); }
        if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
        sql += ' ORDER BY priority ASC, created_at DESC';
        const directives = await systemQuery(sql, queryParams);

        // 2. Get work assignments for those directives
        const directiveIds = (directives as any[]).map((d: any) => d.id);
        const assignments = directiveIds.length > 0
          ? await systemQuery('SELECT id, directive_id, assigned_to, task_description, status, quality_score, completed_at FROM work_assignments WHERE directive_id = ANY($1)', [directiveIds])
          : [];

        // 3. Group assignments by directive
        const assignmentsByDirective = new Map<string, any[]>();
        for (const a of assignments as any[]) {
          const list = assignmentsByDirective.get(a.directive_id) || [];
          list.push(a);
          assignmentsByDirective.set(a.directive_id, list);
        }

        const initiativeIds = Array.from(
          new Set((directives as any[]).map((d: any) => d.initiative_id).filter(Boolean)),
        );
        const initiativeDirectiveRows = initiativeIds.length > 0
          ? await systemQuery<any>(
              `SELECT fd.id, fd.initiative_id, fd.title, fd.status, fd.source_directive_id, fd.created_at,
                      i.title AS initiative_title
               FROM founder_directives fd
               LEFT JOIN initiatives i ON i.id = fd.initiative_id
               WHERE fd.initiative_id = ANY($1)
               ORDER BY fd.created_at ASC`,
              [initiativeIds],
            )
          : [];
        const initiativeDirectiveMap = new Map<string, Map<string, any>>();
        for (const row of initiativeDirectiveRows) {
          const byInitiative = initiativeDirectiveMap.get(row.initiative_id) ?? new Map<string, any>();
          byInitiative.set(row.id, row);
          initiativeDirectiveMap.set(row.initiative_id, byInitiative);
        }
        const depthCache = new Map<string, number>();
        const getSequenceDepth = (directiveId: string, chain: Map<string, any>, seen: Set<string> = new Set()): number => {
          const cacheKey = `${directiveId}`;
          if (depthCache.has(cacheKey)) return depthCache.get(cacheKey)!;
          const current = chain.get(directiveId);
          if (!current?.source_directive_id || !chain.has(current.source_directive_id) || seen.has(directiveId)) {
            depthCache.set(cacheKey, 0);
            return 0;
          }
          seen.add(directiveId);
          const depth = getSequenceDepth(current.source_directive_id, chain, seen) + 1;
          depthCache.set(cacheKey, depth);
          return depth;
        };

        // 4. Build formatted result
        const formatted = (directives as any[]).map((d: any) => {
          const wa = assignmentsByDirective.get(d.id) || [];
          const initiativeChain = d.initiative_id ? initiativeDirectiveMap.get(d.initiative_id) : null;
          const prerequisite = d.source_directive_id && initiativeChain
            ? initiativeChain.get(d.source_directive_id) ?? null
            : null;
          const totalInInitiative = initiativeChain?.size ?? 0;
          const completedInInitiative = initiativeChain
            ? Array.from(initiativeChain.values()).filter((item: any) => item.status === 'completed').length
            : 0;
          return {
            id: d.id,
            title: d.title,
            description: d.description,
            initiative_id: d.initiative_id,
            priority: d.priority,
            category: d.category,
            source: d.source,
            status: d.status,
            created_by: d.created_by,
            created_at: d.created_at,
            due_date: d.due_date,
            target_agents: d.target_agents,
            progress_notes: d.progress_notes,
            ready_for_orchestration: !prerequisite || prerequisite.status === 'completed',
            initiative_sequence: d.initiative_id
              ? {
                  initiative_title: initiativeChain?.get(d.id)?.initiative_title ?? null,
                  prerequisite_directive_id: d.source_directive_id ?? null,
                  prerequisite_title: prerequisite?.title ?? null,
                  prerequisite_status: prerequisite?.status ?? null,
                  sequence_depth: initiativeChain ? getSequenceDepth(d.id, initiativeChain) : 0,
                  completed_directives: completedInInitiative,
                  total_directives: totalInInitiative,
                }
              : null,
            assignments: wa,
            assignment_summary: {
              total: wa.length,
              completed: wa.filter((a: any) => a.status === 'completed').length,
              draft: wa.filter((a: any) => a.status === 'draft').length,
              pending: wa.filter((a: any) => a.status === 'pending').length,
              in_progress: wa.filter((a: any) =>
                ['dispatched', 'in_progress'].includes(a.status)
              ).length,
            },
          };
        });

        formatted.sort((a: any, b: any) =>
          getDirectivePriorityRank(a.priority) - getDirectivePriorityRank(b.priority) ||
          Number(Boolean(b.ready_for_orchestration)) - Number(Boolean(a.ready_for_orchestration)) ||
          ((a.initiative_sequence?.sequence_depth as number | undefined) ?? 0) -
            ((b.initiative_sequence?.sequence_depth as number | undefined) ?? 0) ||
          String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
        );

        return { success: true, data: formatted };
      },
    },

    // ─── CREATE WORK ASSIGNMENTS ──────────────────────────────

    {
      name: 'create_work_assignments',
      description: 'Create work assignments for directives Sarah owns directly (critical directives, cross-domain synthesis, or explicit delegation fallback). For delegatable single-domain non-critical directives, call delegate_directive first instead of assigning directly to executives.',
      parameters: {
        directive_id: {
          type: 'string',
          description: 'UUID of the founder directive this work serves',
          required: true,
        },
        assignments: {
          type: 'array',
          description: 'Array of work assignments to create',
          required: true,
          items: {
            type: 'object',
            description: 'A work assignment',
            properties: {
              assigned_to: {
                type: 'string',
                description:
                  'Company agent role slug from get_agent_directory: use the `role_slug` or `role` field (e.g. social-media-manager, content-creator). Do not use `name` or hyphenated display names like tyler-reed.',
              },
              task_description: { type: 'string', description: 'Clear outcome description for the executive' },
              task_type: { type: 'string', description: 'Agent task type (e.g., on_demand, blog_post)' },
              expected_output: { type: 'string', description: 'What you expect the executive to deliver' },
              priority: { type: 'string', description: 'Priority level', enum: ['urgent', 'high', 'normal', 'low'] },
              sequence_order: { type: 'number', description: 'Execution order. 0 = immediate.' },
              depends_on: {
                type: 'array',
                description: 'Optional upstream assignment IDs that must complete first',
                items: { type: 'string', description: 'Assignment UUID' },
              },
              assignment_type: { type: 'string', description: 'Type of assignment', enum: ['executive_outcome', 'standard'] },
            },
          },
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const assignments = params.assignments as any[];
        const directiveId = params.directive_id as string;

        if (!Array.isArray(assignments) || assignments.length === 0) {
          return { success: false, error: 'At least one assignment is required.' };
        }

        const directiveContext = await loadDirectiveInitiativeContext(directiveId);

        if (!directiveContext) {
          return { success: false, error: `Directive ${directiveId} not found.` };
        }

        if (!directiveContext.readyForAssignments) {
          return {
            success: false,
            error: directiveContext.blockedReason ?? `Directive ${directiveId} is not ready for downstream work yet.`,
          };
        }

        const initiativeContextBlock = directiveContext.deliverableContext
          ? appendContextBlock(
              directiveContext.prerequisite
                ? `INITIATIVE CONTEXT: This directive is part of "${directiveContext.initiative?.title ?? directiveContext.directive.initiative_title}". Upstream directive "${directiveContext.prerequisite.title}" is complete.`
                : `INITIATIVE CONTEXT: This directive is part of "${directiveContext.initiative?.title ?? directiveContext.directive.initiative_title}".`,
              directiveContext.deliverableContext,
            )
          : null;

        const assignmentsWithResolvedRoles: any[] = [];
        for (let i = 0; i < assignments.length; i++) {
          const assignment = assignments[i] as any;
          const raw = typeof assignment?.assigned_to === 'string' ? assignment.assigned_to.trim() : '';
          if (!raw) {
            return {
              success: false,
              error: `Assignment #${i + 1}: assigned_to is required.`,
            };
          }
          const resolved = await resolveAssigneeForWorkAssignment(raw);
          if (!resolved) {
            return {
              success: false,
              error:
                `Assignment #${i + 1}: Unknown assignee "${raw}". Use the role slug (e.g. content-creator) or the agent's display name.`,
            };
          }
          assignmentsWithResolvedRoles.push({ ...assignment, assigned_to: resolved });
        }

        const normalizedAssignees = assignmentsWithResolvedRoles.map((assignment: any) =>
          normalizeAssigneeRole(typeof assignment?.assigned_to === 'string' ? assignment.assigned_to : ''),
        );
        const assigneeResolution = await resolveActiveAssigneeBatch(normalizedAssignees);
        if (assigneeResolution.errors.length > 0) {
          return {
            success: false,
            error: `Assignment validation failed: ${assigneeResolution.errors.join(' | ')}`,
          };
        }

        const canonicalAssignments = assignmentsWithResolvedRoles.map((assignment: any, index: number) => {
          const normalized = normalizedAssignees[index];
          const canonical = assigneeResolution.canonicalByNormalized.get(normalized) ?? normalized;
          return {
            ...assignment,
            assigned_to: canonical,
          };
        });

        const maxActiveAssignmentsPerAssignee = 5;
        const addingByAssignee = new Map<string, number>();
        for (const assignment of canonicalAssignments) {
          const role = String((assignment as { assigned_to?: string }).assigned_to ?? '');
          addingByAssignee.set(role, (addingByAssignee.get(role) ?? 0) + 1);
        }
        for (const [assigneeRole, adding] of addingByAssignee) {
          const [depthRow] = await systemQuery<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM work_assignments
             WHERE assigned_to = $1
               AND status IN ('pending', 'dispatched', 'in_progress')`,
            [assigneeRole],
          );
          const depth = Number(depthRow?.count ?? 0);
          if (depth + adding > maxActiveAssignmentsPerAssignee) {
            return {
              success: false,
              error: `Cannot dispatch to ${assigneeRole} — they already have ${depth} assignments in queue (cap ${maxActiveAssignmentsPerAssignee} including this request). Wait for current work to complete before assigning more.`,
            };
          }
        }

        // Resolve depends_on entries before writing:
        // - Accept UUIDs as-is
        // - Accept role references that point to exactly one assignment in this batch
        const roleToIndexes = new Map<string, number[]>();
        canonicalAssignments.forEach((assignment: any, index: number) => {
          const role = normalizeAssigneeRole(String(assignment.assigned_to ?? ''));
          if (!roleToIndexes.has(role)) roleToIndexes.set(role, []);
          roleToIndexes.get(role)!.push(index);
        });

        const dependencySpecs: Array<{ directUuids: string[]; batchRefs: number[] }> = [];
        for (let i = 0; i < canonicalAssignments.length; i++) {
          const assignment = canonicalAssignments[i] as any;
          const rawDeps = Array.isArray(assignment.depends_on) ? assignment.depends_on : [];
          const directUuids: string[] = [];
          const batchRefs: number[] = [];

          for (const rawDep of rawDeps) {
            if (typeof rawDep !== 'string' || !rawDep.trim()) {
              return {
                success: false,
                error: `Assignment #${i + 1} has an invalid depends_on value. Use assignment UUIDs or assignee roles from this same request.`,
              };
            }

            const dep = rawDep.trim();
            if (UUID_PATTERN.test(dep)) {
              directUuids.push(dep);
              continue;
            }

            const depRole = normalizeAssigneeRole(dep);
            const candidates = roleToIndexes.get(depRole) ?? [];
            if (candidates.length === 0) {
              return {
                success: false,
                error: `Assignment #${i + 1} depends_on "${dep}" which is neither a UUID nor an assignee role in this request.`,
              };
            }
            if (candidates.length > 1) {
              return {
                success: false,
                error: `Assignment #${i + 1} depends_on role "${dep}" is ambiguous because multiple assignments target that role. Use explicit assignment UUID dependencies instead.`,
              };
            }
            if (candidates[0] === i) {
              return {
                success: false,
                error: `Assignment #${i + 1} cannot depend on itself.`,
              };
            }
            batchRefs.push(candidates[0]);
          }

          dependencySpecs.push({ directUuids, batchRefs });
        }

        // Insert as 'draft' initially; plan verification promotes to 'pending'
        const rows = canonicalAssignments.map((a: any, i: number) => ({
          directive_id: directiveId,
          assigned_to: a.assigned_to,
          assigned_by: 'chief-of-staff',
          task_description: appendContextBlock(a.task_description, initiativeContextBlock),
          task_type: a.task_type || 'on_demand',
          expected_output: appendContextBlock(
            a.expected_output,
            initiativeContextBlock
              ? 'In your final output, cite which upstream deliverables you used and how they informed the work.'
              : null,
          ),
          priority: a.priority || 'normal',
          depends_on: null,
          sequence_order: a.sequence_order ?? i,
          assignment_type: a.assignment_type || 'executive_outcome',
          status: 'draft',
        }));

        const batchDedup = assertBatchWorkAssignmentsDeduped(
          rows.map((r) => ({
            taskDescription: r.task_description,
            assignedTo: r.assigned_to,
          })),
        );
        if (!batchDedup.ok) {
          return { success: false, error: batchDedup.error };
        }
        for (const r of rows) {
          const guard = await assertWorkAssignmentDispatchAllowed({
            taskDescription: r.task_description,
            assignedTo: r.assigned_to,
          });
          if (!guard.ok) {
            return { success: false, error: guard.error };
          }
        }

        // Clean up stale drafts from previous planning attempts for this directive
        await systemQuery(
          `DELETE FROM work_assignments WHERE directive_id = $1 AND status = 'draft'`,
          [directiveId],
        );

        const columns = '(directive_id, assigned_to, assigned_by, task_description, task_type, expected_output, priority, depends_on, sequence_order, assignment_type, status)';
        const values: unknown[] = [];
        const placeholders: string[] = [];
        for (const a of rows) {
          const offset = values.length;
          placeholders.push(`($${offset+1}, $${offset+2}, $${offset+3}, $${offset+4}, $${offset+5}, $${offset+6}, $${offset+7}, $${offset+8}, $${offset+9}, $${offset+10}, $${offset+11})`);
          values.push(a.directive_id, a.assigned_to, a.assigned_by, a.task_description, a.task_type, a.expected_output, a.priority, a.depends_on, a.sequence_order, a.assignment_type, a.status);
        }
        const data = await systemQuery(`INSERT INTO work_assignments ${columns} VALUES ${placeholders.join(', ')} RETURNING *`, values);
        const createdIds = (data as any[]).map((r: any) => r.id);

        for (let i = 0; i < createdIds.length; i++) {
          const assignment = canonicalAssignments[i];
          const parentContract = assignment.depends_on?.[0]
            ? await getActiveContractForTask(assignment.depends_on[0])
            : null;
          await issueContract({
            requestingAgentId: 'chief-of-staff',
            requestingAgentName: 'chief-of-staff',
            receivingAgentId: assignment.assigned_to,
            receivingAgentName: assignment.assigned_to,
            taskId: createdIds[i],
            parentContractId: parentContract?.id,
            taskDescription: assignment.task_description,
            requiredInputs: buildRequiredInputs([
              { key: 'task_description', type: 'string', value: assignment.task_description },
              { key: 'expected_output', type: 'string', value: assignment.expected_output },
              { key: 'directive_id', type: 'string', value: directiveId },
              { key: 'priority', type: 'string', value: assignment.priority },
            ]),
            expectedOutputSchema: buildDefaultExpectedOutputSchema(assignment.expected_output),
            confidenceThreshold: DEFAULT_HANDOFF_CONFIDENCE_THRESHOLD,
            escalationPolicy: 'return_to_issuer',
          });
        }

        // Backfill depends_on with resolved UUID references now that IDs are known.
        for (let i = 0; i < dependencySpecs.length; i++) {
          const spec = dependencySpecs[i];
          const resolved = [
            ...spec.directUuids,
            ...spec.batchRefs.map((refIndex) => createdIds[refIndex]),
          ].filter((id): id is string => Boolean(id));

          if (resolved.length === 0) continue;

          await systemQuery(
            'UPDATE work_assignments SET depends_on = $1::uuid[] WHERE id = $2',
            [resolved, createdIds[i]],
          );
        }

        // ── Plan Verification ──
        // Verify the decomposition plan before promoting assignments to 'pending'.
        // Uses dynamic import to avoid circular dependency (scheduler → agents).
        let verification: { verdict: string; suggestions: string[] } | null = null;
        try {
          // Dynamic import to avoid circular dep (scheduler → agents).
          // Use variable to prevent tsc from resolving the module at compile time.
          const modName = '@glyphor/scheduler';
          const scheduler = await (Function('m', 'return import(m)')(modName)) as any;
          const [directive] = await systemQuery(
            'SELECT id, title, description, priority, target_agents FROM founder_directives WHERE id = $1',
            [directiveId],
          ) as any[];

          if (directive && typeof scheduler.verifyPlan === 'function') {
            const result = await scheduler.verifyPlan({
              directive: {
                id: directive.id,
                title: directive.title,
                description: directive.description ?? '',
                priority: directive.priority ?? 'normal',
                target_agents: directive.target_agents,
              },
              proposed_assignments: canonicalAssignments.map((a: any, i: number) => ({
                assigned_to: a.assigned_to,
                task_description: a.task_description,
                expected_output: a.expected_output || '',
                depends_on: a.depends_on,
                sequence_order: a.sequence_order ?? i,
              })),
            });
            verification = result;

            if (result.verdict === 'REVISE') {
              // Leave as 'draft' — inject feedback for re-decomposition
              const feedback = result.suggestions?.join('; ') || 'Plan needs revision';
              await systemQuery(
                "INSERT INTO activity_log (agent_role, action, summary) VALUES ($1, $2, $3)",
                ['chief-of-staff', 'plan_verification', `REVISE: ${feedback}`],
              );
            } else {
              // APPROVE or WARN → promote to 'pending'
              await systemQuery(
                "UPDATE work_assignments SET status = 'pending' WHERE id = ANY($1)",
                [createdIds],
              );
              if (result.verdict === 'WARN' && result.suggestions?.length) {
                await systemQuery(
                  "INSERT INTO activity_log (agent_role, action, summary) VALUES ($1, $2, $3)",
                  ['chief-of-staff', 'plan_verification', `WARN: ${result.suggestions.join('; ')}`],
                );
              }
            }
          } else {
            // Directive not found or verifier unavailable — promote to pending
            await systemQuery(
              "UPDATE work_assignments SET status = 'pending' WHERE id = ANY($1)",
              [createdIds],
            );
          }
        } catch (verifyErr) {
          // Verification failure must never break the orchestration flow
          console.warn('[CoS] Plan verification skipped:', (verifyErr as Error).message);
          await systemQuery(
            "UPDATE work_assignments SET status = 'pending' WHERE id = ANY($1)",
            [createdIds],
          );
        }

        const finalData = await systemQuery('SELECT * FROM work_assignments WHERE id = ANY($1)', [createdIds]);

        return {
          success: true,
          data: {
            created: (finalData as any[]).length,
            assignments: finalData,
            ...(verification ? { verification: { verdict: verification.verdict, suggestions: verification.suggestions } } : {}),
          },
        };
      },
    },

    // ─── DISPATCH ASSIGNMENT ──────────────────────────────────

    {
      name: 'dispatch_assignment',
      description: 'Send a work assignment to an agent. Sends an inter-agent message with the task details AND schedules their next run.',
      parameters: {
        assignment_id: {
          type: 'string',
          description: 'UUID of the work assignment to dispatch',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const assignmentId = params.assignment_id as string;

        // 1. Get the assignment with its directive
        const [assignment] = await systemQuery(
          'SELECT wa.*, fd.title as directive_title, fd.priority as directive_priority FROM work_assignments wa LEFT JOIN founder_directives fd ON wa.directive_id = fd.id WHERE wa.id = $1', [assignmentId]) as any[];

        if (!assignment) {
          return { success: false, error: 'Assignment not found' };
        }

        const taskDescription = String(assignment.task_description ?? '');
        const likelyStaleInfraSetupRequest =
          /\b(add|create|configure|set|mount|provide|wire|update)\b[\s\S]{0,80}\b(secret|secrets|env|environment variable|environment variables)\b/i.test(taskDescription) ||
          /\b(GITHUB_TOKEN|VERCEL_TOKEN|GITHUB_APP_ID|GITHUB_APP_PRIVATE_KEY|GITHUB_INSTALLATION_ID|FIGMA_ACCESS_TOKEN)\b/i.test(taskDescription);
        const guardedTaskDescription = likelyStaleInfraSetupRequest
          ? `${taskDescription}\n\nVERIFICATION OVERRIDE:\n- Before requesting, creating, or re-asking for secrets or environment variables, verify the live state with your available tools first.\n- If the config already exists, do NOT ask founders for the same secret again. Diagnose the real issue instead: stale directive text, service mismatch, bad error handling, or an incorrect assumption in the task.\n- Use read_company_knowledge for the canonical infrastructure policy when needed, and treat assignment wording as potentially stale if it conflicts with live verification.`
          : taskDescription;

        // 2. Send inter-agent message to the target agent
        const directiveTitle = assignment.directive_title ?? 'Unknown directive';

        await systemQuery('INSERT INTO agent_messages (from_agent, to_agent, message, message_type, priority, status) VALUES ($1, $2, $3, $4, $5, $6)',
          ['chief-of-staff', assignment.assigned_to,
            `**Work Assignment from Sarah (Chief of Staff)**\n\n` +
            `**Directive:** ${directiveTitle}\n` +
            `**Priority:** ${assignment.priority}\n\n` +
            `**Your Task:**\n${guardedTaskDescription}\n\n` +
            `**Expected Output:**\n${assignment.expected_output}\n\n` +
            `**ACTION MODE:** This is not a report-only task. You are expected to TAKE ACTION:\n` +
            `- If you find issues you can fix → fix them immediately and log what you did\n` +
            `- If you find issues requiring another agent → use send_agent_message to assign them with specifics\n` +
            `- If you hit a blocker → use flag_assignment_blocker immediately, don't just note it\n` +
            `- Your output should be a punch list of: what you fixed, what you assigned (to whom), and what's still blocked\n\n` +
            `This is a founder-level priority. Act, don't just analyze.`,
            'request', assignment.priority === 'urgent' ? 'urgent' : 'normal', 'pending']);

        // 3. Update assignment status immediately so scheduler slowness cannot
        // block orchestration progress or trip the ToolExecutor timeout.
        await systemQuery('UPDATE work_assignments SET status = $1, dispatched_at = $2 WHERE id = $3',
          ['dispatched', new Date().toISOString(), assignmentId]);

        // 4. Trigger scheduler run asynchronously with a short request timeout.
        const runPayload = {
          agentRole: assignment.assigned_to,
          task: assignment.task_type,
          message: guardedTaskDescription,
          payload: { directiveAssignmentId: assignmentId },
        };

        void fetch(`${schedulerUrl}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(runPayload),
          signal: AbortSignal.timeout(8000),
        })
          .then(async (response) => {
            if (response.ok) return;
            const body = await response.text().catch(() => '');
            console.warn(
              `[Orchestration] Scheduler dispatch returned ${response.status} for ${assignment.assigned_to}: ${body.slice(0, 200)}`,
            );
          })
          .catch((e) => {
            console.warn(`[Orchestration] Could not immediately dispatch to ${assignment.assigned_to}:`, e);
          });

        return {
          success: true,
          data: {
            dispatched: true,
            agent: assignment.assigned_to,
            scheduler_trigger: 'queued',
          },
        };
      },
    },

    // ─── CHECK ASSIGNMENT STATUS ──────────────────────────────

    {
      name: 'check_assignment_status',
      description: 'Check the status of work assignments for a directive. Returns assignment details, agent outputs if completed, and any blockers.',
      parameters: {
        directive_id: {
          type: 'string',
          description: 'UUID of the directive to check assignments for',
          required: true,
        },
        status_filter: {
          type: 'string',
          description: 'Filter by assignment status. Default: all',
          required: false,
          enum: ['all', 'pending', 'dispatched', 'in_progress', 'completed', 'failed'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const directiveId = params.directive_id as string;
        const statusFilter = (params.status_filter as string) || 'all';

        let sql = 'SELECT id, assigned_to, task_description, task_type, expected_output, status, priority, sequence_order, agent_output, evaluation, quality_score, dispatched_at, completed_at, need_type, blocker_reason FROM work_assignments WHERE directive_id = $1';
        const queryParams: unknown[] = [directiveId];
        if (statusFilter !== 'all') { queryParams.push(statusFilter); sql += ` AND status = $${queryParams.length}`; }
        sql += ' ORDER BY sequence_order';
        const data = await systemQuery(sql, queryParams);

        // Truncate agent_output to keep context window manageable
        const truncated = (data as any[]).map((a: any) => ({
          ...a,
          agent_output: a.agent_output
            ? a.agent_output.length > 500
              ? a.agent_output.substring(0, 500) + '... [truncated — use evaluate_assignment to review full output]'
              : a.agent_output
            : null,
        }));

        return { success: true, data: truncated };
      },
    },

    // ─── EVALUATE ASSIGNMENT ──────────────────────────────────

    {
      name: 'evaluate_assignment',
      description: 'Evaluate an agent output against assignment expectations. Rate quality, note gaps, and decide if the work meets directive goals.',
      parameters: {
        assignment_id: {
          type: 'string',
          description: 'UUID of the assignment to evaluate',
          required: true,
        },
        quality_score: {
          type: 'number',
          description: 'Quality rating 0-100',
          required: true,
        },
        evaluation: {
          type: 'string',
          description: 'Your assessment of the output quality and completeness',
          required: true,
        },
        meets_expectations: {
          type: 'boolean',
          description: 'Does this output satisfy the directive goals?',
          required: true,
        },
        next_action: {
          type: 'string',
          description: 'What to do next. accept=done, iterate=send back, reassign=different agent, escalate=flag for founder',
          required: true,
          enum: ['accept', 'iterate', 'reassign', 'escalate'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const assignmentId = params.assignment_id as string;
        const nextAction = params.next_action as string;

        const updates: Record<string, unknown> = {
          quality_score: params.quality_score as number,
          evaluation: params.evaluation as string,
          updated_at: new Date().toISOString(),
        };

        if (nextAction === 'accept') {
          updates.status = 'completed';
          updates.completed_at = new Date().toISOString();
        } else if (nextAction === 'iterate') {
          updates.status = 'needs_revision';
        } else if (nextAction === 'escalate') {
          updates.status = 'blocked';
        }

        const setClauses: string[] = [];
        const updateParams: unknown[] = [];
        for (const [key, value] of Object.entries(updates)) {
          updateParams.push(value);
          setClauses.push(`${key} = $${updateParams.length}`);
        }
        updateParams.push(assignmentId);
        await systemQuery(`UPDATE work_assignments SET ${setClauses.join(', ')} WHERE id = $${updateParams.length}`, updateParams);

        // ── Dual-write to assignment_evaluations (append-only) ──
        try {
          const rawScore = params.quality_score as number;
          await systemQuery(
            `INSERT INTO assignment_evaluations
             (assignment_id, run_id, evaluator_type, evaluator_agent_id, score_raw, score_normalized, feedback)
             VALUES ($1, $2, 'cos', $3, $4, $5, $6)`,
            [assignmentId, null, 'chief-of-staff', rawScore, rawScore / 100, params.evaluation as string],
          );
        } catch (err) {
          console.warn(`[evaluate_assignment] assignment_evaluations write failed:`, (err as Error).message);
        }

        // Emit assignment.revised event to wake the target agent
        if (nextAction === 'iterate') {
          const [assignment] = await systemQuery(
            'SELECT assigned_to, directive_id FROM work_assignments WHERE id = $1', [assignmentId]) as any[];

          if (assignment && glyphorEventBus) {
            await glyphorEventBus.emit({
              type: 'assignment.revised',
              source: 'chief-of-staff',
              payload: {
                assignment_id: assignmentId,
                directive_id: assignment.directive_id,
                target_agent: assignment.assigned_to,
                feedback: params.evaluation as string,
              },
              priority: 'high',
            });
          }
        }

        // ── Task outcome downstream signals (Learning Governor) ─
        try {
          if (nextAction === 'accept') {
            await markOutcomeAccepted(assignmentId);
          } else if (nextAction === 'iterate') {
            await markOutcomeRevised(assignmentId);
          }
        } catch (err) {
          console.warn(`[evaluate_assignment] Outcome signal failed for ${assignmentId}:`, (err as Error).message);
        }

        // ── World Model Update ──────────────────────────────────
        // After evaluating an assignment, update the assigned agent's
        // world model so it learns from the orchestrator's grading.
        try {
          const [assignmentData] = await systemQuery(
            'SELECT assigned_to, task_type FROM work_assignments WHERE id = $1', [assignmentId]) as any[];

          if (assignmentData?.assigned_to) {
            const embeddingClient = new EmbeddingClient(process.env.GOOGLE_AI_API_KEY!);
            const sharedMemLoader = new SharedMemoryLoader(embeddingClient, graphReader ?? null, getRedisCache());
            const updater = new WorldModelUpdater(sharedMemLoader);

            const qualityScore = params.quality_score as number;
            const scaledScore = (qualityScore / 100) * 5; // Map 0-100 → 0-5
            const agentRole = assignmentData.assigned_to as CompanyAgentRole;
            const taskType = (assignmentData.task_type as string) || 'general';

            // Look up the actual rubric for this agent's role + task type
            const rubric = await sharedMemLoader.getRubric(agentRole, taskType);
            const rubricDimensions = rubric?.dimensions ?? [
              { name: 'task_completion', weight: 0.5 },
              { name: 'overall_quality', weight: 0.5 },
            ];
            const passingScore = rubric?.passingScore ?? 3.0;

            // Build per-dimension scores from the rubric
            const rubricScores = rubricDimensions.map(dim => ({
              dimension: dim.name,
              orchestratorScore: scaledScore,
              evidence: params.evaluation as string,
              feedback: params.evaluation as string,
            }));

            const reflection: StructuredReflection = {
              runId: assignmentId,
              taskType,
              rubricScores: rubricDimensions.map(dim => ({
                dimension: dim.name,
                selfScore: scaledScore,
                evidence: '',
                confidence: 0.5,
              })),
              predictedScore: scaledScore,
              approachUsed: taskType,
              wouldChange: '',
              newKnowledge: '',
              blockedBy: null,
            };

            const grade: OrchestratorGrade = {
              assignmentId,
              agentRole,
              rubricScores,
              weightedTotal: scaledScore,
              disposition: nextAction as OrchestratorGrade['disposition'],
            };

            // Initialize the world model if it doesn't exist yet
            await updater.initializeForAgent(agentRole);
            await updater.updateFromGrade(agentRole, reflection, grade, passingScore);
          }
        } catch (err) {
          console.warn('[CoS] World model update failed:', (err as Error).message);
        }

        return { success: true, data: { updated: true, next_action: nextAction } };
      },
    },

    // ─── UPDATE DIRECTIVE PROGRESS ────────────────────────────

    {
      name: 'update_directive_progress',
      description: 'Add a progress note to a directive or mark it complete. Use this to keep founders informed.',
      parameters: {
        directive_id: {
          type: 'string',
          description: 'UUID of the directive',
          required: true,
        },
        progress_note: {
          type: 'string',
          description: 'Status update to append',
          required: false,
        },
        new_status: {
          type: 'string',
          description: 'Optionally change directive status',
          required: false,
          enum: ['active', 'completed', 'paused'],
        },
        completion_summary: {
          type: 'string',
          description: 'Final summary when marking directive complete',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const directiveId = params.directive_id as string;

        // Get current directive to append to progress_notes
        const [directive] = await systemQuery(
          'SELECT id, title, status, initiative_id, progress_notes FROM founder_directives WHERE id = $1',
          [directiveId],
        ) as any[];

        if (!directive) {
          return { success: false, error: `Directive ${directiveId} not found.` };
        }

        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        const transitionedToCompleted =
          params.new_status === 'completed' && directive.status !== 'completed';

        if (params.progress_note) {
          const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
          const notes: string[] = (directive?.progress_notes as string[]) || [];
          notes.push(`[${timestamp}] ${params.progress_note}`);
          updates.progress_notes = notes;
        }

        if (params.new_status) updates.status = params.new_status;
        if (params.completion_summary) updates.completion_summary = params.completion_summary;

        const setClauses: string[] = [];
        const updateParams: unknown[] = [];
        for (const [key, value] of Object.entries(updates)) {
          updateParams.push(value);
          setClauses.push(`${key} = $${updateParams.length}`);
        }
        updateParams.push(directiveId);
        await systemQuery(`UPDATE founder_directives SET ${setClauses.join(', ')} WHERE id = $${updateParams.length}`, updateParams);

        if (transitionedToCompleted && directive.initiative_id) {
          const initiativeId = directive.initiative_id as string;
          const completionSummary =
            (params.completion_summary as string | undefined) ??
            (params.progress_note as string | undefined) ??
            null;
          const publishedDeliverables = await systemQuery<any>(
            `SELECT id, title, type, content, storage_url, producing_agent, created_at
             FROM deliverables
             WHERE directive_id = $1
               AND status = 'published'
             ORDER BY created_at DESC
             LIMIT 10`,
            [directiveId],
          );
          const downstreamDirectives = await systemQuery<any>(
            `SELECT id, title, status
             FROM founder_directives
             WHERE initiative_id = $1
               AND source_directive_id = $2
             ORDER BY created_at ASC`,
            [initiativeId, directiveId],
          );
          const deliverableSummaries = publishedDeliverables.map((item: any) => ({
            id: item.id,
            title: item.title,
            type: item.type,
            producing_agent: item.producing_agent,
            reference: item.storage_url || truncateDeliverableReference(item.content),
          }));
          const handoffRequired = downstreamDirectives.some((item: any) => item.status !== 'completed');

          await systemQuery(
            'INSERT INTO activity_log (agent_role, action, product, summary, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
            [
              ctx.agentRole,
              'initiative.directive_completed',
              'company',
              `Directive completed inside initiative: ${directive.title as string}`,
              JSON.stringify({
                initiative_id: initiativeId,
                directive_id: directiveId,
                directive_title: directive.title,
                published_deliverable_count: deliverableSummaries.length,
                published_deliverables: deliverableSummaries,
                downstream_directives: downstreamDirectives,
                handoff_required: handoffRequired,
              }),
            ],
          );

          if (glyphorEventBus) {
            await glyphorEventBus.emit({
              type: 'initiative.directive_completed',
              source: ctx.agentRole,
              payload: {
                initiative_id: initiativeId,
                directive_id: directiveId,
                directive_title: directive.title,
                completion_summary: completionSummary,
                published_deliverable_count: deliverableSummaries.length,
                published_deliverables: deliverableSummaries,
                downstream_directives: downstreamDirectives,
                handoff_required: handoffRequired,
              },
              priority: 'high',
            });
          }

          const initiativeDirectives = await systemQuery<any>(
            'SELECT id, title, status FROM founder_directives WHERE initiative_id = $1 ORDER BY created_at ASC',
            [initiativeId],
          );
          const completedCount = initiativeDirectives.filter((item: any) => item.status === 'completed').length;
          const totalCount = initiativeDirectives.length;

          if (totalCount > 0 && completedCount === totalCount) {
            const progressSummary =
              completionSummary
                ? `Initiative complete. Final directive "${directive.title as string}" closed with summary: ${completionSummary}`
                : `Initiative complete. Final directive "${directive.title as string}" is done.`;
            await systemQuery(
              `UPDATE initiatives
               SET status = 'completed',
                   progress_summary = $2,
                   updated_at = NOW()
               WHERE id = $1`,
              [initiativeId, progressSummary],
            );

            await systemQuery(
              'INSERT INTO activity_log (agent_role, action, product, summary, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
              [
                ctx.agentRole,
                'initiative.completed',
                'company',
                `Initiative completed after directive "${directive.title as string}"`,
                JSON.stringify({
                  initiative_id: initiativeId,
                  directive_ids: initiativeDirectives.map((item: any) => item.id),
                }),
              ],
            );

            if (glyphorEventBus) {
              await glyphorEventBus.emit({
                type: 'initiative.completed',
                source: ctx.agentRole,
                payload: {
                  initiative_id: initiativeId,
                  directive_ids: initiativeDirectives.map((item: any) => item.id),
                  completion_summary: progressSummary,
                },
                priority: 'high',
              });
            }
          } else {
            await systemQuery(
              `UPDATE initiatives
               SET progress_summary = $2,
                   updated_at = NOW()
                WHERE id = $1`,
              [
                initiativeId,
                `${completedCount}/${totalCount} directives complete. Latest completion: ${directive.title as string}.` +
                  (handoffRequired
                    ? ` Downstream handoff ready for ${downstreamDirectives
                        .filter((item: any) => item.status !== 'completed')
                        .map((item: any) => `"${item.title}"`)
                        .join(', ')}.`
                    : ''),
              ],
            );
          }
        }

        return { success: true, data: { updated: true } };
      },
    },

    // ─── DYNAMIC TOOL GRANTS ──────────────────────────────────

    {
      name: 'grant_tool_access',
      description: 'Grant an existing tool to an agent. Most grants are immediate. Only restricted grants (paid/spend-impacting or global-admin permissioning) require founder approval. The tool must exist in the system registry.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Agent role to grant the tool to (e.g., "cmo", "vp-sales")',
          required: true,
        },
        tool_name: {
          type: 'string',
          description: 'Name of the tool to grant (must exist in the tool registry)',
          required: true,
        },
        reason: {
          type: 'string',
          description: 'Why this grant is needed (links to directive or blocker)',
          required: true,
        },
        directive_id: {
          type: 'string',
          description: 'Optional: directive UUID this grant serves',
          required: false,
        },
        expires_in_hours: {
          type: 'number',
          description: 'Optional: auto-revoke after N hours (default: no expiry)',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const agentRole = params.agent_role as string;
        const toolName = params.tool_name as string;
        const reason = params.reason as string;
        const directiveId = params.directive_id as string | undefined;
        const expiresInHours = params.expires_in_hours as number | undefined;

        // Validate the tool exists
        if (!isKnownTool(toolName)) {
          return {
            success: false,
            error: `Tool "${toolName}" does not exist in the system registry. Cannot grant a tool that doesn't exist. Ask Marcus (CTO) to build it first.`,
          };
        }

        const permissionPolicy = evaluateToolPermissionGate({
          toolName,
          contextText: [reason],
        });

        const expiresAt = expiresInHours
          ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
          : null;

        if (permissionPolicy.requiresApproval) {
          await systemQuery(
            `INSERT INTO decisions (tier, status, title, summary, proposed_by, reasoning, data, assigned_to)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
            [
              'yellow',
              'pending',
              `Restricted Tool Grant: ${toolName} → ${agentRole}`,
              `${ctx.agentRole} requested restricted grant "${toolName}" to ${agentRole}. Reason: ${reason}`,
              ctx.agentRole,
              reason,
              JSON.stringify({
                type: 'restricted_tool_grant_request',
                agent_role: agentRole,
                tool_name: toolName,
                restriction_reason: permissionPolicy.reason,
                matches: permissionPolicy.matches,
                directive_id: directiveId ?? null,
                expires_at: expiresAt,
              }),
              ['kristina'],
            ],
          );

          return {
            success: true,
            data: {
              granted: false,
              pending_approval: true,
              agent_role: agentRole,
              tool_name: toolName,
              approval_reason: permissionPolicy.reason,
              expires_at: expiresAt,
              note: 'Restricted grant request filed as a Yellow decision for Kristina approval.',
            },
          };
        }

        // Upsert the grant
        await systemQuery(
          `INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, reason, directive_id, scope, is_active, expires_at, last_synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (agent_role, tool_name) DO UPDATE SET granted_by = $3, reason = $4, directive_id = $5, scope = $6, is_active = $7, expires_at = $8, last_synced_at = NOW()`,
          [agentRole, toolName, 'chief-of-staff', reason, directiveId ?? null, 'full', true, expiresAt]);

        // Invalidate cache so the grant takes effect immediately
        invalidateGrantCache(agentRole);

        return {
          success: true,
          data: {
            granted: true,
            agent_role: agentRole,
            tool_name: toolName,
            restricted_tool: false,
            expires_at: expiresAt,
            note: 'Tool granted autonomously.',
          },
        };
      },
    },

    {
      name: 'revoke_tool_access',
      description: 'Revoke a dynamically granted tool from an agent. Only revokes DB-granted tools (not the agent\'s static/baseline tools built into their code).',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Agent role to revoke the tool from',
          required: true,
        },
        tool_name: {
          type: 'string',
          description: 'Name of the tool to revoke',
          required: true,
        },
        reason: {
          type: 'string',
          description: 'Why this grant is being revoked',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const agentRole = params.agent_role as string;
        const toolName = params.tool_name as string;

        const data = await systemQuery(
          'UPDATE agent_tool_grants SET is_active = false, updated_at = $1 WHERE agent_role = $2 AND tool_name = $3 AND granted_by = $4 RETURNING *',
          [new Date().toISOString(), agentRole, toolName, 'chief-of-staff']);

        if (!data || (data as any[]).length === 0) {
          return {
            success: false,
            error: `No active dynamic grant found for ${agentRole}:${toolName}. System-granted (baseline) tools cannot be revoked via this tool.`,
          };
        }

        // Invalidate cache
        invalidateGrantCache(agentRole);

        return {
          success: true,
          data: { revoked: true, agent_role: agentRole, tool_name: toolName },
        };
      },
    },

    // ─── PROPOSE DIRECTIVE ────────────────────────────────────

    {
      name: 'propose_directive',
      description: 'Propose a new strategic directive for founder approval. Creates the directive with status "proposed" — it will NOT be dispatched until a founder approves it in the dashboard. Use when agent findings, completed directives, or operational patterns reveal work that needs to happen.',
      parameters: {
        title: {
          type: 'string',
          description: 'Short directive title',
          required: true,
        },
        description: {
          type: 'string',
          description: 'Full context of what needs to be accomplished and why',
          required: true,
        },
        priority: {
          type: 'string',
          description: 'Priority level',
          required: true,
          enum: ['critical', 'high', 'medium', 'low'],
        },
        category: {
          type: 'string',
          description: 'Directive category',
          required: true,
          enum: ['engineering', 'product', 'marketing', 'sales', 'revenue', 'customer_success', 'operations', 'general', 'strategy', 'design'],
        },
        target_agents: {
          type: 'array',
          description: 'Agent display names to assign (e.g. "Elena Vasquez", "Marcus Reeves")',
          required: true,
          items: { type: 'string', description: 'Agent display name' },
        },
        proposal_reason: {
          type: 'string',
          description: 'Evidence-based explanation of why this directive is needed',
          required: true,
        },
        source_directive_id: {
          type: 'string',
          description: 'UUID of the parent directive if this is a follow-up',
          required: false,
        },
        due_date: {
          type: 'string',
          description: 'ISO date string for suggested deadline',
          required: false,
        },
        notify: {
          type: 'string',
          description: 'Which founder to notify',
          required: false,
          enum: ['kristina', 'andrew'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const title = params.title as string;
        const description = params.description as string;
        const priority = params.priority as string;
        const category = params.category as string;
        const targetAgents = params.target_agents as string[];
        const proposalReason = params.proposal_reason as string;
        const sourceDirectiveId = params.source_directive_id as string | undefined;
        const dueDate = params.due_date as string | undefined;
        const notify = (params.notify as string) || 'kristina';

        // 0. De-duplication guard — block re-proposals of recently rejected directives
        const recentRejected = await systemQuery(
          `SELECT id, title, updated_at FROM founder_directives
           WHERE status = 'rejected'
             AND proposed_by = 'chief-of-staff'
             AND updated_at > NOW() - INTERVAL '7 days'
             AND LOWER(title) = LOWER($1)`,
          [title],
        );
        if (recentRejected.length > 0) {
          return {
            success: false,
            error: `Directive "${title}" was rejected ${recentRejected.length > 1 ? `${recentRejected.length} times` : 'recently'} (most recent: ${(recentRejected[0] as any).updated_at}). Do NOT re-propose the same directive. If genuinely new evidence exists, propose under a different title with the new evidence cited.`,
          };
        }

        // 0b. Fuzzy guard — block proposals whose title is a substring of a recent rejection (or vice versa)
        const fuzzyRejected = await systemQuery(
          `SELECT id, title FROM founder_directives
           WHERE status = 'rejected'
             AND proposed_by = 'chief-of-staff'
             AND updated_at > NOW() - INTERVAL '7 days'
             AND (LOWER(title) LIKE '%' || LOWER($1) || '%' OR LOWER($1) LIKE '%' || LOWER(title) || '%')`,
          [title],
        );
        if (fuzzyRejected.length > 0) {
          return {
            success: false,
            error: `A similar directive "${(fuzzyRejected[0] as any).title}" was rejected in the last 7 days. Do NOT re-propose the same work under a different name. Note this in your working memory and move on.`,
          };
        }

        // 1. Insert the proposed directive
        // Pass targetAgents as a native JS array — node-postgres serialises string[] → TEXT[] automatically.
        // JSON.stringify would produce '["a","b"]' which PG rejects as a malformed array literal.
        const columns: string[] = ['title', 'description', 'priority', 'category', 'target_agents', 'status', 'proposed_by', 'created_by', 'proposal_reason'];
        const insertValues: unknown[] = [title, description, priority, category, targetAgents, 'proposed', 'chief-of-staff', notify, proposalReason];
        if (sourceDirectiveId) { columns.push('source_directive_id'); insertValues.push(sourceDirectiveId); }
        if (dueDate) { columns.push('due_date'); insertValues.push(dueDate); }
        const placeholders = insertValues.map((_, i) => `$${i + 1}`).join(', ');

        const [data] = await systemQuery(
          `INSERT INTO founder_directives (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`, insertValues) as any[];

        const directiveId = data.id;
        const [persistedDirective] = await systemQuery<{ id: string }>(
          'SELECT id FROM founder_directives WHERE id = $1 LIMIT 1',
          [directiveId],
        );
        if (!persistedDirective) {
          return {
            success: false,
            error: `Directive write verification failed for ${directiveId}. The directive was not persisted; retry once and escalate if this repeats.`,
          };
        }

        // 2. Generate approval tokens (URL fallback) and send Adaptive Card with inline buttons
        const baseUrl = process.env.PUBLIC_URL ?? process.env.SERVICE_URL ?? '';
        let approveUrl = `${baseUrl}/directives/approve/`;
        let rejectUrl = `${baseUrl}/directives/reject/`;

        try {
          const [approveToken] = await systemQuery<{ token: string }>(
            `INSERT INTO directive_approval_tokens (directive_id, decision) VALUES ($1, 'approve') RETURNING token`,
            [directiveId],
          );
          const [rejectToken] = await systemQuery<{ token: string }>(
            `INSERT INTO directive_approval_tokens (directive_id, decision) VALUES ($1, 'reject') RETURNING token`,
            [directiveId],
          );
          if (approveToken?.token) approveUrl += approveToken.token;
          if (rejectToken?.token) rejectUrl += rejectToken.token;
        } catch (e) {
          console.warn('[CoS] Could not generate approval tokens:', (e as Error).message);
        }

        // Adaptive Card with OpenUrl buttons (works in DMs without Bot Framework Action.Execute routing)
        try {
          const card = formatDirectiveProposalCard({
            directiveId,
            title,
            description,
            priority,
            category,
            targetAgents,
            proposalReason,
            dueDate,
            approveUrl,
            rejectUrl,
          });

          let graphClientForCard: GraphTeamsClient | null = null;
          try {
            graphClientForCard = GraphTeamsClient.fromEnv();
          } catch {
            /* Optional: AZURE_* app creds for Graph DM as the Teams app */
          }
          const a365ForDirectives = A365TeamsChatClient.fromEnv('chief-of-staff');
          const founderDirForDm = buildFounderDirectory();

          let cardSent = false;

          // 1) Graph app credentials → DM as Glyphor app (optional; needs TEAMS_USER_*_ID)
          try {
            if (graphClientForCard) {
              const { TeamsDirectMessageClient } = await import('@glyphor/integrations');
              const dmClient = TeamsDirectMessageClient.fromEnv(graphClientForCard);
              if (dmClient) {
                await dmClient.sendCard(
                  notify as 'kristina' | 'andrew',
                  card,
                  'Sarah Chen',
                );
                cardSent = true;
              }
            }
          } catch (cardErr) {
            console.warn('[CoS] Graph app card DM failed, trying A365 agent card:', (cardErr as Error).message);
          }

          // 2) Same path as send_dm: Sarah’s agent identity + Graph chat message API (Adaptive Card attachment)
          if (!cardSent && a365ForDirectives) {
            try {
              const recipientContact = founderDirForDm[notify as 'kristina' | 'andrew'];
              const recipientUpn = recipientContact?.email
                ?? (notify === 'kristina' ? 'kristina@glyphor.ai' : 'andrew@glyphor.ai');
              const chatId = await a365ForDirectives.createOrGetOneOnOneChat(recipientUpn, undefined, 'chief-of-staff');
              await a365ForDirectives.postChatAdaptiveCard(chatId, card, 'chief-of-staff', 'Sarah Chen');
              cardSent = true;
            } catch (a365CardErr) {
              console.warn('[CoS] A365 adaptive card DM failed, falling back to plain text:', (a365CardErr as Error).message);
            }
          }

          // 3) Last resort: plain text with links (no card rendering)
          if (!cardSent) {
            const sendDmTool = tools.find(t => t.name === 'send_dm');
            if (sendDmTool) {
              const agentList = targetAgents.join(', ');
              const deadlineLine = dueDate ? `\nSuggested deadline: ${dueDate}` : '';
              const dmMessage =
                `PROPOSED DIRECTIVE: ${title}\n\n` +
                `Why: ${proposalReason}\n` +
                `Scope: ${agentList}\n` +
                `Priority: ${priority} | Category: ${category}${deadlineLine}\n\n` +
                `✓ Approve: ${approveUrl}\n` +
                `✕ Reject: ${rejectUrl}`;
              await sendDmTool.execute({ recipient: notify, message: dmMessage }, ctx);
            }
          }
        } catch (e) {
          console.warn('[CoS] Could not DM founder about proposed directive:', (e as Error).message);
        }

        // 3. Log to activity_log
        await systemQuery('INSERT INTO activity_log (agent_role, action, summary) VALUES ($1, $2, $3)',
          [ctx.agentRole, 'directive_proposed', `Proposed directive: ${title} (${directiveId})`]);

        // 4. Return result
        return {
          success: true,
          data: { directive_id: directiveId, status: 'proposed' },
        };
      },
    },

    // ─── DELEGATE DIRECTIVE ───────────────────────────────────

    {
      name: 'delegate_directive',
      description: 'Delegate a directive to a domain executive for decomposition. Critical-priority directives cannot be delegated. On failure, falls back to self-orchestration.',
      parameters: {
        original_directive_id: {
          type: 'string',
          description: 'UUID of the founder directive to delegate',
          required: true,
        },
        delegated_to: {
          type: 'string',
          description: 'Executive agent role (e.g., cto, cmo, cpo)',
          required: true,
        },
        delegation_type: {
          type: 'string',
          description: 'Delegation scope',
          required: true,
          enum: ['full', 'decompose_only'],
        },
        scope: {
          type: 'string',
          description: 'What the executive is responsible for delivering',
          required: true,
        },
        context: {
          type: 'string',
          description: 'Instructions, constraints, and original intent for the executive',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          const originalDirectiveId = params.original_directive_id as string;
          const delegatedTo = params.delegated_to as string;
          const delegationType = params.delegation_type as string;
          const scope = params.scope as string;
          const delegationContext = params.context as string;

          // 1. Fetch the original directive
          const [original] = await systemQuery(
            'SELECT id, title, priority, status FROM founder_directives WHERE id = $1',
            [originalDirectiveId],
          ) as any[];

          if (!original) {
            return { success: false, error: `Directive ${originalDirectiveId} not found` };
          }

          // Critical directives must NOT be delegated
          if (original.priority === 'critical') {
            return {
              success: false,
              error: 'Critical-priority directives cannot be delegated — Sarah must orchestrate directly.',
            };
          }

          // 2. Verify executive has orchestration capability
          const [config] = await systemQuery(
            'SELECT * FROM executive_orchestration_config WHERE executive_role = $1 AND can_decompose = true',
            [delegatedTo],
          ) as any[];

          if (!config) {
            return {
              success: false,
              error: `Executive ${delegatedTo} is not enabled for decomposition (no config or can_decompose=false). Fall back to self-orchestration.`,
            };
          }

          // 3. Create sub-directive
          const subTitle = `[${delegatedTo.toUpperCase()}] ${original.title}`;
          const [subDirective] = await systemQuery(
            `INSERT INTO founder_directives
              (title, description, priority, status, parent_directive_id, delegated_to, delegation_type, delegated_at, delegation_context, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)
            RETURNING id`,
            [subTitle, scope, original.priority, 'active', originalDirectiveId, delegatedTo, delegationType, delegationContext, 'chief-of-staff'],
          ) as any[];

          const subDirectiveId = subDirective.id;

          // 4. Increment canary_directive_count if canary
          if (config.is_canary) {
            await systemQuery(
              'UPDATE executive_orchestration_config SET canary_directive_count = canary_directive_count + 1, updated_at = NOW() WHERE executive_role = $1',
              [delegatedTo],
            );
          }

          // 5. Send message to executive via agent_messages
          await systemQuery(
            'INSERT INTO agent_messages (from_agent, to_agent, message, message_type, priority, status) VALUES ($1, $2, $3, $4, $5, $6)',
            [
              'chief-of-staff',
              delegatedTo,
              `**Delegated Directive from Sarah (Chief of Staff)**\n\n` +
              `**Original Directive:** ${original.title}\n` +
              `**Delegation Type:** ${delegationType}\n` +
              `**Priority:** ${original.priority}\n\n` +
              `**Your Scope:**\n${scope}\n\n` +
              `**Context & Constraints:**\n${delegationContext}\n\n` +
              `Decompose this into work assignments for your team. ` +
              (delegationType === 'full'
                ? 'You own decomposition AND evaluation for this directive.'
                : 'You own decomposition only — Sarah will evaluate outputs.'),
              'request',
              original.priority === 'high' ? 'urgent' : 'normal',
              'pending',
            ],
          );

          // 6. Emit directive.delegated event to wake the executive
          if (glyphorEventBus) {
            await glyphorEventBus.emit({
              type: 'directive.delegated',
              source: 'chief-of-staff',
              payload: {
                sub_directive_id: subDirectiveId,
                original_directive_id: originalDirectiveId,
                delegated_to: delegatedTo,
                delegation_type: delegationType,
              },
              priority: 'high',
            });
          }

          // 7. Log activity
          await systemQuery(
            'INSERT INTO activity_log (agent_role, action, summary) VALUES ($1, $2, $3)',
            [ctx.agentRole, 'directive_delegated', `Delegated "${original.title}" to ${delegatedTo} (sub: ${subDirectiveId}, type: ${delegationType})`],
          );

          return {
            success: true,
            data: {
              sub_directive_id: subDirectiveId,
              delegated_to: delegatedTo,
              delegation_type: delegationType,
            },
          };
        } catch (err) {
          console.warn('[CoS] Delegation failed, fall back to self-orchestration:', (err as Error).message);
          return {
            success: false,
            error: `Delegation failed: ${(err as Error).message}. Fall back to self-orchestration for this directive.`,
          };
        }
      },
    },
  ];
}

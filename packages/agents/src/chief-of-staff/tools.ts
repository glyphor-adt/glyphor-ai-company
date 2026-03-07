/**
 * Chief of Staff — Tool Definitions
 *
 * Tools for: reading company state, generating briefings,
 * routing decisions, posting to Teams.
 */

import type { ToolDefinition, ToolContext, ToolResult, BriefingData, CompanyAgentRole, StructuredReflection, OrchestratorGrade } from '@glyphor/agent-runtime';
import { WRITE_TOOLS, invalidateGrantCache } from '@glyphor/agent-runtime';
import { isKnownTool } from '@glyphor/agent-runtime';
import type { GlyphorEventBus } from '@glyphor/agent-runtime';
import { markOutcomeRevised, markOutcomeAccepted } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { CompanyMemoryStore, SharedMemoryLoader, WorldModelUpdater, EmbeddingClient } from '@glyphor/company-memory';
import type { KnowledgeGraphReader } from '@glyphor/company-memory';
import {
  sendTeamsWebhook,
  formatBriefingCard,
  GraphTeamsClient,
  buildChannelMap,
  BotDmSender,
  GraphCalendarClient,
  buildFounderDirectory,
  TeamsBotHandler,
} from '@glyphor/integrations';

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

  // Initialize Bot Framework handler for channel messages (proactive cards)
  // Graph API's Teamwork.Migrate.All permission only allows imports, not regular
  // channel messaging, so we use the Bot Framework REST API instead.
  const botHandler = TeamsBotHandler.fromEnv(async () => {});

  // Initialize DM sender (uses Bot Framework proactive messaging —
  // Graph API app-only tokens cannot post chat messages)
  // Email is now handled by shared/emailTools.ts (per-agent mailboxes)
  let dmClient: BotDmSender | null = null;
  let calendarClient: GraphCalendarClient | null = null;
  if (graphClient) {
    dmClient = BotDmSender.fromEnv(graphClient);
    calendarClient = GraphCalendarClient.fromEnv(graphClient);
  }
  const founderDir = buildFounderDirectory();

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
      name: 'get_product_metrics',
      description: 'Get current metrics for a product (Fuse or Pulse). Returns MRR, active users, build stats.',
      parameters: {
        product: {
          type: 'string',
          description: 'Product slug',
          required: true,
          enum: ['fuse', 'pulse'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const metrics = await memory.getProductMetrics(params.product as 'fuse' | 'pulse');
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
      description: 'Read a value from company shared memory by key. Use namespace keys like "company.vision", "product.fuse.metrics".',
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
      description: 'Send a morning briefing to a founder via Teams webhook. Also archives to GCS.',
      parameters: {
        recipient: {
          type: 'string',
          description: 'Founder to send briefing to',
          required: true,
          enum: ['kristina', 'andrew'],
        },
        briefing_markdown: {
          type: 'string',
          description: 'The full briefing content in markdown format',
          required: true,
        },
        metrics: {
          type: 'array',
          description: 'Key metrics to highlight at the top of the briefing card',
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
        const recipient = params.recipient as string;
        const markdown = params.briefing_markdown as string;
        const metrics = params.metrics as BriefingData['metrics'];
        const actionItems = (params.action_items as string[]) || [];

        // Format as Teams Adaptive Card
        const card = formatBriefingCard({
          recipient,
          metrics,
          markdown,
          actionItems,
          date: new Date().toISOString().split('T')[0],
        });

        // Send via Bot Framework (preferred) or webhook fallback
        const channelKey = recipient === 'kristina' ? 'briefingKristina' : 'briefingAndrew';
        const channel = channels[channelKey];

        if (botHandler && channel) {
          await botHandler.sendProactiveCardToChannel(channel.teamId, channel.channelId, card.attachments[0].content as unknown as Record<string, unknown>);
        } else {
          // Fallback to webhook
          const webhookUrl = recipient === 'kristina'
            ? process.env.TEAMS_WEBHOOK_KRISTINA_BRIEFING
            : process.env.TEAMS_WEBHOOK_ANDREW_BRIEFING;

          if (!webhookUrl) {
            return {
              success: false,
              error: `No Teams channel configured for ${recipient}. Set TEAMS_CHANNEL_BRIEFING_${recipient.toUpperCase()}_ID or TEAMS_WEBHOOK_${recipient.toUpperCase()}_BRIEFING env var.`,
            };
          }

          await sendTeamsWebhook(webhookUrl, card);
        }

        // Archive to GCS
        const date = new Date().toISOString().split('T')[0];
        await memory.writeDocument(
          `briefings/${recipient}/${date}.md`,
          markdown,
        );

        // Log activity
        await memory.appendActivity({
          agentRole: 'chief-of-staff',
          action: 'briefing',
          product: 'company',
          summary: `Morning briefing sent to ${recipient}`,
          createdAt: new Date().toISOString(),
        });

        return { success: true, data: { sent: true, archived: true }, memoryKeysWritten: 1 };
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

        // Send to Teams #Decisions channel via Bot Framework
        const decisionsChannel = channels.decisions;
        if (botHandler && decisionsChannel) {
          const { formatDecisionCard } = await import('@glyphor/integrations');
          const card = formatDecisionCard({
            id,
            tier: params.tier as string,
            title: params.title as string,
            summary: params.summary as string,
            proposedBy: ctx.agentRole,
            reasoning: params.reasoning as string,
            assignedTo: params.assigned_to as string[],
          });
          await botHandler.sendProactiveCardToChannel(decisionsChannel.teamId, decisionsChannel.channelId, card.attachments[0].content as unknown as Record<string, unknown>);
        } else {
          // Fallback to webhook
          const webhookUrl = process.env.TEAMS_WEBHOOK_DECISIONS;
          if (webhookUrl) {
            const { formatDecisionCard } = await import('@glyphor/integrations');
            const card = formatDecisionCard({
              id,
              tier: params.tier as string,
              title: params.title as string,
              summary: params.summary as string,
              proposedBy: ctx.agentRole,
              reasoning: params.reasoning as string,
              assignedTo: params.assigned_to as string[],
            });
            await sendTeamsWebhook(webhookUrl, card);
          }
        }

        return { success: true, data: { decisionId: id }, memoryKeysWritten: 1 };
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
          description: 'Related product (or "company" for company-wide)',
          required: false,
          enum: ['fuse', 'pulse', 'company'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: params.action as 'analysis' | 'decision' | 'alert' | 'briefing',
          product: (params.product as 'fuse' | 'pulse' | 'company') ?? 'company',
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
      description: 'Send a direct message to a founder via Teams 1:1 chat. GREEN for Sarah — use for urgent alerts, briefing follow-ups, or time-sensitive items.',
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
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        if (!dmClient) {
          return {
            success: false,
            error: 'DM client not configured. Set TEAMS_USER_KRISTINA_ID and/or TEAMS_USER_ANDREW_ID.',
          };
        }

        const recipient = params.recipient as 'kristina' | 'andrew';
        await dmClient.sendText(recipient, params.message as string, 'Sarah Chen');

        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: 'alert',
          product: 'company',
          summary: `DM sent to ${recipient}`,
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
      description: 'Read active strategic directives from the founders. Returns all directives that are active or have pending work assignments. Use this at the start of every orchestration run to understand current priorities.',
      parameters: {
        status: {
          type: 'string',
          description: 'Filter by directive status. Default: active',
          required: false,
          enum: ['active', 'paused', 'completed', 'all'],
        },
        created_by: {
          type: 'string',
          description: 'Filter by founder. Default: all',
          required: false,
          enum: ['kristina', 'andrew', 'all'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const status = (params.status as string) || 'active';
        const createdBy = (params.created_by as string) || 'all';

        // 1. Get directives
        let sql = 'SELECT * FROM founder_directives';
        const conditions: string[] = [];
        const queryParams: unknown[] = [];
        if (status !== 'all') { queryParams.push(status); conditions.push(`status = $${queryParams.length}`); }
        if (createdBy !== 'all') { queryParams.push(createdBy); conditions.push(`created_by = $${queryParams.length}`); }
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

        // 4. Build formatted result
        const formatted = (directives as any[]).map((d: any) => {
          const wa = assignmentsByDirective.get(d.id) || [];
          return {
            id: d.id,
            title: d.title,
            description: d.description,
            priority: d.priority,
            category: d.category,
            status: d.status,
            created_by: d.created_by,
            due_date: d.due_date,
            target_agents: d.target_agents,
            progress_notes: d.progress_notes,
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

        return { success: true, data: formatted };
      },
    },

    // ─── CREATE WORK ASSIGNMENTS ──────────────────────────────

    {
      name: 'create_work_assignments',
      description: 'Break a founder directive into executive-level work assignments. Assign to executives (CTO, CPO, CMO, etc.) who will decompose into team tasks. For direct reports (ops, global-admin, m365-admin), assign directly.',
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
              assigned_to: { type: 'string', description: 'Agent role (e.g., cto, cpo, cmo — prefer executives)' },
              task_description: { type: 'string', description: 'Clear outcome description for the executive' },
              task_type: { type: 'string', description: 'Agent task type (e.g., on_demand, blog_post)' },
              expected_output: { type: 'string', description: 'What you expect the executive to deliver' },
              priority: { type: 'string', description: 'Priority level', enum: ['urgent', 'high', 'normal', 'low'] },
              sequence_order: { type: 'number', description: 'Execution order. 0 = immediate.' },
              assignment_type: { type: 'string', description: 'Type of assignment', enum: ['executive_outcome', 'standard'] },
            },
          },
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const assignments = params.assignments as any[];
        const directiveId = params.directive_id as string;

        // Insert as 'draft' initially; plan verification promotes to 'pending'
        const rows = assignments.map((a: any, i: number) => ({
          directive_id: directiveId,
          assigned_to: a.assigned_to,
          assigned_by: 'chief-of-staff',
          task_description: a.task_description,
          task_type: a.task_type || 'on_demand',
          expected_output: a.expected_output,
          priority: a.priority || 'normal',
          sequence_order: a.sequence_order ?? i,
          assignment_type: a.assignment_type || 'executive_outcome',
          status: 'draft',
        }));

        const columns = '(directive_id, assigned_to, assigned_by, task_description, task_type, expected_output, priority, sequence_order, assignment_type, status)';
        const values: unknown[] = [];
        const placeholders: string[] = [];
        for (const a of rows) {
          const offset = values.length;
          placeholders.push(`($${offset+1}, $${offset+2}, $${offset+3}, $${offset+4}, $${offset+5}, $${offset+6}, $${offset+7}, $${offset+8}, $${offset+9}, $${offset+10})`);
          values.push(a.directive_id, a.assigned_to, a.assigned_by, a.task_description, a.task_type, a.expected_output, a.priority, a.sequence_order, a.assignment_type, a.status);
        }
        const data = await systemQuery(`INSERT INTO work_assignments ${columns} VALUES ${placeholders.join(', ')} RETURNING *`, values);
        const createdIds = (data as any[]).map((r: any) => r.id);

        // ── Plan Verification ──
        // Verify the decomposition plan before promoting assignments to 'pending'.
        // Uses dynamic import to avoid circular dependency (scheduler → agents).
        let verification: { verdict: string; suggestions: string[] } | null = null;
        try {
          const scheduler = await import('@glyphor/scheduler');
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
              proposed_assignments: assignments.map((a: any, i: number) => ({
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
                "INSERT INTO activity_log (agent_role, activity_type, description) VALUES ($1, $2, $3)",
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
                  "INSERT INTO activity_log (agent_role, activity_type, description) VALUES ($1, $2, $3)",
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

        // 2. Send inter-agent message to the target agent
        const directiveTitle = assignment.directive_title ?? 'Unknown directive';

        await systemQuery('INSERT INTO agent_messages (from_agent, to_agent, message, message_type, priority, status) VALUES ($1, $2, $3, $4, $5, $6)',
          ['chief-of-staff', assignment.assigned_to,
            `**Work Assignment from Sarah (Chief of Staff)**\n\n` +
            `**Directive:** ${directiveTitle}\n` +
            `**Priority:** ${assignment.priority}\n\n` +
            `**Your Task:**\n${assignment.task_description}\n\n` +
            `**Expected Output:**\n${assignment.expected_output}\n\n` +
            `**ACTION MODE:** This is not a report-only task. You are expected to TAKE ACTION:\n` +
            `- If you find issues you can fix → fix them immediately and log what you did\n` +
            `- If you find issues requiring another agent → use send_agent_message to assign them with specifics\n` +
            `- If you hit a blocker → use flag_assignment_blocker immediately, don't just note it\n` +
            `- Your output should be a punch list of: what you fixed, what you assigned (to whom), and what's still blocked\n\n` +
            `This is a founder-level priority. Act, don't just analyze.`,
            'request', assignment.priority === 'urgent' ? 'urgent' : 'normal', 'pending']);

        // 3. Schedule the agent to run
        try {
          await fetch(`${schedulerUrl}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentRole: assignment.assigned_to,
              task: assignment.task_type,
              message: assignment.task_description,
              payload: { directiveAssignmentId: assignmentId },
            }),
          });
        } catch (e) {
          console.warn(`[Orchestration] Could not immediately dispatch to ${assignment.assigned_to}:`, e);
        }

        // 4. Update assignment status
        await systemQuery('UPDATE work_assignments SET status = $1, dispatched_at = $2 WHERE id = $3',
          ['dispatched', new Date().toISOString(), assignmentId]);

        return { success: true, data: { dispatched: true, agent: assignment.assigned_to } };
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
            const sharedMemLoader = new SharedMemoryLoader(embeddingClient, graphReader ?? null);
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
      execute: async (params, _ctx): Promise<ToolResult> => {
        const directiveId = params.directive_id as string;

        // Get current directive to append to progress_notes
        const [directive] = await systemQuery(
          'SELECT progress_notes FROM founder_directives WHERE id = $1', [directiveId]) as any[];

        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

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

        return { success: true, data: { updated: true } };
      },
    },

    // ─── DYNAMIC TOOL GRANTS ──────────────────────────────────

    {
      name: 'grant_tool_access',
      description: 'Grant an existing tool to an agent. Read-only tools (get_*, read_*, query_*, check_*, fetch_*) can be granted autonomously. Write tools auto-file a Yellow decision for founder approval. The tool must exist in the system registry.',
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

        // Check if this is a write tool — requires Yellow decision
        const isWrite = WRITE_TOOLS.has(toolName);

        const expiresAt = expiresInHours
          ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
          : null;

        // Upsert the grant
        await systemQuery(
          `INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, reason, directive_id, scope, is_active, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (agent_role, tool_name) DO UPDATE SET granted_by = $3, reason = $4, directive_id = $5, scope = $6, is_active = $7, expires_at = $8`,
          [agentRole, toolName, 'chief-of-staff', reason, directiveId ?? null, 'full', true, expiresAt]);

        // Invalidate cache so the grant takes effect immediately
        invalidateGrantCache(agentRole);

        return {
          success: true,
          data: {
            granted: true,
            agent_role: agentRole,
            tool_name: toolName,
            is_write_tool: isWrite,
            expires_at: expiresAt,
            note: isWrite
              ? 'This is a WRITE tool — a Yellow decision should be filed for founder awareness.'
              : 'Read-only tool granted autonomously.',
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

        // 2. Send Teams DM to the target founder
        const agentList = targetAgents.join(', ');
        const deadlineLine = dueDate ? `\nSuggested deadline: ${dueDate}` : '';
        const dmMessage =
          `PROPOSED DIRECTIVE: ${title}\n\n` +
          `Why: ${proposalReason}\n` +
          `Scope: ${agentList}\n` +
          `Priority: ${priority} | Category: ${category}${deadlineLine}\n\n` +
          `→ Approve, modify, or reject in Dashboard → Directives`;

        // Use the send_dm tool's underlying client if available
        try {
          const sendDmTool = tools.find(t => t.name === 'send_dm');
          if (sendDmTool) {
            await sendDmTool.execute({ recipient: notify, message: dmMessage }, ctx);
          }
        } catch (e) {
          console.warn('[CoS] Could not DM founder about proposed directive:', (e as Error).message);
        }

        // 3. Log to activity_log
        await systemQuery('INSERT INTO activity_log (agent_role, agent_id, action, detail) VALUES ($1, $2, $3, $4)',
          [ctx.agentRole, ctx.agentRole, 'directive_proposed', `Proposed directive: ${title} (${directiveId})`]);

        // 4. Return result
        return {
          success: true,
          data: { directive_id: directiveId, status: 'proposed' },
        };
      },
    },
  ];
}

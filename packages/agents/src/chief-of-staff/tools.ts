/**
 * Chief of Staff — Tool Definitions
 *
 * Tools for: reading company state, generating briefings,
 * routing decisions, posting to Teams.
 */

import type { ToolDefinition, ToolContext, ToolResult, BriefingData } from '@glyphor/agent-runtime';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import {
  sendTeamsWebhook,
  formatBriefingCard,
  GraphTeamsClient,
  buildChannelMap,
  TeamsDirectMessageClient,
  GraphEmailClient,
  GraphCalendarClient,
  buildFounderDirectory,
} from '@glyphor/integrations';

export function createChiefOfStaffTools(
  memory: CompanyMemoryStore,
): ToolDefinition[] {
  // Initialize Graph API client if Azure credentials are configured
  let graphClient: GraphTeamsClient | null = null;
  try {
    graphClient = GraphTeamsClient.fromEnv();
  } catch {
    // Graph API not configured — will fall back to webhooks
  }
  const channels = buildChannelMap();

  // Initialize DM, email, and calendar clients
  let dmClient: TeamsDirectMessageClient | null = null;
  let emailClient: GraphEmailClient | null = null;
  let calendarClient: GraphCalendarClient | null = null;
  if (graphClient) {
    dmClient = TeamsDirectMessageClient.fromEnv(graphClient);
    emailClient = GraphEmailClient.fromEnv(graphClient);
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

        // Send via Graph API (preferred) or webhook fallback
        const channelKey = recipient === 'kristina' ? 'briefingKristina' : 'briefingAndrew';
        const channel = channels[channelKey];

        if (graphClient && channel) {
          await graphClient.sendCard(channel, card.attachments[0].content);
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

        // Send to Teams #Decisions channel
        const decisionsChannel = channels.decisions;
        if (graphClient && decisionsChannel) {
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
          await graphClient.sendCard(decisionsChannel, card.attachments[0].content);
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

    // ─── EMAIL ──────────────────────────────────────────────────

    {
      name: 'send_email',
      description: 'Send an email via the company mailbox. Always YELLOW — requires founder approval before sending.',
      parameters: {
        to: {
          type: 'array',
          description: 'Recipient email addresses',
          required: true,
          items: { type: 'string', description: 'Email address' },
        },
        subject: {
          type: 'string',
          description: 'Email subject line',
          required: true,
        },
        body: {
          type: 'string',
          description: 'Email body (HTML supported)',
          required: true,
        },
        cc: {
          type: 'array',
          description: 'CC email addresses',
          required: false,
          items: { type: 'string', description: 'Email address' },
        },
        importance: {
          type: 'string',
          description: 'Email importance',
          required: false,
          enum: ['low', 'normal', 'high'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        if (!emailClient) {
          return {
            success: false,
            error: 'Email client not configured. Set GLYPHOR_MAIL_SENDER_ID.',
          };
        }

        const toAddrs = (params.to as string[]).map(email => ({ email }));
        const ccAddrs = params.cc ? (params.cc as string[]).map(email => ({ email })) : undefined;

        await emailClient.sendEmail({
          to: toAddrs,
          cc: ccAddrs,
          subject: params.subject as string,
          body: params.body as string,
          importance: (params.importance as 'low' | 'normal' | 'high') ?? 'normal',
        });

        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: 'alert',
          product: 'company',
          summary: `Email sent: ${params.subject}`,
          createdAt: new Date().toISOString(),
        });

        return { success: true, data: { sent: true, to: params.to, subject: params.subject } };
      },
    },

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
  supabase: SupabaseClient,
  schedulerUrl: string,
): ToolDefinition[] {
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

        let query = supabase
          .from('founder_directives')
          .select(`
            *,
            work_assignments (
              id, assigned_to, task_description, status, quality_score, completed_at
            )
          `)
          .order('priority', { ascending: true })
          .order('created_at', { ascending: false });

        if (status !== 'all') {
          query = query.eq('status', status);
        }
        if (createdBy !== 'all') {
          query = query.eq('created_by', createdBy);
        }

        const { data, error } = await query;
        if (error) return { success: false, error: error.message };

        const formatted = (data ?? []).map((d: any) => ({
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
          assignments: d.work_assignments,
          assignment_summary: {
            total: d.work_assignments?.length || 0,
            completed: d.work_assignments?.filter((a: any) => a.status === 'completed').length || 0,
            pending: d.work_assignments?.filter((a: any) => a.status === 'pending').length || 0,
            in_progress: d.work_assignments?.filter((a: any) =>
              ['dispatched', 'in_progress'].includes(a.status)
            ).length || 0,
          },
        }));

        return { success: true, data: formatted };
      },
    },

    // ─── CREATE WORK ASSIGNMENTS ──────────────────────────────

    {
      name: 'create_work_assignments',
      description: 'Break a founder directive into specific agent work assignments. Creates one or more assignments linked to a directive.',
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
              assigned_to: { type: 'string', description: 'Agent role (e.g., cmo, vp-sales, cto)' },
              task_description: { type: 'string', description: 'Clear, specific task for the agent' },
              task_type: { type: 'string', description: 'Agent task type (e.g., on_demand, blog_post)' },
              expected_output: { type: 'string', description: 'What you expect the agent to produce' },
              priority: { type: 'string', description: 'Priority level', enum: ['urgent', 'high', 'normal', 'low'] },
              sequence_order: { type: 'number', description: 'Execution order. 0 = immediate.' },
            },
          },
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const assignments = params.assignments as any[];
        const directiveId = params.directive_id as string;

        const rows = assignments.map((a: any, i: number) => ({
          directive_id: directiveId,
          assigned_to: a.assigned_to,
          task_description: a.task_description,
          task_type: a.task_type || 'on_demand',
          expected_output: a.expected_output,
          priority: a.priority || 'normal',
          sequence_order: a.sequence_order ?? i,
          status: 'pending',
        }));

        const { data, error } = await supabase
          .from('work_assignments')
          .insert(rows)
          .select();

        if (error) return { success: false, error: error.message };
        return { success: true, data: { created: data.length, assignments: data } };
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
        const { data: assignment, error } = await supabase
          .from('work_assignments')
          .select('*, founder_directives(title, priority)')
          .eq('id', assignmentId)
          .single();

        if (error || !assignment) {
          return { success: false, error: error?.message || 'Assignment not found' };
        }

        // 2. Send inter-agent message to the target agent
        const directiveTitle = (assignment as any).founder_directives?.title ?? 'Unknown directive';
        const directivePriority = (assignment as any).founder_directives?.priority ?? 'high';

        await supabase.from('agent_messages').insert({
          from_agent: 'chief-of-staff',
          to_agent: assignment.assigned_to,
          message: `📋 **Work Assignment from Sarah (Chief of Staff)**\n\n` +
            `**Directive:** ${directiveTitle}\n` +
            `**Priority:** ${assignment.priority}\n\n` +
            `**Your Task:**\n${assignment.task_description}\n\n` +
            `**Expected Output:**\n${assignment.expected_output}\n\n` +
            `Please complete this and report back. This is a founder-level priority.`,
          message_type: 'request',
          priority: assignment.priority === 'urgent' ? 'urgent' : 'normal',
          status: 'pending',
        });

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
        await supabase
          .from('work_assignments')
          .update({ status: 'dispatched', dispatched_at: new Date().toISOString() })
          .eq('id', assignmentId);

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

        let query = supabase
          .from('work_assignments')
          .select('*')
          .eq('directive_id', directiveId)
          .order('sequence_order');

        if (statusFilter !== 'all') {
          query = query.eq('status', statusFilter);
        }

        const { data, error } = await query;
        if (error) return { success: false, error: error.message };

        return { success: true, data };
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
          updates.status = 'pending';
        } else if (nextAction === 'escalate') {
          updates.status = 'blocked';
        }

        const { error } = await supabase
          .from('work_assignments')
          .update(updates)
          .eq('id', assignmentId);

        if (error) return { success: false, error: error.message };
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
        const { data: directive } = await supabase
          .from('founder_directives')
          .select('progress_notes')
          .eq('id', directiveId)
          .single();

        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

        if (params.progress_note) {
          const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
          const notes: string[] = (directive?.progress_notes as string[]) || [];
          notes.push(`[${timestamp}] ${params.progress_note}`);
          updates.progress_notes = notes;
        }

        if (params.new_status) updates.status = params.new_status;
        if (params.completion_summary) updates.completion_summary = params.completion_summary;

        const { error } = await supabase
          .from('founder_directives')
          .update(updates)
          .eq('id', directiveId);

        if (error) return { success: false, error: error.message };
        return { success: true, data: { updated: true } };
      },
    },
  ];
}

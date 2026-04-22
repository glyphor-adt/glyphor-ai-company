/**
 * Chief of Staff — Runner Entry Point
 *
 * Executes the Chief of Staff agent for briefings or on-demand tasks.
 * Can be invoked via Cloud Scheduler cron or direct HTTP request.
 */

import { getGoogleAiApiKey } from '@glyphor/shared';


import {
  CompanyAgentRunner,
  ModelClient,
  AgentSupervisor,
  ToolExecutor,
  EventBus,
  GlyphorEventBus,
  type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { systemQuery } from '@glyphor/shared/db';
import {
  CHIEF_OF_STAFF_SYSTEM_PROMPT,
  ORCHESTRATION_PROMPT,
  STRATEGIC_PLANNING_PROMPT,
} from './systemPrompt.js';
import { createChiefOfStaffTools, createOrchestrationTools } from './tools.js';
import {
  REQUIRED_COMPANY_DOCTRINE_SECTIONS,
  createCollectiveIntelligenceTools,
} from '../shared/collectiveIntelligenceTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createAgentCreationTools } from '../shared/agentCreationTools.js';
import { createAgentManagementTools } from '../shared/agentManagementTools.js';
import { createToolGrantTools } from '../shared/toolGrantTools.js';
import { createAgentDirectoryTools } from '../shared/agentDirectoryTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';
import { createResearchTools } from '../shared/researchTools.js';
import { effectiveMaxTurnsForReactiveTask } from '../shared/reactiveTurnBudget.js';
import { createGithubFromTemplateTools, createGithubPushFilesTools, createGithubPullRequestTools, createVercelProjectTools, createCloudflarePreviewTools } from '@glyphor/integrations';

export interface CoSRunParams {
  task?:
    | 'generate_briefing'
    | 'check_escalations'
    | 'weekly_review'
    | 'monthly_retrospective'
    | 'orchestrate'
    | 'strategic_planning'
    | 'midday_digest'
    | 'process_directive'
    | 'heartbeat_response'
    | 'agent365_mail_triage'
    | 'on_demand';
  recipient?: 'kristina' | 'andrew' | 'both';
  message?: string;
  context?: Record<string, unknown>;
  conversationHistory?: ConversationTurn[];
  dryRun?: boolean;
  evalMode?: boolean;
  systemPromptOverride?: string;
}

/**
 * Gathers directive lifecycle context for injection into the orchestrate prompt.
 * Returns a formatted string with:
 * A. Directives where all assignments are completed (candidates for synthesis)
 * B. Decisions pending > 2 hours (candidates for reminder DM)
 * C. Assignments blocked on founder_input > 4 hours (candidates for escalation DM)
 */
async function gatherDirectiveLifecycleContext(): Promise<string> {
  const sections: string[] = [];

  try {
    // A. Directives with all assignments completed (candidates for synthesis)
    const activeDirectives = await systemQuery('SELECT id, title, created_by, status FROM founder_directives WHERE status = $1', ['active']);
    const directiveIds = activeDirectives.map((d: any) => d.id);
    let allAssignments: any[] = [];
    if (directiveIds.length > 0) {
      allAssignments = await systemQuery('SELECT id, directive_id, assigned_to, status, quality_score, task_description, output, evaluation, need_type, blocker_reason, updated_at FROM work_assignments WHERE directive_id = ANY($1)', [directiveIds]);
    }
    // Group assignments by directive_id
    const assignmentMap = new Map<string, any[]>();
    for (const a of allAssignments) {
      const list = assignmentMap.get(a.directive_id) || [];
      list.push(a);
      assignmentMap.set(a.directive_id, list);
    }
    // Attach to directives
    for (const d of activeDirectives as any[]) {
      d.work_assignments = assignmentMap.get(d.id) || [];
    }

    if (activeDirectives && activeDirectives.length > 0) {
      const completionCandidates = activeDirectives.filter((d: any) => {
        const assignments = d.work_assignments || [];
        return assignments.length > 0 && assignments.every((a: any) => a.status === 'completed');
      });

      if (completionCandidates.length > 0) {
        sections.push(`## COMPLETION CANDIDATES — Directives ready for synthesis\n\nThese directives have ALL assignments completed. Review quality scores and, if all >= 70, run the completion synthesis protocol (synthesize outputs, send DM to creator, mark complete).\n`);
        for (const d of completionCandidates) {
          const assignments = (d as any).work_assignments || [];
          const assignmentSummary = assignments.map((a: any) =>
            `  - ${a.assigned_to}: quality=${a.quality_score ?? 'not evaluated'} | output preview: ${(a.output || 'no output recorded').substring(0, 200)}`
          ).join('\n');
          sections.push(`Directive: "${(d as any).title}" (id: ${(d as any).id})\n   Created by: ${(d as any).created_by}\n   Assignments:\n${assignmentSummary}\n`);
        }
      }

      // C. Assignments blocked on founder_input > 4 hours
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const blockedAssignments: Array<{ directive: any; assignment: any }> = [];

      for (const d of activeDirectives) {
        const assignments = (d as any).work_assignments || [];
        for (const a of assignments) {
          if (
            a.status === 'blocked' &&
            a.need_type === 'founder_input' &&
            a.updated_at && a.updated_at < fourHoursAgo
          ) {
            blockedAssignments.push({ directive: d, assignment: a });
          }
        }
      }

      if (blockedAssignments.length > 0) {
        sections.push(`## STUCK BLOCKERS — Assignments needing founder input (> 4 hours)\n\nThese assignments are blocked waiting for founder input. DM the directive creator with the agent's question and suggested options.\n`);
        for (const { directive, assignment } of blockedAssignments) {
          const waitHours = Math.round((Date.now() - new Date(assignment.updated_at).getTime()) / (1000 * 60 * 60));
          sections.push(`Directive: "${directive.title}" (id: ${directive.id})\n   Blocked agent: ${assignment.assigned_to}\n   Waiting: ${waitHours} hours\n   Blocker: ${assignment.blocker_reason || 'No reason recorded'}\n   DM target: ${directive.created_by}\n`);
        }
      }
    }

    // B. Decisions pending > 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const stuckDecisions = await systemQuery('SELECT id, title, tier, summary, assigned_to, created_at FROM decisions WHERE status = $1 AND created_at < $2 ORDER BY created_at ASC', ['pending', twoHoursAgo]);

    if (stuckDecisions && stuckDecisions.length > 0) {
      sections.push(`## STUCK DECISIONS — Pending > 2 hours\n\nThese decisions have been pending for over 2 hours. Send a reminder DM to the assigned approver. Do NOT remind more than once per decision per day — check working memory first.\n`);
      for (const dec of stuckDecisions) {
        const waitHours = Math.round((Date.now() - new Date(dec.created_at).getTime()) / (1000 * 60 * 60));
        const assignedTo = Array.isArray(dec.assigned_to) ? dec.assigned_to.join(', ') : dec.assigned_to;
        sections.push(`Decision: "${dec.title}" (id: ${dec.id})\n   Tier: ${dec.tier} | Waiting: ${waitHours} hours\n   Assigned to: ${assignedTo}\n   Summary: ${(dec.summary || '').substring(0, 200)}\n`);
      }
    }

    // D. Recently rejected directives — DO NOT re-propose these
    const rejectedDirectives = await systemQuery(
      `SELECT id, title, updated_at FROM founder_directives
       WHERE status = 'rejected' AND proposed_by = 'chief-of-staff'
         AND updated_at > NOW() - INTERVAL '7 days'
       ORDER BY updated_at DESC`,
    );
    if (rejectedDirectives.length > 0) {
      sections.push(`## REJECTED DIRECTIVES — Do NOT re-propose\n\nThese directives were rejected by founders in the last 7 days. Do NOT propose the same work again under any title variation. Note them in your working memory and move on.\n`);
      for (const d of rejectedDirectives as any[]) {
        sections.push(`  - "${d.title}" (rejected ${d.updated_at})`);
      }
      sections.push('');
    }
  } catch (e) {
    console.warn('[CoS] Failed to gather directive lifecycle context:', (e as Error).message);
    sections.push('(Could not load directive lifecycle context — proceed with standard orchestration.)');
  }

  if (sections.length === 0) {
    return '## DIRECTIVE LIFECYCLE STATUS\n\nNo completion candidates, stuck decisions, or stuck blockers found. Proceed with standard orchestration.';
  }

  return sections.join('\n');
}

export async function runChiefOfStaff(params: CoSRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: getGoogleAiApiKey(),
  });
  const runner = createRunner(modelClient, 'chief-of-staff', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const schedulerUrl = process.env.SCHEDULER_URL || 'http://localhost:8080';
  const cosTools = createChiefOfStaffTools(memory, glyphorEventBus);
  const orchestrationTools = createOrchestrationTools(schedulerUrl, glyphorEventBus, cosTools, graphReader);
  const tools = [
    ...cosTools,
    ...createToolGrantTools('chief-of-staff'),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...createCollectiveIntelligenceTools(memory),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createSharePointTools(),
    ...orchestrationTools,
    ...createAgentCreationTools(),
    ...createAgentDirectoryTools(),
    ...createAgentManagementTools(),
    ...createResearchTools(),
    ...createGithubFromTemplateTools(),
    ...createGithubPushFilesTools(),
    ...createGithubPullRequestTools(),
    ...createVercelProjectTools(),
    ...createCloudflarePreviewTools(),
    ...await createAgent365McpTools('chief-of-staff'),
    ...await createGlyphorMcpTools('chief-of-staff'),
  ];
  const toolExecutor = new ToolExecutor(tools, params.dryRun === true);

  // Log all events to console
  eventBus.on('*', (event) => {
    console.log(`[CoS] ${event.type}`, JSON.stringify(event));
  });

  const task = params.task || 'generate_briefing';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;

  switch (task) {
    case 'generate_briefing': {
      initialMessage = `Generate the morning briefing for ${today}.

Steps:
1. Use get_recent_activity to see what happened in the last 24 hours
2. Use get_pending_decisions to check for items needing approval
3. Use get_financials for the last 7 days
4. Synthesize everything into ONE concise briefing covering the full company
5. Use send_briefing to post it to the #briefings Teams channel (both founders see it there)
   Call send_briefing ONCE. Do NOT call it twice — the channel post reaches both founders.

Remember:
- Kristina (CEO) focuses on: product/market, growth, competitive landscape, infrastructure, engineering
- Andrew (COO) focuses on: financials, costs, margins, business health, sales pipeline
- Write ONE briefing that covers both perspectives
- Lead with the most important item
- Include action items if any decisions need their attention
- The only external product is the AI Marketing Department. Do NOT reference internal engine names in the briefing.`;
      break;
    }

    case 'check_escalations':
      initialMessage = `Check for any decisions that need escalation.

Use check_escalations to find yellow decisions older than 72 hours.
If any exist, create a red-tier decision to flag both founders.
Log your findings as an activity.`;
      break;

    case 'weekly_review':
      initialMessage = `Perform the weekly collective intelligence review for the week ending ${today}.

Steps:
1. Use get_company_vitals to review the current company vitals
2. Use get_org_knowledge to review recent org-level knowledge entries
3. Use get_process_patterns to check for recurring patterns across teams
4. Use detect_contradictions to find conflicting beliefs between agents
5. Use get_authority_proposals to review any pending governance changes
6. Promote the most important learnings from the week to org knowledge using promote_to_org_knowledge
7. Update the company vitals with current highlights using update_vitals_highlights
8. Use get_knowledge_routes to verify routing rules are working well

## WEEKLY OPS DIGEST — Voice & World Model Health
After completing the CI review, produce a short "Ops Digest" appendix with these sections:

**A. Voice coherence spot-check**
Pick 3 random agents. Review their last on_demand run output (from agent_runs).
For each, note: (1) did they sound like themselves per their personality_summary? (2) any anti-pattern violations? (3) overall voice grade (A/B/C).

**B. World model freshness**
Query agent_world_model for each executive. Note the last_updated timestamp.
Flag any executive whose world model hasn't been updated in > 3 days.

**C. Shared memory circulation**
Query shared_episodes for the past 7 days. Count episodes per agent.
Flag agents with 0 episodes written (they're not contributing to collective memory).

**D. Recommendations**
Based on A-C, list 1-3 concrete actions (e.g., "Re-seed Maya's anti-patterns — she's still saying 'stakeholder alignment'").

Goal: Ensure the collective intelligence of the organization is healthy, contradictions are surfaced, important knowledge is properly circulated, and all executive voices are calibrated correctly.`;
      break;

    case 'monthly_retrospective':
      initialMessage = `Conduct the monthly collective intelligence retrospective for ${today}.

Steps:
1. Use get_company_vitals to review current organizational state
2. Use get_process_patterns to identify workflow patterns, bottlenecks, and successful collaborations from the past month
3. Use detect_contradictions to find any persistent cross-agent disagreements
4. Use get_authority_proposals to review and resolve pending governance proposals
5. Record new process patterns you observe using record_process_pattern
6. If any authority levels need adjustment based on evidence, use propose_authority_change
7. Update the company vitals with a monthly summary using update_company_vitals

Goal: Drive organizational learning — identify what worked, what didn't, and how the company's collective decision-making can improve.`;
      break;

    case 'orchestrate': {
      // Gather directive lifecycle context for Sarah
      const lifecycleContext = await gatherDirectiveLifecycleContext();
      initialMessage = `Run your orchestration cycle:

SCOPE LIMIT: Process the top 5 highest-priority active directives per cycle.
If more than 5 are active, focus on critical/high first. Standing directives
(source='standing') are lower priority than founder-created directives —
only process standing directives if no regular directives need attention.
NEVER mark standing directives as completed or cancelled.

1. Use read_initiatives first so you understand active initiative sequencing and dependency state
2. Read founder directives with status="open" (proposed, active, paused), using initiative_id filters when you need to inspect a specific initiative chain
3. For initiative-derived directives, only move downstream work forward when prerequisite directives are completed
4. For each new non-critical directive, classify domain and attempt delegation first using delegate_directive
5. Use create_work_assignments only for directives you own directly (critical directives, cross-domain synthesis work, or explicit delegation failure)
6. When prior initiative work produced deliverables, embed those deliverables into downstream assignment instructions
7. For directives with pending assignments: dispatch them to agents
8. For directives with completed assignments: evaluate the outputs
9. Update progress notes on all active directives and complete initiatives when their directive chain is done
10. Report any blockers or issues that need founder attention
11. Run directive lifecycle checks (completion synthesis, stuck decisions, stuck blockers)

Be decisive. Assign real work. Move things forward.

${lifecycleContext}`;
      if (params.message?.trim()) {
        initialMessage += `\n\n## REACTIVE EVENT CONTEXT\n${params.message.trim()}`;
      }
      break;
    }

    case 'strategic_planning': {
        const loadedSections = await systemQuery<{ section: string }>(
          `SELECT section
             FROM company_knowledge_base
            WHERE is_active = true
              AND section = ANY($1::text[])`,
          [REQUIRED_COMPANY_DOCTRINE_SECTIONS],
        );
        if (loadedSections.length === 0) {
          throw new Error('Chief of Staff strategic planning cannot start because company doctrine returned no sections.');
        }

        const missingSections = REQUIRED_COMPANY_DOCTRINE_SECTIONS.filter(
          (section) => !loadedSections.some((loadedSection) => loadedSection.section === section),
        );
        if (missingSections.length > 0) {
          throw new Error(
            `Chief of Staff strategic planning cannot start because required doctrine sections are missing: ${missingSections.join(', ')}.`,
          );
        }

        initialMessage = `Run the weekly strategic planning cycle for ${today}.

Steps:
1. Use read_company_doctrine to load the current doctrine and operating principles
2. Use read_initiatives to review proposed, approved, active, and completed initiatives
3. Use read_founder_directives to inspect active directives and execution progress
4. Use get_company_vitals to ground decisions in current company state
5. Use get_deliverables to review recent published artifacts tied to strategic work
6. Identify doctrine gaps that are not already covered by active or approved work
7. Propose at most 5 high-value initiatives using propose_initiative
8. If you notice an important recurring strategic pattern, promote it with promote_to_org_knowledge

Constraints:
- Do not duplicate active or approved initiatives
- Prefer a short, sequenced set of initiatives over broad brainstorming
- Revenue-generating work outranks infrastructure unless infrastructure blocks execution
- Include initial directive drafts whenever you can make them specific and actionable`;
        break;
    }

    case 'midday_digest': {
      const recipient = params.recipient || 'both';
      initialMessage = `Generate a midday status digest for ${recipient} covering ${today}.

This is NOT a full morning briefing. This is a concise "here's what's happening" update for the workday so far.

Steps:
1. Use get_recent_activity to see what happened since 7 AM CT today
2. Use check_assignment_status on all active directives to see progress
3. Use check_messages to see if any agents flagged blockers or completed important work
4. Use get_pending_decisions to check for stuck decisions

Synthesize into a SHORT status update (not a full briefing). Structure:
- **Completed since morning:** What finished? Which assignments? Which agents delivered?
- **In progress:** What's actively being worked on right now?
- **Needs attention:** Any blockers, stuck decisions, or items requiring founder input?
- **Cost note:** Any spending anomalies today?

Send via send_dm to the #briefings channel. If send_dm doesn't support channels, send to kristina and then andrew (two separate calls — same message).
Keep it under 400 words. Be direct — this is a status pulse, not a report.`;
      break;
    }

    case 'process_directive': {
      const context = params.context ?? {};
      const directiveText = typeof context.text === 'string' ? context.text.trim() : (params.message?.trim() ?? '');
      const replyChannel = typeof context.channel === 'string' ? context.channel : 'unknown';
      const replyTs = typeof context.ts === 'string' ? context.ts : 'none';
      const source = typeof context.source === 'string' ? context.source : 'unknown';
      const userId = typeof context.user_id === 'string' ? context.user_id : 'unknown';

      initialMessage = `A message came in from a customer via Slack.

Message: "${directiveText}"
Source: ${source}
User: ${userId}
Channel: ${replyChannel}
Thread: ${replyTs}

Your job:
1. Understand what they are asking for.
2. If it is actionable marketing work, brief and route it to the correct marketing agent.
3. If it is a status question, inspect the relevant work and answer with specifics.
4. If it is unclear, ask one clarifying question.
5. Reply in the same Slack thread using post_to_slack with thread_ts="${replyTs}".

Rules:
- No greeting.
- No exclamation marks.
- No emoji unless it is a status indicator.
- Sound like a chief of staff, not a chatbot.
- Send exactly one Slack response.`;
      break;
    }

    case 'agent365_mail_triage':
      initialMessage = params.message || `Check your email inbox for new messages. Use Agent365 MailTools (mcp_MailTools) to read and process unread emails.

Steps:
1. List unread emails in your inbox
2. Prioritize: founder emails first, then external, then internal agent correspondence
3. For routine items within your GREEN authority: respond directly
4. For items needing founder input: summarize and escalate via send_dm to both founders
5. For domain-specific items (legal, finance, product): forward to the relevant executive with context
6. Log a brief summary of what you processed using log_activity`;
      break;

    case 'on_demand':
      initialMessage = params.message
        ? `${params.message}

---
[SYSTEM INSTRUCTION — On-Demand Chat Protocol]
You are in an interactive conversation with a founder. CRITICAL RULES:
1. NEVER guess or assume — ALWAYS use your tools to look things up before answering.
2. If asked about a directive → call read_founder_directives(status='all') immediately.
3. If asked about an email → call read_inbox or list_emails immediately.
4. If asked about a file/document → call search_sharepoint with the specific search term.
5. If asked "did you see X" → VERIFY with the relevant tool, don't just say yes.
6. If prior messages reference something specific (a site name, a file name, an email subject), USE that detail in your tool calls.
7. Keep answers concise. Act first, report results.`
        : 'Provide a status summary of the company.';
      break;

    case 'heartbeat_response': {
      // Heartbeat runs that don't match a specific scheduled task.
      // Instead of falling through to a generic "provide a summary" default,
      // run a lightweight orchestration pass — check directives, detect stuck
      // work, and move things forward.
      const lifecycleContext = await gatherDirectiveLifecycleContext();
      initialMessage = `Heartbeat check-in for ${today}. Run a focused orchestration pass:

1. Use read_founder_directives(status='active') to check for directives needing attention
2. Use get_recent_activity to see what happened since the last heartbeat
3. Use check_escalations to surface anything stuck or overdue
4. For any directive with pending/stalled assignments, take action:
   - Dispatch pending assignments
   - Nudge stalled agents
   - Escalate blockers that need founder attention
5. If nothing needs action, confirm the system is running smoothly with a brief status note

Be decisive. If there's work to move forward, move it. If everything is on track, say so briefly with evidence (not just "all good").

${lifecycleContext}`;
      break;
    }

    default:
      // Unknown task types get the heartbeat_response treatment rather than
      // a vague "provide a status summary" that produces minimal output.
      initialMessage = params.message || `Heartbeat check-in for ${today}. Use get_recent_activity and read_founder_directives(status='active') to check current state, then report anything that needs attention. If all clear, confirm briefly with evidence.`;
  }

  const agentCfg = await loadAgentConfig('chief-of-staff', { temperature: 0.3, maxTurns: 15 }, task);

  const systemPrompt = params.systemPromptOverride ??
    (task === 'orchestrate'
      ? CHIEF_OF_STAFF_SYSTEM_PROMPT + ORCHESTRATION_PROMPT
      : task === 'strategic_planning'
        ? CHIEF_OF_STAFF_SYSTEM_PROMPT + STRATEGIC_PLANNING_PROMPT
        : CHIEF_OF_STAFF_SYSTEM_PROMPT + ORCHESTRATION_PROMPT);

  const config: AgentConfig = {
    id: `cos-${task}-${today}`,
    role: 'chief-of-staff',
    systemPrompt,
    model: agentCfg.model,
    tools,
    maxTurns: effectiveMaxTurnsForReactiveTask(task, agentCfg.maxTurns),
    maxStallTurns: task === 'orchestrate' || task === 'strategic_planning' || task === 'on_demand' || task === 'heartbeat_response' ? 10 : 3,
    timeoutMs: 300_000,
    temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };

  const supervisor = new AgentSupervisor({
    maxTurns: config.maxTurns,
    maxStallTurns: config.maxStallTurns,
    timeoutMs: config.timeoutMs,
    onEvent: (event) => eventBus.emit(event),
  });

  const startTime = Date.now();

  const result = await runner.run(
    config,
    initialMessage,
    supervisor,
    toolExecutor,
    (event) => eventBus.emit(event),
    memory,
    createRunDeps(glyphorEventBus, memory, { systemPromptOverride: params.systemPromptOverride }),
  );

  const durationMs = Date.now() - startTime;

  const estimatedCost = result.estimatedCostUsd ?? result.cost ?? 0;

  // Record run in agent tracking
  try {
    await memory.recordAgentRun('chief-of-staff', durationMs, estimatedCost);
  } catch (e) {
    console.warn('[CoS] Failed to record run:', (e as Error).message);
  }

  console.log(`[CoS] ${result.status} in ${durationMs}ms (${result.totalTurns} turns)`);

  return result;
}

// CLI entry point
const args = process.argv.slice(2);
if (args.length > 0) {
  const task = args[0] as CoSRunParams['task'];
  const recipient = args[1] as CoSRunParams['recipient'];
  runChiefOfStaff({ task, recipient })
    .then((result) => {
      console.log(`\n=== Chief of Staff: ${result.status} ===`);
      if (result.output) {
        console.log(result.output.substring(0, 500));
      }
      process.exit(result.status === 'completed' ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal:', err);
      process.exit(1);
    });
}

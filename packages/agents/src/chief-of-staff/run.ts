/**
 * Chief of Staff — Runner Entry Point
 *
 * Executes the Chief of Staff agent for briefings or on-demand tasks.
 * Can be invoked via Cloud Scheduler cron or direct HTTP request.
 */

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
import type { SupabaseClient } from '@supabase/supabase-js';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { CHIEF_OF_STAFF_SYSTEM_PROMPT, ORCHESTRATION_PROMPT } from './systemPrompt.js';
import { createChiefOfStaffTools, createOrchestrationTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createCollectiveIntelligenceTools } from '../shared/collectiveIntelligenceTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createAssignmentTools } from '../shared/assignmentTools.js';
import { createEmailTools } from '../shared/emailTools.js';
import { createAgentCreationTools } from '../shared/agentCreationTools.js';

export interface CoSRunParams {
  task?: 'generate_briefing' | 'check_escalations' | 'weekly_review' | 'monthly_retrospective' | 'orchestrate' | 'on_demand';
  recipient?: 'kristina' | 'andrew';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

/**
 * Gathers directive lifecycle context for injection into the orchestrate prompt.
 * Returns a formatted string with:
 * A. Directives where all assignments are completed (candidates for synthesis)
 * B. Decisions pending > 2 hours (candidates for reminder DM)
 * C. Assignments blocked on founder_input > 4 hours (candidates for escalation DM)
 */
async function gatherDirectiveLifecycleContext(supabase: SupabaseClient): Promise<string> {
  const sections: string[] = [];

  try {
    // A. Directives with all assignments completed (candidates for synthesis)
    const { data: activeDirectives } = await supabase
      .from('founder_directives')
      .select(`
        id, title, created_by, status,
        work_assignments (id, assigned_to, status, quality_score, task_description, output, evaluation, need_type, blocker_reason, updated_at)
      `)
      .eq('status', 'active');

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
    const { data: stuckDecisions } = await supabase
      .from('decisions')
      .select('id, title, tier, summary, assigned_to, created_at')
      .eq('status', 'pending')
      .lt('created_at', twoHoursAgo)
      .order('created_at', { ascending: true });

    if (stuckDecisions && stuckDecisions.length > 0) {
      sections.push(`## STUCK DECISIONS — Pending > 2 hours\n\nThese decisions have been pending for over 2 hours. Send a reminder DM to the assigned approver. Do NOT remind more than once per decision per day — check working memory first.\n`);
      for (const dec of stuckDecisions) {
        const waitHours = Math.round((Date.now() - new Date(dec.created_at).getTime()) / (1000 * 60 * 60));
        const assignedTo = Array.isArray(dec.assigned_to) ? dec.assigned_to.join(', ') : dec.assigned_to;
        sections.push(`Decision: "${dec.title}" (id: ${dec.id})\n   Tier: ${dec.tier} | Waiting: ${waitHours} hours\n   Assigned to: ${assignedTo}\n   Summary: ${(dec.summary || '').substring(0, 200)}\n`);
      }
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
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY!,
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });
  const runner = createRunner(modelClient, 'chief-of-staff', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({ supabase: memory.getSupabaseClient() });
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const supabase = memory.getSupabaseClient();
  const schedulerUrl = process.env.SCHEDULER_URL || 'http://localhost:8080';
  const cosTools = createChiefOfStaffTools(memory, glyphorEventBus);
  const orchestrationTools = createOrchestrationTools(supabase, schedulerUrl, glyphorEventBus, cosTools, graphReader);
  const tools = [
    ...cosTools,
    ...createMemoryTools(memory),
    ...createCollectiveIntelligenceTools(memory),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...orchestrationTools,
    ...createAssignmentTools(supabase, glyphorEventBus),
    ...createEmailTools(),
    ...createAgentCreationTools(supabase, glyphorEventBus),
  ];
  const toolExecutor = new ToolExecutor(tools);

  // Log all events to console
  eventBus.on('*', (event) => {
    console.log(`[CoS] ${event.type}`, JSON.stringify(event));
  });

  const task = params.task || 'generate_briefing';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;

  switch (task) {
    case 'generate_briefing': {
      const recipient = params.recipient || 'kristina';
      initialMessage = `Generate the morning briefing for ${recipient} for ${today}.

Steps:
1. Use get_recent_activity to see what happened in the last 24 hours
2. Use get_pending_decisions to check for items needing approval
3. Use get_product_metrics for both Fuse and Pulse
4. Use get_financials for the last 7 days
5. Synthesize everything into a concise morning briefing
6. Use send_briefing to deliver it to ${recipient} via Teams

Remember:
- Kristina cares about: product/market, growth, competitive landscape, enterprise opportunities
- Andrew cares about: financials, costs, margins, infrastructure, risk
- Lead with the most important item
- Include action items if any decisions need their attention`;
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
1. Use get_company_pulse to review the current company pulse
2. Use get_org_knowledge to review recent org-level knowledge entries
3. Use get_process_patterns to check for recurring patterns across teams
4. Use detect_contradictions to find conflicting beliefs between agents
5. Use get_authority_proposals to review any pending governance changes
6. Promote the most important learnings from the week to org knowledge using promote_to_org_knowledge
7. Update the company pulse with current highlights using update_pulse_highlights
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
1. Use get_company_pulse to review current organizational state
2. Use get_process_patterns to identify workflow patterns, bottlenecks, and successful collaborations from the past month
3. Use detect_contradictions to find any persistent cross-agent disagreements
4. Use get_authority_proposals to review and resolve pending governance proposals
5. Record new process patterns you observe using record_process_pattern
6. If any authority levels need adjustment based on evidence, use propose_authority_change
7. Update the company pulse with a monthly summary using update_company_pulse

Goal: Drive organizational learning — identify what worked, what didn't, and how the company's collective decision-making can improve.`;
      break;

    case 'orchestrate': {
      // Gather directive lifecycle context for Sarah
      const lifecycleContext = await gatherDirectiveLifecycleContext(memory.getSupabaseClient());
      initialMessage = `Run your orchestration cycle:

1. Read all active founder directives
2. Check the status of any existing work assignments
3. For new directives without assignments: plan and create work assignments
4. For directives with pending assignments: dispatch them to agents
5. For directives with completed assignments: evaluate the outputs
6. Update progress notes on all active directives
7. Report any blockers or issues that need founder attention
8. Run directive lifecycle checks (completion synthesis, stuck decisions, stuck blockers)

Be decisive. Assign real work. Move things forward.

${lifecycleContext}`;
      break;
    }

    case 'on_demand':
      initialMessage = params.message || 'Provide a status summary of the company.';
      break;

    default:
      initialMessage = params.message || 'Provide a status summary of the company.';
  }

  const agentCfg = await loadAgentConfig(supabase, 'chief-of-staff', { model: 'gemini-3-flash-preview', temperature: 0.3, maxTurns: 10 }, task);

  const systemPrompt = task === 'orchestrate'
    ? CHIEF_OF_STAFF_SYSTEM_PROMPT + ORCHESTRATION_PROMPT
    : CHIEF_OF_STAFF_SYSTEM_PROMPT;

  const config: AgentConfig = {
    id: `cos-${task}-${today}`,
    role: 'chief-of-staff',
    systemPrompt,
    model: agentCfg.model,
    tools,
    maxTurns: task === 'orchestrate' ? 15 : agentCfg.maxTurns,
    maxStallTurns: task === 'orchestrate' ? 10 : 3,
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
    createRunDeps(supabase, glyphorEventBus, memory),
  );

  const durationMs = Date.now() - startTime;

  // Estimate cost (Flash: ~$0.15/1M input, ~$0.60/1M output)
  const lastEvent = result.conversationHistory.length;
  const estimatedCost = (lastEvent * 0.0001); // Very rough estimate

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

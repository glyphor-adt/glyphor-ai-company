/**
 * Nexus (Platform Intelligence) — Tool Set
 *
 * Read access to all eval signals and write access only to the autonomous-tier
 * targets. No direct DB write access — everything goes through named tools with
 * explicit audit.
 */

import type { ToolDefinition, ToolContext, ToolResult } from '@glyphor/agent-runtime';
import { invalidateGrantCache, refreshDynamicToolCache, isKnownToolAsync } from '@glyphor/agent-runtime';
import { A365TeamsChatClient } from '@glyphor/integrations';
import { systemQuery } from '@glyphor/shared/db';

// ── Teams DM helper ────────────────────────────────────────────

const FOUNDER_EMAILS = {
  kristina: process.env.TEAMS_USER_KRISTINA_EMAIL ?? 'kristina@glyphor.ai',
  andrew: process.env.TEAMS_USER_ANDREW_EMAIL ?? 'andrew@glyphor.ai',
};

async function notifyFounders(message: string): Promise<void> {
  try {
    const client = A365TeamsChatClient.fromEnv('platform-intel');
    if (!client) return;
    for (const [name, email] of Object.entries(FOUNDER_EMAILS)) {
      try {
        const chatId = await client.createOrGetOneOnOneChat(email, undefined, 'platform-intel');
        await client.postChatMessage(chatId, message, 'platform-intel');
      } catch (err) {
        console.warn(`[Nexus] Failed to DM ${name}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.warn('[Nexus] Teams notification failed:', (err as Error).message);
  }
}

// ── Helpers ─────────────────────────────────────────────────────

async function logPlatformAction(
  actionType: string,
  tier: 'autonomous' | 'approval_required',
  targetAgentId: string | null,
  description: string,
  payload: Record<string, unknown>,
  runId?: string,
): Promise<string | undefined> {
  const [row] = await systemQuery<{ id: string }>(
    `INSERT INTO platform_intel_actions
      (run_id, action_type, tier, target_agent_id, description, payload, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [runId ?? null, actionType, tier, targetAgentId, description, JSON.stringify(payload), tier === 'autonomous' ? 'executed' : 'pending'],
  );
  return row?.id;
}

// ── Tool factory ────────────────────────────────────────────────

export function createPlatformIntelTools(): ToolDefinition[] {
  return [

    // ── READ TOOLS ──────────────────────────────────────────────

    {
      name: 'read_blocked_assignments',
      description: 'Read all currently blocked work assignments across the fleet. Returns agent role, blocker reason, need type, and assignment details. Use this to find agents blocked on tool_access that you can unblock with grant_tool_to_agent.',
      parameters: {
        need_type: { type: 'string', description: 'Filter by need type (tool_access, data_access, peer_help, etc). Omit for all.', required: false },
      },
      execute: async (params: Record<string, unknown>): Promise<ToolResult> => {
        const needType = params.need_type as string | undefined;
        let sql = `SELECT wa.id, wa.assigned_to, wa.assigned_by, wa.task_description, wa.need_type, wa.blocker_reason, wa.updated_at
                   FROM work_assignments wa WHERE wa.status = 'blocked'`;
        const queryParams: unknown[] = [];
        if (needType) {
          queryParams.push(needType);
          sql += ` AND wa.need_type = $${queryParams.length}`;
        }
        sql += ' ORDER BY wa.updated_at DESC LIMIT 30';
        const rows = await systemQuery(sql, queryParams);
        return {
          success: true,
          data: {
            count: rows.length,
            blocked: rows.map((r: Record<string, unknown>) => ({
              id: r.id,
              agent: r.assigned_to,
              assigned_by: r.assigned_by,
              task: (r.task_description as string)?.slice(0, 120),
              need_type: r.need_type,
              blocker_reason: r.blocker_reason,
              blocked_since: r.updated_at,
            })),
          },
        };
      },
    },

    {
      name: 'read_gtm_report',
      description: 'Read the latest GTM readiness report and historical trend. Use this first on every analysis cycle to understand overall system health and which agents are blocking GTM.',
      parameters: {
        include_history: { type: 'boolean', description: 'Include last 30 days of report history', required: false },
      },
      execute: async (params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
        const includeHistory = params.include_history === true;
        const [latest] = await systemQuery<{ report_json: unknown }>(
          `SELECT report_json FROM gtm_readiness_reports ORDER BY generated_at DESC LIMIT 1`,
        );
        if (!includeHistory) return { success: true, data: latest?.report_json ?? null };
        const history = await systemQuery(
          `SELECT generated_at, overall, passing_count, failing_count
           FROM gtm_readiness_reports ORDER BY generated_at DESC LIMIT 30`,
        );
        return { success: true, data: { latest: latest?.report_json ?? null, history } };
      },
    },

    {
      name: 'read_fleet_health',
      description: 'Read full fleet health for all agents or a specific agent. Returns performance scores, open findings, prompt version, last run, eval component breakdown.',
      parameters: {
        agent_id: { type: 'string', description: 'Specific agent ID. Omit for full fleet.', required: false },
        include_score_components: { type: 'boolean', description: 'Include breakdown of score components', required: false },
      },
      execute: async (params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
        const agentId = typeof params.agent_id === 'string' ? params.agent_id : null;
        const queryParams: unknown[] = [];
        let filter = '';
        if (agentId) {
          filter = 'WHERE a.role = $1';
          queryParams.push(agentId);
        }
        const rows = await systemQuery(
          `SELECT a.role AS id, a.display_name AS name, a.department, a.performance_score, a.model,
                  apv.version AS prompt_version, apv.source AS prompt_source,
                  COUNT(ff.id) FILTER (WHERE ff.severity='P0' AND ff.resolved_at IS NULL) AS open_p0s,
                  COUNT(ff.id) FILTER (WHERE ff.severity='P1' AND ff.resolved_at IS NULL) AS open_p1s,
                  MAX(ar.created_at) AS last_run_at,
                  AVG(CASE WHEN ar.status='completed' THEN 1.0 ELSE 0.0 END) AS success_rate
           FROM company_agents a
           LEFT JOIN agent_prompt_versions apv ON apv.agent_id = a.role AND apv.deployed_at IS NOT NULL AND apv.retired_at IS NULL
           LEFT JOIN fleet_findings ff ON ff.agent_id = a.role
           LEFT JOIN agent_runs ar ON ar.agent_id = a.role AND ar.created_at > NOW() - INTERVAL '30 days'
           ${filter}
           GROUP BY a.role, a.display_name, a.department, a.performance_score, a.model, apv.version, apv.source
           ORDER BY a.performance_score ASC NULLS LAST`,
          queryParams,
        );
        return { success: true, data: rows };
      },
    },

    {
      name: 'read_agent_eval_detail',
      description: 'Read detailed eval signals for a specific agent: score components, recent run quality trend, tool accuracy, shadow run status, constitutional compliance.',
      parameters: {
        agent_id: { type: 'string', description: 'Agent ID to analyze', required: true },
        days: { type: 'number', description: 'Lookback window in days (default 30)', required: false },
      },
      execute: async (params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
        const agentId = params.agent_id as string;
        const days = typeof params.days === 'number' ? params.days : 30;

        const [scores, shadowRuns, toolAccuracy, consecutiveAborts] = await Promise.all([
          systemQuery(
            `SELECT ae.evaluator_type, AVG(ae.score_normalized) AS avg_score, COUNT(*) AS eval_count
             FROM assignment_evaluations ae
             JOIN work_assignments wa ON wa.id = ae.assignment_id
             WHERE wa.assigned_to = $1 AND ae.evaluated_at > NOW() - ($2 || ' days')::INTERVAL
             GROUP BY ae.evaluator_type`,
            [agentId, String(days)],
          ),
          systemQuery(
            `SELECT challenger_prompt_version, COUNT(*) AS runs,
                    AVG(challenger_score) AS avg_challenger, AVG(baseline_score) AS avg_baseline
             FROM shadow_runs WHERE agent_id = $1
             GROUP BY challenger_prompt_version ORDER BY MAX(created_at) DESC LIMIT 1`,
            [agentId],
          ),
          systemQuery(
            `SELECT AVG(ae.score_normalized) AS avg_score, COUNT(*) AS eval_count
             FROM assignment_evaluations ae
             JOIN work_assignments wa ON wa.id = ae.assignment_id
             WHERE wa.assigned_to = $1 AND ae.evaluator_type = 'tool_accuracy'`,
            [agentId],
          ),
          systemQuery<{ consecutive_aborts: number }>(
            `SELECT COUNT(*) AS consecutive_aborts FROM (
               SELECT status FROM agent_runs WHERE agent_id = $1
               ORDER BY created_at DESC LIMIT 10
             ) r WHERE status = 'aborted'`,
            [agentId],
          ),
        ]);

        return {
          success: true,
          data: {
            scores,
            shadowRuns: shadowRuns[0] ?? null,
            toolAccuracy: toolAccuracy[0] ?? null,
            consecutiveAborts: consecutiveAborts[0]?.consecutive_aborts ?? 0,
          },
        };
      },
    },

    {
      name: 'read_handoff_health',
      description: 'Read cross-agent handoff quality. Identifies context loss between agent pairs.',
      parameters: {
        min_context_loss_rate: { type: 'number', description: 'Filter to pairs above this context loss rate (0-1)', required: false },
      },
      execute: async (params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
        const minRate = typeof params.min_context_loss_rate === 'number' ? params.min_context_loss_rate : 0;
        const rows = await systemQuery(
          `SELECT * FROM agent_handoff_health
           WHERE context_loss_rate_pct > $1
           ORDER BY context_loss_rate_pct DESC`,
          [minRate * 100],
        );
        return { success: true, data: rows };
      },
    },

    {
      name: 'read_tool_failure_rates',
      description: 'Read tool call failure rates per agent and per tool. Surfaces broken tool/agent combinations.',
      parameters: {
        agent_id: { type: 'string', description: 'Filter to specific agent. Omit for fleet-wide.', required: false },
        min_failure_rate: { type: 'number', description: 'Minimum failure rate to include (0-1, default 0.15)', required: false },
      },
      execute: async (params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
        const agentId = typeof params.agent_id === 'string' ? params.agent_id : null;
        const minFailureRate = typeof params.min_failure_rate === 'number' ? params.min_failure_rate : 0.15;

        const queryParams: unknown[] = [minFailureRate];
        let agentFilter = '';
        if (agentId) {
          agentFilter = 'AND agent_id = $2';
          queryParams.push(agentId);
        }

        const rows = await systemQuery(
          `SELECT agent_id, tool_name,
                  COUNT(*) AS total_calls,
                  ROUND(COUNT(*) FILTER (WHERE NOT result_success)::numeric / NULLIF(COUNT(*),0), 3) AS failure_rate,
                  MAX(called_at) AS last_called
           FROM tool_call_traces
           WHERE called_at > NOW() - INTERVAL '30 days' ${agentFilter}
           GROUP BY agent_id, tool_name
           HAVING COUNT(*) FILTER (WHERE NOT result_success)::numeric / NULLIF(COUNT(*),0) > $1
           ORDER BY failure_rate DESC`,
          queryParams,
        );
        return { success: true, data: rows };
      },
    },

    // ── AUTONOMOUS ACTION TOOLS ─────────────────────────────────

    {
      name: 'trigger_reflection_cycle',
      description: 'Trigger a reflection cycle on a specific agent for a specific low-scoring run. Use when an agent is below 0.65 performance score and has recent runs to analyze.',
      parameters: {
        agent_id: { type: 'string', description: 'Agent ID to reflect on', required: true },
        run_id: { type: 'string', description: 'Specific run to analyze. Uses most recent low-score run if omitted.', required: false },
        reason: { type: 'string', description: 'Why reflection is being triggered', required: true },
      },
      execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        const agentId = params.agent_id as string;
        const reason = params.reason as string;
        let targetRunId = typeof params.run_id === 'string' ? params.run_id : null;

        if (!targetRunId) {
          const [row] = await systemQuery<{ id: string }>(
            `SELECT ar.id FROM agent_runs ar
             WHERE ar.agent_id = $1 AND ar.status = 'failed'
             ORDER BY ar.created_at DESC LIMIT 1`,
            [agentId],
          );
          targetRunId = row?.id ?? null;
        }

        if (!targetRunId) {
          return { success: false, error: 'No low-scoring run found for this agent' };
        }

        await logPlatformAction(
          'trigger_reflection_cycle', 'autonomous', agentId, reason,
          { run_id: targetRunId }, ctx.runId,
        );

        return { success: true, data: { agent_id: agentId, run_id: targetRunId, status: 'queued' } };
      },
    },

    {
      name: 'promote_prompt_version',
      description: 'Promote a shadow-tested prompt version to live. Only call this when shadow_runs show challenger consistently outperforms baseline by >5% over at least 10 runs.',
      parameters: {
        agent_id: { type: 'string', description: 'Agent ID', required: true },
        challenger_version: { type: 'number', description: 'Challenger version number', required: true },
        avg_challenger_score: { type: 'number', description: 'Average challenger score', required: true },
        avg_baseline_score: { type: 'number', description: 'Average baseline score', required: true },
        run_count: { type: 'number', description: 'Number of shadow runs', required: true },
      },
      execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        const agentId = params.agent_id as string;
        const challengerVersion = params.challenger_version as number;
        const avgChallenger = params.avg_challenger_score as number;
        const avgBaseline = params.avg_baseline_score as number;
        const runCount = params.run_count as number;

        if (runCount < 10) {
          return { success: false, error: 'Minimum 10 shadow runs required before promotion' };
        }
        if (avgChallenger <= avgBaseline * 1.05) {
          return { success: false, error: 'Challenger must outperform baseline by >5%' };
        }

        // Retire current active version and deploy challenger
        await systemQuery(
          `UPDATE agent_prompt_versions SET retired_at = NOW()
           WHERE agent_id = $1 AND deployed_at IS NOT NULL AND retired_at IS NULL`,
          [agentId],
        );
        await systemQuery(
          `UPDATE agent_prompt_versions SET deployed_at = NOW()
           WHERE agent_id = $1 AND version = $2`,
          [agentId, challengerVersion],
        );

        await logPlatformAction(
          'promote_prompt_version', 'autonomous', agentId,
          `Promoted v${challengerVersion} (${Math.round(avgChallenger * 100)} vs baseline ${Math.round(avgBaseline * 100)} over ${runCount} runs)`,
          { challenger_version: challengerVersion, avg_challenger_score: avgChallenger, avg_baseline_score: avgBaseline, run_count: runCount },
          ctx.runId,
        );

        return { success: true, data: { agent_id: agentId, promoted_version: challengerVersion } };
      },
    },

    {
      name: 'discard_prompt_version',
      description: 'Discard a shadow-tested prompt version that failed to outperform baseline.',
      parameters: {
        agent_id: { type: 'string', description: 'Agent ID', required: true },
        challenger_version: { type: 'number', description: 'Challenger version number', required: true },
        reason: { type: 'string', description: 'Why this version is being discarded', required: true },
      },
      execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        const agentId = params.agent_id as string;
        const challengerVersion = params.challenger_version as number;
        const reason = params.reason as string;

        await systemQuery(
          `UPDATE agent_prompt_versions SET retired_at = NOW()
           WHERE agent_id = $1 AND version = $2 AND deployed_at IS NULL`,
          [agentId, challengerVersion],
        );

        await logPlatformAction(
          'discard_prompt_version', 'autonomous', agentId, reason,
          { challenger_version: challengerVersion }, ctx.runId,
        );

        return { success: true, data: { agent_id: agentId, discarded_version: challengerVersion } };
      },
    },

    {
      name: 'pause_agent',
      description: 'Pause an agent from receiving new work assignments. Use only when consecutive_aborts >= 3 or a P0 finding blocks safe operation. NEVER for GTM-required agents — use create_approval_request instead.',
      parameters: {
        agent_id: { type: 'string', description: 'Agent ID to pause', required: true },
        reason: { type: 'string', description: 'Why this agent is being paused', required: true },
        auto_resume_hours: { type: 'number', description: 'Auto-resume after N hours. Omit for manual resume only.', required: false },
      },
      execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        const agentId = params.agent_id as string;
        const reason = params.reason as string;
        const autoResumeHours = typeof params.auto_resume_hours === 'number' ? params.auto_resume_hours : null;

        const GTM_AGENTS = ['cmo', 'content-creator', 'seo-analyst', 'social-media-manager', 'chief-of-staff'];
        if (GTM_AGENTS.includes(agentId)) {
          return { success: false, error: 'GTM-required agents cannot be paused autonomously. Use create_approval_request instead.' };
        }

        await systemQuery(
          `UPDATE company_agents SET status = 'paused', updated_at = NOW() WHERE role = $1`,
          [agentId],
        );

        await logPlatformAction(
          'pause_agent', 'autonomous', agentId, reason,
          { auto_resume_hours: autoResumeHours }, ctx.runId,
        );

        return { success: true, data: { agent_id: agentId, paused: true, auto_resume_hours: autoResumeHours } };
      },
    },

    {
      name: 'write_fleet_finding',
      description: 'Write a new P0, P1, or P2 finding for an agent. Use when you detect a systemic issue not already captured by the audit scripts.',
      parameters: {
        agent_id: { type: 'string', description: 'Agent ID', required: true },
        severity: { type: 'string', enum: ['P0', 'P1', 'P2'], description: 'Finding severity', required: true },
        finding_type: { type: 'string', description: 'Type of finding', required: true },
        description: { type: 'string', description: 'Detailed description of the finding', required: true },
      },
      execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        const agentId = params.agent_id as string;
        const severity = params.severity as string;
        const findingType = params.finding_type as string;
        const description = params.description as string;

        const [row] = await systemQuery<{ id: string }>(
          `INSERT INTO fleet_findings (agent_id, severity, finding_type, description)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [agentId, severity, findingType, description],
        );

        await logPlatformAction(
          'write_fleet_finding', 'autonomous', agentId,
          `${severity}: ${findingType}`,
          { finding_type: findingType, description }, ctx.runId,
        );

        return { success: true, data: { finding_id: row?.id ?? null } };
      },
    },

    {
      name: 'write_world_model_correction',
      description: 'Write a correction to an agent world model when external eval contradicts self-assessment.',
      parameters: {
        agent_id: { type: 'string', description: 'Agent ID', required: true },
        correction_type: { type: 'string', enum: ['weakness_added', 'strength_revised', 'prediction_accuracy_updated'], description: 'Type of correction', required: true },
        field_name: { type: 'string', description: 'World model field being corrected', required: true },
        description: { type: 'string', description: 'Description of the correction', required: true },
        evidence_score: { type: 'number', description: 'Eval score that evidences this correction', required: true },
      },
      execute: async (params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
        const agentId = params.agent_id as string;
        const correctionType = params.correction_type as string;
        const fieldName = params.field_name as string;
        const description = params.description as string;
        const evidenceScore = params.evidence_score as number;

        await systemQuery(
          `INSERT INTO agent_world_model_corrections
           (agent_id, correction_type, field_name, corrected_value, evidence_eval_score, source)
           VALUES ($1, $2, $3, $4, $5, 'platform-intel')`,
          [agentId, correctionType, fieldName, JSON.stringify({ description }), evidenceScore],
        );

        return { success: true, data: { agent_id: agentId, correction_type: correctionType, field_name: fieldName } };
      },
    },

    // ── APPROVAL REQUEST TOOL ───────────────────────────────────

    {
      name: 'create_approval_request',
      description: 'Send an approval request to Kristina and Andrew via Teams Adaptive Card. Use for anything outside the autonomous tier. Always include the full rationale and exact action that will be taken on approval.',
      parameters: {
        action_type: { type: 'string', description: 'Type of action requiring approval', required: true },
        target_agent_id: { type: 'string', description: 'Target agent ID if applicable', required: false },
        title: { type: 'string', description: 'Short title for the Teams card', required: true },
        rationale: { type: 'string', description: 'Why this action is needed. Be specific — include metrics.', required: true },
        action_description: { type: 'string', description: 'Exactly what will happen on approval', required: true },
        impact: { type: 'string', description: 'Expected outcome if approved', required: true },
        payload: { type: 'object', description: 'Full action spec to execute on approval', required: true },
        urgency: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Urgency level', required: true },
      },
      execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        const actionType = params.action_type as string;
        const targetAgentId = typeof params.target_agent_id === 'string' ? params.target_agent_id : null;
        const actionDescription = params.action_description as string;
        const payload = params.payload as Record<string, unknown>;

        // Create action record
        const [action] = await systemQuery<{ id: string }>(
          `INSERT INTO platform_intel_actions
           (action_type, tier, target_agent_id, description, payload, status)
           VALUES ($1, 'approval_required', $2, $3, $4, 'pending')
           RETURNING id`,
          [actionType, targetAgentId, actionDescription, JSON.stringify(payload)],
        );

        if (!action) {
          return { success: false, error: 'Failed to create approval action record' };
        }

        // Generate approve/reject tokens
        const [approveToken] = await systemQuery<{ token: string }>(
          `INSERT INTO approval_tokens (action_id, decision) VALUES ($1, 'approve') RETURNING token`,
          [action.id],
        );
        const [rejectToken] = await systemQuery<{ token: string }>(
          `INSERT INTO approval_tokens (action_id, decision) VALUES ($1, 'reject') RETURNING token`,
          [action.id],
        );

        // Send Teams DM with approval links
        const schedulerUrl = process.env.SCHEDULER_URL ?? 'https://glyphor-scheduler-610179349713.us-central1.run.app';
        const approveUrl = `${schedulerUrl}/platform-intel/approve/${approveToken?.token}`;
        const rejectUrl = `${schedulerUrl}/platform-intel/reject/${rejectToken?.token}`;
        const urgencyTag = (params.urgency as string).toUpperCase();
        const dmMessage = [
          `[${urgencyTag}] ⚡ Nexus — Approval Required`,
          '',
          `**${params.title}**`,
          targetAgentId ? `Agent: ${targetAgentId}` : '',
          '',
          `Why: ${params.rationale}`,
          '',
          `Action: ${actionDescription}`,
          '',
          `Expected outcome: ${params.impact}`,
          '',
          `✓ Approve: ${approveUrl}`,
          `✕ Reject: ${rejectUrl}`,
          '',
          `Expires in 48h · Action ID: ${action.id}`,
        ].filter(Boolean).join('\n');
        notifyFounders(dmMessage).catch((err) => {
          console.error('[Nexus] Approval card DM delivery failed — founders will not see this card:', (err as Error).message);
        });

        return {
          success: true,
          data: {
            action_id: action.id,
            status: 'pending_approval',
            approve_url: approveUrl,
            reject_url: rejectUrl,
            title: params.title,
            rationale: params.rationale,
            urgency: params.urgency,
            target_agent_id: targetAgentId,
            teams_notification: 'sent',
          },
        };
      },
    },

    // ── DEEP DIAGNOSTIC TOOLS ───────────────────────────────────

    {
      name: 'read_tool_call_errors',
      description: 'Read actual error messages from recent failed tool calls. Returns the tool name, agent, full error, and the arguments that were passed. Use after read_tool_failure_rates to understand WHY a tool is failing.',
      parameters: {
        tool_name: { type: 'string', description: 'Filter to a specific tool', required: false },
        agent_id: { type: 'string', description: 'Filter to a specific agent', required: false },
        limit: { type: 'number', description: 'Max errors to return (default 20)', required: false },
      },
      execute: async (params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
        const toolName = typeof params.tool_name === 'string' ? params.tool_name : null;
        const agentId = typeof params.agent_id === 'string' ? params.agent_id : null;
        const limit = typeof params.limit === 'number' ? Math.min(params.limit, 50) : 20;

        const conditions = ['NOT result_success'];
        const values: unknown[] = [];
        if (toolName) { values.push(toolName); conditions.push(`tool_name = $${values.length}`); }
        if (agentId) { values.push(agentId); conditions.push(`agent_id = $${values.length}`); }
        values.push(limit);

        const rows = await systemQuery(
          `SELECT tool_name, agent_id, agent_role, result_error, args, called_at
           FROM tool_call_traces
           WHERE ${conditions.join(' AND ')}
           ORDER BY called_at DESC
           LIMIT $${values.length}`,
          values,
        );

        return { success: true, data: rows };
      },
    },

    {
      name: 'read_tool_call_trace',
      description: 'Read full details of tool call traces for a specific tool+agent combination. Includes both successes and failures with timing, args, and results.',
      parameters: {
        tool_name: { type: 'string', description: 'Tool name to trace', required: true },
        agent_id: { type: 'string', description: 'Filter to specific agent', required: false },
        limit: { type: 'number', description: 'Max traces to return (default 10)', required: false },
      },
      execute: async (params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
        const toolName = params.tool_name as string;
        const agentId = typeof params.agent_id === 'string' ? params.agent_id : null;
        const limit = typeof params.limit === 'number' ? Math.min(params.limit, 30) : 10;

        const conditions = ['tool_name = $1'];
        const values: unknown[] = [toolName];
        if (agentId) { values.push(agentId); conditions.push(`agent_id = $${values.length}`); }
        values.push(limit);

        const rows = await systemQuery(
          `SELECT tool_name, agent_id, agent_role, result_success, result_error, result_data,
                  args, estimated_cost_usd, called_at,
                  retrieval_method, retrieval_score
           FROM tool_call_traces
           WHERE ${conditions.join(' AND ')}
           ORDER BY called_at DESC
           LIMIT $${values.length}`,
          values,
        );

        return { success: true, data: rows };
      },
    },

    {
      name: 'validate_tool_sql',
      description: 'Test whether a SQL query is valid against the current schema using EXPLAIN (never executes). Use to verify a fix before applying it.',
      parameters: {
        sql: { type: 'string', description: 'The SQL query to validate (SELECT only)', required: true },
      },
      execute: async (params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
        const sql = (params.sql as string).trim();

        // Safety: only allow SELECT/EXPLAIN
        if (!/^SELECT\b/i.test(sql)) {
          return { success: false, error: 'Only SELECT queries can be validated. No writes allowed.' };
        }

        try {
          await systemQuery(`EXPLAIN (FORMAT JSON) ${sql}`);
          return { success: true, data: { valid: true, message: 'Query is valid against current schema.' } };
        } catch (err) {
          return {
            success: true,
            data: {
              valid: false,
              error: (err as Error).message,
              message: 'Query failed validation. See error for details.',
            },
          };
        }
      },
    },

    {
      name: 'check_env_credentials',
      description: 'Check whether required environment variables are set (does NOT reveal values). Use to diagnose 401/auth errors on tools that depend on API keys or service accounts.',
      parameters: {
        env_vars: {
          type: 'array',
          description: 'List of env var names to check (e.g. ["GOOGLE_AI_API_KEY", "OPENAI_API_KEY"])',
          required: true,
        },
      },
      execute: async (params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
        const vars = params.env_vars;
        if (!Array.isArray(vars)) {
          return { success: false, error: 'env_vars must be an array of strings' };
        }

        const results = vars
          .filter((v): v is string => typeof v === 'string')
          .map((name) => ({
            name,
            set: typeof process.env[name] === 'string' && process.env[name]!.length > 0,
            length: process.env[name]?.length ?? 0,
          }));

        const missing = results.filter((r) => !r.set).map((r) => r.name);

        return {
          success: true,
          data: { results, missing, all_set: missing.length === 0 },
        };
      },
    },

    // ── TOOL ACCESS MANAGEMENT ──────────────────────────────────

    {
      name: 'grant_tool_to_agent',
      description: 'Grant an existing tool to an agent. Use when an agent is blocked because it lacks access to a tool it needs. The tool must exist in the system registry. Restricted grants (paid/spend-impacting) require founder approval.',
      parameters: {
        agent_role: { type: 'string', description: 'Agent role to grant the tool to', required: true },
        tool_name: { type: 'string', description: 'Name of the tool to grant', required: true },
        reason: { type: 'string', description: 'Why this grant is needed — reference specific failure or blocker', required: true },
      },
      execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        const agentRole = params.agent_role as string;
        const toolName = params.tool_name as string;
        const reason = params.reason as string;

        if (!(await isKnownToolAsync(toolName))) {
          return { success: false, error: `Tool "${toolName}" does not exist. Use register_dynamic_tool to create it first.` };
        }

        // Check if already granted
        const existing = await systemQuery(
          `SELECT id FROM agent_tool_grants WHERE agent_role = $1 AND tool_name = $2 AND is_active = true`,
          [agentRole, toolName],
        );
        if (existing.length > 0) {
          invalidateGrantCache(agentRole);
          return { success: true, data: { granted: true, already_existed: true, message: `${agentRole} already has access to ${toolName}. Cache refreshed.` } };
        }

        await systemQuery(
          `INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, reason)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (agent_role, tool_name) DO UPDATE
             SET is_active = true, granted_by = EXCLUDED.granted_by, reason = EXCLUDED.reason, updated_at = NOW()`,
          [agentRole, toolName, 'platform-intel', reason],
        );
        invalidateGrantCache(agentRole);

        await logPlatformAction(
          'grant_tool', 'autonomous', agentRole,
          `Granted ${toolName} to ${agentRole}: ${reason}`,
          { agent_role: agentRole, tool_name: toolName }, ctx.runId,
        );

        return { success: true, data: { granted: true, agent_role: agentRole, tool_name: toolName } };
      },
    },

    {
      name: 'revoke_tool_from_agent',
      description: 'Revoke a dynamically granted tool from an agent. Use when a tool is causing harm or the agent should not have access.',
      parameters: {
        agent_role: { type: 'string', description: 'Agent role to revoke from', required: true },
        tool_name: { type: 'string', description: 'Name of the tool to revoke', required: true },
        reason: { type: 'string', description: 'Why this revocation is needed', required: true },
      },
      execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        const agentRole = params.agent_role as string;
        const toolName = params.tool_name as string;
        const reason = params.reason as string;

        await systemQuery(
          `UPDATE agent_tool_grants SET is_active = false, updated_at = NOW()
           WHERE agent_role = $1 AND tool_name = $2`,
          [agentRole, toolName],
        );
        invalidateGrantCache(agentRole);

        await logPlatformAction(
          'revoke_tool', 'autonomous', agentRole,
          `Revoked ${toolName} from ${agentRole}: ${reason}`,
          { agent_role: agentRole, tool_name: toolName }, ctx.runId,
        );

        return { success: true, data: { revoked: true, agent_role: agentRole, tool_name: toolName } };
      },
    },

    {
      name: 'emergency_block_tool',
      description: 'Emergency-block a tool for an agent. Blocked tools are denied at execution time regardless of grants. Use for tools that are actively causing damage.',
      parameters: {
        agent_role: { type: 'string', description: 'Agent role to block the tool for', required: true },
        tool_name: { type: 'string', description: 'Name of the tool to block', required: true },
        reason: { type: 'string', description: 'Why this emergency block is needed', required: true },
      },
      execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        const agentRole = params.agent_role as string;
        const toolName = params.tool_name as string;
        const reason = params.reason as string;

        await systemQuery(
          `INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, reason, is_blocked)
           VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (agent_role, tool_name) DO UPDATE
             SET is_blocked = true, reason = EXCLUDED.reason, updated_at = NOW()`,
          [agentRole, toolName, 'platform-intel', reason],
        );
        invalidateGrantCache(agentRole);

        await logPlatformAction(
          'emergency_block_tool', 'autonomous', agentRole,
          `BLOCKED ${toolName} for ${agentRole}: ${reason}`,
          { agent_role: agentRole, tool_name: toolName }, ctx.runId,
        );

        return { success: true, data: { blocked: true, agent_role: agentRole, tool_name: toolName } };
      },
    },

    // ── TOOL REGISTRY MANAGEMENT ────────────────────────────────

    {
      name: 'register_dynamic_tool',
      description: 'Register a new API-backed tool in the dynamic tool registry. The tool becomes immediately available for granting to agents. Use when a tool does not exist and needs to be created to unblock an agent.',
      parameters: {
        tool_name: { type: 'string', description: 'Tool name (snake_case, 3-64 chars)', required: true },
        description: { type: 'string', description: 'What the tool does', required: true },
        category: { type: 'string', description: 'Tool category (integration, analytics, communication, data)', required: true },
        parameters_schema: { type: 'object', description: 'Parameter schema for the tool', required: true },
        api_config: { type: 'object', description: 'API config: { method, url_template, headers_template, body_template, auth_type, auth_env_var }', required: false },
      },
      execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        const toolName = params.tool_name as string;

        if (!/^[a-z][a-z0-9_]{2,63}$/.test(toolName)) {
          return { success: false, error: 'Tool name must be snake_case, start with letter, 3-64 chars.' };
        }

        if (await isKnownToolAsync(toolName)) {
          return { success: false, error: `Tool "${toolName}" already exists. Use update_dynamic_tool to modify it.` };
        }

        await systemQuery(
          `INSERT INTO tool_registry (name, description, category, parameters, api_config, created_by, approved_by, is_active, tags)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
          [
            toolName,
            params.description,
            params.category,
            params.parameters_schema,
            params.api_config ?? null,
            'platform-intel',
            'platform-intel',
            ['nexus-registered'],
          ],
        );

        await refreshDynamicToolCache();

        await logPlatformAction(
          'register_tool', 'autonomous', null,
          `Registered new tool: ${toolName}`,
          { tool_name: toolName, category: params.category }, ctx.runId,
        );

        return { success: true, data: { registered: true, tool_name: toolName } };
      },
    },

    {
      name: 'update_dynamic_tool',
      description: 'Update an existing dynamically registered tool\'s config (description, parameters, API config). Cannot modify code-built tools — only tools registered via the tool_registry.',
      parameters: {
        tool_name: { type: 'string', description: 'Tool to update', required: true },
        description: { type: 'string', description: 'Updated description', required: false },
        parameters_schema: { type: 'object', description: 'Updated parameter schema', required: false },
        api_config: { type: 'object', description: 'Updated API config', required: false },
      },
      execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        const toolName = params.tool_name as string;

        const [existing] = await systemQuery<{ id: string }>(
          `SELECT id FROM tool_registry WHERE name = $1 AND is_active = true`,
          [toolName],
        );
        if (!existing) {
          return { success: false, error: `Tool "${toolName}" not found in the dynamic registry. Cannot update code-built tools.` };
        }

        const updates: string[] = [];
        const values: unknown[] = [];
        if (params.description) { values.push(params.description); updates.push(`description = $${values.length}`); }
        if (params.parameters_schema) { values.push(params.parameters_schema); updates.push(`parameters = $${values.length}`); }
        if (params.api_config) { values.push(params.api_config); updates.push(`api_config = $${values.length}`); }

        if (updates.length === 0) {
          return { success: false, error: 'No fields to update. Provide description, parameters_schema, or api_config.' };
        }

        values.push(toolName);
        await systemQuery(
          `UPDATE tool_registry SET ${updates.join(', ')}, updated_at = NOW() WHERE name = $${values.length}`,
          values,
        );

        await refreshDynamicToolCache();

        await logPlatformAction(
          'update_tool', 'autonomous', null,
          `Updated dynamic tool: ${toolName}`,
          { tool_name: toolName, updated_fields: updates }, ctx.runId,
        );

        return { success: true, data: { updated: true, tool_name: toolName } };
      },
    },

    {
      name: 'deactivate_tool',
      description: 'Deactivate a dynamically registered tool. Prevents it from being executed. Use when a tool is broken and cannot be fixed immediately.',
      parameters: {
        tool_name: { type: 'string', description: 'Tool to deactivate', required: true },
        reason: { type: 'string', description: 'Why this tool is being deactivated', required: true },
      },
      execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        const toolName = params.tool_name as string;
        const reason = params.reason as string;

        const result = await systemQuery(
          `UPDATE tool_registry SET is_active = false, updated_at = NOW() WHERE name = $1 AND is_active = true RETURNING id`,
          [toolName],
        );

        if (result.length === 0) {
          return { success: false, error: `Tool "${toolName}" not found in the dynamic registry or already inactive.` };
        }

        await refreshDynamicToolCache();

        await logPlatformAction(
          'deactivate_tool', 'autonomous', null,
          `Deactivated tool: ${toolName} — ${reason}`,
          { tool_name: toolName }, ctx.runId,
        );

        return { success: true, data: { deactivated: true, tool_name: toolName } };
      },
    },

    // ── CODE FIX PROPOSALS ──────────────────────────────────────

    {
      name: 'create_tool_fix_proposal',
      description: 'Create a structured code fix proposal for a broken tool. Includes root cause analysis, the exact file/query that needs to change, and the corrected version. These are reviewed and applied by engineering. Use when you\'ve diagnosed a tool bug through schema inspection and error analysis but can\'t fix it autonomously because it\'s in compiled code.',
      parameters: {
        tool_name: { type: 'string', description: 'The broken tool', required: true },
        severity: { type: 'string', enum: ['P0', 'P1', 'P2'], description: 'Impact severity', required: true },
        root_cause: { type: 'string', description: 'Root cause analysis — what\'s wrong and why', required: true },
        affected_agents: { type: 'array', description: 'List of agent roles affected by this bug', required: true },
        current_behavior: { type: 'string', description: 'What the tool does now (the broken behavior)', required: true },
        expected_behavior: { type: 'string', description: 'What it should do', required: true },
        fix_description: { type: 'string', description: 'Exact fix needed: file path, line/query, and corrected version', required: true },
        blocking_gtm: { type: 'boolean', description: 'Whether this blocks GTM readiness', required: false },
      },
      execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        const toolName = params.tool_name as string;
        const severity = params.severity as string;
        const rootCause = params.root_cause as string;
        const affectedAgents = params.affected_agents as string[];
        const fixDescription = params.fix_description as string;
        const blockingGtm = params.blocking_gtm === true;

        const [row] = await systemQuery<{ id: string }>(
          `INSERT INTO tool_fix_proposals
           (tool_name, severity, root_cause, affected_agents, current_behavior, expected_behavior,
            fix_description, blocking_gtm, proposed_by, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'platform-intel', 'pending')
           RETURNING id`,
          [
            toolName, severity, rootCause, affectedAgents,
            params.current_behavior, params.expected_behavior,
            fixDescription, blockingGtm,
          ],
        );

        // Also write a fleet finding if P0/P1
        if (severity === 'P0' || severity === 'P1') {
          for (const agent of affectedAgents) {
            await systemQuery(
              `INSERT INTO fleet_findings (agent_id, severity, finding_type, description)
               VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
              [agent, severity, 'tool_bug', `${toolName}: ${rootCause}`],
            );
          }

          // Notify founders — P0/P1 tool bugs need engineering attention
          const dmMessage = [
            `[${severity}] 🔧 Nexus — Tool Fix Proposal`,
            '',
            `**${toolName}** is broken${blockingGtm ? ' (BLOCKING GTM)' : ''}`,
            `Affected agents: ${affectedAgents.join(', ')}`,
            '',
            `Root cause: ${rootCause}`,
            '',
            `Fix: ${fixDescription}`,
            '',
            `Proposal ID: ${row?.id}`,
          ].join('\n');
          notifyFounders(dmMessage).catch((err) => {
            console.error('[Nexus] Fix proposal DM delivery failed:', (err as Error).message);
          });
        }

        await logPlatformAction(
          'create_fix_proposal', blockingGtm ? 'approval_required' : 'autonomous', null,
          `${severity} fix proposal for ${toolName}: ${rootCause}`,
          { tool_name: toolName, affected_agents: affectedAgents, fix_id: row?.id }, ctx.runId,
        );

        return {
          success: true,
          data: {
            proposal_id: row?.id,
            tool_name: toolName,
            severity,
            affected_agents: affectedAgents,
            status: 'pending',
            blocking_gtm: blockingGtm,
          },
        };
      },
    },

    {
      name: 'list_tool_fix_proposals',
      description: 'List tool fix proposals. Shows what bugs have been identified, their status, and which agents are affected.',
      parameters: {
        status: { type: 'string', enum: ['pending', 'approved', 'applied', 'rejected'], description: 'Filter by status (default: pending)', required: false },
      },
      execute: async (params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
        const status = typeof params.status === 'string' ? params.status : 'pending';
        const rows = await systemQuery(
          `SELECT id, tool_name, severity, root_cause, affected_agents, fix_description,
                  blocking_gtm, status, proposed_by, created_at
           FROM tool_fix_proposals
           WHERE status = $1
           ORDER BY CASE severity WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END, created_at DESC
           LIMIT 30`,
          [status],
        );
        return { success: true, data: rows };
      },
    },

    // ── AGENT LIFECYCLE MANAGEMENT ──────────────────────────────

    {
      name: 'resume_agent',
      description: 'Resume a previously paused agent. Use when the issue that caused the pause has been resolved.',
      parameters: {
        agent_id: { type: 'string', description: 'Agent ID to resume', required: true },
        reason: { type: 'string', description: 'Why this agent is being resumed', required: true },
      },
      execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        const agentId = params.agent_id as string;
        const reason = params.reason as string;

        await systemQuery(
          `UPDATE company_agents SET status = 'active', updated_at = NOW() WHERE role = $1`,
          [agentId],
        );

        await logPlatformAction(
          'resume_agent', 'autonomous', agentId, reason,
          {}, ctx.runId,
        );

        return { success: true, data: { agent_id: agentId, resumed: true } };
      },
    },

    {
      name: 'read_agent_config',
      description: 'Read the current runtime configuration of a specific agent: model, temperature, max turns, autonomy tier, tool count, and last run details.',
      parameters: {
        agent_id: { type: 'string', description: 'Agent ID', required: true },
      },
      execute: async (params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
        const agentId = params.agent_id as string;

        const [agent] = await systemQuery(
          `SELECT a.id, a.role, a.display_name, a.model, a.status, a.config,
                  (SELECT COUNT(*) FROM agent_tool_grants g WHERE g.agent_role = a.role AND g.is_active = true) AS active_grants,
                  (SELECT COUNT(*) FROM agent_tool_grants g WHERE g.agent_role = a.role AND g.is_blocked = true) AS blocked_tools,
                  (SELECT MAX(ar.created_at) FROM agent_runs ar WHERE ar.agent_id = a.role) AS last_run_at,
                  (SELECT status FROM agent_runs ar WHERE ar.agent_id = a.role ORDER BY created_at DESC LIMIT 1) AS last_run_status
           FROM company_agents a
           WHERE a.role = $1 OR a.id::text = $1
           LIMIT 1`,
          [agentId],
        );

        if (!agent) {
          return { success: false, error: `Agent "${agentId}" not found.` };
        }

        return { success: true, data: agent };
      },
    },

    // ── KNOWLEDGE BASE FRESHNESS AUDIT ──────────────────────────

    {
      name: 'audit_knowledge_freshness',
      description: 'Audit company knowledge base for stale sections. Flags sections past their review cadence and marks them stale. Call weekly during analysis cycle.',
      parameters: {},
      execute: async (_params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
        const staleRows = await systemQuery<{
          section: string; title: string; owner_agent_id: string | null;
          review_cadence: string; last_verified_at: string | null;
          auto_expire: boolean; days_since_verified: number; cadence_days: number | null;
        }>(`
          SELECT section, title, owner_agent_id, review_cadence, last_verified_at, auto_expire,
            EXTRACT(EPOCH FROM (NOW() - COALESCE(last_verified_at, created_at))) / 86400 AS days_since_verified,
            CASE review_cadence
              WHEN 'weekly'    THEN 7
              WHEN 'monthly'   THEN 30
              WHEN 'quarterly' THEN 90
              ELSE NULL
            END AS cadence_days
          FROM company_knowledge_base
          WHERE is_active = true
            AND review_cadence != 'never'
            AND review_cadence != 'on_change'
        `);

        const nowStale = staleRows.filter(r =>
          r.cadence_days != null && r.days_since_verified > r.cadence_days
        );

        if (nowStale.length === 0) {
          return { success: true, data: { stale_count: 0, message: 'All knowledge sections are within review cadence.' } };
        }

        // Mark stale
        const staleKeys = nowStale.map(r => r.section);
        await systemQuery(
          `UPDATE company_knowledge_base SET is_stale = TRUE WHERE section = ANY($1)`,
          [staleKeys],
        );

        return {
          success: true,
          data: {
            stale_count: nowStale.length,
            sections: nowStale.map(r => ({
              section: r.section,
              title: r.title,
              owner: r.owner_agent_id ?? 'founders',
              days_since_verified: Math.round(r.days_since_verified),
              cadence: r.review_cadence,
              auto_expire: r.auto_expire,
            })),
            owner_tasks_needed: nowStale.filter(r => r.owner_agent_id).length,
            founder_review_needed: nowStale.filter(r => !r.owner_agent_id).length,
          },
        };
      },
    },

    {
      name: 'verify_knowledge_section',
      description: 'Mark a knowledge section as verified after reviewing and confirming its accuracy. Only the owning agent or founders can verify. Call this after actually reading and confirming the section is accurate.',
      parameters: {
        section_key: { type: 'string', description: 'The section key to verify', required: true },
        content_updated: { type: 'boolean', description: 'Whether content was changed', required: true },
        change_summary: { type: 'string', description: 'What was changed, or "verified accurate, no changes" if unchanged', required: true },
        new_content: { type: 'string', description: 'Updated content if content_updated is true', required: false },
      },
      execute: async (params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        const sectionKey = params.section_key as string;
        const contentUpdated = params.content_updated === true;
        const changeSummary = params.change_summary as string;
        const newContent = typeof params.new_content === 'string' ? params.new_content : null;

        if (!sectionKey || !changeSummary) {
          return { success: false, error: 'section_key and change_summary are required' };
        }

        const [section] = await systemQuery<{
          section: string; content: string; version: number; owner_agent_id: string | null;
        }>(
          `SELECT section, content, version, owner_agent_id FROM company_knowledge_base WHERE section = $1`,
          [sectionKey],
        );

        if (!section) return { success: false, error: `Section '${sectionKey}' not found` };

        // Only owner or platform-intel (acting on behalf of founders) can verify
        if (section.owner_agent_id && section.owner_agent_id !== ctx.agentRole && ctx.agentRole !== 'platform-intel') {
          return { success: false, error: `Only ${section.owner_agent_id} or founders can verify this section` };
        }

        // Log the change
        await systemQuery(
          `INSERT INTO knowledge_change_log (section_key, version, previous_content, new_content, change_summary, changed_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sectionKey, section.version, section.content, contentUpdated ? newContent : section.content, changeSummary, ctx.agentRole],
        );

        // Update the section
        if (contentUpdated && newContent) {
          await systemQuery(
            `UPDATE company_knowledge_base SET
               content = $2,
               is_stale = FALSE,
               last_verified_at = NOW(),
               verified_by = $3,
               version = version + 1,
               change_summary = $4
             WHERE section = $1`,
            [sectionKey, newContent, ctx.agentRole, changeSummary],
          );
        } else {
          await systemQuery(
            `UPDATE company_knowledge_base SET
               is_stale = FALSE,
               last_verified_at = NOW(),
               verified_by = $2,
               version = version + 1,
               change_summary = $3
             WHERE section = $1`,
            [sectionKey, ctx.agentRole, changeSummary],
          );
        }

        return { success: true, data: { section_key: sectionKey, verified: true, version: section.version + 1 } };
      },
    },

  ];
}

/**
 * Nexus (Platform Intelligence) — Tool Set
 *
 * Read access to all eval signals and write access only to the autonomous-tier
 * targets. No direct DB write access — everything goes through named tools with
 * explicit audit.
 */

import type { ToolDefinition, ToolContext, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

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
          filter = 'WHERE a.id = $1';
          queryParams.push(agentId);
        }
        const rows = await systemQuery(
          `SELECT a.id, a.name, a.department, a.performance_score, a.model,
                  apv.version AS prompt_version, apv.source AS prompt_source,
                  COUNT(ff.id) FILTER (WHERE ff.severity='P0' AND ff.resolved_at IS NULL) AS open_p0s,
                  COUNT(ff.id) FILTER (WHERE ff.severity='P1' AND ff.resolved_at IS NULL) AS open_p1s,
                  MAX(ar.created_at) AS last_run_at,
                  AVG(CASE WHEN ar.status='completed' THEN 1.0 ELSE 0.0 END) AS success_rate
           FROM agents a
           LEFT JOIN agent_prompt_versions apv ON apv.agent_id = a.id AND apv.deployed_at IS NOT NULL AND apv.retired_at IS NULL
           LEFT JOIN fleet_findings ff ON ff.agent_id = a.id
           LEFT JOIN agent_runs ar ON ar.agent_id = a.id AND ar.created_at > NOW() - INTERVAL '30 days'
           ${filter}
           GROUP BY a.id, a.name, a.department, a.performance_score, a.model, apv.version, apv.source
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
             JOIN work_assignments wa ON wa.id = ar.assignment_id
             JOIN assignment_evaluations ae ON ae.assignment_id = wa.id
             WHERE ar.agent_id = $1 AND ae.score_normalized < 0.65
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
          `UPDATE agents SET status = 'paused', updated_at = NOW() WHERE id = $1`,
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

        return {
          success: true,
          data: {
            action_id: action.id,
            status: 'pending_approval',
            approve_token: approveToken?.token,
            reject_token: rejectToken?.token,
            title: params.title,
            rationale: params.rationale,
            urgency: params.urgency,
            target_agent_id: targetAgentId,
          },
        };
      },
    },

  ];
}

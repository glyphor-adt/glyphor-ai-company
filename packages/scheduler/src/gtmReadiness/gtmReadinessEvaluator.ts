import { systemQuery } from '@glyphor/shared/db';
import { GTM_THRESHOLDS, GTM_REQUIRED_AGENTS } from './thresholds.js';
import type { GtmAgentId } from './thresholds.js';

export type GateStatus = 'pass' | 'fail' | 'warn' | 'insufficient_data';

export interface AgentGateResult {
  agent_id: string;
  agent_name: string;
  overall: 'pass' | 'fail' | 'insufficient_data';
  gates: {
    performance_score:    { status: GateStatus; value: number | null; threshold: number };
    output_quality:       { status: GateStatus; value: number | null; threshold: number };
    success_rate:         { status: GateStatus; value: number | null; threshold: number };
    constitutional:       { status: GateStatus; value: number | null; threshold: number };
    tool_accuracy:        { status: GateStatus; value: number | null; threshold: number };
    knowledge_eval:       { status: GateStatus; value: number | null; threshold: number };
    open_p0s:             { status: GateStatus; value: number; threshold: number };
    consecutive_aborts:   { status: GateStatus; value: number; threshold: number };
    tool_failure_rate:    { status: GateStatus; value: number | null; threshold: number };
  };
  warnings: string[];
  eval_run_count: number;
  insufficient_data_reason: string | null;
  last_evaluated_at: string;
}

export interface GtmReadinessReport {
  generated_at: string;
  overall: 'READY' | 'NOT_READY' | 'INSUFFICIENT_DATA';
  marketing_department_ready: boolean;
  agents: AgentGateResult[];
  summary: {
    total_required: number;
    passing: number;
    failing: number;
    insufficient_data: number;
    blocking_issues: string[];
  };
}

const LOG_PREFIX = '[GtmReadiness]';

export async function runGtmReadinessEval(): Promise<GtmReadinessReport> {
  console.log(`${LOG_PREFIX} Starting GTM readiness evaluation...`);

  const agentResults = await Promise.all(
    GTM_REQUIRED_AGENTS.map(agentId => evaluateAgent(agentId))
  );

  const passing           = agentResults.filter(r => r.overall === 'pass').length;
  const failing           = agentResults.filter(r => r.overall === 'fail').length;
  const insufficient_data = agentResults.filter(r => r.overall === 'insufficient_data').length;

  const blockingIssues = agentResults
    .filter(r => r.overall === 'fail')
    .flatMap(r =>
      Object.entries(r.gates)
        .filter(([, gate]) => gate.status === 'fail')
        .map(([gateName, gate]) =>
          `${r.agent_id}: ${gateName} = ${gate.value ?? 'null'} (min: ${gate.threshold})`
        )
    );

  const overall: GtmReadinessReport['overall'] =
    insufficient_data === agentResults.length ? 'INSUFFICIENT_DATA' :
    failing > 0 ? 'NOT_READY' :
    'READY';

  const report: GtmReadinessReport = {
    generated_at: new Date().toISOString(),
    overall,
    marketing_department_ready: overall === 'READY',
    agents: agentResults,
    summary: {
      total_required: GTM_REQUIRED_AGENTS.length,
      passing,
      failing,
      insufficient_data,
      blocking_issues: blockingIssues,
    }
  };

  console.log(`${LOG_PREFIX} Evaluation complete: ${overall} (${passing} pass, ${failing} fail, ${insufficient_data} insufficient)`);
  return report;
}

export async function persistGtmReport(report: GtmReadinessReport): Promise<void> {
  await systemQuery(
    `INSERT INTO gtm_readiness_reports
     (overall, marketing_department_ready, report_json, passing_count, failing_count, insufficient_data_count)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      report.overall,
      report.marketing_department_ready,
      JSON.stringify(report),
      report.summary.passing,
      report.summary.failing,
      report.summary.insufficient_data,
    ]
  );
}

// ── Helpers ───────────────────────────────────────────────────

async function queryOne<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T | null> {
  const rows = await systemQuery<T>(sql, params);
  return rows[0] ?? null;
}

function gate(value: number | null, min: number): { status: GateStatus; value: number | null; threshold: number } {
  if (value === null) return { status: 'insufficient_data', value: null, threshold: min };
  return { status: value >= min ? 'pass' : 'fail', value, threshold: min };
}

function buildNullGates(): AgentGateResult['gates'] {
  const nullGate = { status: 'insufficient_data' as GateStatus, value: null as number | null, threshold: 0 };
  return {
    performance_score: nullGate, output_quality: nullGate,
    success_rate: nullGate, constitutional: nullGate,
    tool_accuracy: nullGate, knowledge_eval: nullGate,
    open_p0s: { ...nullGate, value: 0 }, consecutive_aborts: { ...nullGate, value: 0 },
    tool_failure_rate: nullGate,
  };
}

// ── Per-agent evaluation ─────────────────────────────────────

async function evaluateAgent(agentId: string): Promise<AgentGateResult> {
  const T = GTM_THRESHOLDS;

  // Pull all signals in parallel
  const [
    agentRow,
    qualityData,
    toolData,
    knowledgeData,
    findingsData,
    abortData,
    costLatencyData,
    worldStateData,
  ] = await Promise.all([

    // Agent base + performance score
    queryOne<{
      id: string; name: string; performance_score: number | null;
      prompt_version: number | null; prompt_source: string | null;
    }>(`
      SELECT a.role AS id, a.display_name AS name, a.performance_score,
             apv.version AS prompt_version, apv.source AS prompt_source
      FROM company_agents a
      LEFT JOIN agent_prompt_versions apv
        ON apv.agent_id = a.role AND apv.deployed_at IS NOT NULL AND apv.retired_at IS NULL
      WHERE a.role = $1
    `, [agentId]),

    // Output quality + success rate + constitutional + tool accuracy + eval run count
    queryOne<{
      eval_run_count: number; exec_quality: number | null; team_quality: number | null;
      success_rate: number | null; constitutional_score: number | null;
      tool_accuracy: number | null; constitutional_hard_fails: number;
    }>(`
      SELECT
        COUNT(DISTINCT wa.id) AS eval_run_count,
        AVG(ae_exec.score_normalized) AS exec_quality,
        AVG(ae_team.score_normalized) AS team_quality,
        (SELECT AVG(CASE WHEN status = 'completed' THEN 1.0 ELSE 0.0 END)
         FROM agent_runs WHERE agent_id = $1 AND created_at > NOW() - INTERVAL '60 days') AS success_rate,
        AVG(ae_con.score_normalized) AS constitutional_score,
        AVG(ae_tool.score_normalized) AS tool_accuracy,
        COUNT(ae_con.id) FILTER (
          WHERE ae_con.feedback::jsonb->>'hard_fail' = 'true'
          AND ae_con.evaluated_at > NOW() - INTERVAL '30 days'
        ) AS constitutional_hard_fails
      FROM work_assignments wa
      LEFT JOIN assignment_evaluations ae_exec ON ae_exec.assignment_id = wa.id AND ae_exec.evaluator_type = 'executive'
      LEFT JOIN assignment_evaluations ae_team ON ae_team.assignment_id = wa.id AND ae_team.evaluator_type = 'team'
      LEFT JOIN assignment_evaluations ae_con  ON ae_con.assignment_id  = wa.id AND ae_con.evaluator_type  = 'constitutional'
      LEFT JOIN assignment_evaluations ae_tool ON ae_tool.assignment_id = wa.id AND ae_tool.evaluator_type = 'tool_accuracy'
      WHERE wa.assigned_to = $1
      AND wa.created_at > NOW() - INTERVAL '60 days'
    `, [agentId]),

    // Tool failure rate
    queryOne<{ total_calls: number; failure_rate: number | null; failing_tool_count: number }>(`
      SELECT
        COUNT(*) AS total_calls,
        ROUND(
          COUNT(*) FILTER (WHERE result_success = false)::numeric / NULLIF(COUNT(*), 0),
          3
        ) AS failure_rate,
        COUNT(DISTINCT tool_name) FILTER (
          WHERE result_success = false
        ) AS failing_tool_count
      FROM tool_call_traces
      WHERE agent_id = $1
      AND called_at > NOW() - INTERVAL '30 days'
    `, [agentId]),

    // Knowledge eval — judge scenario results
    queryOne<{ total_scenarios: number; passed: number; hard_fails: number }>(`
      SELECT
        COUNT(*) AS total_scenarios,
        COUNT(*) FILTER (WHERE score = 'PASS') AS passed,
        COUNT(*) FILTER (WHERE score = 'HARD_FAIL') AS hard_fails
      FROM agent_eval_results aer
      JOIN agent_eval_scenarios aes ON aes.id = aer.scenario_id
      WHERE aes.agent_role = $1
      AND aer.run_date > (NOW() - INTERVAL '90 days')::text
    `, [agentId]),

    // Open fleet findings
    queryOne<{ open_p0s: number; open_p1s: number }>(`
      SELECT
        COUNT(*) FILTER (WHERE severity = 'P0' AND resolved_at IS NULL) AS open_p0s,
        COUNT(*) FILTER (WHERE severity = 'P1' AND resolved_at IS NULL) AS open_p1s
      FROM fleet_findings
      WHERE agent_id = $1
    `, [agentId]),

    // Consecutive aborts (most recent N runs)
    queryOne<{ consecutive_aborts: number }>(`
      SELECT COUNT(*) AS consecutive_aborts
      FROM (
        SELECT status,
               ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
        FROM agent_runs
        WHERE agent_id = $1
        ORDER BY created_at DESC
        LIMIT 10
      ) recent
      WHERE status = 'aborted'
      AND rn <= COALESCE((
        SELECT MIN(rn) - 1 FROM (
          SELECT ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn, status
          FROM agent_runs WHERE agent_id = $1
          ORDER BY created_at DESC LIMIT 10
        ) t WHERE status != 'aborted'
      ), 10)
    `, [agentId]),

    // Cost and latency
    queryOne<{ avg_cost: number | null; p95_latency_ms: number | null }>(`
      SELECT
        AVG(estimated_cost_usd) AS avg_cost,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_latency_ms
      FROM agent_runs
      WHERE agent_id = $1
      AND created_at > NOW() - INTERVAL '30 days'
      AND estimated_cost_usd IS NOT NULL
    `, [agentId]),

    // World state freshness
    queryOne<{ stale_keys: number }>(`
      SELECT COUNT(*) AS stale_keys
      FROM world_state
      WHERE (
        written_by_agent = $1
        OR key LIKE '%' || $1 || '%'
      )
      AND (
        valid_until < NOW()
        OR (domain = 'customer' AND updated_at < NOW() - INTERVAL '24 hours')
        OR (domain = 'campaign' AND updated_at < NOW() - INTERVAL '6 hours')
      )
    `, [agentId]),
  ]);

  // Insufficient data check
  const evalRunCount = qualityData?.eval_run_count ?? 0;
  if (evalRunCount < T.min_eval_runs) {
    return {
      agent_id: agentId,
      agent_name: agentRow?.name ?? agentId,
      overall: 'insufficient_data',
      gates: buildNullGates(),
      warnings: [],
      eval_run_count: evalRunCount,
      insufficient_data_reason: `Only ${evalRunCount} scored runs. Minimum ${T.min_eval_runs} required.`,
      last_evaluated_at: new Date().toISOString(),
    };
  }

  // Gate evaluations
  const outputQuality = qualityData?.exec_quality != null && qualityData?.team_quality != null
    ? (qualityData.exec_quality + qualityData.team_quality) / 2
    : qualityData?.exec_quality ?? qualityData?.team_quality ?? null;

  const gates: AgentGateResult['gates'] = {
    performance_score: gate(agentRow?.performance_score ?? null, T.performance_score_min),
    output_quality:    gate(outputQuality,                       T.output_quality_min),
    success_rate:      gate(qualityData?.success_rate ?? null,   T.success_rate_min),
    constitutional:    gate(qualityData?.constitutional_score ?? null, T.constitutional_min),
    tool_accuracy:     gate(qualityData?.tool_accuracy ?? null,  T.tool_accuracy_min),
    knowledge_eval: (() => {
      const scenarios = knowledgeData?.total_scenarios ?? 0;
      if (scenarios < T.min_knowledge_eval_scenarios) {
        return { status: 'insufficient_data' as GateStatus, value: scenarios, threshold: T.min_knowledge_eval_scenarios };
      }
      const hardFails = knowledgeData?.hard_fails ?? 0;
      return { status: hardFails > 0 ? 'fail' : 'pass' as GateStatus, value: hardFails, threshold: 0 };
    })(),
    open_p0s: {
      status: ((findingsData?.open_p0s ?? 0) > T.hard_blocks.open_p0s ? 'fail' : 'pass') as GateStatus,
      value: findingsData?.open_p0s ?? 0,
      threshold: T.hard_blocks.open_p0s,
    },
    consecutive_aborts: {
      status: ((abortData?.consecutive_aborts ?? 0) >= T.hard_blocks.max_consecutive_aborts ? 'fail' : 'pass') as GateStatus,
      value: abortData?.consecutive_aborts ?? 0,
      threshold: T.hard_blocks.max_consecutive_aborts,
    },
    tool_failure_rate: gate(
      toolData?.failure_rate != null ? 1 - toolData.failure_rate : null,
      1 - T.hard_blocks.tool_repeated_failure_rate
    ),
  };

  // Warnings
  const warnings: string[] = [];
  if ((agentRow?.performance_score ?? 0) < T.warnings.performance_score_warn)
    warnings.push(`Performance score ${Math.round((agentRow?.performance_score ?? 0) * 100)} is below healthy threshold (${T.warnings.performance_score_warn * 100})`);
  if ((costLatencyData?.p95_latency_ms ?? 0) > T.warnings.p95_latency_ms)
    warnings.push(`p95 latency ${Math.round(costLatencyData?.p95_latency_ms ?? 0)}ms exceeds ${T.warnings.p95_latency_ms}ms threshold`);
  if ((costLatencyData?.avg_cost ?? 0) > T.warnings.avg_cost_per_run_usd)
    warnings.push(`Average cost $${(costLatencyData?.avg_cost ?? 0).toFixed(3)} per run exceeds $${T.warnings.avg_cost_per_run_usd}`);
  if ((worldStateData?.stale_keys ?? 0) > T.warnings.world_state_stale_keys)
    warnings.push(`${worldStateData?.stale_keys ?? 0} stale world state keys`);
  if ((qualityData?.constitutional_hard_fails ?? 0) > 0)
    warnings.push(`${qualityData?.constitutional_hard_fails ?? 0} constitutional hard fail(s) in last 30 days`);

  const overall: AgentGateResult['overall'] =
    Object.values(gates).some(g => g.status === 'fail') ? 'fail' : 'pass';

  return {
    agent_id: agentId,
    agent_name: agentRow?.name ?? agentId,
    overall,
    gates,
    warnings,
    eval_run_count: evalRunCount,
    insufficient_data_reason: null,
    last_evaluated_at: new Date().toISOString(),
  };
}

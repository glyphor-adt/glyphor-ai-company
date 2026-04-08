import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  computeFleetMetrics,
  getAgentEconomicsOverview,
  getAgentMetricsWindows,
  getBenchmarkReport,
  getExceptionLog,
  getReversalStats,
  listActionReversals,
  listAgentMetrics,
  listGoldenEvalPassRatesByRole,
  type ExceptionLogFilters,
  type FleetEconomicsSummary,
  type ReversalLogFilters,
} from '@glyphor/shared';
import { systemQuery } from '@glyphor/shared/db';
import { evaluatePlanningGateHealth } from './planningGateMonitor.js';

function json(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => resolve(body || '{}'));
    req.on('error', reject);
  });
}

/** When `false`, POST apply is rejected. Default: allowed (unset or any other value). */
function isPlanningGateEvalApplyEnabled(): boolean {
  return process.env.PLANNING_GATE_EVAL_APPLY_ENABLED?.trim().toLowerCase() !== 'false';
}

function parseWindow(value: string | null, fallback = 30): 7 | 30 | 90 {
  const parsed = Number(value ?? fallback);
  if (parsed === 7 || parsed === 30 || parsed === 90) return parsed;
  return fallback as 7 | 30 | 90;
}

function parsePositiveInteger(value: string | null, fallback: number, max = 200): number {
  const parsed = Number(value ?? '');
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(parsed)));
}

type PlanningGateEventRow = {
  run_id: string;
  event_type: 'planning_phase_started' | 'completion_gate_failed' | 'completion_gate_passed';
  payload: Record<string, unknown> | string | null;
  created_at: string;
  agent_role: string | null;
};

type PlanningGateRunAggregate = {
  runId: string;
  role: string;
  planningEvents: number;
  gatePassEvents: number;
  gateFailEvents: number;
  maxRetryAttempt: number;
  missingCriteriaMentions: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
};

type PlanningGateRoleSummary = {
  role: string;
  runsObserved: number;
  runsWithPlanning: number;
  runsWithGatePass: number;
  runsWithGateFail: number;
  planningEvents: number;
  gatePassEvents: number;
  gateFailEvents: number;
  maxRetryAttempt: number;
  avgMissingCriteriaMentions: number;
  passRate: number;
};

type WindowedRate = {
  windowDays: number;
  total: number;
  passed: number;
  rate: number;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

async function getPlanningGateMetrics(windowDays: 7 | 30 | 90): Promise<{
  windowDays: number;
  totals: {
    runsObserved: number;
    runsWithPlanning: number;
    runsWithGatePass: number;
    runsWithGateFail: number;
    planningEvents: number;
    gatePassEvents: number;
    gateFailEvents: number;
    maxRetryAttempt: number;
    avgMissingCriteriaMentions: number;
    passRate: number;
  };
  roles: PlanningGateRoleSummary[];
}> {
  const rows = await systemQuery<PlanningGateEventRow>(
    `SELECT
       e.run_id,
       e.event_type,
       e.payload,
       e.created_at,
       ar.agent_id AS agent_role
     FROM agent_run_events e
     LEFT JOIN agent_runs ar ON ar.id = e.run_id
     WHERE e.created_at >= NOW() - ($1::int * INTERVAL '1 day')
       AND e.event_type IN ('planning_phase_started', 'completion_gate_failed', 'completion_gate_passed')
     ORDER BY e.created_at DESC`,
    [windowDays],
  );

  const byRun = new Map<string, PlanningGateRunAggregate>();

  for (const row of rows) {
    const key = row.run_id;
    const role = row.agent_role ?? 'unknown';
    const current = byRun.get(key) ?? {
      runId: row.run_id,
      role,
      planningEvents: 0,
      gatePassEvents: 0,
      gateFailEvents: 0,
      maxRetryAttempt: 0,
      missingCriteriaMentions: 0,
      firstEventAt: null,
      lastEventAt: null,
    };

    current.role = current.role === 'unknown' ? role : current.role;
    current.firstEventAt = current.firstEventAt && current.firstEventAt < row.created_at ? current.firstEventAt : row.created_at;
    current.lastEventAt = current.lastEventAt && current.lastEventAt > row.created_at ? current.lastEventAt : row.created_at;

    const payload = asObject(row.payload);
    if (row.event_type === 'planning_phase_started') {
      current.planningEvents += 1;
    } else if (row.event_type === 'completion_gate_passed') {
      current.gatePassEvents += 1;
    } else if (row.event_type === 'completion_gate_failed') {
      current.gateFailEvents += 1;
      const retryAttempt = Number(payload.retry_attempt ?? 0);
      if (Number.isFinite(retryAttempt) && retryAttempt > current.maxRetryAttempt) {
        current.maxRetryAttempt = retryAttempt;
      }
      const missingCriteria = Array.isArray(payload.missing_criteria)
        ? payload.missing_criteria.filter((item) => typeof item === 'string').length
        : 0;
      current.missingCriteriaMentions += missingCriteria;
    }

    byRun.set(key, current);
  }

  const roleMap = new Map<string, PlanningGateRoleSummary>();
  for (const run of byRun.values()) {
    const existing = roleMap.get(run.role) ?? {
      role: run.role,
      runsObserved: 0,
      runsWithPlanning: 0,
      runsWithGatePass: 0,
      runsWithGateFail: 0,
      planningEvents: 0,
      gatePassEvents: 0,
      gateFailEvents: 0,
      maxRetryAttempt: 0,
      avgMissingCriteriaMentions: 0,
      passRate: 0,
    };

    existing.runsObserved += 1;
    if (run.planningEvents > 0) existing.runsWithPlanning += 1;
    if (run.gatePassEvents > 0) existing.runsWithGatePass += 1;
    if (run.gateFailEvents > 0) existing.runsWithGateFail += 1;
    existing.planningEvents += run.planningEvents;
    existing.gatePassEvents += run.gatePassEvents;
    existing.gateFailEvents += run.gateFailEvents;
    existing.maxRetryAttempt = Math.max(existing.maxRetryAttempt, run.maxRetryAttempt);
    existing.avgMissingCriteriaMentions += run.missingCriteriaMentions;
    roleMap.set(run.role, existing);
  }

  const roles = Array.from(roleMap.values())
    .map((role) => {
      const denominator = role.runsWithPlanning > 0 ? role.runsWithPlanning : role.runsObserved;
      return {
        ...role,
        avgMissingCriteriaMentions: role.runsObserved > 0
          ? Number((role.avgMissingCriteriaMentions / role.runsObserved).toFixed(2))
          : 0,
        passRate: denominator > 0
          ? Number((role.runsWithGatePass / denominator).toFixed(4))
          : 0,
      };
    })
    .sort((a, b) => b.runsObserved - a.runsObserved || a.role.localeCompare(b.role));

  const totalsRaw = roles.reduce((acc, role) => {
    acc.runsObserved += role.runsObserved;
    acc.runsWithPlanning += role.runsWithPlanning;
    acc.runsWithGatePass += role.runsWithGatePass;
    acc.runsWithGateFail += role.runsWithGateFail;
    acc.planningEvents += role.planningEvents;
    acc.gatePassEvents += role.gatePassEvents;
    acc.gateFailEvents += role.gateFailEvents;
    acc.maxRetryAttempt = Math.max(acc.maxRetryAttempt, role.maxRetryAttempt);
    acc.missingCriteriaTotal += role.avgMissingCriteriaMentions * role.runsObserved;
    return acc;
  }, {
    runsObserved: 0,
    runsWithPlanning: 0,
    runsWithGatePass: 0,
    runsWithGateFail: 0,
    planningEvents: 0,
    gatePassEvents: 0,
    gateFailEvents: 0,
    maxRetryAttempt: 0,
    missingCriteriaTotal: 0,
  });

  const totalsDenominator = totalsRaw.runsWithPlanning > 0 ? totalsRaw.runsWithPlanning : totalsRaw.runsObserved;
  return {
    windowDays,
    totals: {
      runsObserved: totalsRaw.runsObserved,
      runsWithPlanning: totalsRaw.runsWithPlanning,
      runsWithGatePass: totalsRaw.runsWithGatePass,
      runsWithGateFail: totalsRaw.runsWithGateFail,
      planningEvents: totalsRaw.planningEvents,
      gatePassEvents: totalsRaw.gatePassEvents,
      gateFailEvents: totalsRaw.gateFailEvents,
      maxRetryAttempt: totalsRaw.maxRetryAttempt,
      avgMissingCriteriaMentions: totalsRaw.runsObserved > 0
        ? Number((totalsRaw.missingCriteriaTotal / totalsRaw.runsObserved).toFixed(2))
        : 0,
      passRate: totalsDenominator > 0
        ? Number((totalsRaw.runsWithGatePass / totalsDenominator).toFixed(4))
        : 0,
    },
    roles,
  };
}

function buildEconomicsGuardrailAlerts(
  fleetEconomics: FleetEconomicsSummary,
  planningTotals: { passRate: number },
): string[] {
  const alerts: string[] = [];
  const maxCost = Number(process.env.ECONOMICS_ALERT_MAX_AVG_COST_USD_PER_COMPLETED_RUN?.trim());
  if (
    Number.isFinite(maxCost)
    && fleetEconomics.avgCostUsdPerCompleted != null
    && fleetEconomics.avgCostUsdPerCompleted > maxCost
  ) {
    alerts.push(
      `Fleet avg cost per completed run (${fleetEconomics.avgCostUsdPerCompleted.toFixed(4)} USD) exceeds ECONOMICS_ALERT_MAX_AVG_COST_USD_PER_COMPLETED_RUN (${maxCost}).`,
    );
  }
  const maxP95Min = Number(process.env.ECONOMICS_ALERT_P95_LATENCY_MINUTES?.trim());
  if (
    Number.isFinite(maxP95Min)
    && fleetEconomics.p95LatencyMinutes != null
    && fleetEconomics.p95LatencyMinutes > maxP95Min
  ) {
    alerts.push(
      `Fleet P95 run latency (${fleetEconomics.p95LatencyMinutes.toFixed(1)} min) exceeds ECONOMICS_ALERT_P95_LATENCY_MINUTES (${maxP95Min}).`,
    );
  }
  const minRunDone = Number(process.env.ECONOMICS_ALERT_MIN_RUN_COMPLETION_RATE?.trim());
  if (Number.isFinite(minRunDone) && fleetEconomics.runCompletionRate < minRunDone) {
    alerts.push(
      `Fleet agent_runs completion ratio (${(fleetEconomics.runCompletionRate * 100).toFixed(1)}%) is below ECONOMICS_ALERT_MIN_RUN_COMPLETION_RATE (${(minRunDone * 100).toFixed(1)}%).`,
    );
  }
  const minGate = Number(process.env.ECONOMICS_ALERT_MIN_GATE_PASS_RATE?.trim());
  if (Number.isFinite(minGate) && planningTotals.passRate < minGate) {
    alerts.push(
      `Fleet completion-gate pass rate (${(planningTotals.passRate * 100).toFixed(1)}%) is below ECONOMICS_ALERT_MIN_GATE_PASS_RATE (${(minGate * 100).toFixed(1)}%).`,
    );
  }
  return alerts;
}

export async function getEconomicsQualityOverview(windowDays: 7 | 30 | 90): Promise<{
  windowDays: number;
  generatedAt: string;
  economicsGeneratedAt: string;
  fleet: FleetEconomicsSummary & {
    gatePassRate: number;
    planningRunsDenominator: number;
  };
  roles: Array<{
    agentId: string;
    runsTerminal: number;
    runsCompleted: number;
    runCompletionRate: number;
    avgCostUsdPerCompleted: number | null;
    p50LatencyMinutes: number | null;
    p95LatencyMinutes: number | null;
    sumCostUsdRecorded: number;
    gatePassRate: number | null;
    gateDenominator: number;
    goldenEvalPassRate: number | null;
    goldenEvalTotal: number;
  }>;
  alerts: string[];
}> {
  const [economics, planning, golden] = await Promise.all([
    getAgentEconomicsOverview(windowDays),
    getPlanningGateMetrics(windowDays),
    listGoldenEvalPassRatesByRole(windowDays).catch(() => []),
  ]);

  const gateMap = new Map(planning.roles.map((r) => [r.role, r]));
  const goldenMap = new Map(golden.map((g) => [g.agentRole, g]));
  const roleIds = new Set<string>([
    ...economics.roles.map((r) => r.agentId),
    ...planning.roles.map((r) => r.role),
    ...golden.map((g) => g.agentRole),
  ]);

  const merged = Array.from(roleIds)
    .sort((a, b) => a.localeCompare(b))
    .map((agentId) => {
      const econ = economics.roles.find((r) => r.agentId === agentId);
      const gate = gateMap.get(agentId);
      const gold = goldenMap.get(agentId);
      const gateDenom = gate ? (gate.runsWithPlanning > 0 ? gate.runsWithPlanning : gate.runsObserved) : 0;
      return {
        agentId,
        runsTerminal: econ?.runsTerminal ?? 0,
        runsCompleted: econ?.runsCompleted ?? 0,
        runCompletionRate: econ?.runCompletionRate ?? 0,
        avgCostUsdPerCompleted: econ?.avgCostUsdPerCompleted ?? null,
        p50LatencyMinutes: econ?.p50LatencyMinutes ?? null,
        p95LatencyMinutes: econ?.p95LatencyMinutes ?? null,
        sumCostUsdRecorded: econ?.sumCostUsdRecorded ?? 0,
        gatePassRate: gate && gateDenom > 0 ? gate.passRate : null,
        gateDenominator: gateDenom,
        goldenEvalPassRate: gold && gold.total > 0 ? gold.passRate : null,
        goldenEvalTotal: gold?.total ?? 0,
      };
    })
    .filter((row) => row.runsTerminal > 0 || row.gateDenominator > 0 || row.goldenEvalTotal > 0);

  const planningDenom = planning.totals.runsWithPlanning > 0
    ? planning.totals.runsWithPlanning
    : planning.totals.runsObserved;

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    economicsGeneratedAt: economics.generatedAt,
    fleet: {
      ...economics.fleet,
      gatePassRate: planning.totals.passRate,
      planningRunsDenominator: planningDenom,
    },
    roles: merged,
    alerts: buildEconomicsGuardrailAlerts(economics.fleet, planning.totals),
  };
}

async function getGoldenEvalRate(windowDays: 7 | 30 | 90): Promise<WindowedRate> {
  const rows = await systemQuery<{ total: number; passed: number }>(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE r.score = 'PASS')::int AS passed
     FROM agent_eval_results r
     JOIN agent_eval_scenarios s ON s.id = r.scenario_id
     WHERE r.run_date >= NOW() - ($1::int * INTERVAL '1 day')
       AND s.scenario_name ILIKE 'golden:%'`,
    [windowDays],
  );

  const total = Number(rows[0]?.total ?? 0);
  const passed = Number(rows[0]?.passed ?? 0);
  return {
    windowDays,
    total,
    passed,
    rate: total > 0 ? Number((passed / total).toFixed(4)) : 0,
  };
}

async function getAutoRepairConversion(windowDays: 7 | 30 | 90): Promise<{
  windowDays: number;
  triggered: number;
  convertedToPass: number;
  conversionRate: number;
}> {
  const rows = await systemQuery<{ triggered: number; converted_to_pass: number }>(
    `WITH triggered AS (
       SELECT run_id, MIN(event_seq) AS trigger_seq
       FROM agent_run_events
       WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
         AND event_type = 'completion_gate_auto_repair_triggered'
       GROUP BY run_id
     ),
     converted AS (
       SELECT t.run_id
       FROM triggered t
       JOIN agent_run_events e
         ON e.run_id = t.run_id
        AND e.event_type = 'completion_gate_passed'
        AND e.event_seq > t.trigger_seq
       GROUP BY t.run_id
     )
     SELECT
       COUNT(*)::int AS triggered,
       COUNT(c.run_id)::int AS converted_to_pass
     FROM triggered t
     LEFT JOIN converted c ON c.run_id = t.run_id`,
    [windowDays],
  );

  const triggered = Number(rows[0]?.triggered ?? 0);
  const convertedToPass = Number(rows[0]?.converted_to_pass ?? 0);
  return {
    windowDays,
    triggered,
    convertedToPass,
    conversionRate: triggered > 0 ? Number((convertedToPass / triggered).toFixed(4)) : 0,
  };
}

async function getTopMissingCriteria(windowDays: 7 | 30 | 90, limit = 5): Promise<Array<{ criterion: string; count: number }>> {
  const rows = await systemQuery<{ criterion: string; count: number }>(
    `SELECT
       TRIM(criteria.value) AS criterion,
       COUNT(*)::int AS count
     FROM agent_run_events e
     CROSS JOIN LATERAL jsonb_array_elements_text(
       CASE
         WHEN jsonb_typeof((e.payload)::jsonb -> 'missing_criteria') = 'array'
           THEN (e.payload)::jsonb -> 'missing_criteria'
         ELSE '[]'::jsonb
       END
     ) AS criteria(value)
     WHERE e.created_at >= NOW() - ($1::int * INTERVAL '1 day')
       AND e.event_type = 'completion_gate_failed'
     GROUP BY TRIM(criteria.value)
     HAVING TRIM(criteria.value) <> ''
     ORDER BY count DESC, criterion ASC
     LIMIT $2`,
    [windowDays, limit],
  );

  return rows.map((row) => ({
    criterion: row.criterion,
    count: Number(row.count ?? 0),
  }));
}

export interface PlanningGateEvalSuggestion {
  agentRole: string;
  scenarioName: string;
  criterion: string;
  gateFailureCount: number;
  inputPrompt: string;
  passCriteria: string;
  failIndicators: string;
  knowledgeTags: string[];
  /** Whether this exact (tenant, role, scenario_name) already exists in `agent_eval_scenarios`. */
  scenarioAlreadyExists: boolean;
  /** Present when `scenarioAlreadyExists` is true. */
  existingScenarioId: string | null;
  /** Ready-to-paste row for `agent_eval_scenarios` migrations (system tenant). */
  seedRow: {
    agent_role: string;
    scenario_name: string;
    input_prompt: string;
    pass_criteria: string;
    fail_indicators: string;
    knowledge_tags: string[];
    tenant_id: string;
  };
}

const SYSTEM_EVAL_TENANT_ID = '00000000-0000-0000-0000-000000000000';

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function formatKnowledgeTagsSql(tags: string[]): string {
  if (tags.length === 0) return `ARRAY[]::text[]`;
  return `ARRAY[${tags.map((tag) => `'${escapeSqlString(tag)}'`).join(', ')}]::text[]`;
}

function buildEvalSuggestionsInsertSql(suggestions: PlanningGateEvalSuggestion[]): string {
  const header = [
    '-- Draft INSERT for agent_eval_scenarios (system tenant)',
    '-- Generated from completion-gate telemetry; review prompts before apply',
    '',
  ];
  if (suggestions.length === 0) {
    return [...header, '-- No gate-miss suggestions in this window', ''].join('\n');
  }
  const pending = suggestions.filter((row) => !row.scenarioAlreadyExists);
  if (pending.length === 0) {
    return [...header, '-- All suggested scenarios already exist (nothing to insert)', ''].join('\n');
  }

  const valueLines = pending.map((row) => {
    const r = row.seedRow;
    return [
      '  (',
      `    '${escapeSqlString(r.agent_role)}',`,
      `    '${escapeSqlString(r.scenario_name)}',`,
      `    '${escapeSqlString(r.input_prompt)}',`,
      `    '${escapeSqlString(r.pass_criteria)}',`,
      `    '${escapeSqlString(r.fail_indicators)}',`,
      `    ${formatKnowledgeTagsSql(r.knowledge_tags)},`,
      `    '${SYSTEM_EVAL_TENANT_ID}'::uuid`,
      '  )',
    ].join('\n');
  });

  return [
    ...header,
    'INSERT INTO agent_eval_scenarios (',
    '  agent_role,',
    '  scenario_name,',
    '  input_prompt,',
    '  pass_criteria,',
    '  fail_indicators,',
    '  knowledge_tags,',
    '  tenant_id',
    ') VALUES',
    valueLines.join(',\n'),
    'ON CONFLICT (tenant_id, agent_role, scenario_name) DO NOTHING;',
    '',
  ].join('\n');
}

function scenarioNameFromGateMiss(agentRole: string, criterion: string): string {
  const basis = `${agentRole}\n${criterion}`;
  const hash = createHash('sha256').update(basis).digest('hex').slice(0, 12);
  return `golden:from-gate:${hash}`;
}

async function getPlanningGateEvalSuggestions(
  windowDays: 7 | 30 | 90,
  limit: number,
): Promise<{
  windowDays: number;
  generatedAt: string;
  suggestions: PlanningGateEvalSuggestion[];
  insertSql: string;
}> {
  const rows = await systemQuery<{ agent_role: string; criterion: string; fail_count: number }>(
    `SELECT
       COALESCE(ar.agent_id, 'unknown') AS agent_role,
       TRIM(criteria.value) AS criterion,
       COUNT(*)::int AS fail_count
     FROM agent_run_events e
     LEFT JOIN agent_runs ar ON ar.id = e.run_id
     CROSS JOIN LATERAL jsonb_array_elements_text(
       CASE
         WHEN jsonb_typeof((e.payload)::jsonb -> 'missing_criteria') = 'array'
           THEN (e.payload)::jsonb -> 'missing_criteria'
         ELSE '[]'::jsonb
       END
     ) AS criteria(value)
     WHERE e.created_at >= NOW() - ($1::int * INTERVAL '1 day')
       AND e.event_type = 'completion_gate_failed'
       AND TRIM(criteria.value) <> ''
     GROUP BY COALESCE(ar.agent_id, 'unknown'), TRIM(criteria.value)
     ORDER BY fail_count DESC, agent_role ASC, criterion ASC
     LIMIT $2`,
    [windowDays, limit],
  );

  const baseSuggestions: PlanningGateEvalSuggestion[] = rows.map((row) => {
    const agentRole = row.agent_role || 'unknown';
    const criterion = row.criterion || '';
    const scenarioName = scenarioNameFromGateMiss(agentRole, criterion);
    const failCount = Number(row.fail_count ?? 0);
    const inputPrompt = `You are the "${agentRole}" agent. Produce a concrete deliverable for a realistic internal task where the output must clearly satisfy this acceptance requirement: "${criterion}". Avoid placeholders; include checkable specifics a reviewer can verify.`;
    const passCriteria = `The response explicitly and correctly satisfies: ${criterion}. Details are specific enough that compliance is objectively verifiable (not generic boilerplate).`;
    const failIndicators = `Vague or missing treatment of: ${criterion}. Generic filler, hand-waving, or internal contradictions that would fail a completion gate.`;
    const knowledgeTags = ['completion_gate', 'from_gate_telemetry', agentRole];
    return {
      agentRole,
      scenarioName,
      criterion,
      gateFailureCount: failCount,
      inputPrompt,
      passCriteria,
      failIndicators,
      knowledgeTags,
      scenarioAlreadyExists: false,
      existingScenarioId: null,
      seedRow: {
        agent_role: agentRole,
        scenario_name: scenarioName,
        input_prompt: inputPrompt,
        pass_criteria: passCriteria,
        fail_indicators: failIndicators,
        knowledge_tags: knowledgeTags,
        tenant_id: SYSTEM_EVAL_TENANT_ID,
      },
    };
  });

  let suggestions = baseSuggestions;
  if (baseSuggestions.length > 0) {
    const pairPayload = JSON.stringify(
      baseSuggestions.map((s) => ({ agent_role: s.agentRole, scenario_name: s.scenarioName })),
    );
    const existingRows = await systemQuery<{ agent_role: string; scenario_name: string; scenario_id: string }>(
      `SELECT s.agent_role, s.scenario_name, s.id::text AS scenario_id
       FROM agent_eval_scenarios s
       INNER JOIN jsonb_to_recordset($2::jsonb) AS x(agent_role text, scenario_name text)
         ON s.agent_role = x.agent_role AND s.scenario_name = x.scenario_name
       WHERE s.tenant_id = $1::uuid`,
      [SYSTEM_EVAL_TENANT_ID, pairPayload],
    );
    const idByPair = new Map<string, string>();
    for (const ex of existingRows) {
      idByPair.set(`${ex.agent_role}\0${ex.scenario_name}`, ex.scenario_id);
    }
    suggestions = baseSuggestions.map((s) => {
      const key = `${s.agentRole}\0${s.scenarioName}`;
      const existingScenarioId = idByPair.get(key) ?? null;
      return {
        ...s,
        scenarioAlreadyExists: existingScenarioId != null,
        existingScenarioId,
      };
    });
  }

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    suggestions,
    insertSql: buildEvalSuggestionsInsertSql(suggestions),
  };
}

export async function applyPlanningGateEvalScenariosFromTelemetry(options: {
  windowDays: 7 | 30 | 90;
  limit: number;
  dryRun: boolean;
}): Promise<{
  dryRun: boolean;
  windowDays: number;
  generatedAt: string;
  candidateNewCount: number;
  alreadyInSuiteCount: number;
  insertedCount: number;
  noOpConflictCount: number;
  insertedScenarios: Array<{ id: string; agentRole: string; scenarioName: string }>;
  suggestions: PlanningGateEvalSuggestion[];
  insertSql: string;
}> {
  const snapshot = await getPlanningGateEvalSuggestions(options.windowDays, options.limit);
  const pending = snapshot.suggestions.filter((s) => !s.scenarioAlreadyExists);
  const alreadyInSuiteCount = snapshot.suggestions.filter((s) => s.scenarioAlreadyExists).length;

  if (options.dryRun) {
    return {
      dryRun: true,
      windowDays: snapshot.windowDays,
      generatedAt: new Date().toISOString(),
      candidateNewCount: pending.length,
      alreadyInSuiteCount,
      insertedCount: 0,
      noOpConflictCount: 0,
      insertedScenarios: [],
      suggestions: snapshot.suggestions,
      insertSql: snapshot.insertSql,
    };
  }

  const insertedScenarios: Array<{ id: string; agentRole: string; scenarioName: string }> = [];
  let insertedCount = 0;
  for (const s of pending) {
    const rows = await systemQuery<{ id: string }>(
      `INSERT INTO agent_eval_scenarios (
         agent_role, scenario_name, input_prompt, pass_criteria, fail_indicators, knowledge_tags, tenant_id
       ) VALUES ($1, $2, $3, $4, $5, $6::text[], $7::uuid)
       ON CONFLICT (tenant_id, agent_role, scenario_name) DO NOTHING
       RETURNING id::text AS id`,
      [
        s.seedRow.agent_role,
        s.seedRow.scenario_name,
        s.seedRow.input_prompt,
        s.seedRow.pass_criteria,
        s.seedRow.fail_indicators,
        s.seedRow.knowledge_tags,
        SYSTEM_EVAL_TENANT_ID,
      ],
    );
    const id = rows[0]?.id;
    if (id) {
      insertedCount += 1;
      insertedScenarios.push({ id, agentRole: s.agentRole, scenarioName: s.scenarioName });
    }
  }

  const noOpConflictCount = pending.length - insertedCount;

  return {
    dryRun: false,
    windowDays: snapshot.windowDays,
    generatedAt: new Date().toISOString(),
    candidateNewCount: pending.length,
    alreadyInSuiteCount,
    insertedCount,
    noOpConflictCount,
    insertedScenarios,
    suggestions: snapshot.suggestions,
    insertSql: snapshot.insertSql,
  };
}

async function getPlanningGateStage3Metrics(windowDays: 7 | 30 | 90): Promise<{
  windowDays: number;
  generatedAt: string;
  goldenEval: {
    current: WindowedRate;
    baseline30d: WindowedRate;
    deltaVs30d: number;
  };
  autoRepair: {
    current: { windowDays: number; triggered: number; convertedToPass: number; conversionRate: number };
    baseline30d: { windowDays: number; triggered: number; convertedToPass: number; conversionRate: number };
    deltaVs30d: number;
  };
  topMissingCriteria: Array<{ criterion: string; count: number }>;
}> {
  const [goldenCurrent, golden30d, autoRepairCurrent, autoRepair30d, topMissingCriteria] = await Promise.all([
    getGoldenEvalRate(windowDays),
    getGoldenEvalRate(30),
    getAutoRepairConversion(windowDays),
    getAutoRepairConversion(30),
    getTopMissingCriteria(windowDays, 5),
  ]);

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    goldenEval: {
      current: goldenCurrent,
      baseline30d: golden30d,
      deltaVs30d: Number((goldenCurrent.rate - golden30d.rate).toFixed(4)),
    },
    autoRepair: {
      current: autoRepairCurrent,
      baseline30d: autoRepair30d,
      deltaVs30d: Number((autoRepairCurrent.conversionRate - autoRepair30d.conversionRate).toFixed(4)),
    },
    topMissingCriteria,
  };
}

// ─── Agent Ops Metrics ──────────────────────────────────────────────────────

interface EvidenceTierBreakdown {
  proven: number;
  partially_proven: number;
  self_reported: number;
  inconsistent: number;
  unclassified: number; // pre-migration rows with no evidence_tier
}

interface AgentOpsRow {
  agent_role: string;
  run_count: number;
  avg_quality: number | null;
  evidence_tiers: EvidenceTierBreakdown;
  downgraded_count: number; // runs downgraded from submitted due to thin output
  tool_failure_rate: number | null;
}

interface DirectiveSummaryRow {
  directive_id: string;
  title: string;
  priority: string;
  total_assignments: number;
  completed: number;
  avg_quality: number | null;
}

export async function getAgentOpsMetrics(windowDays: 7 | 30 | 90): Promise<{
  windowDays: number;
  generatedAt: string;
  agentRows: AgentOpsRow[];
  fleetEvidenceSummary: EvidenceTierBreakdown & { total: number };
  downgradedTotal: number;
  topDirectives: DirectiveSummaryRow[];
  claimFabrication: {
    fleetTotal: number;
    byAgent: Array<{ agent_role: string; event_count: number; total_claims: number }>;
  };
}> {
  const interval = `${windowDays} days`;

  // Per-agent run counts, quality, evidence tier breakdown
  const agentRunRows = await systemQuery<{
    agent_role: string;
    run_count: string;
    avg_quality: string | null;
    proven: string;
    partially_proven: string;
    self_reported: string;
    inconsistent: string;
    unclassified: string;
    downgraded_count: string;
    tool_failure_rate: string | null;
  }>(
    `SELECT
       tro.agent_role,
       COUNT(*)                                                                  AS run_count,
       ROUND(AVG(tro.per_run_quality_score)::numeric, 2)                        AS avg_quality,
       COUNT(*) FILTER (WHERE tro.evidence_tier = 'proven')                     AS proven,
       COUNT(*) FILTER (WHERE tro.evidence_tier = 'partially_proven')           AS partially_proven,
       COUNT(*) FILTER (WHERE tro.evidence_tier = 'self_reported')              AS self_reported,
       COUNT(*) FILTER (WHERE tro.evidence_tier = 'inconsistent')               AS inconsistent,
       COUNT(*) FILTER (WHERE tro.evidence_tier IS NULL)                        AS unclassified,
       COUNT(*) FILTER (
         WHERE tro.proof_of_work->>'downgrade_reason' = 'output_too_short'
       )                                                                         AS downgraded_count,
       ROUND(
         (COUNT(*) FILTER (WHERE tro.tool_failure_count > 0))::numeric /
         NULLIF(COUNT(*), 0) * 100,
         1
       )                                                                         AS tool_failure_rate
     FROM task_run_outcomes tro
    WHERE tro.created_at > NOW() - $1::interval
    GROUP BY tro.agent_role
    ORDER BY run_count DESC`,
    [interval],
  );

  const agentRows: AgentOpsRow[] = (agentRunRows ?? []).map(r => ({
    agent_role: r.agent_role,
    run_count: parseInt(r.run_count, 10),
    avg_quality: r.avg_quality !== null ? parseFloat(r.avg_quality) : null,
    evidence_tiers: {
      proven:           parseInt(r.proven, 10),
      partially_proven: parseInt(r.partially_proven, 10),
      self_reported:    parseInt(r.self_reported, 10),
      inconsistent:     parseInt(r.inconsistent, 10),
      unclassified:     parseInt(r.unclassified, 10),
    },
    downgraded_count: parseInt(r.downgraded_count, 10),
    tool_failure_rate: r.tool_failure_rate !== null ? parseFloat(r.tool_failure_rate) : null,
  }));

  // Fleet-wide evidence tier summary
  const fleetTotals = agentRows.reduce(
    (acc, r) => {
      acc.proven           += r.evidence_tiers.proven;
      acc.partially_proven += r.evidence_tiers.partially_proven;
      acc.self_reported    += r.evidence_tiers.self_reported;
      acc.inconsistent     += r.evidence_tiers.inconsistent;
      acc.unclassified     += r.evidence_tiers.unclassified;
      acc.total            += r.run_count;
      return acc;
    },
    { proven: 0, partially_proven: 0, self_reported: 0, inconsistent: 0, unclassified: 0, total: 0 },
  );

  const downgradedTotal = agentRows.reduce((sum, r) => sum + r.downgraded_count, 0);

  // Top active directives by completion quality (up to 20)
  const directiveRows = await systemQuery<{
    directive_id: string;
    title: string;
    priority: string;
    total_assignments: string;
    completed: string;
    avg_quality: string | null;
  }>(
    `SELECT
       fd.id                                                              AS directive_id,
       fd.title,
       fd.priority,
       COUNT(wa.id)                                                       AS total_assignments,
       COUNT(*) FILTER (WHERE wa.status = 'completed')                   AS completed,
       ROUND(AVG(tro.per_run_quality_score)::numeric, 2)                 AS avg_quality
     FROM founder_directives fd
     JOIN work_assignments wa ON wa.directive_id = fd.id
     LEFT JOIN task_run_outcomes tro ON tro.assignment_id = wa.id
    WHERE fd.status = 'active'
      AND wa.created_at > NOW() - $1::interval
    GROUP BY fd.id, fd.title, fd.priority
    ORDER BY fd.priority, completed DESC
    LIMIT 20`,
    [interval],
  );

  const topDirectives: DirectiveSummaryRow[] = (directiveRows ?? []).map(r => ({
    directive_id:      r.directive_id,
    title:             r.title,
    priority:          r.priority,
    total_assignments: parseInt(r.total_assignments, 10),
    completed:         parseInt(r.completed, 10),
    avg_quality:       r.avg_quality !== null ? parseFloat(r.avg_quality) : null,
  }));

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    agentRows,
    fleetEvidenceSummary: fleetTotals,
    downgradedTotal,
    topDirectives,
    claimFabrication: await (async () => {
      const rows = await systemQuery<{
        agent_role: string;
        event_count: string;
        total_claims: string;
      }>(
        `SELECT
           payload->>'role'                       AS agent_role,
           COUNT(*)                               AS event_count,
           COALESCE(SUM((payload->>'claim_count')::int), 0) AS total_claims
         FROM agent_run_events
         WHERE event_type = 'unsubstantiated_claims_detected'
           AND created_at > NOW() - $1::interval
         GROUP BY payload->>'role'
         ORDER BY event_count DESC`,
        [interval],
      );
      const byAgent = (rows ?? []).map(r => ({
        agent_role:   r.agent_role,
        event_count:  parseInt(r.event_count, 10),
        total_claims: parseInt(r.total_claims, 10),
      }));
      return {
        fleetTotal: byAgent.reduce((s, r) => s + r.event_count, 0),
        byAgent,
      };
    })(),
  };
}

export async function handleMetricsAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  queryString: string,
  method: string,
): Promise<boolean> {
  const normalizedUrl = url.startsWith('/api/admin/metrics')
    ? url.replace('/api/admin/metrics', '/admin/metrics')
    : url;
  if (!normalizedUrl.startsWith('/admin/metrics')) return false;

  if (method === 'POST' && normalizedUrl === '/admin/metrics/planning-gate-eval-suggestions/apply') {
    if (!isPlanningGateEvalApplyEnabled()) {
      json(res, 403, {
        error: 'Planning gate eval apply is disabled (PLANNING_GATE_EVAL_APPLY_ENABLED=false). Unset that variable or set it to true to allow POST apply.',
      });
      return true;
    }
    try {
      const raw = await readBody(req);
      const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
      const windowRaw = body.window ?? body.windowDays ?? body.window_days;
      const windowDays = parseWindow(
        windowRaw === null || windowRaw === undefined ? null : String(windowRaw),
      );
      const limit = typeof body.limit === 'number' && Number.isFinite(body.limit)
        ? Math.min(30, Math.max(1, Math.trunc(body.limit)))
        : 12;
      const dryRun = body.dryRun === true || body.dry_run === true;
      const result = await applyPlanningGateEvalScenariosFromTelemetry({ windowDays, limit, dryRun });
      json(res, 200, { ok: true, ...result });
      return true;
    } catch (err) {
      json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  if (method !== 'GET') return false;

  const params = new URLSearchParams(queryString);

  try {
    if (normalizedUrl === '/admin/metrics/agents') {
      const windowDays = parseWindow(params.get('window'));
      const agents = await listAgentMetrics(windowDays);
      json(res, 200, { windowDays, agents });
      return true;
    }

    const agentMatch = normalizedUrl.match(/^\/admin\/metrics\/agents\/([^/]+)$/);
    if (agentMatch) {
      const agentId = decodeURIComponent(agentMatch[1]);
      const [metrics, reversal7, reversal30, reversal90] = await Promise.all([
        getAgentMetricsWindows(agentId),
        getReversalStats(agentId, 7),
        getReversalStats(agentId, 30),
        getReversalStats(agentId, 90),
      ]);
      json(res, 200, {
        ...metrics,
        reversalStats: {
          7: reversal7,
          30: reversal30,
          90: reversal90,
        },
      });
      return true;
    }

    if (normalizedUrl === '/admin/metrics/fleet') {
      const windowDays = parseWindow(params.get('window'));
      json(res, 200, await computeFleetMetrics(windowDays));
      return true;
    }

    if (normalizedUrl === '/admin/metrics/exceptions') {
      const filters: ExceptionLogFilters = {
        agentId: params.get('agentId') ?? undefined,
        startDate: params.get('startDate') ?? undefined,
        endDate: params.get('endDate') ?? undefined,
        resolutionStatus: (params.get('resolutionStatus') as ExceptionLogFilters['resolutionStatus']) ?? 'all',
        page: parsePositiveInteger(params.get('page'), 1, 100000),
        pageSize: parsePositiveInteger(params.get('pageSize'), 50, 200),
      };
      json(res, 200, await getExceptionLog(filters));
      return true;
    }

    if (normalizedUrl === '/admin/metrics/reversals') {
      const filters: ReversalLogFilters = {
        agentId: params.get('agentId') ?? undefined,
        windowDays: params.get('window') ? Number(params.get('window')) : undefined,
        page: parsePositiveInteger(params.get('page'), 1, 100000),
        pageSize: parsePositiveInteger(params.get('pageSize'), 50, 200),
      };
      json(res, 200, await listActionReversals(filters));
      return true;
    }

    if (normalizedUrl === '/admin/metrics/benchmark-report') {
      json(res, 200, await getBenchmarkReport(parseWindow(params.get('window'), 90)));
      return true;
    }

    if (normalizedUrl === '/admin/metrics/planning-gate') {
      const windowDays = parseWindow(params.get('window'));
      json(res, 200, await getPlanningGateMetrics(windowDays));
      return true;
    }

    if (normalizedUrl === '/admin/metrics/planning-gate-health') {
      const report = await evaluatePlanningGateHealth();
      const status = report.alerts.length > 0
        ? 'red'
        : report.roleAnomalies.length > 0
          ? 'yellow'
          : report.runsWithPlanning < report.minPlannedRuns
            ? 'yellow'
            : 'green';
      json(res, 200, {
        status,
        evaluatedAt: new Date().toISOString(),
        report,
      });
      return true;
    }

    if (normalizedUrl === '/admin/metrics/planning-gate-stage3') {
      const windowDays = parseWindow(params.get('window'));
      json(res, 200, await getPlanningGateStage3Metrics(windowDays));
      return true;
    }

    if (normalizedUrl === '/admin/metrics/planning-gate-eval-suggestions') {
      const windowDays = parseWindow(params.get('window'));
      const limit = parsePositiveInteger(params.get('limit'), 12, 30);
      json(res, 200, await getPlanningGateEvalSuggestions(windowDays, limit));
      return true;
    }

    if (normalizedUrl === '/admin/metrics/quality-overview') {
      const windowDays = parseWindow(params.get('window'));
      const [planningGate, goldenEvalByRole] = await Promise.all([
        getPlanningGateMetrics(windowDays),
        listGoldenEvalPassRatesByRole(windowDays).catch(() => []),
      ]);
      json(res, 200, {
        windowDays,
        planningGate,
        goldenEvalByRole,
        generatedAt: new Date().toISOString(),
      });
      return true;
    }

    if (normalizedUrl === '/admin/metrics/planning-strictness-sim') {
      const windowDays = parseWindow(params.get('window'));
      const minRaw = Number(params.get('passRateMin') ?? params.get('pass_rate_min') ?? '0.85');
      const passRateMin = Number.isFinite(minRaw) ? Math.min(1, Math.max(0, minRaw)) : 0.85;
      const planningGate = await getPlanningGateMetrics(windowDays);
      const rolesFailing = planningGate.roles
        .map((role) => {
          const denominator = role.runsWithPlanning > 0 ? role.runsWithPlanning : role.runsObserved;
          return { role: role.role, passRate: role.passRate, denominator };
        })
        .filter((row) => row.denominator > 0 && row.passRate < passRateMin);
      const rolesEvaluated = planningGate.roles.filter((role) => {
        const denominator = role.runsWithPlanning > 0 ? role.runsWithPlanning : role.runsObserved;
        return denominator > 0;
      });
      json(res, 200, {
        windowDays,
        passRateMin,
        fleetPassRate: planningGate.totals.passRate,
        rolesEvaluated: rolesEvaluated.length,
        rolesFailingCount: rolesFailing.length,
        rolesFailing,
        generatedAt: new Date().toISOString(),
      });
      return true;
    }

    if (normalizedUrl === '/admin/metrics/economics-quality-overview') {
      const windowDays = parseWindow(params.get('window'));
      json(res, 200, await getEconomicsQualityOverview(windowDays));
      return true;
    }

    // ── Agent Ops: claim-vs-evidence, run frequency, quality distribution ──
    if (normalizedUrl === '/admin/metrics/agent-ops') {
      const windowDays = parseWindow(params.get('window'), 7);
      json(res, 200, await getAgentOpsMetrics(windowDays));
      return true;
    }

    return false;
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}

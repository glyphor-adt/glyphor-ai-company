import { systemQuery } from '@glyphor/shared/db';

type PlanningGateEventRow = {
  run_id: string;
  event_type: 'planning_phase_started' | 'completion_gate_failed' | 'completion_gate_passed';
  payload: Record<string, unknown> | string | null;
  created_at: string;
  agent_role: string | null;
};

type PlanningGateRoleSummary = {
  role: string;
  runsObserved: number;
  runsWithPlanning: number;
  runsWithGatePass: number;
  runsWithGateFail: number;
  gateFailEvents: number;
  maxRetryAttempt: number;
  passRate: number;
};

export type PlanningGateMonitorAlertType =
  | 'pass_rate_below_threshold'
  | 'retry_spike_detected';

export interface PlanningGateMonitorAlert {
  type: PlanningGateMonitorAlertType;
  message: string;
  threshold: number;
  observed: number;
}

export type PlanningGateRoleAnomalyKind = 'below_slo_7d' | 'regression_7d_vs_30d';

/** Stage 2: per-role signals (7d vs 30d). Not escalated to incidents unless promoted to critical alerts later. */
export interface PlanningGateRoleAnomaly {
  kind: PlanningGateRoleAnomalyKind;
  role: string;
  message: string;
  passRate7d: number;
  passRate30d: number | null;
  runsWithPlanning7d: number;
  /** Positive when 7d is worse than 30d (30d pass − 7d pass), as a fraction (e.g. 0.15 = 15pp). */
  dropPp: number | null;
}

export interface PlanningGateMonitorReport {
  windowDays: number;
  minPlannedRuns: number;
  minRolePlannedRuns: number;
  anomalyDropPp: number;
  passRateThreshold: number;
  retrySpikeThreshold: number;
  runsWithPlanning: number;
  gatePassRate: number;
  maxRetryAttempt: number;
  alerts: PlanningGateMonitorAlert[];
  /** Roles with 7d pass below SLO or sharp drop vs 30d baseline (min sample on each side). */
  roleAnomalies: PlanningGateRoleAnomaly[];
  topRoleRegressions: Array<{
    role: string;
    passRate: number;
    runsWithPlanning: number;
    maxRetryAttempt: number;
  }>;
}

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

function parseThreshold(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

async function getPlanningGateRoleSummary(windowDays: number): Promise<PlanningGateRoleSummary[]> {
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

  const byRun = new Map<string, {
    role: string;
    runsWithPlanning: number;
    runsWithGatePass: number;
    runsWithGateFail: number;
    gateFailEvents: number;
    maxRetryAttempt: number;
  }>();

  for (const row of rows) {
    const role = row.agent_role ?? 'unknown';
    const current = byRun.get(row.run_id) ?? {
      role,
      runsWithPlanning: 0,
      runsWithGatePass: 0,
      runsWithGateFail: 0,
      gateFailEvents: 0,
      maxRetryAttempt: 0,
    };
    if (current.role === 'unknown') current.role = role;

    const payload = asObject(row.payload);
    if (row.event_type === 'planning_phase_started') {
      current.runsWithPlanning = 1;
    } else if (row.event_type === 'completion_gate_passed') {
      current.runsWithGatePass = 1;
    } else if (row.event_type === 'completion_gate_failed') {
      current.runsWithGateFail = 1;
      current.gateFailEvents += 1;
      const retryAttempt = Number(payload.retry_attempt ?? 0);
      if (Number.isFinite(retryAttempt)) {
        current.maxRetryAttempt = Math.max(current.maxRetryAttempt, retryAttempt);
      }
    }
    byRun.set(row.run_id, current);
  }

  const byRole = new Map<string, PlanningGateRoleSummary>();
  for (const run of byRun.values()) {
    const existing = byRole.get(run.role) ?? {
      role: run.role,
      runsObserved: 0,
      runsWithPlanning: 0,
      runsWithGatePass: 0,
      runsWithGateFail: 0,
      gateFailEvents: 0,
      maxRetryAttempt: 0,
      passRate: 0,
    };
    existing.runsObserved += 1;
    existing.runsWithPlanning += run.runsWithPlanning;
    existing.runsWithGatePass += run.runsWithGatePass;
    existing.runsWithGateFail += run.runsWithGateFail;
    existing.gateFailEvents += run.gateFailEvents;
    existing.maxRetryAttempt = Math.max(existing.maxRetryAttempt, run.maxRetryAttempt);
    byRole.set(run.role, existing);
  }

  return Array.from(byRole.values())
    .map((role) => {
      const denominator = role.runsWithPlanning > 0 ? role.runsWithPlanning : role.runsObserved;
      return {
        ...role,
        passRate: denominator > 0 ? Number((role.runsWithGatePass / denominator).toFixed(4)) : 0,
      };
    })
    .sort((a, b) => b.runsWithPlanning - a.runsWithPlanning || a.role.localeCompare(b.role));
}

function buildRoleAnomalies(params: {
  roles7d: PlanningGateRoleSummary[];
  roles30d: PlanningGateRoleSummary[];
  passRateThreshold: number;
  minRolePlannedRuns: number;
  anomalyDropPp: number;
}): PlanningGateRoleAnomaly[] {
  const { roles7d, roles30d, passRateThreshold, minRolePlannedRuns, anomalyDropPp } = params;
  const by30 = new Map(roles30d.map((role) => [role.role, role]));
  const out: PlanningGateRoleAnomaly[] = [];

  for (const week of roles7d) {
    if (week.runsWithPlanning < minRolePlannedRuns) continue;

    if (week.passRate < passRateThreshold) {
      out.push({
        kind: 'below_slo_7d',
        role: week.role,
        message: `Role ${week.role}: 7d gate pass ${Math.round(week.passRate * 100)}% is below SLO ${Math.round(passRateThreshold * 100)}% (${week.runsWithPlanning} planned runs).`,
        passRate7d: week.passRate,
        passRate30d: null,
        runsWithPlanning7d: week.runsWithPlanning,
        dropPp: null,
      });
    }

    const month = by30.get(week.role);
    if (
      month
      && month.runsWithPlanning >= minRolePlannedRuns
      && (month.passRate - week.passRate) >= anomalyDropPp
    ) {
      const drop = Number((month.passRate - week.passRate).toFixed(4));
      out.push({
        kind: 'regression_7d_vs_30d',
        role: week.role,
        message: `Role ${week.role}: 7d pass ${Math.round(week.passRate * 100)}% is ${Math.round(drop * 100)}pp below 30d baseline ${Math.round(month.passRate * 100)}%.`,
        passRate7d: week.passRate,
        passRate30d: month.passRate,
        runsWithPlanning7d: week.runsWithPlanning,
        dropPp: drop,
      });
    }
  }

  return out.sort((a, b) => (b.dropPp ?? 0) - (a.dropPp ?? 0) || a.role.localeCompare(b.role));
}

export async function evaluatePlanningGateHealth(): Promise<PlanningGateMonitorReport> {
  const windowDays = parseThreshold('PLANNING_GATE_ALERT_WINDOW_DAYS', 30, 1, 90);
  const minPlannedRuns = parseThreshold('PLANNING_GATE_ALERT_MIN_PLANNED_RUNS', 10, 1, 1000);
  const minRolePlannedRuns = parseThreshold('PLANNING_GATE_ALERT_MIN_ROLE_PLANNED_RUNS', 5, 1, 500);
  const anomalyDropPp = parseThreshold('PLANNING_GATE_ALERT_ANOMALY_DROP_PP', 0.15, 0.05, 0.9);
  const passRateThreshold = parseThreshold('PLANNING_GATE_ALERT_PASS_RATE_MIN', 0.7, 0, 1);
  const retrySpikeThreshold = parseThreshold('PLANNING_GATE_ALERT_MAX_RETRY_THRESHOLD', 2, 1, 20);

  const [roles, roles7d, roles30d] = await Promise.all([
    getPlanningGateRoleSummary(windowDays),
    getPlanningGateRoleSummary(7),
    getPlanningGateRoleSummary(30),
  ]);

  const totals = roles.reduce((acc, role) => {
    acc.runsWithPlanning += role.runsWithPlanning;
    acc.runsWithGatePass += role.runsWithGatePass;
    acc.maxRetryAttempt = Math.max(acc.maxRetryAttempt, role.maxRetryAttempt);
    return acc;
  }, { runsWithPlanning: 0, runsWithGatePass: 0, maxRetryAttempt: 0 });

  const passRate = totals.runsWithPlanning > 0
    ? Number((totals.runsWithGatePass / totals.runsWithPlanning).toFixed(4))
    : 0;

  const alerts: PlanningGateMonitorAlert[] = [];
  if (totals.runsWithPlanning >= minPlannedRuns && passRate < passRateThreshold) {
    alerts.push({
      type: 'pass_rate_below_threshold',
      message: `Completion-gate pass rate ${Math.round(passRate * 100)}% is below threshold ${Math.round(passRateThreshold * 100)}% over ${windowDays}d.`,
      threshold: passRateThreshold,
      observed: passRate,
    });
  }
  if (totals.maxRetryAttempt > retrySpikeThreshold) {
    alerts.push({
      type: 'retry_spike_detected',
      message: `Completion-gate retry spike detected: max retry attempt ${totals.maxRetryAttempt} exceeds threshold ${retrySpikeThreshold}.`,
      threshold: retrySpikeThreshold,
      observed: totals.maxRetryAttempt,
    });
  }

  const roleAnomalies = buildRoleAnomalies({
    roles7d,
    roles30d,
    passRateThreshold,
    minRolePlannedRuns,
    anomalyDropPp,
  });

  return {
    windowDays,
    minPlannedRuns,
    minRolePlannedRuns,
    anomalyDropPp,
    passRateThreshold,
    retrySpikeThreshold,
    runsWithPlanning: totals.runsWithPlanning,
    gatePassRate: passRate,
    maxRetryAttempt: totals.maxRetryAttempt,
    alerts,
    roleAnomalies,
    topRoleRegressions: roles
      .filter((role) => role.runsWithPlanning > 0)
      .sort((a, b) => a.passRate - b.passRate || b.maxRetryAttempt - a.maxRetryAttempt)
      .slice(0, 5)
      .map((role) => ({
        role: role.role,
        passRate: role.passRate,
        runsWithPlanning: role.runsWithPlanning,
        maxRetryAttempt: role.maxRetryAttempt,
      })),
  };
}

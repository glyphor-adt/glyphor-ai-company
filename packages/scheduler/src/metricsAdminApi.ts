import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  computeFleetMetrics,
  getAgentMetricsWindows,
  getBenchmarkReport,
  getExceptionLog,
  getReversalStats,
  listActionReversals,
  listAgentMetrics,
  type ExceptionLogFilters,
  type ReversalLogFilters,
} from '@glyphor/shared';
import { systemQuery } from '@glyphor/shared/db';

function json(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
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

export async function handleMetricsAdminApi(
  _req: IncomingMessage,
  res: ServerResponse,
  url: string,
  queryString: string,
  method: string,
): Promise<boolean> {
  if (method !== 'GET') return false;
  if (!url.startsWith('/admin/metrics')) return false;

  const params = new URLSearchParams(queryString);

  try {
    if (url === '/admin/metrics/agents') {
      const windowDays = parseWindow(params.get('window'));
      const agents = await listAgentMetrics(windowDays);
      json(res, 200, { windowDays, agents });
      return true;
    }

    const agentMatch = url.match(/^\/admin\/metrics\/agents\/([^/]+)$/);
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

    if (url === '/admin/metrics/fleet') {
      const windowDays = parseWindow(params.get('window'));
      json(res, 200, await computeFleetMetrics(windowDays));
      return true;
    }

    if (url === '/admin/metrics/exceptions') {
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

    if (url === '/admin/metrics/reversals') {
      const filters: ReversalLogFilters = {
        agentId: params.get('agentId') ?? undefined,
        windowDays: params.get('window') ? Number(params.get('window')) : undefined,
        page: parsePositiveInteger(params.get('page'), 1, 100000),
        pageSize: parsePositiveInteger(params.get('pageSize'), 50, 200),
      };
      json(res, 200, await listActionReversals(filters));
      return true;
    }

    if (url === '/admin/metrics/benchmark-report') {
      json(res, 200, await getBenchmarkReport(parseWindow(params.get('window'), 90)));
      return true;
    }

    if (url === '/admin/metrics/planning-gate') {
      const windowDays = parseWindow(params.get('window'));
      json(res, 200, await getPlanningGateMetrics(windowDays));
      return true;
    }

    return false;
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}
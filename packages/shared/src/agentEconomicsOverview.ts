import { systemQuery } from './db.js';

export type EconomicsWindowDays = 7 | 30 | 90;

export interface AgentEconomicsRollupRow {
  agentId: string;
  runsTerminal: number;
  runsCompleted: number;
  /** Completed / terminal runs in window (agent_runs–based). */
  runCompletionRate: number;
  avgCostUsdPerCompleted: number | null;
  sumCostUsdRecorded: number;
  p50LatencyMinutes: number | null;
  p95LatencyMinutes: number | null;
}

export interface FleetEconomicsSummary {
  runsTerminal: number;
  runsCompleted: number;
  runCompletionRate: number;
  avgCostUsdPerCompleted: number | null;
  sumCostUsdRecorded: number;
  p50LatencyMinutes: number | null;
  p95LatencyMinutes: number | null;
}

export interface AgentEconomicsOverview {
  windowDays: EconomicsWindowDays;
  generatedAt: string;
  fleet: FleetEconomicsSummary;
  roles: AgentEconomicsRollupRow[];
}

interface CostCountRow {
  agent_id: string;
  terminal_runs: number;
  completed_runs: number;
  avg_cost_usd_completed: number | string | null;
  sum_cost_usd: number | string | null;
}

interface LatencyRow {
  agent_id: string;
  p50_latency_ms: number | string | null;
  p95_latency_ms: number | string | null;
}

interface FleetLatencyRow {
  p50_latency_ms: number | string | null;
  p95_latency_ms: number | string | null;
}

function asNumber(value: number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asNullableNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function msToMinutes(ms: number | null): number | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  return round(ms / 60_000, 2);
}

/**
 * Per-role cost and latency from `agent_runs` (instrumented USD + duration), plus fleet percentiles.
 */
export async function getAgentEconomicsOverview(windowDays: EconomicsWindowDays): Promise<AgentEconomicsOverview> {
  const [costRows, latencyRows, fleetLat] = await Promise.all([
    systemQuery<CostCountRow>(
      `SELECT
         ar.agent_id,
         COUNT(*) FILTER (
           WHERE ar.status IN ('completed', 'failed', 'aborted', 'skipped_precheck')
         )::int AS terminal_runs,
         COUNT(*) FILTER (WHERE ar.status = 'completed')::int AS completed_runs,
         AVG(COALESCE(ar.total_cost_usd::float, ar.cost::float)) FILTER (
           WHERE ar.status = 'completed'
             AND (ar.total_cost_usd IS NOT NULL OR ar.cost IS NOT NULL)
         ) AS avg_cost_usd_completed,
         COALESCE(SUM(COALESCE(ar.total_cost_usd::float, ar.cost::float)) FILTER (
           WHERE ar.total_cost_usd IS NOT NULL OR ar.cost IS NOT NULL
         ), 0)::float AS sum_cost_usd
       FROM agent_runs ar
       WHERE ar.started_at >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY ar.agent_id`,
      [windowDays],
    ),
    systemQuery<LatencyRow>(
      `SELECT agent_id,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lat_ms)::float AS p50_latency_ms,
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY lat_ms)::float AS p95_latency_ms
       FROM (
         SELECT ar.agent_id,
           COALESCE(
             ar.duration_ms::float,
             EXTRACT(EPOCH FROM (ar.completed_at - ar.started_at)) * 1000.0
           ) AS lat_ms
         FROM agent_runs ar
         WHERE ar.started_at >= NOW() - ($1::int * INTERVAL '1 day')
           AND ar.status = 'completed'
           AND (
             ar.duration_ms IS NOT NULL
             OR (ar.completed_at IS NOT NULL AND ar.started_at IS NOT NULL)
           )
       ) AS lat
       WHERE lat_ms > 0
       GROUP BY agent_id`,
      [windowDays],
    ),
    systemQuery<FleetLatencyRow>(
      `SELECT
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lat_ms)::float AS p50_latency_ms,
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY lat_ms)::float AS p95_latency_ms
       FROM (
         SELECT COALESCE(
           ar.duration_ms::float,
           EXTRACT(EPOCH FROM (ar.completed_at - ar.started_at)) * 1000.0
         ) AS lat_ms
         FROM agent_runs ar
         WHERE ar.started_at >= NOW() - ($1::int * INTERVAL '1 day')
           AND ar.status = 'completed'
           AND (
             ar.duration_ms IS NOT NULL
             OR (ar.completed_at IS NOT NULL AND ar.started_at IS NOT NULL)
           )
       ) AS lat
       WHERE lat_ms > 0`,
      [windowDays],
    ),
  ]);

  const latByAgent = new Map(
    latencyRows.map((row) => [
      row.agent_id,
      {
        p50: asNullableNumber(row.p50_latency_ms),
        p95: asNullableNumber(row.p95_latency_ms),
      },
    ]),
  );

  const roles: AgentEconomicsRollupRow[] = costRows
    .map((row) => {
      const terminal = row.terminal_runs ?? 0;
      const completed = row.completed_runs ?? 0;
      const lat = latByAgent.get(row.agent_id);
      const avgCostRaw = asNullableNumber(row.avg_cost_usd_completed);
      return {
        agentId: row.agent_id,
        runsTerminal: terminal,
        runsCompleted: completed,
        runCompletionRate: terminal > 0 ? round(completed / terminal, 4) : 0,
        avgCostUsdPerCompleted: completed > 0 && avgCostRaw != null ? round(avgCostRaw, 6) : null,
        sumCostUsdRecorded: round(asNumber(row.sum_cost_usd), 6),
        p50LatencyMinutes: msToMinutes(lat?.p50 ?? null),
        p95LatencyMinutes: msToMinutes(lat?.p95 ?? null),
      };
    })
    .filter((row) => row.runsTerminal > 0)
    .sort((a, b) => a.agentId.localeCompare(b.agentId));

  const fleetTerminal = roles.reduce((s, r) => s + r.runsTerminal, 0);
  const fleetCompleted = roles.reduce((s, r) => s + r.runsCompleted, 0);
  const fleetSumCost = roles.reduce((s, r) => s + r.sumCostUsdRecorded, 0);

  const weightedCostNumerator = roles.reduce((s, r) => {
    if (r.runsCompleted <= 0 || r.avgCostUsdPerCompleted == null) return s;
    return s + r.avgCostUsdPerCompleted * r.runsCompleted;
  }, 0);
  const fleetAvgCost = fleetCompleted > 0 && weightedCostNumerator > 0
    ? round(weightedCostNumerator / fleetCompleted, 6)
    : null;

  const fl = fleetLat[0];
  const fleet: FleetEconomicsSummary = {
    runsTerminal: fleetTerminal,
    runsCompleted: fleetCompleted,
    runCompletionRate: fleetTerminal > 0 ? round(fleetCompleted / fleetTerminal, 4) : 0,
    avgCostUsdPerCompleted: fleetAvgCost,
    sumCostUsdRecorded: round(fleetSumCost, 6),
    p50LatencyMinutes: msToMinutes(asNullableNumber(fl?.p50_latency_ms)),
    p95LatencyMinutes: msToMinutes(asNullableNumber(fl?.p95_latency_ms)),
  };

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    fleet,
    roles,
  };
}

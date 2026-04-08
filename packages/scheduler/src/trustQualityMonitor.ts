/**
 * Trust Quality Monitor
 *
 * Runs daily to detect degradation in agent evidence quality:
 *   - High self-reported rate (agents completing with no tool evidence)
 *   - High downgrade rate (completions reduced to partial_progress at harvest)
 *   - Claim fabrication spikes (unsubstantiated_claims_detected events)
 *
 * Mirrors the planningGateMonitor.ts pattern: query → evaluate → alerts array.
 * Called via POST /trust/monitor from cronManager scheduler job.
 *
 * Env var thresholds:
 *   TRUST_ALERT_WINDOW_DAYS              (default 7, range 1–90)
 *   TRUST_ALERT_MIN_RUNS                 (default 5, range 1–1000)
 *   TRUST_ALERT_SELF_REPORTED_MAX        (default 0.60, range 0–1)
 *   TRUST_ALERT_DOWNGRADE_MAX            (default 0.30, range 0–1)
 *   TRUST_ALERT_CLAIM_FABRICATION_MAX    (default 5, range 0–1000)
 */

import { systemQuery } from '@glyphor/shared/db';

export type TrustAlertType =
  | 'high_self_reported_rate'
  | 'high_downgrade_rate'
  | 'claim_fabrication_spike';

export interface TrustAlert {
  type: TrustAlertType;
  message: string;
  threshold: number;
  observed: number;
  affectedAgents?: string[];
}

export interface TrustQualityReport {
  windowDays: number;
  totalRuns: number;
  selfReportedRate: number;
  downgradeRate: number;
  claimFabricationEvents: number;
  alerts: TrustAlert[];
  agentBreakdown: Array<{
    role: string;
    run_count: number;
    self_reported: number;
    downgraded: number;
    claim_events: number;
  }>;
}

function parseThreshold(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

export async function evaluateTrustQuality(): Promise<TrustQualityReport> {
  const windowDays   = parseThreshold('TRUST_ALERT_WINDOW_DAYS',           7,    1,    90);
  const minRuns      = parseThreshold('TRUST_ALERT_MIN_RUNS',               5,    1,  1000);
  const selfRepMax   = parseThreshold('TRUST_ALERT_SELF_REPORTED_MAX',      0.60, 0,     1);
  const downgradeMax = parseThreshold('TRUST_ALERT_DOWNGRADE_MAX',          0.30, 0,     1);
  const claimFabMax  = parseThreshold('TRUST_ALERT_CLAIM_FABRICATION_MAX',  5,    0,  1000);
  const interval     = `${windowDays} days`;

  // ── Fleet-level evidence tier summary ────────────────────────────────────
  const [fleetRow] = await systemQuery<{
    total_runs: string;
    self_reported: string;
    downgraded: string;
  }>(
    `SELECT
       COUNT(*)                                                        AS total_runs,
       COUNT(*) FILTER (WHERE evidence_tier = 'self_reported')        AS self_reported,
       COUNT(*) FILTER (WHERE final_status = 'partial_progress')      AS downgraded
     FROM task_run_outcomes
     WHERE created_at > NOW() - $1::interval`,
    [interval],
  );

  const totalRuns      = parseInt(fleetRow?.total_runs  ?? '0', 10);
  const selfReported   = parseInt(fleetRow?.self_reported ?? '0', 10);
  const downgraded     = parseInt(fleetRow?.downgraded   ?? '0', 10);
  const selfReportedRate = totalRuns > 0 ? selfReported / totalRuns : 0;
  const downgradeRate    = totalRuns > 0 ? downgraded   / totalRuns : 0;

  // ── Claim fabrication events from agent_run_events ──────────────────────
  const [claimRow] = await systemQuery<{ event_count: string }>(
    `SELECT COUNT(*) AS event_count
     FROM agent_run_events
     WHERE event_type = 'unsubstantiated_claims_detected'
       AND created_at > NOW() - $1::interval`,
    [interval],
  );
  const claimFabricationEvents = parseInt(claimRow?.event_count ?? '0', 10);

  // ── Per-agent breakdown ──────────────────────────────────────────────────
  const agentRows = await systemQuery<{
    agent_role: string;
    run_count: string;
    self_reported: string;
    downgraded: string;
  }>(
    `SELECT
       agent_role,
       COUNT(*)                                                        AS run_count,
       COUNT(*) FILTER (WHERE evidence_tier = 'self_reported')        AS self_reported,
       COUNT(*) FILTER (WHERE final_status = 'partial_progress')      AS downgraded
     FROM task_run_outcomes
     WHERE created_at > NOW() - $1::interval
     GROUP BY agent_role
     ORDER BY self_reported DESC, run_count DESC`,
    [interval],
  );

  const claimByAgent = await systemQuery<{ agent_role: string; event_count: string }>(
    `SELECT
       payload->>'role' AS agent_role,
       COUNT(*)         AS event_count
     FROM agent_run_events
     WHERE event_type = 'unsubstantiated_claims_detected'
       AND created_at > NOW() - $1::interval
     GROUP BY payload->>'role'`,
    [interval],
  );
  const claimMap = new Map((claimByAgent ?? []).map(r => [r.agent_role, parseInt(r.event_count, 10)]));

  const agentBreakdown = (agentRows ?? []).map(r => ({
    role:          r.agent_role,
    run_count:     parseInt(r.run_count, 10),
    self_reported: parseInt(r.self_reported, 10),
    downgraded:    parseInt(r.downgraded, 10),
    claim_events:  claimMap.get(r.agent_role) ?? 0,
  }));

  // ── Alert evaluation ─────────────────────────────────────────────────────
  const alerts: TrustAlert[] = [];

  if (totalRuns >= minRuns && selfReportedRate > selfRepMax) {
    const worstAgents = agentBreakdown
      .filter(a => a.run_count >= 3 && a.self_reported / a.run_count > selfRepMax)
      .map(a => a.role);
    alerts.push({
      type: 'high_self_reported_rate',
      message:
        `Fleet self-reported rate ${Math.round(selfReportedRate * 100)}% exceeds threshold ` +
        `${Math.round(selfRepMax * 100)}% over last ${windowDays}d ` +
        `(${selfReported}/${totalRuns} runs lack tool evidence).` +
        (worstAgents.length > 0 ? ` Worst agents: ${worstAgents.join(', ')}.` : ''),
      threshold: selfRepMax,
      observed: selfReportedRate,
      affectedAgents: worstAgents,
    });
  }

  if (totalRuns >= minRuns && downgradeRate > downgradeMax) {
    alerts.push({
      type: 'high_downgrade_rate',
      message:
        `Downgrade rate ${Math.round(downgradeRate * 100)}% exceeds threshold ` +
        `${Math.round(downgradeMax * 100)}% over last ${windowDays}d ` +
        `(${downgraded} completions reduced to partial_progress at harvest).`,
      threshold: downgradeMax,
      observed: downgradeRate,
    });
  }

  if (claimFabricationEvents > claimFabMax) {
    const fabricators = [...claimMap.entries()]
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([role]) => role);
    alerts.push({
      type: 'claim_fabrication_spike',
      message:
        `${claimFabricationEvents} unsubstantiated claim events in last ${windowDays}d ` +
        `(threshold: ${claimFabMax}).` +
        (fabricators.length > 0 ? ` Agents: ${fabricators.slice(0, 5).join(', ')}.` : ''),
      threshold: claimFabMax,
      observed: claimFabricationEvents,
      affectedAgents: fabricators.slice(0, 10),
    });
  }

  return {
    windowDays,
    totalRuns,
    selfReportedRate,
    downgradeRate,
    claimFabricationEvents,
    alerts,
    agentBreakdown,
  };
}

/**
 * Drift Detector — Scheduled process (every 6 hours) that monitors
 * agent behavior for semantic drift by comparing recent performance
 * metrics against established baselines.
 *
 * For each active agent:
 *  1. Compute 30-day baseline (mean & stddev of key metrics)
 *  2. Compute 7-day recent window
 *  3. Flag >2σ deviations as drift alerts
 *  4. Auto-adjust trust score for >2.5σ degradation
 *
 * Metrics tracked: reasoning confidence, cost per run, token usage,
 * constitutional compliance rate, verification pass rate.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TrustScorer } from './trustScorer.js';

// ─── Types ──────────────────────────────────────────────────────

interface MetricStats {
  mean: number;
  stddev: number;
  count: number;
}

interface AgentMetrics {
  agentId: string;
  baseline: Record<string, MetricStats>;
  recent: Record<string, MetricStats>;
}

export interface DriftAlert {
  agentId: string;
  metric: string;
  baselineMean: number;
  baselineStddev: number;
  recentMean: number;
  deviationSigma: number;
  severity: 'warning' | 'critical';
  autoAdjusted: boolean;
}

export interface DriftDetectionResult {
  agentsAnalyzed: number;
  alertsGenerated: number;
  trustAdjustments: number;
  alerts: DriftAlert[];
  errors: string[];
}

// ─── Configuration ──────────────────────────────────────────────

const BASELINE_DAYS = 30;
const RECENT_DAYS = 7;
const WARNING_SIGMA = 2.0;
const CRITICAL_SIGMA = 2.5;
const MIN_BASELINE_RUNS = 10;
const DEGRADATION_METRICS = ['reasoning_confidence', 'constitutional_compliance'];

// ─── Class ──────────────────────────────────────────────────────

export class DriftDetector {
  constructor(
    private supabase: SupabaseClient,
    private trustScorer?: TrustScorer,
  ) {}

  /**
   * Run one detection cycle. Called by the scheduler every 6 hours.
   */
  async runDetection(): Promise<DriftDetectionResult> {
    const result: DriftDetectionResult = {
      agentsAnalyzed: 0,
      alertsGenerated: 0,
      trustAdjustments: 0,
      alerts: [],
      errors: [],
    };

    try {
      // Get distinct active agents from recent runs
      const activeAgents = await this.getActiveAgents();
      result.agentsAnalyzed = activeAgents.length;

      for (const agentId of activeAgents) {
        try {
          const metrics = await this.computeMetrics(agentId);
          if (!metrics) continue;

          const alerts = this.detectDrift(metrics);

          for (const alert of alerts) {
            // Persist alert
            await this.saveAlert(alert);
            result.alerts.push(alert);
            result.alertsGenerated++;

            // Auto-adjust trust for critical degradation in key metrics
            if (
              alert.severity === 'critical' &&
              DEGRADATION_METRICS.includes(alert.metric) &&
              alert.recentMean < alert.baselineMean && // Degradation (not improvement)
              this.trustScorer
            ) {
              const delta = -0.05 * (alert.deviationSigma - WARNING_SIGMA); // Scale penalty
              await this.trustScorer.applyDelta(agentId, { delta, source: 'drift_detection', reason: `Drift: ${alert.metric} deviated ${alert.deviationSigma.toFixed(1)}σ` });
              alert.autoAdjusted = true;
              result.trustAdjustments++;
            }
          }
        } catch (err) {
          result.errors.push(`Agent ${agentId}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      result.errors.push(`Detection cycle failed: ${(err as Error).message}`);
    }

    return result;
  }

  // ─── Internal Methods ───────────────────────────────────────

  private async getActiveAgents(): Promise<string[]> {
    const cutoff = new Date(
      Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data } = await this.supabase
      .from('agent_runs')
      .select('agent_id')
      .gte('created_at', cutoff)
      .not('agent_id', 'is', null);

    if (!data) return [];

    // Distinct agent IDs
    const seen = new Set<string>();
    return data
      .map((r: { agent_id: string }) => r.agent_id)
      .filter((id: string) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }

  private async computeMetrics(agentId: string): Promise<AgentMetrics | null> {
    const now = Date.now();
    const baselineStart = new Date(now - BASELINE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const recentStart = new Date(now - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Fetch baseline runs (30 days, excluding last 7)
    const { data: baselineRuns } = await this.supabase
      .from('agent_runs')
      .select('reasoning_confidence, reasoning_cost_usd, reasoning_passes, input_tokens, output_tokens, created_at')
      .eq('agent_id', agentId)
      .gte('created_at', baselineStart)
      .lt('created_at', recentStart)
      .limit(500);

    if (!baselineRuns || baselineRuns.length < MIN_BASELINE_RUNS) {
      return null; // Not enough baseline data
    }

    // Fetch recent runs (7 days)
    const { data: recentRuns } = await this.supabase
      .from('agent_runs')
      .select('reasoning_confidence, reasoning_cost_usd, reasoning_passes, input_tokens, output_tokens, created_at')
      .eq('agent_id', agentId)
      .gte('created_at', recentStart)
      .limit(200);

    if (!recentRuns || recentRuns.length < 3) {
      return null; // Not enough recent data
    }

    // Compute constitutional compliance if evaluations exist
    const baselineCompliance = await this.getComplianceRate(agentId, baselineStart, recentStart);
    const recentCompliance = await this.getComplianceRate(agentId, recentStart, new Date().toISOString());

    const baseline = this.computeStats(baselineRuns, baselineCompliance);
    const recent = this.computeStats(recentRuns, recentCompliance);

    return { agentId, baseline, recent };
  }

  private async getComplianceRate(
    agentId: string,
    from: string,
    to: string,
  ): Promise<number | null> {
    const { data } = await this.supabase
      .from('constitutional_evaluations')
      .select('passed')
      .eq('agent_role', agentId)
      .gte('created_at', from)
      .lt('created_at', to);

    if (!data || data.length === 0) return null;

    const passCount = data.filter((e: { passed: boolean }) => e.passed).length;
    return passCount / data.length;
  }

  private computeStats(
    runs: Array<{
      reasoning_confidence: number | null;
      reasoning_cost_usd: number | null;
      reasoning_passes: number | null;
      input_tokens: number | null;
      output_tokens: number | null;
    }>,
    complianceRate: number | null,
  ): Record<string, MetricStats> {
    const metrics: Record<string, MetricStats> = {};

    const confidences = runs.map(r => r.reasoning_confidence).filter((v): v is number => v != null);
    if (confidences.length > 0) {
      metrics.reasoning_confidence = this.statsOf(confidences);
    }

    const costs = runs.map(r => r.reasoning_cost_usd).filter((v): v is number => v != null);
    if (costs.length > 0) {
      metrics.cost_per_run = this.statsOf(costs);
    }

    const passes = runs.map(r => r.reasoning_passes).filter((v): v is number => v != null);
    if (passes.length > 0) {
      metrics.reasoning_passes = this.statsOf(passes);
    }

    // Compute total tokens from input_tokens + output_tokens
    const tokens = runs
      .map(r => (r.input_tokens || 0) + (r.output_tokens || 0))
      .filter(v => v > 0);
    if (tokens.length > 0) {
      metrics.tokens_used = this.statsOf(tokens);
    }

    if (complianceRate != null) {
      metrics.constitutional_compliance = {
        mean: complianceRate,
        stddev: 0.1, // Use fixed stddev for rate metric
        count: 1,
      };
    }

    return metrics;
  }

  private statsOf(values: number[]): MetricStats {
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
    return { mean, stddev: Math.sqrt(variance), count: n };
  }

  private detectDrift(metrics: AgentMetrics): DriftAlert[] {
    const alerts: DriftAlert[] = [];

    for (const [metric, baseline] of Object.entries(metrics.baseline)) {
      const recent = metrics.recent[metric];
      if (!recent || baseline.stddev === 0) continue;

      const deviation = Math.abs(recent.mean - baseline.mean) / baseline.stddev;

      if (deviation >= WARNING_SIGMA) {
        alerts.push({
          agentId: metrics.agentId,
          metric,
          baselineMean: baseline.mean,
          baselineStddev: baseline.stddev,
          recentMean: recent.mean,
          deviationSigma: deviation,
          severity: deviation >= CRITICAL_SIGMA ? 'critical' : 'warning',
          autoAdjusted: false,
        });
      }
    }

    return alerts;
  }

  private async saveAlert(alert: DriftAlert): Promise<void> {
    await this.supabase.from('drift_alerts').insert({
      agent_id: alert.agentId,
      metric: alert.metric,
      baseline_mean: alert.baselineMean,
      baseline_stddev: alert.baselineStddev,
      recent_mean: alert.recentMean,
      deviation_sigma: alert.deviationSigma,
      severity: alert.severity,
      auto_adjusted: alert.autoAdjusted,
    });
  }
}

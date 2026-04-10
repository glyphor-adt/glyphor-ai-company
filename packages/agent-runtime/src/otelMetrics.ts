/**
 * OpenTelemetry metrics — no-op friendly until an SDK registers a MeterProvider
 * (e.g. @azure/monitor-opentelemetry-exporter in the host process).
 */

import { metrics } from '@opentelemetry/api';
import type { DriftDetectionResult } from './driftDetector.js';

const meter = metrics.getMeter('glyphor.agent-runtime', '1.0.0');

const driftAlerts = meter.createCounter('glyphor.drift.alerts_generated', {
  description: 'Drift alerts emitted in a detection cycle',
});

const driftTrustAdjust = meter.createCounter('glyphor.drift.trust_adjustments', {
  description: 'Auto trust adjustments from drift detection',
});

const driftCycles = meter.createCounter('glyphor.drift.detection_cycles', {
  description: 'Completed drift detection cycles',
});

const trustDelta = meter.createCounter('glyphor.trust.delta_applied', {
  description: 'Trust score delta applications by source',
});

const agentRunsCompleted = meter.createCounter('glyphor.agent_runs.completed', {
  description: 'Agent runs completed with status attribute',
});

export function recordDriftDetectionCycle(result: DriftDetectionResult): void {
  driftCycles.add(1, { ok: result.errors.length === 0 ? 'true' : 'false' });
  driftAlerts.add(result.alertsGenerated);
  driftTrustAdjust.add(result.trustAdjustments);
}

export function recordTrustDeltaApplied(source: string): void {
  trustDelta.add(1, { source });
}

export function recordAgentRunCompleted(input: {
  status: 'completed' | 'aborted' | 'error' | 'skipped_precheck';
  role: string;
  task?: string;
  planningMode?: 'off' | 'auto' | 'required';
  mutatingToolCalls?: number;
}): void {
  agentRunsCompleted.add(1, {
    status: input.status,
    role: input.role,
    task: input.task ?? 'unknown',
    planning_mode: input.planningMode ?? 'off',
    mutating_bucket: bucketMutating(input.mutatingToolCalls ?? 0),
  });
}

function bucketMutating(n: number): string {
  if (n === 0) return '0';
  if (n <= 3) return '1-3';
  if (n <= 10) return '4-10';
  return '11+';
}

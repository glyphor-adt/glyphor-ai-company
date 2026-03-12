import { getRedisCache } from '@glyphor/agent-runtime';
import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

const LOCK_KEY = 'cascade-prediction-eval-lock';
const LOCK_TTL_SECONDS = 30 * 60;
const MAX_BATCH_SIZE = 500;

type PredictionType = 'metric_change' | 'risk_event' | 'team_impact';

interface PendingPredictionRow {
  id: string;
  simulation_id: string;
  prediction_type: PredictionType;
  predicted_value: Record<string, unknown> | null;
  created_at: string;
  simulation_status: string;
  accepted_at: string | null;
  accepted_by: string | null;
}

interface PredictionHistoryEntry {
  predicted: number;
  actual: number;
  delta: number;
  timestamp: string;
}

interface WorldModelRow {
  last_predictions: PredictionHistoryEntry[] | null;
  prediction_accuracy: number | null;
}

export interface CascadePredictionEvaluationResult {
  evaluated: number;
  updatedAgents: number;
  skipped: number;
}

export async function evaluateCascadePredictions(): Promise<CascadePredictionEvaluationResult> {
  const result: CascadePredictionEvaluationResult = { evaluated: 0, updatedAgents: 0, skipped: 0 };

  const cache = getRedisCache();
  const existingLock = await cache.get<string>(LOCK_KEY);
  if (existingLock) {
    console.log('[CascadePredictionEvaluator] Skipping — another evaluation is in progress');
    return result;
  }
  await cache.set(LOCK_KEY, new Date().toISOString(), LOCK_TTL_SECONDS);

  try {
    const pending = await systemQuery<PendingPredictionRow>(
      `SELECT
         cp.id,
         cp.simulation_id,
         cp.prediction_type,
         cp.predicted_value,
         cp.created_at,
         s.status AS simulation_status,
         s.accepted_at,
         s.accepted_by
       FROM cascade_predictions cp
       JOIN simulations s ON s.id = cp.simulation_id
       WHERE cp.outcome_observed_at IS NULL
         AND (
           cp.created_at <= NOW() - INTERVAL '30 days'
           OR (
             cp.created_at <= NOW() - INTERVAL '7 days'
             AND s.status IN ('accepted', 'rejected')
           )
         )
       ORDER BY cp.created_at ASC
       LIMIT $1`,
      [MAX_BATCH_SIZE],
    );

    if (pending.length === 0) {
      console.log('[CascadePredictionEvaluator] No cascade predictions ready for evaluation');
      return result;
    }

    const agentUpdates = new Map<CompanyAgentRole, Array<{ confidence: number; accuracy: number }>>();

    for (const row of pending) {
      const observationWindowDays = selectObservationWindow(row);
      const decisionOutcome = deriveDecisionOutcome(row, observationWindowDays);
      if (!decisionOutcome) {
        result.skipped++;
        continue;
      }

      const accuracy = scorePrediction(row.prediction_type, row.predicted_value ?? {}, decisionOutcome);
      const observedAt = new Date().toISOString();
      const actualValue = {
        basis: 'decision_outcome_proxy',
        decisionOutcome,
        observationWindowDays,
        simulationStatus: row.simulation_status,
        acceptedAt: row.accepted_at,
        acceptedBy: row.accepted_by,
      };

      await systemQuery(
        `UPDATE cascade_predictions
         SET actual_value = $1,
             accuracy_score = $2,
             outcome_observed_at = $3
         WHERE id = $4`,
        [JSON.stringify(actualValue), round2(accuracy), observedAt, row.id],
      );
      result.evaluated++;

      const agentRole = normalizeAgentRole(row.predicted_value?.agentRole);
      if (agentRole) {
        const confidence = clamp01(asNumber(row.predicted_value?.confidence, 0.5));
        const list = agentUpdates.get(agentRole) ?? [];
        list.push({ confidence, accuracy });
        agentUpdates.set(agentRole, list);
      }
    }

    for (const [agentRole, updates] of agentUpdates) {
      await updateAgentWorldModel(agentRole, updates);
      result.updatedAgents++;
    }

    console.log('[CascadePredictionEvaluator] Complete:', JSON.stringify(result));
    return result;
  } finally {
    await cache.del(LOCK_KEY);
  }
}

function selectObservationWindow(row: PendingPredictionRow): number {
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays >= 30) return 30;
  if (ageDays >= 14) return 14;
  return 7;
}

function deriveDecisionOutcome(
  row: PendingPredictionRow,
  observationWindowDays: number,
): 'accepted' | 'rejected' | 'no_decision' | null {
  if (row.simulation_status === 'accepted' || row.accepted_at) return 'accepted';
  if (row.simulation_status === 'rejected') return 'rejected';
  if (observationWindowDays >= 30) return 'no_decision';
  return null;
}

function scorePrediction(
  predictionType: PredictionType,
  predictedValue: Record<string, unknown>,
  decisionOutcome: 'accepted' | 'rejected' | 'no_decision',
): number {
  if (predictionType === 'metric_change') {
    const recommendation = String(predictedValue.recommendation ?? 'proceed_with_caution');
    if (decisionOutcome === 'accepted') {
      if (recommendation === 'proceed') return 1;
      if (recommendation === 'proceed_with_caution') return 0.72;
      return 0.2;
    }
    if (decisionOutcome === 'rejected') {
      if (recommendation === 'reconsider') return 1;
      if (recommendation === 'proceed_with_caution') return 0.62;
      return 0.2;
    }
    return recommendation === 'proceed_with_caution' ? 0.6 : 0.35;
  }

  if (predictionType === 'risk_event') {
    if (decisionOutcome === 'rejected') return 0.88;
    if (decisionOutcome === 'accepted') return 0.34;
    return 0.52;
  }

  const impact = String(predictedValue.impact ?? 'neutral');
  if (decisionOutcome === 'accepted') {
    if (impact === 'positive') return 0.86;
    if (impact === 'neutral') return 0.6;
    return 0.34;
  }
  if (decisionOutcome === 'rejected') {
    if (impact === 'negative') return 0.86;
    if (impact === 'neutral') return 0.6;
    return 0.34;
  }
  return impact === 'neutral' ? 0.6 : 0.46;
}

function normalizeAgentRole(value: unknown): CompanyAgentRole | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value as CompanyAgentRole;
}

async function updateAgentWorldModel(
  agentRole: CompanyAgentRole,
  updates: Array<{ confidence: number; accuracy: number }>,
): Promise<void> {
  const [existing] = await systemQuery<WorldModelRow>(
    'SELECT last_predictions, prediction_accuracy FROM agent_world_model WHERE agent_role = $1',
    [agentRole],
  );

  let lastPredictions = Array.isArray(existing?.last_predictions)
    ? [...existing.last_predictions]
    : [];
  let predictionAccuracy = typeof existing?.prediction_accuracy === 'number'
    ? existing.prediction_accuracy
    : 0.5;

  for (const update of updates) {
    predictionAccuracy = rollingAverage(predictionAccuracy, update.accuracy, lastPredictions.length);

    const predicted = round2(clamp01(update.confidence) * 5);
    const actual = round2(clamp01(update.accuracy) * 5);
    lastPredictions.push({
      predicted,
      actual,
      delta: round2(predicted - actual),
      timestamp: new Date().toISOString(),
    });
    if (lastPredictions.length > 20) {
      lastPredictions = lastPredictions.slice(-20);
    }
  }

  await systemQuery(
    `INSERT INTO agent_world_model (agent_role, updated_at, last_predictions, prediction_accuracy)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (agent_role) DO UPDATE SET
       updated_at = EXCLUDED.updated_at,
       last_predictions = EXCLUDED.last_predictions,
       prediction_accuracy = EXCLUDED.prediction_accuracy`,
    [agentRole, new Date().toISOString(), JSON.stringify(lastPredictions), predictionAccuracy],
  );
}

function rollingAverage(current: number, newValue: number, count: number): number {
  if (count === 0) return newValue;
  const alpha = Math.max(0.1, 1 / (count + 1));
  return current * (1 - alpha) + newValue * alpha;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

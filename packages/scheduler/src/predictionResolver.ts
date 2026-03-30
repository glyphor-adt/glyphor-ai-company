import { getRedisCache, TrustScorer } from '@glyphor/agent-runtime';
import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

const LOCK_KEY = 'prediction-journal-resolver-lock';
const LOCK_TTL_SECONDS = 30 * 60;
const MAX_BATCH_SIZE = 500;

interface PendingPredictionRow {
  id: string;
  agent_role: CompanyAgentRole;
  prediction_type: string;
  predicted_value: Record<string, unknown> | number | null;
  target_date: string;
  resolution_source: string;
}

interface WorldModelRow {
  last_predictions: Array<Record<string, unknown>> | null;
  prediction_accuracy: number | null;
}

interface NumericResolution {
  actualNumeric: number;
  actualValue: Record<string, unknown>;
  accuracyScore: number;
}

export interface PredictionResolutionResult {
  evaluated: number;
  updatedAgents: number;
  failed: number;
  skipped: number;
}

export async function resolvePredictionJournal(): Promise<PredictionResolutionResult> {
  const result: PredictionResolutionResult = { evaluated: 0, updatedAgents: 0, failed: 0, skipped: 0 };

  const cache = getRedisCache();
  const existingLock = await cache.get<string>(LOCK_KEY);
  if (existingLock) {
    console.log('[PredictionResolver] Skipping — another resolution run is in progress');
    return result;
  }
  await cache.set(LOCK_KEY, new Date().toISOString(), LOCK_TTL_SECONDS);

  try {
    const pending = await systemQuery<PendingPredictionRow>(
      `SELECT id, agent_role, prediction_type, predicted_value, target_date, resolution_source
       FROM agent_prediction_journal
       WHERE status = 'pending'
         AND target_date <= NOW()
       ORDER BY target_date ASC
       LIMIT $1`,
      [MAX_BATCH_SIZE],
    );

    if (pending.length === 0) {
      console.log('[PredictionResolver] No predictions ready for resolution');
      return result;
    }

    const agentUpdates = new Map<CompanyAgentRole, Array<{ accuracy: number; predicted: number; actual: number; predictionType: string }>>();

    for (const row of pending) {
      try {
        const resolution = await resolvePrediction(row);
        if (!resolution) {
          result.skipped++;
          continue;
        }

        await systemQuery(
          `UPDATE agent_prediction_journal
           SET actual_value = $1::jsonb,
               accuracy_score = $2,
               status = 'resolved',
               resolved_at = $3
           WHERE id = $4`,
          [JSON.stringify(resolution.actualValue), resolution.accuracyScore, new Date().toISOString(), row.id],
        );

        const updates = agentUpdates.get(row.agent_role) ?? [];
        updates.push({
          accuracy: resolution.accuracyScore,
          predicted: getPredictedNumeric(row),
          actual: resolution.actualNumeric,
          predictionType: row.prediction_type,
        });
        agentUpdates.set(row.agent_role, updates);
        result.evaluated++;
      } catch (err) {
        result.failed++;
        console.error('[PredictionResolver] Resolution failed for journal row', row.id, err);
        await systemQuery(
          `UPDATE agent_prediction_journal
           SET status = 'failed',
               resolved_at = $1,
               actual_value = COALESCE(actual_value, $2::jsonb)
           WHERE id = $3`,
          [new Date().toISOString(), JSON.stringify({ error: (err as Error).message }), row.id],
        );
      }
    }

    const trustScorer = new TrustScorer(cache);
    for (const [agentRole, updates] of agentUpdates) {
      await updateAgentWorldModel(agentRole, updates);
      const averageAccuracy = updates.reduce((sum, item) => sum + item.accuracy, 0) / updates.length;
      await trustScorer.applyDelta(agentRole, {
        source: 'prediction_accuracy',
        delta: averageAccuracy - 0.5,
        reason: `Resolved ${updates.length} predictions at ${(averageAccuracy * 100).toFixed(0)}% average accuracy`,
      });
      result.updatedAgents++;
    }

    console.log('[PredictionResolver] Complete:', JSON.stringify(result));
    return result;
  } finally {
    await cache.del(LOCK_KEY);
  }
}

async function resolvePrediction(row: PendingPredictionRow): Promise<NumericResolution | null> {
  switch (row.resolution_source) {
    case 'stripe_mrr_30d': {
      const [data] = await systemQuery<{ actual_mrr: number | string | null }>(
        `SELECT COALESCE(SUM(amount_usd), 0) AS actual_mrr
         FROM stripe_data
         WHERE recorded_at >= ($1::timestamptz - INTERVAL '30 days')
           AND recorded_at < ($1::timestamptz + INTERVAL '1 day')`,
        [row.target_date],
      );
      const predicted = getPredictedNumeric(row);
      const actual = Number(data?.actual_mrr ?? 0);
      return buildNumericResolution(predicted, actual, {
        metric: 'mrr_30d',
        target_date: row.target_date,
        actual_mrr: actual,
      });
    }
    case 'agent_runs_daily_runs': {
      const [data] = await systemQuery<{ run_count: number | string | null }>(
        `SELECT COUNT(*)::int AS run_count
         FROM agent_runs
         WHERE DATE(started_at) = DATE($1::timestamptz)`,
        [row.target_date],
      );
      const predicted = getPredictedNumeric(row);
      const actual = Number(data?.run_count ?? 0);
      return buildNumericResolution(predicted, actual, {
        metric: 'daily_runs',
        target_date: row.target_date,
        actual_runs: actual,
      });
    }
    case 'agent_runs_daily_cost': {
      const [data] = await systemQuery<{ daily_cost: number | string | null }>(
        `SELECT COALESCE(SUM(cost_usd), 0) AS daily_cost
         FROM agent_runs
         WHERE DATE(started_at) = DATE($1::timestamptz)`,
        [row.target_date],
      );
      const predicted = getPredictedNumeric(row);
      const actual = Number(data?.daily_cost ?? 0);
      return buildNumericResolution(predicted, actual, {
        metric: 'daily_cost',
        target_date: row.target_date,
        actual_cost: actual,
      });
    }
    default:
      return null;
  }
}

function getPredictedNumeric(row: PendingPredictionRow): number {
  const payload = row.predicted_value;
  if (typeof payload === 'number') return payload;
  if (!payload || typeof payload !== 'object') return 0;

  const record = payload as Record<string, unknown>;
  const candidate = record.projected_mrr
    ?? record.projected_daily_runs
    ?? record.projected_daily_cost
    ?? record.value;

  return typeof candidate === 'number'
    ? candidate
    : typeof candidate === 'string'
      ? Number(candidate)
      : 0;
}

function buildNumericResolution(
  predicted: number,
  actual: number,
  actualValue: Record<string, unknown>,
): NumericResolution {
  return {
    actualNumeric: actual,
    actualValue,
    accuracyScore: scoreNumericPrediction(predicted, actual),
  };
}

function scoreNumericPrediction(predicted: number, actual: number): number {
  if (!Number.isFinite(predicted) || !Number.isFinite(actual)) return 0;
  if (predicted === 0 && actual === 0) return 1;

  const baseline = Math.max(Math.abs(predicted), Math.abs(actual), 1);
  const relativeError = Math.abs(predicted - actual) / baseline;
  return round2(Math.max(0, 1 - relativeError));
}

async function updateAgentWorldModel(
  agentRole: CompanyAgentRole,
  updates: Array<{ accuracy: number; predicted: number; actual: number; predictionType: string }>,
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
    lastPredictions.push({
      predictionType: update.predictionType,
      predicted: round2(update.predicted),
      actual: round2(update.actual),
      delta: round2(update.predicted - update.actual),
      accuracy: round2(update.accuracy),
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
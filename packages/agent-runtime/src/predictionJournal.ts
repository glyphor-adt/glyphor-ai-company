import { systemQuery } from '@glyphor/shared/db';
import type { CompanyAgentRole, PredictionJournalRecord } from './types.js';
import { isValidUUID } from './uuidUtils.js';

function isPredictionRecord(value: unknown): value is PredictionJournalRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.prediction_type === 'string'
    && record.prediction_type.trim().length > 0
    && typeof record.target_date === 'string'
    && record.target_date.trim().length > 0
    && typeof record.resolution_source === 'string'
    && record.resolution_source.trim().length > 0
    && 'predicted_value' in record;
}

export function extractPredictionRecords(payload: unknown): PredictionJournalRecord[] {
  if (!payload || typeof payload !== 'object') return [];

  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.predictions)) return [];

  return record.predictions
    .filter(isPredictionRecord)
    .map((prediction) => ({
      ...prediction,
      target_date: new Date(prediction.target_date).toISOString(),
    }));
}

export async function persistPredictionRecords(
  runId: string | undefined,
  agentRole: CompanyAgentRole,
  predictions: PredictionJournalRecord[],
): Promise<number> {
  if (!runId || !isValidUUID(runId) || predictions.length === 0) return 0;

  let inserted = 0;
  for (const prediction of predictions) {
    await systemQuery(
      `INSERT INTO agent_prediction_journal
         (run_id, agent_role, prediction_type, predicted_value, target_date, resolution_source,
          actual_value, accuracy_score, status, created_at, resolved_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8, $9, $10, $11)`,
      [
        runId,
        agentRole,
        prediction.prediction_type,
        JSON.stringify(prediction.predicted_value ?? null),
        prediction.target_date,
        prediction.resolution_source,
        JSON.stringify(prediction.actual_value ?? null),
        prediction.accuracy_score ?? null,
        prediction.status ?? 'pending',
        prediction.created_at ?? new Date().toISOString(),
        prediction.resolved_at ?? null,
      ],
    );
    inserted++;
  }

  return inserted;
}
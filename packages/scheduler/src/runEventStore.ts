import { systemQuery } from '@glyphor/shared/db';

export interface UpsertRunSessionInput {
  runId: string;
  conversationId?: string;
  userId?: string;
  agentRole: string;
  task: string;
  source?: string;
  transport?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export async function upsertRunSession(input: UpsertRunSessionInput): Promise<void> {
  await systemQuery(
    `INSERT INTO run_sessions (
       run_id, conversation_id, user_id, agent_role, task, source, transport, status, started_at, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'running'), NOW(), $9::jsonb)
     ON CONFLICT (run_id) DO UPDATE
       SET conversation_id = COALESCE(EXCLUDED.conversation_id, run_sessions.conversation_id),
           user_id = COALESCE(EXCLUDED.user_id, run_sessions.user_id),
           agent_role = EXCLUDED.agent_role,
           task = EXCLUDED.task,
           source = EXCLUDED.source,
           transport = EXCLUDED.transport,
           status = COALESCE(EXCLUDED.status, run_sessions.status),
           metadata = COALESCE(EXCLUDED.metadata, run_sessions.metadata)`,
    [
      input.runId,
      input.conversationId ?? null,
      input.userId ?? null,
      input.agentRole,
      input.task,
      input.source ?? 'dashboard',
      input.transport ?? 'json',
      input.status ?? 'running',
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
}

export async function appendRunEvent(input: {
  runId: string;
  eventType: string;
  phase?: string;
  status?: string;
  payload?: Record<string, unknown>;
  error?: string;
}): Promise<number> {
  const [row] = await systemQuery<{ seq: number }>(
    `INSERT INTO run_events (run_id, seq, event_type, phase, status, payload, error, created_at)
     SELECT
       $1,
       COALESCE((SELECT MAX(seq) + 1 FROM run_events WHERE run_id = $1), 1),
       $2,
       $3,
       $4,
       $5::jsonb,
       $6,
       NOW()
     RETURNING seq`,
    [
      input.runId,
      input.eventType,
      input.phase ?? null,
      input.status ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
      input.error ?? null,
    ],
  );
  return row?.seq ?? 0;
}

export async function completeRunSession(input: {
  runId: string;
  status: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await systemQuery(
    `UPDATE run_sessions
        SET status = $2,
            completed_at = NOW(),
            metadata = COALESCE($3::jsonb, metadata)
      WHERE run_id = $1`,
    [input.runId, input.status, input.metadata ? JSON.stringify(input.metadata) : null],
  );
}

export interface RunEventRow {
  seq: number;
  event_type: string;
  phase: string | null;
  status: string | null;
  payload: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
}

export async function getRunEvents(input: {
  runId: string;
  fromSeq?: number;
  limit?: number;
}): Promise<RunEventRow[]> {
  const rows = await systemQuery<RunEventRow>(
    `SELECT seq, event_type, phase, status, payload, error, created_at
       FROM run_events
      WHERE run_id = $1
        AND seq > $2
      ORDER BY seq ASC
      LIMIT $3`,
    [input.runId, input.fromSeq ?? 0, Math.max(1, Math.min(input.limit ?? 500, 2000))],
  );
  return rows;
}

export async function getRunSession(input: {
  runId: string;
}): Promise<{ run_id: string; status: string; completed_at: string | null; user_id: string | null } | null> {
  const rows = await systemQuery<{ run_id: string; status: string; completed_at: string | null; user_id: string | null }>(
    `SELECT run_id, status, completed_at, user_id
       FROM run_sessions
      WHERE run_id = $1
      LIMIT 1`,
    [input.runId],
  );
  return rows[0] ?? null;
}


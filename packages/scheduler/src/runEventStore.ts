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
}): Promise<void> {
  await systemQuery(
    `INSERT INTO run_events (run_id, seq, event_type, phase, status, payload, error, created_at)
     SELECT
       $1,
       COALESCE((SELECT MAX(seq) + 1 FROM run_events WHERE run_id = $1), 1),
       $2,
       $3,
       $4,
       $5::jsonb,
       $6,
       NOW()`,
    [
      input.runId,
      input.eventType,
      input.phase ?? null,
      input.status ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
      input.error ?? null,
    ],
  );
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


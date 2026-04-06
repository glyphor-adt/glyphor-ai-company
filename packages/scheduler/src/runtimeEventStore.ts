import crypto from 'node:crypto';
import { systemQuery } from '@glyphor/shared/db';

export type RuntimeEventType =
  | 'run_created'
  | 'run_started'
  | 'turn_started'
  | 'status'
  | 'tool_called'
  | 'tool_completed'
  | 'approval_requested'
  | 'result'
  | 'run_failed'
  | 'run_completed'
  | 'heartbeat';

export interface RuntimeSessionInput {
  sessionKey: string;
  source: string;
  ownerUserId?: string | null;
  ownerEmail?: string | null;
  tenantId?: string | null;
  primaryAgentRole: string;
  metadata?: Record<string, unknown>;
  runId?: string | null;
}

export interface RuntimeAttemptInput {
  sessionId: string;
  runId: string;
  triggeredBy: string;
  triggerReason?: string;
  requestPayload?: Record<string, unknown>;
}

export interface RuntimeEventInput {
  sessionId: string;
  attemptId: string;
  runId: string;
  eventType: RuntimeEventType;
  status?: string | null;
  actorRole?: string | null;
  toolName?: string | null;
  traceId?: string | null;
  parentEventId?: string | null;
  payload?: Record<string, unknown>;
  eventTs?: string;
}

export interface RuntimeReplayResult {
  sessionId: string;
  nextCursor: number;
  events: Array<{
    seq: number;
    eventId: string;
    eventType: string;
    runId: string;
    eventTs: string;
    status: string | null;
    actorRole: string | null;
    toolName: string | null;
    traceId: string | null;
    parentEventId: string | null;
    payload: Record<string, unknown>;
  }>;
}

function normalizeMetadata(metadata?: Record<string, unknown>): string {
  try {
    return JSON.stringify(metadata ?? {});
  } catch {
    return '{}';
  }
}

export async function ensureRuntimeSession(input: RuntimeSessionInput): Promise<string> {
  const rows = await systemQuery<{ id: string }>(
    `INSERT INTO run_sessions (
       session_key, source, owner_user_id, owner_email, tenant_id, primary_agent_role, latest_run_id, metadata, status, last_event_at, updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'active',NOW(),NOW())
     ON CONFLICT (session_key) DO UPDATE SET
       source = EXCLUDED.source,
       owner_user_id = COALESCE(EXCLUDED.owner_user_id, run_sessions.owner_user_id),
       owner_email = COALESCE(EXCLUDED.owner_email, run_sessions.owner_email),
       tenant_id = COALESCE(EXCLUDED.tenant_id, run_sessions.tenant_id),
       primary_agent_role = EXCLUDED.primary_agent_role,
       latest_run_id = COALESCE(EXCLUDED.latest_run_id, run_sessions.latest_run_id),
       metadata = run_sessions.metadata || EXCLUDED.metadata,
       updated_at = NOW()
     RETURNING id`,
    [
      input.sessionKey,
      input.source,
      input.ownerUserId ?? null,
      input.ownerEmail ?? null,
      input.tenantId ?? null,
      input.primaryAgentRole,
      input.runId ?? null,
      normalizeMetadata(input.metadata),
    ],
  );
  return rows[0].id;
}

export async function createRuntimeAttempt(input: RuntimeAttemptInput): Promise<{ id: string; attemptNumber: number }> {
  const rows = await systemQuery<{ id: string; attempt_number: number }>(
    `WITH next_attempt AS (
       SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number
       FROM run_attempts
       WHERE session_id = $1
     )
     INSERT INTO run_attempts (
       session_id, run_id, attempt_number, triggered_by, trigger_reason, request_payload, status, started_at, updated_at
     )
     SELECT $1, $2, next_attempt.attempt_number, $3, $4, $5::jsonb, 'created', NOW(), NOW()
     FROM next_attempt
     ON CONFLICT (run_id) DO UPDATE SET
       trigger_reason = COALESCE(EXCLUDED.trigger_reason, run_attempts.trigger_reason),
       request_payload = run_attempts.request_payload || EXCLUDED.request_payload,
       updated_at = NOW()
     RETURNING id, attempt_number`,
    [
      input.sessionId,
      input.runId,
      input.triggeredBy,
      input.triggerReason ?? null,
      normalizeMetadata(input.requestPayload),
    ],
  );
  return { id: rows[0].id, attemptNumber: rows[0].attempt_number };
}

export async function appendRuntimeEvent(input: RuntimeEventInput): Promise<{ seq: number; eventId: string }> {
  const eventId = crypto.randomUUID();
  const rows = await systemQuery<{ stream_seq: number }>(
    `WITH next_seq AS (
       SELECT COALESCE(MAX(stream_seq), 0) + 1 AS stream_seq
       FROM run_events
       WHERE session_id = $1
     )
     INSERT INTO run_events (
       session_id, attempt_id, run_id, stream_seq, event_id, event_type, event_ts, status, actor_role, tool_name, trace_id, parent_event_id, payload
     )
     SELECT
       $1, $2, $3, next_seq.stream_seq, $4, $5, COALESCE($6::timestamptz, NOW()), $7, $8, $9, $10, $11, $12::jsonb
     FROM next_seq
     RETURNING stream_seq`,
    [
      input.sessionId,
      input.attemptId,
      input.runId,
      eventId,
      input.eventType,
      input.eventTs ?? null,
      input.status ?? null,
      input.actorRole ?? null,
      input.toolName ?? null,
      input.traceId ?? null,
      input.parentEventId ?? null,
      normalizeMetadata(input.payload),
    ],
  );

  await systemQuery(
    `UPDATE run_sessions
       SET latest_run_id = $2, last_event_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [input.sessionId, input.runId],
  );

  return {
    seq: Number(rows[0].stream_seq),
    eventId,
  };
}

export async function markRuntimeAttemptTerminal(input: {
  attemptId: string;
  status: 'completed' | 'failed' | 'aborted' | 'queued_for_approval' | 'rejected';
  responseSummary?: Record<string, unknown>;
  errorMessage?: string | null;
}): Promise<void> {
  await systemQuery(
    `UPDATE run_attempts
       SET status = $2,
           response_summary = response_summary || $3::jsonb,
           error_message = COALESCE($4, error_message),
           ended_at = NOW(),
           updated_at = NOW()
     WHERE id = $1`,
    [
      input.attemptId,
      input.status,
      normalizeMetadata(input.responseSummary),
      input.errorMessage ?? null,
    ],
  );
}

export async function markRuntimeAttemptRunning(input: {
  attemptId: string;
}): Promise<void> {
  await systemQuery(
    `UPDATE run_attempts
       SET status = 'running',
           updated_at = NOW()
     WHERE id = $1`,
    [input.attemptId],
  );
}

export async function markRuntimeSessionTerminal(input: {
  sessionId: string;
  status: 'completed' | 'failed' | 'aborted' | 'expired';
}): Promise<void> {
  await systemQuery(
    `UPDATE run_sessions
       SET status = $2, completed_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [input.sessionId, input.status],
  );
}

export async function replayRuntimeEventsBySeq(input: {
  sessionId: string;
  fromSeq?: number;
  limit?: number;
}): Promise<RuntimeReplayResult> {
  const fromSeq = Number.isFinite(input.fromSeq) ? Math.max(0, Number(input.fromSeq)) : 0;
  const limit = Number.isFinite(input.limit) ? Math.min(500, Math.max(1, Number(input.limit))) : 200;
  const rows = await systemQuery<{
    stream_seq: number;
    event_id: string;
    event_type: string;
    run_id: string;
    event_ts: string;
    status: string | null;
    actor_role: string | null;
    tool_name: string | null;
    trace_id: string | null;
    parent_event_id: string | null;
    payload: Record<string, unknown>;
  }>(
    `SELECT stream_seq, event_id, event_type, run_id, event_ts, status, actor_role, tool_name, trace_id, parent_event_id, payload
       FROM run_events
      WHERE session_id = $1
        AND stream_seq > $2
      ORDER BY stream_seq ASC
      LIMIT $3`,
    [input.sessionId, fromSeq, limit],
  );

  const nextCursor = rows.length > 0 ? Number(rows[rows.length - 1].stream_seq) : fromSeq;
  return {
    sessionId: input.sessionId,
    nextCursor,
    events: rows.map((row) => ({
      seq: Number(row.stream_seq),
      eventId: row.event_id,
      eventType: row.event_type,
      runId: row.run_id,
      eventTs: row.event_ts,
      status: row.status,
      actorRole: row.actor_role,
      toolName: row.tool_name,
      traceId: row.trace_id,
      parentEventId: row.parent_event_id,
      payload: row.payload ?? {},
    })),
  };
}

export async function findSessionIdBySessionKey(sessionKey: string): Promise<string | null> {
  const rows = await systemQuery<{ id: string }>(
    `SELECT id FROM run_sessions WHERE session_key = $1 LIMIT 1`,
    [sessionKey],
  );
  return rows[0]?.id ?? null;
}

export async function resolveRuntimeCursorFromEventId(input: {
  sessionId: string;
  eventId: string;
}): Promise<number> {
  const rows = await systemQuery<{ stream_seq: number }>(
    `SELECT stream_seq
       FROM run_events
      WHERE session_id = $1
        AND event_id = $2
      LIMIT 1`,
    [input.sessionId, input.eventId],
  );
  return rows[0] ? Number(rows[0].stream_seq) : 0;
}

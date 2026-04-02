import { createHash, randomUUID } from 'node:crypto';
import { systemQuery } from '@glyphor/shared/db';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const runSequenceByRunId = new Map<string, number>();
const previousDigestByRunId = new Map<string, string>();

export interface LedgerEventInput {
  runId?: string;
  eventType: string;
  trigger?: string;
  component: string;
  traceId?: string;
  parentEventUid?: string;
  approvalState?: string;
  payload?: Record<string, unknown>;
}

export interface EvidenceRecordInput {
  runId?: string;
  sourceType: string;
  sourceTool?: string;
  sourceRef?: string;
  content: unknown;
  metadata?: Record<string, unknown>;
}

export interface ClaimEvidenceLinkInput {
  runId?: string;
  claimText: string;
  evidenceUid: string;
  verificationState?: 'supported' | 'unsupported' | 'disputed';
}

export interface FailureTaxonomyInput {
  runId?: string;
  agentRole: string;
  taskClass: string;
  failureCode: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  detail?: string;
  metadata?: Record<string, unknown>;
}

function isLedgerEnabled(): boolean {
  const raw = process.env.AGENT_RUN_LEDGER_ENABLED?.trim().toLowerCase();
  return raw ? TRUTHY_VALUES.has(raw) : false;
}

function normalizeRunId(runId: string | undefined): string | null {
  if (!runId) return null;
  return UUID_RE.test(runId) ? runId : null;
}

function digest(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function nextSequence(runId: string): number {
  const next = (runSequenceByRunId.get(runId) ?? 0) + 1;
  runSequenceByRunId.set(runId, next);
  return next;
}

function stablePayload(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return JSON.stringify({ serialization_error: true });
  }
}

export async function recordRunEvent(input: LedgerEventInput): Promise<string | null> {
  if (!isLedgerEnabled()) return null;
  const runId = normalizeRunId(input.runId);
  if (!runId) return null;

  const seq = nextSequence(runId);
  const payloadJson = stablePayload(input.payload ?? {});
  const payloadDigest = digest(payloadJson);
  const prevDigest = previousDigestByRunId.get(runId) ?? null;
  const eventUid = `${runId}:${seq}:${digest(`${input.eventType}:${payloadDigest}`).slice(0, 16)}`;
  const eventDigest = digest(`${runId}|${seq}|${payloadDigest}|${prevDigest ?? ''}`);
  previousDigestByRunId.set(runId, eventDigest);

  try {
    await systemQuery(
      `INSERT INTO agent_run_events (
         run_id, event_seq, event_uid, event_type, trigger, component, trace_id,
         parent_event_uid, approval_state, payload, payload_digest, prev_event_digest, event_digest
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
       ON CONFLICT (event_uid) DO NOTHING`,
      [
        runId,
        seq,
        eventUid,
        input.eventType,
        input.trigger ?? null,
        input.component,
        input.traceId ?? null,
        input.parentEventUid ?? null,
        input.approvalState ?? null,
        payloadJson,
        payloadDigest,
        prevDigest,
        eventDigest,
      ],
    );
    return eventUid;
  } catch (err) {
    console.warn('[RunLedger] Failed to record run event:', (err as Error).message);
    return null;
  }
}

export async function recordEvidence(input: EvidenceRecordInput): Promise<string | null> {
  if (!isLedgerEnabled()) return null;
  const runId = normalizeRunId(input.runId);
  if (!runId) return null;

  const serializedContent = stablePayload(input.content);
  const contentDigest = digest(serializedContent);
  const evidenceUid = `${runId}:ev:${contentDigest.slice(0, 20)}`;

  try {
    await systemQuery(
      `INSERT INTO agent_run_evidence (
         run_id, evidence_uid, source_type, source_tool, source_ref, content_digest, content_preview, metadata
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (evidence_uid) DO NOTHING`,
      [
        runId,
        evidenceUid,
        input.sourceType,
        input.sourceTool ?? null,
        input.sourceRef ?? null,
        contentDigest,
        serializedContent.slice(0, 1000),
        stablePayload(input.metadata ?? {}),
      ],
    );
    return evidenceUid;
  } catch (err) {
    console.warn('[RunLedger] Failed to record evidence:', (err as Error).message);
    return null;
  }
}

export async function linkClaimToEvidence(input: ClaimEvidenceLinkInput): Promise<void> {
  if (!isLedgerEnabled()) return;
  const runId = normalizeRunId(input.runId);
  if (!runId) return;

  const claimUid = `${runId}:claim:${digest(input.claimText).slice(0, 20)}`;
  try {
    await systemQuery(
      `INSERT INTO agent_claim_evidence_links (
         run_id, claim_uid, claim_text, evidence_uid, verification_state
       )
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (claim_uid, evidence_uid) DO NOTHING`,
      [
        runId,
        claimUid,
        input.claimText,
        input.evidenceUid,
        input.verificationState ?? 'supported',
      ],
    );
  } catch (err) {
    console.warn('[RunLedger] Failed to link claim to evidence:', (err as Error).message);
  }
}

export async function recordFailureTaxonomy(input: FailureTaxonomyInput): Promise<void> {
  if (!isLedgerEnabled()) return;
  const runId = normalizeRunId(input.runId);
  if (!runId) return;

  try {
    await systemQuery(
      `INSERT INTO agent_failure_taxonomy (
         run_id, agent_role, task_class, failure_code, severity, detail, metadata
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        runId,
        input.agentRole,
        input.taskClass,
        input.failureCode,
        input.severity ?? 'medium',
        input.detail ?? null,
        stablePayload(input.metadata ?? {}),
      ],
    );
  } catch (err) {
    console.warn('[RunLedger] Failed to record failure taxonomy:', (err as Error).message);
  }
}

export async function replayRun(runId: string): Promise<{
  runId: string;
  events: Array<{
    eventSeq: number;
    eventType: string;
    component: string;
    trigger: string | null;
    approvalState: string | null;
    createdAt: string;
    payload: Record<string, unknown>;
  }>;
  claims: Array<{
    claimUid: string;
    claimText: string;
    evidenceUid: string;
    verificationState: string;
  }>;
}> {
  const safeRunId = normalizeRunId(runId);
  if (!safeRunId) {
    throw new Error(`Invalid run id: ${runId}`);
  }

  const events = await systemQuery<{
    event_seq: number;
    event_type: string;
    component: string;
    trigger: string | null;
    approval_state: string | null;
    created_at: string;
    payload: Record<string, unknown>;
  }>(
    `SELECT event_seq, event_type, component, trigger, approval_state, created_at, payload
       FROM agent_run_events
      WHERE run_id = $1
      ORDER BY event_seq ASC`,
    [safeRunId],
  );

  const claims = await systemQuery<{
    claim_uid: string;
    claim_text: string;
    evidence_uid: string;
    verification_state: string;
  }>(
    `SELECT claim_uid, claim_text, evidence_uid, verification_state
       FROM agent_claim_evidence_links
      WHERE run_id = $1
      ORDER BY created_at ASC`,
    [safeRunId],
  );

  return {
    runId: safeRunId,
    events: events.map((event) => ({
      eventSeq: event.event_seq,
      eventType: event.event_type,
      component: event.component,
      trigger: event.trigger,
      approvalState: event.approval_state,
      createdAt: event.created_at,
      payload: event.payload ?? {},
    })),
    claims: claims.map((claim) => ({
      claimUid: claim.claim_uid,
      claimText: claim.claim_text,
      evidenceUid: claim.evidence_uid,
      verificationState: claim.verification_state,
    })),
  };
}

export function createEventTrigger(source: string, reason?: string): string {
  if (!reason) return source;
  return `${source}:${reason}`;
}

export function createContentDigest(value: unknown): string {
  return digest(stablePayload(value));
}

export function createEvidenceSourceRef(toolName: string, turnNumber: number, traceId?: string): string {
  const tracePart = traceId ? `:${traceId}` : '';
  return `${toolName}:turn_${turnNumber}${tracePart}`;
}

export function buildRunEventId(): string {
  return randomUUID();
}

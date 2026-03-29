import { systemTransaction } from '@glyphor/shared/db';

const POLL_INTERVAL_MS = 5_000;
const MAX_BATCH_SIZE = 5;
const DEFAULT_SCHEDULER_URL = 'https://glyphor-scheduler-610179349713.us-central1.run.app';

interface PendingDirectiveWake {
  id: string;
  task: string;
  reason: string;
  context: Record<string, unknown>;
}

let pollerHandle: NodeJS.Timeout | null = null;
let pollerInFlight = false;

function getSchedulerEndpoint(): string {
  const baseUrl = process.env.SCHEDULER_URL?.trim() || (
    process.env.NODE_ENV === 'production' ? DEFAULT_SCHEDULER_URL : 'http://localhost:8080'
  );
  return `${baseUrl.replace(/\/$/, '')}/run`;
}

async function claimPendingDirectiveWakes(): Promise<PendingDirectiveWake[]> {
  return systemTransaction(async (db) => {
    const pending = await db.query<PendingDirectiveWake>(
      `SELECT id, task, reason, context
       FROM agent_wake_queue
       WHERE agent_role = 'chief-of-staff'
         AND task = 'process_directive'
         AND status = 'pending'
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [MAX_BATCH_SIZE],
    );

    if (!pending.rows.length) return [];

    const ids = pending.rows.map((row) => row.id);
    await db.query(
      `UPDATE agent_wake_queue
       SET status = 'dispatched', dispatched_at = NOW()
       WHERE id = ANY($1)`,
      [ids],
    );

    return pending.rows;
  });
}

async function markWakeStatus(id: string, status: 'pending' | 'completed'): Promise<void> {
  await systemTransaction(async (db) => {
    if (status === 'completed') {
      await db.query(
        `UPDATE agent_wake_queue
         SET status = 'completed'
         WHERE id = $1`,
        [id],
      );
      return;
    }

    await db.query(
      `UPDATE agent_wake_queue
       SET status = 'pending', dispatched_at = NULL
       WHERE id = $1`,
      [id],
    );
  });
}

async function dispatchDirectiveWake(wake: PendingDirectiveWake): Promise<void> {
  const schedulerEndpoint = getSchedulerEndpoint();
  const context = wake.context ?? {};

  const response = await fetch(schedulerEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      agentRole: 'chief-of-staff',
      task: 'process_directive',
      payload: {
        tenantId: context.tenant_id,
        source: context.source,
        wake_reason: wake.reason,
        context,
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => 'unknown error');
    throw new Error(`Scheduler /run failed (${response.status}): ${details}`);
  }
}

async function pollOnce(): Promise<void> {
  if (pollerInFlight) return;
  pollerInFlight = true;

  try {
    const pending = await claimPendingDirectiveWakes();
    for (const wake of pending) {
      try {
        await dispatchDirectiveWake(wake);
        await markWakeStatus(wake.id, 'completed');
        console.log(`[DirectivePoller] Dispatched ${wake.task} wake ${wake.id}`);
      } catch (error) {
        await markWakeStatus(wake.id, 'pending');
        console.error(`[DirectivePoller] Failed to dispatch wake ${wake.id}:`, error);
      }
    }
  } finally {
    pollerInFlight = false;
  }
}

export function startDirectivePoller(): void {
  if (pollerHandle) return;

  pollerHandle = setInterval(() => {
    void pollOnce().catch((error) => {
      console.error('[DirectivePoller] Poll error:', error);
    });
  }, POLL_INTERVAL_MS);

  pollerHandle.unref?.();
  void pollOnce().catch((error) => {
    console.error('[DirectivePoller] Initial poll error:', error);
  });
}
import { systemQuery } from './db.js';

/** First N characters of trimmed task text — must match SQL LEFT(TRIM(task_description), N). */
export const WORK_ASSIGNMENT_DEDUP_PREFIX_LEN = 100;

export function normalizeWorkAssignmentTaskPrefix(taskDescription: string): string {
  return taskDescription.trim().slice(0, WORK_ASSIGNMENT_DEDUP_PREFIX_LEN);
}

/**
 * Prevent duplicate-escalation cascades: many agents retrying the same blocked task.
 * - If 3+ prior failures for the same (assignee, task prefix), require founder escalation.
 * - If a non-terminal assignment already exists for the same key, block until resolved.
 */
export async function assertWorkAssignmentDispatchAllowed(args: {
  taskDescription: string;
  assignedTo: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const prefix = normalizeWorkAssignmentTaskPrefix(args.taskDescription);
  if (!prefix) {
    return { ok: true };
  }

  const [failedRow] = await systemQuery<{ c: number }>(
    `SELECT COUNT(*)::int AS c
     FROM work_assignments
     WHERE assigned_to = $1
       AND LEFT(TRIM(task_description), ${WORK_ASSIGNMENT_DEDUP_PREFIX_LEN}) = $2
       AND status = 'failed'`,
    [args.assignedTo, prefix],
  );
  const failedCount = failedRow?.c ?? 0;
  if (failedCount >= 3) {
    return {
      ok: false,
      error:
        'Assignment blocked — this task has failed 3+ times. Escalate to founders via create_decision rather than retrying.',
    };
  }

  const [openDup] = await systemQuery<{ id: string }>(
    `SELECT id
     FROM work_assignments
     WHERE assigned_to = $1
       AND LEFT(TRIM(task_description), ${WORK_ASSIGNMENT_DEDUP_PREFIX_LEN}) = $2
       AND status IN ('pending', 'dispatched', 'in_progress', 'blocked', 'needs_revision', 'draft')
     LIMIT 1`,
    [args.assignedTo, prefix],
  );
  if (openDup) {
    return {
      ok: false,
      error:
        `Duplicate assignment blocked — a similar task is already open for this assignee (assignment ${openDup.id}). Resolve or cancel it before creating another.`,
    };
  }

  return { ok: true };
}

/** Catch duplicate rows in a single batch insert (same assignee + same prefix). */
export function assertBatchWorkAssignmentsDeduped(
  items: Array<{ taskDescription: string; assignedTo: string }>,
): { ok: true } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (const it of items) {
    const p = normalizeWorkAssignmentTaskPrefix(it.taskDescription);
    const key = `${it.assignedTo}\0${p}`;
    if (seen.has(key)) {
      return {
        ok: false,
        error:
          'Batch contains duplicate assignments (same assignee and same task text prefix). Remove duplicates before dispatching.',
      };
    }
    seen.add(key);
  }
  return { ok: true };
}

import { systemQuery } from '@glyphor/shared/db';
import { WORKLOAD_WRAP_UP_TASKS } from './supervisorWorkloadStallPolicy.js';

/**
 * When a workload run stops on supervisor limits, queue a follow-up wake so the agent
 * can resume on the next heartbeat without manual re-dispatch.
 */
export async function enqueueWorkloadContinuationWakeIfBudgetHit(input: {
  agentRole: string;
  task: string;
  abortReason: string | undefined;
  runId: string;
}): Promise<void> {
  if (!WORKLOAD_WRAP_UP_TASKS.has(input.task)) return;
  const r = (input.abortReason ?? '').toLowerCase();
  if (
    !r.includes('max_turns') &&
    !r.includes('stalled') &&
    !r.includes('timeout')
  ) {
    return;
  }
  try {
    await systemQuery(
      `INSERT INTO agent_wake_queue (agent_role, task, reason, context, status) VALUES ($1,$2,$3,$4,$5)`,
      [
        input.agentRole,
        input.task,
        'continuation_after_budget',
        JSON.stringify({
          prior_run_id: input.runId,
          abort_reason: input.abortReason ?? null,
        }),
        'pending',
      ],
    );
    console.log(
      `[ContinuationWake] Queued ${input.agentRole} ${input.task} (reason=${input.abortReason ?? 'n/a'})`,
    );
  } catch (err) {
    console.warn('[ContinuationWake] enqueue failed:', (err as Error).message);
  }
}

import type { SupervisorConfig } from './types.js';

export const WORKLOAD_WRAP_UP_TASKS = new Set(['work_loop', 'proactive', 'process_assignments']);

/** Reactive wakes + urgent dispatches — same stall/read semantics as work_loop (not wrap-up maxTurns). */
export const REACTIVE_STALL_FLOOR_TASKS = new Set([
  'work_loop',
  'proactive',
  'process_assignments',
  'urgent_message_response',
  'incident_response',
  'event_message_sent',
  'heartbeat_response',
  'agent365_mail_triage',
]);

/**
 * Scheduled workload tasks (work_loop, proactive, process_assignments) should treat
 * successful read-only tool calls as progress so triage does not trip the stall
 * abort. Also raises the minimum consecutive no-progress turn cap.
 */
export function applyWorkloadReadsProgressAndStallFloor(config: SupervisorConfig): void {
  config.readsAsProgress = true;
  config.maxStallTurns = Math.max(config.maxStallTurns, 6);
}

/**
 * Adds one supervisor turn so the last numbered turn can still use tools; the following
 * turn strips tools for text-only wrap-up (matches an extra "grace" model round).
 */
export function reserveSupervisorWrapUpTurnForWorkload(
  supervisor: { config: SupervisorConfig },
  task: string,
): void {
  if (!WORKLOAD_WRAP_UP_TASKS.has(task)) return;
  supervisor.config.maxTurns += 1;
}

import type { SupervisorConfig } from './types.js';

/**
 * Scheduled workload tasks (work_loop, proactive, process_assignments) should treat
 * successful read-only tool calls as progress so triage does not trip the stall
 * abort. Also raises the minimum consecutive no-progress turn cap.
 */
export function applyWorkloadReadsProgressAndStallFloor(config: SupervisorConfig): void {
  config.readsAsProgress = true;
  config.maxStallTurns = Math.max(config.maxStallTurns, 6);
}

import { describe, expect, it } from 'vitest';
import {
  REACTIVE_AGENT_TASK_TURN_FLOOR,
  REACTIVE_WORKLOAD_SUPERVISOR_TIMEOUT_MS,
  effectiveMaxTurnsForReactiveTask,
  supervisorTimeoutMsForReactiveWorkload,
} from '../reactiveTurnBudget.js';

describe('reactiveTurnBudget', () => {
  it('raises work_loop turn floor', () => {
    expect(effectiveMaxTurnsForReactiveTask('work_loop', 15)).toBeGreaterThanOrEqual(REACTIVE_AGENT_TASK_TURN_FLOOR);
    expect(REACTIVE_AGENT_TASK_TURN_FLOOR).toBeGreaterThanOrEqual(40);
  });

  it('extends supervisor timeout for reactive workload tasks', () => {
    expect(supervisorTimeoutMsForReactiveWorkload('work_loop', 300_000)).toBe(REACTIVE_WORKLOAD_SUPERVISOR_TIMEOUT_MS);
    expect(supervisorTimeoutMsForReactiveWorkload('process_assignments', 300_000)).toBe(
      REACTIVE_WORKLOAD_SUPERVISOR_TIMEOUT_MS,
    );
    expect(supervisorTimeoutMsForReactiveWorkload('platform_health_check', 300_000)).toBe(300_000);
  });
});

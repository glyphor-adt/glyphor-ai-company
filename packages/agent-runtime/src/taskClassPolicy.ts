/**
 * Task-class policy — single source of truth for "matrix" rows that must affect runtime.
 *
 * Reactive-light: urgent peer/founder replies and similar paths should behave like
 * dashboard chat for protocol weight and tool gates (see docs/TASK-CLASS-PROTOCOL-MATRIX.md).
 */

/** Scheduler `task` values that use chat-light protocols + relaxed pre-exec value gate (default). */
export const REACTIVE_LIGHT_TASKS = new Set<string>([
  'urgent_message_response',
  'incident_response',
  'event_message_sent',
]);

export function isReactiveLightTask(task: string): boolean {
  return REACTIVE_LIGHT_TASKS.has(task);
}

/** Default: skip pre-exec value gate for reactive-light tasks (set to `enforce` to keep gate). */
export function shouldSkipValueGateForReactiveLightTask(): boolean {
  const v = process.env.TOOL_VALUE_GATE_REACTIVE_LIGHT?.trim().toLowerCase();
  if (v === 'enforce') return false;
  return true;
}

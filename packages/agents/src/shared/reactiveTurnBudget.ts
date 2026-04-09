/**
 * Minimum LLM turn budget for scheduled / reactive tasks (work_loop, wakes, events).
 * Low company_agents.max_turns caused max_turns_exceeded before agents finished tool chains.
 *
 * Omit `on_demand` here — CompanyAgentRunner clamps chat with ON_DEMAND_MAX_TURNS separately.
 */

export const REACTIVE_AGENT_TASK_TURN_FLOOR = 28;

const REACTIVE_TASK_IDS = new Set<string>([
  'work_loop',
  'proactive',
  'urgent_message_response',
  'incident_response',
  'event_message_sent',
  'heartbeat_response',
  'orchestrate',
  'strategic_planning',
  'process_directive',
]);

export function isReactiveAgentTask(task: string | undefined): boolean {
  const t = (task ?? '').trim();
  if (!t) return false;
  return REACTIVE_TASK_IDS.has(t) || t.startsWith('event_');
}

/** Raise loaded maxTurns when task is reactive; otherwise leave unchanged. */
export function effectiveMaxTurnsForReactiveTask(task: string | undefined, loadedMax: number): number {
  if (!isReactiveAgentTask(task)) return loadedMax;
  return Math.max(loadedMax, REACTIVE_AGENT_TASK_TURN_FLOOR);
}

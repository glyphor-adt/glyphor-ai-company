/**
 * Minimum LLM turn budget for scheduled / reactive tasks (work_loop, wakes, events).
 * Low company_agents.max_turns caused max_turns_exceeded before agents finished tool chains.
 *
 * Omit `on_demand` here — CompanyAgentRunner clamps chat with ON_DEMAND_MAX_TURNS separately.
 */

export const REACTIVE_AGENT_TASK_TURN_FLOOR = 40;

/**
 * Inter-agent urgent wakes must answer quickly; a 40-turn ceiling matches long work_loop
 * budgets and encourages "think forever" without tools. Keep this low.
 */
export const URGENT_MESSAGE_RESPONSE_MAX_TURNS = 22;

/** Wall-clock ceiling for scheduled reactive runs (thinking models + deep tool chains). */
export const REACTIVE_WORKLOAD_SUPERVISOR_TIMEOUT_MS = 900_000;

const REACTIVE_TASK_IDS = new Set<string>([
  'work_loop',
  'proactive',
  'urgent_message_response',
  'incident_response',
  'event_message_sent',
  'heartbeat_response',
  /** Heartbeat-driven Agent365 mailbox triage (same budget needs as work_loop). */
  'agent365_mail_triage',
  'orchestrate',
  'strategic_planning',
  'process_directive',
  /** CMO / marketing assignment sweeps — same tool-chain depth as work_loop. */
  'process_assignments',
]);

export function isReactiveAgentTask(task: string | undefined): boolean {
  const t = (task ?? '').trim().toLowerCase();
  if (!t) return false;
  return REACTIVE_TASK_IDS.has(t) || t.startsWith('event_');
}

/** Raise loaded maxTurns when task is reactive; otherwise leave unchanged. */
export function effectiveMaxTurnsForReactiveTask(task: string | undefined, loadedMax: number): number {
  const n = Math.floor(Number(loadedMax));
  const valid = Number.isFinite(n) && n > 0 ? n : null;
  if (!isReactiveAgentTask(task)) {
    // Invalid values become a conservative default; AgentSupervisor also enforces min 1.
    return valid ?? 15;
  }
  const floor = REACTIVE_AGENT_TASK_TURN_FLOOR;
  const raised = Math.max(valid ?? floor, floor);
  if (task === 'urgent_message_response') {
    return Math.min(raised, URGENT_MESSAGE_RESPONSE_MAX_TURNS);
  }
  return raised;
}

/** Use for agent run configs so heartbeat/work_loop does not hit 5m timeout before turn budget. */
export function supervisorTimeoutMsForReactiveWorkload(
  task: string | undefined,
  fallbackMs: number,
): number {
  const t = (task ?? '').trim().toLowerCase();
  if (!t || !isReactiveAgentTask(t)) return fallbackMs;
  return Math.max(fallbackMs, REACTIVE_WORKLOAD_SUPERVISOR_TIMEOUT_MS);
}

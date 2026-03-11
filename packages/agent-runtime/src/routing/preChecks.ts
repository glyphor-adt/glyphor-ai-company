import type { ConversationTurn } from '../types.js';

export interface DeterministicPreCheckContext {
  role: string;
  task: string;
  message: string;
  history: ConversationTurn[];
}

export interface DeterministicPreCheckResult {
  shouldCallLLM: boolean;
  reason: string;
  context?: string;
}

export type DeterministicPreCheck = (context: DeterministicPreCheckContext) => DeterministicPreCheckResult | Promise<DeterministicPreCheckResult>;

const blankMessagePreCheck: DeterministicPreCheck = ({ task }) => ({
  shouldCallLLM: false,
  reason: `Skipped ${task} because no user message or task payload was provided.`,
});

const SCHEDULED_TEMPLATE_HINT = /\bsteps:\s*1\.|\bperform\b|\bgenerate\b|\bcheck\b|\bscan\b/i;

function shouldCallForScheduledTemplate(task: string, message: string): DeterministicPreCheckResult {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return {
      shouldCallLLM: false,
      reason: `Skipped ${task} because no contextual payload was provided.`,
    };
  }

  if (/\bevent payload\b/i.test(trimmed) && !/\{\s*\}/.test(trimmed)) {
    return {
      shouldCallLLM: true,
      reason: `${task} includes an explicit event payload context.`,
    };
  }

  if (SCHEDULED_TEMPLATE_HINT.test(trimmed)) {
    return {
      shouldCallLLM: false,
      reason: `${task} matched a scheduled template with no explicit incident payload.`,
    };
  }

  return {
    shouldCallLLM: true,
    reason: `${task} includes non-template contextual input.`,
  };
}

export const PRE_CHECK_REGISTRY: Record<string, DeterministicPreCheck> = {
  on_demand: ({ message }) => (
    message.trim().length === 0
      ? blankMessagePreCheck({ role: 'unknown', task: 'on_demand', message, history: [] })
      : { shouldCallLLM: true, reason: 'Interactive request contains user input.' }
  ),
  health_check: ({ task, message }) => shouldCallForScheduledTemplate(task, message),
  freshness_check: ({ task, message }) => shouldCallForScheduledTemplate(task, message),
  cost_check: ({ task, message }) => shouldCallForScheduledTemplate(task, message),
  daily_cost_check: ({ task, message }) => shouldCallForScheduledTemplate(task, message),
  triage_queue: ({ task, message }) => shouldCallForScheduledTemplate(task, message),
  platform_health_check: ({ task, message }) => shouldCallForScheduledTemplate(task, message),
};

const PRECHECK_TASK_ALIASES: Record<string, string> = {
  ops_health_check: 'health_check',
  daily_cost_check: 'cost_check',
};

export async function runDeterministicPreCheck(
  context: DeterministicPreCheckContext,
): Promise<DeterministicPreCheckResult> {
  const normalizedTask = PRECHECK_TASK_ALIASES[context.task] ?? context.task;
  const preCheck = PRE_CHECK_REGISTRY[normalizedTask];
  if (!preCheck) {
    return {
      shouldCallLLM: true,
      reason: `No deterministic pre-check registered for ${context.task}.`,
    };
  }
  return await preCheck({ ...context, task: normalizedTask });
}

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

export const PRE_CHECK_REGISTRY: Record<string, DeterministicPreCheck> = {
  on_demand: ({ message }) => (
    message.trim().length === 0
      ? blankMessagePreCheck({ role: 'unknown', task: 'on_demand', message, history: [] })
      : { shouldCallLLM: true, reason: 'Interactive request contains user input.' }
  ),
  health_check: ({ message }) => (
    message.trim().length === 0
      ? { shouldCallLLM: false, reason: 'Health check can be skipped when no incident or directive context is supplied.' }
      : { shouldCallLLM: true, reason: 'Health check includes contextual input.' }
  ),
  freshness_check: ({ message }) => (
    message.trim().length === 0
      ? { shouldCallLLM: false, reason: 'Freshness check can be skipped when no source scope is supplied.' }
      : { shouldCallLLM: true, reason: 'Freshness check includes contextual input.' }
  ),
};

export async function runDeterministicPreCheck(
  context: DeterministicPreCheckContext,
): Promise<DeterministicPreCheckResult> {
  const preCheck = PRE_CHECK_REGISTRY[context.task];
  if (!preCheck) {
    return {
      shouldCallLLM: true,
      reason: `No deterministic pre-check registered for ${context.task}.`,
    };
  }
  return await preCheck(context);
}

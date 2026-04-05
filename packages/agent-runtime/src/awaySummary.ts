/**
 * Away Summary Generator — Session Resumption Recap
 *
 * Generates a concise 1-3 sentence summary of where an agent left off
 * when resuming after an idle period. Uses a fast model (no tools, no
 * thinking) to minimize latency.
 *
 * Inspired by Claude Code's awaySummary service:
 *   - Truncates history to last N messages (avoids token limits)
 *   - Optionally prepends session memory for broader context
 *   - Uses fast/cheap model (gemini-2.0-flash)
 *   - Returns null on any failure (fail-open)
 *   - Supports abort signals for cancellation
 *
 * Usage:
 *
 *   const summary = await generateAwaySummary({
 *     messages: conversationHistory,
 *     agentRole: 'devops-engineer',
 *     conversationId: 'run-2026-04-05',
 *   }, modelClient);
 *
 *   if (summary) {
 *     console.log(`Recap: ${summary}`);
 *   }
 */

import type { ModelClient } from './modelClient.js';
import type { ConversationTurn, CompanyAgentRole } from './types.js';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface AwaySummaryConfig {
  /** Number of recent messages to include (default: 30). */
  recentMessageWindow?: number;
  /** Max output tokens for the summary (default: 150). */
  maxTokens?: number;
  /** Model to use — should be fast and cheap (default: 'gemini-2.0-flash'). */
  model?: string;
  /** Sampling temperature (default: 0.3 — prefer deterministic). */
  temperature?: number;
  /** Feature toggle (default: true). */
  enabled?: boolean;
}

export interface AwaySummaryInput {
  /** Conversation history to summarize. */
  messages: ConversationTurn[];
  /** Agent's role (for observability and prompt tailoring). */
  agentRole: CompanyAgentRole;
  /** Broader session context from SessionMemoryStore (optional). */
  sessionMemory?: string | null;
  /** Conversation/run ID for tracing. */
  conversationId: string;
}

export interface AwaySummaryResult {
  /** The generated summary text, or null if generation failed/was skipped. */
  summary: string | null;
  /** Why this result was produced. */
  reason: 'generated' | 'disabled' | 'no_messages' | 'aborted' | 'error';
  /** Model used (if generated). */
  model?: string;
  /** Token usage (if generated). */
  usage?: { inputTokens: number; outputTokens: number };
  /** Generation time in ms (if generated). */
  durationMs?: number;
}

// ═══════════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_MESSAGE_WINDOW = 30;
const DEFAULT_MAX_TOKENS = 150;
const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_TEMPERATURE = 0.3;

// ═══════════════════════════════════════════════════════════════════
// PROMPT
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the system prompt for away summary generation.
 * Keeps it focused: high-level task + concrete next step.
 */
export function buildAwaySummaryPrompt(sessionMemory?: string | null): string {
  const memoryBlock = sessionMemory
    ? `Session context (broader scope):\n${sessionMemory}\n\n`
    : '';

  return (
    `${memoryBlock}` +
    'The agent was idle and is resuming. Write exactly 1-3 short sentences.\n' +
    'Start by stating the high-level task — what they are building, debugging, ' +
    'or working on (not implementation details).\n' +
    'Then state the concrete next step.\n' +
    'Skip status reports, commit recaps, and technical minutiae.'
  );
}

// ═══════════════════════════════════════════════════════════════════
// GENERATOR
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a concise away summary for an agent session.
 *
 * Returns an `AwaySummaryResult` with the summary text (or null)
 * and metadata about how the result was produced.
 *
 * Fail-open: never throws. Returns null summary on any error.
 */
export async function generateAwaySummary(
  input: AwaySummaryInput,
  modelClient: ModelClient,
  config: AwaySummaryConfig = {},
  signal?: AbortSignal,
): Promise<AwaySummaryResult> {
  const {
    recentMessageWindow = DEFAULT_MESSAGE_WINDOW,
    maxTokens = DEFAULT_MAX_TOKENS,
    model = DEFAULT_MODEL,
    temperature = DEFAULT_TEMPERATURE,
    enabled = true,
  } = config;

  // Gate checks
  if (!enabled) {
    return { summary: null, reason: 'disabled' };
  }

  if (input.messages.length === 0) {
    return { summary: null, reason: 'no_messages' };
  }

  if (signal?.aborted) {
    return { summary: null, reason: 'aborted' };
  }

  const startMs = Date.now();

  try {
    // 1. Truncate to recent window
    const recent = input.messages.slice(-recentMessageWindow);

    // 2. Build prompt
    const systemPrompt = buildAwaySummaryPrompt(input.sessionMemory);

    // 3. Call fast model (no tools, no thinking)
    const response = await modelClient.generate({
      model,
      systemInstruction: systemPrompt,
      contents: recent,
      tools: [],
      temperature,
      maxTokens,
      thinkingEnabled: false,
      metadata: {
        agentRole: input.agentRole,
        runId: input.conversationId,
      },
      signal,
    });

    // 4. Extract text
    const text = response.text?.trim() ?? '';
    const durationMs = Date.now() - startMs;

    if (text.length === 0) {
      return { summary: null, reason: 'error', model, durationMs };
    }

    return {
      summary: text,
      reason: 'generated',
      model: response.actualModel ?? model,
      usage: {
        inputTokens: response.usageMetadata.inputTokens,
        outputTokens: response.usageMetadata.outputTokens,
      },
      durationMs,
    };
  } catch (err) {
    if (signal?.aborted) {
      return { summary: null, reason: 'aborted' };
    }
    console.warn(
      '[AwaySummary] Generation failed:',
      (err as Error).message,
    );
    return {
      summary: null,
      reason: 'error',
      durationMs: Date.now() - startMs,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// IDLE DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Determine if enough time has passed since the last activity to
 * warrant generating an away summary on the next run.
 *
 * @param lastActivityAt - ISO timestamp or epoch ms of last activity
 * @param thresholdMs    - Minimum idle time (default: 5 minutes)
 */
export function isIdleLongEnough(
  lastActivityAt: string | number | null | undefined,
  thresholdMs = 5 * 60 * 1000,
): boolean {
  if (!lastActivityAt) return false;

  const lastMs = typeof lastActivityAt === 'number'
    ? lastActivityAt
    : Date.parse(lastActivityAt);

  if (!Number.isFinite(lastMs)) return false;

  return Date.now() - lastMs >= thresholdMs;
}

/**
 * Check whether a conversation already contains an away summary
 * since the last user/assistant exchange, preventing duplicates.
 */
export function hasRecentAwaySummary(
  messages: ConversationTurn[],
  marker = '[AWAY SUMMARY',
): boolean {
  // Walk backwards from the end
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    // Check for the marker first — the summary turn may have role 'user'
    if (msg.content.includes(marker)) {
      return true;
    }
    // If we hit a real user or assistant turn, stop — no summary since last exchange
    if (msg.role === 'user' || msg.role === 'assistant') {
      return false;
    }
  }
  return false;
}

/**
 * Format an away summary as a context injection turn.
 * Returns a ConversationTurn suitable for prepending to conversation history.
 */
export function formatAwaySummaryTurn(summary: string): ConversationTurn {
  return {
    role: 'user',
    content: `[AWAY SUMMARY — Do NOT respond to this directly]\n\nWhere you left off:\n${summary}`,
    timestamp: Date.now(),
  };
}

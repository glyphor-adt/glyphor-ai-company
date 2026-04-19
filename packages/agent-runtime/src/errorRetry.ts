/**
 * Error Categorization & Smart Retry — Pattern 11 (from Claude Code's withRetry)
 *
 * Provides structured error classification, exponential backoff with jitter,
 * Retry-After header awareness, consecutive-overload tracking with model
 * fallback triggers, and persistent retry mode for autonomous agents.
 *
 * Usage:
 *   const policy = getRetryPolicy('executive');
 *   const ctx = createRetryContext(policy);
 *   const result = await withSmartRetry(ctx, () => modelClient.generate(req));
 *
 * Key differences from Glyphor's existing ModelClient retry:
 *   - Exponential backoff with 25% jitter (not linear 2s×n)
 *   - Configurable per agent-tier (executive, task, on-demand, background)
 *   - Consecutive overload tracking → model fallback trigger
 *   - Persistent mode for unattended agents (infinite retry with heartbeats)
 *   - 4-category error taxonomy for observability
 *
 * Source inspiration: Claude Code src/services/api/withRetry.ts
 */

// ─── Error Categories ────────────────────────────────────────

/**
 * Four-category error taxonomy.
 *
 *   rate_limit        – 429, "quota", "too many requests", "resource exhausted"
 *   overloaded        – 529, "overloaded", "capacity"
 *   auth_failed       – 401, 403, "token revoked", "invalid key"
 *   context_overflow  – 400 with "context length", "token limit exceeded"
 *   server_error      – 500, 502, 503, 5xx (not 529)
 *   client_error      – 400, 404, 422 (not context overflow / not quota)
 *   transient         – ECONNRESET, EPIPE, ETIMEDOUT, AbortError
 *   unknown           – anything else
 */
export type ErrorCategory =
  | 'rate_limit'
  | 'overloaded'
  | 'auth_failed'
  | 'context_overflow'
  | 'server_error'
  | 'client_error'
  | 'transient'
  | 'unknown';

export interface CategorizedError {
  category: ErrorCategory;
  retryable: boolean;
  /** Parsed Retry-After value in ms, if present */
  retryAfterMs: number | null;
  /** HTTP status code, if available */
  statusCode: number | null;
  /** Original error message (sanitized — no API keys) */
  message: string;
  /** Original error for re-throw */
  originalError: unknown;
}

// ─── Patterns ────────────────────────────────────────────────

const RATE_LIMIT_PATTERN = /429|rate.?limit|quota|resource.?exhausted|too many requests/i;
const OVERLOADED_PATTERN = /529|overloaded|capacity/i;
const AUTH_PATTERN = /401|403|token.?revoked|invalid.?key|unauthorized|forbidden/i;
// Model-level access denial (Bedrock "not available for this account") — NOT a provider-wide auth failure.
// Classified as client_error so the fallback chain skips this model and tries the next.
const MODEL_ACCESS_DENIED_PATTERN = /not available for this account|model.?not.?available|access.?not.?granted|model.?access.?denied/i;
const CONTEXT_OVERFLOW_PATTERN = /context.?length|token.?limit.?exceeded|input.?length.*exceed|prompt.?too.?long/i;
const TRANSIENT_PATTERN = /ECONNRESET|EPIPE|ETIMEDOUT|socket hang up|network|fetch failed/i;
const STATUS_CODE_PATTERN = /\b([45]\d{2})\b/;
const API_KEY_PATTERN = /sk-ant-[a-zA-Z0-9_-]+|sk-[a-zA-Z0-9_-]{20,}|AIza[a-zA-Z0-9_-]+/g;

/**
 * Classify an error into one of the error categories.
 * Extracts HTTP status, Retry-After header, and determines retryability.
 */
export function categorizeError(error: unknown): CategorizedError {
  const rawMsg = error instanceof Error ? error.message : String(error);
  const message = rawMsg.replace(API_KEY_PATTERN, '[REDACTED]');
  const statusCode = extractStatusCode(error);
  const retryAfterMs = extractRetryAfterMs(error);

  // Model-level access denial (e.g. Bedrock "not available for this account") — treat as
  // a model-specific client error so the fallback chain skips this model, not the whole provider.
  if (MODEL_ACCESS_DENIED_PATTERN.test(message)) {
    return { category: 'client_error', retryable: false, retryAfterMs: null, statusCode: statusCode ?? 403, message, originalError: error };
  }

  // Auth errors are NOT retryable (reauth required)
  if (statusCode === 401 || statusCode === 403 || AUTH_PATTERN.test(message)) {
    // But not if it's a quota 403
    if (!RATE_LIMIT_PATTERN.test(message)) {
      return { category: 'auth_failed', retryable: false, retryAfterMs, statusCode, message, originalError: error };
    }
  }

  // Rate limit — retryable with backoff
  if (statusCode === 429 || (RATE_LIMIT_PATTERN.test(message) && statusCode !== 529)) {
    return { category: 'rate_limit', retryable: true, retryAfterMs, statusCode: statusCode ?? 429, message, originalError: error };
  }

  // Overloaded — retryable but triggers fallback after consecutive hits
  if (statusCode === 529 || OVERLOADED_PATTERN.test(message)) {
    return { category: 'overloaded', retryable: true, retryAfterMs, statusCode: statusCode ?? 529, message, originalError: error };
  }

  // Context overflow — not retryable at this layer (handled by reactive compaction in runner)
  if (statusCode === 413 || CONTEXT_OVERFLOW_PATTERN.test(message)) {
    return { category: 'context_overflow', retryable: false, retryAfterMs: null, statusCode: statusCode ?? 400, message, originalError: error };
  }

  // Transient network errors — retryable (check BEFORE status code from message,
  // because messages like 'connect ETIMEDOUT 1.2.3.4:443' would match 443 as a status code)
  if (TRANSIENT_PATTERN.test(message)) {
    return { category: 'transient', retryable: true, retryAfterMs: null, statusCode: null, message, originalError: error };
  }

  // Non-quota client errors — not retryable
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return { category: 'client_error', retryable: false, retryAfterMs: null, statusCode, message, originalError: error };
  }

  // Server errors — retryable
  if (statusCode && statusCode >= 500) {
    return { category: 'server_error', retryable: true, retryAfterMs, statusCode, message, originalError: error };
  }

  return { category: 'unknown', retryable: false, retryAfterMs: null, statusCode, message, originalError: error };
}

// ─── Retry Delay Calculation ─────────────────────────────────

/** Base delay for exponential backoff (ms). */
export const BASE_DELAY_MS = 500;

/** Maximum backoff for normal mode. */
export const DEFAULT_MAX_BACKOFF_MS = 32_000;

/** Maximum backoff for persistent (autonomous) mode. */
export const PERSISTENT_MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

/** Heartbeat interval in persistent mode to keep the process alive. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Consecutive overloaded errors before triggering model fallback. */
export const MAX_CONSECUTIVE_OVERLOADED = 3;

/**
 * Calculate retry delay with exponential backoff + jitter.
 * If Retry-After header was parsed, use it (capped at maxDelayMs).
 *
 * Formula: min(BASE_DELAY_MS × 2^(attempt-1), maxDelayMs) + random(0..25% of base)
 */
export function calculateRetryDelay(
  attempt: number,
  retryAfterMs: number | null,
  maxDelayMs = DEFAULT_MAX_BACKOFF_MS,
): number {
  // Honor Retry-After from the server — the server knows best
  if (retryAfterMs !== null && retryAfterMs > 0) {
    return Math.min(retryAfterMs, maxDelayMs);
  }

  const baseDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), maxDelayMs);
  // Add 0-25% jitter to avoid thundering herd
  const jitter = Math.random() * 0.25 * baseDelay;
  return Math.round(baseDelay + jitter);
}

// ─── Retry Policy ────────────────────────────────────────────

/**
 * Agent tiers determine retry aggressiveness.
 *
 *   executive   – C-suite agents (CTO, CFO, etc.), high retry budget
 *   task        – Task-tier workers, moderate retry budget
 *   on_demand   – Interactive chat, lower retry budget (user is waiting)
 *   background  – Background jobs (summaries, classifiers), minimal retries
 */
export type RetryTier = 'executive' | 'task' | 'on_demand' | 'background';

export interface RetryPolicy {
  /** Agent tier this policy applies to. */
  tier: RetryTier;
  /** Maximum retry attempts before giving up. */
  maxRetries: number;
  /** Maximum backoff delay per attempt (ms). */
  maxBackoffMs: number;
  /**
   * Enable persistent mode for autonomous agents.
   * When true, 429/529 retries continue indefinitely with heartbeats.
   */
  persistent: boolean;
  /** Whether to trigger model fallback after MAX_CONSECUTIVE_OVERLOADED. */
  enableOverloadFallback: boolean;
}

const RETRY_POLICIES: Record<RetryTier, RetryPolicy> = {
  executive: {
    tier: 'executive',
    maxRetries: 8,
    maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
    persistent: true,
    enableOverloadFallback: true,
  },
  task: {
    tier: 'task',
    maxRetries: 6,
    maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
    persistent: true,
    enableOverloadFallback: true,
  },
  on_demand: {
    tier: 'on_demand',
    maxRetries: 4,
    maxBackoffMs: 16_000,
    persistent: false,
    enableOverloadFallback: true,
  },
  background: {
    tier: 'background',
    maxRetries: 2,
    maxBackoffMs: 8_000,
    persistent: false,
    enableOverloadFallback: false,
  },
};

/** Get the retry policy for a given agent tier. */
export function getRetryPolicy(tier: RetryTier): RetryPolicy {
  return RETRY_POLICIES[tier];
}

// ─── Retry Context & State ───────────────────────────────────

export interface RetryState {
  /** Current attempt number (1-based). */
  attempt: number;
  /** Consecutive overloaded (529) errors. */
  consecutiveOverloaded: number;
  /** Total time spent waiting (ms). */
  totalWaitMs: number;
  /** Timestamp when retry loop started. */
  startedAt: number;
  /** Last categorized error, if any. */
  lastError: CategorizedError | null;
  /** Whether model fallback was triggered. */
  fallbackTriggered: boolean;
}

export function createRetryState(): RetryState {
  return {
    attempt: 0,
    consecutiveOverloaded: 0,
    totalWaitMs: 0,
    startedAt: Date.now(),
    lastError: null,
    fallbackTriggered: false,
  };
}

// ─── Retry Event (for observability) ─────────────────────────

export interface RetryEvent {
  type: 'retry_attempt' | 'retry_exhausted' | 'retry_fallback' | 'retry_success';
  tier: RetryTier;
  attempt: number;
  category: ErrorCategory;
  delayMs: number;
  totalWaitMs: number;
  model?: string;
  fallbackModel?: string;
  message?: string;
}

/**
 * Callback for retry events. Allows callers to plug in telemetry/logging.
 */
export type RetryEventHandler = (event: RetryEvent) => void;

// ─── Model Fallback Error ────────────────────────────────────

/**
 * Thrown when consecutive overloaded errors exceed the threshold.
 * The caller (ModelClient) should catch this and switch to fallbackModel.
 */
export class ModelFallbackTriggeredError extends Error {
  constructor(
    public readonly originalModel: string,
    public readonly consecutiveOverloaded: number,
  ) {
    super(`Model fallback triggered after ${consecutiveOverloaded} consecutive overloaded errors on ${originalModel}`);
    this.name = 'ModelFallbackTriggeredError';
  }
}

/**
 * Thrown when all retries are exhausted for a non-persistent policy.
 */
export class RetriesExhaustedError extends Error {
  public readonly lastCategorizedError: CategorizedError;
  public readonly state: RetryState;

  constructor(categorized: CategorizedError, state: RetryState) {
    super(`Retries exhausted after ${state.attempt} attempts (${categorized.category}): ${categorized.message}`);
    this.name = 'RetriesExhaustedError';
    this.lastCategorizedError = categorized;
    this.state = state;
  }
}

// ─── Core Retry Engine ───────────────────────────────────────

export interface SmartRetryOptions {
  policy: RetryPolicy;
  /** Model name for telemetry/fallback tracking. */
  model?: string;
  /** AbortSignal to cancel the retry loop. */
  signal?: AbortSignal;
  /** Called on each retry event (for telemetry, logging). */
  onRetryEvent?: RetryEventHandler;
  /**
   * Heartbeat callback in persistent mode. Called every HEARTBEAT_INTERVAL_MS
   * during long waits so the host process doesn't mark the session idle.
   */
  onHeartbeat?: () => void;
  /**
   * Pre-seed the consecutive overloaded counter (for continuity between
   * streaming and non-streaming paths, same as Claude Code's approach).
   */
  initialConsecutiveOverloaded?: number;
}

/**
 * Execute an async operation with smart retry logic.
 *
 * - Classifies each error into the 4-category taxonomy
 * - Uses exponential backoff + jitter, honoring Retry-After headers
 * - Tracks consecutive 529s and throws ModelFallbackTriggeredError at threshold
 * - In persistent mode, retries 429/529 indefinitely with heartbeat callbacks
 * - Emits RetryEvents for observability
 *
 * @returns The result of the operation on success
 * @throws ModelFallbackTriggeredError if consecutive overloads hit threshold
 * @throws RetriesExhaustedError if all retries exhausted (non-persistent)
 * @throws The original error if non-retryable
 */
export async function withSmartRetry<T>(
  options: SmartRetryOptions,
  operation: (attempt: number) => Promise<T>,
): Promise<T> {
  const { policy, signal, onRetryEvent, onHeartbeat } = options;
  const state = createRetryState();
  state.consecutiveOverloaded = options.initialConsecutiveOverloaded ?? 0;

  // In persistent mode, we loop beyond maxRetries for 429/529
  const effectiveMaxAttempts = policy.maxRetries + 1;

  for (let attempt = 1; attempt <= effectiveMaxAttempts || policy.persistent; attempt++) {
    if (signal?.aborted) {
      throw new Error('Aborted: signal aborted');
    }

    state.attempt = attempt;

    try {
      const result = await operation(attempt);

      // Success — reset consecutive overloaded counter and emit success event
      if (attempt > 1 && onRetryEvent) {
        onRetryEvent({
          type: 'retry_success',
          tier: policy.tier,
          attempt,
          category: state.lastError?.category ?? 'unknown',
          delayMs: 0,
          totalWaitMs: state.totalWaitMs,
          model: options.model,
        });
      }

      return result;
    } catch (error) {
      const categorized = categorizeError(error);
      state.lastError = categorized;

      // ── Non-retryable errors: throw immediately ──
      if (!categorized.retryable) {
        throw error;
      }

      // ── Track consecutive overloaded (529) errors ──
      if (categorized.category === 'overloaded') {
        state.consecutiveOverloaded++;

        if (
          policy.enableOverloadFallback &&
          state.consecutiveOverloaded >= MAX_CONSECUTIVE_OVERLOADED
        ) {
          state.fallbackTriggered = true;
          if (onRetryEvent) {
            onRetryEvent({
              type: 'retry_fallback',
              tier: policy.tier,
              attempt,
              category: 'overloaded',
              delayMs: 0,
              totalWaitMs: state.totalWaitMs,
              model: options.model,
            });
          }
          throw new ModelFallbackTriggeredError(
            options.model ?? 'unknown',
            state.consecutiveOverloaded,
          );
        }
      } else {
        // Reset consecutive overloaded on non-529 error
        state.consecutiveOverloaded = 0;
      }

      // ── Check if we've exhausted retries (non-persistent) ──
      const isPersistentEligible =
        policy.persistent &&
        (categorized.category === 'rate_limit' || categorized.category === 'overloaded');

      if (attempt >= effectiveMaxAttempts && !isPersistentEligible) {
        if (onRetryEvent) {
          onRetryEvent({
            type: 'retry_exhausted',
            tier: policy.tier,
            attempt,
            category: categorized.category,
            delayMs: 0,
            totalWaitMs: state.totalWaitMs,
            model: options.model,
            message: categorized.message,
          });
        }
        throw new RetriesExhaustedError(categorized, state);
      }

      // ── Calculate delay ──
      const maxBackoff = isPersistentEligible
        ? PERSISTENT_MAX_BACKOFF_MS
        : policy.maxBackoffMs;
      const delayMs = calculateRetryDelay(attempt, categorized.retryAfterMs, maxBackoff);
      state.totalWaitMs += delayMs;

      if (onRetryEvent) {
        onRetryEvent({
          type: 'retry_attempt',
          tier: policy.tier,
          attempt,
          category: categorized.category,
          delayMs,
          totalWaitMs: state.totalWaitMs,
          model: options.model,
          message: categorized.message,
        });
      }

      // ── Sleep with heartbeats for persistent mode ──
      if (isPersistentEligible && delayMs > HEARTBEAT_INTERVAL_MS) {
        let remaining = delayMs;
        while (remaining > 0) {
          if (signal?.aborted) throw new Error('Aborted: signal aborted');
          const chunk = Math.min(remaining, HEARTBEAT_INTERVAL_MS);
          await sleep(chunk);
          remaining -= chunk;
          if (remaining > 0 && onHeartbeat) {
            onHeartbeat();
          }
        }
      } else {
        await sleep(delayMs);
      }

      // In persistent mode, clamp attempt so the for-loop doesn't terminate.
      // The separate state.attempt counter keeps growing for telemetry.
      if (isPersistentEligible && attempt >= effectiveMaxAttempts) {
        attempt = effectiveMaxAttempts - 1; // will be incremented to effectiveMaxAttempts by for-loop
      }
    }
  }

  // Should never reach here (persistent mode loops forever,
  // non-persistent throws RetriesExhaustedError above)
  throw new RetriesExhaustedError(
    state.lastError ?? categorizeError(new Error('Unknown retry termination')),
    state,
  );
}

// ─── Helpers ─────────────────────────────────────────────────

function extractStatusCode(error: unknown): number | null {
  // APIError-style: error.status
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e.status === 'number') return e.status;
    if (typeof e.statusCode === 'number') return e.statusCode;
  }
  // Extract from message: "429 Too Many Requests", "[429]", "status 429"
  if (error instanceof Error) {
    const match = error.message.match(STATUS_CODE_PATTERN);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

function extractRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as Record<string, unknown>;

  // Check error.headers (APIError from Anthropic SDK, fetch responses)
  let retryAfterRaw: string | null = null;

  if (e.headers && typeof e.headers === 'object') {
    const headers = e.headers as Record<string, unknown>;
    // Direct property access
    if (typeof headers['retry-after'] === 'string') {
      retryAfterRaw = headers['retry-after'];
    }
    // Headers.get() method (Web API Headers)
    if (!retryAfterRaw && typeof (headers as { get?: Function }).get === 'function') {
      const val = (headers as { get: (key: string) => string | null }).get('retry-after');
      if (typeof val === 'string') retryAfterRaw = val;
    }
  }

  if (!retryAfterRaw) return null;

  // Try parsing as seconds (integer)
  const seconds = parseInt(retryAfterRaw, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // Try parsing as HTTP date
  const date = new Date(retryAfterRaw);
  if (!isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return delayMs > 0 ? delayMs : null;
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

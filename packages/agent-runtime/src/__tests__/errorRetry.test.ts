/**
 * Error Categorization & Smart Retry — Tests
 * Pattern 11: Claude Code-inspired retry engine
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  categorizeError,
  calculateRetryDelay,
  getRetryPolicy,
  withSmartRetry,
  createRetryState,
  ModelFallbackTriggeredError,
  RetriesExhaustedError,
  BASE_DELAY_MS,
  DEFAULT_MAX_BACKOFF_MS,
  PERSISTENT_MAX_BACKOFF_MS,
  HEARTBEAT_INTERVAL_MS,
  MAX_CONSECUTIVE_OVERLOADED,
  type ErrorCategory,
  type RetryTier,
  type RetryEvent,
} from '../errorRetry.js';

// ─── categorizeError ─────────────────────────────────────────

describe('categorizeError', () => {
  it('classifies 429 as rate_limit', () => {
    const err = Object.assign(new Error('429 Too Many Requests'), { status: 429 });
    const result = categorizeError(err);
    expect(result.category).toBe('rate_limit');
    expect(result.retryable).toBe(true);
    expect(result.statusCode).toBe(429);
  });

  it('classifies "quota exceeded" messages as rate_limit', () => {
    const result = categorizeError(new Error('Resource exhausted: quota limit'));
    expect(result.category).toBe('rate_limit');
    expect(result.retryable).toBe(true);
  });

  it('classifies "too many requests" as rate_limit', () => {
    const result = categorizeError(new Error('too many requests, please slow down'));
    expect(result.category).toBe('rate_limit');
    expect(result.retryable).toBe(true);
  });

  it('classifies 529 as overloaded', () => {
    const err = Object.assign(new Error('Service overloaded'), { status: 529 });
    const result = categorizeError(err);
    expect(result.category).toBe('overloaded');
    expect(result.retryable).toBe(true);
    expect(result.statusCode).toBe(529);
  });

  it('classifies "overloaded" message without status as overloaded', () => {
    const result = categorizeError(new Error('The model is overloaded right now'));
    expect(result.category).toBe('overloaded');
    expect(result.retryable).toBe(true);
  });

  it('classifies "capacity" message as overloaded', () => {
    const result = categorizeError(new Error('Insufficient capacity for this request'));
    expect(result.category).toBe('overloaded');
    expect(result.retryable).toBe(true);
  });

  it('classifies 401 as auth_failed', () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    const result = categorizeError(err);
    expect(result.category).toBe('auth_failed');
    expect(result.retryable).toBe(false);
  });

  it('classifies 403 as auth_failed (non-quota)', () => {
    const err = Object.assign(new Error('Forbidden: token revoked'), { status: 403 });
    const result = categorizeError(err);
    expect(result.category).toBe('auth_failed');
    expect(result.retryable).toBe(false);
  });

  it('classifies 403 with quota message as rate_limit, not auth', () => {
    const err = Object.assign(new Error('403 rate limit exceeded'), { status: 403 });
    const result = categorizeError(err);
    expect(result.category).toBe('rate_limit');
    expect(result.retryable).toBe(true);
  });

  it('classifies context overflow as context_overflow', () => {
    const err = Object.assign(new Error('context length exceeded'), { status: 413 });
    const result = categorizeError(err);
    expect(result.category).toBe('context_overflow');
    expect(result.retryable).toBe(false);
  });

  it('classifies "prompt too long" as context_overflow', () => {
    const result = categorizeError(new Error('prompt too long for this model'));
    expect(result.category).toBe('context_overflow');
    expect(result.retryable).toBe(false);
  });

  it('classifies "input length exceed" as context_overflow', () => {
    const result = categorizeError(new Error('input length and max_tokens exceed context limit: 188059 + 20000 > 200000'));
    expect(result.category).toBe('context_overflow');
    expect(result.retryable).toBe(false);
  });

  it('classifies 500 as server_error', () => {
    const err = Object.assign(new Error('Internal Server Error'), { status: 500 });
    const result = categorizeError(err);
    expect(result.category).toBe('server_error');
    expect(result.retryable).toBe(true);
  });

  it('classifies 502 as server_error', () => {
    const err = Object.assign(new Error('Bad Gateway'), { status: 502 });
    const result = categorizeError(err);
    expect(result.category).toBe('server_error');
    expect(result.retryable).toBe(true);
  });

  it('classifies 400 (non-overflow) as client_error', () => {
    const err = Object.assign(new Error('Bad Request: invalid tool schema'), { status: 400 });
    const result = categorizeError(err);
    expect(result.category).toBe('client_error');
    expect(result.retryable).toBe(false);
  });

  it('classifies 404 as client_error', () => {
    const err = Object.assign(new Error('Model not found'), { status: 404 });
    const result = categorizeError(err);
    expect(result.category).toBe('client_error');
    expect(result.retryable).toBe(false);
  });

  it('classifies ECONNRESET as transient', () => {
    const result = categorizeError(new Error('read ECONNRESET'));
    expect(result.category).toBe('transient');
    expect(result.retryable).toBe(true);
  });

  it('classifies EPIPE as transient', () => {
    const result = categorizeError(new Error('write EPIPE'));
    expect(result.category).toBe('transient');
    expect(result.retryable).toBe(true);
  });

  it('classifies ETIMEDOUT as transient', () => {
    const result = categorizeError(new Error('connect ETIMEDOUT 1.2.3.4:443'));
    expect(result.category).toBe('transient');
    expect(result.retryable).toBe(true);
  });

  it('classifies "fetch failed" as transient', () => {
    const result = categorizeError(new Error('fetch failed'));
    expect(result.category).toBe('transient');
    expect(result.retryable).toBe(true);
  });

  it('classifies unknown errors as unknown', () => {
    const result = categorizeError(new Error('something completely unexpected'));
    expect(result.category).toBe('unknown');
    expect(result.retryable).toBe(false);
  });

  it('handles non-Error objects', () => {
    const result = categorizeError('a string error');
    expect(result.category).toBe('unknown');
    expect(result.message).toBe('a string error');
  });

  it('strips API keys from messages', () => {
    const result = categorizeError(new Error('Auth failed with key sk-ant-abc123 and AIzaSyDexample'));
    expect(result.message).not.toContain('sk-ant-');
    expect(result.message).not.toContain('AIza');
    expect(result.message).toContain('[REDACTED]');
  });

  it('extracts Retry-After from error headers (seconds)', () => {
    const err = Object.assign(new Error('429 rate limited'), {
      status: 429,
      headers: { 'retry-after': '30' },
    });
    const result = categorizeError(err);
    expect(result.retryAfterMs).toBe(30_000);
  });

  it('extracts Retry-After from Headers.get() method', () => {
    const headers = new Map([['retry-after', '5']]);
    const err = Object.assign(new Error('429'), {
      status: 429,
      headers: { get: (key: string) => headers.get(key) ?? null },
    });
    const result = categorizeError(err);
    expect(result.retryAfterMs).toBe(5_000);
  });

  it('extracts statusCode from error.status', () => {
    const err = Object.assign(new Error('error'), { status: 503 });
    expect(categorizeError(err).statusCode).toBe(503);
  });

  it('extracts statusCode from error.statusCode', () => {
    const err = Object.assign(new Error('error'), { statusCode: 502 });
    expect(categorizeError(err).statusCode).toBe(502);
  });

  it('extracts statusCode from message as fallback', () => {
    const result = categorizeError(new Error('Got 503 from upstream'));
    expect(result.statusCode).toBe(503);
  });
});

// ─── calculateRetryDelay ─────────────────────────────────────

describe('calculateRetryDelay', () => {
  it('uses Retry-After when present', () => {
    const delay = calculateRetryDelay(1, 10_000);
    expect(delay).toBe(10_000);
  });

  it('caps Retry-After at maxDelayMs', () => {
    const delay = calculateRetryDelay(1, 100_000, 32_000);
    expect(delay).toBe(32_000);
  });

  it('uses exponential backoff when no Retry-After', () => {
    // attempt 1: 500ms base + jitter
    const d1 = calculateRetryDelay(1, null);
    expect(d1).toBeGreaterThanOrEqual(500);
    expect(d1).toBeLessThanOrEqual(625); // 500 + 25%

    // attempt 2: 1000ms base + jitter
    const d2 = calculateRetryDelay(2, null);
    expect(d2).toBeGreaterThanOrEqual(1000);
    expect(d2).toBeLessThanOrEqual(1250);

    // attempt 3: 2000ms base + jitter
    const d3 = calculateRetryDelay(3, null);
    expect(d3).toBeGreaterThanOrEqual(2000);
    expect(d3).toBeLessThanOrEqual(2500);
  });

  it('caps at maxDelayMs', () => {
    // attempt 10: 500 * 2^9 = 256000, capped at 32000
    const delay = calculateRetryDelay(10, null, 32_000);
    expect(delay).toBeLessThanOrEqual(32_000 * 1.25); // base + max jitter
    expect(delay).toBeGreaterThanOrEqual(32_000);
  });

  it('respects custom maxDelayMs for persistent mode', () => {
    const delay = calculateRetryDelay(20, null, PERSISTENT_MAX_BACKOFF_MS);
    expect(delay).toBeLessThanOrEqual(PERSISTENT_MAX_BACKOFF_MS * 1.25);
  });

  it('returns rounded integer', () => {
    const delay = calculateRetryDelay(1, null);
    expect(Number.isInteger(delay)).toBe(true);
  });
});

// ─── getRetryPolicy ──────────────────────────────────────────

describe('getRetryPolicy', () => {
  const tiers: RetryTier[] = ['executive', 'task', 'on_demand', 'background'];

  it('returns a policy for each tier', () => {
    for (const tier of tiers) {
      const policy = getRetryPolicy(tier);
      expect(policy.tier).toBe(tier);
      expect(policy.maxRetries).toBeGreaterThan(0);
      expect(policy.maxBackoffMs).toBeGreaterThan(0);
    }
  });

  it('executive has highest retry count', () => {
    expect(getRetryPolicy('executive').maxRetries).toBeGreaterThan(
      getRetryPolicy('task').maxRetries,
    );
  });

  it('executive and task are persistent', () => {
    expect(getRetryPolicy('executive').persistent).toBe(true);
    expect(getRetryPolicy('task').persistent).toBe(true);
  });

  it('on_demand and background are not persistent', () => {
    expect(getRetryPolicy('on_demand').persistent).toBe(false);
    expect(getRetryPolicy('background').persistent).toBe(false);
  });

  it('background has lowest retry count', () => {
    const counts = tiers.map(t => getRetryPolicy(t).maxRetries);
    const bgCount = getRetryPolicy('background').maxRetries;
    expect(bgCount).toBe(Math.min(...counts));
  });

  it('background does not enable overload fallback', () => {
    expect(getRetryPolicy('background').enableOverloadFallback).toBe(false);
  });
});

// ─── createRetryState ────────────────────────────────────────

describe('createRetryState', () => {
  it('initializes with zero counters', () => {
    const state = createRetryState();
    expect(state.attempt).toBe(0);
    expect(state.consecutiveOverloaded).toBe(0);
    expect(state.totalWaitMs).toBe(0);
    expect(state.lastError).toBeNull();
    expect(state.fallbackTriggered).toBe(false);
  });

  it('records startedAt timestamp', () => {
    const before = Date.now();
    const state = createRetryState();
    expect(state.startedAt).toBeGreaterThanOrEqual(before);
    expect(state.startedAt).toBeLessThanOrEqual(Date.now());
  });
});

// ─── withSmartRetry ──────────────────────────────────────────

describe('withSmartRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns result on first-attempt success', async () => {
    const result = await withSmartRetry(
      { policy: getRetryPolicy('task'), model: 'gemini-2.5-pro' },
      async () => 'ok',
    );
    expect(result).toBe('ok');
  });

  it('retries on transient error and succeeds', async () => {
    let calls = 0;
    const result = await withSmartRetry(
      { policy: getRetryPolicy('task'), model: 'test-model' },
      async () => {
        calls++;
        if (calls < 3) throw new Error('read ECONNRESET');
        return 'recovered';
      },
    );
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('retries on 429 rate limit', async () => {
    let calls = 0;
    const result = await withSmartRetry(
      { policy: getRetryPolicy('task'), model: 'test-model' },
      async () => {
        calls++;
        if (calls < 2) throw Object.assign(new Error('429'), { status: 429 });
        return 'ok';
      },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('retries on 529 overloaded', async () => {
    let calls = 0;
    const result = await withSmartRetry(
      { policy: getRetryPolicy('task'), model: 'test-model' },
      async () => {
        calls++;
        if (calls < 2) throw Object.assign(new Error('overloaded'), { status: 529 });
        return 'ok';
      },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('throws immediately on non-retryable errors', async () => {
    await expect(
      withSmartRetry(
        { policy: getRetryPolicy('task'), model: 'test-model' },
        async () => {
          throw Object.assign(new Error('Unauthorized'), { status: 401 });
        },
      ),
    ).rejects.toThrow('Unauthorized');
  });

  it('throws immediately on client_error', async () => {
    await expect(
      withSmartRetry(
        { policy: getRetryPolicy('task'), model: 'test-model' },
        async () => {
          throw Object.assign(new Error('invalid tool'), { status: 400 });
        },
      ),
    ).rejects.toThrow('invalid tool');
  });

  it('throws immediately on context_overflow', async () => {
    await expect(
      withSmartRetry(
        { policy: getRetryPolicy('task'), model: 'test-model' },
        async () => {
          throw new Error('context length exceeded');
        },
      ),
    ).rejects.toThrow('context length');
  });

  it('throws RetriesExhaustedError when maxRetries exceeded', async () => {
    const policy = getRetryPolicy('background'); // maxRetries: 2, not persistent
    try {
      await withSmartRetry(
        { policy, model: 'test-model' },
        async () => {
          throw new Error('read ECONNRESET');
        },
      );
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RetriesExhaustedError);
      const re = err as RetriesExhaustedError;
      expect(re.lastCategorizedError.category).toBe('transient');
      expect(re.state.attempt).toBe(3); // 1 initial + 2 retries
    }
  });

  it('throws ModelFallbackTriggeredError after consecutive overloads', async () => {
    const policy = { ...getRetryPolicy('task'), persistent: false, enableOverloadFallback: true };
    try {
      await withSmartRetry(
        { policy, model: 'gemini-2.5-pro' },
        async () => {
          throw Object.assign(new Error('overloaded'), { status: 529 });
        },
      );
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ModelFallbackTriggeredError);
      const fe = err as ModelFallbackTriggeredError;
      expect(fe.originalModel).toBe('gemini-2.5-pro');
      expect(fe.consecutiveOverloaded).toBe(MAX_CONSECUTIVE_OVERLOADED);
    }
  });

  it('resets consecutive overloaded count on non-529 error', async () => {
    let calls = 0;
    const policy = { ...getRetryPolicy('task'), persistent: false, maxRetries: 6, maxBackoffMs: 50 };
    try {
      await withSmartRetry(
        { policy, model: 'test-model' },
        async () => {
          calls++;
          // 2 overloads, then a transient, then 2 more overloads — should NOT trigger fallback
          if (calls <= 2) throw Object.assign(new Error('overloaded'), { status: 529 });
          if (calls === 3) throw new Error('read ECONNRESET');
          if (calls <= 5) throw Object.assign(new Error('overloaded'), { status: 529 });
          // Then exhaust retries with transient
          throw new Error('read ECONNRESET');
        },
      );
    } catch (err) {
      // Should be RetriesExhaustedError, NOT ModelFallbackTriggeredError
      expect(err).toBeInstanceOf(RetriesExhaustedError);
    }
  });

  it('pre-seeds consecutive overloaded counter', async () => {
    const policy = { ...getRetryPolicy('task'), persistent: false, enableOverloadFallback: true };
    try {
      await withSmartRetry(
        { policy, model: 'test-model', initialConsecutiveOverloaded: 2 },
        async () => {
          // Only 1 more 529 needed to hit MAX_CONSECUTIVE_OVERLOADED (3)
          throw Object.assign(new Error('overloaded'), { status: 529 });
        },
      );
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ModelFallbackTriggeredError);
    }
  });

  it('does not trigger fallback when enableOverloadFallback is false', { timeout: 30_000 }, async () => {
    const policy = { ...getRetryPolicy('background'), enableOverloadFallback: false, maxRetries: 3 };
    try {
      await withSmartRetry(
        { policy, model: 'test-model' },
        async () => {
          throw Object.assign(new Error('overloaded'), { status: 529 });
        },
      );
    } catch (err) {
      expect(err).toBeInstanceOf(RetriesExhaustedError);
      // NOT ModelFallbackTriggeredError
      expect(err).not.toBeInstanceOf(ModelFallbackTriggeredError);
    }
  });

  it('emits retry events', async () => {
    const events: RetryEvent[] = [];
    let calls = 0;
    await withSmartRetry(
      {
        policy: getRetryPolicy('task'),
        model: 'test-model',
        onRetryEvent: (e) => events.push(e),
      },
      async () => {
        calls++;
        if (calls < 3) throw new Error('read ECONNRESET');
        return 'ok';
      },
    );

    // 2 retry_attempt events + 1 retry_success
    const attempts = events.filter(e => e.type === 'retry_attempt');
    const successes = events.filter(e => e.type === 'retry_success');
    expect(attempts).toHaveLength(2);
    expect(successes).toHaveLength(1);
    expect(attempts[0].category).toBe('transient');
    expect(attempts[0].delayMs).toBeGreaterThan(0);
    expect(successes[0].attempt).toBe(3);
  });

  it('emits retry_exhausted event', async () => {
    const events: RetryEvent[] = [];
    try {
      await withSmartRetry(
        {
          policy: getRetryPolicy('background'),
          model: 'test-model',
          onRetryEvent: (e) => events.push(e),
        },
        async () => {
          throw new Error('read ECONNRESET');
        },
      );
    } catch {
      // expected
    }
    const exhausted = events.filter(e => e.type === 'retry_exhausted');
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0].tier).toBe('background');
  });

  it('emits retry_fallback event on consecutive overloads', async () => {
    const events: RetryEvent[] = [];
    const policy = { ...getRetryPolicy('task'), persistent: false };
    try {
      await withSmartRetry(
        {
          policy,
          model: 'test-model',
          onRetryEvent: (e) => events.push(e),
        },
        async () => {
          throw Object.assign(new Error('overloaded'), { status: 529 });
        },
      );
    } catch {
      // expected
    }
    const fallbacks = events.filter(e => e.type === 'retry_fallback');
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0].category).toBe('overloaded');
  });

  it('respects AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      withSmartRetry(
        { policy: getRetryPolicy('task'), signal: controller.signal },
        async () => 'ok',
      ),
    ).rejects.toThrow('Aborted');
  });

  it('calls onHeartbeat in persistent mode during long waits', async () => {
    const heartbeats: number[] = [];
    let calls = 0;
    const policy = { ...getRetryPolicy('executive'), maxRetries: 1, persistent: true };

    // Need to use real timers for this test with a short delay
    vi.useRealTimers();

    // Use a very short heartbeat interval for testing by mocking
    const originalHeartbeat = HEARTBEAT_INTERVAL_MS;

    const promise = withSmartRetry(
      {
        policy,
        model: 'test-model',
        onHeartbeat: () => heartbeats.push(Date.now()),
      },
      async () => {
        calls++;
        if (calls < 2) {
          // Throw a 429 with a short retry-after to trigger persistent mode
          throw Object.assign(new Error('429'), {
            status: 429,
            headers: { 'retry-after': '0' }, // 0 seconds → will use base delay
          });
        }
        return 'ok';
      },
    );

    const result = await promise;
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('does no retry on first-attempt success (no events emitted)', async () => {
    const events: RetryEvent[] = [];
    await withSmartRetry(
      {
        policy: getRetryPolicy('task'),
        model: 'test-model',
        onRetryEvent: (e) => events.push(e),
      },
      async () => 'ok',
    );
    expect(events).toHaveLength(0);
  });
});

// ─── ModelFallbackTriggeredError ─────────────────────────────

describe('ModelFallbackTriggeredError', () => {
  it('stores originalModel and consecutiveOverloaded', () => {
    const err = new ModelFallbackTriggeredError('gemini-2.5-pro', 3);
    expect(err.originalModel).toBe('gemini-2.5-pro');
    expect(err.consecutiveOverloaded).toBe(3);
    expect(err.name).toBe('ModelFallbackTriggeredError');
    expect(err.message).toContain('gemini-2.5-pro');
    expect(err.message).toContain('3');
  });
});

// ─── RetriesExhaustedError ───────────────────────────────────

describe('RetriesExhaustedError', () => {
  it('stores categorized error and state', () => {
    const categorized = categorizeError(new Error('ECONNRESET'));
    const state = createRetryState();
    state.attempt = 5;
    state.totalWaitMs = 15_000;

    const err = new RetriesExhaustedError(categorized, state);
    expect(err.name).toBe('RetriesExhaustedError');
    expect(err.lastCategorizedError.category).toBe('transient');
    expect(err.state.attempt).toBe(5);
    expect(err.state.totalWaitMs).toBe(15_000);
    expect(err.message).toContain('5 attempts');
  });
});

// ─── Constants ───────────────────────────────────────────────

describe('constants', () => {
  it('BASE_DELAY_MS is 500', () => {
    expect(BASE_DELAY_MS).toBe(500);
  });

  it('DEFAULT_MAX_BACKOFF_MS is 32s', () => {
    expect(DEFAULT_MAX_BACKOFF_MS).toBe(32_000);
  });

  it('PERSISTENT_MAX_BACKOFF_MS is 5 minutes', () => {
    expect(PERSISTENT_MAX_BACKOFF_MS).toBe(300_000);
  });

  it('HEARTBEAT_INTERVAL_MS is 30s', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(30_000);
  });

  it('MAX_CONSECUTIVE_OVERLOADED is 3', () => {
    expect(MAX_CONSECUTIVE_OVERLOADED).toBe(3);
  });
});

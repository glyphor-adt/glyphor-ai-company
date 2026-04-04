/**
 * Built-in Hook Implementations
 *
 * Reusable pre/post hook functions that can be attached to tools via
 * `buildTool({ preHooks: [...], postHooks: [...] })`.
 *
 * These run in-process (no HTTP overhead) and follow the same lifecycle
 * as the global hook runner: pre-hooks can block, post-hooks can enrich.
 */

import type { ToolResult } from '../types.js';
import type { ToolHookContext, ToolHookPostContext, ToolHookPreDecision } from './hookRunner.js';
import type { PreToolHookFn, PostToolHookFn } from '../buildTool.js';

// ═══════════════════════════════════════════════════════════════════
// PRE-HOOKS
// ═══════════════════════════════════════════════════════════════════

/**
 * Require that specific parameters are present and non-empty.
 * Returns a pre-hook that blocks execution if any required param is missing.
 */
export function requireParams(...paramNames: string[]): PreToolHookFn {
  return (context: ToolHookContext): ToolHookPreDecision => {
    for (const name of paramNames) {
      const val = context.params[name];
      if (val === undefined || val === null || val === '') {
        return {
          allow: false,
          reason: `Missing required parameter: ${name}`,
        };
      }
    }
    return { allow: true };
  };
}

/**
 * Block tool execution for specific agent roles.
 * Use when a tool's ABAC metadata isn't enough and you need
 * runtime role-based gating with a custom message.
 */
export function denyRoles(
  roles: string[],
  reason?: string,
): PreToolHookFn {
  return (context: ToolHookContext): ToolHookPreDecision => {
    if (roles.includes(context.agentRole)) {
      return {
        allow: false,
        reason: reason ?? `Tool ${context.toolName} is not available for role ${context.agentRole}`,
      };
    }
    return { allow: true };
  };
}

/**
 * Enforce a per-tool call frequency limit within a sliding window.
 * Tracks calls in a module-level Map (per-process, resets on deploy).
 *
 * More granular than the ToolExecutor's hourly rate limit — useful for
 * expensive tools that need per-minute or per-5-minute throttling.
 */
export function rateWindow(
  maxCalls: number,
  windowMs: number,
): PreToolHookFn {
  const callLog = new Map<string, number[]>(); // agentRole:toolName → timestamps

  return (context: ToolHookContext): ToolHookPreDecision => {
    const key = `${context.agentRole}:${context.toolName}`;
    const now = Date.now();
    const cutoff = now - windowMs;

    let timestamps = callLog.get(key);
    if (!timestamps) {
      timestamps = [];
      callLog.set(key, timestamps);
    }

    // Evict expired entries
    const active = timestamps.filter(t => t > cutoff);
    callLog.set(key, active);

    if (active.length >= maxCalls) {
      const windowSec = Math.round(windowMs / 1000);
      return {
        allow: false,
        reason: `Rate limit: ${context.toolName} allows max ${maxCalls} calls per ${windowSec}s for ${context.agentRole}`,
      };
    }

    active.push(now);
    return { allow: true };
  };
}

/**
 * Block tool execution outside of allowed hours (UTC).
 * Useful for restricting external-facing tools to business hours.
 */
export function allowedHoursUtc(
  startHour: number,
  endHour: number,
): PreToolHookFn {
  return (_context: ToolHookContext): ToolHookPreDecision => {
    const hour = new Date().getUTCHours();
    if (hour >= startHour && hour < endHour) {
      return { allow: true };
    }
    return {
      allow: false,
      reason: `Tool only available between ${startHour}:00–${endHour}:00 UTC`,
    };
  };
}

/**
 * Validate parameters against a custom predicate.
 * The predicate receives all params and returns null (valid) or an error string.
 */
export function validateParams(
  validator: (params: Record<string, unknown>) => string | null,
): PreToolHookFn {
  return (context: ToolHookContext): ToolHookPreDecision => {
    const error = validator(context.params);
    if (error) {
      return { allow: false, reason: error };
    }
    return { allow: true };
  };
}

// ═══════════════════════════════════════════════════════════════════
// POST-HOOKS
// ═══════════════════════════════════════════════════════════════════

/**
 * Stamp execution timing metadata onto the result.
 * Returns a post-hook that must be paired with a start-time capture.
 *
 * Usage with buildTool:
 *   const timing = executionTiming();
 *   buildTool({ preHooks: [timing.start], postHooks: [timing.end] })
 */
export function executionTiming(): {
  start: PreToolHookFn;
  end: PostToolHookFn;
} {
  const starts = new Map<string, number>(); // runId:toolName → startMs

  return {
    start: (context: ToolHookContext): ToolHookPreDecision => {
      const key = `${context.runId ?? 'unknown'}:${context.toolName}:${context.turnNumber}`;
      starts.set(key, Date.now());
      return { allow: true };
    },
    end: (context: ToolHookPostContext): Partial<ToolResult> | void => {
      const key = `${context.runId ?? 'unknown'}:${context.toolName}:${context.turnNumber}`;
      const startMs = starts.get(key);
      starts.delete(key);
      if (startMs) {
        const durationMs = Date.now() - startMs;
        return {
          data: {
            ...(context.result.data as Record<string, unknown> ?? {}),
            __hookMeta: {
              ...(context.result.data as Record<string, unknown> ?? {}).__hookMeta as Record<string, unknown> ?? {},
              executionDurationMs: durationMs,
            },
          },
        };
      }
    },
  };
}

/**
 * Log tool execution to a callback (console, telemetry, etc).
 * Never modifies the result.
 */
export function auditLog(
  logger: (entry: {
    toolName: string;
    agentRole: string;
    success: boolean;
    turnNumber: number;
    runId?: string;
  }) => void,
): PostToolHookFn {
  return (context: ToolHookPostContext): void => {
    logger({
      toolName: context.toolName,
      agentRole: context.agentRole,
      success: context.result.success,
      turnNumber: context.turnNumber,
      runId: context.runId,
    });
  };
}

/**
 * Redact sensitive fields from the tool result's data before it's
 * returned to the model. Prevents keys like `password`, `token`, etc.
 * from leaking into the conversation context.
 */
export function redactFields(...fieldNames: string[]): PostToolHookFn {
  const redactRecursive = (obj: unknown): unknown => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(redactRecursive);
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (fieldNames.includes(k)) {
        result[k] = '[REDACTED]';
      } else {
        result[k] = redactRecursive(v);
      }
    }
    return result;
  };

  return (context: ToolHookPostContext): Partial<ToolResult> | void => {
    if (context.result.data && typeof context.result.data === 'object') {
      return { data: redactRecursive(context.result.data) };
    }
  };
}

/**
 * Cap the size of tool result data to prevent context blowout.
 * If the JSON-serialized result exceeds maxBytes, truncates with a notice.
 */
export function capResultSize(maxBytes: number): PostToolHookFn {
  return (context: ToolHookPostContext): Partial<ToolResult> | void => {
    if (!context.result.data) return;
    const json = JSON.stringify(context.result.data);
    if (json.length > maxBytes) {
      const truncated = json.slice(0, maxBytes);
      return {
        data: {
          __truncated: true,
          __originalSizeBytes: json.length,
          __maxBytes: maxBytes,
          partial: truncated,
        },
      };
    }
  };
}

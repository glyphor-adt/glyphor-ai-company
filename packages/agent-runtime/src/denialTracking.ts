/**
 * Denial Tracking — Circuit Breaker for Tool Permission Loops
 *
 * Prevents agents from getting stuck in infinite denial loops when:
 *   - A classifier/hook/ABAC rule repeatedly rejects the same tool
 *   - An agent retries the same blocked action without changing approach
 *   - External permission gates (founder approval) are unresponsive
 *
 * After hitting thresholds, the system escalates rather than retrying:
 *   - Falls back to human prompting (if interactive)
 *   - Aborts the tool call with a diagnostic message (if non-interactive)
 *   - Emits a security event for monitoring
 *
 * Pattern inspired by Claude Code's denialTracking.ts — simple counters
 * with automatic escalation. Immutable functional updates.
 *
 * Usage:
 *
 *   const tracker = createDenialTracker();
 *   // On denial:
 *   tracker.state = recordDenial(tracker.state, 'create_decision', 'ABAC denied');
 *   if (shouldEscalate(tracker.state)) { ... }
 *   // On success:
 *   tracker.state = recordSuccess(tracker.state);
 */

import type { CompanyAgentRole, SecurityEventType } from './types.js';

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

/** Max consecutive denials before escalation. */
const MAX_CONSECUTIVE_DENIALS = 3;

/** Max total denials per run before escalation. */
const MAX_TOTAL_DENIALS = 15;

/** Max denials of the same tool before permanent block for this run. */
const MAX_SAME_TOOL_DENIALS = 3;

/** Cooldown (ms) before the same tool can be retried after a denial. */
const DENIAL_COOLDOWN_MS = 5_000;

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

export interface DenialRecord {
  toolName: string;
  reason: string;
  timestamp: number;
  source: DenialSource;
}

export type DenialSource =
  | 'abac'
  | 'hook'
  | 'constitutional'
  | 'capacity_tier'
  | 'rate_limit'
  | 'budget'
  | 'emergency_block'
  | 'behavioral_anomaly'
  | 'data_evidence'
  | 'value_gate'
  | 'scope_violation'
  | 'action_risk'
  | 'policy'
  | 'unknown';

export interface DenialTrackingState {
  /** Number of consecutive denials (reset on any success). */
  consecutiveDenials: number;
  /** Total denials this run. */
  totalDenials: number;
  /** Per-tool denial counts. */
  perToolDenials: Map<string, number>;
  /** Last denial timestamp per tool (for cooldown enforcement). */
  lastDenialTimestamp: Map<string, number>;
  /** Full denial history (capped at 50 for memory). */
  history: DenialRecord[];
  /** Whether escalation has been triggered this run. */
  escalated: boolean;
  /** The escalation reason if escalated. */
  escalationReason: string | null;
}

export interface DenialTracker {
  state: DenialTrackingState;
}

// ═══════════════════════════════════════════════════════════════════
// ESCALATION RESULT
// ═══════════════════════════════════════════════════════════════════

export type EscalationAction =
  | 'none'
  | 'cooldown'
  | 'fallback_to_prompting'
  | 'abort_tool'
  | 'abort_run';

export interface EscalationDecision {
  action: EscalationAction;
  reason: string;
  /** Diagnostic message suitable for injection into the agent's conversation. */
  agentMessage: string;
  /** Security event type for logging. */
  securityEventType?: SecurityEventType;
}

// ═══════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════

export function createDenialTracker(): DenialTracker {
  return {
    state: createInitialState(),
  };
}

export function createInitialState(): DenialTrackingState {
  return {
    consecutiveDenials: 0,
    totalDenials: 0,
    perToolDenials: new Map(),
    lastDenialTimestamp: new Map(),
    history: [],
    escalated: false,
    escalationReason: null,
  };
}

// ═══════════════════════════════════════════════════════════════════
// IMMUTABLE STATE UPDATES
// ═══════════════════════════════════════════════════════════════════

/**
 * Record a tool denial. Returns a new state (immutable update).
 */
export function recordDenial(
  state: DenialTrackingState,
  toolName: string,
  reason: string,
  source: DenialSource = 'unknown',
): DenialTrackingState {
  const now = Date.now();
  const perToolDenials = new Map(state.perToolDenials);
  perToolDenials.set(toolName, (perToolDenials.get(toolName) ?? 0) + 1);

  const lastDenialTimestamp = new Map(state.lastDenialTimestamp);
  lastDenialTimestamp.set(toolName, now);

  const record: DenialRecord = { toolName, reason, timestamp: now, source };
  const history = state.history.length >= 50
    ? [...state.history.slice(-49), record]
    : [...state.history, record];

  return {
    ...state,
    consecutiveDenials: state.consecutiveDenials + 1,
    totalDenials: state.totalDenials + 1,
    perToolDenials,
    lastDenialTimestamp,
    history,
  };
}

/**
 * Record a successful tool execution. Resets consecutive denial counter.
 */
export function recordSuccess(state: DenialTrackingState): DenialTrackingState {
  return {
    ...state,
    consecutiveDenials: 0,
  };
}

/**
 * Mark the state as escalated with a reason.
 */
export function markEscalated(
  state: DenialTrackingState,
  reason: string,
): DenialTrackingState {
  return {
    ...state,
    escalated: true,
    escalationReason: reason,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ESCALATION LOGIC
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if the current state warrants escalation.
 */
export function shouldEscalate(state: DenialTrackingState): boolean {
  if (state.escalated) return true;
  if (state.consecutiveDenials >= MAX_CONSECUTIVE_DENIALS) return true;
  if (state.totalDenials >= MAX_TOTAL_DENIALS) return true;
  return false;
}

/**
 * Check if a specific tool has been permanently blocked for this run.
 */
export function isToolRunBlocked(state: DenialTrackingState, toolName: string): boolean {
  return (state.perToolDenials.get(toolName) ?? 0) >= MAX_SAME_TOOL_DENIALS;
}

/**
 * Check if a tool is in cooldown (recently denied, should wait before retry).
 */
export function isToolInCooldown(state: DenialTrackingState, toolName: string): boolean {
  const lastDenied = state.lastDenialTimestamp.get(toolName);
  if (!lastDenied) return false;
  return Date.now() - lastDenied < DENIAL_COOLDOWN_MS;
}

/**
 * Evaluate the denial state and return an escalation decision.
 * This is the main entry point for the circuit breaker.
 */
export function evaluateEscalation(
  state: DenialTrackingState,
  toolName: string,
): EscalationDecision {
  // Already escalated — return abort
  if (state.escalated) {
    return {
      action: 'abort_tool',
      reason: state.escalationReason ?? 'Previously escalated',
      agentMessage:
        `[CIRCUIT BREAKER] Tool execution has been suspended for this run due to repeated permission denials. ` +
        `Previous reason: ${state.escalationReason ?? 'unknown'}. ` +
        `Try a different approach or ask the user for guidance.`,
    };
  }

  // Same tool blocked for this run
  if (isToolRunBlocked(state, toolName)) {
    return {
      action: 'abort_tool',
      reason: `Tool "${toolName}" denied ${MAX_SAME_TOOL_DENIALS} times this run`,
      agentMessage:
        `[CIRCUIT BREAKER] Tool "${toolName}" has been blocked for the remainder of this run ` +
        `after ${MAX_SAME_TOOL_DENIALS} consecutive denials. Use a different tool or approach.`,
      securityEventType: 'RATE_LIMITED',
    };
  }

  // Cooldown active
  if (isToolInCooldown(state, toolName)) {
    return {
      action: 'cooldown',
      reason: `Tool "${toolName}" is in cooldown after recent denial`,
      agentMessage:
        `[COOLDOWN] Tool "${toolName}" was recently denied. Wait before retrying, ` +
        `or use a different approach.`,
    };
  }

  // Total denials threshold
  if (state.totalDenials >= MAX_TOTAL_DENIALS) {
    return {
      action: 'abort_run',
      reason: `Total denials (${state.totalDenials}) exceeded threshold (${MAX_TOTAL_DENIALS})`,
      agentMessage:
        `[CIRCUIT BREAKER] Too many tool denials this run (${state.totalDenials}/${MAX_TOTAL_DENIALS}). ` +
        `Execution suspended. Review permissions or escalate to a founder.`,
      securityEventType: 'RATE_LIMITED',
    };
  }

  // Consecutive denials threshold — fall back to prompting
  if (state.consecutiveDenials >= MAX_CONSECUTIVE_DENIALS) {
    return {
      action: 'fallback_to_prompting',
      reason: `${state.consecutiveDenials} consecutive denials`,
      agentMessage:
        `[PERMISSION ESCALATION] ${state.consecutiveDenials} consecutive tool calls were denied. ` +
        `Instead of retrying the same approach, explain what you're trying to accomplish ` +
        `and request explicit permission or a different task assignment.`,
    };
  }

  return {
    action: 'none',
    reason: 'No escalation needed',
    agentMessage: '',
  };
}

// ═══════════════════════════════════════════════════════════════════
// DIAGNOSTIC SUMMARY
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a human-readable summary of the denial state.
 * Useful for audit logs and debugging.
 */
export function getDenialSummary(state: DenialTrackingState): string {
  const lines: string[] = [
    `Denial Tracking Summary:`,
    `  Consecutive: ${state.consecutiveDenials}/${MAX_CONSECUTIVE_DENIALS}`,
    `  Total:       ${state.totalDenials}/${MAX_TOTAL_DENIALS}`,
    `  Escalated:   ${state.escalated ? `YES — ${state.escalationReason}` : 'No'}`,
  ];

  if (state.perToolDenials.size > 0) {
    lines.push(`  Per-tool denials:`);
    for (const [tool, count] of state.perToolDenials) {
      const blocked = count >= MAX_SAME_TOOL_DENIALS ? ' [BLOCKED]' : '';
      lines.push(`    ${tool}: ${count}/${MAX_SAME_TOOL_DENIALS}${blocked}`);
    }
  }

  if (state.history.length > 0) {
    const last = state.history[state.history.length - 1]!;
    lines.push(`  Last denial: ${last.toolName} (${last.source}) — ${last.reason}`);
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS EXPORT (for tests)
// ═══════════════════════════════════════════════════════════════════

export const DENIAL_THRESHOLDS = {
  MAX_CONSECUTIVE_DENIALS,
  MAX_TOTAL_DENIALS,
  MAX_SAME_TOOL_DENIALS,
  DENIAL_COOLDOWN_MS,
} as const;

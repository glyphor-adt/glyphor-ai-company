import { describe, expect, it, beforeEach } from 'vitest';
import {
  createDenialTracker,
  createInitialState,
  recordDenial,
  recordSuccess,
  markEscalated,
  shouldEscalate,
  isToolRunBlocked,
  isToolInCooldown,
  evaluateEscalation,
  getDenialSummary,
  DENIAL_THRESHOLDS,
  type DenialTrackingState,
} from '../denialTracking.js';

// ─── Tests ───────────────────────────────────────────────────────

describe('createDenialTracker()', () => {
  it('creates a tracker with clean initial state', () => {
    const tracker = createDenialTracker();
    expect(tracker.state.consecutiveDenials).toBe(0);
    expect(tracker.state.totalDenials).toBe(0);
    expect(tracker.state.perToolDenials.size).toBe(0);
    expect(tracker.state.history).toHaveLength(0);
    expect(tracker.state.escalated).toBe(false);
    expect(tracker.state.escalationReason).toBeNull();
  });
});

describe('recordDenial()', () => {
  let state: DenialTrackingState;

  beforeEach(() => {
    state = createInitialState();
  });

  it('increments consecutive and total denial counters', () => {
    state = recordDenial(state, 'create_decision', 'ABAC denied', 'abac');
    expect(state.consecutiveDenials).toBe(1);
    expect(state.totalDenials).toBe(1);
  });

  it('tracks per-tool denial counts', () => {
    state = recordDenial(state, 'create_decision', 'denied', 'abac');
    state = recordDenial(state, 'create_decision', 'denied again', 'abac');
    state = recordDenial(state, 'send_dm', 'rate limited', 'rate_limit');

    expect(state.perToolDenials.get('create_decision')).toBe(2);
    expect(state.perToolDenials.get('send_dm')).toBe(1);
  });

  it('appends to history with timestamp and source', () => {
    state = recordDenial(state, 'test_tool', 'test reason', 'hook');
    expect(state.history).toHaveLength(1);
    expect(state.history[0]).toMatchObject({
      toolName: 'test_tool',
      reason: 'test reason',
      source: 'hook',
    });
    expect(state.history[0]!.timestamp).toBeGreaterThan(0);
  });

  it('caps history at 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      state = recordDenial(state, `tool_${i}`, 'denied', 'unknown');
    }
    expect(state.history).toHaveLength(50);
    // Most recent entry should be the last one added
    expect(state.history[49]!.toolName).toBe('tool_59');
  });

  it('returns a new state object (immutable)', () => {
    const original = createInitialState();
    const updated = recordDenial(original, 'test', 'reason', 'unknown');
    expect(original.consecutiveDenials).toBe(0);
    expect(updated.consecutiveDenials).toBe(1);
    expect(original).not.toBe(updated);
  });
});

describe('recordSuccess()', () => {
  it('resets consecutive denials to 0', () => {
    let state = createInitialState();
    state = recordDenial(state, 'tool', 'denied', 'abac');
    state = recordDenial(state, 'tool', 'denied', 'abac');
    expect(state.consecutiveDenials).toBe(2);

    state = recordSuccess(state);
    expect(state.consecutiveDenials).toBe(0);
  });

  it('does NOT reset total denials', () => {
    let state = createInitialState();
    state = recordDenial(state, 'tool', 'denied', 'abac');
    state = recordDenial(state, 'tool', 'denied', 'abac');
    state = recordSuccess(state);
    expect(state.totalDenials).toBe(2);
  });

  it('returns a new state object (immutable)', () => {
    let state = createInitialState();
    state = recordDenial(state, 'tool', 'denied', 'abac');
    const updated = recordSuccess(state);
    expect(state.consecutiveDenials).toBe(1);
    expect(updated.consecutiveDenials).toBe(0);
  });
});

describe('shouldEscalate()', () => {
  it('returns false for clean state', () => {
    expect(shouldEscalate(createInitialState())).toBe(false);
  });

  it('returns true after MAX_CONSECUTIVE_DENIALS', () => {
    let state = createInitialState();
    for (let i = 0; i < DENIAL_THRESHOLDS.MAX_CONSECUTIVE_DENIALS; i++) {
      state = recordDenial(state, 'tool', 'denied', 'abac');
    }
    expect(shouldEscalate(state)).toBe(true);
  });

  it('returns false if success resets consecutive count', () => {
    let state = createInitialState();
    for (let i = 0; i < DENIAL_THRESHOLDS.MAX_CONSECUTIVE_DENIALS - 1; i++) {
      state = recordDenial(state, 'tool', 'denied', 'abac');
    }
    state = recordSuccess(state);
    state = recordDenial(state, 'tool', 'denied', 'abac');
    expect(shouldEscalate(state)).toBe(false);
  });

  it('returns true after MAX_TOTAL_DENIALS even with successes', () => {
    let state = createInitialState();
    for (let i = 0; i < DENIAL_THRESHOLDS.MAX_TOTAL_DENIALS; i++) {
      state = recordDenial(state, `tool_${i}`, 'denied', 'abac');
      if (i % 2 === 0) state = recordSuccess(state);
    }
    expect(shouldEscalate(state)).toBe(true);
  });

  it('returns true when already escalated', () => {
    let state = createInitialState();
    state = markEscalated(state, 'test reason');
    expect(shouldEscalate(state)).toBe(true);
  });
});

describe('isToolRunBlocked()', () => {
  it('returns false for tools below threshold', () => {
    let state = createInitialState();
    state = recordDenial(state, 'test_tool', 'denied', 'abac');
    expect(isToolRunBlocked(state, 'test_tool')).toBe(false);
  });

  it('returns true after MAX_SAME_TOOL_DENIALS', () => {
    let state = createInitialState();
    for (let i = 0; i < DENIAL_THRESHOLDS.MAX_SAME_TOOL_DENIALS; i++) {
      state = recordDenial(state, 'bad_tool', 'denied', 'abac');
    }
    expect(isToolRunBlocked(state, 'bad_tool')).toBe(true);
  });

  it('does not affect other tools', () => {
    let state = createInitialState();
    for (let i = 0; i < DENIAL_THRESHOLDS.MAX_SAME_TOOL_DENIALS; i++) {
      state = recordDenial(state, 'bad_tool', 'denied', 'abac');
    }
    expect(isToolRunBlocked(state, 'good_tool')).toBe(false);
  });
});

describe('isToolInCooldown()', () => {
  it('returns false for tools never denied', () => {
    expect(isToolInCooldown(createInitialState(), 'test_tool')).toBe(false);
  });

  it('returns true immediately after a denial', () => {
    let state = createInitialState();
    state = recordDenial(state, 'test_tool', 'denied', 'abac');
    expect(isToolInCooldown(state, 'test_tool')).toBe(true);
  });
});

describe('evaluateEscalation()', () => {
  it('returns action=none for clean state', () => {
    const decision = evaluateEscalation(createInitialState(), 'test_tool');
    expect(decision.action).toBe('none');
    expect(decision.agentMessage).toBe('');
  });

  it('returns abort_tool for per-tool blocked tools', () => {
    let state = createInitialState();
    for (let i = 0; i < DENIAL_THRESHOLDS.MAX_SAME_TOOL_DENIALS; i++) {
      state = recordDenial(state, 'bad_tool', 'denied', 'abac');
    }
    const decision = evaluateEscalation(state, 'bad_tool');
    expect(decision.action).toBe('abort_tool');
    expect(decision.agentMessage).toContain('bad_tool');
    expect(decision.agentMessage).toContain('CIRCUIT BREAKER');
  });

  it('returns fallback_to_prompting after consecutive threshold', () => {
    let state = createInitialState();
    for (let i = 0; i < DENIAL_THRESHOLDS.MAX_CONSECUTIVE_DENIALS; i++) {
      state = recordDenial(state, `tool_${i}`, 'denied', 'abac');
    }
    const decision = evaluateEscalation(state, 'new_tool');
    expect(decision.action).toBe('fallback_to_prompting');
    expect(decision.agentMessage).toContain('PERMISSION ESCALATION');
  });

  it('returns abort_run after total threshold', () => {
    let state = createInitialState();
    for (let i = 0; i < DENIAL_THRESHOLDS.MAX_TOTAL_DENIALS; i++) {
      state = recordDenial(state, `tool_${i % 5}`, 'denied', 'abac');
      state = recordSuccess(state); // Reset consecutive to avoid hitting that first
    }
    // Push over total threshold
    state = recordDenial(state, 'final_tool', 'denied', 'abac');

    // totalDenials is now MAX_TOTAL_DENIALS + 1 but consecutive is only 1
    // At MAX_TOTAL_DENIALS we should escalate
    if (state.totalDenials >= DENIAL_THRESHOLDS.MAX_TOTAL_DENIALS) {
      const decision = evaluateEscalation(state, 'new_tool');
      expect(decision.action).toBe('abort_run');
    }
  });

  it('returns abort_tool for already escalated state', () => {
    let state = createInitialState();
    state = markEscalated(state, 'previous escalation');
    const decision = evaluateEscalation(state, 'any_tool');
    expect(decision.action).toBe('abort_tool');
    expect(decision.agentMessage).toContain('Previously escalated');
  });
});

describe('markEscalated()', () => {
  it('sets escalated flag and reason', () => {
    let state = createInitialState();
    state = markEscalated(state, 'Too many denials');
    expect(state.escalated).toBe(true);
    expect(state.escalationReason).toBe('Too many denials');
  });
});

describe('getDenialSummary()', () => {
  it('returns readable summary for clean state', () => {
    const summary = getDenialSummary(createInitialState());
    expect(summary).toContain('Consecutive: 0');
    expect(summary).toContain('Total:       0');
    expect(summary).toContain('Escalated:   No');
  });

  it('includes per-tool breakdown', () => {
    let state = createInitialState();
    state = recordDenial(state, 'create_decision', 'ABAC denied', 'abac');
    state = recordDenial(state, 'create_decision', 'ABAC denied', 'abac');
    const summary = getDenialSummary(state);
    expect(summary).toContain('create_decision: 2');
  });

  it('shows BLOCKED marker for per-tool blocked tools', () => {
    let state = createInitialState();
    for (let i = 0; i < DENIAL_THRESHOLDS.MAX_SAME_TOOL_DENIALS; i++) {
      state = recordDenial(state, 'bad_tool', 'denied', 'abac');
    }
    const summary = getDenialSummary(state);
    expect(summary).toContain('[BLOCKED]');
  });

  it('shows escalation reason when escalated', () => {
    let state = createInitialState();
    state = markEscalated(state, 'Cost overflow');
    const summary = getDenialSummary(state);
    expect(summary).toContain('YES — Cost overflow');
  });
});

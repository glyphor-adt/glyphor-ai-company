import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConversationTurn, ToolResult } from '../types.js';

// ═══════════════════════════════════════════════════════════════════
// MOCKS
// ═══════════════════════════════════════════════════════════════════

// Mock @glyphor/shared's getContextWindow before module imports
vi.mock('@glyphor/shared', () => ({
  getContextWindow: vi.fn((modelId: string) => {
    const windows: Record<string, number> = {
      'gemini-2.5-pro': 1_048_576,
      'gemini-2.5-flash': 1_048_576,
      'gpt-5': 128_000,
      'gpt-4o': 128_000,
      'claude-sonnet-4': 200_000,
      'small-model': 32_000,
      'unknown-model': 128_000,
    };
    return windows[modelId] ?? 128_000;
  }),
}));

// Mock contextComposer and microCompactor for reactiveCompaction
vi.mock('../context/contextComposer.js', () => ({
  composeModelContext: vi.fn(({ maxTokens }: { maxTokens: number }) => ({
    history: [{ role: 'assistant', content: 'compacted', timestamp: Date.now() }],
    tokenEstimate: maxTokens * 0.8,
    droppedTurns: 2,
  })),
}));

vi.mock('../context/microCompactor.js', () => ({
  microCompactHistory: vi.fn((history: ConversationTurn[]) => ({
    history,
    removed: 0,
  })),
}));

import {
  calculateContextBudget,
  calculateReactiveBudget,
  type ContextBudget,
} from '../context/contextBudget.js';

import {
  isContextOverflowError,
  createReactiveState,
  recordReactiveAttempt,
  resetReactiveState,
  reactiveRecompose,
  type ReactiveCompactionState,
} from '../context/reactiveCompaction.js';

import {
  injectPostCompactContext,
  extractRecentToolSummaries,
  type PostCompactContext,
} from '../context/postCompactInjector.js';

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function makeTurn(
  role: ConversationTurn['role'],
  content: string,
  extra?: Partial<ConversationTurn>,
): ConversationTurn {
  return { role, content, timestamp: Date.now(), ...extra };
}

function makeToolResultTurn(
  toolName: string,
  output: string,
  success = true,
): ConversationTurn {
  return {
    role: 'tool_result',
    content: output,
    toolName,
    toolResult: { success, output } as ToolResult,
    timestamp: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// contextBudget.ts
// ═══════════════════════════════════════════════════════════════════

describe('calculateContextBudget', () => {
  it('returns correct budget for a large-window model (Gemini 1M)', () => {
    const budget = calculateContextBudget('gemini-2.5-pro');
    expect(budget.contextWindow).toBe(1_048_576);
    expect(budget.effectiveWindow).toBe(1_048_576 - 4_000 - 16_000);
    // rawBudget = (1_048_576 - 20_000) * 0.06 ≈ 61_714, clamped to ceiling 64_000
    expect(budget.compositionBudget).toBeLessThanOrEqual(64_000);
    expect(budget.compositionBudget).toBeGreaterThanOrEqual(8_000);
  });

  it('returns correct budget for a small-window model (32K)', () => {
    const budget = calculateContextBudget('small-model');
    expect(budget.contextWindow).toBe(32_000);
    const effectiveWindow = 32_000 - 4_000 - 16_000; // 12_000
    expect(budget.effectiveWindow).toBe(effectiveWindow);
    // rawBudget = 12_000 * 0.06 = 720, clamped to floor 8_000
    expect(budget.compositionBudget).toBe(8_000);
  });

  it('returns correct budget for a mid-range model (128K)', () => {
    const budget = calculateContextBudget('gpt-5');
    expect(budget.contextWindow).toBe(128_000);
    const effectiveWindow = 128_000 - 4_000 - 16_000;
    expect(budget.effectiveWindow).toBe(effectiveWindow);
    // rawBudget = 108_000 * 0.06 = 6_480, clamped to floor 8_000
    expect(budget.compositionBudget).toBe(8_000);
  });

  it('calculates warningThreshold at 85% of compositionBudget', () => {
    const budget = calculateContextBudget('gemini-2.5-pro');
    expect(budget.warningThreshold).toBe(Math.round(budget.compositionBudget * 0.85));
  });

  it('calculates hardLimit at 130% of compositionBudget', () => {
    const budget = calculateContextBudget('gemini-2.5-pro');
    expect(budget.hardLimit).toBe(Math.round(budget.compositionBudget * 1.3));
  });

  it('respects custom budgetRatio', () => {
    const budget = calculateContextBudget('gemini-2.5-pro', 0.10);
    const effectiveWindow = 1_048_576 - 4_000 - 16_000;
    const rawBudget = Math.round(effectiveWindow * 0.10);
    // rawBudget ≈ 102_857, clamped to ceiling 64_000
    expect(budget.compositionBudget).toBe(64_000);
  });

  it('falls back to 128K for unknown models', () => {
    const budget = calculateContextBudget('unknown-model');
    expect(budget.contextWindow).toBe(128_000);
  });
});

describe('calculateReactiveBudget', () => {
  it('returns 60% of the normal budget', () => {
    const normal = calculateContextBudget('gemini-2.5-pro');
    const reactive = calculateReactiveBudget(normal);
    expect(reactive.compositionBudget).toBe(
      Math.max(8_000, Math.round(normal.compositionBudget * 0.6)),
    );
  });

  it('respects the 8K floor', () => {
    // Create a budget where 60% would dip below 8K
    const lowBudget: ContextBudget = {
      contextWindow: 32_000,
      effectiveWindow: 12_000,
      compositionBudget: 8_000,
      warningThreshold: 6_800,
      hardLimit: 10_400,
    };
    const reactive = calculateReactiveBudget(lowBudget);
    // 8_000 * 0.6 = 4_800, clamped to floor 8_000
    expect(reactive.compositionBudget).toBe(8_000);
  });

  it('preserves contextWindow and effectiveWindow from the normal budget', () => {
    const normal = calculateContextBudget('gpt-5');
    const reactive = calculateReactiveBudget(normal);
    expect(reactive.contextWindow).toBe(normal.contextWindow);
    expect(reactive.effectiveWindow).toBe(normal.effectiveWindow);
  });

  it('recalculates warningThreshold and hardLimit for the new budget', () => {
    const normal = calculateContextBudget('gemini-2.5-pro');
    const reactive = calculateReactiveBudget(normal);
    expect(reactive.warningThreshold).toBe(Math.round(reactive.compositionBudget * 0.85));
    expect(reactive.hardLimit).toBe(Math.round(reactive.compositionBudget * 1.3));
  });
});

// ═══════════════════════════════════════════════════════════════════
// reactiveCompaction.ts
// ═══════════════════════════════════════════════════════════════════

describe('isContextOverflowError', () => {
  it.each([
    ['Gemini', 'RESOURCE_EXHAUSTED: token count exceeds limit'],
    ['Gemini token limit', 'Request failed with token limit exceeded'],
    ['OpenAI', "This model's maximum context length is 128000 tokens. context_length_exceeded"],
    ['OpenAI alt', "maximum context length exceeded"],
    ['Anthropic', 'prompt is too long for this model'],
    ['Anthropic alt', 'Error: prompt_too_long'],
    ['input too long', 'The input is too long for this model'],
    ['request too large', 'request too large for this endpoint'],
  ])('detects %s overflow pattern', (_provider, message) => {
    expect(isContextOverflowError(new Error(message))).toBe(true);
  });

  it.each([
    ['rate limit', 'RATE_LIMIT_EXCEEDED'],
    ['auth error', 'Invalid API key'],
    ['generic', 'Something went wrong'],
    ['empty', ''],
  ])('does not false-positive on %s', (_label, message) => {
    expect(isContextOverflowError(new Error(message))).toBe(false);
  });

  it('handles null/undefined errors', () => {
    expect(isContextOverflowError(null)).toBe(false);
    expect(isContextOverflowError(undefined)).toBe(false);
  });

  it('handles string errors', () => {
    expect(isContextOverflowError('prompt is too long')).toBe(true);
  });

  it('handles nested error objects', () => {
    const err = { error: { message: 'context_length_exceeded' } };
    expect(isContextOverflowError(err)).toBe(true);
  });

  it('handles object with error string', () => {
    const err = { error: 'RESOURCE_EXHAUSTED' };
    expect(isContextOverflowError(err)).toBe(true);
  });
});

describe('ReactiveCompactionState', () => {
  let state: ReactiveCompactionState;

  beforeEach(() => {
    state = createReactiveState();
  });

  it('creates initial state with defaults', () => {
    expect(state.consecutiveCount).toBe(0);
    expect(state.maxRetries).toBe(3);
    expect(state.circuitBroken).toBe(false);
    expect(state.lastBudget).toBeNull();
  });

  it('allows custom max retries', () => {
    const custom = createReactiveState(5);
    expect(custom.maxRetries).toBe(5);
  });

  it('permits retry within limit', () => {
    expect(recordReactiveAttempt(state)).toBe(true);
    expect(state.consecutiveCount).toBe(1);
    expect(state.circuitBroken).toBe(false);
  });

  it('permits retries up to maxRetries', () => {
    expect(recordReactiveAttempt(state)).toBe(true); // 1
    expect(recordReactiveAttempt(state)).toBe(true); // 2
    expect(recordReactiveAttempt(state)).toBe(true); // 3
    expect(state.circuitBroken).toBe(false);
  });

  it('trips circuit breaker on maxRetries + 1', () => {
    recordReactiveAttempt(state); // 1
    recordReactiveAttempt(state); // 2
    recordReactiveAttempt(state); // 3
    expect(recordReactiveAttempt(state)).toBe(false); // 4 → tripped
    expect(state.circuitBroken).toBe(true);
  });

  it('resets state after successful model call', () => {
    recordReactiveAttempt(state);
    recordReactiveAttempt(state);
    resetReactiveState(state);
    expect(state.consecutiveCount).toBe(0);
    expect(state.circuitBroken).toBe(false);
    expect(state.lastBudget).toBeNull();
  });
});

describe('reactiveRecompose', () => {
  it('returns recomposed history on first attempt', () => {
    const state = createReactiveState();
    const normalBudget = calculateContextBudget('gpt-5');
    const result = reactiveRecompose({
      history: [makeTurn('user', 'hello'), makeTurn('assistant', 'hi')],
      role: 'devops-engineer',
      task: 'Fix deploy pipeline',
      initialMessage: 'Deploy is broken',
      turnNumber: 5,
      normalBudget,
      state,
    });

    expect(result).not.toBeNull();
    expect(result!.history).toHaveLength(1); // mocked composeModelContext returns 1 turn
    expect(result!.tokenEstimate).toBeGreaterThan(0);
    expect(result!.budgetUsed.compositionBudget).toBeLessThan(normalBudget.compositionBudget);
    expect(state.consecutiveCount).toBe(1);
  });

  it('returns null when circuit breaker is already tripped', () => {
    const state = createReactiveState();
    state.circuitBroken = true;

    const result = reactiveRecompose({
      history: [makeTurn('user', 'hello')],
      role: 'ops',
      task: 'test',
      initialMessage: 'test',
      turnNumber: 1,
      normalBudget: calculateContextBudget('gpt-5'),
      state,
    });

    expect(result).toBeNull();
  });

  it('returns null after exhausting max retries', () => {
    const state = createReactiveState(1); // max 1 retry
    const budget = calculateContextBudget('gpt-5');
    const input = {
      history: [makeTurn('user', 'hello')],
      role: 'ops',
      task: 'test',
      initialMessage: 'test',
      turnNumber: 1,
      normalBudget: budget,
      state,
    };

    // First attempt succeeds
    const first = reactiveRecompose(input);
    expect(first).not.toBeNull();

    // Second attempt trips circuit breaker
    const second = reactiveRecompose(input);
    expect(second).toBeNull();
    expect(state.circuitBroken).toBe(true);
  });

  it('progressively tightens budget across retries', () => {
    const state = createReactiveState(3);
    const budget = calculateContextBudget('gemini-2.5-pro');
    const input = {
      history: [makeTurn('user', 'hello')],
      role: 'ops',
      task: 'test',
      initialMessage: 'test',
      turnNumber: 1,
      normalBudget: budget,
      state,
    };

    const r1 = reactiveRecompose(input)!;
    const r2 = reactiveRecompose(input)!;

    // Each retry uses 60% of the previous budget
    expect(r2.budgetUsed.compositionBudget).toBeLessThanOrEqual(r1.budgetUsed.compositionBudget);
  });
});

// ═══════════════════════════════════════════════════════════════════
// postCompactInjector.ts
// ═══════════════════════════════════════════════════════════════════

describe('injectPostCompactContext', () => {
  const baseHistory: ConversationTurn[] = [
    makeTurn('user', '[SYSTEM FRAME] You are an agent'),
    makeTurn('user', 'Please fix the login bug'),
    makeTurn('assistant', 'I will look at the code'),
  ];

  it('does nothing when droppedGroups is 0', () => {
    const context: PostCompactContext = { taskDescription: 'Fix login bug' };
    const result = injectPostCompactContext(baseHistory, context, 0);
    expect(result.history).toBe(baseHistory); // same reference
    expect(result.injectedTurns).toBe(0);
    expect(result.injectedTokenEstimate).toBe(0);
  });

  it('injects task description when groups were dropped', () => {
    const context: PostCompactContext = {
      taskDescription: 'Fix the authentication flow in the login page',
    };
    const result = injectPostCompactContext(baseHistory, context, 3);
    expect(result.injectedTurns).toBe(1);
    expect(result.history.length).toBe(baseHistory.length + 1);

    const injectedTurn = result.history.find(t =>
      t.content.includes('[POST-COMPACT CONTEXT] Task reminder'),
    );
    expect(injectedTurn).toBeDefined();
    expect(injectedTurn!.content).toContain('Fix the authentication flow');
  });

  it('injects active skills', () => {
    const context: PostCompactContext = {
      activeSkills: ['code_search', 'code_edit', 'github_pr'],
    };
    const result = injectPostCompactContext(baseHistory, context, 2);
    const injectedTurn = result.history.find(t =>
      t.content.includes('Available skills'),
    );
    expect(injectedTurn).toBeDefined();
    expect(injectedTurn!.content).toContain('code_search');
  });

  it('injects working state facts', () => {
    const context: PostCompactContext = {
      workingState: [
        'User prefers TypeScript',
        'Login bug is in auth.ts line 42',
      ],
    };
    const result = injectPostCompactContext(baseHistory, context, 1);
    const injectedTurn = result.history.find(t =>
      t.content.includes('Key context from this run'),
    );
    expect(injectedTurn).toBeDefined();
    expect(injectedTurn!.content).toContain('User prefers TypeScript');
    expect(injectedTurn!.content).toContain('auth.ts line 42');
  });

  it('injects recent tool summaries', () => {
    const context: PostCompactContext = {
      recentToolSummaries: [
        { toolName: 'read_file', summary: 'Contents of auth.ts: export function login...' },
        { toolName: 'grep_search', summary: 'Found 3 matches for "password"' },
      ],
    };
    const result = injectPostCompactContext(baseHistory, context, 2);
    const injectedTurn = result.history.find(t =>
      t.content.includes('Recent tool results'),
    );
    expect(injectedTurn).toBeDefined();
    expect(injectedTurn!.content).toContain('[read_file]');
    expect(injectedTurn!.content).toContain('[grep_search]');
  });

  it('injects ALL context types when all are provided', () => {
    const context: PostCompactContext = {
      taskDescription: 'Fix login',
      activeSkills: ['code_edit'],
      workingState: ['Bug in auth.ts'],
      recentToolSummaries: [{ toolName: 'read_file', summary: 'file contents' }],
    };
    const result = injectPostCompactContext(baseHistory, context, 5);
    expect(result.injectedTurns).toBe(4); // task + skills + state + tools
    expect(result.injectedTokenEstimate).toBeGreaterThan(0);
  });

  it('places injections after the last system frame turn', () => {
    const history: ConversationTurn[] = [
      makeTurn('user', '[SYSTEM FRAME] Frame 1'),
      makeTurn('user', '[SESSION SUMMARY] Summary'),
      makeTurn('user', 'User query'),
      makeTurn('assistant', 'Response'),
    ];
    const context: PostCompactContext = { taskDescription: 'Test task' };
    const result = injectPostCompactContext(history, context, 1);

    // Should be after [SESSION SUMMARY] (index 1), before user query (index 2)
    const injectedIdx = result.history.findIndex(t =>
      t.content.includes('[POST-COMPACT CONTEXT]'),
    );
    expect(injectedIdx).toBe(2); // after last frame turn
  });

  it('places injections at start if no frame turns', () => {
    const history: ConversationTurn[] = [
      makeTurn('user', 'Hello'),
      makeTurn('assistant', 'Hi there'),
    ];
    const context: PostCompactContext = { taskDescription: 'Test' };
    const result = injectPostCompactContext(history, context, 1);

    const injectedIdx = result.history.findIndex(t =>
      t.content.includes('[POST-COMPACT CONTEXT]'),
    );
    expect(injectedIdx).toBe(0); // at the start
  });

  it('truncates long task descriptions', () => {
    const longTask = 'A'.repeat(5_000);
    const context: PostCompactContext = { taskDescription: longTask };
    const result = injectPostCompactContext(baseHistory, context, 1);
    const injected = result.history.find(t =>
      t.content.includes('[POST-COMPACT CONTEXT]'),
    );
    expect(injected).toBeDefined();
    // The content should be clipped (2000 chars max for task)
    expect(injected!.content.length).toBeLessThan(5_000);
    expect(injected!.content).toContain('[truncated]');
  });
});

describe('extractRecentToolSummaries', () => {
  it('extracts last N successful tool results', () => {
    const history: ConversationTurn[] = [
      makeToolResultTurn('read_file', 'file A contents'),
      makeToolResultTurn('grep_search', 'found 5 matches'),
      makeToolResultTurn('code_edit', 'edit applied'),
      makeTurn('assistant', 'Done editing'),
    ];

    const summaries = extractRecentToolSummaries(history, 2);
    expect(summaries).toHaveLength(2);
    expect(summaries[0].toolName).toBe('grep_search');
    expect(summaries[1].toolName).toBe('code_edit');
  });

  it('skips failed tool results', () => {
    const history: ConversationTurn[] = [
      makeToolResultTurn('read_file', 'contents', true),
      makeToolResultTurn('bad_tool', 'error', false),
      makeToolResultTurn('grep_search', 'results', true),
    ];

    const summaries = extractRecentToolSummaries(history, 3);
    expect(summaries).toHaveLength(2);
    expect(summaries.map(s => s.toolName)).toEqual(['read_file', 'grep_search']);
  });

  it('returns empty array for history with no tool results', () => {
    const history: ConversationTurn[] = [
      makeTurn('user', 'hello'),
      makeTurn('assistant', 'hi'),
    ];
    expect(extractRecentToolSummaries(history)).toEqual([]);
  });

  it('defaults to max 3 tools', () => {
    const history: ConversationTurn[] = [
      makeToolResultTurn('t1', 'r1'),
      makeToolResultTurn('t2', 'r2'),
      makeToolResultTurn('t3', 'r3'),
      makeToolResultTurn('t4', 'r4'),
      makeToolResultTurn('t5', 'r5'),
    ];
    const summaries = extractRecentToolSummaries(history);
    expect(summaries).toHaveLength(3);
    expect(summaries[0].toolName).toBe('t3');
    expect(summaries[2].toolName).toBe('t5');
  });

  it('condenses long tool output to summary', () => {
    const longOutput = 'word '.repeat(1000);
    const history: ConversationTurn[] = [
      makeToolResultTurn('read_file', longOutput),
    ];
    const summaries = extractRecentToolSummaries(history);
    expect(summaries[0].summary.length).toBeLessThan(longOutput.length);
    expect(summaries[0].summary).toContain('[truncated]');
  });

  it('uses "unknown" for missing tool names', () => {
    const history: ConversationTurn[] = [{
      role: 'tool_result' as const,
      content: 'some output',
      toolResult: { success: true, output: 'some output' } as ToolResult,
      timestamp: Date.now(),
    }];
    const summaries = extractRecentToolSummaries(history);
    expect(summaries[0].toolName).toBe('unknown');
  });
});

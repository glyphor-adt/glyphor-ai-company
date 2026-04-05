import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  generateAwaySummary,
  buildAwaySummaryPrompt,
  isIdleLongEnough,
  hasRecentAwaySummary,
  formatAwaySummaryTurn,
  type AwaySummaryConfig,
  type AwaySummaryInput,
} from '../awaySummary.js';
import type { ConversationTurn, CompanyAgentRole } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────

const DEVOPS: CompanyAgentRole = 'devops-engineer';
const CTO: CompanyAgentRole = 'cto';

function turn(role: ConversationTurn['role'], content: string): ConversationTurn {
  return { role, content, timestamp: Date.now() };
}

function sampleHistory(count = 10): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (let i = 0; i < count; i++) {
    turns.push(turn(i % 2 === 0 ? 'user' : 'assistant', `Message ${i + 1}`));
  }
  return turns;
}

function defaultInput(overrides?: Partial<AwaySummaryInput>): AwaySummaryInput {
  return {
    messages: sampleHistory(),
    agentRole: DEVOPS,
    conversationId: 'test-run-001',
    ...overrides,
  };
}

// ─── Mock ModelClient ────────────────────────────────────────────

function createMockModelClient(responseText = 'Building auth module. Next step: fix null pointer in validate.ts.') {
  return {
    generate: vi.fn().mockResolvedValue({
      text: responseText,
      toolCalls: [],
      usageMetadata: { inputTokens: 200, outputTokens: 30, totalTokens: 230 },
      finishReason: 'STOP',
      actualModel: 'gemini-2.0-flash',
    }),
  } as any;
}

// ═════════════════════════════════════════════════════════════════
// buildAwaySummaryPrompt
// ═════════════════════════════════════════════════════════════════

describe('buildAwaySummaryPrompt()', () => {
  it('produces a focused prompt without session memory', () => {
    const prompt = buildAwaySummaryPrompt();
    expect(prompt).toContain('1-3 short sentences');
    expect(prompt).toContain('high-level task');
    expect(prompt).toContain('concrete next step');
    expect(prompt).not.toContain('Session context');
  });

  it('prepends session memory block when provided', () => {
    const prompt = buildAwaySummaryPrompt('Working on auth refactor, 3 PRs merged');
    expect(prompt).toContain('Session context (broader scope):');
    expect(prompt).toContain('Working on auth refactor, 3 PRs merged');
    expect(prompt).toContain('1-3 short sentences');
  });

  it('handles null/undefined session memory gracefully', () => {
    expect(buildAwaySummaryPrompt(null)).not.toContain('Session context');
    expect(buildAwaySummaryPrompt(undefined)).not.toContain('Session context');
  });
});

// ═════════════════════════════════════════════════════════════════
// generateAwaySummary
// ═════════════════════════════════════════════════════════════════

describe('generateAwaySummary()', () => {
  it('returns generated summary on success', async () => {
    const client = createMockModelClient();
    const result = await generateAwaySummary(defaultInput(), client);

    expect(result.summary).toBe('Building auth module. Next step: fix null pointer in validate.ts.');
    expect(result.reason).toBe('generated');
    expect(result.model).toBe('gemini-2.0-flash');
    expect(result.usage?.inputTokens).toBe(200);
    expect(result.usage?.outputTokens).toBe(30);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('passes correct parameters to model client', async () => {
    const client = createMockModelClient();
    await generateAwaySummary(
      defaultInput({ sessionMemory: 'Auth refactor in progress' }),
      client,
      { model: 'gemini-2.0-flash', maxTokens: 100, temperature: 0.5 },
    );

    expect(client.generate).toHaveBeenCalledTimes(1);
    const call = client.generate.mock.calls[0][0];
    expect(call.model).toBe('gemini-2.0-flash');
    expect(call.maxTokens).toBe(100);
    expect(call.temperature).toBe(0.5);
    expect(call.tools).toEqual([]);
    expect(call.thinkingEnabled).toBe(false);
    expect(call.systemInstruction).toContain('Auth refactor in progress');
    expect(call.contents.length).toBeLessThanOrEqual(30);
  });

  it('truncates messages to recentMessageWindow', async () => {
    const client = createMockModelClient();
    await generateAwaySummary(
      defaultInput({ messages: sampleHistory(50) }),
      client,
      { recentMessageWindow: 10 },
    );

    const call = client.generate.mock.calls[0][0];
    expect(call.contents).toHaveLength(10);
    // Should be the LAST 10 messages
    expect(call.contents[0].content).toBe('Message 41');
    expect(call.contents[9].content).toBe('Message 50');
  });

  it('returns disabled when config.enabled is false', async () => {
    const client = createMockModelClient();
    const result = await generateAwaySummary(defaultInput(), client, { enabled: false });

    expect(result.summary).toBeNull();
    expect(result.reason).toBe('disabled');
    expect(client.generate).not.toHaveBeenCalled();
  });

  it('returns no_messages when history is empty', async () => {
    const client = createMockModelClient();
    const result = await generateAwaySummary(
      defaultInput({ messages: [] }),
      client,
    );

    expect(result.summary).toBeNull();
    expect(result.reason).toBe('no_messages');
  });

  it('returns aborted when signal is already aborted', async () => {
    const client = createMockModelClient();
    const controller = new AbortController();
    controller.abort();

    const result = await generateAwaySummary(
      defaultInput(),
      client,
      {},
      controller.signal,
    );

    expect(result.summary).toBeNull();
    expect(result.reason).toBe('aborted');
    expect(client.generate).not.toHaveBeenCalled();
  });

  it('returns error when model returns empty text', async () => {
    const client = createMockModelClient('');
    const result = await generateAwaySummary(defaultInput(), client);

    expect(result.summary).toBeNull();
    expect(result.reason).toBe('error');
  });

  it('returns error and does not throw when model call fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = {
      generate: vi.fn().mockRejectedValue(new Error('API rate limited')),
    } as any;

    const result = await generateAwaySummary(defaultInput(), client);

    expect(result.summary).toBeNull();
    expect(result.reason).toBe('error');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AwaySummary]'),
      expect.stringContaining('API rate limited'),
    );
    warnSpy.mockRestore();
  });

  it('returns aborted when model call fails due to abort', async () => {
    const controller = new AbortController();
    const client = {
      generate: vi.fn().mockImplementation(() => {
        controller.abort();
        throw new Error('AbortError');
      }),
    } as any;

    const result = await generateAwaySummary(
      defaultInput(),
      client,
      {},
      controller.signal,
    );

    expect(result.summary).toBeNull();
    expect(result.reason).toBe('aborted');
  });

  it('uses default config values when not specified', async () => {
    const client = createMockModelClient();
    await generateAwaySummary(defaultInput(), client);

    const call = client.generate.mock.calls[0][0];
    expect(call.model).toBe('gemini-2.0-flash');
    expect(call.maxTokens).toBe(150);
    expect(call.temperature).toBe(0.3);
  });
});

// ═════════════════════════════════════════════════════════════════
// isIdleLongEnough
// ═════════════════════════════════════════════════════════════════

describe('isIdleLongEnough()', () => {
  it('returns true when idle exceeds threshold', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(isIdleLongEnough(tenMinAgo)).toBe(true); // Default 5 min threshold
  });

  it('returns false when idle is below threshold', () => {
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    expect(isIdleLongEnough(twoMinAgo)).toBe(false);
  });

  it('accepts custom threshold in ms', () => {
    const thirtySecAgo = new Date(Date.now() - 30_000).toISOString();
    expect(isIdleLongEnough(thirtySecAgo, 20_000)).toBe(true);
    expect(isIdleLongEnough(thirtySecAgo, 60_000)).toBe(false);
  });

  it('accepts epoch ms as input', () => {
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    expect(isIdleLongEnough(tenMinAgo)).toBe(true);
  });

  it('returns false for null/undefined', () => {
    expect(isIdleLongEnough(null)).toBe(false);
    expect(isIdleLongEnough(undefined)).toBe(false);
  });

  it('returns false for invalid date strings', () => {
    expect(isIdleLongEnough('not-a-date')).toBe(false);
    expect(isIdleLongEnough('')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════
// hasRecentAwaySummary
// ═════════════════════════════════════════════════════════════════

describe('hasRecentAwaySummary()', () => {
  it('returns false when no summary marker exists', () => {
    const messages = [
      turn('user', 'Hello'),
      turn('assistant', 'Hi there'),
    ];
    expect(hasRecentAwaySummary(messages)).toBe(false);
  });

  it('returns false when marker is before the last user turn', () => {
    const messages = [
      turn('user', '[AWAY SUMMARY] Working on auth'),
      turn('user', 'What happened?'),
      turn('assistant', 'Here is the update'),
    ];
    // The marker is before a user turn, so it's stale
    expect(hasRecentAwaySummary(messages)).toBe(false);
  });

  it('returns false for empty messages', () => {
    expect(hasRecentAwaySummary([])).toBe(false);
  });

  it('supports custom marker', () => {
    const messages = [
      turn('tool_result', '[CUSTOM_MARKER] Recap text'),
    ];
    expect(hasRecentAwaySummary(messages, '[CUSTOM_MARKER]')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// formatAwaySummaryTurn
// ═════════════════════════════════════════════════════════════════

describe('formatAwaySummaryTurn()', () => {
  it('produces a user turn with marker and summary', () => {
    const turn = formatAwaySummaryTurn('Working on auth module. Next: fix null pointer.');
    expect(turn.role).toBe('user');
    expect(turn.content).toContain('[AWAY SUMMARY');
    expect(turn.content).toContain('Do NOT respond');
    expect(turn.content).toContain('Where you left off');
    expect(turn.content).toContain('Working on auth module. Next: fix null pointer.');
  });

  it('is detectable by hasRecentAwaySummary', () => {
    const summaryTurn = formatAwaySummaryTurn('Building auth module.');
    expect(hasRecentAwaySummary([summaryTurn])).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// Integration Scenario
// ═════════════════════════════════════════════════════════════════

describe('integration scenario', () => {
  it('full flow: idle check → generate → format → deduplicate', async () => {
    const lastRunAt = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 min ago
    const history = sampleHistory(20);
    const client = createMockModelClient('Debugging CI pipeline. Next step: check flaky test in auth suite.');

    // 1. Check idle
    expect(isIdleLongEnough(lastRunAt)).toBe(true);

    // 2. No existing summary
    expect(hasRecentAwaySummary(history)).toBe(false);

    // 3. Generate
    const result = await generateAwaySummary(
      {
        messages: history,
        agentRole: DEVOPS,
        sessionMemory: 'CI pipeline failing since Tuesday',
        conversationId: 'run-2026-04-05',
      },
      client,
    );
    expect(result.summary).toBeTruthy();

    // 4. Format and inject
    const summaryTurn = formatAwaySummaryTurn(result.summary!);
    history.push(summaryTurn);

    // 5. Deduplication: should not inject again
    expect(hasRecentAwaySummary(history)).toBe(true);
  });
});

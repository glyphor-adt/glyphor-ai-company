import { describe, expect, it } from 'vitest';
import { compressHistory } from '../historyManager.js';
import type { ConversationTurn } from '../types.js';

function makeTurn(role: ConversationTurn['role'], content: string, toolName?: string): ConversationTurn {
  return {
    role,
    content,
    toolName,
    timestamp: Date.now(),
  };
}

describe('compressHistory', () => {
  it('returns the original history when already under budget', () => {
    const history = [makeTurn('user', 'hello'), makeTurn('assistant', 'hi')];
    expect(compressHistory(history, { maxHistoryTokens: 1000, keepRecentTurns: 3, toolResultMaxTokens: 100, summarizeToolResults: true })).toEqual(history);
  });

  it('injects a compressed summary and preserves the recent tail', () => {
    const history = Array.from({ length: 12 }, (_, index) =>
      index % 2 === 0
        ? makeTurn('user', `User turn ${index} ${'x'.repeat(300)}`)
        : makeTurn('assistant', `Assistant turn ${index} ${'y'.repeat(300)}`),
    );

    const compressed = compressHistory(history, {
      maxHistoryTokens: 400,
      keepRecentTurns: 2,
      toolResultMaxTokens: 120,
      summarizeToolResults: true,
    });

    expect(compressed[0]?.content).toContain('Compressed prior context');
    expect(compressed.at(-1)?.content).toContain('Assistant turn 11');
  });

  it('truncates older tool results in the compressed summary', () => {
    const history: ConversationTurn[] = [
      makeTurn('user', `Need a report ${'a'.repeat(200)}`),
      makeTurn('tool_result', `Result payload ${'b'.repeat(800)}`, 'get_platform_health'),
      makeTurn('assistant', `Done ${'c'.repeat(200)}`),
      makeTurn('user', `Follow-up ${'d'.repeat(200)}`),
      makeTurn('assistant', `Latest answer ${'e'.repeat(200)}`),
    ];

    const compressed = compressHistory(history, {
      maxHistoryTokens: 200,
      keepRecentTurns: 1,
      toolResultMaxTokens: 80,
      summarizeToolResults: true,
    });

    expect(compressed[0]?.content).toContain('Compressed prior context');
    expect(compressed[0]?.content.length).toBeLessThan(history[1].content.length + 400);
    expect(compressed.length).toBeLessThan(history.length);
  });
});

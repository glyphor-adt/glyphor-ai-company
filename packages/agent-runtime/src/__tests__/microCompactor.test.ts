import { describe, expect, it } from 'vitest';
import { microCompactHistory } from '../context/microCompactor.js';
import type { ConversationTurn } from '../types.js';

function toolResultTurn(
  toolName: string,
  content: string,
  success = true,
  timestamp = Date.now(),
): ConversationTurn {
  return {
    role: 'tool_result',
    toolName,
    content,
    timestamp,
    toolResult: { success, data: success ? { ok: true } : undefined, error: success ? undefined : 'failed' },
  };
}

describe('microCompactHistory', () => {
  it('compacts older successful tool results and keeps recent ones intact', () => {
    const longText = 'x'.repeat(1800);
    const history: ConversationTurn[] = [
      { role: 'user', content: 'start', timestamp: 1 },
      toolResultTurn('get_a', longText, true, 2),
      toolResultTurn('get_b', longText, true, 3),
      toolResultTurn('get_c', longText, true, 4),
      toolResultTurn('get_d', longText, true, 5),
    ];

    const result = microCompactHistory(history, {
      keepRecentToolResults: 2,
      maxToolResultChars: 200,
    });

    expect(result.compactedTurns).toBe(2);
    expect(result.history[1].content.startsWith('[MICRO-COMPACTED tool_result:get_a]')).toBe(true);
    expect(result.history[2].content.startsWith('[MICRO-COMPACTED tool_result:get_b]')).toBe(true);
    expect(result.history[3].content).toBe(longText);
    expect(result.history[4].content).toBe(longText);
  });

  it('does not compact failed tool results', () => {
    const longText = 'y'.repeat(2000);
    const history: ConversationTurn[] = [
      toolResultTurn('get_failure', longText, false, 1),
      toolResultTurn('get_success', longText, true, 2),
      toolResultTurn('get_recent', longText, true, 3),
    ];

    const result = microCompactHistory(history, {
      keepRecentToolResults: 1,
      maxToolResultChars: 250,
    });

    expect(result.compactedTurns).toBe(1);
    expect(result.history[0].content).toBe(longText);
    expect(result.history[1].content.startsWith('[MICRO-COMPACTED tool_result:get_success]')).toBe(true);
    expect(result.history[2].content).toBe(longText);
  });
});

import { describe, expect, it } from 'vitest';
import { composeModelContext } from '../context/contextComposer.js';
import type { ConversationTurn } from '../types.js';

function longTurn(
  role: ConversationTurn['role'],
  contentSeed: string,
  timestamp: number,
): ConversationTurn {
  return {
    role,
    content: `${contentSeed} ${'x'.repeat(1600)}`,
    timestamp,
  };
}

describe('summary-first compaction', () => {
  it('keeps session summary turn under compression pressure', () => {
    const history: ConversationTurn[] = [
      longTurn('user', 'Customer asked for migration sequence.', 1),
      longTurn('assistant', 'Provided initial migration approach.', 2),
      longTurn('tool_result', 'Tool output from migration checker.', 3),
      longTurn('assistant', 'Revised plan after tool output.', 4),
      longTurn('tool_result', 'Second tool output with constraints.', 5),
      longTurn('assistant', 'Final recommendation.', 6),
    ];

    const result = composeModelContext({
      history,
      role: 'cto',
      task: 'on_demand',
      initialMessage: 'Provide migration plan.',
      turnNumber: 4,
      maxTokens: 700,
      keepRecentGroups: 1,
      sessionSummary:
        'Session summary: customer requires phased rollout, rollback guardrails, and low-risk canary path.',
    });

    const hasSessionSummary = result.history.some((turn) =>
      turn.content.startsWith('[SESSION SUMMARY]'),
    );
    expect(hasSessionSummary).toBe(true);
  });

  it('does not inject session summary when absent', () => {
    const history: ConversationTurn[] = [
      { role: 'user', content: 'Help with launch checklist.', timestamp: 1 },
      { role: 'assistant', content: 'Starting checklist draft.', timestamp: 2 },
    ];

    const result = composeModelContext({
      history,
      role: 'chief-of-staff',
      task: 'on_demand',
      initialMessage: 'Need launch checklist.',
      turnNumber: 2,
      maxTokens: 1000,
      keepRecentGroups: 1,
    });

    const hasSessionSummary = result.history.some((turn) =>
      turn.content.startsWith('[SESSION SUMMARY]'),
    );
    expect(hasSessionSummary).toBe(false);
  });
});


import { describe, expect, it } from 'vitest';
import {
  SessionMemoryUpdater,
  buildSessionSummary,
  getSessionMemoryConfigFromEnv,
  type SessionMemoryStore,
  type SessionMemorySummaryRecord,
} from '../memory/sessionMemoryUpdater.js';
import type { ConversationTurn } from '../types.js';

class InMemorySessionStore implements SessionMemoryStore {
  private readonly records = new Map<string, SessionMemorySummaryRecord>();

  async getLatest(conversationId: string): Promise<SessionMemorySummaryRecord | null> {
    return this.records.get(conversationId) ?? null;
  }

  async upsert(record: SessionMemorySummaryRecord): Promise<void> {
    this.records.set(record.conversationId, record);
  }
}

function turn(role: ConversationTurn['role'], content: string, timestamp: number): ConversationTurn {
  return { role, content, timestamp };
}

describe('session memory updater', () => {
  it('parses environment config with sane defaults', () => {
    const config = getSessionMemoryConfigFromEnv({
      SESSION_MEMORY_ENABLED: 'true',
      SESSION_MEMORY_MIN_TURNS_BETWEEN_UPDATE: '3',
      SESSION_MEMORY_MIN_TOOL_CALLS_BETWEEN_UPDATE: '2',
      SESSION_MEMORY_MIN_TOKEN_DELTA: '900',
      SESSION_MEMORY_MAX_TOKENS: '700',
    });

    expect(config.enabled).toBe(true);
    expect(config.minTurnsBetweenUpdate).toBe(3);
    expect(config.minToolCallsBetweenUpdate).toBe(2);
    expect(config.minTokenDeltaBetweenUpdate).toBe(900);
    expect(config.maxSummaryTokens).toBe(700);
  });

  it('initializes baseline first and updates only after thresholds', async () => {
    const store = new InMemorySessionStore();
    const updater = new SessionMemoryUpdater(store, {
      enabled: true,
      minTurnsBetweenUpdate: 2,
      minToolCallsBetweenUpdate: 5,
      minTokenDeltaBetweenUpdate: 10_000,
      maxSummaryTokens: 200,
    });

    const history: ConversationTurn[] = [
      turn('user', 'Need a rollout plan.', 1),
      turn('assistant', 'I will draft one.', 2),
    ];

    const initial = await updater.maybeUpdate({
      config: { id: 'run-1', role: 'cto' },
      history,
      turnNumber: 1,
      latestAssistantText: 'I will draft one.',
    });
    expect(initial.updated).toBe(false);
    expect(initial.reason).toBe('baseline_initialized');

    const noThreshold = await updater.maybeUpdate({
      config: { id: 'run-1', role: 'cto' },
      history: [...history, turn('user', 'Any updates?', 3)],
      turnNumber: 2,
      latestAssistantText: 'I will draft one.',
    });
    expect(noThreshold.updated).toBe(false);
    expect(noThreshold.reason).toBe('threshold_not_met');

    const updated = await updater.maybeUpdate({
      config: { id: 'run-1', role: 'cto' },
      history: [
        ...history,
        turn('user', 'Any updates?', 3),
        turn('assistant', 'Yes, here is the finalized rollout checklist.', 4),
      ],
      turnNumber: 3,
      latestAssistantText: 'Yes, here is the finalized rollout checklist.',
    });
    expect(updated.updated).toBe(true);
    expect(updated.reason).toBe('updated');

    const persisted = await store.getLatest('run-1');
    expect(persisted).not.toBeNull();
    expect(persisted?.summaryText).toContain('LATEST_ASSISTANT_DECISION');
  });

  it('builds bounded summary output', () => {
    const history: ConversationTurn[] = [
      turn('user', 'A'.repeat(800), 1),
      turn('assistant', 'B'.repeat(800), 2),
      turn('tool_result', 'C'.repeat(800), 3),
    ];

    const summary = buildSessionSummary(history, 'D'.repeat(900), 60);
    expect(summary.length).toBeLessThanOrEqual(60 * 4);
    expect(summary).toContain('USER:');
  });
});


import { beforeEach, describe, expect, it, vi } from 'vitest';

import { learnFromAgentRun } from '../skillLearning.js';
import type { AgentExecutionResult } from '../types.js';

vi.mock('@glyphor/shared/db', () => ({
  systemQuery: vi.fn(),
}));

import { systemQuery } from '@glyphor/shared/db';

function buildResult(overrides: Partial<AgentExecutionResult> = {}): AgentExecutionResult {
  return {
    agentId: 'run-1',
    role: 'cfo',
    status: 'completed',
    output: 'Completed a high-quality financial analysis with clear recommendations and evidence.',
    totalTurns: 3,
    totalFilesWritten: 0,
    totalMemoryKeysWritten: 0,
    elapsedMs: 1000,
    inputTokens: 100,
    outputTokens: 120,
    thinkingTokens: 0,
    cachedInputTokens: 0,
    cost: 0.02,
    conversationHistory: [],
    actions: [
      {
        tool: 'query_financials',
        params: {},
        result: 'success',
        output: 'loaded revenue',
        timestamp: new Date().toISOString(),
      },
      {
        tool: 'query_costs',
        params: {},
        result: 'success',
        output: 'loaded costs',
        timestamp: new Date().toISOString(),
      },
    ],
    reasoningMeta: {
      passes: 1,
      confidence: 0.91,
      revised: false,
      costUsd: 0.001,
    },
    verificationMeta: {
      tier: 'self_critique',
      reason: 'test',
      passes: ['self_critique'],
    },
    ...overrides,
  };
}

describe('skillLearning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates an existing matching skill', async () => {
    vi.mocked(systemQuery)
      .mockResolvedValueOnce([
        { id: 'skill-1', slug: 'financial-reporting', name: 'Financial Reporting', tools_granted: ['query_financials', 'query_costs'] },
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    await learnFromAgentRun({
      result: buildResult(),
      agentRole: 'cfo',
      runId: 'run-1',
      taskType: 'weekly_usage_analysis',
      taskDescription: 'Prepare the monthly revenue forecast.',
    });

    expect(vi.mocked(systemQuery)).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE skills'),
      ['skill-1'],
    );
    expect(vi.mocked(systemQuery)).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_skills'),
      ['cfo', 'skill-1'],
    );
  });

  it('creates a proposed skill when no existing match is found', async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    vi.mocked(systemQuery)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    await learnFromAgentRun({
      result: buildResult({
        actions: [
          { tool: 'query_financials', params: {}, result: 'success', output: 'ok', timestamp: new Date().toISOString() },
          { tool: 'file_decision', params: {}, result: 'success', output: 'ok', timestamp: new Date().toISOString() },
        ],
      }),
      agentRole: 'cfo',
      runId: 'run-2',
      taskType: 'weekly_usage_analysis',
      taskDescription: 'Escalate a budget overrun and capture the learned response pattern.',
      glyphorEventBus: { emit } as any,
    });

    expect(vi.mocked(systemQuery)).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO proposed_skills'),
      expect.arrayContaining([expect.stringContaining('"sourceAgent":"cfo"'), 'cfo', ['run-2']]),
    );
    expect(emit).toHaveBeenCalled();
  });

  it('skips chat and low-signal runs', async () => {
    await learnFromAgentRun({
      result: buildResult({ totalTurns: 7 }),
      agentRole: 'cfo',
      runId: 'run-3',
      taskType: 'on_demand',
      taskDescription: 'Quick chat',
    });

    expect(vi.mocked(systemQuery)).not.toHaveBeenCalled();
  });
});

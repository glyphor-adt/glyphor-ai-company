import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  detectBehavioralAnomalies,
  loadBehaviorProfile,
  type BehaviorProfile,
} from '../behavioralFingerprint.js';

vi.mock('@glyphor/shared/db', () => ({
  systemQuery: vi.fn(),
}));

import { systemQuery } from '@glyphor/shared/db';

describe('behavioralFingerprint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags unusual message targets outside recent history', () => {
    const profile: BehaviorProfile = {
      agentRole: 'cto',
      normalToolPatterns: new Map([['deploy_to_staging', 1]]),
      normalKGAccessPatterns: [],
      normalMessageTargets: ['chief-of-staff', 'platform-engineer'],
      normalBudgetRange: [0.01, 0.04],
      normalTurnRange: [2, 8],
      baselinePeriod: '30 days',
    };

    const anomalies = detectBehavioralAnomalies(profile, {
      agentId: 'run-1',
      agentRole: 'cto',
      toolName: 'send_agent_message',
      params: { to_agent: 'cmo' },
      currentRunCostUsd: 0.02,
      currentRunToolCounts: new Map(),
    });

    expect(anomalies.some((anomaly) => anomaly.anomalyType === 'unusual_message_target')).toBe(true);
  });

  it('flags 3x historical cost spikes', () => {
    const profile: BehaviorProfile = {
      agentRole: 'cfo',
      normalToolPatterns: new Map(),
      normalKGAccessPatterns: [],
      normalMessageTargets: [],
      normalBudgetRange: [0.01, 0.05],
      normalTurnRange: [1, 6],
      baselinePeriod: '30 days',
    };

    const anomalies = detectBehavioralAnomalies(profile, {
      agentId: 'run-2',
      agentRole: 'cfo',
      toolName: 'write_financial_report',
      params: {},
      currentRunCostUsd: 0.18,
      currentRunToolCounts: new Map(),
    });

    expect(anomalies.some((anomaly) => anomaly.anomalyType === 'budget_spike')).toBe(true);
  });

  it('loads a behavior profile from historical runs, messages, and grants', async () => {
    vi.mocked(systemQuery)
      .mockResolvedValueOnce([
        { cost: 0.02, total_turns: 3 },
        { cost: 0.05, total_turns: 6 },
      ] as never)
      .mockResolvedValueOnce([
        { to_agent: 'chief-of-staff', count: '4' },
      ] as never)
      .mockResolvedValueOnce([
        { tool_name: 'deploy_to_staging' },
      ] as never);

    const profile = await loadBehaviorProfile('cto');

    expect(profile.normalMessageTargets).toEqual(['chief-of-staff']);
    expect(profile.normalToolPatterns.has('deploy_to_staging')).toBe(true);
    expect(profile.normalBudgetRange[1]).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';

import { determineVerificationTier } from '../verificationPolicy.js';

describe('determineVerificationTier', () => {
  it('skips verification for no-op runs', () => {
    const decision = determineVerificationTier({
      agentRole: 'ops',
      configId: 'ops-work_loop-2026-03-12',
      task: 'work_loop',
      trustScore: 0.5,
      turnsUsed: 1,
      mutationToolsCalled: [],
      output: 'No meaningful work found.',
    });

    expect(decision).toMatchObject({
      tier: 'none',
      passes: [],
      reason: 'no-op run',
      rubricId: 'noop',
    });
  });

  it('uses cross-model verification for external-facing outputs', () => {
    const decision = determineVerificationTier({
      agentRole: 'cmo',
      configId: 'cmo-publishing-2026-03-12',
      task: 'weekly_content_planning',
      trustScore: 0.8,
      turnsUsed: 4,
      mutationToolsCalled: ['publish_content'],
      output: 'Published the updated launch post.',
    });

    expect(decision.tier).toBe('cross_model');
    expect(decision.passes).toEqual(['self_critique', 'cross_model', 'contradiction_scan']);
    expect(decision.reason).toBe('external-facing output');
  });

  it('escalates financial numeric outputs to factual verification', () => {
    const decision = determineVerificationTier({
      agentRole: 'cfo',
      configId: 'cfo-daily_cost_check-2026-03-12',
      task: 'daily_cost_check',
      trustScore: 0.9,
      turnsUsed: 3,
      mutationToolsCalled: ['query_financials'],
      output: 'Projected spend is $12,430 with a 14.2% increase over last week.',
    });

    expect(decision.tier).toBe('cross_model');
    expect(decision.passes).toEqual(['self_critique', 'cross_model', 'factual_verification', 'contradiction_scan']);
  });

  it('returns conditional verification for trusted orchestration runs', () => {
    const decision = determineVerificationTier({
      agentRole: 'chief-of-staff',
      configId: 'chief-of-staff-orchestrate-2026-03-12',
      task: 'orchestrate',
      trustScore: 0.82,
      turnsUsed: 5,
      mutationToolsCalled: ['send_agent_message'],
      output: 'Delegated work to the research and finance teams.',
    });

    expect(decision.tier).toBe('conditional');
    expect(decision.passes).toEqual(['self_critique']);
    expect(decision.conditionalEscalationThreshold).toBe(0.8);
  });
});

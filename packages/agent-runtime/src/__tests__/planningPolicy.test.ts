import { describe, expect, it, vi } from 'vitest';
import { resolvePlanningPolicy } from '../planningPolicy.js';
import type { AgentConfig, CompanyAgentRole, ToolDefinition } from '../types.js';

function createConfig(role: CompanyAgentRole): AgentConfig {
  return {
    id: `${role}-on-demand-2026-04-02`,
    role,
    systemPrompt: 'test',
    model: 'gpt-5.4-mini',
    tools: [] as ToolDefinition[],
    maxTurns: 6,
    maxStallTurns: 2,
    timeoutMs: 30_000,
  };
}

describe('planningPolicy', () => {
  it('defaults strict roles to required mode on scheduled tasks', () => {
    const config = createConfig('frontend-engineer');
    const policy = resolvePlanningPolicy({
      role: 'frontend-engineer',
      task: 'implement_component',
      config,
      taskTierHint: true,
    });
    expect(policy.planningMode).toBe('required');
    expect(policy.completionGateEnabled).toBe(true);
  });

  it('defaults on_demand to off mode', () => {
    const config = createConfig('frontend-engineer');
    const policy = resolvePlanningPolicy({
      role: 'frontend-engineer',
      task: 'on_demand',
      config,
      taskTierHint: true,
    });
    expect(policy.planningMode).toBe('off');
    expect(policy.completionGateEnabled).toBe(false);
  });

  it('allows env overrides and respects explicit config overrides', () => {
    vi.stubEnv('AGENT_PLANNING_POLICY_JSON', JSON.stringify({
      default: { planningMode: 'auto', completionGateMaxRetries: 1 },
      roles: { 'content-creator': { planningMode: 'required' } },
      tasks: { on_demand: { planningMode: 'auto' } },
    }));

    const config = createConfig('content-creator');
    config.planningMode = 'off';
    config.completionGateEnabled = false;
    config.completionGateMaxRetries = 0;

    const policy = resolvePlanningPolicy({
      role: 'content-creator',
      task: 'on_demand',
      config,
      taskTierHint: true,
    });
    expect(policy.planningMode).toBe('off');
    expect(policy.completionGateEnabled).toBe(false);
    expect(policy.completionGateMaxRetries).toBe(0);

    vi.unstubAllEnvs();
  });
});

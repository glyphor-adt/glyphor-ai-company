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
    expect(policy.completionGateAutoRepairEnabled).toBe(false);
    expect(policy.planningModelTier).toBe('high');
    expect(policy.completionGateVerifyModelTier).toBe('high');
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
    expect(policy.completionGateAutoRepairEnabled).toBe(false);
  });

  it('disables planning for work_loop so task runners expose tools from turn 1', () => {
    const config = createConfig('cto');
    const policy = resolvePlanningPolicy({
      role: 'cto',
      task: 'work_loop',
      config,
      taskTierHint: true,
    });
    expect(policy.planningMode).toBe('off');
    expect(policy.completionGateEnabled).toBe(false);
  });

  it('disables planning for urgent_message_response so orchestrators can call tools immediately', () => {
    const config = createConfig('cto');
    const policy = resolvePlanningPolicy({
      role: 'cto',
      task: 'urgent_message_response',
      config,
      taskTierHint: false,
    });
    expect(policy.planningMode).toBe('off');
    expect(policy.completionGateEnabled).toBe(false);
  });

  it('allows env overrides and respects explicit config overrides', () => {
    vi.stubEnv('AGENT_PLANNING_POLICY_JSON', JSON.stringify({
      default: { planningMode: 'auto', completionGateMaxRetries: 1 },
      roles: { 'content-creator': { planningMode: 'required' } },
      tasks: { on_demand: { planningMode: 'auto', completionGateAutoRepairEnabled: true } },
    }));

    const config = createConfig('content-creator');
    config.planningMode = 'off';
    config.completionGateEnabled = false;
    config.completionGateMaxRetries = 0;
    config.completionGateAutoRepairEnabled = false;

    const policy = resolvePlanningPolicy({
      role: 'content-creator',
      task: 'on_demand',
      config,
      taskTierHint: true,
    });
    expect(policy.planningMode).toBe('off');
    expect(policy.completionGateEnabled).toBe(false);
    expect(policy.completionGateMaxRetries).toBe(0);
    expect(policy.completionGateAutoRepairEnabled).toBe(false);

    vi.unstubAllEnvs();
  });

  it('supports enabling auto-repair by role via env policy', () => {
    vi.stubEnv('AGENT_PLANNING_POLICY_JSON', JSON.stringify({
      roles: { 'platform-intel': { completionGateAutoRepairEnabled: true } },
    }));

    const config = createConfig('platform-intel');
    const policy = resolvePlanningPolicy({
      role: 'platform-intel',
      task: 'watch_tool_gaps',
      config,
      taskTierHint: true,
    });
    expect(policy.completionGateEnabled).toBe(true);
    expect(policy.completionGateAutoRepairEnabled).toBe(true);

    vi.unstubAllEnvs();
  });
});

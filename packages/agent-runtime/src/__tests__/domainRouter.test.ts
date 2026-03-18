import { describe, expect, it } from 'vitest';

import { inferCapabilities } from '../routing/inferCapabilities.js';
import { inferDomainRouting } from '../routing/domainRouter.js';
import { resolveModelConfig } from '../routing/resolveModel.js';

describe('domainRouter', () => {
  it('infers finance domain from role signal even with sparse prompt text', () => {
    const routing = inferDomainRouting({
      role: 'cfo',
      task: 'work_loop',
      message: 'Handle this assignment.',
      toolNames: ['list_messages'],
    });

    expect(routing.primaryDomain).toBe('finance');
    expect(routing.crossDomain).toBe(false);
  });

  it('flags cross-domain directives when multiple domain signals are strong', () => {
    const routing = inferDomainRouting({
      role: 'market-research-analyst',
      task: 'on_demand',
      message: 'Run legal compliance and contract review, then produce budget forecast and margin impact analysis.',
      toolNames: ['evaluate_assignment', 'query_costs'],
    });

    expect(routing.domains.length).toBeGreaterThanOrEqual(2);
    expect(routing.crossDomain).toBe(true);
  });
});

describe('domain-aware runtime routing', () => {
  it('adds finance capabilities from domain routing when explicit keywords are weak', () => {
    const capabilities = inferCapabilities({
      role: 'cfo',
      task: 'work_loop',
      message: 'Please handle this assignment.',
      toolNames: ['list_messages'],
      trustScore: 0.8,
    });

    expect(capabilities).toContain('financial_computation');
    expect(capabilities).toContain('needs_code_execution');
  });

  it('routes finance domain work away from nano defaults', async () => {
    const decision = await resolveModelConfig({
      role: 'cfo',
      task: 'on_demand',
      message: 'Please handle this assignment.',
      toolNames: ['list_messages'],
      trustScore: 0.8,
      currentModel: 'gpt-5-mini-2025-08-07',
    });

    expect(decision.routingRule).toBe('financial_complex');
    expect(decision.model).toContain('gpt-5.4');
    expect(decision.enableCodeExecution).toBe(true);
  });

  it('escalates cross-domain work with stronger reasoning settings', async () => {
    const decision = await resolveModelConfig({
      role: 'market-research-analyst',
      task: 'on_demand',
      message: 'Synthesize legal compliance findings, contract risks, and budget forecast recommendations from research evidence.',
      toolNames: ['evaluate_assignment', 'query_costs', 'web_search'],
      trustScore: 0.8,
      currentModel: 'gpt-5-mini-2025-08-07',
    });

    expect(decision.reasoningEffort).toBe('high');
    expect(decision.enableCompaction).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@glyphor/shared/db', () => ({
  systemQuery: vi.fn().mockResolvedValue([]),
}));

vi.mock('../dynamicToolExecutor.js', () => ({
  executeDynamicTool: vi.fn().mockResolvedValue(null),
}));

vi.mock('../toolReputationTracker.js', () => ({
  recordToolCall: vi.fn().mockResolvedValue(undefined),
  detectToolSource: vi.fn().mockReturnValue('static'),
}));

vi.mock('../behavioralFingerprint.js', () => ({
  detectBehavioralAnomalies: vi.fn().mockReturnValue([]),
  loadBehaviorProfile: vi.fn().mockResolvedValue(null),
  persistBehavioralAnomalies: vi.fn().mockResolvedValue(undefined),
}));

import { ToolExecutor } from '../toolExecutor.js';
import type { ToolContext, ToolDefinition } from '../types.js';
import { systemQuery } from '@glyphor/shared/db';

function buildContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    agentId: 'run-1',
    agentRole: 'chief-of-staff',
    turnNumber: 1,
    abortSignal: new AbortController().signal,
    memoryBus: {} as any,
    emitEvent: vi.fn(),
    ...overrides,
  };
}

describe('ToolExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(systemQuery).mockResolvedValue([] as never);
  });

  it('blocks high-stakes tools when cross-model verification returns BLOCK', async () => {
    const highStakesTool: ToolDefinition = {
      name: 'submit_assignment_output',
      description: 'Submit assignment output',
      parameters: {
        assignment_id: { type: 'string', description: 'Assignment ID', required: true },
        output: { type: 'string', description: 'Output payload', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: { sent: true } }),
    };

    const executor = new ToolExecutor([highStakesTool]);
    executor.setConstitutionalDeps({
      modelClient: {
        generate: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            agreement: 'disagree',
            confidence: 0.92,
            reasoning: 'The message makes an unsafe external commitment.',
            discrepancies: ['Contains an unsupported guarantee'],
            factual_errors: 0,
            safety_concerns: false,
          }),
        }),
      } as any,
    });

    const result = await executor.execute(
      'submit_assignment_output',
      { assignment_id: 'A-123', output: 'We guarantee 100% uptime forever.' },
      buildContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Tool call blocked by verification');
    expect(highStakesTool.execute).not.toHaveBeenCalled();
    expect(executor.getSecurityLog().some((event) => event.eventType === 'TOOL_VERIFICATION_BLOCK')).toBe(true);
  });

  it('allows high-stakes tools when cross-model verification approves', async () => {
    const highStakesTool: ToolDefinition = {
      name: 'submit_assignment_output',
      description: 'Submit assignment output',
      parameters: {
        assignment_id: { type: 'string', description: 'Assignment ID', required: true },
        output: { type: 'string', description: 'Output payload', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: { sent: true } }),
    };

    const executor = new ToolExecutor([highStakesTool]);
    executor.setConstitutionalDeps({
      modelClient: {
        generate: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            agreement: 'full',
            confidence: 0.88,
            reasoning: 'The message is safe and consistent with the requested action.',
            discrepancies: [],
            factual_errors: 0,
            safety_concerns: false,
          }),
        }),
      } as any,
    });

    const result = await executor.execute(
      'submit_assignment_output',
      { assignment_id: 'A-123', output: 'Here is the update you requested.' },
      buildContext(),
    );

    expect(result.success).toBe(true);
    expect(highStakesTool.execute).toHaveBeenCalledOnce();
  });

  it('omits provider-specific defer_loading from base tool declarations', () => {
    const deferredTool: ToolDefinition = {
      name: 'search_docs',
      description: 'Search internal docs',
      deferLoading: true,
      parameters: {
        query: { type: 'string', description: 'Search query', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };

    const executor = new ToolExecutor([deferredTool]);
    const declarations = executor.getDeclarations();

    expect(declarations).toHaveLength(1);
    expect(declarations[0]).not.toHaveProperty('defer_loading');
  });
});

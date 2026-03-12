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
    const sendEmailTool: ToolDefinition = {
      name: 'send_email',
      description: 'Send an email',
      parameters: {
        to: { type: 'string', description: 'Recipient', required: true },
        body: { type: 'string', description: 'Body', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: { sent: true } }),
    };

    const executor = new ToolExecutor([sendEmailTool]);
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
      'send_email',
      { to: 'customer@example.com', body: 'We guarantee 100% uptime forever.' },
      buildContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Tool call blocked by verification');
    expect(sendEmailTool.execute).not.toHaveBeenCalled();
    expect(executor.getSecurityLog().some((event) => event.eventType === 'TOOL_VERIFICATION_BLOCK')).toBe(true);
  });

  it('allows high-stakes tools when cross-model verification approves', async () => {
    const sendEmailTool: ToolDefinition = {
      name: 'send_email',
      description: 'Send an email',
      parameters: {
        to: { type: 'string', description: 'Recipient', required: true },
        body: { type: 'string', description: 'Body', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: { sent: true } }),
    };

    const executor = new ToolExecutor([sendEmailTool]);
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
      'send_email',
      { to: 'customer@example.com', body: 'Here is the update you requested.' },
      buildContext(),
    );

    expect(result.success).toBe(true);
    expect(sendEmailTool.execute).toHaveBeenCalledOnce();
  });
});

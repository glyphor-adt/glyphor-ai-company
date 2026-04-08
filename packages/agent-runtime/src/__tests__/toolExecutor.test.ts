import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@glyphor/shared', async () => {
  const actual = await vi.importActual<typeof import('@glyphor/shared')>('@glyphor/shared');
  return {
    ...actual,
    enforceCapacityTier: vi.fn().mockResolvedValue({
      proceed: true,
      requiresApproval: false,
      reason: 'Allowed in tests',
      registryEntryId: null,
    }),
    executeCommitment: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@glyphor/shared/db', () => ({
  systemQuery: vi.fn().mockResolvedValue([]),
}));

vi.mock('../disclosure.js', async () => {
  const actual = await vi.importActual<typeof import('../disclosure.js')>('../disclosure.js');
  return {
    ...actual,
    applyDisclosurePolicy: vi.fn().mockImplementation(async (_agentId, _communicationType, payload) => ({
      payload,
    })),
  };
});

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

import { invalidateBlockCache, ToolExecutor } from '../toolExecutor.js';
import type { ToolContext, ToolDefinition } from '../types.js';
import type { ToolHookRunner } from '../hooks/hookRunner.js';
import { systemQuery } from '@glyphor/shared/db';

function buildContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    agentId: 'run-1',
    agentRole: 'chief-of-staff',
    turnNumber: 1,
    assignmentId: 'A-CTX-1',
    abortSignal: new AbortController().signal,
    memoryBus: {} as any,
    emitEvent: vi.fn(),
    ...overrides,
  };
}

describe('ToolExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateBlockCache();
    vi.mocked(systemQuery).mockResolvedValue([] as never);
  });

  it('blocks non-live roles before execution', async () => {
    const tool: ToolDefinition = {
      name: 'search_docs',
      description: 'Search docs',
      parameters: {
        query: { type: 'string', description: 'Search query', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };

    const executor = new ToolExecutor([tool]);
    const result = await executor.execute(
      'search_docs',
      { query: 'architecture' },
      buildContext({ agentRole: 'platform-intel' as any }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('is not on the live runtime roster');
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('blocks tools that are missing from the active execution grant policy', async () => {
    vi.mocked(systemQuery).mockImplementation(async (query: string) => {
      if (query.includes('FROM agent_tool_grants')) {
        return [{ tool_name: 'other_tool', is_blocked: false }] as never;
      }
      return [] as never;
    });

    const tool: ToolDefinition = {
      name: 'search_docs',
      description: 'Search docs',
      parameters: {
        query: { type: 'string', description: 'Search query', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };

    const executor = new ToolExecutor([tool]);
    const result = await executor.execute(
      'search_docs',
      { query: 'pricing' },
      buildContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not granted');
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('allows tools that are present in the active execution grant policy', async () => {
    vi.mocked(systemQuery).mockImplementation(async (query: string) => {
      if (query.includes('FROM agent_tool_grants')) {
        return [{ tool_name: 'search_docs', is_blocked: false }] as never;
      }
      return [] as never;
    });

    const tool: ToolDefinition = {
      name: 'search_docs',
      description: 'Search docs',
      parameters: {
        query: { type: 'string', description: 'Search query', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };

    const executor = new ToolExecutor([tool]);
    const result = await executor.execute(
      'search_docs',
      { query: 'pricing' },
      buildContext(),
    );

    expect(result.success).toBe(true);
    expect(tool.execute).toHaveBeenCalledOnce();
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
      { assignment_id: 'A-CTX-1', output: 'We guarantee 100% uptime forever.' },
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
      { assignment_id: 'A-CTX-1', output: 'Here is the update you requested.' },
      buildContext(),
    );

    expect(result.success).toBe(true);
    expect(highStakesTool.execute).toHaveBeenCalledOnce();
  });

  it('blocks hard-gate tools before execution and records the risk level', async () => {
    const hardGateTool: ToolDefinition = {
      name: 'create_or_update_file',
      description: 'Update a shared file',
      parameters: {
        path: { type: 'string', description: 'Path', required: true },
        content: { type: 'string', description: 'Content', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: { updated: true } }),
    };

    const executor = new ToolExecutor([hardGateTool]);
    const result = await executor.execute(
      'create_or_update_file',
      { path: 'README.md', content: 'updated' },
      buildContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('requires approval before execution');
    expect(result.riskLevel).toBe('HARD_GATE');
    expect(result.approvalRequired).toBe(true);
    expect(hardGateTool.execute).not.toHaveBeenCalled();
    expect(executor.getSecurityLog().some((event) => event.eventType === 'ACTION_RISK_BLOCKED')).toBe(true);
    expect(executor.getCallLog()[0]?.riskLevel).toBe('HARD_GATE');
  });

  it('treats Calendar MCP CreateEvent aliases as hard-gated founder calendar writes', async () => {
    const mcpCalendarTool: ToolDefinition = {
      name: 'CreateEvent',
      description: 'Create a calendar event through Calendar MCP',
      parameters: {
        attendees: { type: 'array', description: 'Attendees', required: false, items: { type: 'string', description: 'Email' } },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: { created: true } }),
    };

    const executor = new ToolExecutor([mcpCalendarTool]);
    const result = await executor.execute(
      'mcp_CalendarTools/CreateEvent',
      { attendees: ['external@example.com'] },
      buildContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('requires approval before execution');
    expect(result.riskLevel).toBe('HARD_GATE');
    expect(result.approvalRequired).toBe(true);
    expect(mcpCalendarTool.execute).not.toHaveBeenCalled();
  });

  it('treats the Calendar MCP founder proof tool as hard-gated', async () => {
    const proofTool: ToolDefinition = {
      name: 'evaluate_calendar_mcp_founder_create_event',
      description: 'Proof-only founder calendar evaluation through Calendar MCP',
      parameters: {
        founder: { type: 'string', description: 'Founder key', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: { created: true } }),
    };

    const executor = new ToolExecutor([proofTool]);
    const result = await executor.execute(
      'evaluate_calendar_mcp_founder_create_event',
      { founder: 'kristina' },
      buildContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('requires approval before execution');
    expect(result.riskLevel).toBe('HARD_GATE');
    expect(result.approvalRequired).toBe(true);
    expect(proofTool.execute).not.toHaveBeenCalled();
  });

  it('classifies soft-gate tools without blocking execution', async () => {
    const softGateTool: ToolDefinition = {
      name: 'post_to_slack',
      description: 'Post to Slack',
      parameters: {
        channel: { type: 'string', description: 'Channel', required: true },
        message: { type: 'string', description: 'Message', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: { sent: true } }),
    };

    const executor = new ToolExecutor([softGateTool]);
    const result = await executor.execute(
      'post_to_slack',
      { channel: '#general', message: 'Hello' },
      buildContext(),
    );

    expect(result.success).toBe(true);
    expect(result.riskLevel).toBe('SOFT_GATE');
    expect(softGateTool.execute).toHaveBeenCalledOnce();
    expect(executor.getCallLog()[0]?.riskLevel).toBe('SOFT_GATE');
  });

  it('allows invoke_web_build to execute as a soft-gated tool', async () => {
    const webBuildTool: ToolDefinition = {
      name: 'invoke_web_build',
      description: 'Build a web app',
      parameters: {
        brief: { type: 'string', description: 'Build brief', required: true },
        tier: { type: 'string', description: 'Build tier', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: { projectId: 'proj_123' } }),
    };

    const executor = new ToolExecutor([webBuildTool]);
    const result = await executor.execute(
      'invoke_web_build',
      { brief: 'Weather monitoring landing page', tier: 'prototype' },
      buildContext(),
    );

    expect(result.success).toBe(true);
    expect(result.riskLevel).toBe('SOFT_GATE');
    expect(result.approvalRequired).not.toBe(true);
    expect(webBuildTool.execute).toHaveBeenCalledOnce();
  });

  it('classifies read-only tools as autonomous', async () => {
    const readOnlyTool: ToolDefinition = {
      name: 'search_docs',
      description: 'Search docs',
      parameters: {
        query: { type: 'string', description: 'Search query', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };

    const executor = new ToolExecutor([readOnlyTool]);
    const result = await executor.execute(
      'search_docs',
      { query: 'architecture' },
      buildContext(),
    );

    expect(result.success).toBe(true);
    expect(result.riskLevel).toBe('AUTONOMOUS');
    expect(readOnlyTool.execute).toHaveBeenCalledOnce();
    expect(executor.getCallLog()[0]?.riskLevel).toBe('AUTONOMOUS');
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

  it('blocks execution when pre-tool hook denies the call', async () => {
    const tool: ToolDefinition = {
      name: 'search_docs',
      description: 'Search docs',
      parameters: {
        query: { type: 'string', description: 'Query', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };

    const hookRunner: ToolHookRunner = {
      runPreToolUse: vi.fn().mockResolvedValue({
        allow: false,
        reason: 'Blocked by compliance policy',
      }),
      runPostToolUse: vi.fn().mockResolvedValue(undefined),
    };

    const executor = new ToolExecutor([tool]);
    executor.setToolHookRunner(hookRunner);

    const result = await executor.execute(
      'search_docs',
      { query: 'security playbook' },
      buildContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Blocked by compliance policy');
    expect(tool.execute).not.toHaveBeenCalled();
    expect(executor.getSecurityLog().some((event) => event.eventType === 'HOOK_BLOCKED')).toBe(true);
  });

  it('fails open on autonomous tools when pre-hook errors', async () => {
    const tool: ToolDefinition = {
      name: 'search_docs',
      description: 'Search docs',
      parameters: {
        query: { type: 'string', description: 'Query', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };

    const hookRunner: ToolHookRunner = {
      runPreToolUse: vi.fn().mockRejectedValue(new Error('hook offline')),
      runPostToolUse: vi.fn().mockResolvedValue(undefined),
    };

    const executor = new ToolExecutor([tool]);
    executor.setToolHookRunner(hookRunner);

    const result = await executor.execute(
      'search_docs',
      { query: 'pricing docs' },
      buildContext(),
    );

    expect(result.success).toBe(true);
    expect(tool.execute).toHaveBeenCalledOnce();
    expect(executor.getSecurityLog().some((event) => event.eventType === 'HOOK_ERROR')).toBe(true);
  });

  it('fails closed on non-autonomous tools when pre-hook errors', async () => {
    const tool: ToolDefinition = {
      name: 'post_to_slack',
      description: 'Post to Slack',
      parameters: {
        channel: { type: 'string', description: 'Channel', required: true },
        message: { type: 'string', description: 'Message', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: { sent: true } }),
    };

    const hookRunner: ToolHookRunner = {
      runPreToolUse: vi.fn().mockRejectedValue(new Error('hook offline')),
      runPostToolUse: vi.fn().mockResolvedValue(undefined),
    };

    const executor = new ToolExecutor([tool]);
    executor.setToolHookRunner(hookRunner);

    const result = await executor.execute(
      'post_to_slack',
      { channel: '#ops', message: 'hi' },
      buildContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Pre-tool hook failed');
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('skips pre-exec value gate for on_demand chat (dashboard trust model)', async () => {
    vi.stubEnv('TOOL_VALUE_GATE_CONFIDENCE_THRESHOLD', '0.99');
    const webBuildTool: ToolDefinition = {
      name: 'invoke_web_build',
      description: 'Build a web app',
      parameters: {
        brief: { type: 'string', description: 'Build brief', required: true },
        tier: { type: 'string', description: 'Build tier', required: true },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: { ok: true } }),
    };

    const executor = new ToolExecutor([webBuildTool]);
    const result = await executor.execute(
      'invoke_web_build',
      { brief: 'Weather app', tier: 'prototype' },
      buildContext({
        assignmentId: undefined,
        directiveId: undefined,
        requestSource: 'on_demand',
      }),
    );

    vi.unstubAllEnvs();
    expect(result.success).toBe(true);
    expect(webBuildTool.execute).toHaveBeenCalledOnce();
  });
});

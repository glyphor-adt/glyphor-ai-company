import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  CompositeHookRunner,
  createCompositeHookRunner,
  type ToolHookRunner,
  type ToolHookContext,
  type ToolHookPostContext,
  type ToolHookPreDecision,
} from '../hooks/hookRunner.js';
import type { PreToolHookFn, PostToolHookFn } from '../buildTool.js';
import type { ToolResult, ActionRiskLevel, CompanyAgentRole } from '../types.js';
import {
  requireParams,
  denyRoles,
  rateWindow,
  allowedHoursUtc,
  validateParams,
  executionTiming,
  auditLog,
  redactFields,
  capResultSize,
} from '../hooks/builtinHooks.js';

// ─── Helpers ─────────────────────────────────────────────────────

function makeContext(overrides: Partial<ToolHookContext> = {}): ToolHookContext {
  return {
    agentId: 'test-agent',
    agentRole: 'ops' as CompanyAgentRole,
    toolName: 'test_tool',
    params: {},
    turnNumber: 1,
    riskLevel: 'AUTONOMOUS' as ActionRiskLevel,
    ...overrides,
  };
}

function makePostContext(overrides: Partial<ToolHookPostContext> = {}): ToolHookPostContext {
  return {
    ...makeContext(),
    result: { success: true, data: { foo: 'bar' } },
    ...overrides,
  };
}

function makeGlobalRunner(opts: {
  preDecision?: ToolHookPreDecision;
  preThrow?: Error;
  postSpy?: () => void;
} = {}): ToolHookRunner {
  return {
    async runPreToolUse(): Promise<ToolHookPreDecision> {
      if (opts.preThrow) throw opts.preThrow;
      return opts.preDecision ?? { allow: true };
    },
    async runPostToolUse(): Promise<void> {
      opts.postSpy?.();
    },
  };
}

// ═════════════════════════════════════════════════════════════════
// CompositeHookRunner
// ═════════════════════════════════════════════════════════════════

describe('CompositeHookRunner', () => {
  describe('runPreToolUse()', () => {
    it('returns allow when no hooks exist', async () => {
      const runner = createCompositeHookRunner(null);
      const result = await runner.runPreToolUse(makeContext());
      expect(result.allow).toBe(true);
    });

    it('runs per-tool hooks before global hooks', async () => {
      const order: string[] = [];
      const perToolHook: PreToolHookFn = () => {
        order.push('per-tool');
        return { allow: true };
      };
      const globalRunner = makeGlobalRunner();
      const origPre = globalRunner.runPreToolUse.bind(globalRunner);
      globalRunner.runPreToolUse = async (ctx) => {
        order.push('global');
        return origPre(ctx);
      };

      const runner = createCompositeHookRunner(globalRunner);
      await runner.runPreToolUse(makeContext(), [perToolHook]);
      expect(order).toEqual(['per-tool', 'global']);
    });

    it('blocks if per-tool pre-hook denies', async () => {
      const denyHook: PreToolHookFn = () => ({ allow: false, reason: 'nope' });
      const globalRunner = makeGlobalRunner();
      const runner = createCompositeHookRunner(globalRunner);

      const result = await runner.runPreToolUse(makeContext(), [denyHook]);
      expect(result.allow).toBe(false);
      expect(result.reason).toBe('nope');
    });

    it('skips global hooks when per-tool hook denies', async () => {
      const globalSpy = vi.fn().mockResolvedValue({ allow: true });
      const globalRunner: ToolHookRunner = {
        runPreToolUse: globalSpy,
        runPostToolUse: async () => {},
      };
      const denyHook: PreToolHookFn = () => ({ allow: false, reason: 'blocked' });

      const runner = createCompositeHookRunner(globalRunner);
      await runner.runPreToolUse(makeContext(), [denyHook]);
      expect(globalSpy).not.toHaveBeenCalled();
    });

    it('blocks if global hook denies', async () => {
      const globalRunner = makeGlobalRunner({ preDecision: { allow: false, reason: 'global deny' } });
      const runner = createCompositeHookRunner(globalRunner);

      const result = await runner.runPreToolUse(makeContext());
      expect(result.allow).toBe(false);
      expect(result.reason).toBe('global deny');
    });

    it('throws HookExecutionError when per-tool hook throws', async () => {
      const badHook: PreToolHookFn = () => { throw new Error('boom'); };
      const runner = createCompositeHookRunner(null);

      await expect(runner.runPreToolUse(makeContext(), [badHook]))
        .rejects.toThrow('Per-tool pre-hook failed');
    });

    it('runs multiple per-tool hooks sequentially (first deny wins)', async () => {
      const hook1: PreToolHookFn = () => ({ allow: true });
      const hook2: PreToolHookFn = () => ({ allow: false, reason: 'second hook' });
      const hook3: PreToolHookFn = vi.fn().mockReturnValue({ allow: true });

      const runner = createCompositeHookRunner(null);
      const result = await runner.runPreToolUse(makeContext(), [hook1, hook2, hook3]);

      expect(result.allow).toBe(false);
      expect(result.reason).toBe('second hook');
      expect(hook3).not.toHaveBeenCalled();
    });
  });

  describe('runPostToolUse()', () => {
    it('runs global hooks then per-tool hooks', async () => {
      const order: string[] = [];
      const postSpy = vi.fn(() => order.push('global'));
      const globalRunner = makeGlobalRunner({ postSpy });

      const perToolPostHook: PostToolHookFn = () => {
        order.push('per-tool');
      };

      const runner = createCompositeHookRunner(globalRunner);
      await runner.runPostToolUse(makePostContext(), [perToolPostHook]);
      expect(order).toEqual(['global', 'per-tool']);
    });

    it('returns enrichment from per-tool post-hook', async () => {
      const enrichHook: PostToolHookFn = () => ({
        data: { enriched: true },
      });
      const runner = createCompositeHookRunner(null);

      const result = await runner.runPostToolUse(makePostContext(), [enrichHook]);
      expect(result).toEqual({ data: { enriched: true } });
    });

    it('merges enrichment from multiple per-tool post-hooks', async () => {
      const hook1: PostToolHookFn = () => ({ data: { a: 1 } });
      const hook2: PostToolHookFn = () => ({ data: { b: 2 } });
      const runner = createCompositeHookRunner(null);

      const result = await runner.runPostToolUse(makePostContext(), [hook1, hook2]);
      expect(result).toEqual({ data: { b: 2 } }); // Last write wins on same key
    });

    it('does not fail if per-tool post-hook throws', async () => {
      const badHook: PostToolHookFn = () => { throw new Error('oops'); };
      const runner = createCompositeHookRunner(null);

      // Should not throw — post-hooks are non-fatal
      const result = await runner.runPostToolUse(makePostContext(), [badHook]);
      expect(result).toBeUndefined();
    });

    it('returns void when no hooks modify result', async () => {
      const runner = createCompositeHookRunner(null);
      const result = await runner.runPostToolUse(makePostContext());
      expect(result).toBeUndefined();
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// Built-in Pre-hooks
// ═════════════════════════════════════════════════════════════════

describe('requireParams()', () => {
  it('allows when all required params are present', async () => {
    const hook = requireParams('name', 'age');
    const result = await hook(makeContext({ params: { name: 'Alice', age: 30 } }));
    expect(result).toEqual({ allow: true });
  });

  it('denies when a required param is missing', async () => {
    const hook = requireParams('name', 'age');
    const result = await hook(makeContext({ params: { name: 'Alice' } }));
    expect(result.allow).toBe(false);
    expect(result.reason).toContain('age');
  });

  it('denies when a required param is empty string', async () => {
    const hook = requireParams('name');
    const result = await hook(makeContext({ params: { name: '' } }));
    expect(result.allow).toBe(false);
  });
});

describe('denyRoles()', () => {
  it('allows unlisted roles', async () => {
    const hook = denyRoles(['intern']);
    const result = await hook(makeContext({ agentRole: 'ops' as CompanyAgentRole }));
    expect(result.allow).toBe(true);
  });

  it('denies listed roles with default message', async () => {
    const hook = denyRoles(['ops']);
    const result = await hook(makeContext({ agentRole: 'ops' as CompanyAgentRole }));
    expect(result.allow).toBe(false);
    expect(result.reason).toContain('ops');
  });

  it('denies with custom reason', async () => {
    const hook = denyRoles(['ops'], 'Nope');
    const result = await hook(makeContext({ agentRole: 'ops' as CompanyAgentRole }));
    expect(result.reason).toBe('Nope');
  });
});

describe('rateWindow()', () => {
  it('allows calls within the window limit', async () => {
    const hook = rateWindow(3, 60_000);
    const ctx = makeContext();
    expect((await hook(ctx)).allow).toBe(true);
    expect((await hook(ctx)).allow).toBe(true);
    expect((await hook(ctx)).allow).toBe(true);
  });

  it('denies when limit is exceeded', async () => {
    const hook = rateWindow(2, 60_000);
    const ctx = makeContext();
    await hook(ctx);
    await hook(ctx);
    const result = await hook(ctx);
    expect(result.allow).toBe(false);
    expect(result.reason).toContain('Rate limit');
  });

  it('tracks per agent role + tool name', async () => {
    const hook = rateWindow(1, 60_000);
    const ctx1 = makeContext({ agentRole: 'ops' as CompanyAgentRole, toolName: 'a' });
    const ctx2 = makeContext({ agentRole: 'cto' as CompanyAgentRole, toolName: 'a' });
    expect((await hook(ctx1)).allow).toBe(true);
    expect((await hook(ctx2)).allow).toBe(true); // Different role, separate bucket
    expect((await hook(ctx1)).allow).toBe(false); // Same role, limit hit
  });
});

describe('validateParams()', () => {
  it('allows when validator returns null', async () => {
    const hook = validateParams(() => null);
    expect((await hook(makeContext())).allow).toBe(true);
  });

  it('denies with validator error message', async () => {
    const hook = validateParams((p) => p.x ? null : 'x is required');
    const result = await hook(makeContext({ params: {} }));
    expect(result.allow).toBe(false);
    expect(result.reason).toBe('x is required');
  });
});

describe('allowedHoursUtc()', () => {
  it('allows during the specified window', async () => {
    const currentHour = new Date().getUTCHours();
    const hook = allowedHoursUtc(currentHour, currentHour + 1);
    expect((await hook(makeContext())).allow).toBe(true);
  });

  it('denies outside the specified window', async () => {
    const currentHour = new Date().getUTCHours();
    // Set window to an hour that is definitely not now
    const outsideHour = (currentHour + 12) % 24;
    const hook = allowedHoursUtc(outsideHour, outsideHour + 1);
    expect((await hook(makeContext())).allow).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════
// Built-in Post-hooks
// ═════════════════════════════════════════════════════════════════

describe('auditLog()', () => {
  it('calls the logger with execution details', () => {
    const logger = vi.fn();
    const hook = auditLog(logger);
    hook(makePostContext());
    expect(logger).toHaveBeenCalledWith({
      toolName: 'test_tool',
      agentRole: 'ops',
      success: true,
      turnNumber: 1,
      runId: undefined,
    });
  });
});

describe('redactFields()', () => {
  it('redacts specified fields in result data', () => {
    const hook = redactFields('secret', 'token');
    const ctx = makePostContext({
      result: { success: true, data: { name: 'ok', secret: 'abc123', token: 'xyz' } },
    });
    const result = hook(ctx);
    expect(result).toEqual({
      data: { name: 'ok', secret: '[REDACTED]', token: '[REDACTED]' },
    });
  });

  it('redacts nested fields', () => {
    const hook = redactFields('password');
    const ctx = makePostContext({
      result: { success: true, data: { user: { name: 'ok', password: 'abc' } } },
    });
    const result = hook(ctx);
    expect((result as { data: { user: { password: string } } }).data.user.password).toBe('[REDACTED]');
  });

  it('returns void when no data', () => {
    const hook = redactFields('secret');
    const ctx = makePostContext({ result: { success: true } });
    expect(hook(ctx)).toBeUndefined();
  });
});

describe('capResultSize()', () => {
  it('returns void when size is under limit', () => {
    const hook = capResultSize(10_000);
    const ctx = makePostContext({ result: { success: true, data: { ok: true } } });
    expect(hook(ctx)).toBeUndefined();
  });

  it('truncates when size exceeds limit', () => {
    const hook = capResultSize(10); // Very small limit
    const ctx = makePostContext({
      result: { success: true, data: { bigField: 'a'.repeat(100) } },
    });
    const result = hook(ctx) as { data: { __truncated: boolean; __originalSizeBytes: number } };
    expect(result.data.__truncated).toBe(true);
    expect(result.data.__originalSizeBytes).toBeGreaterThan(10);
  });
});

describe('executionTiming()', () => {
  it('captures start and end timing', async () => {
    const timing = executionTiming();
    const ctx = makeContext({ runId: 'run-1', turnNumber: 1 });

    // Start
    const preResult = await timing.start(ctx);
    expect(preResult.allow).toBe(true);

    // Simulate delay
    await new Promise(r => setTimeout(r, 10));

    // End
    const postResult = timing.end(makePostContext({
      ...ctx,
      result: { success: true, data: {} },
    }));
    expect(postResult).toBeDefined();
    const meta = (postResult as { data: { __hookMeta: { executionDurationMs: number } } })
      .data.__hookMeta;
    expect(meta.executionDurationMs).toBeGreaterThanOrEqual(5);
  });
});

// ═════════════════════════════════════════════════════════════════
// buildTool integration (per-tool hooks in metadata)
// ═════════════════════════════════════════════════════════════════

describe('buildTool() with hooks', () => {
  // Import inline to avoid circular issues
  it('includes preHooks and postHooks in metadata', async () => {
    const { buildTool, getToolMeta } = await import('../buildTool.js');
    const preHook: PreToolHookFn = () => ({ allow: true });
    const postHook: PostToolHookFn = () => {};

    const tool = buildTool({
      name: 'hooked_tool',
      description: 'A tool with hooks',
      parameters: {},
      execute: async () => ({ success: true }),
      preHooks: [preHook],
      postHooks: [postHook],
    });

    const meta = getToolMeta(tool);
    expect(meta.preHooks).toHaveLength(1);
    expect(meta.postHooks).toHaveLength(1);
    expect(meta.preHooks[0]).toBe(preHook);
    expect(meta.postHooks[0]).toBe(postHook);
  });

  it('defaults to empty hook arrays', async () => {
    const { buildTool, getToolMeta } = await import('../buildTool.js');
    const tool = buildTool({
      name: 'plain_tool',
      description: 'No hooks',
      parameters: {},
      execute: async () => ({ success: true }),
    });

    const meta = getToolMeta(tool);
    expect(meta.preHooks).toEqual([]);
    expect(meta.postHooks).toEqual([]);
  });
});

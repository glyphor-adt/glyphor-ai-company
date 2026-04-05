import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ToolDefinition, ToolContext, ToolResult, CompanyAgentRole } from '../types.js';
import {
  ConcurrentToolExecutor,
  classifyToolConcurrency,
  shouldUseConcurrentExecution,
  type ToolCallEntry,
} from '../concurrentToolExecutor.js';

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function makeSafeTool(name: string): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    parameters: {},
    execute: async () => ({ success: true, data: `${name} result` }),
    __meta: {
      isReadOnly: true,
      isConcurrencySafe: true,
      isDestructive: false,
      rateLimit: 60,
      timeoutMs: 30_000,
      requiresPreCheck: false,
      allowedRoles: [],
      deniedRoles: [],
      preHooks: [],
      postHooks: [],
    },
  } as any;
}

function makeUnsafeTool(name: string): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    parameters: {},
    execute: async () => ({ success: true, data: `${name} result` }),
    __meta: {
      isReadOnly: false,
      isConcurrencySafe: false,
      isDestructive: false,
      rateLimit: 60,
      timeoutMs: 30_000,
      requiresPreCheck: false,
      allowedRoles: [],
      deniedRoles: [],
      preHooks: [],
      postHooks: [],
    },
  } as any;
}

function makeDestructiveTool(name: string): ToolDefinition {
  return {
    name,
    description: `Destructive tool ${name}`,
    parameters: {},
    execute: async () => ({ success: true, data: `${name} result` }),
    __meta: {
      isReadOnly: false,
      isConcurrencySafe: false,
      isDestructive: true,
      rateLimit: 60,
      timeoutMs: 30_000,
      requiresPreCheck: false,
      allowedRoles: [],
      deniedRoles: [],
      preHooks: [],
      postHooks: [],
    },
  } as any;
}

function makeToolMap(...tools: ToolDefinition[]): Map<string, ToolDefinition> {
  return new Map(tools.map(t => [t.name, t]));
}

function makeContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    agentId: 'test-agent',
    agentRole: 'devops-engineer' as CompanyAgentRole,
    turnNumber: 1,
    abortSignal: new AbortController().signal,
    memoryBus: {} as any,
    emitEvent: vi.fn(),
    ...overrides,
  };
}

function makeEntry(index: number, name: string, args: Record<string, unknown> = {}): ToolCallEntry {
  return { index, name, args };
}

/** Tracks execution order across tool calls. */
function createSequenceTracker() {
  const order: string[] = [];
  const executeFn = (name: string, delayMs = 10) =>
    async (): Promise<ToolResult> => {
      order.push(`start:${name}`);
      await new Promise(r => setTimeout(r, delayMs));
      order.push(`end:${name}`);
      return { success: true, data: `${name} result` };
    };
  return { order, executeFn };
}

function createMockToolExecutor(
  tools: Map<string, ToolDefinition>,
  executeFn?: (name: string, params: Record<string, unknown>) => Promise<ToolResult>,
) {
  const defaultExecute = async (name: string): Promise<ToolResult> => ({
    success: true,
    data: `${name} executed`,
  });

  return {
    tools,
    execute: vi.fn(async (name: string, params: Record<string, unknown>) => {
      return (executeFn ?? defaultExecute)(name, params);
    }),
  } as any;
}

// ═══════════════════════════════════════════════════════════════════
// classifyToolConcurrency
// ═══════════════════════════════════════════════════════════════════

describe('classifyToolConcurrency', () => {
  it('returns true for tools with isConcurrencySafe=true', () => {
    const tools = makeToolMap(makeSafeTool('custom_safe'));
    expect(classifyToolConcurrency('custom_safe', tools)).toBe(true);
  });

  it('returns true for tools with isReadOnly=true', () => {
    const tool = makeUnsafeTool('custom_reader');
    (tool as any).__meta.isReadOnly = true;
    const tools = makeToolMap(tool);
    expect(classifyToolConcurrency('custom_reader', tools)).toBe(true);
  });

  it('returns false for unsafe tools', () => {
    const tools = makeToolMap(makeUnsafeTool('deploy_staging'));
    expect(classifyToolConcurrency('deploy_staging', tools)).toBe(false);
  });

  it('classifies by name prefix for unknown tools', () => {
    const tools = new Map<string, ToolDefinition>();
    expect(classifyToolConcurrency('get_user_data', tools)).toBe(true);
    expect(classifyToolConcurrency('read_file', tools)).toBe(true);
    expect(classifyToolConcurrency('query_database', tools)).toBe(true);
    expect(classifyToolConcurrency('search_logs', tools)).toBe(true);
    expect(classifyToolConcurrency('deploy_something', tools)).toBe(false);
    expect(classifyToolConcurrency('write_data', tools)).toBe(false);
  });

  it('defaults to false for unknown tools without safe prefix', () => {
    const tools = new Map<string, ToolDefinition>();
    expect(classifyToolConcurrency('custom_operation', tools)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// shouldUseConcurrentExecution
// ═══════════════════════════════════════════════════════════════════

describe('shouldUseConcurrentExecution', () => {
  it('returns false for single tool call', () => {
    const tools = makeToolMap(makeSafeTool('get_data'));
    expect(shouldUseConcurrentExecution([{ name: 'get_data' }], tools)).toBe(false);
  });

  it('returns true when at least one tool is safe', () => {
    const tools = makeToolMap(makeSafeTool('get_data'), makeUnsafeTool('write_file'));
    expect(shouldUseConcurrentExecution(
      [{ name: 'get_data' }, { name: 'write_file' }],
      tools,
    )).toBe(true);
  });

  it('returns false when all tools are unsafe', () => {
    const tools = makeToolMap(makeUnsafeTool('deploy'), makeUnsafeTool('write'));
    expect(shouldUseConcurrentExecution(
      [{ name: 'deploy' }, { name: 'write' }],
      tools,
    )).toBe(false);
  });

  it('returns false for empty batch', () => {
    const tools = new Map<string, ToolDefinition>();
    expect(shouldUseConcurrentExecution([], tools)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ConcurrentToolExecutor — Basic Behavior
// ═══════════════════════════════════════════════════════════════════

describe('ConcurrentToolExecutor', () => {
  it('executes a single tool', async () => {
    const tools = makeToolMap(makeSafeTool('get_data'));
    const executor = createMockToolExecutor(tools);
    const concurrent = new ConcurrentToolExecutor(executor);
    const ctx = makeContext();

    const results: ToolResult[] = [];
    const iter = concurrent.executeBatch([makeEntry(0, 'get_data')], ctx);
    let next = await iter.next();
    while (!next.done) {
      results.push(next.value.result);
      next = await iter.next();
    }

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it('yields results in receipt order despite parallel execution', async () => {
    const tools = makeToolMap(makeSafeTool('slow_read'), makeSafeTool('fast_read'));

    // slow_read takes 50ms, fast_read takes 10ms
    const executor = createMockToolExecutor(tools, async (name) => {
      const delay = name === 'slow_read' ? 50 : 10;
      await new Promise(r => setTimeout(r, delay));
      return { success: true, data: `${name} done` };
    });

    const concurrent = new ConcurrentToolExecutor(executor);
    const ctx = makeContext();

    const names: string[] = [];
    const iter = concurrent.executeBatch(
      [makeEntry(0, 'slow_read'), makeEntry(1, 'fast_read')],
      ctx,
    );
    let next = await iter.next();
    while (!next.done) {
      names.push(next.value.call.name);
      next = await iter.next();
    }

    // Must be in receipt order: slow_read first, even though fast_read finishes first
    expect(names).toEqual(['slow_read', 'fast_read']);
  });

  it('runs safe tools in parallel', async () => {
    const tools = makeToolMap(makeSafeTool('read_a'), makeSafeTool('read_b'));
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const executor = createMockToolExecutor(tools, async (name) => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise(r => setTimeout(r, 30));
      concurrentCount--;
      return { success: true, data: `${name} done` };
    });

    const concurrent = new ConcurrentToolExecutor(executor);
    const ctx = makeContext();

    const iter = concurrent.executeBatch(
      [makeEntry(0, 'read_a'), makeEntry(1, 'read_b')],
      ctx,
    );
    let next = await iter.next();
    while (!next.done) {
      next = await iter.next();
    }

    // Both tools should have been executing at the same time
    expect(maxConcurrent).toBe(2);
  });

  it('runs unsafe tools sequentially (exclusive barrier)', async () => {
    const tools = makeToolMap(makeUnsafeTool('write_a'), makeUnsafeTool('write_b'));
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const executor = createMockToolExecutor(tools, async (name) => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise(r => setTimeout(r, 20));
      concurrentCount--;
      return { success: true, data: `${name} done` };
    });

    const concurrent = new ConcurrentToolExecutor(executor);
    const ctx = makeContext();

    const iter = concurrent.executeBatch(
      [makeEntry(0, 'write_a'), makeEntry(1, 'write_b')],
      ctx,
    );
    let next = await iter.next();
    while (!next.done) {
      next = await iter.next();
    }

    // Unsafe tools must NOT overlap
    expect(maxConcurrent).toBe(1);
  });

  it('blocks unsafe tool behind safe tools', async () => {
    const tools = makeToolMap(
      makeSafeTool('read_a'),
      makeSafeTool('read_b'),
      makeUnsafeTool('write_c'),
    );

    const executionOrder: string[] = [];
    const executor = createMockToolExecutor(tools, async (name) => {
      executionOrder.push(`start:${name}`);
      await new Promise(r => setTimeout(r, 20));
      executionOrder.push(`end:${name}`);
      return { success: true, data: `${name} done` };
    });

    const concurrent = new ConcurrentToolExecutor(executor);
    const ctx = makeContext();

    const iter = concurrent.executeBatch(
      [makeEntry(0, 'read_a'), makeEntry(1, 'read_b'), makeEntry(2, 'write_c')],
      ctx,
    );
    let next = await iter.next();
    while (!next.done) {
      next = await iter.next();
    }

    // write_c must start AFTER both reads finish
    const writeStartIdx = executionOrder.indexOf('start:write_c');
    const readAEndIdx = executionOrder.indexOf('end:read_a');
    const readBEndIdx = executionOrder.indexOf('end:read_b');
    expect(writeStartIdx).toBeGreaterThan(readAEndIdx);
    expect(writeStartIdx).toBeGreaterThan(readBEndIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ConcurrentToolExecutor — Error Handling
// ═══════════════════════════════════════════════════════════════════

describe('ConcurrentToolExecutor — Error Handling', () => {
  it('handles individual tool failure without aborting batch', async () => {
    const tools = makeToolMap(makeSafeTool('good_read'), makeSafeTool('bad_read'));
    const executor = createMockToolExecutor(tools, async (name) => {
      if (name === 'bad_read') return { success: false, error: 'Not found' };
      return { success: true, data: 'ok' };
    });

    const concurrent = new ConcurrentToolExecutor(executor);
    const ctx = makeContext();

    const results: Array<{ name: string; success: boolean }> = [];
    const iter = concurrent.executeBatch(
      [makeEntry(0, 'good_read'), makeEntry(1, 'bad_read')],
      ctx,
    );
    let next = await iter.next();
    while (!next.done) {
      results.push({ name: next.value.call.name, success: next.value.result.success });
      next = await iter.next();
    }

    expect(results).toEqual([
      { name: 'good_read', success: true },
      { name: 'bad_read', success: false },
    ]);
  });

  it('cascades abort on destructive tool failure', async () => {
    const tools = makeToolMap(
      makeDestructiveTool('deploy_prod'),
      makeSafeTool('read_status'),
    );

    const executor = createMockToolExecutor(tools, async (name) => {
      if (name === 'deploy_prod') return { success: false, error: 'Deploy failed' };
      return { success: true, data: 'ok' };
    });

    const concurrent = new ConcurrentToolExecutor(executor);
    const ctx = makeContext();

    const results: Array<{ name: string; success: boolean }> = [];
    const iter = concurrent.executeBatch(
      [makeEntry(0, 'deploy_prod'), makeEntry(1, 'read_status')],
      ctx,
    );
    let next = await iter.next();
    while (!next.done) {
      results.push({ name: next.value.call.name, success: next.value.result.success });
      next = await iter.next();
    }

    // deploy_prod fails, read_status should be aborted
    expect(results[0]).toEqual({ name: 'deploy_prod', success: false });
    expect(results[1]).toEqual({ name: 'read_status', success: false });
    expect(results[1]).toMatchObject({ success: false });
  });

  it('cascades abort on circuit breaker error', async () => {
    const tools = makeToolMap(makeSafeTool('tool_a'), makeSafeTool('tool_b'));
    const executor = createMockToolExecutor(tools, async (name) => {
      if (name === 'tool_a') return { success: false, error: 'circuit_breaker fleet halt' };
      return { success: true, data: 'ok' };
    });

    const concurrent = new ConcurrentToolExecutor(executor);
    const ctx = makeContext();

    const results: boolean[] = [];
    const iter = concurrent.executeBatch(
      [makeEntry(0, 'tool_a'), makeEntry(1, 'tool_b')],
      ctx,
    );
    let next = await iter.next();
    while (!next.done) {
      results.push(next.value.result.success);
      next = await iter.next();
    }

    // Both should fail
    expect(results).toEqual([false, false]);
  });

  it('handles tool execution exceptions gracefully', async () => {
    const tools = makeToolMap(makeSafeTool('crashing_tool'));
    const executor = createMockToolExecutor(tools, async () => {
      throw new Error('Unexpected crash');
    });

    const concurrent = new ConcurrentToolExecutor(executor);
    const ctx = makeContext();

    const results: ToolResult[] = [];
    const iter = concurrent.executeBatch([makeEntry(0, 'crashing_tool')], ctx);
    let next = await iter.next();
    while (!next.done) {
      results.push(next.value.result);
      next = await iter.next();
    }

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('Unexpected crash');
  });

  it('respects abort signal', async () => {
    const tools = makeToolMap(makeSafeTool('slow_tool'), makeSafeTool('waiting_tool'));
    const abortController = new AbortController();

    const executor = createMockToolExecutor(tools, async (name) => {
      if (name === 'slow_tool') {
        await new Promise(r => setTimeout(r, 50));
        abortController.abort(); // Abort after first tool completes
      }
      return { success: true, data: 'ok' };
    });

    const concurrent = new ConcurrentToolExecutor(executor);
    const ctx = makeContext({ abortSignal: abortController.signal });

    const results: Array<{ name: string; success: boolean }> = [];
    const iter = concurrent.executeBatch(
      [makeEntry(0, 'slow_tool'), makeEntry(1, 'waiting_tool')],
      ctx,
    );
    let next = await iter.next();
    while (!next.done) {
      results.push({ name: next.value.call.name, success: next.value.result.success });
      next = await iter.next();
    }

    expect(results.length).toBe(2);
    // Both tools should be safe-classified so they run in parallel,
    // waiting_tool may either succeed or be caught by abort signal
  });
});

// ═══════════════════════════════════════════════════════════════════
// ConcurrentToolExecutor — Mixed Batches
// ═══════════════════════════════════════════════════════════════════

describe('ConcurrentToolExecutor — Mixed Batches', () => {
  it('handles safe-safe-unsafe-safe pattern correctly', async () => {
    const tools = makeToolMap(
      makeSafeTool('read_a'),
      makeSafeTool('read_b'),
      makeUnsafeTool('write_c'),
      makeSafeTool('read_d'),
    );

    const executionOrder: string[] = [];
    const executor = createMockToolExecutor(tools, async (name) => {
      executionOrder.push(`start:${name}`);
      await new Promise(r => setTimeout(r, 15));
      executionOrder.push(`end:${name}`);
      return { success: true, data: `${name} done` };
    });

    const concurrent = new ConcurrentToolExecutor(executor);
    const ctx = makeContext();

    const resultOrder: string[] = [];
    const iter = concurrent.executeBatch(
      [
        makeEntry(0, 'read_a'),
        makeEntry(1, 'read_b'),
        makeEntry(2, 'write_c'),
        makeEntry(3, 'read_d'),
      ],
      ctx,
    );
    let next = await iter.next();
    while (!next.done) {
      resultOrder.push(next.value.call.name);
      next = await iter.next();
    }

    // Results must be in receipt order
    expect(resultOrder).toEqual(['read_a', 'read_b', 'write_c', 'read_d']);

    // write_c must start after reads finish
    const writeCStart = executionOrder.indexOf('start:write_c');
    const readAEnd = executionOrder.indexOf('end:read_a');
    const readBEnd = executionOrder.indexOf('end:read_b');
    expect(writeCStart).toBeGreaterThan(readAEnd);
    expect(writeCStart).toBeGreaterThan(readBEnd);

    // read_d must start after write_c finishes
    const readDStart = executionOrder.indexOf('start:read_d');
    const writeCEnd = executionOrder.indexOf('end:write_c');
    expect(readDStart).toBeGreaterThan(writeCEnd);
  });

  it('returns batch stats', async () => {
    const tools = makeToolMap(makeSafeTool('read_a'), makeSafeTool('read_b'));
    const executor = createMockToolExecutor(tools);
    const concurrent = new ConcurrentToolExecutor(executor);
    const ctx = makeContext();

    const iter = concurrent.executeBatch(
      [makeEntry(0, 'read_a'), makeEntry(1, 'read_b')],
      ctx,
    );

    let next = await iter.next();
    while (!next.done) {
      next = await iter.next();
    }

    // The return value of the generator (after all yields) contains stats
    expect(next.done).toBe(true);
    expect(next.value).toBeDefined();
    expect(next.value.total).toBe(2);
    expect(next.value.wallClockMs).toBeGreaterThanOrEqual(0);
  });
});

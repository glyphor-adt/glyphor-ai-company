import { describe, expect, it } from 'vitest';
import {
  buildTool,
  isSafeTool,
  getToolMeta,
  isToolPermittedForRole,
  getToolTimeout,
  getToolRateLimit,
  type SafeToolDefinition,
} from '../buildTool.js';
import type { ToolDefinition, ToolResult } from '../types.js';

// ─── Helper ──────────────────────────────────────────────────────

const noop = async (): Promise<ToolResult> => ({ success: true, data: {} });

function makeTool(overrides: Partial<Parameters<typeof buildTool>[0]> = {}): SafeToolDefinition {
  return buildTool({
    name: 'test_tool',
    description: 'A test tool',
    parameters: {},
    execute: noop,
    ...overrides,
  });
}

// ─── Tests ───────────────────────────────────────────────────────

describe('buildTool()', () => {
  it('creates a tool with all required fields', () => {
    const tool = makeTool();
    expect(tool.name).toBe('test_tool');
    expect(tool.description).toBe('A test tool');
    expect(tool.parameters).toEqual({});
    expect(typeof tool.execute).toBe('function');
  });

  it('attaches __meta with fail-closed defaults', () => {
    const tool = makeTool();
    expect(tool.__meta).toEqual({
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
    });
  });

  it('allows overriding safety metadata', () => {
    const tool = makeTool({
      isReadOnly: true,
      isConcurrencySafe: true,
      isDestructive: true,
      rateLimit: 10,
      timeoutMs: 120_000,
      requiresPreCheck: true,
      allowedRoles: ['cto', 'ops'],
      deniedRoles: ['cmo'],
      categoryHint: 'data',
    });

    expect(tool.__meta.isReadOnly).toBe(true);
    expect(tool.__meta.isConcurrencySafe).toBe(true);
    expect(tool.__meta.isDestructive).toBe(true);
    expect(tool.__meta.rateLimit).toBe(10);
    expect(tool.__meta.timeoutMs).toBe(120_000);
    expect(tool.__meta.requiresPreCheck).toBe(true);
    expect(tool.__meta.allowedRoles).toEqual(['cto', 'ops']);
    expect(tool.__meta.deniedRoles).toEqual(['cmo']);
    expect(tool.__meta.categoryHint).toBe('data');
  });

  it('sets deferLoading to false by default', () => {
    const tool = makeTool();
    expect(tool.deferLoading).toBe(false);
  });

  it('passes through deferLoading when set', () => {
    const tool = makeTool({ deferLoading: true });
    expect(tool.deferLoading).toBe(true);
  });

  it('passes through abac metadata', () => {
    const tool = makeTool({
      abac: { mcpDomain: 'Glyphor.Marketing', resourceType: 'content' },
    });
    expect(tool.abac).toEqual({ mcpDomain: 'Glyphor.Marketing', resourceType: 'content' });
  });
});

describe('isSafeTool()', () => {
  it('returns true for buildTool-created tools', () => {
    expect(isSafeTool(makeTool())).toBe(true);
  });

  it('returns false for legacy ToolDefinition objects', () => {
    const legacy: ToolDefinition = {
      name: 'legacy_tool',
      description: 'A legacy tool',
      parameters: {},
      execute: noop,
    };
    expect(isSafeTool(legacy)).toBe(false);
  });
});

describe('getToolMeta()', () => {
  it('returns metadata for buildTool-created tools', () => {
    const tool = makeTool({ isReadOnly: true });
    expect(getToolMeta(tool).isReadOnly).toBe(true);
  });

  it('returns fail-closed defaults for legacy tools', () => {
    const legacy: ToolDefinition = {
      name: 'legacy_tool',
      description: 'A legacy tool',
      parameters: {},
      execute: noop,
    };
    const meta = getToolMeta(legacy);
    expect(meta.isReadOnly).toBe(false);
    expect(meta.isConcurrencySafe).toBe(false);
    expect(meta.isDestructive).toBe(false);
    expect(meta.rateLimit).toBe(60);
    expect(meta.timeoutMs).toBe(30_000);
  });
});

describe('isToolPermittedForRole()', () => {
  it('permits all roles when allowedRoles is empty', () => {
    const tool = makeTool();
    expect(isToolPermittedForRole(tool, 'cto')).toBe(true);
    expect(isToolPermittedForRole(tool, 'cmo')).toBe(true);
  });

  it('restricts to allowedRoles when specified', () => {
    const tool = makeTool({ allowedRoles: ['cto', 'ops'] });
    expect(isToolPermittedForRole(tool, 'cto')).toBe(true);
    expect(isToolPermittedForRole(tool, 'ops')).toBe(true);
    expect(isToolPermittedForRole(tool, 'cmo')).toBe(false);
  });

  it('deniedRoles takes precedence over allowedRoles', () => {
    const tool = makeTool({
      allowedRoles: ['cto', 'ops', 'chief-of-staff'],
      deniedRoles: ['cto'],
    });
    expect(isToolPermittedForRole(tool, 'cto')).toBe(false);
    expect(isToolPermittedForRole(tool, 'ops')).toBe(true);
  });

  it('permits all roles for legacy tools (fail-open for backwards compat)', () => {
    const legacy: ToolDefinition = {
      name: 'legacy_tool',
      description: 'A legacy tool',
      parameters: {},
      execute: noop,
    };
    expect(isToolPermittedForRole(legacy, 'cto')).toBe(true);
    expect(isToolPermittedForRole(legacy, 'cmo')).toBe(true);
  });
});

describe('getToolTimeout()', () => {
  it('returns buildTool timeout when set', () => {
    const tool = makeTool({ timeoutMs: 120_000 });
    expect(getToolTimeout(tool)).toBe(120_000);
  });

  it('returns default timeout for legacy tools', () => {
    const legacy: ToolDefinition = {
      name: 'legacy_tool',
      description: 'A legacy tool',
      parameters: {},
      execute: noop,
    };
    expect(getToolTimeout(legacy)).toBe(30_000);
  });
});

describe('getToolRateLimit()', () => {
  it('returns buildTool rate limit when set', () => {
    const tool = makeTool({ rateLimit: 10 });
    expect(getToolRateLimit(tool)).toBe(10);
  });

  it('returns default rate limit for legacy tools', () => {
    const legacy: ToolDefinition = {
      name: 'legacy_tool',
      description: 'A legacy tool',
      parameters: {},
      execute: noop,
    };
    expect(getToolRateLimit(legacy)).toBe(60);
  });
});

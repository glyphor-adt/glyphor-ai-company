/**
 * buildTool() — Fail-Closed Tool Factory
 *
 * Creates ToolDefinition objects with safe defaults. Any field not explicitly
 * provided gets a *conservative* default:
 *
 *   - isReadOnly:         false  (assume writes unless proven otherwise)
 *   - isConcurrencySafe:  false  (assume serial-only unless proven otherwise)
 *   - isDestructive:      false  (not destructive by default, but not read-only)
 *   - rateLimit:          60     (max calls/hour unless overridden)
 *   - timeoutMs:          30_000 (30s default timeout)
 *   - deferLoading:       false  (tool schema sent eagerly to model)
 *
 * Pattern inspired by Claude Code's buildTool() — spread defaults first,
 * then definition overrides. Fail-closed: tools are assumed NOT safe for
 * concurrent/destructive/read-only use unless explicitly declared.
 *
 * Usage:
 *
 *   const myTool = buildTool({
 *     name: 'get_financials',
 *     description: 'Fetch financial snapshots',
 *     parameters: { days: { type: 'number', description: 'Lookback days' } },
 *     isReadOnly: true,
 *     isConcurrencySafe: true,
 *     execute: async (params, ctx) => ({ success: true, data: ... }),
 *   });
 */

import type {
  ToolDefinition,
  ToolParameter,
  ToolContext,
  ToolResult,
  AbacToolMetadata,
  ActionRiskLevel,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════
// EXTENDED TOOL DEFINITION
// ═══════════════════════════════════════════════════════════════════

/**
 * Extended tool metadata that buildTool() manages alongside the base
 * ToolDefinition. These fields are stored on the tool instance and
 * available to the ToolExecutor for enforcement decisions.
 */
export interface ToolMetadata {
  /** True when the tool performs no mutations (reads, calculations, queries). */
  isReadOnly: boolean;
  /** True when the tool can safely run in parallel with other tools. */
  isConcurrencySafe: boolean;
  /** True when the tool has irreversible side effects (deletes, external commits). */
  isDestructive: boolean;
  /** Max invocations per hour per agent role. */
  rateLimit: number;
  /** Execution timeout in milliseconds. */
  timeoutMs: number;
  /** Tool category hint for model-side tool search (Anthropic/OpenAI). */
  categoryHint?: string;
  /** When true, the tool should be validated with a pre-execution check. */
  requiresPreCheck: boolean;
  /** Permitted agent roles. Empty array = all roles permitted. */
  allowedRoles: string[];
  /** Blocked agent roles. Takes precedence over allowedRoles. */
  deniedRoles: string[];
}

/**
 * A ToolDefinition enhanced with fail-closed metadata.
 * This is the return type of buildTool().
 */
export interface SafeToolDefinition extends ToolDefinition {
  __meta: ToolMetadata;
}

// ═══════════════════════════════════════════════════════════════════
// TOOL DEFINITION INPUT (Partial — safe defaults applied)
// ═══════════════════════════════════════════════════════════════════

export interface BuildToolInput {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute: (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;

  // Optional overrides (defaults are fail-closed)
  isReadOnly?: boolean;
  isConcurrencySafe?: boolean;
  isDestructive?: boolean;
  rateLimit?: number;
  timeoutMs?: number;
  deferLoading?: boolean;
  abac?: AbacToolMetadata;
  categoryHint?: string;
  requiresPreCheck?: boolean;
  allowedRoles?: string[];
  deniedRoles?: string[];
}

// ═══════════════════════════════════════════════════════════════════
// FACTORY DEFAULTS (fail-closed)
// ═══════════════════════════════════════════════════════════════════

const TOOL_DEFAULTS: ToolMetadata = {
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: false,
  rateLimit: 60,
  timeoutMs: 30_000,
  requiresPreCheck: false,
  allowedRoles: [],
  deniedRoles: [],
};

// ═══════════════════════════════════════════════════════════════════
// buildTool()
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a ToolDefinition with fail-closed metadata defaults.
 *
 * All safety-relevant fields default to the *most restrictive* value.
 * Override explicitly to relax constraints.
 */
export function buildTool(input: BuildToolInput): SafeToolDefinition {
  const meta: ToolMetadata = {
    ...TOOL_DEFAULTS,
    ...(input.isReadOnly !== undefined && { isReadOnly: input.isReadOnly }),
    ...(input.isConcurrencySafe !== undefined && { isConcurrencySafe: input.isConcurrencySafe }),
    ...(input.isDestructive !== undefined && { isDestructive: input.isDestructive }),
    ...(input.rateLimit !== undefined && { rateLimit: input.rateLimit }),
    ...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }),
    ...(input.categoryHint !== undefined && { categoryHint: input.categoryHint }),
    ...(input.requiresPreCheck !== undefined && { requiresPreCheck: input.requiresPreCheck }),
    ...(input.allowedRoles !== undefined && { allowedRoles: input.allowedRoles }),
    ...(input.deniedRoles !== undefined && { deniedRoles: input.deniedRoles }),
  };

  return {
    name: input.name,
    description: input.description,
    parameters: input.parameters,
    deferLoading: input.deferLoading ?? false,
    abac: input.abac,
    execute: input.execute,
    __meta: meta,
  };
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Type guard: check if a ToolDefinition was created via buildTool().
 */
export function isSafeTool(tool: ToolDefinition): tool is SafeToolDefinition {
  return '__meta' in tool && typeof (tool as SafeToolDefinition).__meta === 'object';
}

/**
 * Extract metadata from a tool. Returns fail-closed defaults for
 * legacy tools not created via buildTool().
 */
export function getToolMeta(tool: ToolDefinition): ToolMetadata {
  if (isSafeTool(tool)) return tool.__meta;
  return { ...TOOL_DEFAULTS };
}

/**
 * Check if a tool is permitted for a given agent role.
 * - If allowedRoles is non-empty, the role must be in the list.
 * - If deniedRoles is non-empty, the role must NOT be in the list.
 * - deniedRoles takes precedence over allowedRoles.
 */
export function isToolPermittedForRole(tool: ToolDefinition, role: string): boolean {
  const meta = getToolMeta(tool);

  if (meta.deniedRoles.length > 0 && meta.deniedRoles.includes(role)) {
    return false;
  }

  if (meta.allowedRoles.length > 0 && !meta.allowedRoles.includes(role)) {
    return false;
  }

  return true;
}

/**
 * Get the effective timeout for a tool, preferring buildTool metadata
 * over the legacy timeout constants.
 */
export function getToolTimeout(tool: ToolDefinition): number {
  return getToolMeta(tool).timeoutMs;
}

/**
 * Get the effective rate limit for a tool.
 */
export function getToolRateLimit(tool: ToolDefinition): number {
  return getToolMeta(tool).rateLimit;
}

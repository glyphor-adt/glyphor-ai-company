import type { ToolResult, ActionRiskLevel, CompanyAgentRole } from '../types.js';
import type { PreToolHookFn, PostToolHookFn } from '../buildTool.js';
import type { ToolHookConfig, HttpHookEndpoint } from './hookConfig.js';
import { loadToolHookConfigFromEnv } from './hookConfig.js';
import { callHookEndpoint } from './httpHookClient.js';

export interface ToolHookContext {
  agentId: string;
  agentRole: CompanyAgentRole;
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  assignmentId?: string;
  turnNumber: number;
  riskLevel: ActionRiskLevel;
}

export interface ToolHookPostContext extends ToolHookContext {
  result: ToolResult;
}

export interface ToolHookPreDecision {
  allow: boolean;
  reason?: string;
}

export interface ToolHookRunner {
  runPreToolUse(context: ToolHookContext): Promise<ToolHookPreDecision>;
  runPostToolUse(context: ToolHookPostContext): Promise<void | Partial<ToolResult>>;
}

export class HookExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HookExecutionError';
  }
}

export function createToolHookRunnerFromEnv(): ToolHookRunner | null {
  const config = loadToolHookConfigFromEnv();
  if (!config) return null;
  return createToolHookRunner(config);
}

export function createToolHookRunner(config: ToolHookConfig): ToolHookRunner {
  const preHooks = config.preToolUse ?? [];
  const postHooks = config.postToolUse ?? [];

  return {
    async runPreToolUse(context: ToolHookContext): Promise<ToolHookPreDecision> {
      for (const endpoint of preHooks) {
        if (!endpointMatchesTool(endpoint, context.toolName)) continue;
        const response = await invokeHook(endpoint, 'pre_tool_use', context, config.allowedHosts);
        if (isDenyResponse(response)) {
          return {
            allow: false,
            reason: response.reason ?? `Blocked by pre-tool hook: ${endpoint.name}`,
          };
        }
      }
      return { allow: true };
    },

    async runPostToolUse(context: ToolHookPostContext): Promise<void> {
      for (const endpoint of postHooks) {
        if (!endpointMatchesTool(endpoint, context.toolName)) continue;
        await invokeHook(endpoint, 'post_tool_use', context, config.allowedHosts);
      }
    },
  };
}

async function invokeHook(
  endpoint: HttpHookEndpoint,
  phase: 'pre_tool_use' | 'post_tool_use',
  context: ToolHookContext | ToolHookPostContext,
  allowedHosts?: string[],
): Promise<unknown> {
  try {
    return await callHookEndpoint(
      endpoint,
      {
        phase,
        timestamp: new Date().toISOString(),
        context,
      },
      { allowedHosts },
    );
  } catch (error) {
    throw new HookExecutionError(`Hook ${endpoint.name} failed: ${(error as Error).message}`);
  }
}

function isDenyResponse(value: unknown): value is { allow: false; reason?: string } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.allow === false;
}

/** Check whether an HTTP hook endpoint should fire for a given tool name. */
function endpointMatchesTool(endpoint: HttpHookEndpoint, toolName: string): boolean {
  if (!endpoint.toolNames || endpoint.toolNames.length === 0) return true;
  return endpoint.toolNames.includes(toolName);
}

// ═══════════════════════════════════════════════════════════════════
// COMPOSITE HOOK RUNNER — merges per-tool in-process hooks with
// the global HTTP hook runner for a unified pre/post lifecycle.
//
// Execution order:
//   PRE:  per-tool preHooks → global HTTP preHooks  (first deny wins)
//   POST: global HTTP postHooks → per-tool postHooks (post-hooks can enrich)
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a composite runner that runs per-tool in-process hooks AND
 * the global HTTP hook runner. If no global runner exists, only
 * per-tool hooks run.
 */
export function createCompositeHookRunner(
  globalRunner: ToolHookRunner | null,
): CompositeHookRunner {
  return new CompositeHookRunner(globalRunner);
}

export class CompositeHookRunner implements ToolHookRunner {
  constructor(private globalRunner: ToolHookRunner | null) {}

  /**
   * PRE hooks: per-tool in-process first, then global HTTP hooks.
   * First deny from either source blocks the tool.
   */
  async runPreToolUse(
    context: ToolHookContext,
    perToolPreHooks?: PreToolHookFn[],
  ): Promise<ToolHookPreDecision> {
    // 1. Per-tool in-process pre-hooks (fast, local)
    if (perToolPreHooks?.length) {
      for (const hookFn of perToolPreHooks) {
        try {
          const decision = await hookFn(context);
          if (!decision.allow) {
            return {
              allow: false,
              reason: decision.reason ?? 'Blocked by per-tool pre-hook',
            };
          }
        } catch (err) {
          throw new HookExecutionError(
            `Per-tool pre-hook failed for ${context.toolName}: ${(err as Error).message}`,
          );
        }
      }
    }

    // 2. Global HTTP pre-hooks
    if (this.globalRunner) {
      return this.globalRunner.runPreToolUse(context);
    }

    return { allow: true };
  }

  /**
   * POST hooks: global HTTP hooks first, then per-tool in-process.
   * Per-tool post-hooks may return partial ToolResult to merge.
   */
  async runPostToolUse(
    context: ToolHookPostContext,
    perToolPostHooks?: PostToolHookFn[],
  ): Promise<Partial<ToolResult> | void> {
    // 1. Global HTTP post-hooks (fire-and-forget observation)
    if (this.globalRunner) {
      await this.globalRunner.runPostToolUse(context);
    }

    // 2. Per-tool in-process post-hooks (may enrich result)
    let enrichment: Partial<ToolResult> | undefined;
    if (perToolPostHooks?.length) {
      for (const hookFn of perToolPostHooks) {
        try {
          const partial = await hookFn(context);
          if (partial && typeof partial === 'object') {
            enrichment = { ...enrichment, ...partial };
          }
        } catch (err) {
          // Post-hook errors never fail the tool — log and continue
          console.warn(
            `[Hook] Per-tool post-hook error for ${context.toolName}:`,
            (err as Error).message,
          );
        }
      }
    }

    return enrichment;
  }
}

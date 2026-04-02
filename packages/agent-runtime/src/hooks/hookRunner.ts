import type { ToolResult, ActionRiskLevel, CompanyAgentRole } from '../types.js';
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
  runPostToolUse(context: ToolHookPostContext): Promise<void>;
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

import type { ToolContext, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';

interface CodexInvocation {
  prompt?: string;
  message?: string;
  repo: string;
  branch: string;
  skill?: string;
  approval_policy?: string;
  sandbox?: string;
  conversation_id?: string;
}

function getCodexMcpUrl(): string {
  const url = process.env.GLYPHOR_MCP_CODEX_URL?.trim();
  if (!url) {
    throw new Error('Codex MCP is not configured. Set GLYPHOR_MCP_CODEX_URL and expose codex/codex-reply tools.');
  }
  return url;
}

async function callCodexMcpTool(
  toolName: 'codex' | 'codex-reply',
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const response = await fetch(getCodexMcpUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ctx.agentRole ? { 'X-Agent-Role': ctx.agentRole } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: params,
        },
      }),
      signal: ctx.abortSignal,
    });

    const raw = await response.text();
    if (!response.ok) {
      return {
        success: false,
        error: `Codex MCP call failed (${response.status}): ${raw.slice(0, 1000)}`,
      };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {
        success: false,
        error: `Codex MCP returned non-JSON response: ${raw.slice(0, 1000)}`,
      };
    }

    if (payload.error) {
      const err = payload.error as Record<string, unknown>;
      return { success: false, error: String(err.message ?? 'Unknown Codex MCP error') };
    }

    return { success: true, data: payload.result ?? payload };
  } catch (err) {
    return {
      success: false,
      error: `Codex MCP request failed: ${(err as Error).message}`,
    };
  }
}

function normalizeCodexParams(params: Record<string, unknown>): CodexInvocation {
  return {
    prompt: typeof params.prompt === 'string' ? params.prompt : undefined,
    message: typeof params.message === 'string' ? params.message : undefined,
    repo: String(params.repo ?? ''),
    branch: String(params.branch ?? ''),
    skill: typeof params.skill === 'string' ? params.skill : undefined,
    approval_policy: typeof params.approval_policy === 'string' ? params.approval_policy : undefined,
    sandbox: typeof params.sandbox === 'string' ? params.sandbox : undefined,
    conversation_id: typeof params.conversation_id === 'string' ? params.conversation_id : undefined,
  };
}

function validateBaseInvocation(invocation: CodexInvocation, allowMessageOnly: boolean): string | null {
  if (!invocation.repo.trim()) return 'repo is required.';
  if (!invocation.branch.trim()) return 'branch is required.';
  if (!allowMessageOnly && !invocation.prompt?.trim()) return 'prompt is required.';
  if (allowMessageOnly && !invocation.message?.trim()) return 'message is required.';
  return null;
}

export function createCodexTools(): ToolDefinition[] {
  return [
    {
      name: 'codex',
      description: 'Execute a Codex build task against a repository branch using the ux-engineer skill and autonomous policy defaults.',
      parameters: {
        prompt: {
          type: 'string',
          description: 'Full build prompt including normalized brief and implementation expectations.',
          required: true,
        },
        repo: {
          type: 'string',
          description: 'Repository in owner/name format.',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Target feature branch for Codex commits.',
          required: true,
        },
        skill: {
          type: 'string',
          description: 'Codex skill to load. Defaults to ux-engineer.',
          required: false,
        },
        approval_policy: {
          type: 'string',
          description: 'Approval policy, defaults to never.',
          required: false,
        },
        sandbox: {
          type: 'string',
          description: 'Sandbox mode, defaults to workspace-write.',
          required: false,
        },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const invocation = normalizeCodexParams(params);
        const validationError = validateBaseInvocation(invocation, false);
        if (validationError) {
          return { success: false, error: validationError };
        }

        return callCodexMcpTool(
          'codex',
          {
            prompt: invocation.prompt,
            repo: invocation.repo,
            branch: invocation.branch,
            skill: invocation.skill ?? 'ux-engineer',
            approval_policy: invocation.approval_policy ?? 'never',
            sandbox: invocation.sandbox ?? 'workspace-write',
          },
          ctx,
        );
      },
    },
    {
      name: 'codex-reply',
      description: 'Continue a Codex build thread with targeted revision instructions for an existing repository branch.',
      parameters: {
        message: {
          type: 'string',
          description: 'Targeted feedback or change request to apply.',
          required: true,
        },
        repo: {
          type: 'string',
          description: 'Repository in owner/name format.',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Existing branch to continue editing.',
          required: true,
        },
        conversation_id: {
          type: 'string',
          description: 'Optional conversation/thread id from prior Codex output.',
          required: false,
        },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const invocation = normalizeCodexParams(params);
        const validationError = validateBaseInvocation(invocation, true);
        if (validationError) {
          return { success: false, error: validationError };
        }

        return callCodexMcpTool(
          'codex-reply',
          {
            message: invocation.message,
            repo: invocation.repo,
            branch: invocation.branch,
            conversation_id: invocation.conversation_id,
          },
          ctx,
        );
      },
    },
  ];
}

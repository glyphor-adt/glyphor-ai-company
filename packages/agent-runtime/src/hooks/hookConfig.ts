export interface HttpHookEndpoint {
  name: string;
  url: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface ToolHookConfig {
  allowedHosts?: string[];
  preToolUse?: HttpHookEndpoint[];
  postToolUse?: HttpHookEndpoint[];
}

const TOOL_HOOKS_CONFIG_ENV = 'TOOL_HOOKS_CONFIG';

export function loadToolHookConfigFromEnv(): ToolHookConfig | null {
  const raw = process.env[TOOL_HOOKS_CONFIG_ENV];
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ToolHookConfig;
    const normalized = normalizeToolHookConfig(parsed);
    if (!normalized.preToolUse?.length && !normalized.postToolUse?.length) {
      return null;
    }
    return normalized;
  } catch (error) {
    console.warn(
      `[ToolHooks] Failed to parse ${TOOL_HOOKS_CONFIG_ENV}:`,
      (error as Error).message,
    );
    return null;
  }
}

function normalizeToolHookConfig(input: ToolHookConfig): ToolHookConfig {
  return {
    allowedHosts: normalizeHosts(input.allowedHosts),
    preToolUse: normalizeEndpoints(input.preToolUse),
    postToolUse: normalizeEndpoints(input.postToolUse),
  };
}

function normalizeHosts(input?: string[]): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const values = input.map((host) => host.trim().toLowerCase()).filter(Boolean);
  return values.length > 0 ? Array.from(new Set(values)) : undefined;
}

function normalizeEndpoints(input?: HttpHookEndpoint[]): HttpHookEndpoint[] | undefined {
  if (!Array.isArray(input)) return undefined;

  const normalized: HttpHookEndpoint[] = [];
  for (const endpoint of input) {
    if (!endpoint || typeof endpoint.name !== 'string' || typeof endpoint.url !== 'string') {
      continue;
    }
    const name = endpoint.name.trim();
    const url = endpoint.url.trim();
    if (!name || !url) continue;
    normalized.push({
      name,
      url,
      ...(endpoint.timeoutMs && endpoint.timeoutMs > 0 ? { timeoutMs: endpoint.timeoutMs } : {}),
      ...(endpoint.headers ? { headers: endpoint.headers } : {}),
    });
  }

  return normalized.length > 0 ? normalized : undefined;
}

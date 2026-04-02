import { assertSafeOutboundUrl } from '../security/ssrfGuard.js';
import type { HttpHookEndpoint } from './hookConfig.js';

const DEFAULT_HOOK_TIMEOUT_MS = 5000;

export async function callHookEndpoint(
  endpoint: HttpHookEndpoint,
  payload: Record<string, unknown>,
  options: { allowedHosts?: string[] } = {},
): Promise<unknown> {
  const safeUrl = await assertSafeOutboundUrl(endpoint.url, { allowedHosts: options.allowedHosts });
  const timeoutMs = endpoint.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;

  const response = await fetch(safeUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(endpoint.headers ?? {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Hook ${endpoint.name} failed with ${response.status}`);
  }

  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

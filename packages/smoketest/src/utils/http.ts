/**
 * HTTP fetch helpers with timeout support.
 */

export interface HttpResponse<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
  raw: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * HTTP GET with timeout.
 */
export async function httpGet<T = unknown>(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  headers?: Record<string, string>,
): Promise<HttpResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, { signal: controller.signal, headers });
    const raw = await resp.text();
    let data: T;
    try {
      data = JSON.parse(raw) as T;
    } catch {
      data = raw as unknown as T;
    }
    return { status: resp.status, ok: resp.ok, data, raw };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HTTP POST with JSON body and timeout.
 */
export async function httpPost<T = unknown>(
  url: string,
  body: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<HttpResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await resp.text();
    let data: T;
    try {
      data = JSON.parse(raw) as T;
    } catch {
      data = raw as unknown as T;
    }
    return { status: resp.status, ok: resp.ok, data, raw };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Poll a URL until a condition is met, with timeout.
 */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  condition: (result: T) => boolean,
  intervalMs = 10_000,
  maxWaitMs = 120_000,
): Promise<T> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (condition(result)) return result;
    await sleep(intervalMs);
  }
  throw new Error(`pollUntil timed out after ${maxWaitMs}ms`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

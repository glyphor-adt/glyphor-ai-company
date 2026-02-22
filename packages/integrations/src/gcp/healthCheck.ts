/**
 * GCP Health Check — Ping Cloud Run services and report status
 */

export interface ServiceHealth {
  url: string;
  service: string;
  status: 'healthy' | 'degraded' | 'down';
  latencyMs: number;
  statusCode: number | null;
  error: string | null;
  checkedAt: string;
}

/** Ping a single service URL and measure response */
export async function pingService(url: string, service: string, timeoutMs = 10_000): Promise<ServiceHealth> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const latencyMs = Date.now() - start;
    clearTimeout(timer);

    return {
      url,
      service,
      status: response.ok ? 'healthy' : 'degraded',
      latencyMs,
      statusCode: response.status,
      error: null,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      url,
      service,
      status: 'down',
      latencyMs: Date.now() - start,
      statusCode: null,
      error: (err as Error).message,
      checkedAt: new Date().toISOString(),
    };
  }
}

/** Ping multiple services and return all results */
export async function pingServices(
  services: Array<{ url: string; name: string }>,
  timeoutMs = 10_000,
): Promise<ServiceHealth[]> {
  return Promise.all(services.map((s) => pingService(s.url, s.name, timeoutMs)));
}

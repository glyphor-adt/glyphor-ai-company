import type { IncomingMessage, ServerResponse } from 'node:http';

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function loadTrustedOrigins(): Set<string> {
  const defaultDashboard = (process.env.DASHBOARD_URL?.trim() || 'https://dashboard.glyphor.com').replace(/\/$/, '');
  return new Set(
    [
      ...((process.env.CORS_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)),
      process.env.DASHBOARD_URL?.trim(),
      process.env.PUBLIC_URL?.trim(),
      process.env.SERVICE_URL?.trim(),
      defaultDashboard,
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3000',
      'https://glyphor-dashboard-610179349713.us-central1.run.app',
    ]
      .filter((origin): origin is string => Boolean(origin && origin.length > 0))
      .map((origin) => origin.replace(/\/$/, '')),
  );
}

export const TRUSTED_CORS_ORIGINS = loadTrustedOrigins();

/** Reflects request Origin when it is in the allowlist; otherwise null (do not fake a default). */
export function getCorsOrigin(req: IncomingMessage): string | null {
  const originHeader = getHeaderString(req.headers.origin)?.trim();
  if (!originHeader) return null;
  const normalizedOrigin = originHeader.replace(/\/$/, '');
  if (!TRUSTED_CORS_ORIGINS.has(normalizedOrigin)) return null;
  return normalizedOrigin;
}

export function corsHeadersFor(req: IncomingMessage | undefined): Record<string, string> {
  if (!req) return {};
  const origin = getCorsOrigin(req);
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    // So dashboard (cross-origin fetch to scheduler) can read auth denial diagnostics in apiCall().
    'Access-Control-Expose-Headers': 'X-Glyphor-Auth-Reason, X-Glyphor-Auth-Result',
  };
}

export function appendCorsHeaders(req: IncomingMessage, headers: Record<string, string>): Record<string, string> {
  const extra = corsHeadersFor(req);
  for (const [k, v] of Object.entries(extra)) {
    headers[k] = v;
  }
  return headers;
}

/** For handlers that use res.setHeader manually (exports, PDF, etc.). */
export function applyCorsToResponse(res: ServerResponse, req: IncomingMessage): void {
  const h = corsHeadersFor(req);
  for (const [k, v] of Object.entries(h)) {
    res.setHeader(k, v);
  }
}

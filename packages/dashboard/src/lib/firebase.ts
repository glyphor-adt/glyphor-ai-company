import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, type Auth } from 'firebase/auth';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
const AUTH_EXPIRED_EVENT = 'glyphor-auth-expired';

const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
if (apiKey && apiKey !== 'your-firebase-api-key-here') {
  const firebaseConfig = {
    apiKey,
    authDomain: 'ai-glyphor-company.firebaseapp.com',
    projectId: 'ai-glyphor-company',
  };
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
}

export { auth };

export async function login(email: string, password: string) {
  if (!auth) throw new Error('Firebase Auth not configured');
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user.getIdToken();
}

export async function getAuthToken(): Promise<string | null> {
  if (!auth) return null;
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

function notifyAuthExpired(reason: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { reason } }));
}

function decodeJwtExpSeconds(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
    const payloadText = atob(padded);
    const payload = JSON.parse(payloadText) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function getStoredBrowserAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(BROWSER_AUTH_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Record<string, unknown>;

    // Support legacy auth object shapes so existing sessions keep working.
    const candidates = [
      parsed.authToken,
      parsed.idToken,
      parsed.credential,
      parsed.token,
      parsed.accessToken,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        const expSeconds = decodeJwtExpSeconds(candidate);
        if (typeof expSeconds === 'number' && expSeconds * 1000 <= Date.now()) {
          window.localStorage.removeItem(BROWSER_AUTH_STORAGE_KEY);
          notifyAuthExpired('stored-token-expired');
          return null;
        }
        return candidate;
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function getPreferredAuthToken(): Promise<string | null> {
  return (await getAuthToken()) ?? getStoredBrowserAuthToken();
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

export async function buildApiHeaders(headers?: HeadersInit): Promise<Record<string, string>> {
  const token = await getPreferredAuthToken();
  return {
    ...normalizeHeaders(headers),
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    'Content-Type': 'application/json',
  };
}

const LEGACY_SCHEDULER_HOST = 'glyphor-scheduler-v55622rp6q-uc.a.run.app';
/** Scheduler origin — admin routes live here (`/admin/*`), not on the dashboard service. */
export const CANONICAL_SCHEDULER_URL = 'https://glyphor-scheduler-610179349713.us-central1.run.app';
const PROD_DASHBOARD_HOST = 'glyphor-dashboard-610179349713.us-central1.run.app';
const BROWSER_AUTH_STORAGE_KEY = 'glyphor-auth';

function normalizeSchedulerUrl(rawValue: string | undefined): string {
  const value = (rawValue ?? '').trim();
  if (!value) return CANONICAL_SCHEDULER_URL;
  if (value.includes(LEGACY_SCHEDULER_HOST)) return CANONICAL_SCHEDULER_URL;
  return value;
}

/** Hostname only — accepts `dashboard.example.com` or `https://dashboard.example.com/path`. */
function parseDashboardHostEntry(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  try {
    if (t.includes('://')) {
      return new URL(t).hostname;
    }
  } catch {
    // fall through
  }
  return t.split('/')[0] ?? t;
}

/**
 * True when the SPA is served from a dashboard-only host: same-origin `/api/*` is dashboard CRUD,
 * so `/admin/*`, `/api/eval/*`, and `/api/governance/*` must be sent to the scheduler origin.
 * Matches the canonical Cloud Run hostname, any `glyphor-dashboard-*.*.run.app` deployment,
 * and optional comma-separated `VITE_DASHBOARD_HOSTNAME` (hostnames or full origins).
 */
export function isDashboardSchedulerSplitHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  if (h === PROD_DASHBOARD_HOST) return true;
  const extra = (import.meta.env.VITE_DASHBOARD_HOSTNAME ?? '')
    .split(',')
    .map((s: string) => parseDashboardHostEntry(s))
    .filter(Boolean);
  if (extra.includes(h)) return true;
  // e.g. glyphor-dashboard-<project>.us-central1.run.app (redeploys / new project ids)
  if (/^glyphor-dashboard-[a-z0-9-]+\.[a-z0-9.-]+\.run\.app$/i.test(h)) return true;
  return false;
}

/** Alias for split-dashboard detection (same semantics as isDashboardSchedulerSplitHost at first paint). */
export const IS_PROD_DASHBOARD_HOST =
  typeof window !== 'undefined' && isDashboardSchedulerSplitHost();

function getDashboardCrudApiBaseUrl(): string {
  if (typeof window !== 'undefined' && isDashboardSchedulerSplitHost()) {
    return '';
  }
  return normalizeSchedulerUrl(import.meta.env.VITE_API_URL || import.meta.env.VITE_SCHEDULER_URL);
}

/**
 * Same-origin `/api/*` on the prod dashboard host is the dashboard CRUD API (`dashboardApi.ts` table routes).
 * Paths handled by the scheduler must not hit that layer — e.g. `/api/eval/*` would be parsed as table `eval`
 * → 404 Unknown API resource. So on prod dashboard, use the scheduler origin for:
 *   - `/admin/*` (admin APIs)
 *   - `/api/eval/*` (Fleet, eval dashboard — `evalDashboard.ts`)
 *   - `/api/governance/*` (governance JSON API — `handleGovernanceApi`)
 * CORS: scheduler must allow this dashboard origin (`CORS_ALLOWED_ORIGINS` / `DASHBOARD_URL`).
 */
function resolveApiPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized;
}

function isSchedulerHostedPath(normalizedPath: string): boolean {
  return (
    normalizedPath.startsWith('/admin/')
    || normalizedPath.startsWith('/api/eval/')
    || normalizedPath.startsWith('/api/governance/')
  );
}

/** Thrown by {@link apiCall} on non-OK responses; includes scheduler auth diagnostics when present. */
export class GlyphorApiError extends Error {
  readonly status: number;
  /** From `X-Glyphor-Auth-Reason` when the scheduler denies access (see `packages/scheduler/src/server.ts`). */
  readonly authReason: string | undefined;

  constructor(message: string, status: number, authReason?: string) {
    super(message);
    this.name = 'GlyphorApiError';
    this.status = status;
    this.authReason = authReason;
  }
}

export function isGlyphorApiError(err: unknown): err is GlyphorApiError {
  return err instanceof GlyphorApiError;
}

/** User-facing explanation for scheduler `X-Glyphor-Auth-Reason` values. */
export function formatGlyphorAuthDenialHint(authReason: string | undefined): string | null {
  if (!authReason) return null;
  switch (authReason) {
    case 'admin-required':
      return 'Fleet and eval APIs require a dashboard admin. Ask an admin to set your role to admin in the dashboard_users table (or add your email to the server fallback admin list).';
    case 'dashboard-user-not-found':
      return 'Your account is not in dashboard_users. Ask an admin to add your Firebase email there.';
    case 'token-verification-failed':
    case 'missing-bearer':
    case 'empty-bearer':
      return 'Sign in again; the API could not verify your session token.';
    default:
      return null;
  }
}

export async function apiCall<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const useScheduler = isDashboardSchedulerSplitHost() && isSchedulerHostedPath(normalized);
  const baseUrl = useScheduler ? CANONICAL_SCHEDULER_URL : getDashboardCrudApiBaseUrl();
  const resolvedPath = resolveApiPath(path);
  const res = await fetch(`${baseUrl}${resolvedPath}`, {
    ...options,
    headers: await buildApiHeaders(options.headers),
  });
  if (!res.ok) {
    const authReason = res.headers.get('x-glyphor-auth-reason')?.trim() || undefined;
    let details = '';
    try {
      details = await res.text();
    } catch {
      details = '';
    }
    if (res.status === 401 || res.status === 403) {
      const blob = `${res.status} ${res.statusText} ${details}`.toLowerCase();
      const isCredentialProblem =
        authReason === 'missing-bearer'
        || authReason === 'empty-bearer'
        || authReason === 'token-verification-failed'
        || blob.includes('bearer token required')
        || (blob.includes('unauthorized') && authReason !== 'admin-required' && authReason !== 'dashboard-user-not-found')
        || (blob.includes('token') && authReason !== 'admin-required' && authReason !== 'dashboard-user-not-found');
      if (isCredentialProblem) {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(BROWSER_AUTH_STORAGE_KEY);
        }
        notifyAuthExpired('api-unauthorized');
      }
    }
    const hint = formatGlyphorAuthDenialHint(authReason);
    const suffix = details ? ` — ${details}` : '';
    const core = hint
      ? `API error: ${res.status} ${res.statusText}. ${hint}${suffix}`
      : `API error: ${res.status} ${res.statusText}${suffix}`;
    throw new GlyphorApiError(core, res.status, authReason);
  }
  return res.json();
}

export { AUTH_EXPIRED_EVENT };

export const SCHEDULER_URL = normalizeSchedulerUrl(
  (import.meta.env.VITE_SCHEDULER_URL as string) ?? getDashboardCrudApiBaseUrl(),
);

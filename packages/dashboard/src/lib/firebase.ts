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
const CANONICAL_SCHEDULER_URL = 'https://glyphor-scheduler-610179349713.us-central1.run.app';
const PROD_DASHBOARD_HOST = 'glyphor-dashboard-610179349713.us-central1.run.app';
const BROWSER_AUTH_STORAGE_KEY = 'glyphor-auth';

function normalizeSchedulerUrl(rawValue: string | undefined): string {
  const value = (rawValue ?? '').trim();
  if (!value) return CANONICAL_SCHEDULER_URL;
  if (value.includes(LEGACY_SCHEDULER_HOST)) return CANONICAL_SCHEDULER_URL;
  return value;
}

const isProdDashboardHost =
  typeof window !== 'undefined'
  && window.location.hostname === PROD_DASHBOARD_HOST;

const API_URL = isProdDashboardHost
  ? ''
  : normalizeSchedulerUrl(import.meta.env.VITE_API_URL || import.meta.env.VITE_SCHEDULER_URL);

function resolveApiPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (isProdDashboardHost && normalized.startsWith('/admin/')) {
    return `/api${normalized}`;
  }
  return normalized;
}

export async function apiCall<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const resolvedPath = resolveApiPath(path);
  const res = await fetch(`${API_URL}${resolvedPath}`, {
    ...options,
    headers: await buildApiHeaders(options.headers),
  });
  if (!res.ok) {
    let details = '';
    try {
      details = await res.text();
    } catch {
      details = '';
    }
    if (res.status === 401 || res.status === 403) {
      const message = `${res.status} ${res.statusText} ${details}`.toLowerCase();
      if (message.includes('bearer token required') || message.includes('unauthorized') || message.includes('token')) {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(BROWSER_AUTH_STORAGE_KEY);
        }
        notifyAuthExpired('api-unauthorized');
      }
    }
    const suffix = details ? ` — ${details}` : '';
    throw new Error(`API error: ${res.status} ${res.statusText}${suffix}`);
  }
  return res.json();
}

export { AUTH_EXPIRED_EVENT };

export const SCHEDULER_URL = normalizeSchedulerUrl((import.meta.env.VITE_SCHEDULER_URL as string) ?? API_URL);

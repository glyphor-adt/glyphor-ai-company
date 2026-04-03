import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, type Auth } from 'firebase/auth';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

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

const LEGACY_SCHEDULER_HOST = 'glyphor-scheduler-v55622rp6q-uc.a.run.app';
const CANONICAL_SCHEDULER_URL = 'https://glyphor-scheduler-610179349713.us-central1.run.app';
const PROD_DASHBOARD_HOST = 'glyphor-dashboard-610179349713.us-central1.run.app';

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

export async function apiCall<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    let details = '';
    try {
      details = await res.text();
    } catch {
      details = '';
    }
    const suffix = details ? ` — ${details}` : '';
    throw new Error(`API error: ${res.status} ${res.statusText}${suffix}`);
  }
  return res.json();
}

export const SCHEDULER_URL = normalizeSchedulerUrl((import.meta.env.VITE_SCHEDULER_URL as string) ?? API_URL);

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signInWithCustomToken, onAuthStateChanged, type User } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: 'ai-glyphor-company.firebaseapp.com',
  projectId: 'ai-glyphor-company',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export async function login(email: string, password: string) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user.getIdToken();
}

export async function getAuthToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

const API_URL = import.meta.env.VITE_API_URL || '';

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
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

export const SCHEDULER_URL = (import.meta.env.VITE_SCHEDULER_URL as string) ?? '';

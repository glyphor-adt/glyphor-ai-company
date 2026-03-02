import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { GoogleOAuthProvider, GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';
import * as teamsJs from '@microsoft/teams-js';
import { apiCall } from './firebase';

const STORAGE_KEY = 'glyphor-auth';

// Fallback allowlist in case DB is unreachable
const FALLBACK_EMAILS = ['kristina@glyphor.ai', 'andrew@glyphor.ai', 'devops@glyphor.ai', 'andrew.zwelling@gmail.com'];

/** Emails that are always treated as admin even if DB is down */
export const FALLBACK_ADMINS = ['kristina@glyphor.ai', 'andrew@glyphor.ai', 'andrew.zwelling@gmail.com', 'devops@glyphor.ai'];

/** Email alias groups — all emails in a group share the same chat history */
const EMAIL_ALIAS_GROUPS: string[][] = [
  ['kristina@glyphor.ai', 'devops@glyphor.ai'],
  ['andrew@glyphor.ai', 'andrew.zwelling@gmail.com'],
];

/** Return all email aliases for the given email (including itself) */
export function getEmailAliases(email: string): string[] {
  const lower = email.toLowerCase();
  const group = EMAIL_ALIAS_GROUPS.find(g => g.includes(lower));
  return group ?? [lower];
}

// Cache allowed emails from the DB so we don't query on every check
let _allowedCache: Set<string> | null = null;
let _cachePromise: Promise<Set<string>> | null = null;

async function fetchAllowedEmails(): Promise<Set<string>> {
  if (_cachePromise) return _cachePromise;
  _cachePromise = (async () => {
    try {
      const data = await apiCall<{ email: string }[]>('/api/dashboard-users');
      if (!data || data.length === 0) {
        // API unavailable or empty — use fallback
        return new Set(FALLBACK_EMAILS);
      }
      const set = new Set(data.map((r) => r.email.toLowerCase()));
      _allowedCache = set;
      setTimeout(() => { _allowedCache = null; _cachePromise = null; }, 60_000);
      return set;
    } catch {
      return new Set(FALLBACK_EMAILS);
    }
  })();
  return _cachePromise;
}

async function isAllowedEmail(email: string): Promise<boolean> {
  const lower = email.toLowerCase();
  const allowed = _allowedCache ?? await fetchAllowedEmails();
  return allowed.has(lower);
}

/** Invalidate the cache (called after adding/removing users) */
export function invalidateAllowedCache() {
  _allowedCache = null;
  _cachePromise = null;
}

/** Detect Teams context via URL param or iframe ancestor */
function isTeamsContext(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get('teamsTab') === 'true') return true;
  try { return window.self !== window.top; } catch { return true; }
}

interface User {
  email: string;
  name: string;
  picture: string;
}

interface AuthState {
  user: User | null;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({ user: null, logout: () => {} });

export const useAuth = () => useContext(AuthContext);

// ─── Teams SSO Auth Gate ────────────────────────────────────────

function TeamsAuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function initTeamsSSO() {
      try {
        await teamsJs.app.initialize();
        const context = await teamsJs.app.getContext();

        // Try SSO token first
        try {
          const token = await teamsJs.authentication.getAuthToken();
          const decoded = jwtDecode<{
            preferred_username?: string;
            upn?: string;
            name?: string;
            email?: string;
          }>(token);

          const email = decoded.preferred_username ?? decoded.upn ?? decoded.email ?? '';
          if (!email || !(await isAllowedEmail(email))) {
            if (!cancelled) setError(`Access denied for ${email}`);
            if (!cancelled) setLoading(false);
            return;
          }

          if (!cancelled) {
            setUser({
              email,
              name: decoded.name ?? email.split('@')[0],
              picture: '',
            });
            setLoading(false);
          }
          return;
        } catch {
          // SSO token failed — fall back to Teams context
        }

        // Fallback: use Teams context (already authenticated via Teams)
        const loginHint = context.user?.loginHint ?? '';
        const displayName = context.user?.displayName ?? loginHint.split('@')[0];

        if (loginHint && await isAllowedEmail(loginHint)) {
          if (!cancelled) {
            setUser({
              email: loginHint,
              name: displayName,
              picture: '',
            });
            setLoading(false);
          }
        } else {
          if (!cancelled) setError(`Access denied for ${loginHint || 'unknown user'}`);
          if (!cancelled) setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(`Teams initialization failed: ${err instanceof Error ? err.message : String(err)}`);
          setLoading(false);
        }
      }
    }

    initTeamsSSO();
    return () => { cancelled = true; };
  }, []);

  const logout = useCallback(() => setUser(null), []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan border-t-transparent" />
          <p className="text-sm text-txt-muted">Signing in via Teams...</p>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base">
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="text-sm text-prism-critical">{error || 'Unable to authenticate via Teams'}</p>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Google OAuth Auth Gate ─────────────────────────────────────

function GoogleAuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored) as User & { exp: number };
      if (parsed.exp && parsed.exp * 1000 < Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  });

  const [error, setError] = useState('');

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }, []);

  const handleSuccess = useCallback(async (response: CredentialResponse) => {
    if (!response.credential) return;
    try {
      const decoded = jwtDecode<{
        email: string;
        name: string;
        picture: string;
        exp: number;
      }>(response.credential);

      if (!(await isAllowedEmail(decoded.email))) {
        setError(`Access denied for ${decoded.email}`);
        return;
      }

      const userData = {
        email: decoded.email,
        name: decoded.name,
        picture: decoded.picture,
        exp: decoded.exp,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
      setUser(userData);
      setError('');
    } catch {
      setError('Authentication failed');
    }
  }, []);

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base">
        <div className="flex flex-col items-center gap-8">
          <div className="flex items-center gap-3">
            <img src="/glyphor-logo.png" alt="Glyphor" className="h-14 w-14 drop-shadow-[0_0_16px_rgba(34,211,238,0.5)]" />
            <div>
              <h1 className="text-2xl font-bold text-txt-primary">Glyphor</h1>
              <p className="text-sm text-txt-muted">Command Center</p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-8 shadow-lg">
            <p className="mb-6 text-center text-sm text-txt-secondary">
              Sign in with your Glyphor Google account
            </p>
            <div className="flex justify-center">
              <GoogleLogin
                onSuccess={handleSuccess}
                onError={() => setError('Sign-in failed')}
                theme="outline"
                size="large"
                shape="pill"
                text="signin_with"
              />
            </div>
            {error && (
              <p className="mt-4 text-center text-sm text-prism-critical">{error}</p>
            )}
          </div>

          <p className="text-xs text-txt-faint">Authorized personnel only</p>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Auth Provider ──────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  // Teams context — use Teams SSO (no Google popup)
  if (isTeamsContext()) {
    return <TeamsAuthGate>{children}</TeamsAuthGate>;
  }

  if (!clientId) {
    // Dev mode without OAuth — skip auth
    return (
      <AuthContext.Provider
        value={{
          user: { email: 'dev@localhost', name: 'Dev', picture: '' },
          logout: () => {},
        }}
      >
        {children}
      </AuthContext.Provider>
    );
  }

  return (
    <GoogleOAuthProvider clientId={clientId}>
      <GoogleAuthGate>{children}</GoogleAuthGate>
    </GoogleOAuthProvider>
  );
}

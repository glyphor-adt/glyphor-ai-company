import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { GoogleOAuthProvider, GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';

const ALLOWED_EMAILS = ['kristina@glyphor.ai', 'andrew@glyphor.ai', 'devops@glyphor.ai'];
const STORAGE_KEY = 'glyphor-auth';

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

function AuthGate({ children }: { children: ReactNode }) {
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

  const handleSuccess = useCallback((response: CredentialResponse) => {
    if (!response.credential) return;
    try {
      const decoded = jwtDecode<{
        email: string;
        name: string;
        picture: string;
        exp: number;
      }>(response.credential);

      if (!ALLOWED_EMAILS.includes(decoded.email.toLowerCase())) {
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
            <img src="/glyphor-logo.png" alt="Glyphor" className="h-14 w-14 drop-shadow-[0_0_16px_rgba(0,224,255,0.5)]" />
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
              <p className="mt-4 text-center text-sm text-red-400">{error}</p>
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

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
      <AuthGate>{children}</AuthGate>
    </GoogleOAuthProvider>
  );
}

/**
 * Figma OAuth Token Manager
 *
 * Manages OAuth access tokens for Figma REST API.
 * - Exchanges client credentials for access_token + refresh_token
 * - Caches token in memory with TTL
 * - Auto-refreshes before expiry
 *
 * Environment variables:
 *   FIGMA_CLIENT_ID     — OAuth app client ID
 *   FIGMA_CLIENT_SECRET — OAuth app client secret
 */

const FIGMA_TOKEN_URL = 'https://api.figma.com/v1/oauth/token';

interface TokenCache {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp ms
}

let tokenCache: TokenCache | null = null;

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.FIGMA_CLIENT_ID;
  const clientSecret = process.env.FIGMA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('FIGMA_CLIENT_ID and FIGMA_CLIENT_SECRET must be configured');
  }
  return { clientId, clientSecret };
}

export async function getFigmaAccessToken(): Promise<string> {
  // Return cached token if still valid (60s buffer before expiry)
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }

  // Try refresh if we have a refresh token
  if (tokenCache?.refreshToken) {
    try {
      return await refreshToken(tokenCache.refreshToken);
    } catch {
      // Refresh failed, fall through to new token exchange
      tokenCache = null;
    }
  }

  // Need initial token — this requires an authorization code from OAuth flow
  // In a server context, we may use a stored refresh token from initial setup
  const storedRefresh = process.env.FIGMA_REFRESH_TOKEN;
  if (storedRefresh) {
    return await refreshToken(storedRefresh);
  }

  throw new Error(
    'No Figma access token available. Run the OAuth authorization flow first ' +
    'and set FIGMA_REFRESH_TOKEN in the environment.'
  );
}

async function refreshToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = getCredentials();

  const res = await fetch(FIGMA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Figma token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  tokenCache = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

/** Make an authenticated request to the Figma API */
export async function figmaFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await getFigmaAccessToken();
  const url = path.startsWith('http') ? path : `https://api.figma.com/v1${path}`;

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: options.signal ?? AbortSignal.timeout(30_000),
  });
}

/** Clear cached token (for testing or forced re-auth) */
export function clearFigmaTokenCache(): void {
  tokenCache = null;
}

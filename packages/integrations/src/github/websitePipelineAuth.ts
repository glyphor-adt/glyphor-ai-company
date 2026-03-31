import { requireWebsitePipelineEnv } from '../websitePipelineEnv.js';

interface CachedInstallationToken {
  token: string;
  expiresAtMs: number;
}

let cachedInstallationToken: CachedInstallationToken | null = null;

function resolveEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function toBase64Url(value: string | Buffer | ArrayBuffer): string {
  const buffer = typeof value === 'string'
    ? Buffer.from(value)
    : value instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(value))
      : value;

  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function normalizePrivateKey(privateKey: string): string {
  return privateKey.includes('-----BEGIN') ? privateKey : privateKey.replace(/\\n/g, '\n');
}

async function createGitHubAppJwt(appId: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = toBase64Url(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }));
  const unsignedToken = `${header}.${payload}`;
  const normalizedKey = normalizePrivateKey(privateKey);
  const pemContents = normalizedKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(Buffer.from(pemContents, 'base64')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedToken),
  );
  return `${unsignedToken}.${toBase64Url(signature)}`;
}

async function createInstallationAccessToken(
  appId: string,
  privateKey: string,
  installationId: string,
): Promise<string> {
  if (cachedInstallationToken && Date.now() < cachedInstallationToken.expiresAtMs - 60_000) {
    return cachedInstallationToken.token;
  }

  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await createGitHubAppJwt(appId, privateKey)}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = String((data as Record<string, unknown> | null)?.message ?? 'Unknown GitHub App auth error');
    throw new Error(`GitHub App auth failed (${response.status}): ${message}`);
  }

  const payload = data as Record<string, unknown>;
  const token = String(payload.token ?? '').trim();
  const expiresAt = String(payload.expires_at ?? '').trim();
  if (!token || !expiresAt) {
    throw new Error('GitHub App auth response did not include token metadata.');
  }

  cachedInstallationToken = {
    token,
    expiresAtMs: new Date(expiresAt).getTime(),
  };
  return token;
}

export async function getWebsitePipelineGitHubToken(): Promise<string> {
  const appId = resolveEnv('GITHUB_APP_ID', 'FUSE_GITHUB_APP_ID');
  const privateKey = resolveEnv('GITHUB_APP_PRIVATE_KEY', 'FUSE_GITHUB_APP_PRIVATE_KEY');
  const installationId = resolveEnv(
    'GITHUB_INSTALLATION_ID',
    'GLYPHOR_INSTALLATION_ID',
    'FUSE_GITHUB_INSTALLATION_ID',
    'FUSE_GLYPHOR_INSTALLATION_ID',
  );

  if (appId && privateKey && installationId) {
    try {
      return await createInstallationAccessToken(appId, privateKey, installationId);
    } catch (error) {
      const fallbackToken = resolveEnv('GITHUB_SERVICE_PAT', 'FUSE_GITHUB_SERVICE_PAT', 'GITHUB_MCP_TOKEN', 'GITHUB_TOKEN');
      if (fallbackToken) {
        console.warn(`[GitHub] GitHub App auth failed, falling back to shared token: ${(error as Error).message}`);
        return fallbackToken;
      }
      throw error;
    }
  }

  return requireWebsitePipelineEnv('github-token');
}
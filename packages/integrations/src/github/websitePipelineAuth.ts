import { requireWebsitePipelineEnv } from '../websitePipelineEnv.js';

interface CachedInstallationToken {
  token: string;
  expiresAtMs: number;
}

type GitHubCredentialProfile = 'core' | 'fuse';

const FUSE_OWNER_NAMES = new Set(['glyphor-fuse']);
const cachedInstallationTokenByProfile: Partial<Record<GitHubCredentialProfile, CachedInstallationToken>> = {};

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
  profile: GitHubCredentialProfile,
  appId: string,
  privateKey: string,
  installationId: string,
): Promise<string> {
  const cachedInstallationToken = cachedInstallationTokenByProfile[profile];
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

  cachedInstallationTokenByProfile[profile] = {
    token,
    expiresAtMs: new Date(expiresAt).getTime(),
  };
  return token;
}

function inferProfileFromRepo(repoOrOwner?: string): GitHubCredentialProfile {
  const normalized = String(repoOrOwner ?? '').trim().toLowerCase();
  if (!normalized) return 'core';
  const owner = normalized.includes('/') ? normalized.split('/')[0] : normalized;
  return FUSE_OWNER_NAMES.has(owner) ? 'fuse' : 'core';
}

function resolveProfileCredentialSet(profile: GitHubCredentialProfile): {
  appId?: string;
  privateKey?: string;
  installationId?: string;
  fallbackToken?: string;
} {
  if (profile === 'fuse') {
    return {
      appId: resolveEnv('FUSE_GITHUB_APP_ID', 'GITHUB_APP_ID'),
      privateKey: resolveEnv('FUSE_GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_PRIVATE_KEY'),
      installationId: resolveEnv('FUSE_GITHUB_INSTALLATION_ID', 'FUSE_GLYPHOR_INSTALLATION_ID', 'GITHUB_INSTALLATION_ID', 'GLYPHOR_INSTALLATION_ID'),
      fallbackToken: resolveEnv('FUSE_GITHUB_SERVICE_PAT', 'GITHUB_SERVICE_PAT', 'GITHUB_MCP_TOKEN', 'GITHUB_TOKEN'),
    };
  }

  return {
    appId: resolveEnv('GITHUB_APP_ID'),
    privateKey: resolveEnv('GITHUB_APP_PRIVATE_KEY'),
    installationId: resolveEnv('GITHUB_INSTALLATION_ID', 'GLYPHOR_INSTALLATION_ID'),
    fallbackToken: resolveEnv('GITHUB_TOKEN', 'GITHUB_MCP_TOKEN', 'GITHUB_SERVICE_PAT', 'FUSE_GITHUB_SERVICE_PAT'),
  };
}

export async function getWebsitePipelineGitHubToken(repoOrOwner?: string): Promise<string> {
  const profile = inferProfileFromRepo(repoOrOwner);
  const { appId, privateKey, installationId, fallbackToken } = resolveProfileCredentialSet(profile);

  if (appId && privateKey && installationId) {
    try {
      return await createInstallationAccessToken(profile, appId, privateKey, installationId);
    } catch (error) {
      if (fallbackToken) {
        console.warn(`[GitHub] ${profile} GitHub App auth failed, falling back to shared token: ${(error as Error).message}`);
        return fallbackToken;
      }
      throw error;
    }
  }

  if (fallbackToken) return fallbackToken;

  return requireWebsitePipelineEnv('github-token');
}
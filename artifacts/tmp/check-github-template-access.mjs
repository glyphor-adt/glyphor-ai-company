function normalizePrivateKey(privateKey) {
  return privateKey.includes('-----BEGIN') ? privateKey : privateKey.replace(/\\n/g, '\n');
}

function toBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function createGitHubAppJwt(appId, privateKey) {
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
  return `${unsignedToken}.${toBase64Url(Buffer.from(signature))}`;
}

async function checkRepo(token, label) {
  const response = await fetch('https://api.github.com/repos/Glyphor-Fuse/glyphor-fuse-template', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const body = await response.json().catch(() => null);
  console.log(JSON.stringify({ label, status: response.status, body }, null, 2));
  return response.ok;
}

const appId = process.env.GITHUB_APP_ID;
const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
const installationId = process.env.GITHUB_INSTALLATION_ID;
const fallbackToken = process.env.GITHUB_TOKEN;

if (!appId || !privateKey || !installationId) {
  console.error('Missing app auth env vars');
  process.exit(1);
}

const jwt = await createGitHubAppJwt(appId, privateKey);
const tokenResponse = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${jwt}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  },
});
const tokenBody = await tokenResponse.json().catch(() => null);
console.log(JSON.stringify({ label: 'installation_token', status: tokenResponse.status, body: tokenBody }, null, 2));
if (!tokenResponse.ok) {
  process.exit(1);
}

const appOk = await checkRepo(tokenBody.token, 'github_app_repo_access');
if (fallbackToken) {
  await checkRepo(fallbackToken, 'fallback_token_repo_access');
}
process.exit(appOk ? 0 : 1);

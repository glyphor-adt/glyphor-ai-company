/**
 * E2E check: throwaway branch + draft PR (same payload as github_create_pull_request:
 * head = branch name only), then close + delete branch.
 *
 * Defaults target Glyphor-Fuse (client prototype org), not glyphor-adt.
 *
 * Auth (pick one):
 *   A) Fuse GitHub App (recommended — matches production / websitePipelineAuth):
 *      Set FUSE_GITHUB_APP_ID, FUSE_GITHUB_APP_PRIVATE_KEY, FUSE_GITHUB_INSTALLATION_ID
 *      or load from GCP Secret Manager (gcloud auth required):
 *        GCP_PROJECT=ai-glyphor-company node packages/integrations/scripts/pr-create-probe.mjs
 *      Secrets: fuse-github-app-id, fuse-github-app-private-key, fuse-GLYPHOR_INSTALLATION_ID
 *
 *   B) Override: GITHUB_TOKEN=... PR_PROBE_REPO=owner/repo node ...  (PAT; must have repo access)
 *
 * Env:
 *   PR_PROBE_REPO — default Glyphor-Fuse/glyphor-fuse-template
 *   GCP_PROJECT — default ai-glyphor-company
 */

import { execSync } from 'node:child_process';

const REPO = process.env.PR_PROBE_REPO?.trim() || 'Glyphor-Fuse/glyphor-fuse-template';
const GCP_PROJECT = process.env.GCP_PROJECT?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim() || 'ai-glyphor-company';

function gcloudSecret(name) {
  try {
    return execSync(
      `gcloud secrets versions access latest --secret="${name}" --project="${GCP_PROJECT}"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  } catch {
    return '';
  }
}

function toBase64Url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function normalizePrivateKey(privateKey) {
  return privateKey.includes('-----BEGIN') ? privateKey : privateKey.replace(/\\n/g, '\n');
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
  return `${unsignedToken}.${toBase64Url(signature)}`;
}

async function createInstallationAccessToken(appId, privateKey, installationId) {
  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await createGitHubAppJwt(appId, privateKey)}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = String(data?.message ?? 'Unknown GitHub App auth error');
    throw new Error(`GitHub App auth failed (${response.status}): ${message}`);
  }
  const token = String(data.token ?? '').trim();
  if (!token) throw new Error('GitHub App auth response did not include token.');
  return token;
}

async function resolveToken() {
  const pat = process.env.GITHUB_TOKEN?.trim();
  if (pat) {
    console.log('Auth: GITHUB_TOKEN (PAT override)');
    return pat;
  }

  let appId =
    process.env.FUSE_GITHUB_APP_ID?.trim() || process.env.GITHUB_APP_ID?.trim() || gcloudSecret('fuse-github-app-id');
  let privateKey =
    process.env.FUSE_GITHUB_APP_PRIVATE_KEY?.trim() ||
    process.env.GITHUB_APP_PRIVATE_KEY?.trim() ||
    gcloudSecret('fuse-github-app-private-key');
  let installationId =
    process.env.FUSE_GITHUB_INSTALLATION_ID?.trim() ||
    process.env.FUSE_GLYPHOR_INSTALLATION_ID?.trim() ||
    process.env.GITHUB_INSTALLATION_ID?.trim() ||
    gcloudSecret('fuse-GLYPHOR_INSTALLATION_ID');

  if (!appId || !privateKey || !installationId) {
    console.error(
      'No GITHUB_TOKEN and incomplete Fuse GitHub App env. Set FUSE_GITHUB_APP_ID, FUSE_GITHUB_APP_PRIVATE_KEY, FUSE_GITHUB_INSTALLATION_ID\n' +
        'or run with gcloud auth and secrets: fuse-github-app-id, fuse-github-app-private-key, fuse-GLYPHOR_INSTALLATION_ID in project',
      GCP_PROJECT,
    );
    process.exit(1);
  }

  console.log('Auth: Fuse GitHub App → installation access token');
  return createInstallationAccessToken(appId, privateKey, installationId);
}

const branch = `chore/pr-api-probe-${Date.now()}`;
const path = `docs/_pr_api_probe_${Date.now()}.md`;
const base = 'main';

let token = await resolveToken();

const [owner, name] = REPO.split('/');
if (!owner || !name) {
  console.error('PR_PROBE_REPO must be owner/name');
  process.exit(1);
}

function makeHeaders(tok) {
  return {
    Authorization: `Bearer ${tok}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function gh(method, pathSuffix, body, tok = token) {
  const url = `https://api.github.com${pathSuffix}`;
  const res = await fetch(url, {
    method,
    headers: makeHeaders(tok),
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

const content = Buffer.from(
  `<!-- automated PR create probe ${new Date().toISOString()} — safe to delete file + branch -->\n`,
  'utf8',
).toString('base64');

console.log(`Repo: ${REPO} (Glyphor-Fuse client org — default)`);
console.log(`1) Resolve ${base} SHA`);

let refRes = await gh('GET', `/repos/${owner}/${name}/git/ref/heads/${base}`, null);
if (!refRes.ok) {
  console.error('GET ref failed:', refRes.status, refRes.data);
  process.exit(1);
}
const mainSha = refRes.data.object?.sha;
if (!mainSha) {
  console.error('No SHA for default branch');
  process.exit(1);
}

console.log(`2) Create branch ${branch} at ${mainSha.slice(0, 7)}`);

let createRef = await gh('POST', `/repos/${owner}/${name}/git/refs`, {
  ref: `refs/heads/${branch}`,
  sha: mainSha,
});
if (!createRef.ok) {
  console.error('Create ref failed:', createRef.status, createRef.data);
  process.exit(1);
}

console.log(`3) Add file on branch: ${path}`);

let put = await gh('PUT', `/repos/${owner}/${name}/contents/${encodeURIComponent(path)}`, {
  message: 'chore: PR API probe (automated)',
  content,
  branch,
});

if (!put.ok) {
  console.error('PUT contents failed:', put.status, put.data);
  process.exit(1);
}

console.log(`4) POST /pulls with head: "${branch}" (branch name only)`);

let pulls = await gh('POST', `/repos/${owner}/${name}/pulls`, {
  title: 'chore: PR API probe (draft, auto-close)',
  head: branch,
  base,
  body:
    'Automated probe: `github_create_pull_request`-style `head` on a **Glyphor-Fuse** repo. Closed immediately.',
  draft: true,
});

if (!pulls.ok) {
  console.error('Create PR failed:', pulls.status, pulls.data);
  process.exit(1);
}

const prNumber = pulls.data.number;
const htmlUrl = pulls.data.html_url;
console.log(`   OK — draft PR #${prNumber}: ${htmlUrl}`);

console.log('5) Close PR');
let patch = await gh('PATCH', `/repos/${owner}/${name}/pulls/${prNumber}`, {
  state: 'closed',
});
if (!patch.ok) {
  console.error('Close PR failed:', patch.status, patch.data);
  process.exit(1);
}

console.log('6) Delete branch ref');
let del = await gh('DELETE', `/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branch)}`, null);
if (!del.ok && del.status !== 422) {
  console.error('Delete branch failed:', del.status, del.data);
  process.exit(1);
}

console.log('\nDone. E2E on Glyphor-Fuse repo: branch → draft PR (head=branch name) → close → delete branch succeeded.');
token = undefined;

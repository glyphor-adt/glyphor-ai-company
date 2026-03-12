/**
 * GitHub Credential Scoping
 *
 * Creates per-agent installation access tokens with scoped
 * repository access and permission levels. Uses GitHub App
 * installation tokens which natively support repo + permission scoping.
 *
 * Even if the runtime is compromised, an agent can only access
 * the repos and permissions defined in GITHUB_AGENT_SCOPES.
 */

import { Octokit } from '@octokit/rest';

export interface GitHubScope {
  repos: string[];
  permissions: Record<string, 'read' | 'write'>;
  branchPattern?: string;   // e.g., 'test/*' — enforced at runtime
  pathPattern?: string;      // e.g., '.github/workflows/' — enforced at runtime
}

const ALL_REPOS = ['glyphor-ai-spark-c03e7e1a', 'glyphor-ally-ai', 'glyphor-ai-company'];

/** Per-agent GitHub access scopes */
export const GITHUB_AGENT_SCOPES: Record<string, GitHubScope> = {
  'cto': {
    repos: ALL_REPOS,
    permissions: { contents: 'write', pull_requests: 'write', actions: 'write', deployments: 'write', issues: 'write', statuses: 'read' },
  },
  'platform-engineer': {
    repos: ALL_REPOS,
    permissions: { contents: 'read', pull_requests: 'read', actions: 'read' },
  },
  'quality-engineer': {
    repos: ALL_REPOS,
    permissions: { contents: 'write', pull_requests: 'write' },
    branchPattern: 'test/*',
  },
  'devops-engineer': {
    repos: ALL_REPOS,
    permissions: { contents: 'write', actions: 'write' },
    pathPattern: '.github/workflows/',
  },
  // Design & frontend team — full read/write to all repos
  'vp-design': {
    repos: ALL_REPOS,
    permissions: { contents: 'write', pull_requests: 'write', actions: 'read', issues: 'write', statuses: 'read' },
  },
  'frontend-engineer': {
    repos: ALL_REPOS,
    permissions: { contents: 'write', pull_requests: 'write', actions: 'read', issues: 'write', statuses: 'read' },
  },
  'design-critic': {
    repos: ALL_REPOS,
    permissions: { contents: 'write', pull_requests: 'write', actions: 'read', issues: 'write', statuses: 'read' },
  },
  'ui-ux-designer': {
    repos: ALL_REPOS,
    permissions: { contents: 'write', pull_requests: 'write', actions: 'read', issues: 'write', statuses: 'read' },
  },
  'template-architect': {
    repos: ALL_REPOS,
    permissions: { contents: 'write', pull_requests: 'write', actions: 'read', issues: 'write', statuses: 'read' },
  },
};

/**
 * Get a scoped GitHub installation access token for a specific agent.
 *
 * Falls back to the shared GITHUB_TOKEN if GitHub App credentials
 * aren't configured (backward compatible).
 */
export async function getScopedGitHubClient(agentRole: string): Promise<Octokit> {
  const scope = GITHUB_AGENT_SCOPES[agentRole];

  // If no GitHub App config, fall back to shared token
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.GITHUB_INSTALLATION_ID;

  if (!appId || !privateKey || !installationId) {
    // Fall back to shared PAT
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('No GitHub credentials configured');
    return new Octokit({ auth: token });
  }

  if (!scope || scope.repos.length === 0) {
    // Agent has no GitHub access or public-only access
    return new Octokit(); // Unauthenticated — public repos only
  }

  // Create a scoped installation access token via the GitHub API
  // Requires a JWT signed with the app private key
  const jwt = await createAppJWT(appId, privateKey);
  const appOctokit = new Octokit({ auth: jwt });

  const { data: token } = await appOctokit.apps.createInstallationAccessToken({
    installation_id: Number(installationId),
    repositories: scope.repos,
    permissions: scope.permissions,
  });

  return new Octokit({ auth: token.token });
}

/**
 * Create a JWT for GitHub App authentication.
 * Uses the Web Crypto API available in Node 18+.
 */
async function createAppJWT(appId: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }));
  const unsigned = `${header}.${payload}`;

  // Import the PEM private key
  const pemBody = privateKey
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
    .replace(/-----END RSA PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return `${unsigned}.${sig}`;
}

/**
 * Validate that a GitHub operation is within the agent's scope.
 * Returns an error message if the operation is out of scope, or null if allowed.
 */
export function validateGitHubScope(
  agentRole: string,
  repo: string,
  branch?: string,
  path?: string,
): string | null {
  const scope = GITHUB_AGENT_SCOPES[agentRole];
  if (!scope) return `Agent ${agentRole} has no GitHub access configured`;

  if (scope.repos.length > 0 && !scope.repos.includes(repo)) {
    return `Agent ${agentRole} does not have access to repo: ${repo}`;
  }

  if (scope.branchPattern && branch) {
    const pattern = new RegExp('^' + scope.branchPattern.replace(/\*/g, '.*') + '$');
    if (!pattern.test(branch)) {
      return `Agent ${agentRole} can only access branches matching: ${scope.branchPattern}`;
    }
  }

  if (scope.pathPattern && path) {
    if (!path.startsWith(scope.pathPattern)) {
      return `Agent ${agentRole} can only modify paths under: ${scope.pathPattern}`;
    }
  }

  return null;
}

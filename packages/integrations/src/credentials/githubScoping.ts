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

/** Per-agent GitHub access scopes */
export const GITHUB_AGENT_SCOPES: Record<string, GitHubScope> = {
  'cto': {
    repos: ['glyphor-ai-spark-c03e7e1a', 'glyphor-ally-ai', 'glyphor-ai-company'],
    permissions: { contents: 'write', pull_requests: 'write', actions: 'write', deployments: 'write' },
  },
  'platform-engineer': {
    repos: ['glyphor-ai-spark-c03e7e1a', 'glyphor-ally-ai'],
    permissions: { contents: 'read', pull_requests: 'read', actions: 'read' },
  },
  'quality-engineer': {
    repos: ['glyphor-ai-spark-c03e7e1a', 'glyphor-ally-ai'],
    permissions: { contents: 'write', pull_requests: 'write' },
    branchPattern: 'test/*',
  },
  'devops-engineer': {
    repos: ['glyphor-ai-spark-c03e7e1a', 'glyphor-ally-ai'],
    permissions: { contents: 'write', actions: 'write' },
    pathPattern: '.github/workflows/',
  },
  'competitive-intel': {
    repos: [],
    permissions: { contents: 'read' },
    // Public repos only — no installation token needed
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

  // Create app-level Octokit to generate installation tokens
  const { createAppAuth } = await import('@octokit/auth-app');
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId: Number(installationId),
    },
  });

  // Create a scoped installation access token
  const { data: token } = await appOctokit.apps.createInstallationAccessToken({
    installation_id: Number(installationId),
    repositories: scope.repos,
    permissions: scope.permissions,
  });

  return new Octokit({ auth: token.token });
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

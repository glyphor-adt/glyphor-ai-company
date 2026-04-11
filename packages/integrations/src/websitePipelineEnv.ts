interface EnvRequirement {
  id: string;
  preferredEnvName: string;
  acceptedEnvNames: string[];
  recommendedSecretNames: string[];
  description: string;
}

export const WEBSITE_PIPELINE_ENV_REQUIREMENTS: readonly EnvRequirement[] = [
  {
    id: 'github-token',
    preferredEnvName: 'GITHUB_SERVICE_PAT',
    acceptedEnvNames: ['GITHUB_SERVICE_PAT', 'FUSE_GITHUB_SERVICE_PAT', 'GITHUB_MCP_TOKEN', 'GITHUB_TOKEN'],
    recommendedSecretNames: ['fuse-github-service-pat'],
    description: 'GitHub token for template repo creation and batched file pushes.',
  },
  {
    id: 'vercel-token',
    preferredEnvName: 'FUSE_PREVIEW_VERCEL_TOKEN',
    acceptedEnvNames: ['FUSE_PREVIEW_VERCEL_TOKEN', 'VERCEL_API_TOKEN'],
    recommendedSecretNames: ['fuse-preview-vercel-token'],
    description:
      'Fuse client pipeline: prefer FUSE_PREVIEW_VERCEL_TOKEN. glyphor-adt uses VERCEL_API_TOKEN (see resolveVercelCredsForGithubOrg).',
  },
  {
    id: 'vercel-team-id',
    preferredEnvName: 'FUSE_PREVIEW_VERCEL_TEAM_ID',
    acceptedEnvNames: ['FUSE_PREVIEW_VERCEL_TEAM_ID', 'VERCEL_TEAM_ID'],
    recommendedSecretNames: ['fuse-preview-vercel-team-id'],
    description: 'Vercel team id for Glyphor-Fuse preview projects.',
  },
  {
    id: 'r2-endpoint',
    preferredEnvName: 'PREVIEWS_R2_ENDPOINT',
    acceptedEnvNames: ['PREVIEWS_R2_ENDPOINT', 'FUSE_PREVIEWS_R2_ENDPOINT'],
    recommendedSecretNames: ['fuse-r2-endpoint', 'PREVIEWS_R2_ENDPOINT'],
    description: 'Cloudflare R2 endpoint for preview metadata writes.',
  },
  {
    id: 'r2-access-key-id',
    preferredEnvName: 'PREVIEWS_R2_ACCESS_KEY_ID',
    acceptedEnvNames: ['PREVIEWS_R2_ACCESS_KEY_ID', 'FUSE_PREVIEWS_R2_ACCESS_KEY_ID'],
    recommendedSecretNames: ['PREVIEWS_R2_ACCESS_KEY_ID'],
    description: 'Cloudflare R2 access key id for preview metadata writes.',
  },
  {
    id: 'r2-secret-access-key',
    preferredEnvName: 'PREVIEWS_R2_SECRET_ACCESS_KEY',
    acceptedEnvNames: ['PREVIEWS_R2_SECRET_ACCESS_KEY', 'FUSE_PREVIEWS_R2_SECRET_ACCESS_KEY'],
    recommendedSecretNames: ['PREVIEWS_R2_SECRET_ACCESS_KEY'],
    description: 'Cloudflare R2 secret access key for preview metadata writes.',
  },
  {
    id: 'website-llm',
    preferredEnvName: 'GOOGLE_AI_API_KEY',
    acceptedEnvNames: ['GOOGLE_AI_API_KEY', 'GEMINI_API_KEY'],
    recommendedSecretNames: ['google-ai-api-key'],
    description: 'Gemini API key for build_website_foundation default execution.',
  },
] as const;

function getEnvValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function formatRequirementMessage(requirement: EnvRequirement): string {
  return `${requirement.preferredEnvName} missing. Accepted env vars: ${requirement.acceptedEnvNames.join(', ')}. Recommended GCP secret(s): ${requirement.recommendedSecretNames.join(', ')}.`;
}

export function resolveWebsitePipelineEnv(requirementId: EnvRequirement['id']): string | undefined {
  const requirement = WEBSITE_PIPELINE_ENV_REQUIREMENTS.find((item) => item.id === requirementId);
  if (!requirement) return undefined;
  return getEnvValue(...requirement.acceptedEnvNames);
}

export function requireWebsitePipelineEnv(requirementId: EnvRequirement['id']): string {
  const requirement = WEBSITE_PIPELINE_ENV_REQUIREMENTS.find((item) => item.id === requirementId);
  if (!requirement) {
    throw new Error(`Unknown website pipeline env requirement: ${requirementId}`);
  }
  const value = getEnvValue(...requirement.acceptedEnvNames);
  if (!value) {
    throw new Error(formatRequirementMessage(requirement));
  }
  return value;
}

export function getWebsitePipelineEnvReport(): {
  satisfied: Array<EnvRequirement & { matchedEnvName: string }>;
  missing: EnvRequirement[];
} {
  const satisfied: Array<EnvRequirement & { matchedEnvName: string }> = [];
  const missing: EnvRequirement[] = [];

  for (const requirement of WEBSITE_PIPELINE_ENV_REQUIREMENTS) {
    const matchedEnvName = requirement.acceptedEnvNames.find((name) => Boolean(process.env[name]?.trim()));
    if (matchedEnvName) {
      satisfied.push({ ...requirement, matchedEnvName });
      continue;
    }
    missing.push(requirement);
  }

  return { satisfied, missing };
}

export function getWebsitePipelineOrg(): string {
  return getEnvValue('GITHUB_CLIENT_REPOS_ORG', 'FUSE_GITHUB_CLIENT_REPOS_ORG') || 'Glyphor-Fuse';
}

export function getWebsitePipelineBucket(): string {
  return getEnvValue('PREVIEWS_R2_BUCKET', 'FUSE_PREVIEWS_R2_BUCKET') || 'glyphor-fuse-storage';
}

/** Default GitHub org for glyphor-adt flagship repos (Vercel team + token differ from Fuse). */
export const GLYPHOR_ADT_GITHUB_ORG_DEFAULT = 'glyphor-adt';

function normalizeGithubOrgName(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Pick Vercel API token + teamId for the GitHub org being targeted.
 * - **glyphor-adt** → `GLYPHOR_ADT_VERCEL_API_TOKEN` then `VERCEL_API_TOKEN` + `VERCEL_ADT_TEAM_ID` / `GLYPHOR_ADT_VERCEL_TEAM_ID`
 * - **Glyphor-Fuse** (and other client orgs) → `FUSE_PREVIEW_VERCEL_TOKEN` then `VERCEL_API_TOKEN` + Fuse team id
 *
 * This avoids using the ADT token against Fuse repos (wrong Vercel team / missing GitHub integration).
 */
export function resolveVercelCredsForGithubOrg(githubOrg: string): { token: string; teamId?: string } {
  const o = normalizeGithubOrgName(githubOrg);
  const adtOrg = normalizeGithubOrgName(
    getEnvValue('GLYPHOR_ADT_GITHUB_ORG') ?? GLYPHOR_ADT_GITHUB_ORG_DEFAULT,
  );

  if (o === adtOrg) {
    // Prefer GLYPHOR_ADT_* so Cloud Run can mount a different GCP secret than VERCEL_API_TOKEN when both are set.
    const token = getEnvValue('GLYPHOR_ADT_VERCEL_API_TOKEN', 'VERCEL_API_TOKEN', 'GLYPHOR_ADT_VERCEL_TOKEN');
    const teamId = getEnvValue('VERCEL_ADT_TEAM_ID', 'GLYPHOR_ADT_VERCEL_TEAM_ID');
    if (!token) {
      throw new Error(
        'glyphor-adt Vercel: set GLYPHOR_ADT_VERCEL_API_TOKEN (or VERCEL_API_TOKEN) for the ADT team token.',
      );
    }
    return { token, teamId };
  }

  const token = getEnvValue('FUSE_PREVIEW_VERCEL_TOKEN', 'VERCEL_API_TOKEN');
  const teamId = getEnvValue('FUSE_PREVIEW_VERCEL_TEAM_ID', 'VERCEL_TEAM_ID');
  if (!token) {
    throw new Error(
      'Fuse website pipeline Vercel: set FUSE_PREVIEW_VERCEL_TOKEN (or VERCEL_API_TOKEN) and a team id.',
    );
  }
  return { token, teamId };
}

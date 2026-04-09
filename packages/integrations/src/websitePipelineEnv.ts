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
    preferredEnvName: 'VERCEL_API_TOKEN',
    acceptedEnvNames: ['VERCEL_API_TOKEN', 'FUSE_PREVIEW_VERCEL_TOKEN'],
    recommendedSecretNames: ['fuse-preview-vercel-token'],
    description: 'Vercel API token for project creation and preview polling.',
  },
  {
    id: 'vercel-team-id',
    preferredEnvName: 'VERCEL_TEAM_ID',
    acceptedEnvNames: ['VERCEL_TEAM_ID', 'FUSE_PREVIEW_VERCEL_TEAM_ID'],
    recommendedSecretNames: ['fuse-preview-vercel-team-id'],
    description: 'Vercel team scope for preview projects.',
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

/**
 * Default E2B sandbox workspaces for executive engineering agents (Marcus, Mia).
 * Matches company doctrine: monorepo vs marketing site vs Fuse-created client repos.
 */
export const GLYPHOR_EXECUTIVE_SANDBOX_WORKSPACES = [
  { id: 'glyphor-ai-company', repo: 'glyphor-adt/glyphor-ai-company', branch: 'main' },
  { id: 'glyphor-site', repo: 'glyphor-adt/glyphor-site', branch: 'main' },
] as const;

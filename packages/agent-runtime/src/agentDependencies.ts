/**
 * Agent Dependencies — Cross-agent output dependency graph.
 *
 * Defines which upstream agents' world state outputs each agent consumes.
 * The dependency resolver reads `last_output_{upstreamId}` from world state
 * at task start — direct pull, no CoS routing needed.
 *
 * Launch scope: Marketing Department chains.
 */

export const AGENT_DEPENDENCIES: Record<string, string[]> = {
  // Content agents depend on strategy + research
  'content-creator': ['cmo', 'user-researcher'],
  'social-media-manager': ['content-creator', 'cmo'],
  'seo-analyst': ['content-creator', 'market-research-analyst'],

  // Intelligence agents feed each other
  'competitive-intel': ['market-research-analyst'],
  'marketing-intelligence-analyst': ['competitive-intel', 'market-research-analyst'],

  // CMO reads from intelligence and research
  'cmo': ['competitive-intel', 'market-research-analyst', 'user-researcher'],

  // User researcher is an endpoint — no marketing dependencies
  // Market researcher is an endpoint — no marketing dependencies
};

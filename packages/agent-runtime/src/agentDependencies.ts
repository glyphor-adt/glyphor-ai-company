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
  // Marketing intelligence rolls up to CMO
  'marketing-intelligence-analyst': [],
};

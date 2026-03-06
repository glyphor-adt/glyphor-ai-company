/**
 * HR Tools — All tools migrated to mcp-hr-server
 *
 * Tools now served via MCP:
 *   get_org_chart, get_agent_directory, get_agent_performance_summary,
 *   create_performance_review, get_team_dynamics, update_agent_profile,
 *   create_onboarding_plan, run_engagement_survey
 */

import type { ToolDefinition } from '@glyphor/agent-runtime';

/** @deprecated All HR tools are now on mcp-hr-server. */
export function createHRTools(): ToolDefinition[] {
  return [];
}

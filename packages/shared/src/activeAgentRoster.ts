/**
 * The canonical list of agent roles that currently exist in company_agents.
 * Updated: 2026-04-19. Update this file when agents are added or retired.
 *
 * "Active" here means the role has a company_agents row with status = 'active'
 * or 'paused' (where pausing is intentional and temporary). Sarah Chen is
 * currently paused as of 2026-04-18 after a runaway loop caused by fleet-wide
 * tool reliability issues that have since been addressed.
 */
export const ACTIVE_AGENT_ROLES = [
  'chief-of-staff',
  'cto',
  'cfo',
  'clo',
  'cpo',
  'cmo',
  'vp-design',
  'ops',
  'vp-research',
  'platform-engineer',
  'devops-engineer',
  'quality-engineer',
] as const;

export type ActiveAgentRole = typeof ACTIVE_AGENT_ROLES[number];

/**
 * Roles that previously existed in company_agents and were deliberately removed.
 * References to these should be cleaned up, not reintroduced as new agents.
 *
 * Historical context: Glyphor previously ran a ~25-agent fleet covering a
 * full org structure. In April 2026 the fleet was pruned down to a 12-agent
 * core to get orchestration working reliably before scaling back up. These
 * are the roles removed during that prune.
 */
export const RETIRED_AGENT_ROLES = [
  'onboarding-specialist',
  'support-triage',
  'account-research',
  'revenue-analyst',
  'cost-analyst',
  'backend-engineer',
  'coo',
] as const;

/**
 * Roles with code scaffolding (packages/agents/src/<role>/) and references
 * throughout the runtime, but no company_agents row, no work_assignments,
 * and no agent_messages in their history. These are unbuilt plans, not
 * failed builds.
 *
 * For cleanup purposes these are treated identically to RETIRED_AGENT_ROLES.
 * The distinction is preserved for roadmap purposes: scaffolded-but-unbuilt
 * roles have existing code that could be revived; retired roles have been
 * deliberately removed.
 */
export const SCAFFOLDED_BUT_UNBUILT_ROLES = [
  'bob-the-tax-pro',
  'marketing-intelligence-analyst',
  'adi-rose',
] as const;

/**
 * All roles that should not be referenced in active code paths.
 * Use this for cleanup scanning and roster validation.
 */
export const ALL_INACTIVE_ROLES = [
  ...RETIRED_AGENT_ROLES,
  ...SCAFFOLDED_BUT_UNBUILT_ROLES,
] as const;

export type RetiredAgentRole = typeof RETIRED_AGENT_ROLES[number];
export type ScaffoldedAgentRole = typeof SCAFFOLDED_BUT_UNBUILT_ROLES[number];
export type InactiveAgentRole = typeof ALL_INACTIVE_ROLES[number];

export function isActiveAgentRole(role: string): role is ActiveAgentRole {
  return (ACTIVE_AGENT_ROLES as readonly string[]).includes(role);
}

export function isRetiredAgentRole(role: string): role is RetiredAgentRole {
  return (RETIRED_AGENT_ROLES as readonly string[]).includes(role);
}

export function isScaffoldedAgentRole(role: string): role is ScaffoldedAgentRole {
  return (SCAFFOLDED_BUT_UNBUILT_ROLES as readonly string[]).includes(role);
}

export function isInactiveAgentRole(role: string): role is InactiveAgentRole {
  return (ALL_INACTIVE_ROLES as readonly string[]).includes(role);
}

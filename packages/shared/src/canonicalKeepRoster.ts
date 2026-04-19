/**
 * Canonical live-workforce keep roster for dead-agent purge/reset flows.
 *
 * @deprecated Prefer importing from `./activeAgentRoster` directly.
 *   This file is a backward-compatibility shim for existing dashboard imports.
 *   Migrate callers to ACTIVE_AGENT_ROLES and delete this file when the last
 *   import is migrated.
 */
import {
  ACTIVE_AGENT_ROLES,
  type ActiveAgentRole,
  isActiveAgentRole,
} from './activeAgentRoster.js';

export const CANONICAL_KEEP_ROSTER = ACTIVE_AGENT_ROLES;
export type CanonicalKeepRole = ActiveAgentRole;

export const CANONICAL_KEEP_ROSTER_SET: ReadonlySet<string> = new Set(CANONICAL_KEEP_ROSTER);

export function isCanonicalKeepRole(role: string): role is CanonicalKeepRole {
  return isActiveAgentRole(role);
}

export function filterCanonicalKeepRoster<T extends { role: string }>(records: readonly T[]): T[] {
  return records.filter((record) => isCanonicalKeepRole(record.role));
}

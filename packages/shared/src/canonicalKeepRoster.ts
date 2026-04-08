/**
 * Canonical live-workforce keep roster for dead-agent purge/reset flows.
 *
 * Source of truth: db/migrations/20260225000002_mark_core_agents.sql is the
 * strongest schema-backed signal for the reduced roster kept live in the
 * workforce UI. The UI still filters mainly by lifecycle status, so broader
 * legacy role lists elsewhere should not expand this keep set.
 */
export const CANONICAL_KEEP_ROSTER = [
  'chief-of-staff',
  'cto',
  'cfo',
  'cpo',
  'cmo',
  'vp-customer-success',
  'vp-sales',
  'vp-design',
  'ops',
  'platform-engineer',
  'quality-engineer',
  'devops-engineer',
  'user-researcher',
  'competitive-intel',
  'revenue-analyst',
  'cost-analyst',
  'content-creator',
  'seo-analyst',
  'social-media-manager',
  'onboarding-specialist',
  'support-triage',
  'account-research',
  'ui-ux-designer',
  'frontend-engineer',
  'design-critic',
  'template-architect',
] as const;

export type CanonicalKeepRole = (typeof CANONICAL_KEEP_ROSTER)[number];

export const CANONICAL_KEEP_ROSTER_SET: ReadonlySet<string> = new Set(CANONICAL_KEEP_ROSTER);

export function isCanonicalKeepRole(role: string): role is CanonicalKeepRole {
  return CANONICAL_KEEP_ROSTER_SET.has(role);
}

export function filterCanonicalKeepRoster<T extends { role: string }>(records: readonly T[]): T[] {
  return records.filter((record) => isCanonicalKeepRole(record.role));
}

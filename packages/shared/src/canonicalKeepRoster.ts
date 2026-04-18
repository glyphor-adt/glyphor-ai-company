/**
 * Canonical live-workforce keep roster for dead-agent purge/reset flows.
 *
 * Source of truth: current live-roster decision from the founder team.
 */
export const CANONICAL_KEEP_ROSTER = [
  'chief-of-staff',
  'cto',
  'cfo',
  'clo',
  'cpo',
  'cmo',
  'vp-design',
  'ops',
  'vp-research',
] as const;

export type CanonicalKeepRole = (typeof CANONICAL_KEEP_ROSTER)[number];

export const CANONICAL_KEEP_ROSTER_SET: ReadonlySet<string> = new Set(CANONICAL_KEEP_ROSTER);

export function isCanonicalKeepRole(role: string): role is CanonicalKeepRole {
  return CANONICAL_KEEP_ROSTER_SET.has(role);
}

export function filterCanonicalKeepRoster<T extends { role: string }>(records: readonly T[]): T[] {
  return records.filter((record) => isCanonicalKeepRole(record.role));
}

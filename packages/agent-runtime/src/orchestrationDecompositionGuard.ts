/**
 * Fail-closed guard for orchestrate / strategic_planning runs:
 * if delegated active directives had no work_assignments at run start,
 * the run must not complete "successfully" while any of those directives still lack assignments.
 *
 * Matches heartbeat undecomposed-directive detection in packages/scheduler/src/heartbeat.ts.
 */

import { systemQuery } from '@glyphor/shared/db';

export type UndecomposedDirective = { id: string; title: string };

export async function fetchUndecomposedDelegatedDirectives(
  executiveRole: string,
): Promise<UndecomposedDirective[]> {
  const rows = await systemQuery<{ id: string; title: string | null }>(
    `SELECT fd.id, fd.title FROM founder_directives fd
     WHERE fd.delegated_to = $1 AND fd.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM work_assignments wa WHERE wa.directive_id = fd.id)`,
    [executiveRole],
  );
  return (rows ?? []).map((r) => ({ id: r.id, title: r.title ?? '(untitled)' }));
}

export function filterBaselineStillUnresolved(
  baseline: UndecomposedDirective[],
  currentUndecomposed: UndecomposedDirective[],
): UndecomposedDirective[] {
  const currentIds = new Set(currentUndecomposed.map((d) => d.id));
  return baseline.filter((b) => currentIds.has(b.id));
}

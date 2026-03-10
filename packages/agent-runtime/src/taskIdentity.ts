/**
 * Helpers for deriving a logical task name from runtime config identifiers.
 */

/**
 * Extract the task segment from run IDs like:
 * - cmo-weekly_content_planning-2026-03-10
 * - vp-design-design_audit-2026-03-10
 * - sophia-on_demand-2026-03-10-1741641700000
 */
export function extractTaskFromConfigId(configId: string): string {
  const withoutTimestamp = configId.replace(/-\d{4}-\d{2}-\d{2}(?:-\d+)?$/, '');
  const lastDash = withoutTimestamp.lastIndexOf('-');
  if (lastDash > 0) {
    return withoutTimestamp.substring(lastDash + 1);
  }
  return withoutTimestamp;
}

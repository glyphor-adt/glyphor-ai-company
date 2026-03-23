/**
 * Normalizes a Cloud Run service parameter to the GCP service resource id
 * (e.g. "glyphor-scheduler"). Accepts short names ("scheduler") or full ids
 * ("glyphor-scheduler"). Does not double-prefix when the value already starts
 * with "glyphor-".
 */
export function normalizeCloudRunServiceName(service: string): string {
  const s = service.trim();
  if (!s) return s;
  if (s.startsWith('glyphor-')) return s;
  return `glyphor-${s}`;
}

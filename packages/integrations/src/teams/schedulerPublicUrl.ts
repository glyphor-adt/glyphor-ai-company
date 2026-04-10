/**
 * HTTPS origin used to build absolute approve/reject links for founder directives.
 * Prefer PUBLIC_URL; fall back to SERVICE_URL, SCHEDULER_PUBLIC_URL, then SCHEDULER_URL origin.
 */

function normalizeHttpBase(raw: string | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  if (s.startsWith('http://') || s.startsWith('https://')) {
    return s.replace(/\/+$/, '');
  }
  return null;
}

/**
 * Returns origin only (no path), e.g. https://scheduler.example.com
 */
export function resolveSchedulerPublicBaseUrl(): string {
  for (const env of [
    process.env.PUBLIC_URL,
    process.env.SERVICE_URL,
    process.env.SCHEDULER_PUBLIC_URL,
    process.env.GLYPHOR_PUBLIC_URL,
  ]) {
    const u = normalizeHttpBase(env);
    if (u) return u;
  }

  const sched = process.env.SCHEDULER_URL?.trim();
  if (sched?.startsWith('http')) {
    try {
      return new URL(sched).origin;
    } catch {
      /* ignore */
    }
  }
  return '';
}

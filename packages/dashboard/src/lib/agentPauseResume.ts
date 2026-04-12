import { SCHEDULER_URL } from './firebase';

export type PauseResumeResult = { ok: true } | { ok: false; error: string };

const UUID_V4_OR_V5_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function parseError(resp: Response, fallback: string): Promise<string> {
  const result = (await resp.json().catch(() => ({}))) as { error?: unknown };
  return typeof result.error === 'string' ? result.error : fallback;
}

async function fallbackViaDashboardApi(
  action: 'pause' | 'resume',
  agentRef: string,
  buildHeaders: () => Promise<HeadersInit>,
): Promise<PauseResumeResult> {
  const isUuid = UUID_V4_OR_V5_RE.test(agentRef);
  const filter = isUuid
    ? `id=eq.${encodeURIComponent(agentRef)}`
    : `role=eq.${encodeURIComponent(agentRef)}&include_paused=true`;

  try {
    const resp = await fetch(`/api/company_agents?${filter}`, {
      method: 'PATCH',
      headers: await buildHeaders(),
      body: JSON.stringify({ status: action === 'pause' ? 'paused' : 'active' }),
    });

    if (!resp.ok) {
      return {
        ok: false,
        error: await parseError(resp, `${action === 'pause' ? 'Pause' : 'Resume'} failed (${resp.status})`),
      };
    }

    const rows = (await resp.json().catch(() => [])) as unknown;
    if (Array.isArray(rows) && rows.length === 0) {
      return { ok: false, error: `Agent not found: ${agentRef}` };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

/**
 * POST /agents/:ref/pause or /resume (scheduler). Returns structured error for UI.
 */
export async function postAgentPauseResume(
  action: 'pause' | 'resume',
  agentRef: string,
  buildHeaders: () => Promise<HeadersInit>,
): Promise<PauseResumeResult> {
  const label = action === 'pause' ? 'Pause' : 'Resume';
  try {
    const resp = await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agentRef)}/${action}`, {
      method: 'POST',
      headers: await buildHeaders(),
    });

    if (!resp.ok) {
      const err = await parseError(resp, `${label} failed (${resp.status})`);
      return { ok: false, error: err };
    }

    return { ok: true };
  } catch (e) {
    // Some production dashboard hosts intermittently block direct cross-origin scheduler
    // calls. Fall back to same-origin dashboard CRUD API for status updates.
    return fallbackViaDashboardApi(action, agentRef, buildHeaders);
  }
}

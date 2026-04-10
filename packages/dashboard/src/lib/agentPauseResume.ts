import { SCHEDULER_URL } from './firebase';

export type PauseResumeResult = { ok: true } | { ok: false; error: string };

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
    const result = (await resp.json().catch(() => ({}))) as { error?: unknown };
    if (!resp.ok) {
      const err = typeof result.error === 'string' ? result.error : `${label} failed (${resp.status})`;
      return { ok: false, error: err };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

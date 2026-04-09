/**
 * GitHub Actions CI failure → enqueue agent (default Mia / vp-design) to fix via PR workflow.
 * Secured with CI_HEAL_WEBHOOK_SECRET (Bearer) on POST /webhook/ci-heal.
 */
import { randomUUID } from 'node:crypto';
import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import { isCanonicalKeepRole } from '@glyphor/shared';
import { enqueueWorkerAgentExecute, isWorkerQueueConfigured } from './workerQueue.js';

export interface CiHealDispatchPayload {
  repository: string;
  workflow_run_id: number;
  workflow_name: string;
  html_url: string;
  head_branch: string;
  head_sha: string;
  failed_jobs?: Array<{ name: string; conclusion?: string; html_url?: string }>;
  log_excerpt?: string;
}

const recentDispatches = new Map<string, number>();
const DEDUPE_MS = 120_000;

function pruneDispatchMap(now: number): void {
  for (const [k, t] of recentDispatches) {
    if (now - t > 600_000) recentDispatches.delete(k);
  }
}

export function verifyCiHealBearer(authorization: string | undefined): boolean {
  const secret = process.env.CI_HEAL_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  if (!authorization?.startsWith('Bearer ')) return false;
  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 && token === secret;
}

export function parseCiHealPayload(raw: string): CiHealDispatchPayload | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const repository = typeof data.repository === 'string' ? data.repository.trim() : '';
    const wr = data.workflow_run_id;
    const workflow_run_id =
      typeof wr === 'number' && Number.isFinite(wr)
        ? wr
        : typeof wr === 'string' && /^\d+$/.test(wr)
          ? Number.parseInt(wr, 10)
          : NaN;
    const workflow_name = typeof data.workflow_name === 'string' ? data.workflow_name.trim() : '';
    const html_url = typeof data.html_url === 'string' ? data.html_url.trim() : '';
    const head_branch = typeof data.head_branch === 'string' ? data.head_branch.trim() : '';
    const head_sha = typeof data.head_sha === 'string' ? data.head_sha.trim() : '';

    if (!repository || !Number.isFinite(workflow_run_id) || workflow_run_id <= 0) return null;
    if (!workflow_name || !html_url || !head_branch || !head_sha) return null;

    let failed_jobs: CiHealDispatchPayload['failed_jobs'];
    if (Array.isArray(data.failed_jobs)) {
      failed_jobs = data.failed_jobs
        .map((j) => {
          if (!j || typeof j !== 'object') return null;
          const o = j as Record<string, unknown>;
          const name = typeof o.name === 'string' ? o.name : '';
          if (!name) return null;
          return {
            name,
            conclusion: typeof o.conclusion === 'string' ? o.conclusion : undefined,
            html_url: typeof o.html_url === 'string' ? o.html_url : undefined,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null);
    }

    const log_excerpt =
      typeof data.log_excerpt === 'string' && data.log_excerpt.trim().length > 0
        ? data.log_excerpt.trim()
        : undefined;

    return {
      repository,
      workflow_run_id,
      workflow_name,
      html_url,
      head_branch,
      head_sha,
      failed_jobs,
      log_excerpt,
    };
  } catch {
    return null;
  }
}

export function buildCiHealMessage(p: CiHealDispatchPayload): string {
  const jobLines = (p.failed_jobs ?? [])
    .map((j) => `- ${j.name}${j.html_url ? ` (${j.html_url})` : ''}`)
    .join('\n');
  const jobsSection = jobLines ? `\nFailed jobs:\n${jobLines}` : '';
  const logSection = p.log_excerpt?.trim()
    ? `\n\nLog excerpt (truncated):\n\`\`\`\n${p.log_excerpt.slice(0, 14_000)}\n\`\`\``
    : '';

  return `[CI self-heal] GitHub Actions failed on ${p.repository} branch "${p.head_branch}" (commit ${p.head_sha.slice(0, 7)}).

Workflow: ${p.workflow_name}
Run: ${p.html_url}
${jobsSection}
${logSection}

Fix the failure for this monorepo. Use github_get_repository_file to inspect, github_push_files on a fix branch, then github_create_pull_request, github_wait_for_pull_request_checks, and github_merge_pull_request when checks pass (the repo may auto-merge green PRs). Do not mark done until the fix is pushed and CI would pass. If the failure is clearly outside your role, summarize and stop.`.trim();
}

export type CiHealDispatchResult =
  | { ok: true; runId: string; deduped?: false }
  | { ok: true; deduped: true }
  | { ok: false; error: string };

export async function dispatchCiHealAgent(payload: CiHealDispatchPayload): Promise<CiHealDispatchResult> {
  if (!isWorkerQueueConfigured()) {
    return { ok: false, error: 'Worker queue not configured' };
  }

  const dedupeKey = `${payload.repository}:${payload.workflow_run_id}`;
  const now = Date.now();
  const last = recentDispatches.get(dedupeKey);
  if (last && now - last < DEDUPE_MS) {
    pruneDispatchMap(now);
    return { ok: true, deduped: true };
  }
  recentDispatches.set(dedupeKey, now);
  pruneDispatchMap(now);

  const roleRaw = (process.env.CI_HEAL_AGENT_ROLE ?? 'vp-design').trim().toLowerCase();
  if (!isCanonicalKeepRole(roleRaw)) {
    return { ok: false, error: `Invalid CI_HEAL_AGENT_ROLE: ${roleRaw}` };
  }
  const agentRole = roleRaw as CompanyAgentRole;

  const runId = `ci-heal-${payload.workflow_run_id}-${randomUUID()}`;
  const message = buildCiHealMessage(payload);

  await enqueueWorkerAgentExecute({
    runId,
    agentRole,
    task: 'on_demand',
    payload: {
      ci_heal: true,
      source: 'github_actions',
      workflow_run_id: payload.workflow_run_id,
      repository: payload.repository,
      head_sha: payload.head_sha,
      head_branch: payload.head_branch,
    },
    message,
  });

  return { ok: true, runId };
}

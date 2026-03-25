import { closePool, systemQuery } from '@glyphor/shared/db';

type IncidentRow = {
  id: string;
  severity: string;
  title: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
};

function getArg(name: string): string | null {
  const args = process.argv.slice(2);
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1] ?? null;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function resolveCutoff(): string {
  const explicitDate = getArg('--before-date');
  if (explicitDate) {
    const dateOnly = explicitDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
      throw new Error('Invalid --before-date format. Use YYYY-MM-DD.');
    }
    return `${dateOnly}T23:59:59.999Z`;
  }

  const daysRaw = getArg('--older-than-days') ?? '7';
  const days = Number(daysRaw);
  if (!Number.isFinite(days) || days < 0) {
    throw new Error('Invalid --older-than-days value. Must be a non-negative number.');
  }
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function listCandidates(cutoffIso: string): Promise<IncidentRow[]> {
  return systemQuery<IncidentRow>(
    `SELECT id, severity, title, status, created_at, resolved_at
     FROM incidents
     WHERE status = 'open'
       AND resolved_at IS NULL
       AND created_at <= $1
     ORDER BY created_at ASC`,
    [cutoffIso],
  );
}

async function resolveCandidates(cutoffIso: string): Promise<number> {
  const rows = await systemQuery<{ id: string }>(
    `UPDATE incidents
     SET status = 'resolved',
         resolved_at = NOW(),
         root_cause = COALESCE(root_cause, 'stale_open_incident'),
         resolution = COALESCE(
           NULLIF(resolution, ''),
           'Resolved by cleanup-stale-incidents: auto-closed stale open incident from Action Center.'
         )
     WHERE status = 'open'
       AND resolved_at IS NULL
       AND created_at <= $1
     RETURNING id`,
    [cutoffIso],
  );

  return rows.length;
}

async function main(): Promise<void> {
  const cutoffIso = resolveCutoff();
  const execute = hasFlag('--execute') || hasFlag('-x');

  const candidates = await listCandidates(cutoffIso);
  console.log(`[cleanup-stale-incidents] Cutoff: ${cutoffIso}`);
  console.log(`[cleanup-stale-incidents] Open incidents to close: ${candidates.length}`);

  if (candidates.length > 0) {
    for (const row of candidates.slice(0, 25)) {
      console.log(`- ${row.id} | ${row.severity} | ${row.title} | created=${row.created_at}`);
    }
    if (candidates.length > 25) {
      console.log(`... and ${candidates.length - 25} more.`);
    }
  }

  if (!execute) {
    console.log('[cleanup-stale-incidents] Dry run only. Re-run with --execute to apply updates.');
    return;
  }

  const updated = await resolveCandidates(cutoffIso);
  console.log(`[cleanup-stale-incidents] Resolved incidents: ${updated}`);
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cleanup-stale-incidents] Failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });

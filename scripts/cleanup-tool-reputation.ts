import { closePool, systemQuery } from '@glyphor/shared/db';

type CandidateRow = {
  tool_name: string;
  last_used_at: string | null;
  updated_at: string;
  total_calls: number;
  successful_calls: number;
  failed_calls: number;
  timeout_calls: number;
};

function readArg(name: string): string | null {
  const args = process.argv.slice(2);
  const idx = args.findIndex((arg) => arg === name);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function parseCutoffDate(raw: string | null): string {
  if (!raw) {
    throw new Error('Missing required --cutoff YYYY-MM-DD argument.');
  }
  const isoDate = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error(`Invalid cutoff date "${raw}". Expected format YYYY-MM-DD.`);
  }
  return isoDate;
}

async function listCandidates(cutoffDate: string): Promise<CandidateRow[]> {
  return systemQuery<CandidateRow>(
    `SELECT tool_name, last_used_at, updated_at, total_calls, successful_calls, failed_calls, timeout_calls
     FROM tool_reputation
     WHERE COALESCE(last_used_at, updated_at)::date <= $1::date
     ORDER BY COALESCE(last_used_at, updated_at) ASC, tool_name ASC`,
    [cutoffDate],
  );
}

async function deleteCandidates(cutoffDate: string): Promise<number> {
  const rows = await systemQuery<{ tool_name: string }>(
    `DELETE FROM tool_reputation
     WHERE COALESCE(last_used_at, updated_at)::date <= $1::date
     RETURNING tool_name`,
    [cutoffDate],
  );
  return rows.length;
}

async function main(): Promise<void> {
  const cutoffDate = parseCutoffDate(readArg('--cutoff'));
  const execute = hasFlag('--execute') || hasFlag('-x');

  const candidates = await listCandidates(cutoffDate);

  console.log(`[cleanup-tool-reputation] Cutoff date: ${cutoffDate} (inclusive).`);
  console.log(`[cleanup-tool-reputation] Matching rows: ${candidates.length}.`);

  if (candidates.length > 0) {
    for (const row of candidates.slice(0, 25)) {
      const touched = row.last_used_at ?? row.updated_at;
      console.log(`- ${row.tool_name} | touched=${touched} | calls=${row.total_calls} | success=${row.successful_calls} | failed=${row.failed_calls} | timeout=${row.timeout_calls}`);
    }
    if (candidates.length > 25) {
      console.log(`... and ${candidates.length - 25} more.`);
    }
  }

  if (!execute) {
    console.log('[cleanup-tool-reputation] Dry run only. Re-run with --execute to apply deletion.');
    return;
  }

  const deletedCount = await deleteCandidates(cutoffDate);
  console.log(`[cleanup-tool-reputation] Deleted rows: ${deletedCount}.`);
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cleanup-tool-reputation] Failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });

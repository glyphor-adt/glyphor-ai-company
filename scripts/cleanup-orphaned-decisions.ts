import { closePool, systemQuery } from '@glyphor/shared/db';

type OrphanedDecision = {
  id: string;
  title: string;
  proposed_by: string;
  created_at: string;
};

const SYSTEM_PROPOSERS = ['founder', 'scheduler', 'system', 'kristina', 'andrew'];

function hasExecuteFlag(argv: string[]): boolean {
  return argv.includes('--execute') || argv.includes('-x');
}

async function listOrphanedPendingDecisions(): Promise<OrphanedDecision[]> {
  return systemQuery<OrphanedDecision>(
    `SELECT d.id, d.title, d.proposed_by, d.created_at
     FROM decisions d
     WHERE d.status = 'pending'
       AND d.proposed_by NOT IN (
         SELECT role FROM company_agents WHERE status = 'active'
       )
       AND d.proposed_by != ALL($1::text[])
     ORDER BY d.created_at ASC`,
    [SYSTEM_PROPOSERS],
  );
}

async function rejectOrphanedPendingDecisions(): Promise<number> {
  const rows = await systemQuery<{ id: string }>(
    `UPDATE decisions
     SET status = 'rejected',
         resolved_by = 'system',
         resolved_at = NOW(),
         resolution_note = COALESCE(NULLIF(resolution_note, ''), 'Auto-rejected: proposer role is inactive or missing from company_agents')
     WHERE status = 'pending'
       AND proposed_by NOT IN (
         SELECT role FROM company_agents WHERE status = 'active'
       )
       AND proposed_by != ALL($1::text[])
     RETURNING id`,
    [SYSTEM_PROPOSERS],
  );

  return rows.length;
}

async function main(): Promise<void> {
  const execute = hasExecuteFlag(process.argv.slice(2));
  const orphaned = await listOrphanedPendingDecisions();

  console.log(`[cleanup-orphaned-decisions] Found ${orphaned.length} orphaned pending decision(s).`);

  if (orphaned.length > 0) {
    for (const row of orphaned.slice(0, 20)) {
      console.log(`- ${row.id} | ${row.proposed_by} | ${row.title}`);
    }
    if (orphaned.length > 20) {
      console.log(`... and ${orphaned.length - 20} more.`);
    }
  }

  if (!execute) {
    console.log('[cleanup-orphaned-decisions] Dry run only. Re-run with --execute to apply updates.');
    return;
  }

  const updated = await rejectOrphanedPendingDecisions();
  console.log(`[cleanup-orphaned-decisions] Rejected ${updated} orphaned pending decision(s).`);
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cleanup-orphaned-decisions] Failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });

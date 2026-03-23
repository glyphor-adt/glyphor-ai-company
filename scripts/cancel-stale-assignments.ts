/**
 * Set work_assignments to cancelled for stale pending/dispatched rows (no psql required).
 *
 *   npx tsx scripts/cancel-stale-assignments.ts --dry-run
 *   npx tsx scripts/cancel-stale-assignments.ts --execute
 *   npx tsx scripts/cancel-stale-assignments.ts --assignee cmo --hours 24 --execute
 */
import 'dotenv/config';

import { pool, closePool } from '@glyphor/shared/db';

function parseArgs(argv: string[]): { assignee: string; hours: number; execute: boolean } {
  let assignee = 'cmo';
  let hours = 24;
  let execute = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--assignee' && argv[i + 1]) assignee = argv[++i];
    else if (a === '--hours' && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) hours = n;
    } else if (a === '--execute') execute = true;
    else if (a === '--dry-run') execute = false;
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: tsx scripts/cancel-stale-assignments.ts [--assignee ROLE] [--hours N] [--dry-run|--execute]',
      );
      process.exit(0);
    }
  }
  return { assignee, hours, execute };
}

async function main(): Promise<void> {
  const { assignee, hours, execute } = parseArgs(process.argv);

  const previewSql = `
SELECT id, status, LEFT(task_description, 120) AS task, created_at
FROM work_assignments
WHERE assigned_to = $1
  AND status IN ('dispatched', 'pending')
  AND created_at < NOW() - ($2::int * INTERVAL '1 hour')
ORDER BY created_at ASC
`;

  const { rows: preview } = await pool.query(previewSql, [assignee, hours]);
  console.log(
    `assignee=${assignee} older_than=${hours}h matches=${preview.length} execute=${execute}`,
  );
  if (preview.length > 0) console.table(preview);

  if (!execute) {
    console.log('Dry run only. Pass --execute to apply UPDATE … SET status = cancelled');
    await closePool();
    return;
  }

  const updateSql = `
UPDATE work_assignments
SET status = 'cancelled', updated_at = NOW()
WHERE assigned_to = $1
  AND status IN ('dispatched', 'pending')
  AND created_at < NOW() - ($2::int * INTERVAL '1 hour')
RETURNING id
`;
  const { rows: updated } = await pool.query(updateSql, [assignee, hours]);
  console.log(`cancelled_row_count=${updated.length}`);

  await closePool();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closePool().catch(() => {});
  process.exit(1);
});

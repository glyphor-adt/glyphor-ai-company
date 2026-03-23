/**
 * List work_assignments that are still pending/dispatched but older than N hours.
 * Use when psql is not installed (e.g. Git Bash on Windows).
 *
 *   npx tsx scripts/query-stale-assignments.ts
 *   npx tsx scripts/query-stale-assignments.ts --assignee clo --hours 24
 *   npm run db:stale-assignments
 *
 * With GCP secret (no DATABASE_URL in .env):
 *   npm run db:stale-assignments:gcp
 */
import 'dotenv/config';

import { pool, closePool } from '@glyphor/shared/db';

function parseArgs(argv: string[]): { assignee: string; hours: number } {
  let assignee = 'cmo';
  let hours = 2;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--assignee' && argv[i + 1]) {
      assignee = argv[++i];
    } else if (a === '--hours' && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) hours = n;
    } else if (a === '--help' || a === '-h') {
      console.log(`Usage: tsx scripts/query-stale-assignments.ts [--assignee ROLE] [--hours N]`);
      process.exit(0);
    }
  }
  return { assignee, hours };
}

async function main(): Promise<void> {
  const { assignee, hours } = parseArgs(process.argv);

  const sql = `
SELECT id,
       status,
       LEFT(task_description, 150) AS task,
       created_at,
       updated_at
FROM work_assignments
WHERE assigned_to = $1
  AND status IN ('dispatched', 'pending')
  AND created_at < NOW() - ($2::int * INTERVAL '1 hour')
ORDER BY created_at ASC
`;

  const { rows } = await pool.query(sql, [assignee, hours]);

  console.log(
    `assignee=${assignee} statuses=pending,dispatched older_than=${hours}h row_count=${rows.length}`,
  );
  if (rows.length > 0) {
    console.table(rows);
  }

  await closePool();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closePool().catch(() => {});
  process.exit(1);
});

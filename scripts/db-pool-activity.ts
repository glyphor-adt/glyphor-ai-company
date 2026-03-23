/**
 * Snapshot pg_stat_activity for DB `glyphor` — connection states and wait events.
 *
 *   npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/db-pool-activity.ts
 */
import { pool, closePool } from '@glyphor/shared/db';

const SQL = `
SELECT count(*)::int AS active_connections,
  state,
  wait_event_type,
  wait_event
FROM pg_stat_activity
WHERE datname = 'glyphor'
GROUP BY state, wait_event_type, wait_event
ORDER BY active_connections DESC
`;

async function main(): Promise<void> {
  const { rows } = await pool.query(SQL);
  console.log(JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));

  const idleTxn = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pg_stat_activity
     WHERE datname = 'glyphor' AND state = 'idle in transaction'`,
  );
  console.log(
    JSON.stringify(
      {
        idle_in_transaction_hint:
          Number(idleTxn.rows[0]?.n ?? 0) > 0
            ? 'Non-zero idle in transaction — hunt for missing COMMIT/ROLLBACK or thrown errors after BEGIN'
            : 'No idle-in-transaction sessions on glyphor',
        idle_in_transaction_count: idleTxn.rows[0]?.n ?? '0',
      },
      null,
      2,
    ),
  );

  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  await closePool().catch(() => {});
  process.exit(1);
});

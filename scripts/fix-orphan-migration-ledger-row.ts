/**
 * Remove ledger row for renamed migration:
 * 20260319160000_route_orchestration_visual_to_flash_lite.sql → 20260319170000_...
 * Ensures canonical repo filename exists with current checksum if it was missing.
 *
 * Run: npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/fix-orphan-migration-ledger-row.ts
 */
import { createDbPool, getRepoMigrations } from './lib/migrationLedger.js';

const OLD_NAME = '20260319160000_route_orchestration_visual_to_flash_lite.sql';
const NEW_NAME = '20260319170000_route_orchestration_visual_to_flash_lite.sql';

async function main(): Promise<void> {
  const repo = getRepoMigrations();
  const newMeta = repo.find((m) => m.name === NEW_NAME);
  if (!newMeta) {
    throw new Error(`Repo migration not found: ${NEW_NAME}`);
  }

  const pool = createDbPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: oldRows } = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations WHERE name = $1',
      [OLD_NAME],
    );
    const { rows: newRows } = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations WHERE name = $1',
      [NEW_NAME],
    );

    if (oldRows.length > 0) {
      await client.query('DELETE FROM schema_migrations WHERE name = $1', [OLD_NAME]);
      process.stdout.write(`Removed orphan ledger row: ${OLD_NAME}\n`);
    }

    if (newRows.length === 0) {
      const appliedBy = await client.query<{ current_user: string }>('SELECT current_user');
      const user = appliedBy.rows[0]?.current_user ?? 'unknown';
      await client.query(
        `INSERT INTO schema_migrations (name, checksum, applied_by, source)
         VALUES ($1, $2, $3, 'ledger-reconcile-rename')`,
        [NEW_NAME, newMeta.checksum, user],
      );
      process.stdout.write(`Inserted ledger row: ${NEW_NAME}\n`);
    } else {
      process.stdout.write(`Ledger row already present: ${NEW_NAME}\n`);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});

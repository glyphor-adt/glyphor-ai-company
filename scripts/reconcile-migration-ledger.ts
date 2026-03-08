import { createDbPool, ensureLedgerTable, getCurrentUser, getRepoMigrations } from './lib/migrationLedger';

async function main() {
  const source = process.argv[2] ?? 'baseline-reconcile';
  const pool = createDbPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureLedgerTable(client);

    const currentUser = await getCurrentUser(client);
    const migrations = getRepoMigrations();

    for (const migration of migrations) {
      await client.query(
        `insert into schema_migrations (name, checksum, applied_by, source, notes)
         values ($1, $2, $3, $4, $5)
         on conflict (name) do update set checksum = excluded.checksum`,
        [migration.name, migration.checksum, currentUser, source, 'Backfilled from repository state'],
      );
    }

    await client.query('COMMIT');
    console.log(`Reconciled ${migrations.length} migrations into schema_migrations.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

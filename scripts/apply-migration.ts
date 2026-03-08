import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createDbPool, ensureLedgerTable, getCurrentUser, getRepoMigrations, migrationsDir } from './lib/migrationLedger';

async function main() {
  const migrationName = process.argv[2];
  if (!migrationName) {
    throw new Error('Usage: tsx scripts/apply-migration.ts <migration-file.sql>');
  }

  const migrations = getRepoMigrations();
  const migration = migrations.find((item) => item.name === migrationName);
  if (!migration) {
    throw new Error(`Migration not found in ${migrationsDir}: ${migrationName}`);
  }

  const sql = readFileSync(path.resolve(migration.filePath), 'utf8');
  const pool = createDbPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureLedgerTable(client);

    const existing = await client.query<{ checksum: string }>('select checksum from schema_migrations where name = $1', [migration.name]);
    if (existing.rows[0]?.checksum === migration.checksum) {
      await client.query('ROLLBACK');
      console.log(`Migration already recorded with matching checksum: ${migration.name}`);
      return;
    }

    await client.query(sql);
    const currentUser = await getCurrentUser(client);
    await client.query(
      `insert into schema_migrations (name, checksum, applied_by, source, notes)
       values ($1, $2, $3, $4, $5)
       on conflict (name) do update
       set checksum = excluded.checksum,
           applied_at = now(),
           applied_by = excluded.applied_by,
           source = excluded.source,
           notes = excluded.notes`,
      [migration.name, migration.checksum, currentUser, 'tsx-apply-migration', 'Applied via scripts/apply-migration.ts'],
    );

    await client.query('COMMIT');
    console.log(`Applied migration: ${migration.name}`);
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

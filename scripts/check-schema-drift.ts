import { createDbPool, getRepoMigrations } from './lib/migrationLedger.js';

interface AppliedMigration {
  name: string;
  checksum: string;
}

interface ChecksumMismatch {
  name: string;
  repoChecksum: string;
  appliedChecksum: string;
}

async function main(): Promise<void> {
  const repoMigrations = getRepoMigrations();
  const pool = createDbPool();
  const client = await pool.connect();

  try {
    const tableCheck = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
    );

    if (!tableCheck.rows[0]?.exists) {
      process.stderr.write('schema_migrations table does not exist yet. Run db:reconcile-ledger first.\n');
      process.exitCode = 1;
      return;
    }

    const applied = await client.query<AppliedMigration>(
      'SELECT name, checksum FROM schema_migrations ORDER BY name',
    );

    const repoMap = new Map(repoMigrations.map((m) => [m.name, m.checksum]));
    const appliedMap = new Map(applied.rows.map((m) => [m.name, m.checksum]));

    const missingInDb = repoMigrations.filter((m) => !appliedMap.has(m.name));
    const missingInRepo = applied.rows.filter((m) => !repoMap.has(m.name));
    const checksumMismatches: ChecksumMismatch[] = repoMigrations
      .map((m) => ({
        name: m.name,
        repoChecksum: m.checksum,
        appliedChecksum: appliedMap.get(m.name),
      }))
      .filter(
        (m): m is ChecksumMismatch =>
          typeof m.appliedChecksum === 'string' && m.appliedChecksum !== m.repoChecksum,
      );

    process.stdout.write(`Repo migrations: ${repoMigrations.length}\n`);
    process.stdout.write(`Ledger entries: ${applied.rows.length}\n`);

    if (missingInDb.length === 0 && missingInRepo.length === 0 && checksumMismatches.length === 0) {
      process.stdout.write('No schema drift detected.\n');
      return;
    }

    process.stdout.write('Schema drift detected.\n');

    if (missingInDb.length > 0) {
      process.stdout.write('\nMissing in DB ledger:\n');
      for (const migration of missingInDb) {
        process.stdout.write(`  ${migration.name}\n`);
      }
    }

    if (missingInRepo.length > 0) {
      process.stdout.write('\nMissing in repo:\n');
      for (const migration of missingInRepo) {
        process.stdout.write(`  ${migration.name}\n`);
      }
    }

    if (checksumMismatches.length > 0) {
      process.stdout.write('\nChecksum mismatches:\n');
      for (const migration of checksumMismatches) {
        process.stdout.write(`  ${migration.name}\n`);
        process.stdout.write(`    applied: ${migration.appliedChecksum}\n`);
        process.stdout.write(`    repo:    ${migration.repoChecksum}\n`);
      }
    }

    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});

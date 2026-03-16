import { ensureLedgerTable, createDbPool, getCurrentUser, getRepoMigrations } from './lib/migrationLedger.js';

function readArg(args: string[], key: string): string | undefined {
  const idx = args.indexOf(key);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const source = readArg(args, '--source') ?? 'reconcile';

  const repoMigrations = getRepoMigrations();
  const pool = createDbPool();
  const client = await pool.connect();

  try {
    await ensureLedgerTable(client);

    const applied = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );

    const appliedMap = new Map(applied.rows.map((m) => [m.name, m.checksum]));

    const toInsert = repoMigrations.filter((m) => !appliedMap.has(m.name));
    const checksumMismatches = repoMigrations.filter((m) => {
      const existingChecksum = appliedMap.get(m.name);
      return Boolean(existingChecksum && existingChecksum !== m.checksum);
    });

    process.stdout.write(`Repo migrations: ${repoMigrations.length}\n`);
    process.stdout.write(`Ledger entries: ${applied.rows.length}\n`);
    process.stdout.write(`Missing entries to insert: ${toInsert.length}\n`);

    if (checksumMismatches.length > 0) {
      process.stderr.write('Checksum mismatches detected. Aborting reconcile.\n');
      for (const migration of checksumMismatches) {
        process.stderr.write(`  ${migration.name}\n`);
      }
      process.exit(1);
    }

    if (toInsert.length === 0) {
      process.stdout.write('Ledger already reconciled.\n');
      return;
    }

    if (dryRun) {
      process.stdout.write('--dry-run: no rows inserted.\n');
      return;
    }

    const appliedBy = await getCurrentUser(client);

    for (const migration of toInsert) {
      await client.query(
        `INSERT INTO schema_migrations (name, checksum, applied_by, source)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO NOTHING`,
        [migration.name, migration.checksum, appliedBy, source],
      );
      process.stdout.write(`  inserted ${migration.name}\n`);
    }

    process.stdout.write(`Reconciled ${toInsert.length} migration(s).\n`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});

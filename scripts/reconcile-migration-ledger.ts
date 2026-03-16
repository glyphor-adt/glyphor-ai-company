import { ensureLedgerTable, createDbPool, getCurrentUser, getRepoMigrations } from './lib/migrationLedger.js';

function readArg(args: string[], key: string): string | undefined {
  const idx = args.indexOf(key);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

interface ChecksumMismatch {
  name: string;
  repoChecksum: string;
  appliedChecksum: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const adoptRepoChecksums = args.includes('--adopt-repo-checksums');
  const source =
    readArg(args, '--source') ??
    (adoptRepoChecksums ? 'reconcile-adopt-checksum' : 'reconcile');

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
    process.stdout.write(`Missing entries to insert: ${toInsert.length}\n`);
    process.stdout.write(`Checksum mismatches: ${checksumMismatches.length}\n`);

    if (checksumMismatches.length > 0 && !adoptRepoChecksums) {
      process.stderr.write('Checksum mismatches detected. Aborting reconcile. Re-run with --adopt-repo-checksums to update ledger checksums to match repo files.\n');
      for (const migration of checksumMismatches) {
        process.stderr.write(`  ${migration.name}\n`);
        process.stderr.write(`    applied: ${migration.appliedChecksum}\n`);
        process.stderr.write(`    repo:    ${migration.repoChecksum}\n`);
      }
      process.exit(1);
    }

    if (toInsert.length === 0 && checksumMismatches.length === 0) {
      process.stdout.write('Ledger already reconciled.\n');
      return;
    }

    if (dryRun) {
      process.stdout.write('--dry-run: no rows changed.\n');
      if (adoptRepoChecksums && checksumMismatches.length > 0) {
        process.stdout.write('Would adopt repo checksums for:\n');
        for (const migration of checksumMismatches) {
          process.stdout.write(`  ${migration.name}\n`);
        }
      }
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

    if (adoptRepoChecksums && checksumMismatches.length > 0) {
      for (const mismatch of checksumMismatches) {
        await client.query(
          `UPDATE schema_migrations
           SET checksum = $2,
               source = $3
           WHERE name = $1`,
          [mismatch.name, mismatch.repoChecksum, source],
        );
        process.stdout.write(`  adopted checksum ${mismatch.name}\n`);
      }
    }

    process.stdout.write(
      `Reconciled ${toInsert.length} insertion(s) and ${adoptRepoChecksums ? checksumMismatches.length : 0} checksum adoption(s).\n`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});

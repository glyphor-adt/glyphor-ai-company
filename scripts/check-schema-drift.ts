import { createDbPool, ensureLedgerTable, getRepoMigrations } from './lib/migrationLedger';

async function main() {
  const pool = createDbPool();
  const client = await pool.connect();

  try {
    await ensureLedgerTable(client);

    const repoMigrations = getRepoMigrations();
    const result = await client.query<{ name: string; checksum: string }>('select name, checksum from schema_migrations');
    const appliedByName = new Map(result.rows.map((row) => [row.name, row.checksum]));

    const missingInDb = repoMigrations.filter((migration) => !appliedByName.has(migration.name));
    const checksumMismatches = repoMigrations.filter((migration) => {
      const appliedChecksum = appliedByName.get(migration.name);
      return appliedChecksum && appliedChecksum !== migration.checksum;
    });
    const repoNames = new Set(repoMigrations.map((migration) => migration.name));
    const dbOnly = result.rows.filter((row) => !repoNames.has(row.name));

    console.log(`Repo migrations: ${repoMigrations.length}`);
    console.log(`Ledger entries: ${result.rows.length}`);

    if (missingInDb.length === 0 && checksumMismatches.length === 0 && dbOnly.length === 0) {
      console.log('Schema migration ledger is in sync.');
      return;
    }

    if (missingInDb.length > 0) {
      console.log('\nMissing in DB ledger:');
      for (const migration of missingInDb) console.log(`- ${migration.name}`);
    }

    if (checksumMismatches.length > 0) {
      console.log('\nChecksum mismatches:');
      for (const migration of checksumMismatches) console.log(`- ${migration.name}`);
    }

    if (dbOnly.length > 0) {
      console.log('\nLedger entries not found in repo:');
      for (const migration of dbOnly) console.log(`- ${rowName(row.name)}`);
    }

    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

function rowName(name: string) {
  return name;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

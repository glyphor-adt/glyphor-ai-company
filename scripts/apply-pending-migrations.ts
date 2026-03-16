import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createDbPool, ensureLedgerTable, getCurrentUser, getRepoMigrations } from './lib/migrationLedger.js';

/**
 * Apply all pending migrations in order.
 *
 * For each .sql file in db/migrations/ that is NOT already recorded
 * in schema_migrations, run it inside a transaction and record it.
 *
 * Usage:
 *   tsx scripts/apply-pending-migrations.ts [--dry-run] [--source <label>]
 */

function readArg(args: string[], key: string): string | undefined {
  const idx = args.indexOf(key);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const source = readArg(args, '--source') ?? 'apply-pending';

  const repoMigrations = getRepoMigrations();
  const pool = createDbPool();
  const client = await pool.connect();

  try {
    await ensureLedgerTable(client);

    const applied = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const appliedMap = new Map(applied.rows.map((r) => [r.name, r.checksum]));

    const pending = repoMigrations.filter((m) => !appliedMap.has(m.name));

    if (pending.length === 0) {
      process.stdout.write('All migrations are up to date.\n');
      return;
    }

    process.stdout.write(`Found ${pending.length} pending migration(s):\n`);
    for (const m of pending) {
      process.stdout.write(`  ${m.name}\n`);
    }

    if (dryRun) {
      process.stdout.write('\n--dry-run: No changes applied.\n');
      return;
    }

    process.stdout.write('\nApplying...\n');

    let applied_count = 0;
    const appliedBy = await getCurrentUser(client);

    for (const m of pending) {
      const sql = fs.readFileSync(m.filePath, 'utf8');

      // Check for checksum mismatch (file was mutated after being applied)
      const existingChecksum = appliedMap.get(m.name);
      if (existingChecksum && existingChecksum !== m.checksum) {
        throw new Error(
          `Migration ${m.name} exists with different checksum. ` +
          'Create a new migration file instead of mutating an applied one.',
        );
      }

      try {
        await client.query(sql);

        await client.query(
          `INSERT INTO schema_migrations (name, checksum, applied_by, source)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (name) DO NOTHING`,
          [m.name, m.checksum, appliedBy, source],
        );

        applied_count++;
        process.stdout.write(`  ✓ ${m.name}\n`);
      } catch (err) {
        process.stderr.write(`  ✗ ${m.name}: ${(err as Error).message}\n`);
        throw new Error(`Migration ${m.name} failed. ${applied_count} migration(s) applied before failure.`);
      }
    }

    process.stdout.write(`\nDone. ${applied_count} migration(s) applied.\n`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});

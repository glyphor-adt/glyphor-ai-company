import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createDbPool, ensureLedgerTable, getCurrentUser, migrationsDir } from './lib/migrationLedger.js';

function readArg(args: string[], key: string): string | undefined {
  const idx = args.indexOf(key);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function resolveMigrationPath(input: string): string {
  if (path.isAbsolute(input)) return input;
  if (input.includes('/') || input.includes('\\')) return path.resolve(process.cwd(), input);
  return path.join(migrationsDir, input);
}

export async function applyMigrationFile(filePath: string, source = 'manual'): Promise<void> {
  const name = path.basename(filePath);
  const sql = fs.readFileSync(filePath, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');

  const pool = createDbPool();
  const client = await pool.connect();

  try {
    await ensureLedgerTable(client);

    const existing = await client.query<{ checksum: string }>(
      'SELECT checksum FROM schema_migrations WHERE name = $1',
      [name],
    );

    if (existing.rowCount && existing.rows[0].checksum === checksum) {
      process.stdout.write(`No-op: migration already applied with same checksum (${name})\n`);
      return;
    }

    if (existing.rowCount && existing.rows[0].checksum !== checksum) {
      throw new Error(
        `Migration ${name} already exists in schema_migrations with a different checksum. `
        + 'Create a new migration file instead of mutating an applied one.',
      );
    }

    await client.query(sql);

    const appliedBy = await getCurrentUser(client);
    await client.query(
      `INSERT INTO schema_migrations (name, checksum, applied_by, source)
       VALUES ($1, $2, $3, $4)`,
      [name, checksum, appliedBy, source],
    );

    process.stdout.write(`Applied migration: ${name}\n`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileArg = readArg(args, '--file') ?? args[0];
  const source = readArg(args, '--source') ?? 'manual';

  if (!fileArg) {
    throw new Error('Usage: tsx scripts/apply-migration.ts --file <path-to-sql> [--source <label>]');
  }

  const resolved = resolveMigrationPath(fileArg);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Migration file not found: ${resolved}`);
  }

  await applyMigrationFile(resolved, source);
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});

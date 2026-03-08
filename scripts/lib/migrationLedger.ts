import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';

export interface RepoMigration {
  name: string;
  filePath: string;
  checksum: string;
}

export const migrationsDir = path.resolve(process.cwd(), 'db', 'migrations');

export function createDbPool(): Pool {
  if (process.env.DATABASE_URL) {
    return new Pool({ connectionString: process.env.DATABASE_URL });
  }

  return new Pool({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? 'glyphor',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
}

export function getRepoMigrations(): RepoMigration[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const filePath = path.join(migrationsDir, name);
      const contents = readFileSync(filePath, 'utf8');
      const checksum = createHash('sha256').update(contents).digest('hex');
      return { name, filePath, checksum };
    });
}

export async function ensureLedgerTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      applied_by TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      notes TEXT
    )
  `);

  await client.query('CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at ON schema_migrations(applied_at DESC)');
}

export async function getCurrentUser(client: PoolClient): Promise<string> {
  const result = await client.query<{ current_user: string }>('select current_user');
  return result.rows[0]?.current_user ?? 'unknown';
}

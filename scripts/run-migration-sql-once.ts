/**
 * Run one migration file with SET ROLE glyphor_system, autocommit (no BEGIN…COMMIT from file).
 * Records schema_migrations when the ledger table already exists.
 */
import { createHash } from 'node:crypto';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000000';

async function main(): Promise<void> {
  const name = process.argv[2] ?? '20260404180000_budget_baseline_knowledge.sql';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const filePath = path.join(root, 'db/migrations', name);
  const fullFile = fs.readFileSync(filePath, 'utf8');
  const fileChecksum = createHash('sha256').update(fullFile).digest('hex');
  let sql = fullFile;
  // File often starts with comments; strip BEGIN/COMMIT so one statement runs in autocommit mode
  // (BEGIN… without COMMIT before disconnect rolls back the connection).
  sql = sql
    .replace(/\bBEGIN\s*;\s*/gi, '')
    .replace(/;\s*COMMIT\s*;\s*$/i, ';')
    .trim();
  if (!sql) throw new Error('Empty SQL after strip');

  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query(`SET app.current_tenant = '${DEFAULT_TENANT}'`).catch(() => {});
    try {
      await client.query('SET ROLE glyphor_system');
    } catch {
      /* app user may lack SET ROLE */
    }
    try {
      const sqlWithRet = sql.replace(/;\s*$/, ' RETURNING section, title;');
      const res = await client.query(sqlWithRet);
      const results = Array.isArray(res) ? res : [res];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        process.stdout.write(
          `[${i}] command=${String(r.command)} rowCount=${String(r.rowCount)} rows=${JSON.stringify(r.rows)}\n`,
        );
      }

      const who = await client.query<{ current_user: string }>('select current_user');
      const appliedBy = who.rows[0]?.current_user ?? 'unknown';
      try {
        await client.query(
          'INSERT INTO schema_migrations (name, checksum, applied_by, source) VALUES ($1, $2, $3, $4) ' +
            'ON CONFLICT (name) DO UPDATE SET checksum = $2, applied_by = $3, source = $4',
          [name, fileChecksum, appliedBy, 'run-migration-sql-once'],
        );
        process.stdout.write(`schema_migrations: recorded ${name}\n`);
      } catch (ledgerErr) {
        const e = ledgerErr as Error & { code?: string };
        const msg = e instanceof Error ? `${e.message}${e.code ? ` [${e.code}]` : ''}` : String(ledgerErr);
        process.stderr.write(`schema_migrations: skipped (${msg})\n`);
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  } finally {
    await client.query('RESET ROLE').catch(() => {});
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * Apply db/migrations/20260411164000_restore_cto_engineering_ic_roster.sql against the configured DB.
 *
 *   npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_system_user --db-password-secret db-system-password scripts/restore-cto-engineering-ics.ts
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { pool, closePool } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const path = join(process.cwd(), 'db/migrations/20260411164000_restore_cto_engineering_ic_roster.sql');
  const sql = readFileSync(path, 'utf8');
  await pool.query(sql);
  console.log('restore-cto-engineering-ics: applied', path);

  const verify = await pool.query<{ role: string; reports_to: string | null }>(
    `SELECT role, reports_to FROM company_agents WHERE reports_to = 'cto' ORDER BY role`,
  );
  console.log('--- reports_to = cto ---');
  console.log(JSON.stringify(verify.rows, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());

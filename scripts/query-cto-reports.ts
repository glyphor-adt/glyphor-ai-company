/** Who rolls up to Engineering / CTO in company_agents (read-only). */
import 'dotenv/config';
import { pool, closePool } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const r = await pool.query(
    `SELECT role, status, display_name, department, reports_to
     FROM company_agents
     WHERE reports_to = 'cto' OR LOWER(TRIM(COALESCE(department, ''))) = 'engineering'
     ORDER BY role`,
  );
  console.log(JSON.stringify(r.rows, null, 2));
}

main().finally(() => closePool());

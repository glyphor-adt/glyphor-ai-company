/** All company_agents that should roll up to CTO (read-only). */
import 'dotenv/config';
import { pool, closePool } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const all = await pool.query(
    `SELECT role, status, display_name, department, reports_to
     FROM company_agents
     ORDER BY role`,
  );
  console.log('--- all agents (count ' + all.rows.length + ') ---');
  console.log(JSON.stringify(all.rows, null, 2));

  const toCto = await pool.query(
    `SELECT role, status, display_name, department, reports_to
     FROM company_agents
     WHERE reports_to = 'cto'
     ORDER BY role`,
  );
  console.log('--- reports_to = cto ---');
  console.log(JSON.stringify(toCto.rows, null, 2));
}

main().finally(() => closePool());

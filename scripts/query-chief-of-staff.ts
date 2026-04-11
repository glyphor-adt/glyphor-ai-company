/**
 * Read-only: chief-of-staff / Sarah rows in company_agents (prod debugging).
 *
 *   npx tsx scripts/query-chief-of-staff.ts
 *   npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_system_user --db-password-secret db-system-password scripts/query-chief-of-staff.ts
 */
import 'dotenv/config';

import { pool, closePool } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const cos = await pool.query(
    `SELECT role, status, display_name, name, department, tenant_id::text, updated_at
     FROM company_agents
     WHERE role = 'chief-of-staff'
        OR display_name ILIKE '%sarah%'
        OR name ILIKE '%sarah%'
     ORDER BY role`,
  );
  console.log('--- matches (cos / sarah name) ---');
  console.log(JSON.stringify(cos.rows, null, 2));

  const live = await pool.query(
    `SELECT role, status, display_name, updated_at
     FROM company_agents
     WHERE status = 'active'
       AND role = ANY($1::text[])
     ORDER BY role`,
    [['chief-of-staff', 'cto', 'cfo', 'cpo', 'cmo', 'vp-design', 'ops', 'vp-research']],
  );
  console.log('--- live roster (status=active, canonical roles) ---');
  console.log(JSON.stringify(live.rows, null, 2));

  const cto = await pool.query(
    `SELECT role, status, display_name, name, department, tenant_id::text, updated_at
     FROM company_agents
     WHERE role = 'cto'`,
  );
  console.log('--- CTO row (any status) ---');
  console.log(JSON.stringify(cto.rows, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());

/**
 * One-shot: set chief-of-staff (Sarah) to active in company_agents.
 *
 *   npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_system_user --db-password-secret db-system-password scripts/activate-chief-of-staff.ts
 */
import 'dotenv/config';

import { pool, closePool } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const { rows } = await pool.query<{
    role: string;
    status: string;
    display_name: string | null;
    updated_at: Date;
  }>(
    `UPDATE company_agents
     SET status = 'active', updated_at = NOW()
     WHERE role = 'chief-of-staff'
     RETURNING role, status, display_name, updated_at`,
  );
  if (rows.length === 0) {
    console.error('No row with role chief-of-staff — insert the agent first.');
    process.exitCode = 1;
    return;
  }
  console.log('Updated:', JSON.stringify(rows[0], null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());

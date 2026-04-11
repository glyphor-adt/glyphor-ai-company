/**
 * Set a canonical agent role to active (e.g. cto, chief-of-staff).
 *
 *   npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_system_user --db-password-secret db-system-password scripts/activate-agent-role.ts cto
 */
import 'dotenv/config';

import { pool, closePool } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const role = (process.argv[2] ?? '').trim();
  if (!role || !/^[a-z0-9-]+$/.test(role)) {
    console.error('Usage: activate-agent-role.ts <role-slug>   e.g. cto, chief-of-staff');
    process.exitCode = 1;
    return;
  }

  const { rows } = await pool.query<{
    role: string;
    status: string;
    display_name: string | null;
    updated_at: Date;
  }>(
    `UPDATE company_agents
     SET status = 'active', updated_at = NOW()
     WHERE role = $1
     RETURNING role, status, display_name, updated_at`,
    [role],
  );
  if (rows.length === 0) {
    console.error(`No row with role ${role}.`);
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

/**
 * Update company_agents.model for a role.
 *
 * Usage:
 *   npx tsx scripts/set-agent-model.ts <role> <model>
 *   npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/set-agent-model.ts cto gemini-3.1-pro-preview
 */
import 'dotenv/config';

import { pool, closePool } from '@glyphor/shared/db';

function usage(): never {
  throw new Error('Usage: tsx scripts/set-agent-model.ts <role> <model>');
}

async function main(): Promise<void> {
  const role = String(process.argv[2] ?? '').trim();
  const model = String(process.argv[3] ?? '').trim();
  if (!role || !model) usage();

  const before = await pool.query(
    'SELECT role, model, updated_at FROM company_agents WHERE role = $1 LIMIT 1',
    [role],
  );
  if (before.rows.length === 0) {
    throw new Error(`No company_agents row found for role "${role}".`);
  }

  await pool.query(
    'UPDATE company_agents SET model = $1, updated_at = NOW() WHERE role = $2',
    [model, role],
  );

  const after = await pool.query(
    'SELECT role, model, updated_at FROM company_agents WHERE role = $1 LIMIT 1',
    [role],
  );

  console.log(
    JSON.stringify(
      {
        updated: true,
        before: before.rows[0],
        after: after.rows[0],
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());

/**
 * Applies db/migrations/20260404180000_budget_baseline_knowledge.sql using
 * systemTransaction (SET ROLE glyphor_system), for environments where
 * apply-pending-migrations.ts fails with "permission denied for schema public".
 *
 *   npx tsx --env-file=.env scripts/apply-budget-baseline-migration.ts
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemTransaction, closePool } from '@glyphor/shared/db';

const MIGRATION_NAME = '20260404180000_budget_baseline_knowledge.sql';

async function main(): Promise<void> {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(root, '..');
  const filePath = path.join(repoRoot, 'db', 'migrations', MIGRATION_NAME);
  const fullSql = fs.readFileSync(filePath, 'utf8');
  const checksum = createHash('sha256').update(fullSql).digest('hex');
  const body = fullSql
    .replace(/^BEGIN;\s*/i, '')
    .replace(/;\s*COMMIT;\s*$/i, ';')
    .trim();

  await systemTransaction(async (client) => {
    await client.query(body);
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
    await client.query(
      `INSERT INTO schema_migrations (name, checksum, applied_by, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE SET
         checksum = EXCLUDED.checksum,
         applied_at = NOW(),
         applied_by = EXCLUDED.applied_by,
         source = EXCLUDED.source`,
      [MIGRATION_NAME, checksum, 'scripts/apply-budget-baseline-migration', 'system_transaction'],
    );
  });

  console.log(`Applied ${MIGRATION_NAME} (ledger updated).`);
}

main()
  .catch((e) => {
    console.error('[apply-budget-baseline-migration]', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));

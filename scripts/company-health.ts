/**
 * Autonomous fleet health: pending DB migrations + critical / warn-only tool grants.
 *
 *   npx tsx scripts/company-health.ts
 *   npm run validate:company-health
 *
 * With GCP DB:
 *   npm run validate:company-health:gcp
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

import { closePool, pool } from '@glyphor/shared/db';
import { checkRoleToolGrants, type RoleGrantPolicy } from './lib/toolGrantChecks.js';
import { getPendingMigrationNames } from './lib/migrationLedger.js';

interface RequirementsFile {
  critical_roles: Record<string, RoleGrantPolicy>;
  warn_only_roles?: Record<string, RoleGrantPolicy>;
}

function loadRequirements(): RequirementsFile {
  const configPath = path.resolve(process.cwd(), 'scripts/config/live-role-tool-requirements.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw) as RequirementsFile;
}

async function main(): Promise<void> {
  const requirements = loadRequirements();
  let exitCode = 0;

  const pending = await getPendingMigrationNames(pool);
  if (pending.length > 0) {
    console.error(`PENDING MIGRATIONS (${pending.length}) — apply before relying on production:\n  ${pending.join('\n  ')}`);
    exitCode = 1;
  } else {
    console.log('Migrations: up to date (ledger matches repo).');
  }

  for (const [role, policy] of Object.entries(requirements.critical_roles)) {
    const result = await checkRoleToolGrants(pool, role, policy);
    console.log(
      `[critical] ${role}: rows=${result.totalRows} effective=${result.effectiveGrants} ok=${result.ok}`,
    );
    if (result.warnings.length > 0) {
      console.warn(`  recommended missing/blocked: ${result.warnings.join(', ')}`);
    }
    if (!result.ok) {
      console.error(`  FAILED:\n${result.fatal.map((l) => `    - ${l}`).join('\n')}`);
      exitCode = 1;
    }
  }

  if (requirements.warn_only_roles) {
    for (const [role, policy] of Object.entries(requirements.warn_only_roles)) {
      const result = await checkRoleToolGrants(pool, role, policy);
      console.log(
        `[warn-only] ${role}: rows=${result.totalRows} effective=${result.effectiveGrants} required_ok=${result.ok}`,
      );
      if (!result.ok) {
        console.warn(
          `[warn-only] ${role}: grant gaps (non-fatal):\n${result.fatal.map((l) => `  - ${l}`).join('\n')}`,
        );
      }
      if (result.warnings.length > 0) {
        console.warn(`[warn-only] ${role}: recommended missing/blocked: ${result.warnings.join(', ')}`);
      }
    }
  }

  await closePool();
  if (exitCode !== 0) process.exit(exitCode);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closePool().catch(() => {});
  process.exit(1);
});

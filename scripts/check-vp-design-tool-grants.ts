/**
 * Verify vp-design (Mia) tool grants — config-driven (see live-role-tool-requirements.json).
 *
 *   npx tsx scripts/check-vp-design-tool-grants.ts
 *   npm run validate:vp-design-grants
 *
 * With GCP database:
 *   npm run validate:vp-design-grants:gcp
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

import { pool, closePool } from '@glyphor/shared/db';
import { checkRoleToolGrants, type RoleGrantPolicy } from './lib/toolGrantChecks.js';

interface RequirementsFile {
  critical_roles: Record<string, RoleGrantPolicy>;
}

async function main(): Promise<void> {
  const configPath = path.resolve(process.cwd(), 'scripts/config/live-role-tool-requirements.json');
  const requirements = JSON.parse(fs.readFileSync(configPath, 'utf8')) as RequirementsFile;
  const policy = requirements.critical_roles['vp-design'];
  if (!policy) {
    console.error('critical_roles.vp-design missing from live-role-tool-requirements.json');
    process.exitCode = 1;
    await closePool();
    return;
  }

  const result = await checkRoleToolGrants(pool, 'vp-design', policy);
  console.log(
    `agent_role=vp-design total_rows=${result.totalRows} effective_grants~=${result.effectiveGrants}`,
  );
  if (result.warnings.length > 0) {
    console.warn(`Recommended grants missing or blocked (non-fatal): ${result.warnings.join(', ')}`);
  }
  if (!result.ok) {
    console.error('VP Design tool grant check FAILED:\n' + result.fatal.map((l) => `  - ${l}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('VP Design required web pipeline grants: OK');
  }

  await closePool();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closePool().catch(() => {});
  process.exit(1);
});

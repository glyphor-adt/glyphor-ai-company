/**
 * Deploy static CTO_SYSTEM_PROMPT as the active agent_prompt_versions row.
 * Version = MAX(version)+1 (cannot reuse version 1 if row exists — unique constraint).
 *
 * Run: npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/seed-cto-prompt-from-static.ts
 */
import { CTO_SYSTEM_PROMPT } from '../packages/agents/src/cto/systemPrompt.js';
import { closePool, systemTransaction } from '@glyphor/shared/db';

const TENANT = 'system';
const AGENT_ID = 'cto';

async function main(): Promise<void> {
  await systemTransaction(async (client) => {
    const { rows: maxRow } = await client.query<{ max_v: string }>(
      `SELECT COALESCE(MAX(version), 0)::text AS max_v FROM agent_prompt_versions
       WHERE tenant_id = $1 AND agent_id = $2`,
      [TENANT, AGENT_ID],
    );
    const nextVersion = Number(maxRow[0]?.max_v ?? 0) + 1;

    await client.query(
      `UPDATE agent_prompt_versions SET retired_at = NOW()
       WHERE tenant_id = $1 AND agent_id = $2
         AND deployed_at IS NOT NULL AND retired_at IS NULL`,
      [TENANT, AGENT_ID],
    );

    await client.query(
      `INSERT INTO agent_prompt_versions
        (tenant_id, agent_id, version, prompt_text, change_summary, source, deployed_at)
       VALUES ($1, $2, $3, $4, $5, 'manual', NOW())`,
      [
        TENANT,
        AGENT_ID,
        nextVersion,
        CTO_SYSTEM_PROMPT,
        'Active prompt from packages/agents/src/cto/systemPrompt.ts (CTO_SYSTEM_PROMPT + REASONING_PROMPT_SUFFIX)',
      ],
    );

    process.stdout.write(
      `[ok] Inserted cto v${nextVersion}, source=manual, deployed_at=NOW(), length=${CTO_SYSTEM_PROMPT.length}\n`,
    );
  });
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

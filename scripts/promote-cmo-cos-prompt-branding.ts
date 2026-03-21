/**
 * One-shot: bump CMO + chief-of-staff agent_prompt_versions with brand/product framing updates.
 * Run: npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/promote-cmo-cos-prompt-branding.ts
 */
import type { PoolClient } from 'pg';
import { closePool, systemTransaction } from '@glyphor/shared/db';

const TENANT = 'system';

const CMO_BRAND_SECTION = `## Brand Voice
BRAND VOICE: Confident, clear, architectural. Not irreverent. Not corporate.
Present tense, active voice. Numbers beat adjectives. No exclamation marks 
in external copy. No buzzwords. No hedging. Lead with the outcome.
External product name: AI Marketing Department only. Never mention Pulse, 
Fuse, Revy, or Cockpit to customers or in customer-facing content.
`;

function transformCmoPrompt(text: string): string {
  const brandRe = /## Brand Voice\r?\n[\s\S]*?(?=\r?\n## )/;
  let out = text.replace(brandRe, `${CMO_BRAND_SECTION}\n`);

  out = out.replace(
    /\bthe products \(Fuse and Pulse\) have not launched yet\b/g,
    'building AI-powered departments that deliver outcomes. The only external product is the AI Marketing Department',
  );
  out = out.replace(
    /\bbuilding autonomous software \(Fuse\) and creative \(Pulse\) platforms\b/g,
    'building AI-powered departments that deliver outcomes. The only external product is the AI Marketing Department',
  );
  return out;
}

function transformChiefOfStaffPrompt(text: string): string {
  let out = text.replace(
    /building autonomous software \(Fuse\) and creative \(Pulse\) platforms/g,
    'building AI-powered departments that deliver outcomes. The only external product is the AI Marketing Department',
  );
  // Any other legacy one-liner product framing (avoid touching tool names / URLs)
  out = out.replace(
    /\bGlyphor's products \(Pulse, Fuse\)/gi,
    'the AI Marketing Department (our only external product)',
  );
  out = out.replace(
    /\b\(Pulse and Fuse\)/gi,
    '(AI Marketing Department)',
  );
  return out;
}

async function promoteAgentPrompt(
  client: PoolClient,
  agentId: string,
  transform: (s: string) => string,
  changeSummary: string,
): Promise<void> {
  const { rows: active } = await client.query<{ id: string; version: number; prompt_text: string }>(
    `SELECT id, version, prompt_text FROM agent_prompt_versions
     WHERE tenant_id = $1 AND agent_id = $2
       AND deployed_at IS NOT NULL AND retired_at IS NULL`,
    [TENANT, agentId],
  );

  if (active.length === 0) {
    throw new Error(`No active deployed prompt for agent_id=${agentId}`);
  }
  if (active.length > 1) {
    throw new Error(`Multiple active prompts for agent_id=${agentId} — fix data before re-running`);
  }

  const { id: oldId, prompt_text: oldText } = active[0];
  const newText = transform(oldText);
  if (newText === oldText) {
    console.log(`[skip] ${agentId}: prompt_text unchanged after transform (already applied?)`);
    return;
  }

  const { rows: maxRow } = await client.query<{ max_v: string }>(
    `SELECT COALESCE(MAX(version), 0)::text AS max_v FROM agent_prompt_versions
     WHERE tenant_id = $1 AND agent_id = $2`,
    [TENANT, agentId],
  );
  const nextVersion = Number(maxRow[0]?.max_v ?? 0) + 1;

  await client.query(`UPDATE agent_prompt_versions SET retired_at = NOW() WHERE id = $1`, [oldId]);

  await client.query(
    `INSERT INTO agent_prompt_versions
      (tenant_id, agent_id, version, prompt_text, change_summary, source, deployed_at)
     VALUES ($1, $2, $3, $4, $5, 'manual', NOW())`,
    [TENANT, agentId, nextVersion, newText, changeSummary],
  );

  console.log(`[ok] ${agentId}: retired previous → deployed v${nextVersion} (${oldText.length} → ${newText.length} chars)`);
}

async function main(): Promise<void> {
  try {
    await systemTransaction(async (client) => {
      await promoteAgentPrompt(
        client,
        'cmo',
        transformCmoPrompt,
        'Brand voice + product framing: AI Marketing Department only; no Fuse/Pulse as external products (CMO prompt)',
      );
      await promoteAgentPrompt(
        client,
        'chief-of-staff',
        transformChiefOfStaffPrompt,
        'Product framing: AI-powered departments / AI Marketing Department; remove Fuse/Pulse as external products (CoS prompt)',
      );
    });
  } finally {
    await closePool().catch(() => {});
  }
}

main().catch((err) => {
  console.error('[promote-cmo-cos-prompt-branding]', (err as Error).message);
  process.exit(1);
});

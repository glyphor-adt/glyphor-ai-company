/**
 * Seeds company_knowledge_base (pulse_mcp_guide) and deploys a new agent_prompt_versions
 * for cmo (retires prior active version).
 *
 * Run (recommended):
 *   npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/seed-pulse-mcp-knowledge.ts
 *
 * Or with DATABASE_URL in env:
 *   npx tsx scripts/seed-pulse-mcp-knowledge.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { CMO_SYSTEM_PROMPT } from '../packages/agents/src/cmo/systemPrompt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ROLES = [
  { id: 'cmo', prompt: CMO_SYSTEM_PROMPT },
] as const;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error('DATABASE_URL is not set. Use run-with-gcp-db-secret.ts or set DATABASE_URL.');
    process.exit(1);
  }

  const kbPath = join(__dirname, 'data', 'pulse_mcp_guide.md');
  const kbContent = readFileSync(kbPath, 'utf8');

  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO company_knowledge_base (
  section, title, layer, audience, owner_agent_id,
  review_cadence, last_verified_at, is_stale, version, content, is_active
) VALUES (
  'pulse_mcp_guide',
  'Pulse MCP — Tool Reference & Workflows',
  3,
  'marketing',
  'cmo',
  'on_change',
  NOW(),
  FALSE,
  1,
  $1,
  TRUE
)
ON CONFLICT (section) DO UPDATE SET
  title = EXCLUDED.title,
  layer = EXCLUDED.layer,
  audience = EXCLUDED.audience,
  owner_agent_id = EXCLUDED.owner_agent_id,
  review_cadence = EXCLUDED.review_cadence,
  last_verified_at = NOW(),
  is_stale = FALSE,
  version = COALESCE(company_knowledge_base.version, 1) + 1,
  content = EXCLUDED.content,
  updated_at = NOW()`,
      [kbContent],
    );
    console.log('company_knowledge_base: upserted section pulse_mcp_guide');

    const retire = await client.query(
      `UPDATE agent_prompt_versions
       SET retired_at = NOW()
       WHERE agent_id = ANY($1::text[])
         AND deployed_at IS NOT NULL
         AND retired_at IS NULL`,
      [['cmo']],
    );
    console.log(`agent_prompt_versions: retired ${retire.rowCount} active row(s)`);

    for (const { id, prompt } of ROLES) {
      const v = await client.query<{ n: string }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS n FROM agent_prompt_versions WHERE agent_id = $1`,
        [id],
      );
      const nextVersion = parseInt(v.rows[0]?.n ?? '1', 10);

      await client.query(
        `INSERT INTO agent_prompt_versions (
  tenant_id, agent_id, version, prompt_text, change_summary, source, deployed_at, retired_at
) VALUES ('system', $1, $2, $3, $4, 'manual', NOW(), NULL)`,
        [
          id,
          nextVersion,
          prompt,
          'Pulse MCP KB (pulse_mcp_guide) + condensed PULSE INTEGRATION system prompt',
        ],
      );
      console.log(`agent_prompt_versions: deployed ${id} version ${nextVersion}`);
    }

    await client.query('COMMIT');
    console.log('Done.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

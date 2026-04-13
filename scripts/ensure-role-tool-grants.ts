/**
 * Ensure role/tool grants are active and unblocked in agent_tool_grants.
 *
 * Usage:
 *   npx tsx scripts/ensure-role-tool-grants.ts <role> <tool1> <tool2> ...
 *   npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/ensure-role-tool-grants.ts vp-design github_create_pull_request github_merge_pull_request
 */
import 'dotenv/config';

import { pool, closePool } from '@glyphor/shared/db';

function failUsage(): never {
  throw new Error('Usage: tsx scripts/ensure-role-tool-grants.ts <role> <tool1> <tool2> ...');
}

async function resolveTenantId(role: string): Promise<string> {
  const fromAgent = await pool.query<{ tenant_id: string }>(
    `SELECT tenant_id::text
       FROM company_agents
      WHERE role = $1
      LIMIT 1`,
    [role],
  );
  if (fromAgent.rows[0]?.tenant_id) return fromAgent.rows[0].tenant_id;

  const fromGrants = await pool.query<{ tenant_id: string }>(
    `SELECT tenant_id::text
       FROM agent_tool_grants
      WHERE agent_role = $1
      LIMIT 1`,
    [role],
  );
  if (fromGrants.rows[0]?.tenant_id) return fromGrants.rows[0].tenant_id;

  // Shared default tenant used by most local/prod rows.
  return '00000000-0000-0000-0000-000000000000';
}

async function main(): Promise<void> {
  const role = String(process.argv[2] ?? '').trim();
  const tools = process.argv.slice(3).map((t) => String(t).trim()).filter(Boolean);
  if (!role || tools.length === 0) failUsage();

  const tenantId = await resolveTenantId(role);
  const updated: string[] = [];

  for (const tool of tools) {
    const updatedResult = await pool.query<{ id: string }>(
      `UPDATE agent_tool_grants
          SET is_active = true,
              is_blocked = false,
              expires_at = NULL,
              reason = 'ops hotfix: enforce active grant',
              granted_by = COALESCE(granted_by, 'system'),
              last_synced_at = NOW(),
              updated_at = NOW()
        WHERE agent_role = $1
          AND tool_name = $2
      RETURNING id::text`,
      [role, tool],
    );

    if (updatedResult.rowCount === 0) {
      await pool.query(
        `INSERT INTO agent_tool_grants (
           tenant_id,
           agent_role,
           tool_name,
           granted_by,
           reason,
           is_active,
           is_blocked,
           expires_at,
           last_synced_at,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, 'system', 'ops hotfix: enforce active grant', true, false, NULL, NOW(), NOW(), NOW())`,
        [tenantId, role, tool],
      );
    }
    updated.push(tool);
  }

  const verify = await pool.query<{ tool_name: string; is_active: boolean; is_blocked: boolean; expires_at: string | null }>(
    `SELECT tool_name, is_active, is_blocked, expires_at
       FROM agent_tool_grants
      WHERE agent_role = $1
        AND tool_name = ANY($2::text[])
      ORDER BY tool_name`,
    [role, updated],
  );

  console.log(
    JSON.stringify(
      {
        role,
        tenant_id: tenantId,
        ensured_tools: updated,
        rows: verify.rows,
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

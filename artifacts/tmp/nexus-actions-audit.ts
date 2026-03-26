import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // 1. Grants by Nexus
  console.log('\n=== Grants by platform-intel ===');
  const grants = await pool.query(
    `SELECT agent_role, tool_name, granted_by, reason, updated_at
       FROM agent_tool_grants
      WHERE granted_by = 'platform-intel'
      ORDER BY updated_at DESC
      LIMIT 10`
  );
  console.log(grants.rows.length ? '' : '(0 rows)');
  if (grants.rows.length) console.table(grants.rows);

  // 2. Tools registered by Nexus
  console.log('\n=== Tools registered by platform-intel ===');
  const tools = await pool.query(
    `SELECT name, created_by, created_at
       FROM tool_registry
      WHERE created_by = 'platform-intel'
      ORDER BY created_at DESC
      LIMIT 10`
  );
  console.log(tools.rows.length ? '' : '(0 rows)');
  if (tools.rows.length) console.table(tools.rows);

  // 3. Resolved tool_gap findings
  console.log('\n=== Resolved tool_gap findings ===');
  const resolved = await pool.query(
    `SELECT id, agent_id, description, resolved_at
       FROM fleet_findings
      WHERE finding_type = 'tool_gap'
        AND resolved_at IS NOT NULL
      ORDER BY resolved_at DESC
      LIMIT 10`
  );
  console.log(resolved.rows.length ? '' : '(0 rows)');
  if (resolved.rows.length) console.table(resolved.rows);

  // Bonus: any unresolved tool_gap findings remaining?
  const unresolved = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM fleet_findings
      WHERE finding_type = 'tool_gap' AND resolved_at IS NULL`
  );
  console.log('\nUnresolved tool_gap findings remaining:', unresolved.rows[0].cnt);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // 1. Delete all pulse_ grants
  const del = await pool.query(
    `DELETE FROM agent_tool_grants WHERE tool_name LIKE 'pulse_%' RETURNING agent_role, tool_name`
  );
  console.log(`Deleted ${del.rowCount} pulse grants`);

  // 2. Resolve any unresolved pulse tool_gap findings
  const resolve = await pool.query(
    `UPDATE fleet_findings
        SET resolved_at = NOW()
      WHERE finding_type = 'tool_gap'
        AND resolved_at IS NULL
        AND description LIKE '%pulse_%'
      RETURNING id, agent_id`
  );
  console.log(`Resolved ${resolve.rowCount} pulse tool_gap findings`);

  // 3. Verify
  const check = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM agent_tool_grants WHERE tool_name LIKE 'pulse_%'`
  );
  console.log('Pulse grants remaining:', check.rows[0].cnt);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

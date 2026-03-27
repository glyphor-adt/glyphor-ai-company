import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Who has pulse_ grants and when were they created/updated?
  const { rows } = await pool.query(
    `SELECT agent_role, tool_name, granted_by, updated_at
       FROM agent_tool_grants
      WHERE tool_name LIKE 'pulse_%'
      ORDER BY updated_at DESC
      LIMIT 20`
  );
  console.table(rows);

  // Count by agent
  const byAgent = await pool.query(
    `SELECT agent_role, COUNT(*)::int AS cnt, MAX(updated_at) AS latest_update
       FROM agent_tool_grants
      WHERE tool_name LIKE 'pulse_%'
      GROUP BY agent_role
      ORDER BY cnt DESC`
  );
  console.log('\nBy agent:');
  console.table(byAgent.rows);

  // Are there unresolved fleet_findings referencing pulse tools?
  const findings = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM fleet_findings
      WHERE finding_type = 'tool_gap'
        AND resolved_at IS NULL
        AND description LIKE '%pulse_%'`
  );
  console.log('\nUnresolved pulse tool_gap findings:', findings.rows[0].cnt);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

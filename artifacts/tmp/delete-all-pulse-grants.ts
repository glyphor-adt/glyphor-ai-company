import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Show what we're about to delete
  const preview = await pool.query(
    `SELECT agent_role, COUNT(*)::int AS cnt
       FROM agent_tool_grants
      WHERE tool_name LIKE 'pulse_%'
      GROUP BY agent_role
      ORDER BY cnt DESC`
  );
  console.log('Pulse grants by agent (about to delete):');
  console.table(preview.rows);

  // Delete all
  const result = await pool.query(
    `DELETE FROM agent_tool_grants
      WHERE tool_name LIKE 'pulse_%'
      RETURNING agent_role, tool_name`
  );
  console.log(`\nDeleted ${result.rowCount} Pulse grants`);

  // Verify
  const check = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM agent_tool_grants WHERE tool_name LIKE 'pulse_%'`
  );
  console.log('Remaining:', check.rows[0].cnt);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

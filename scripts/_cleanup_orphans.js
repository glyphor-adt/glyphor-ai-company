const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://glyphor_system_user:a7JwuQFobpCzZI+JWyPhCSheZFvIt2OA0rjt9FJvtJ4CaagtOM9p72mdTCM5IHzN@127.0.0.1:6543/glyphor'
});

async function main() {
  await c.connect();

  // Delete orphaned autonomy configs
  const r = await c.query(`
    DELETE FROM agent_autonomy_config
    WHERE agent_id NOT IN (
      SELECT role FROM company_agents
      UNION
      SELECT id::text FROM company_agents
    )
    RETURNING agent_id
  `);
  console.log(`Deleted ${r.rowCount} orphaned autonomy configs:`);
  console.log(r.rows.map(r => r.agent_id));

  // Verify remaining
  const remaining = await c.query('SELECT COUNT(*) as cnt FROM agent_autonomy_config');
  console.log(`\nRemaining autonomy configs: ${remaining.rows[0].cnt}`);

  // Show the valid ones
  const valid = await c.query(`
    SELECT aac.agent_id, aac.current_level, aac.max_allowed_level
    FROM agent_autonomy_config aac
    JOIN company_agents ca ON ca.role = aac.agent_id
    ORDER BY aac.agent_id
  `);
  console.table(valid.rows);

  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });

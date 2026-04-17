const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://glyphor_system_user:a7JwuQFobpCzZI+JWyPhCSheZFvIt2OA0rjt9FJvtJ4CaagtOM9p72mdTCM5IHzN@127.0.0.1:6543/glyphor'
});

async function main() {
  await c.connect();

  // Raise max_allowed_level from 1 to 4 for all agents
  const r = await c.query(
    `UPDATE agent_autonomy_config
     SET max_allowed_level = 4, updated_at = NOW()
     WHERE max_allowed_level < 4`
  );
  console.log(`Updated max_allowed_level to 4 for ${r.rowCount} agents`);

  // Verify
  const check = await c.query('SELECT max_allowed_level, COUNT(*) as cnt FROM agent_autonomy_config GROUP BY max_allowed_level');
  console.table(check.rows);

  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });

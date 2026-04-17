const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://glyphor_system_user:a7JwuQFobpCzZI+JWyPhCSheZFvIt2OA0rjt9FJvtJ4CaagtOM9p72mdTCM5IHzN@127.0.0.1:6543/glyphor'
});

async function main() {
  await c.connect();

  // Find orphaned agent_autonomy_config entries (not in company_agents)
  const orphans = await c.query(`
    SELECT aac.agent_id
    FROM agent_autonomy_config aac
    LEFT JOIN company_agents ca ON ca.role = aac.agent_id OR ca.id::text = aac.agent_id
    WHERE ca.id IS NULL
  `);
  console.log('=== ORPHANED AUTONOMY CONFIGS (not in company_agents) ===');
  console.log(orphans.rows.map(r => r.agent_id));

  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });

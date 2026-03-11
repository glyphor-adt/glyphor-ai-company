const { Client } = require('pg');

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://glyphor_system_user:lGHMxoC8zpmngKUaYv9cOTwJ@136.111.200.6:5432/glyphor';

const tables = [
  'agent_runs',
  'agent_reflections',
  'constitutional_evaluations',
  'agent_trust_scores',
  'platform_audit_log',
  'agent_tool_grants',
];

async function run() {
  const c = new Client({ connectionString });
  await c.connect();
  for (const t of tables) {
    const r = await c.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_name = $1
       ORDER BY ordinal_position`,
      [t],
    );
    console.log(`\n# ${t}`);
    for (const row of r.rows) {
      console.log(`${row.column_name} | ${row.data_type}`);
    }
  }
  await c.end();
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

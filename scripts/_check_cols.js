const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://glyphor_system_user:a7JwuQFobpCzZI+JWyPhCSheZFvIt2OA0rjt9FJvtJ4CaagtOM9p72mdTCM5IHzN@127.0.0.1:6543/glyphor'
});

async function main() {
  await c.connect();

  // Check columns
  const tables = ['agent_run_events', 'agent_eval_results', 'task_run_outcomes', 'agent_runs'];
  for (const t of tables) {
    const r = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [t]);
    console.log(`\n${t}:`, r.rows.map(x => x.column_name).join(', '));
  }

  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });

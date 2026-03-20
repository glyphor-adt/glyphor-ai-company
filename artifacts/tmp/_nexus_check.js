const {Client} = require('pg');
(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  const r1 = await c.query("SELECT role, display_name, status, model, department FROM company_agents WHERE role='platform-intel'");
  console.log('AGENT:', JSON.stringify(r1.rows, null, 2));

  const r2 = await c.query("SELECT COUNT(*) as cnt, MAX(created_at) as last_run FROM agent_runs WHERE agent_id='platform-intel'");
  console.log('RUNS:', JSON.stringify(r2.rows, null, 2));

  // Check columns in agent_runs
  const cols = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='agent_runs' ORDER BY ordinal_position");
  console.log('AGENT_RUNS_COLS:', cols.rows.map(r => r.column_name).join(', '));

  // Check recent runs for any agent
  const r4 = await c.query("SELECT agent_id, task, status, created_at FROM agent_runs WHERE created_at > now() - interval '4 hours' ORDER BY created_at DESC LIMIT 10");
  console.log('RECENT_RUNS:', JSON.stringify(r4.rows, null, 2));

  // Check company_agents config fields
  const r5 = await c.query("SELECT role, model, department, thinking_enabled, max_turns, budget_per_run FROM company_agents WHERE role='platform-intel'");
  console.log('AGENT_CONFIG:', JSON.stringify(r5.rows, null, 2));

  await c.end();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

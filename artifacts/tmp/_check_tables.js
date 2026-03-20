const {Client} = require('pg');
(async () => {
  const c = new Client({host:process.env.DB_HOST,port:+process.env.DB_PORT,database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD});
  await c.connect();
  const tables = ['work_assignments','assignment_evaluations','shadow_runs','agent_world_model_corrections','approval_tokens','tool_registry'];
  for (const t of tables) {
    const r = await c.query("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name=$1)", [t]);
    console.log(t + ':', r.rows[0].exists ? 'EXISTS' : 'MISSING');
  }
  // Check if agent_runs has assignment_id column
  const arcols = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='agent_runs' AND column_name='assignment_id'");
  console.log('agent_runs.assignment_id:', arcols.rows.length > 0 ? 'EXISTS' : 'MISSING');
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });

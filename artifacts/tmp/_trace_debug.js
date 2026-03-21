const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 15432, database: 'glyphor', user: 'glyphor_app', password: process.env.DB_PASSWORD });
  await c.connect();
  
  // Check migration ledger for tool_call_traces
  try {
    const r = await c.query("SELECT name, applied_at FROM migration_ledger WHERE name ILIKE '%tool_call_trace%' ORDER BY applied_at");
    console.log('MIGRATION:', JSON.stringify(r.rows));
  } catch(e) { console.log('MIGRATION_CHECK_ERR:', e.message); }
  
  // Check if the table can be inserted into
  try {
    await c.query("BEGIN");
    await c.query(`INSERT INTO tool_call_traces (run_id, agent_id, agent_role, tool_name, args, result_success, turn_number) VALUES ('00000000-0000-0000-0000-000000000000', 'test', 'test', 'test', '{}', true, 0)`);
    await c.query("ROLLBACK");
    console.log('INSERT_TEST: OK');
  } catch(e) { 
    try { await c.query("ROLLBACK"); } catch {}
    console.log('INSERT_TEST_ERR:', e.message); 
  }
  
  // Check most recent run that had tool_calls > 0
  const r2 = await c.query("SELECT id, agent_id, tool_calls, created_at FROM agent_runs WHERE tool_calls > 0 ORDER BY created_at DESC LIMIT 3");
  console.log('RECENT_RUNS_WITH_TOOLS:', JSON.stringify(r2.rows));
  
  await c.end();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

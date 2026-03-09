const { Client } = require('pg');
const c = new Client({ host:'localhost', port:5434, user:'glyphor_app', password:'lGHMxoC8zpmngKUaYv9cOTwJ', database:'glyphor' });

(async () => {
  await c.connect();

  // 1. CMO agent status
  const agent = await c.query(
    "SELECT role, status, model, last_run_at::text, display_name FROM company_agents WHERE role = 'cmo'"
  );
  console.log('=== CMO AGENT STATUS ===');
  console.log(JSON.stringify(agent.rows[0], null, 2));

  // 2. Recent CMO runs (all tasks)
  const runs = await c.query(
    "SELECT id, task, status, error, turns, created_at::text, completed_at::text, cost FROM agent_runs WHERE agent_id = 'cmo' ORDER BY created_at DESC LIMIT 10"
  );
  console.log('\n=== RECENT CMO RUNS ===');
  runs.rows.forEach(r => {
    console.log(`${r.created_at} | ${r.task} | ${r.status} | turns=${r.turns} | cost=$${r.cost} | error=${(r.error || '').slice(0, 120)}`);
  });

  // 3. Recent on_demand (chat) runs specifically
  const chats = await c.query(
    "SELECT id, task, status, error, turns, created_at::text, completed_at::text, model, cost FROM agent_runs WHERE agent_id = 'cmo' AND task = 'on_demand' ORDER BY created_at DESC LIMIT 10"
  );
  console.log('\n=== RECENT CMO CHAT (on_demand) RUNS ===');
  if (chats.rows.length === 0) {
    console.log('No on_demand runs found');
  } else {
    chats.rows.forEach(r => {
      console.log(`${r.created_at} | ${r.status} | model=${r.model} | turns=${r.turns} | cost=$${r.cost}`);
      if (r.error) console.log(`  ERROR: ${r.error.slice(0, 200)}`);
    });
  }

  // 4. Check if there's a currently running CMO run (blocking new ones)
  const running = await c.query(
    "SELECT id, task, status, created_at::text FROM agent_runs WHERE agent_id = 'cmo' AND status = 'running'"
  );
  console.log('\n=== CURRENTLY RUNNING CMO ===');
  console.log(running.rows.length > 0 ? JSON.stringify(running.rows) : 'None');

  // 5. Check recent chat messages TO cmo
  const msgs = await c.query(
    "SELECT id, from_agent, status, created_at::text, content FROM agent_messages WHERE to_agent = 'cmo' AND status = 'pending' ORDER BY created_at DESC LIMIT 5"
  );
  console.log('\n=== PENDING MESSAGES TO CMO ===');
  console.log(msgs.rows.length > 0 ? JSON.stringify(msgs.rows, null, 2) : 'None');

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });

const { Client } = require('pg');
const c = new Client({ host:'localhost', port:5434, user:'glyphor_app', password:'lGHMxoC8zpmngKUaYv9cOTwJ', database:'glyphor' });

(async () => {
  await c.connect();

  // 1. Are other agents also failing on on_demand right now?
  const recent = await c.query(
    `SELECT agent_id, task, status, error, created_at::text 
     FROM agent_runs 
     WHERE task = 'on_demand' AND created_at > NOW() - INTERVAL '6 hours'
     ORDER BY created_at DESC LIMIT 20`
  );
  console.log('=== ALL RECENT on_demand RUNS (last 6h) ===');
  recent.rows.forEach(r => {
    console.log(`${r.created_at} | ${r.agent_id} | ${r.status} | ${(r.error || '').slice(0, 100)}`);
  });

  // 2. Are non-CMO agents completing successfully?
  const successes = await c.query(
    `SELECT agent_id, task, status, created_at::text 
     FROM agent_runs 
     WHERE status = 'completed' AND created_at > NOW() - INTERVAL '3 hours'
     ORDER BY created_at DESC LIMIT 15`
  );
  console.log('\n=== RECENT SUCCESSFUL RUNS (last 3h) ===');
  successes.rows.forEach(r => {
    console.log(`${r.created_at} | ${r.agent_id} | ${r.task}`);
  });

  // 3. CMO-specific: check if DB has a model override
  const override = await c.query(
    "SELECT role, display_name, model, status FROM company_agents WHERE role = 'cmo'"
  );
  console.log('\n=== CMO DB MODEL OVERRIDE ===');
  console.log(JSON.stringify(override.rows[0]));

  // 4. Check all recent failures with gpt-5-mini in error msg
  const gptFails = await c.query(
    `SELECT agent_id, task, status, error, created_at::text 
     FROM agent_runs 
     WHERE error LIKE '%gpt-5-mini%' AND created_at > NOW() - INTERVAL '6 hours'
     ORDER BY created_at DESC LIMIT 15`
  );
  console.log('\n=== ALL gpt-5-mini FAILURES (last 6h) ===');
  gptFails.rows.forEach(r => {
    console.log(`${r.created_at} | ${r.agent_id} | ${r.task} | ${r.error.slice(0, 120)}`);
  });

  // 5. Check all recent failures with gemini in error msg
  const geminiFails = await c.query(
    `SELECT agent_id, task, status, error, created_at::text 
     FROM agent_runs 
     WHERE error LIKE '%gemini%' AND created_at > NOW() - INTERVAL '6 hours'
     ORDER BY created_at DESC LIMIT 15`
  );
  console.log('\n=== ALL gemini FAILURES (last 6h) ===');
  if (geminiFails.rows.length === 0) console.log('None');
  else geminiFails.rows.forEach(r => {
    console.log(`${r.created_at} | ${r.agent_id} | ${r.task} | ${r.error.slice(0, 120)}`);
  });

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });

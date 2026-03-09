const { Client } = require('pg');
const c = new Client({ host:'localhost', port:5434, user:'glyphor_app', password:'lGHMxoC8zpmngKUaYv9cOTwJ', database:'glyphor' });

(async () => {
  await c.connect();

  // Check if there are chat sessions / conversation threads for CMO
  // Look for tables that might store chat history
  const tables = await c.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%chat%' OR table_name LIKE '%conversation%' OR table_name LIKE '%session%' ORDER BY table_name"
  );
  console.log('=== CHAT-RELATED TABLES ===');
  tables.rows.forEach(r => console.log(r.table_name));

  // Check if there's an agent_conversations or similar table
  const tables2 = await c.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (table_name LIKE '%thread%' OR table_name LIKE '%message%' OR table_name LIKE '%history%') ORDER BY table_name"
  );
  console.log('\n=== MESSAGE/HISTORY TABLES ===');
  tables2.rows.forEach(r => console.log(r.table_name));

  // Check for on_demand run details - look at the last SUCCESSFUL CMO chat vs recent failures
  // Get the output/result of last successful CMO on_demand
  const lastSuccess = await c.query(
    `SELECT id, task, status, turns, cost, created_at::text, error 
     FROM agent_runs 
     WHERE agent_id = 'cmo' AND task = 'on_demand' AND status = 'completed'
     ORDER BY created_at DESC LIMIT 3`
  );
  console.log('\n=== LAST SUCCESSFUL CMO CHATS ===');
  lastSuccess.rows.forEach(r => {
    console.log(`${r.created_at} | turns=${r.turns} | cost=$${r.cost}`);
  });

  // Compare with chief-of-staff successes to spot differences
  const cosSuccess = await c.query(
    `SELECT id, task, status, turns, cost, created_at::text
     FROM agent_runs 
     WHERE agent_id = 'chief-of-staff' AND task = 'on_demand' AND status = 'completed'
     ORDER BY created_at DESC LIMIT 3`
  );
  console.log('\n=== LAST SUCCESSFUL COS CHATS (for comparison) ===');
  cosSuccess.rows.forEach(r => {
    console.log(`${r.created_at} | turns=${r.turns} | cost=$${r.cost}`);
  });

  // Check the agent_runs columns to find what data we have
  const cols = await c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'agent_runs' ORDER BY ordinal_position"
  );
  console.log('\n=== agent_runs COLUMNS ===');
  cols.rows.forEach(r => console.log(r.column_name));

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });

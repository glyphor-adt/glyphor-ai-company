const { Client } = require('pg');
const c = new Client({ host:'localhost', port:5434, user:'glyphor_app', password:'lGHMxoC8zpmngKUaYv9cOTwJ', database:'glyphor' });

(async () => {
  await c.connect();

  // 1. Last 10 CMO chat messages - actual content
  const msgs = await c.query(
    "SELECT role, content, created_at::text FROM chat_messages WHERE agent_role = 'cmo' ORDER BY created_at DESC LIMIT 10"
  );
  console.log('=== RECENT CMO CHAT MESSAGES (content) ===');
  msgs.rows.forEach(r => {
    console.log(`${r.created_at} | ${r.role} | "${r.content.slice(0, 200)}"`);
  });

  // 2. Most recent failed CMO on_demand runs - input/output
  const runs = await c.query(
    `SELECT input, output, error, input_tokens, output_tokens, created_at::text
     FROM agent_runs 
     WHERE agent_id = 'cmo' AND task = 'on_demand' 
     ORDER BY created_at DESC LIMIT 4`
  );
  console.log('\n=== CMO on_demand RUN DETAILS ===');
  runs.rows.forEach(r => {
    console.log(`\n--- ${r.created_at} ---`);
    console.log(`Tokens: in=${r.input_tokens} out=${r.output_tokens}`);
    console.log(`Error: ${r.error || 'none'}`);
    console.log(`Input (200 chars): ${(r.input || '').slice(0, 200)}`);
    console.log(`Output (200 chars): ${(r.output || '').slice(0, 200)}`);
  });

  // 3. Check for agent_locks table
  try {
    const locks = await c.query(
      "SELECT * FROM agent_locks WHERE agent_id = 'cmo' AND released_at IS NULL LIMIT 5"
    );
    console.log('\n=== ACTIVE CMO LOCKS ===');
    console.log(locks.rows.length > 0 ? JSON.stringify(locks.rows) : 'None');
  } catch {
    console.log('\nNo agent_locks table');
  }

  // 4. Check if there's a running CMO run right now
  const running = await c.query(
    "SELECT id, task, created_at::text FROM agent_runs WHERE agent_id = 'cmo' AND status = 'running'"
  );
  console.log('\n=== CURRENTLY RUNNING CMO ===');
  console.log(running.rows.length > 0 ? JSON.stringify(running.rows) : 'None');

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });

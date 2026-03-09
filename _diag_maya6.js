const { Client } = require('pg');
const c = new Client({ host:'localhost', port:5434, user:'glyphor_app', password:'lGHMxoC8zpmngKUaYv9cOTwJ', database:'glyphor' });

(async () => {
  await c.connect();

  // 1. Last 10 CMO chat messages - actual content
  const msgs = await c.query(
    "SELECT role, content, created_at::text, error FROM chat_messages WHERE agent_role = 'cmo' ORDER BY created_at DESC LIMIT 10"
  );
  console.log('=== RECENT CMO CHAT MESSAGES (content) ===');
  msgs.rows.forEach(r => {
    const err = r.error ? ` [ERR: ${r.error.slice(0, 80)}]` : '';
    console.log(`${r.created_at} | ${r.role} | "${r.content.slice(0, 200)}"${err}`);
  });

  // 2. Check the failed CMO run at 21:07 - what input was sent
  const run = await c.query(
    `SELECT input, output, error, input_tokens, output_tokens
     FROM agent_runs 
     WHERE agent_id = 'cmo' AND task = 'on_demand' 
     ORDER BY created_at DESC LIMIT 1`
  );
  console.log('\n=== MOST RECENT CMO on_demand RUN INPUT/OUTPUT ===');
  const r = run.rows[0];
  console.log('Input tokens:', r.input_tokens, 'Output tokens:', r.output_tokens);
  console.log('Error:', r.error);
  console.log('Input (first 300 chars):', (r.input || '').slice(0, 300));
  console.log('Output (first 300 chars):', (r.output || '').slice(0, 300));

  // 3. Check for agent errors column in chat_messages
  const errMsgs = await c.query(
    `SELECT column_name FROM information_schema.columns 
     WHERE table_name = 'chat_messages' AND column_name = 'error'`
  );
  console.log('\n=== chat_messages has error column:', errMsgs.rows.length > 0 ? 'yes' : 'no');

  // 4. Check if CMO has any active locks or concurrency issues
  const locks = await c.query(
    "SELECT agent_id, lock_type, acquired_at::text FROM agent_locks WHERE agent_id = 'cmo' AND released_at IS NULL"
  );
  if (locks.rows.length > 0) {
    console.log('\n=== ACTIVE CMO LOCKS ===');
    locks.rows.forEach(r => console.log(JSON.stringify(r)));
  } else {
    console.log('\nNo active CMO locks');
  }

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });

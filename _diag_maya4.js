const { Client } = require('pg');
const c = new Client({ host:'localhost', port:5434, user:'glyphor_app', password:'lGHMxoC8zpmngKUaYv9cOTwJ', database:'glyphor' });

(async () => {
  await c.connect();

  // Check chat_messages table for CMO conversation size
  const chatMsgCols = await c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'chat_messages' ORDER BY ordinal_position"
  );
  console.log('=== chat_messages COLUMNS ===');
  chatMsgCols.rows.forEach(r => console.log(r.column_name));

  // Count messages per agent in chat_messages
  const counts = await c.query(
    "SELECT agent_id, COUNT(*) as msg_count, MAX(created_at)::text as last_msg FROM chat_messages GROUP BY agent_id ORDER BY msg_count DESC LIMIT 15"
  );
  console.log('\n=== CHAT MESSAGE COUNTS BY AGENT ===');
  counts.rows.forEach(r => {
    console.log(`${r.agent_id}: ${r.msg_count} messages (last: ${r.last_msg})`);
  });

  // Check CMO chat messages - how much context is accumulating
  const cmoMsgs = await c.query(
    "SELECT id, role, LENGTH(content) as content_len, created_at::text FROM chat_messages WHERE agent_id = 'cmo' ORDER BY created_at DESC LIMIT 20"
  );
  console.log('\n=== RECENT CMO CHAT MESSAGES (content sizes) ===');
  let totalLen = 0;
  cmoMsgs.rows.forEach(r => {
    totalLen += r.content_len;
    console.log(`${r.created_at} | ${r.role} | ${r.content_len} chars`);
  });
  console.log(`Total accumulated chars: ${totalLen}`);

  // Check the total CMO conversation size
  const totalCmo = await c.query(
    "SELECT COUNT(*) as count, SUM(LENGTH(content)) as total_chars FROM chat_messages WHERE agent_id = 'cmo'"
  );
  console.log('\n=== CMO TOTAL CONVERSATION SIZE ===');
  console.log(`Messages: ${totalCmo.rows[0].count}, Total chars: ${totalCmo.rows[0].total_chars}`);

  // Compare with chief-of-staff
  const totalCos = await c.query(
    "SELECT COUNT(*) as count, SUM(LENGTH(content)) as total_chars FROM chat_messages WHERE agent_id = 'chief-of-staff'"
  );
  console.log('\n=== COS TOTAL CONVERSATION SIZE (for comparison) ===');
  console.log(`Messages: ${totalCos.rows[0].count}, Total chars: ${totalCos.rows[0].total_chars}`);

  // Check if there's a session_id or thread concept
  const sessionCheck = await c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'chat_messages' AND column_name LIKE '%session%' OR column_name LIKE '%thread%'"
  );
  console.log('\n=== SESSION/THREAD COLUMNS ===');
  sessionCheck.rows.forEach(r => console.log(r.column_name));

  // Check recent CMO inputs/errors from agent_runs for the failed on_demands
  const failDetails = await c.query(
    `SELECT id, input_tokens, output_tokens, error, created_at::text, LENGTH(input::text) as input_len
     FROM agent_runs 
     WHERE agent_id = 'cmo' AND task = 'on_demand' 
     ORDER BY created_at DESC LIMIT 6`
  );
  console.log('\n=== CMO on_demand RUN DETAILS ===');
  failDetails.rows.forEach(r => {
    console.log(`${r.created_at} | in_tokens=${r.input_tokens} | out_tokens=${r.output_tokens} | input_len=${r.input_len} | error=${(r.error || '').slice(0, 100)}`);
  });

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });

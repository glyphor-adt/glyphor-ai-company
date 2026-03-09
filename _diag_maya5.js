const { Client } = require('pg');
const c = new Client({ host:'localhost', port:5434, user:'glyphor_app', password:'lGHMxoC8zpmngKUaYv9cOTwJ', database:'glyphor' });

(async () => {
  await c.connect();

  // Count messages per agent
  const counts = await c.query(
    "SELECT agent_role, COUNT(*) as msg_count, MAX(created_at)::text as last_msg FROM chat_messages GROUP BY agent_role ORDER BY msg_count DESC LIMIT 15"
  );
  console.log('=== CHAT MESSAGE COUNTS BY AGENT ===');
  counts.rows.forEach(r => {
    console.log(`${r.agent_role}: ${r.msg_count} messages (last: ${r.last_msg})`);
  });

  // CMO total conversation size
  const totalCmo = await c.query(
    "SELECT COUNT(*) as count, SUM(LENGTH(content)) as total_chars FROM chat_messages WHERE agent_role = 'cmo'"
  );
  console.log('\n=== CMO TOTAL CONVERSATION SIZE ===');
  console.log(`Messages: ${totalCmo.rows[0].count}, Total chars: ${totalCmo.rows[0].total_chars}`);

  // COS total for comparison
  const totalCos = await c.query(
    "SELECT COUNT(*) as count, SUM(LENGTH(content)) as total_chars FROM chat_messages WHERE agent_role = 'chief-of-staff'"
  );
  console.log('\n=== COS TOTAL CONVERSATION SIZE ===');
  console.log(`Messages: ${totalCos.rows[0].count}, Total chars: ${totalCos.rows[0].total_chars}`);

  // CMO recent messages (content sizes)
  const cmoMsgs = await c.query(
    "SELECT role, LENGTH(content) as content_len, created_at::text, conversation_id, session_id FROM chat_messages WHERE agent_role = 'cmo' ORDER BY created_at DESC LIMIT 20"
  );
  console.log('\n=== RECENT CMO CHAT MESSAGES ===');
  cmoMsgs.rows.forEach(r => {
    console.log(`${r.created_at} | ${r.role} | ${r.content_len} chars | conv=${(r.conversation_id || '').slice(0,8)} | sess=${(r.session_id || '').slice(0,8)}`);
  });

  // Check how many conversations/sessions CMO has
  const convos = await c.query(
    "SELECT conversation_id, COUNT(*) as msg_count, SUM(LENGTH(content)) as total_chars FROM chat_messages WHERE agent_role = 'cmo' GROUP BY conversation_id ORDER BY msg_count DESC LIMIT 10"
  );
  console.log('\n=== CMO CONVERSATIONS ===');
  convos.rows.forEach(r => {
    console.log(`conv=${(r.conversation_id || 'null').slice(0,12)} | ${r.msg_count} msgs | ${r.total_chars} chars`);
  });

  // CMO failed on_demand details
  const failDetails = await c.query(
    `SELECT input_tokens, output_tokens, error, created_at::text
     FROM agent_runs 
     WHERE agent_id = 'cmo' AND task = 'on_demand' 
     ORDER BY created_at DESC LIMIT 8`
  );
  console.log('\n=== CMO on_demand RUN TOKEN DETAILS ===');
  failDetails.rows.forEach(r => {
    console.log(`${r.created_at} | in=${r.input_tokens} out=${r.output_tokens} | ${(r.error || 'OK').slice(0, 100)}`);
  });

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });

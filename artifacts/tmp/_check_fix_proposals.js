const {Client} = require('pg');
(async () => {
  const c = new Client({host:process.env.DB_HOST,port:+process.env.DB_PORT,database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD});
  await c.connect();

  // Check tool_fix_proposals column types
  const cols = await c.query(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='tool_fix_proposals' ORDER BY ordinal_position"
  );
  console.log('=== tool_fix_proposals schema ===');
  cols.rows.forEach(r => console.log('  ' + r.column_name + ': ' + r.data_type + (r.is_nullable === 'YES' ? ' (nullable)' : '')));

  // Check existing fix proposals from Nexus
  const proposals = await c.query("SELECT id, tool_name, severity, status, substring(root_cause from 1 for 200) as rc, created_at FROM tool_fix_proposals ORDER BY created_at DESC LIMIT 10");
  console.log('\n=== Existing fix proposals ===');
  proposals.rows.forEach(r => console.log(JSON.stringify(r)));

  // Try an insert to see what fails
  try {
    await c.query('BEGIN');
    await c.query(
      "INSERT INTO tool_fix_proposals (tool_name, severity, root_cause, affected_agents, current_behavior, expected_behavior, fix_description, blocking_gtm, proposed_by, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'test', 'pending')",
      ['test_tool', 'P2', 'test root cause', ['platform-intel'], 'broken', 'fixed', 'change X to Y', false]
    );
    await c.query('ROLLBACK');
    console.log('\nINSERT: OK (rolled back)');
  } catch(e) {
    await c.query('ROLLBACK');
    console.log('\nINSERT FAILED:', e.message);
  }

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });

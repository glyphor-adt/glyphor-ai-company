const { Client } = require('pg');
const c = new Client({
  host: '127.0.0.1',
  port: 5434,
  user: 'glyphor_app',
  password: 'lGHMxoC8zpmngKUaYv9cOTwJ',
  database: 'glyphor',
});

(async () => {
  await c.connect();

  // Recent stripe_data
  const sc = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='stripe_data' ORDER BY ordinal_position");
  console.log('stripe_data columns:', sc.rows.map(x => x.column_name).join(', '));
  
  const sr = await c.query("SELECT * FROM stripe_data ORDER BY id DESC LIMIT 3");
  console.log('\n=== RECENT STRIPE DATA ===');
  for (const row of sr.rows) {
    console.log(JSON.stringify(row).substring(0, 500));
  }

  // data_sync_status columns
  const dsc = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='data_sync_status' ORDER BY ordinal_position");
  console.log('\ndata_sync_status columns:', dsc.rows.map(x => x.column_name).join(', '));
  
  const ds = await c.query("SELECT * FROM data_sync_status LIMIT 10");
  console.log('\n=== DATA SYNC STATUS ===');
  for (const row of ds.rows) {
    console.log(JSON.stringify(row).substring(0, 500));
  }

  // All initiatives - latest 15
  const all = await c.query("SELECT title, status, priority, owner_role, created_at FROM initiatives ORDER BY created_at DESC LIMIT 15");
  console.log('\n=== ALL RECENT INITIATIVES ===');
  for (const row of all.rows) {
    console.log(`[${row.status}/${row.priority}] ${row.title} (owner: ${row.owner_role}, ${new Date(row.created_at).toISOString().slice(0,10)})`);
  }

  // All decisions - latest 15
  const dc = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='decisions' ORDER BY ordinal_position");
  console.log('\ndecisions columns:', dc.rows.map(x => x.column_name).join(', '));
  
  const ad = await c.query("SELECT title, status, tier, created_at FROM decisions ORDER BY created_at DESC LIMIT 15");
  console.log('\n=== ALL RECENT DECISIONS ===');
  for (const row of ad.rows) {
    console.log(`[${row.status}/${row.tier}] ${row.title} (${new Date(row.created_at).toISOString().slice(0,10)})`);
  }

  // Agent briefs - check schema and recent
  const bc = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='agent_briefs' ORDER BY ordinal_position");
  console.log('\nagent_briefs columns:', bc.rows.map(x => x.column_name).join(', '));
  
  const ab = await c.query("SELECT * FROM agent_briefs ORDER BY id DESC LIMIT 5");
  console.log('\n=== RECENT AGENT BRIEFS ===');
  for (const row of ab.rows) {
    console.log(JSON.stringify(row).substring(0, 500));
  }

  // Count of all rejected decisions
  const rejCount = await c.query("SELECT COUNT(*) as cnt FROM decisions WHERE status='rejected'");
  const totCount = await c.query("SELECT COUNT(*) as cnt FROM decisions");
  console.log(`\nDecisions: ${rejCount.rows[0].cnt} rejected out of ${totCount.rows[0].cnt} total`);

  // Count initiatives by status
  const istat = await c.query("SELECT status, COUNT(*) FROM initiatives GROUP BY status");
  console.log('\nInitiatives by status:', istat.rows);

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });

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

  // Check initiatives schema
  const cols = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='initiatives' ORDER BY ordinal_position");
  console.log('initiatives columns:', cols.rows.map(x => x.column_name).join(', '));

  // Check initiatives for telemetry/financial
  const inits = await c.query("SELECT id, title, status, priority, description, created_at FROM initiatives WHERE title ILIKE '%telemetry%' OR title ILIKE '%financial%' OR title ILIKE '%runway%' OR title ILIKE '%blackout%' ORDER BY created_at DESC LIMIT 10");
  console.log('\n=== MATCHING INITIATIVES ===');
  for (const row of inits.rows) {
    console.log(`[${row.status}/${row.priority}] ${row.title}`);
    console.log(`  created: ${row.created_at}`);
    console.log(`  desc: ${(row.description || '').substring(0, 400)}`);
    console.log();
  }

  // Check directives for telemetry/financial
  const dirs = await c.query("SELECT id, title, status, created_by, priority, created_at FROM founder_directives WHERE title ILIKE '%telemetry%' OR title ILIKE '%financial%' OR title ILIKE '%runway%' OR title ILIKE '%blackout%' ORDER BY created_at DESC LIMIT 10");
  console.log('\n=== MATCHING DIRECTIVES ===');
  for (const row of dirs.rows) {
    console.log(`[${row.status}/${row.priority}] ${row.title} (by ${row.created_by}, ${row.created_at})`);
  }

  // Recent decisions about finance
  const decs = await c.query("SELECT id, title, tier, status, summary, created_at FROM decisions WHERE title ILIKE '%telemetry%' OR title ILIKE '%financial%' OR title ILIKE '%runway%' OR title ILIKE '%stripe%' OR summary ILIKE '%telemetry%' OR summary ILIKE '%blackout%' ORDER BY created_at DESC LIMIT 10");
  console.log('\n=== MATCHING DECISIONS ===');
  for (const row of decs.rows) {
    console.log(`[${row.status}/${row.tier}] ${row.title} (${row.created_at})`);
    console.log(`  ${(row.summary || '').substring(0, 250)}`);
    console.log();
  }

  // Check stripe_data - what does it actually contain?
  const stripeRecent = await c.query("SELECT * FROM stripe_data ORDER BY created_at DESC LIMIT 3");
  console.log('\n=== RECENT STRIPE DATA ===');
  console.log(JSON.stringify(stripeRecent.rows, null, 2));

  // Check if there's MRR data
  const mrr = await c.query("SELECT metric, value, date FROM financials WHERE metric ILIKE '%mrr%' ORDER BY date DESC LIMIT 5");
  console.log('\n=== MRR DATA ===');
  for (const row of mrr.rows) {
    console.log(`${row.date}: ${row.metric} = ${row.value}`);
  }

  // Check data_sync_status if it tracks Stripe/PostHog sync
  const sync = await c.query("SELECT * FROM data_sync_status ORDER BY last_sync_at DESC LIMIT 10");
  console.log('\n=== DATA SYNC STATUS ===');
  for (const row of sync.rows) {
    console.log(JSON.stringify(row));
  }

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });

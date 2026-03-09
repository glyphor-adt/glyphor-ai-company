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

  // Check financials table
  const fin = await c.query("SELECT COUNT(*) as total FROM financials");
  console.log('financials rows:', fin.rows[0].total);
  if (parseInt(fin.rows[0].total) > 0) {
    const finRecent = await c.query("SELECT * FROM financials ORDER BY created_at DESC LIMIT 3");
    console.log('Recent financials:', JSON.stringify(finRecent.rows, null, 2));
  }

  // Check stripe_data
  const stripe = await c.query("SELECT COUNT(*) as total FROM stripe_data");
  console.log('\nstripe_data rows:', stripe.rows[0].total);

  // Check gcp_billing
  const gcp = await c.query("SELECT COUNT(*) as total FROM gcp_billing");
  console.log('gcp_billing rows:', gcp.rows[0].total);

  // Check cost_metrics
  const costs = await c.query("SELECT COUNT(*) as total FROM cost_metrics");
  console.log('cost_metrics rows:', costs.rows[0].total);

  // Check initiatives for telemetry/financial
  const inits = await c.query("SELECT id, title, status, priority, owner, description, created_at FROM initiatives WHERE title ILIKE '%telemetry%' OR title ILIKE '%financial%' OR title ILIKE '%runway%' OR title ILIKE '%blackout%' ORDER BY created_at DESC LIMIT 10");
  console.log('\n=== MATCHING INITIATIVES ===');
  for (const row of inits.rows) {
    console.log(`[${row.status}/${row.priority}] ${row.title}`);
    console.log(`  owner: ${row.owner}, created: ${row.created_at}`);
    console.log(`  desc: ${(row.description || '').substring(0, 300)}`);
  }

  // Check directives for telemetry/financial
  const dirs = await c.query("SELECT id, title, status, created_by, priority, created_at FROM founder_directives WHERE title ILIKE '%telemetry%' OR title ILIKE '%financial%' OR title ILIKE '%runway%' OR title ILIKE '%blackout%' ORDER BY created_at DESC LIMIT 10");
  console.log('\n=== MATCHING DIRECTIVES ===');
  for (const row of dirs.rows) {
    console.log(`[${row.status}/${row.priority}] ${row.title} (by ${row.created_by}, ${row.created_at})`);
  }

  // Recent decisions about finance
  const decs = await c.query("SELECT id, title, tier, status, summary, created_at FROM decisions WHERE title ILIKE '%telemetry%' OR title ILIKE '%financial%' OR title ILIKE '%runway%' OR title ILIKE '%stripe%' OR summary ILIKE '%telemetry%' ORDER BY created_at DESC LIMIT 10");
  console.log('\n=== MATCHING DECISIONS ===');
  for (const row of decs.rows) {
    console.log(`[${row.status}/${row.tier}] ${row.title}`);
    console.log(`  ${(row.summary || '').substring(0, 200)}`);
  }

  // Check recent agent_briefs for mentions of telemetry blackout or runway
  const briefs = await c.query("SELECT agent_role, brief_type, created_at, LEFT(content, 300) as preview FROM agent_briefs WHERE content ILIKE '%blackout%' OR content ILIKE '%runway%' OR content ILIKE '%10-day%' ORDER BY created_at DESC LIMIT 5");
  console.log('\n=== BRIEFS MENTIONING BLACKOUT/RUNWAY ===');
  for (const row of briefs.rows) {
    console.log(`[${row.created_at}] ${row.agent_role} (${row.brief_type})`);
    console.log(`  ${row.preview}`);
  }

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });

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

  // List all tables
  const tables = await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  console.log('=== ALL TABLES ===');
  console.log(tables.rows.map(x => x.tablename).join('\n'));

  // Check company_memory for finance-related keys
  const mem = await c.query("SELECT key, updated_at FROM company_memory WHERE key ILIKE '%finance%' OR key ILIKE '%cost%' OR key ILIKE '%stripe%' OR key ILIKE '%runway%' OR key ILIKE '%burn%' OR key ILIKE '%telemetry%' OR key ILIKE '%blackout%' ORDER BY updated_at DESC LIMIT 20");
  console.log('\n=== FINANCE-RELATED MEMORY KEYS ===');
  for (const row of mem.rows) {
    console.log(`${row.key} (updated: ${row.updated_at})`);
  }

  // Check recent activity_log for cfo or chief-of-staff mentioning finance
  const activity = await c.query("SELECT agent_role, action_type, summary, created_at FROM activity_log WHERE (agent_role IN ('cfo','chief-of-staff') AND created_at > NOW() - INTERVAL '7 days') ORDER BY created_at DESC LIMIT 20");
  console.log('\n=== RECENT CFO/CoS ACTIVITY (7d) ===');
  for (const row of activity.rows) {
    console.log(`[${row.created_at}] ${row.agent_role} | ${row.action_type} | ${(row.summary || '').substring(0, 150)}`);
  }

  // Check founder_directives for anything about telemetry or financial
  const dirs = await c.query("SELECT id, title, status, created_by, created_at FROM founder_directives WHERE title ILIKE '%telemetry%' OR title ILIKE '%financial%' OR title ILIKE '%runway%' OR title ILIKE '%stripe%' ORDER BY created_at DESC LIMIT 10");
  console.log('\n=== TELEMETRY/FINANCIAL DIRECTIVES ===');
  for (const row of dirs.rows) {
    console.log(`[${row.status}] ${row.title} (by ${row.created_by}, ${row.created_at})`);
  }

  // Check initiatives table if it exists
  const hasInitiatives = tables.rows.some(x => x.tablename === 'initiatives');
  if (hasInitiatives) {
    const inits = await c.query("SELECT id, title, status, priority, created_at FROM initiatives WHERE title ILIKE '%telemetry%' OR title ILIKE '%financial%' OR title ILIKE '%runway%' ORDER BY created_at DESC LIMIT 10");
    console.log('\n=== MATCHING INITIATIVES ===');
    for (const row of inits.rows) {
      console.log(`[${row.status}/${row.priority}] ${row.title} (${row.created_at})`);
    }
  }

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });

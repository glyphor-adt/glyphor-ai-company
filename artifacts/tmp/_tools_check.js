const { Client } = require('pg');

(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // GCP tools in risk registry
  console.log('=== GCP/SECRET TOOLS IN RISK REGISTRY ===');
  const r = await c.query(`
    SELECT tool_name, risk_tier, requires_approval
    FROM agent_tool_risk 
    WHERE tool_name ILIKE '%gcp%' OR tool_name ILIKE '%secret%' OR tool_name ILIKE '%cloud%'
    ORDER BY tool_name
  `);
  console.log(JSON.stringify(r.rows, null, 2));

  // PE grants
  console.log('\n=== PLATFORM-ENGINEER GRANTS ===');
  const g = await c.query(`
    SELECT tool_name, granted_by, is_active, is_blocked, expires_at, created_at
    FROM agent_tool_grants 
    WHERE agent_role = 'platform-engineer'
    ORDER BY created_at DESC LIMIT 15
  `);
  console.log(JSON.stringify(g.rows, null, 2));

  // Search for gcp_list_secrets or similar read-only GCP tools
  console.log('\n=== ALL GCP TOOLS IN RISK REGISTRY ===');
  const all = await c.query(`
    SELECT tool_name, risk_tier, requires_approval
    FROM agent_tool_risk
    WHERE tool_name ILIKE '%gcp%'
    ORDER BY tool_name
  `);
  console.log(JSON.stringify(all.rows, null, 2));

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });

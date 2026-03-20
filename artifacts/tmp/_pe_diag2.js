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

  // 1. The gcp_create_secret decision detail 
  console.log('=== GCP_CREATE_SECRET DECISION DETAIL ===');
  const dec = await c.query(`
    SELECT id, title, tier, status, proposed_by,
           summary, reasoning,
           substring(data::text from 1 for 1000) as data_raw,
           created_at
    FROM decisions 
    WHERE title ILIKE '%gcp_create_secret%' OR title ILIKE '%STRIPE%'
    ORDER BY created_at DESC LIMIT 3
  `);
  console.log(JSON.stringify(dec.rows, null, 2));

  // 2. Tool grants columns
  console.log('\n=== TOOL_GRANTS COLUMNS ===');
  const gc = await c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='agent_tool_grants' ORDER BY ordinal_position"
  );
  console.log(gc.rows.map(r => r.column_name));

  // 3. Platform-engineer tool grants
  console.log('\n=== PLATFORM-ENGINEER TOOL GRANTS ===');
  const grants = await c.query(`
    SELECT * FROM agent_tool_grants
    WHERE agent_id = 'platform-engineer'
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log(JSON.stringify(grants.rows, null, 2));

  // 4. What tools does the platform-engineer have for listing/checking secrets?
  // Check agent_tool_risk for gcp-related tools
  console.log('\n=== GCP TOOL RISK ENTRIES ===');
  const risk = await c.query(`
    SELECT tool_name, risk_tier, requires_approval
    FROM agent_tool_risk 
    WHERE tool_name ILIKE '%gcp%' OR tool_name ILIKE '%secret%' OR tool_name ILIKE '%cloud%'
    ORDER BY tool_name
  `);
  console.log(JSON.stringify(risk.rows, null, 2));

  // 5. All pending decisions count and breakdown  
  console.log('\n=== ALL PENDING DECISIONS SUMMARY ===');
  const pending = await c.query(`
    SELECT count(*) as total,
           count(*) FILTER (WHERE tier = 'red') as red,
           count(*) FILTER (WHERE tier = 'yellow') as yellow,
           count(*) FILTER (WHERE tier = 'green') as green
    FROM decisions WHERE status = 'pending'
  `);
  console.log(JSON.stringify(pending.rows[0]));

  // 6. Platform-engineer run that proposed the secret creation
  console.log('\n=== PE RUN THAT PROPOSED SECRET (around 05:20 UTC) ===');
  const peRun = await c.query(`
    SELECT id, status, tool_calls, 
           substring(output from 1 for 2000) as out,
           created_at
    FROM agent_runs 
    WHERE agent_id = 'platform-engineer' 
      AND created_at BETWEEN '2026-03-20T04:00:00Z' AND '2026-03-20T06:00:00Z'
    ORDER BY created_at DESC LIMIT 3
  `);
  console.log(JSON.stringify(peRun.rows, null, 2));

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });

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

  // Columns
  console.log('=== AGENT_TOOL_RISK COLUMNS ===');
  const cols = await c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='agent_tool_risk' ORDER BY ordinal_position"
  );
  console.log(cols.rows.map(r => r.column_name));

  // Sample
  console.log('\n=== SAMPLE TOOL_RISK ===');
  const s = await c.query("SELECT * FROM agent_tool_risk LIMIT 3");
  console.log(JSON.stringify(s.rows, null, 2));

  // GCP tools
  console.log('\n=== GCP TOOLS ===');
  const g = await c.query("SELECT * FROM agent_tool_risk WHERE tool_name ILIKE '%gcp%' ORDER BY tool_name");
  console.log(JSON.stringify(g.rows, null, 2));

  // PE grants
  console.log('\n=== PE GRANTS ===');
  const gr = await c.query(`
    SELECT tool_name, granted_by, is_active, is_blocked, expires_at, created_at
    FROM agent_tool_grants 
    WHERE agent_role = 'platform-engineer'
    ORDER BY created_at DESC LIMIT 15
  `);
  console.log(JSON.stringify(gr.rows, null, 2));

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });

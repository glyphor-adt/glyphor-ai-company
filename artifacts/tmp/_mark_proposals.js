const {Client} = require('pg');
(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();
  
  // Find pending proposals
  const r = await c.query(
    "SELECT id, tool_name, severity, status, substring(fix_description from 1 for 120) as fix FROM tool_fix_proposals WHERE tool_name = 'get_ai_model_costs' ORDER BY created_at DESC LIMIT 5"
  );
  console.log('Found proposals:', JSON.stringify(r.rows, null, 2));
  
  // Mark them as applied
  const upd = await c.query(
    "UPDATE tool_fix_proposals SET status = 'applied', applied_at = NOW() WHERE tool_name = 'get_ai_model_costs' AND status IN ('pending', 'approved') RETURNING id, status"
  );
  console.log('Updated:', JSON.stringify(upd.rows, null, 2));
  
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });

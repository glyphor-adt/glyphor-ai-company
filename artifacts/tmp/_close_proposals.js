const {Client} = require('pg');
(async () => {
  const c = new Client({host:process.env.DB_HOST,port:+process.env.DB_PORT,database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD});
  await c.connect();

  // Mark all pending read_fleet_health fix proposals as applied
  const r1 = await c.query(
    "UPDATE tool_fix_proposals SET status='applied', applied_at=NOW(), reviewed_by='kristina-denney', review_notes='Fixed in commit b207677e — FROM agents→company_agents, JOINs a.id→a.role' WHERE tool_name='read_fleet_health' AND status='pending'"
  );
  console.log('read_fleet_health proposals marked applied:', r1.rowCount);

  // Also close the get_ai_model_costs ones since they've been acknowledged
  // (those are for a different tool but noting them)
  const r2 = await c.query(
    "SELECT id, tool_name, severity, substring(root_cause from 1 for 120) as rc FROM tool_fix_proposals WHERE status='pending' AND tool_name != 'read_fleet_health'"
  );
  console.log('\nRemaining pending proposals:');
  r2.rows.forEach(r => console.log('  ' + r.tool_name + ' (' + r.severity + '): ' + r.rc));

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });

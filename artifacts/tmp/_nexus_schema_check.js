const {Client} = require('pg');

(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // Check which tables Nexus's tools reference vs what actually exists
  const tablesNeeded = [
    'agents', 'company_agents',
    'gtm_readiness_reports',
    'agent_prompt_versions',
    'fleet_findings',
    'agent_runs',
    'assignment_evaluations', 'work_assignments',
    'shadow_runs',
    'tool_call_traces',
    'agent_handoff_health',
    'platform_intel_actions',
    'tool_fix_proposals',
  ];

  for (const t of tablesNeeded) {
    const r = await c.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`, [t]
    );
    console.log(`  ${t}: ${r.rows[0].exists ? 'EXISTS' : '** MISSING **'}`);
  }

  // Check company_agents columns vs what read_fleet_health expects
  console.log('\n=== company_agents columns ===');
  const cols = await c.query(
    `SELECT column_name, data_type FROM information_schema.columns 
     WHERE table_name = 'company_agents' ORDER BY ordinal_position`
  );
  cols.rows.forEach(r => console.log(`  ${r.column_name} (${r.data_type})`));

  // Check if 'agents' is a view
  console.log('\n=== Check for agents view ===');
  const views = await c.query(
    `SELECT viewname FROM pg_views WHERE viewname = 'agents'`
  );
  console.log(views.rows.length ? 'agents view EXISTS' : 'agents view MISSING');

  // Check what columns read_fleet_health needs that company_agents might not have
  const neededCols = ['id', 'name', 'department', 'performance_score', 'model'];
  const actualCols = cols.rows.map(r => r.column_name);
  console.log('\n=== Column mapping (read_fleet_health expects a.id, a.name, a.department, a.performance_score, a.model) ===');
  for (const nc of neededCols) {
    console.log(`  ${nc}: ${actualCols.includes(nc) ? 'EXISTS' : '** MISSING ** (need mapping)'}`);
  }

  // check agent_runs table columns
  console.log('\n=== agent_runs columns ===');
  const arCols = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'agent_runs' ORDER BY ordinal_position`
  );
  arCols.rows.forEach(r => console.log(`  ${r.column_name}`));

  // check tool_fix_proposals table columns
  console.log('\n=== tool_fix_proposals columns ===');
  const tfpCols = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'tool_fix_proposals' ORDER BY ordinal_position`
  );
  if (tfpCols.rows.length === 0) {
    console.log('  TABLE DOES NOT EXIST');
  } else {
    tfpCols.rows.forEach(r => console.log(`  ${r.column_name}`));
  }

  await c.end();
})().catch(e => { console.error('DB_ERROR:', e.message); process.exit(1); });

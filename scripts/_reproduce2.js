const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://glyphor_system_user:a7JwuQFobpCzZI+JWyPhCSheZFvIt2OA0rjt9FJvtJ4CaagtOM9p72mdTCM5IHzN@127.0.0.1:6543/glyphor'
});

async function main() {
  await c.connect();

  // Check RLS policies for ALL autonomy-related tables
  const tables = ['agent_autonomy_config', 'autonomy_level_config', 'autonomy_level_thresholds', 'autonomy_level_history'];
  for (const t of tables) {
    const policies = await c.query(`
      SELECT polname, polcmd, 
             (SELECT array_agg(r.rolname) FROM unnest(polroles) WITH ORDINALITY AS u(oid, ord) JOIN pg_roles r ON r.oid = u.oid) AS roles,
             pg_get_expr(polqual, polrelid) as using_expr, 
             pg_get_expr(polwithcheck, polrelid) as check_expr
      FROM pg_policy 
      WHERE polrelid = $1::regclass
    `, [t]);
    console.log(`\n${t} policies:`);
    if (policies.rows.length === 0) console.log('  (none)');
    policies.rows.forEach(p => console.log(`  ${p.polname}: roles=${JSON.stringify(p.roles)} cmd=${p.polcmd} using=${p.using_expr}`));
  }

  // Check the column types of these tables
  for (const t of tables) {
    const cols = await c.query(`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [t]);
    console.log(`\n${t} columns:`);
    cols.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type} (${r.udt_name})`));
  }

  // Now reproduce with SET ROLE glyphor_system AND SET app.current_tenant
  console.log('\n=== Reproduce with exact systemQuery behavior ===');
  const DEFAULT_SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
  
  await c.query(`SET app.current_tenant = '${DEFAULT_SYSTEM_TENANT_ID}'`);
  await c.query('SET ROLE glyphor_system');
  
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  
  // Try the queries that could fail
  console.log('\ngetAutonomyLevels...');
  try {
    const r = await c.query(`
      SELECT level, label, description, execution_policy, review_policy, metadata
      FROM autonomy_level_config
      WHERE tenant_id = $1
      ORDER BY level ASC
    `, [DEFAULT_SYSTEM_TENANT_ID]);
    console.log('  OK:', r.rows.length, 'rows');
  } catch(e) {
    console.log('  ERROR:', e.message);
  }

  console.log('\ngetAutonomyThresholds...');
  try {
    const r = await c.query(`
      SELECT level, completion_rate_threshold, confidence_score_threshold, escalation_rate_max, contradiction_rate_max, sla_breach_rate_max, min_tasks_completed, metadata
      FROM autonomy_level_thresholds
      WHERE tenant_id = $1
      ORDER BY level ASC
    `, [DEFAULT_SYSTEM_TENANT_ID]);
    console.log('  OK:', r.rows.length, 'rows');
  } catch(e) {
    console.log('  ERROR:', e.message);
  }

  // Now the key queries with $2
  console.log('\ncontradictions safeCount...');
  try {
    const r = await c.query(`
      SELECT COUNT(*)::int AS count
      FROM kg_contradictions
      WHERE detected_at >= $2::timestamptz
        AND ($1 = fact_a_agent_id OR $1 = fact_b_agent_id)
    `, ['cto', since]);
    console.log('  OK:', r.rows[0]);
  } catch(e) {
    console.log('  ERROR:', e.message);
  }

  console.log('\nSLA query...');
  try {
    const r = await c.query(`
      SELECT
        COUNT(*)::int AS total_contracts,
        COUNT(*) FILTER (WHERE sla_breached_at IS NOT NULL)::int AS breached_contracts
      FROM agent_handoff_contracts
      WHERE receiving_agent_id = $1
        AND issued_at >= $2::timestamptz
    `, ['cto', since]);
    console.log('  OK:', r.rows[0]);
  } catch(e) {
    console.log('  ERROR:', e.message);
  }
  
  console.log('\nrunMetrics...');
  try {
    const r = await c.query(`
      SELECT
        COUNT(*)::int AS total_runs,
        COUNT(*) FILTER (WHERE status IN ('completed', 'failed', 'aborted', 'skipped_precheck'))::int AS terminal_runs,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_runs,
        AVG(reasoning_confidence) FILTER (WHERE reasoning_confidence IS NOT NULL)::double precision AS avg_confidence_score
      FROM agent_runs
      WHERE agent_id = $1
        AND started_at >= $2::timestamptz
    `, ['cto', since]);
    console.log('  OK:', r.rows[0]);
  } catch(e) {
    console.log('  ERROR:', e.message);
  }

  await c.query('RESET ROLE');
  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });

const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://glyphor_system_user:a7JwuQFobpCzZI+JWyPhCSheZFvIt2OA0rjt9FJvtJ4CaagtOM9p72mdTCM5IHzN@127.0.0.1:6543/glyphor'
});

async function main() {
  await c.connect();

  // Check RLS policies
  console.log('=== RLS-enabled tables ===');
  const rls = await c.query(`
    SELECT tablename, rowsecurity 
    FROM pg_tables 
    WHERE schemaname = 'public' AND rowsecurity = true
    ORDER BY tablename
  `);
  rls.rows.forEach(r => console.log(`  ${r.tablename}`));

  // Check policies on relevant tables
  const tables = ['agent_runs', 'task_run_outcomes', 'agent_run_events', 'agent_trust_scores', 'kg_contradictions', 'agent_handoff_contracts', 'agent_eval_results'];
  for (const t of tables) {
    const policies = await c.query(`
      SELECT polname, polcmd, polroles::regrole[], pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as check_expr
      FROM pg_policy 
      WHERE polrelid = $1::regclass
    `, [t]);
    if (policies.rows.length > 0) {
      console.log(`\n  Policies on ${t}:`);
      policies.rows.forEach(p => console.log(`    ${p.polname}: cmd=${p.polcmd} using=${p.using_expr} check=${p.check_expr}`));
    }
  }

  // Check role
  console.log('\n=== glyphor_system role ===');
  const role = await c.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'glyphor_system'`);
  console.log('  super=', role.rows[0]?.rolsuper, 'bypassrls=', role.rows[0]?.rolbypassrls);

  // Also check if agent_runs has views
  console.log('\n=== Views referencing agent_runs ===');
  const views = await c.query(`
    SELECT viewname FROM pg_views WHERE schemaname = 'public' AND definition ILIKE '%agent_runs%'
  `);
  views.rows.forEach(r => console.log(`  ${r.viewname}`));

  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });

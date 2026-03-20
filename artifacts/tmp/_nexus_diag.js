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

  // 1. Agent status
  const status = await c.query(
    `SELECT role, display_name, status, model, last_run_at, last_run_summary, thinking_enabled, max_turns, budget_per_run 
     FROM company_agents WHERE role='platform-intel'`
  );
  console.log('=== AGENT STATUS ===');
  console.log(JSON.stringify(status.rows[0], null, 2));

  // 2. Recent runs (last 10)
  const runs = await c.query(
    `SELECT id, task, status, tool_calls, created_at, 
            substring(error from 1 for 500) as err, 
            substring(output from 1 for 500) as out 
     FROM agent_runs WHERE agent_id='platform-intel' 
     ORDER BY created_at DESC LIMIT 10`
  );
  console.log('\n=== RECENT RUNS (' + runs.rows.length + ') ===');
  runs.rows.forEach(r => {
    console.log(`  ${r.created_at} | ${r.status} | task=${r.task} | tools=${r.tool_calls}`);
    if (r.err) console.log(`    ERROR: ${r.err}`);
    if (r.out) console.log(`    OUT: ${r.out.substring(0, 200)}`);
  });

  // 3. Tool grants
  const grants = await c.query(
    `SELECT tool_name, is_active, is_blocked FROM agent_tool_grants 
     WHERE agent_role='platform-intel' AND is_active=true ORDER BY tool_name`
  );
  console.log('\n=== TOOL GRANTS (' + grants.rows.length + ') ===');
  grants.rows.forEach(r => console.log(`  ${r.tool_name} ${r.is_blocked ? 'BLOCKED' : 'ok'}`));

  // 4. Pending approval actions
  const actions = await c.query(
    `SELECT id, action_type, status, target_agent_id, description, created_at 
     FROM platform_intel_actions WHERE status='pending' 
     ORDER BY created_at DESC LIMIT 10`
  );
  console.log('\n=== PENDING ACTIONS (' + actions.rows.length + ') ===');
  actions.rows.forEach(r => console.log(JSON.stringify(r)));

  // 5. Check if any tool.failure events were logged recently
  const failures = await c.query(
    `SELECT agent_role, action, summary, created_at FROM activity_log 
     WHERE action='tool_repeated_failure' 
     ORDER BY created_at DESC LIMIT 5`
  );
  console.log('\n=== TOOL FAILURE EVENTS (' + failures.rows.length + ') ===');
  failures.rows.forEach(r => console.log(`  ${r.created_at} | ${r.summary}`));

  // 6. Check scheduler task queue for platform-intel
  const queue = await c.query(
    `SELECT id, agent_role, task, status, created_at, started_at, completed_at
     FROM task_queue WHERE agent_role='platform-intel' 
     ORDER BY created_at DESC LIMIT 5`
  );
  console.log('\n=== TASK QUEUE (' + queue.rows.length + ') ===');
  queue.rows.forEach(r => console.log(`  ${r.created_at} | ${r.status} | task=${r.task} | started=${r.started_at}`));

  // 7. Check migration status for nexus tables
  const tables = await c.query(
    `SELECT tablename FROM pg_tables WHERE tablename IN ('platform_intel_actions', 'platform_intel_reports', 'tool_fix_proposals', 'gtm_readiness_reports') ORDER BY tablename`
  );
  console.log('\n=== NEXUS TABLES ===');
  tables.rows.forEach(r => console.log(`  ${r.tablename}`));

  await c.end();
})().catch(e => { console.error('DB_ERROR:', e.message); process.exit(1); });

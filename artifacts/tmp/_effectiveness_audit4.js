const { Client } = require('pg');

async function run() {
  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // 1. founder_directives schema
  console.log('\n=== 1. FOUNDER_DIRECTIVES SCHEMA ===');
  const s1 = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'founder_directives' ORDER BY ordinal_position`);
  for (const r of s1.rows) console.log(`  ${r.column_name}: ${r.data_type}`);

  // 2. Active founder directives
  console.log('\n=== 2. ACTIVE FOUNDER DIRECTIVES ===');
  const q2 = await c.query(`
    SELECT id, title, status, priority,
      substring(description from 1 for 300) as desc,
      created_at, updated_at
    FROM founder_directives
    WHERE status NOT IN ('completed', 'cancelled', 'rejected')
    ORDER BY created_at
  `);
  for (const r of q2.rows) {
    console.log(`  [${r.status}] "${r.title}" | priority=${r.priority} | id=${r.id}`);
    console.log(`    DESC: ${(r.desc || '').replace(/\n/g, ' ')}`);
    console.log(`    created=${r.created_at} | updated=${r.updated_at}`);
  }

  // 3. Pending decisions
  console.log('\n=== 3. PENDING DECISIONS ===');
  try {
    const q3 = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'decisions' ORDER BY ordinal_position`);
    console.log(`  COLS: ${q3.rows.map(r => r.column_name).join(', ')}`);
    const q3b = await c.query(`
      SELECT * FROM decisions
      WHERE status IN ('pending', 'awaiting_approval', 'proposed')
      ORDER BY created_at
      LIMIT 15
    `);
    for (const r of q3b.rows) {
      console.log(`  [${r.status}] "${r.title || r.description?.substring(0,80)}" | by=${r.proposed_by || r.created_by} | ${r.created_at}`);
    }
  } catch (e) {
    console.log(`  (decisions table: ${e.message})`);
  }

  // 4. CTO on_demand output samples
  console.log('\n=== 4. CTO ON_DEMAND OUTPUTS (24h) ===');
  const q4 = await c.query(`
    SELECT tool_calls, total_cost_usd, model_used,
      substring(output from 1 for 600) as out,
      created_at
    FROM agent_runs
    WHERE agent_id = 'cto' AND task = 'on_demand'
      AND created_at > now() - interval '24 hours'
      AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT 6
  `);
  for (const r of q4.rows) {
    console.log(`\n  ${r.created_at} | tools=${r.tool_calls} | $${r.total_cost_usd} | model=${r.model_used}`);
    console.log(`  OUT: ${(r.out || '').replace(/\n/g, ' ').substring(0, 500)}`);
  }

  // 5. Health checks - are they lightweight or no-op?
  console.log('\n=== 5. HEALTH/COST/FRESHNESS CHECKS (12h) ===');
  const q5 = await c.query(`
    SELECT agent_id, task, status, tool_calls, total_cost_usd, model_used,
      total_input_tokens, total_output_tokens,
      substring(output from 1 for 200) as out
    FROM agent_runs
    WHERE task IN ('health_check', 'cost_check', 'freshness_check', 'platform_health_check')
      AND created_at > now() - interval '12 hours'
    ORDER BY agent_id, task, created_at DESC
    LIMIT 12
  `);
  for (const r of q5.rows) {
    console.log(`  ${r.agent_id}/${r.task} | status=${r.status} | tools=${r.tool_calls} | $${r.total_cost_usd} | tokens=${r.total_input_tokens}/${r.total_output_tokens}`);
  }

  // 6. VP-Design work_loop samples
  console.log('\n=== 6. VP-DESIGN WORK_LOOP OUTPUTS ===');
  const q6 = await c.query(`
    SELECT tool_calls, total_cost_usd, model_used,
      substring(output from 1 for 600) as out,
      created_at
    FROM agent_runs
    WHERE agent_id = 'vp-design' AND task = 'work_loop'
      AND status = 'completed'
      AND created_at > now() - interval '12 hours'
    ORDER BY total_cost_usd DESC
    LIMIT 4
  `);
  for (const r of q6.rows) {
    console.log(`\n  ${r.created_at} | tools=${r.tool_calls} | $${r.total_cost_usd} | model=${r.model_used}`);
    console.log(`  OUT: ${(r.out || '').replace(/\n/g, ' ').substring(0, 500)}`);
  }

  // 7. CMO directive - how many duplicate assignments has Sarah created?
  console.log('\n=== 7. ALL ASSIGNMENTS FOR CMO DIRECTIVE (fa65a83f) ===');
  const q7 = await c.query(`
    SELECT id, assigned_to, status, task_type,
      substring(task_description from 1 for 120) as descr,
      created_at, dispatched_at, completed_at
    FROM work_assignments
    WHERE directive_id::text LIKE 'fa65a83f%'
    ORDER BY created_at DESC
  `);
  console.log(`  TOTAL: ${q7.rows.length} assignments`);
  for (const r of q7.rows) {
    console.log(`  [${r.status}] → ${r.assigned_to} | type=${r.task_type} | created=${r.created_at}`);
    console.log(`    "${r.descr}"`);
  }

  // 8. Social media manager directive (8130103c) 
  console.log('\n=== 8. ALL ASSIGNMENTS FOR SOCIAL-MEDIA DIRECTIVE (8130103c) ===');
  const q8 = await c.query(`
    SELECT id, assigned_to, status, task_type,
      substring(task_description from 1 for 120) as descr,
      created_at, dispatched_at, completed_at
    FROM work_assignments
    WHERE directive_id::text LIKE '8130103c%'
    ORDER BY created_at DESC
  `);
  console.log(`  TOTAL: ${q8.rows.length} assignments`);
  for (const r of q8.rows) {
    console.log(`  [${r.status}] → ${r.assigned_to} | type=${r.task_type} | created=${r.created_at}`);
    console.log(`    "${r.descr}"`);
  }

  // 9. All directives and their assignment counts
  console.log('\n=== 9. DIRECTIVE → ASSIGNMENT SUMMARY ===');
  const q9 = await c.query(`
    SELECT fd.id, fd.title, fd.status as dir_status, fd.priority,
      COUNT(wa.id) as total_assignments,
      COUNT(wa.id) FILTER (WHERE wa.status = 'completed') as completed_assignments,
      COUNT(wa.id) FILTER (WHERE wa.status IN ('pending', 'dispatched', 'in_progress')) as active_assignments,
      COUNT(wa.id) FILTER (WHERE wa.status = 'blocked') as blocked_assignments
    FROM founder_directives fd
    LEFT JOIN work_assignments wa ON wa.directive_id = fd.id
    WHERE fd.status NOT IN ('completed', 'cancelled', 'rejected')
    GROUP BY fd.id, fd.title, fd.status, fd.priority
    ORDER BY total_assignments DESC
  `);
  for (const r of q9.rows) {
    console.log(`  [${r.dir_status}] "${r.title}" | ${r.total_assignments} assignments (${r.completed_assignments} done, ${r.active_assignments} active, ${r.blocked_assignments} blocked)`);
  }

  await c.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });

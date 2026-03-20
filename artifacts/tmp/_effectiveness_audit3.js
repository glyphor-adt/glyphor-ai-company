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

  // 1. Check work_assignments schema
  console.log('\n=== 1. WORK_ASSIGNMENTS SCHEMA ===');
  const schema = await c.query(`
    SELECT column_name, data_type FROM information_schema.columns 
    WHERE table_name = 'work_assignments' ORDER BY ordinal_position
  `);
  for (const r of schema.rows) console.log(`  ${r.column_name}: ${r.data_type}`);

  // 2. Recent work_assignments
  console.log('\n=== 2. RECENT ASSIGNMENTS (48h) ===');
  const q2 = await c.query(`
    SELECT * FROM work_assignments
    WHERE created_at > now() - interval '48 hours'
    ORDER BY created_at DESC
    LIMIT 20
  `);
  for (const r of q2.rows) {
    const cols = Object.entries(r).map(([k,v]) => `${k}=${typeof v === 'string' ? v.substring(0, 100) : v}`).join(' | ');
    console.log(`  ${cols}`);
  }

  // 3. Active founder directives
  console.log('\n=== 3. ACTIVE FOUNDER DIRECTIVES ===');
  const q3 = await c.query(`
    SELECT id, title, status, priority, type,
      substring(description from 1 for 200) as desc,
      created_at, updated_at
    FROM founder_directives
    WHERE status NOT IN ('completed', 'cancelled', 'rejected')
    ORDER BY priority, created_at
  `);
  for (const r of q3.rows) {
    console.log(`  [${r.status}] "${r.title}" | priority=${r.priority} | type=${r.type} | id=${r.id}`);
    console.log(`    DESC: ${(r.desc || '').replace(/\n/g, ' ')}`);
    console.log(`    created=${r.created_at} | updated=${r.updated_at}`);
  }

  // 4. Pending decisions
  console.log('\n=== 4. PENDING DECISIONS ===');
  try {
    const q4 = await c.query(`
      SELECT id, title, status, decision_type, proposed_by,
        substring(description from 1 for 200) as desc,
        created_at
      FROM decisions
      WHERE status IN ('pending', 'awaiting_approval', 'proposed')
      ORDER BY created_at
      LIMIT 15
    `);
    for (const r of q4.rows) {
      console.log(`  [${r.status}] "${r.title}" | by=${r.proposed_by} | type=${r.decision_type} | ${r.created_at}`);
    }
  } catch (e) {
    console.log(`  (decisions table error: ${e.message})`);
  }

  // 5. CTO on_demand - 67 runs in 48h, what's driving these?
  console.log('\n=== 5. CTO ON_DEMAND OUTPUT SAMPLES (last 24h) ===');
  const q5 = await c.query(`
    SELECT tool_calls, total_cost_usd, model_used,
      substring(output from 1 for 600) as out,
      created_at
    FROM agent_runs
    WHERE agent_id = 'cto' AND task = 'on_demand'
      AND created_at > now() - interval '24 hours'
      AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT 8
  `);
  for (const r of q5.rows) {
    console.log(`  ${r.created_at} | tools=${r.tool_calls} | $${r.total_cost_usd} | model=${r.model_used}`);
    console.log(`    OUT: ${(r.out || '(none)').replace(/\n/g, ' ').substring(0, 500)}`);
  }

  // 6. Health checks: $0 cost, are these no-op jobs?
  console.log('\n=== 6. HEALTH/COST CHECKS - ARE THEY NO-OP? ===');
  const q6 = await c.query(`
    SELECT agent_id, task, status, tool_calls, total_cost_usd, model_used,
      total_input_tokens, total_output_tokens,
      substring(output from 1 for 200) as out
    FROM agent_runs
    WHERE task IN ('health_check', 'cost_check', 'freshness_check', 'platform_health_check')
      AND created_at > now() - interval '12 hours'
    ORDER BY agent_id, created_at DESC
    LIMIT 15
  `);
  for (const r of q6.rows) {
    console.log(`  ${r.agent_id}/${r.task} | status=${r.status} | tools=${r.tool_calls} | cost=$${r.total_cost_usd} | model=${r.model_used} | tokens=${r.total_input_tokens}/${r.total_output_tokens}`);
    console.log(`    OUT: ${(r.out || '(none)').replace(/\n/g, ' ')}`);
  }

  // 7. VP-Design work_loop - 66 runs! What is she producing?
  console.log('\n=== 7. VP-DESIGN OUTPUT SAMPLES ===');
  const q7 = await c.query(`
    SELECT tool_calls, total_cost_usd, model_used,
      substring(output from 1 for 700) as out,
      created_at
    FROM agent_runs
    WHERE agent_id = 'vp-design' AND task = 'work_loop'
      AND status = 'completed'
      AND created_at > now() - interval '24 hours'
    ORDER BY total_cost_usd DESC
    LIMIT 5
  `);
  for (const r of q7.rows) {
    console.log(`  ${r.created_at} | tools=${r.tool_calls} | $${r.total_cost_usd} | model=${r.model_used}`);
    console.log(`    OUT: ${(r.out || '(none)').replace(/\n/g, ' ').substring(0, 500)}`);
  }

  // 8. SARAH: Is she creating duplicate assignments over and over?
  console.log('\n=== 8. ALL ASSIGNMENTS FOR CMO DIRECTIVE (fa65a83f) ===');
  try {
    const q8 = await c.query(`
      SELECT * FROM work_assignments
      WHERE directive_id::text LIKE 'fa65a83f%'
      ORDER BY created_at DESC
      LIMIT 20
    `);
    for (const r of q8.rows) {
      const cols = Object.entries(r).map(([k,v]) => `${k}=${typeof v === 'string' ? v.substring(0, 150) : v}`).join(' | ');
      console.log(`  ${cols}`);
    }
  } catch (e) {
    console.log(`  (query failed: ${e.message})`);
  }

  // 9. Count total assignments per directive
  console.log('\n=== 9. ASSIGNMENT COUNTS PER DIRECTIVE ===');
  const q9 = await c.query(`
    SELECT directive_id, COUNT(*) as total_assignments,
      COUNT(DISTINCT status) as status_count,
      array_agg(DISTINCT status) as statuses
    FROM work_assignments
    GROUP BY directive_id
    ORDER BY total_assignments DESC
    LIMIT 10
  `);
  for (const r of q9.rows) {
    console.log(`  directive=${r.directive_id} | ${r.total_assignments} assignments | statuses=${r.statuses}`);
  }

  await c.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });

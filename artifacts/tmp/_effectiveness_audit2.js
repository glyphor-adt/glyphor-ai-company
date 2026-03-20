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

  // 1. What is proactive_gate_reset? These 100%-idle agents all run it
  console.log('\n=== 1. proactive_gate_reset RUNS (all agents) ===');
  const q1 = await c.query(`
    SELECT agent_id, task, status, tool_calls, total_cost_usd,
      substring(output from 1 for 400) as out,
      created_at
    FROM agent_runs
    WHERE task = 'proactive_gate_reset'
      AND created_at > now() - interval '48 hours'
    ORDER BY created_at DESC
    LIMIT 15
  `);
  for (const r of q1.rows) {
    console.log(`  ${r.agent_id} | status=${r.status} | tools=${r.tool_calls} | $${r.total_cost_usd} | ${r.created_at}`);
    console.log(`    OUT: ${(r.out || '(none)').replace(/\n/g, ' ').substring(0, 300)}`);
  }

  // 2. Sarah's ACTUAL work output — what did she CREATE or CHANGE? 
  // Look at what tools she called (from output parsing)
  console.log('\n=== 2. SARAH ORCHESTRATE - WHAT TOOLS DID SHE CALL? (last 15 runs) ===');
  const q2 = await c.query(`
    SELECT 
      substring(output from 1 for 2000) as full_output,
      tool_calls,
      total_cost_usd,
      created_at
    FROM agent_runs
    WHERE agent_id = 'chief-of-staff' 
      AND task = 'orchestrate'
      AND status = 'completed'
      AND created_at > now() - interval '6 hours'
    ORDER BY created_at DESC
    LIMIT 15
  `);
  for (const r of q2.rows) {
    // Try to extract tool names from output
    const toolMatches = (r.full_output || '').match(/(?:called|executed|used|tool_code.*?print\(|<tool_name>)[\s(]*([a-z_]+)/gi) || [];
    const toolNames = (r.full_output || '').match(/(?:read_initiatives|create_work_assignments|send_teams_dm|check_directives|check_decisions|review_rejected|send_reminder|get_pending|check_team_status|mark_directive|update_directive|create_decision|escalate|get_working_memory|save_working_memory|query_agent_health|delegate)/gi) || [];
    console.log(`  ${r.created_at} | tools=${r.tool_calls} | $${r.total_cost_usd}`);
    console.log(`    TOOLS MENTIONED: ${[...new Set(toolNames)].join(', ') || '(none found in output)'}`);
  }

  // 3. What are work_assignments that Sarah keeps trying to create?
  console.log('\n=== 3. WORK ASSIGNMENTS CREATED (last 48h) ===');
  const q3 = await c.query(`
    SELECT id, directive_id, assignee, status, 
      substring(instructions from 1 for 200) as instructions,
      created_at, updated_at
    FROM work_assignments
    WHERE created_at > now() - interval '48 hours'
    ORDER BY created_at DESC
    LIMIT 20
  `);
  for (const r of q3.rows) {
    console.log(`  ${r.assignee} | status=${r.status} | created=${r.created_at}`);
    console.log(`    INSTRUCTIONS: ${(r.instructions || '').replace(/\n/g, ' ')}`);
  }

  // 4. What are the ACTIVE directives that are driving Sarah?
  console.log('\n=== 4. ACTIVE FOUNDER DIRECTIVES ===');
  const q4 = await c.query(`
    SELECT id, title, status, priority, 
      substring(description from 1 for 200) as desc,
      created_at, updated_at
    FROM founder_directives
    WHERE status NOT IN ('completed', 'cancelled', 'rejected')
    ORDER BY priority, created_at
  `);
  for (const r of q4.rows) {
    console.log(`  [${r.status}] ${r.title} | priority=${r.priority} | id=${r.id}`);
    console.log(`    DESC: ${(r.desc || '').replace(/\n/g, ' ')}`);
  }

  // 5. CTO on_demand - 67 runs, what is he doing?
  console.log('\n=== 5. CTO ON_DEMAND RUNS - WHAT TRIGGERS THEM? ===');
  const q5 = await c.query(`
    SELECT task, tool_calls, total_cost_usd,
      substring(output from 1 for 500) as out,
      created_at
    FROM agent_runs
    WHERE agent_id = 'cto' AND task = 'on_demand'
      AND created_at > now() - interval '24 hours'
    ORDER BY created_at DESC
    LIMIT 8
  `);
  for (const r of q5.rows) {
    console.log(`  ${r.created_at} | tools=${r.tool_calls} | $${r.total_cost_usd}`);
    console.log(`    OUT: ${(r.out || '(none)').replace(/\n/g, ' ').substring(0, 400)}`);
  }

  // 6. CTO platform_health_check - 24 runs with $0 cost - are these actually running?
  console.log('\n=== 6. CTO HEALTH CHECKS ($0 cost?) ===');
  const q6 = await c.query(`
    SELECT task, status, tool_calls, total_cost_usd, model_used,
      total_input_tokens, total_output_tokens,
      substring(output from 1 for 200) as out,
      created_at
    FROM agent_runs
    WHERE agent_id = 'cto' AND task = 'platform_health_check'
      AND created_at > now() - interval '24 hours'
    ORDER BY created_at DESC
    LIMIT 5
  `);
  for (const r of q6.rows) {
    console.log(`  ${r.created_at} | status=${r.status} | tools=${r.tool_calls} | cost=$${r.total_cost_usd} | model=${r.model_used} | tokens=${r.total_input_tokens}/${r.total_output_tokens}`);
    console.log(`    OUT: ${(r.out || '(none)').replace(/\n/g, ' ')}`);
  }

  // 7. ops health_check and cost_check - same thing, $0 cost
  console.log('\n=== 7. OPS HEALTH/COST CHECKS ===');
  const q7 = await c.query(`
    SELECT task, status, tool_calls, total_cost_usd, model_used,
      total_input_tokens,
      substring(output from 1 for 200) as out,
      created_at
    FROM agent_runs
    WHERE agent_id = 'ops' AND task IN ('health_check', 'cost_check', 'freshness_check')
      AND created_at > now() - interval '24 hours'
    ORDER BY created_at DESC
    LIMIT 8
  `);
  for (const r of q7.rows) {
    console.log(`  ${r.task} | ${r.created_at} | status=${r.status} | tools=${r.tool_calls} | cost=$${r.total_cost_usd} | model=${r.model_used} | tokens=${r.total_input_tokens}`);
  }

  // 8. VP-Design - 66 work_loop runs. What is she actually producing?
  console.log('\n=== 8. VP-DESIGN WORK_LOOP OUTPUT SAMPLES ===');
  const q8 = await c.query(`
    SELECT tool_calls, total_cost_usd, model_used,
      substring(output from 1 for 600) as out,
      created_at
    FROM agent_runs
    WHERE agent_id = 'vp-design' AND task = 'work_loop'
      AND status = 'completed'
      AND created_at > now() - interval '24 hours'
    ORDER BY total_cost_usd DESC
    LIMIT 5
  `);
  for (const r of q8.rows) {
    console.log(`  ${r.created_at} | tools=${r.tool_calls} | $${r.total_cost_usd} | model=${r.model_used}`);
    console.log(`    OUT: ${(r.out || '(none)').replace(/\n/g, ' ').substring(0, 400)}`);
  }

  // 9. What decisions are STUCK waiting for Kristina?
  console.log('\n=== 9. PENDING DECISIONS ===');
  try {
    const q9 = await c.query(`
      SELECT id, title, status, decision_type, proposed_by,
        substring(description from 1 for 200) as desc,
        created_at
      FROM decisions
      WHERE status IN ('pending', 'awaiting_approval', 'proposed')
      ORDER BY created_at
      LIMIT 15
    `);
    for (const r of q9.rows) {
      console.log(`  [${r.status}] ${r.title} | by=${r.proposed_by} | ${r.created_at}`);
    }
  } catch (e) {
    console.log(`  (decisions table query failed: ${e.message})`);
  }

  await c.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });

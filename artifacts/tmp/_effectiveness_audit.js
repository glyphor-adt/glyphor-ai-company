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

  // 1. Per-agent: completed runs with actual tool calls vs zero-tool runs (last 48h)
  console.log('\n=== 1. AGENT EFFECTIVENESS: TOOL USAGE (48h) ===');
  const q1 = await c.query(`
    SELECT 
      agent_id,
      COUNT(*) as total_runs,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      COUNT(*) FILTER (WHERE status = 'completed' AND (tool_calls IS NULL OR tool_calls = 0)) as zero_tool_completed,
      COUNT(*) FILTER (WHERE status = 'completed' AND tool_calls > 0) as productive_runs,
      ROUND(AVG(tool_calls) FILTER (WHERE status = 'completed'), 1) as avg_tools_per_run,
      ROUND(SUM(total_cost_usd)::numeric, 2) as total_cost,
      ROUND(AVG(total_cost_usd)::numeric, 3) as avg_cost_per_run,
      ROUND(SUM(total_cost_usd) FILTER (WHERE status = 'completed' AND (tool_calls IS NULL OR tool_calls = 0))::numeric, 2) as wasted_cost
    FROM agent_runs 
    WHERE created_at > now() - interval '48 hours'
    GROUP BY agent_id
    ORDER BY total_runs DESC
  `);
  for (const r of q1.rows) {
    const wasteRate = r.total_runs > 0 ? Math.round((r.zero_tool_completed / r.total_runs) * 100) : 0;
    console.log(`${r.agent_id}: ${r.total_runs} runs, ${r.productive_runs} productive, ${r.zero_tool_completed} zero-tool (${wasteRate}% waste), ${r.failed} failed | cost=$${r.total_cost} (wasted=$${r.wasted_cost})`);
  }

  // 2. What tasks are each agent running? Are they doing the same thing over and over?
  console.log('\n=== 2. TASK REPETITION (48h) ===');
  const q2 = await c.query(`
    SELECT agent_id, task, COUNT(*) as runs,
      COUNT(*) FILTER (WHERE status = 'completed' AND (tool_calls IS NULL OR tool_calls = 0)) as zero_tool,
      ROUND(SUM(total_cost_usd)::numeric, 2) as cost
    FROM agent_runs 
    WHERE created_at > now() - interval '48 hours'
    GROUP BY agent_id, task
    HAVING COUNT(*) > 2
    ORDER BY COUNT(*) DESC
    LIMIT 30
  `);
  for (const r of q2.rows) {
    console.log(`  ${r.agent_id} | task="${r.task}" | ${r.runs}x (${r.zero_tool} zero-tool) | $${r.cost}`);
  }

  // 3. Sample OUTPUTS from zero-tool runs - what are they actually saying?
  console.log('\n=== 3. ZERO-TOOL RUN OUTPUTS (samples) ===');
  const q3 = await c.query(`
    SELECT agent_id, task, 
      substring(output from 1 for 600) as output_preview,
      total_cost_usd,
      created_at
    FROM agent_runs 
    WHERE created_at > now() - interval '24 hours'
      AND status = 'completed' 
      AND (tool_calls IS NULL OR tool_calls = 0)
      AND total_cost_usd > 0.01
    ORDER BY total_cost_usd DESC
    LIMIT 15
  `);
  for (const r of q3.rows) {
    console.log(`\n--- ${r.agent_id} | task=${r.task} | $${r.total_cost_usd} | ${r.created_at} ---`);
    console.log(r.output_preview || '(no output)');
  }

  // 4. Sample OUTPUTS from "productive" runs - are they actually useful?
  console.log('\n=== 4. PRODUCTIVE RUN OUTPUTS (top agents, samples) ===');
  const topAgents = ['chief-of-staff', 'cto', 'cmo', 'cfo', 'ops'];
  for (const agent of topAgents) {
    const q4 = await c.query(`
      SELECT task, tool_calls, 
        substring(output from 1 for 800) as output_preview,
        total_cost_usd,
        model_used,
        created_at
      FROM agent_runs 
      WHERE agent_id = $1
        AND created_at > now() - interval '24 hours'
        AND status = 'completed' 
        AND tool_calls > 0
      ORDER BY created_at DESC
      LIMIT 3
    `, [agent]);
    if (q4.rows.length > 0) {
      console.log(`\n--- ${agent} (productive runs) ---`);
      for (const r of q4.rows) {
        console.log(`  task=${r.task} | tools=${r.tool_calls} | $${r.total_cost_usd} | model=${r.model_used} | ${r.created_at}`);
        console.log(`  OUTPUT: ${(r.output_preview || '(none)').replace(/\n/g, ' ').substring(0, 500)}`);
      }
    }
  }

  // 5. Failed runs - what's breaking?
  console.log('\n=== 5. FAILED RUNS (24h) ===');
  const q5 = await c.query(`
    SELECT agent_id, task, 
      substring(error from 1 for 400) as error_preview,
      total_cost_usd,
      created_at
    FROM agent_runs 
    WHERE created_at > now() - interval '24 hours'
      AND status = 'failed'
    ORDER BY created_at DESC
    LIMIT 15
  `);
  for (const r of q5.rows) {
    console.log(`  ${r.agent_id} | task=${r.task} | $${r.total_cost_usd} | ${r.created_at}`);
    console.log(`    ERROR: ${(r.error_preview || '(none)').replace(/\n/g, ' ')}`);
  }

  // 6. Sarah specifically - what does her output look like across runs? Is it unique or copy-paste?
  console.log('\n=== 6. SARAH OUTPUT DIVERSITY (last 10 orchestrate runs) ===');
  const q6 = await c.query(`
    SELECT 
      substring(output from 1 for 300) as out_preview,
      tool_calls,
      total_cost_usd,
      created_at
    FROM agent_runs 
    WHERE agent_id = 'chief-of-staff' 
      AND task = 'orchestrate'
      AND status = 'completed'
      AND created_at > now() - interval '24 hours'
    ORDER BY created_at DESC
    LIMIT 10
  `);
  const outputs = q6.rows.map(r => (r.out_preview || '').substring(0, 200));
  const uniqueOutputs = new Set(outputs);
  console.log(`  ${q6.rows.length} runs, ${uniqueOutputs.size} unique output prefixes (200-char)`);
  for (const r of q6.rows) {
    console.log(`  ${r.created_at} | tools=${r.tool_calls} | $${r.total_cost_usd}`);
    console.log(`    ${(r.out_preview || '').replace(/\n/g, ' ').substring(0, 250)}`);
  }

  // 7. Agents that NEVER produce tool calls
  console.log('\n=== 7. AGENTS WITH HIGHEST IDLE RATE (48h, min 5 runs) ===');
  const q7 = await c.query(`
    SELECT 
      agent_id,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'completed' AND (tool_calls IS NULL OR tool_calls = 0)) as idle,
      ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'completed' AND (tool_calls IS NULL OR tool_calls = 0)) / NULLIF(COUNT(*), 0), 1) as idle_pct,
      ROUND(SUM(total_cost_usd) FILTER (WHERE status = 'completed' AND (tool_calls IS NULL OR tool_calls = 0))::numeric, 2) as idle_cost
    FROM agent_runs
    WHERE created_at > now() - interval '48 hours'
    GROUP BY agent_id
    HAVING COUNT(*) >= 5
    ORDER BY idle_pct DESC
  `);
  for (const r of q7.rows) {
    console.log(`  ${r.agent_id}: ${r.idle}/${r.total} idle (${r.idle_pct}%) = $${r.idle_cost} wasted`);
  }

  // 8. What are the ACTUAL unique tasks being run? Not just repetition count
  console.log('\n=== 8. DISTINCT TASKS PER AGENT (48h) ===');
  const q8 = await c.query(`
    SELECT agent_id, array_agg(DISTINCT task) as tasks, COUNT(DISTINCT task) as task_count
    FROM agent_runs
    WHERE created_at > now() - interval '48 hours'
    GROUP BY agent_id
    ORDER BY task_count DESC
  `);
  for (const r of q8.rows) {
    console.log(`  ${r.agent_id}: ${r.task_count} tasks → ${r.tasks.join(', ')}`);
  }

  await c.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });

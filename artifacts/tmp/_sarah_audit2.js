const { Client } = require('pg');
(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // 1. All agents last 24h
  console.log('=== ALL AGENTS 24H — COST & ACTIVITY ===');
  const q1 = await c.query(`
    SELECT agent_id, 
           COUNT(*) AS runs,
           SUM(total_cost_usd) AS total_cost,
           AVG(tool_calls) AS avg_tools,
           COUNT(*) FILTER (WHERE tool_calls = 0 OR tool_calls IS NULL) AS zero_tool_runs,
           COUNT(*) FILTER (WHERE status = 'completed') AS completed,
           COUNT(*) FILTER (WHERE status = 'failed') AS failed
    FROM agent_runs
    WHERE created_at > NOW() - INTERVAL '24 hours'
    GROUP BY agent_id
    ORDER BY total_cost DESC NULLS LAST
    LIMIT 30
  `);
  console.log(JSON.stringify(q1.rows, null, 2));

  // 2. Zero-tool high-cost runs
  console.log('\n=== ZERO-TOOL HIGH-COST RUNS 24H ===');
  const q2 = await c.query(`
    SELECT agent_id, task, status, total_cost_usd, 
           total_input_tokens, total_output_tokens, model_used,
           SUBSTRING(output FROM 1 FOR 300) AS output_preview,
           created_at
    FROM agent_runs
    WHERE created_at > NOW() - INTERVAL '24 hours'
      AND (tool_calls = 0 OR tool_calls IS NULL)
      AND total_cost_usd > 0.05
    ORDER BY total_cost_usd DESC
    LIMIT 15
  `);
  console.log(JSON.stringify(q2.rows, null, 2));

  // 3. Sarah hourly cost
  console.log('\n=== SARAH HOURLY COST 24H ===');
  const q3 = await c.query(`
    SELECT date_trunc('hour', created_at) AS hour,
           COUNT(*) AS runs,
           SUM(total_cost_usd) AS cost,
           SUM(total_input_tokens) AS input_tokens,
           AVG(tool_calls) AS avg_tools
    FROM agent_runs
    WHERE agent_id = 'chief-of-staff'
      AND created_at > NOW() - INTERVAL '24 hours'
    GROUP BY hour
    ORDER BY hour DESC
  `);
  console.log(JSON.stringify(q3.rows, null, 2));

  // 4. Orchestrate schedule - how often is it triggered?
  console.log('\n=== SARAH ORCHESTRATE CADENCE (last 4h, minute-level) ===');
  const q4 = await c.query(`
    SELECT created_at, total_cost_usd, total_input_tokens, tool_calls
    FROM agent_runs
    WHERE agent_id = 'chief-of-staff'
      AND task = 'orchestrate'
      AND created_at > NOW() - INTERVAL '4 hours'
    ORDER BY created_at DESC
  `);
  console.log(JSON.stringify(q4.rows, null, 2));

  // 5. What's the scheduler cron for chief-of-staff?
  console.log('\n=== SCHEDULER CONFIG ===');
  try {
    const q5 = await c.query(`
      SELECT agent_id, schedule, task, is_active, last_run_at
      FROM scheduled_tasks
      WHERE agent_id = 'chief-of-staff'
      ORDER BY task
    `);
    console.log(JSON.stringify(q5.rows, null, 2));
  } catch (e) {
    console.log('scheduled_tasks error:', e.message);
    try {
      const q5b = await c.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_name ILIKE '%sched%' OR table_name ILIKE '%cron%' OR table_name ILIKE '%job%'
        ORDER BY table_name
      `);
      console.log('Schedule-related tables:', q5b.rows.map(r => r.table_name));
    } catch (e2) { console.log('  fallback error:', e2.message); }
  }

  // 6. Total fleet cost today
  console.log('\n=== FLEET COST TODAY ===');
  const q6 = await c.query(`
    SELECT SUM(total_cost_usd) AS total_cost,
           COUNT(*) AS total_runs,
           SUM(total_input_tokens) AS total_input,
           SUM(total_output_tokens) AS total_output
    FROM agent_runs
    WHERE created_at > date_trunc('day', NOW())
  `);
  console.log(JSON.stringify(q6.rows, null, 2));

  await c.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

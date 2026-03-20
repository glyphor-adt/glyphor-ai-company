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

  // 1. Sarah's runs last 48h — task breakdown with cost
  console.log('=== SARAH RUNS LAST 48H — TASK BREAKDOWN ===');
  const q1 = await c.query(`
    SELECT task,
           COUNT(*) AS runs,
           SUM(total_cost_usd) AS total_cost,
           AVG(total_cost_usd) AS avg_cost,
           SUM(total_input_tokens) AS total_input,
           SUM(total_output_tokens) AS total_output,
           AVG(tool_calls) AS avg_tools,
           COUNT(*) FILTER (WHERE status = 'completed') AS completed,
           COUNT(*) FILTER (WHERE status = 'failed') AS failed
    FROM agent_runs
    WHERE agent_id = 'chief-of-staff'
      AND created_at > NOW() - INTERVAL '48 hours'
    GROUP BY task
    ORDER BY total_cost DESC
  `);
  console.log(JSON.stringify(q1.rows, null, 2));

  // 2. Recent individual runs — output snippets to see what she actually did
  console.log('\n=== LAST 20 RUNS — OUTPUT PREVIEW ===');
  const q2 = await c.query(`
    SELECT id, task, status, model_used, tool_calls, total_cost_usd,
           total_input_tokens, total_output_tokens,
           created_at,
           SUBSTRING(output FROM 1 FOR 600) AS output_preview,
           SUBSTRING(error FROM 1 FOR 300) AS error_preview
    FROM agent_runs
    WHERE agent_id = 'chief-of-staff'
      AND created_at > NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.log(JSON.stringify(q2.rows, null, 2));

  // 3. Tool usage breakdown — what tools is she actually calling?
  console.log('\n=== SARAH TOOL USAGE LAST 48H ===');
  const q3 = await c.query(`
    SELECT tc.tool_name, COUNT(*) AS calls, 
           COUNT(DISTINCT tc.run_id) AS distinct_runs
    FROM agent_tool_calls tc
    JOIN agent_runs ar ON tc.run_id = ar.id
    WHERE ar.agent_id = 'chief-of-staff'
      AND ar.created_at > NOW() - INTERVAL '48 hours'
    GROUP BY tc.tool_name
    ORDER BY calls DESC
    LIMIT 30
  `);
  console.log(JSON.stringify(q3.rows, null, 2));

  // 4. All agent activity last 24h — who else is running a lot?
  console.log('\n=== ALL AGENTS LAST 24H — ACTIVITY SUMMARY ===');
  const q4 = await c.query(`
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
    ORDER BY total_cost DESC
    LIMIT 30
  `);
  console.log(JSON.stringify(q4.rows, null, 2));

  // 5. Runs with 0 tool calls but high token usage (thinking but not doing)
  console.log('\n=== ZERO-TOOL HIGH-COST RUNS LAST 24H ===');
  const q5 = await c.query(`
    SELECT agent_id, task, status, total_cost_usd, 
           total_input_tokens, total_output_tokens, model_used,
           SUBSTRING(output FROM 1 FOR 400) AS output_preview,
           created_at
    FROM agent_runs
    WHERE created_at > NOW() - INTERVAL '24 hours'
      AND (tool_calls = 0 OR tool_calls IS NULL)
      AND total_cost_usd > 0.05
    ORDER BY total_cost_usd DESC
    LIMIT 20
  `);
  console.log(JSON.stringify(q5.rows, null, 2));

  // 6. Hourly cost for Sarah to see pattern
  console.log('\n=== SARAH HOURLY COST LAST 24H ===');
  const q6 = await c.query(`
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
  console.log(JSON.stringify(q6.rows, null, 2));

  await c.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

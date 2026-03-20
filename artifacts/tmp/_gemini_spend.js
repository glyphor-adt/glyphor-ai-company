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

  // 1. Gemini spend by agent + model yesterday
  const q1 = await c.query(`
    SELECT
      agent_id,
      model_used,
      COUNT(*) as runs,
      SUM(COALESCE(total_input_tokens,0)) as input_tok,
      SUM(COALESCE(total_output_tokens,0)) as output_tok,
      SUM(COALESCE(total_input_tokens,0)+COALESCE(total_output_tokens,0)) as total_tok,
      SUM(COALESCE(total_cost_usd, cost, 0))::numeric(10,4) as cost_usd
    FROM agent_runs
    WHERE created_at >= (CURRENT_DATE - interval '1 day')
      AND created_at < CURRENT_DATE
    GROUP BY agent_id, model_used
    ORDER BY cost_usd DESC
    LIMIT 30
  `);
  console.log('=== AGENT_RUNS SPEND YESTERDAY (by agent+model) ===');
  console.log(JSON.stringify(q1.rows, null, 2));

  // 2. Overall totals yesterday
  const q2 = await c.query(`
    SELECT
      COUNT(*) as total_runs,
      SUM(COALESCE(total_input_tokens,0)+COALESCE(total_output_tokens,0)) as total_tokens,
      SUM(COALESCE(total_cost_usd, cost, 0))::numeric(10,4) as total_cost
    FROM agent_runs
    WHERE created_at >= (CURRENT_DATE - interval '1 day')
      AND created_at < CURRENT_DATE
  `);
  console.log('\n=== TOTALS YESTERDAY ===');
  console.log(JSON.stringify(q2.rows, null, 2));

  // 3. Top 10 most expensive individual runs yesterday
  const q3 = await c.query(`
    SELECT
      agent_id,
      model_used,
      COALESCE(total_cost_usd, cost, 0)::numeric(10,4) as cost_usd,
      COALESCE(total_input_tokens,0) as input_tok,
      COALESCE(total_output_tokens,0) as output_tok,
      tool_calls,
      turns,
      status,
      substring(task from 1 for 120) as task_preview,
      created_at
    FROM agent_runs
    WHERE created_at >= (CURRENT_DATE - interval '1 day')
      AND created_at < CURRENT_DATE
    ORDER BY COALESCE(total_cost_usd, cost, 0) DESC
    LIMIT 15
  `);
  console.log('\n=== TOP 15 MOST EXPENSIVE RUNS YESTERDAY ===');
  console.log(JSON.stringify(q3.rows, null, 2));

  // 4. GCP billing for yesterday
  const q4 = await c.query(`
    SELECT service, SUM(cost_usd)::numeric(10,4) as cost, COUNT(*) as records
    FROM gcp_billing
    WHERE recorded_at >= (CURRENT_DATE - interval '1 day')
      AND recorded_at < CURRENT_DATE
    GROUP BY service
    ORDER BY cost DESC
    LIMIT 20
  `);
  console.log('\n=== GCP_BILLING YESTERDAY ===');
  console.log(JSON.stringify(q4.rows, null, 2));

  // 5. Hourly breakdown of spend
  const q5 = await c.query(`
    SELECT
      date_trunc('hour', created_at) as hour,
      COUNT(*) as runs,
      SUM(COALESCE(total_cost_usd, cost, 0))::numeric(10,4) as cost_usd,
      SUM(COALESCE(total_input_tokens,0)+COALESCE(total_output_tokens,0)) as tokens
    FROM agent_runs
    WHERE created_at >= (CURRENT_DATE - interval '1 day')
      AND created_at < CURRENT_DATE
    GROUP BY date_trunc('hour', created_at)
    ORDER BY hour
  `);
  console.log('\n=== HOURLY BREAKDOWN YESTERDAY ===');
  console.log(JSON.stringify(q5.rows, null, 2));

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });

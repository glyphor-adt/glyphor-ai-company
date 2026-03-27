import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // ── 0. What columns actually exist on agent_runs? ──
  console.log('=== agent_runs columns ===\n');
  const cols = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'agent_runs' 
      AND column_name ILIKE '%model%' OR column_name ILIKE '%cost%' OR column_name ILIKE '%token%'
    ORDER BY column_name
  `);
  console.table(cols.rows);

  // ── 1. NULL model_used: which agents, and what data DO they have? ──
  console.log('\n=== NULL model_used — Breakdown by agent (Last 30d) ===\n');
  const nullBreakdown = await client.query(`
    SELECT agent_id,
           COUNT(*) AS runs,
           COUNT(CASE WHEN routing_model IS NOT NULL THEN 1 END) AS has_routing_model,
           COUNT(CASE WHEN actual_model IS NOT NULL THEN 1 END) AS has_actual_model,
           COUNT(CASE WHEN cost IS NOT NULL AND cost > 0 THEN 1 END) AS has_cost,
           COUNT(CASE WHEN total_cost_usd IS NOT NULL AND total_cost_usd > 0 THEN 1 END) AS has_total_cost,
           COUNT(CASE WHEN cost_source IS NOT NULL THEN 1 END) AS has_cost_source,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS est_cost
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND model_used IS NULL
    GROUP BY agent_id
    ORDER BY runs DESC
  `);
  console.table(nullBreakdown.rows);

  // ── 2. Cost source breakdown ──
  console.log('\n=== Cost Source Breakdown (Last 30d) ===\n');
  const costSource = await client.query(`
    SELECT COALESCE(cost_source, 'NULL') AS cost_source,
           COUNT(*) AS runs,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 2) AS total_cost,
           COUNT(CASE WHEN model_used IS NOT NULL THEN 1 END) AS has_model_used,
           COUNT(CASE WHEN actual_model IS NOT NULL THEN 1 END) AS has_actual_model
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY COALESCE(cost_source, 'NULL')
    ORDER BY runs DESC
  `);
  console.table(costSource.rows);

  // ── 3. Runs where actual_model IS populated but model_used is NOT ──
  console.log('\n=== Has actual_model but NOT model_used (Last 30d) ===\n');
  const actualGap = await client.query(`
    SELECT actual_model,
           COUNT(*) AS runs,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS est_cost
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND model_used IS NULL
      AND actual_model IS NOT NULL
    GROUP BY actual_model
    ORDER BY runs DESC
    LIMIT 20
  `);
  console.table(actualGap.rows);

  // ── 4. Runs where routing_model IS populated but model_used is NOT ──
  console.log('\n=== Has routing_model but NOT model_used (Last 30d) ===\n');
  const routingGap = await client.query(`
    SELECT routing_model,
           COUNT(*) AS runs,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS est_cost
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND model_used IS NULL
      AND routing_model IS NOT NULL
    GROUP BY routing_model
    ORDER BY runs DESC
    LIMIT 20
  `);
  console.table(routingGap.rows);

  // ── 5. Runs that have NEITHER model_used NOR routing_model NOR actual_model ──
  console.log('\n=== Completely unattributed runs (no model info at all) ===\n');
  const noInfo = await client.query(`
    SELECT agent_id, status, COUNT(*) AS runs,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS est_cost,
           COUNT(CASE WHEN total_input_tokens > 0 THEN 1 END) AS has_tokens,
           COUNT(CASE WHEN cost_source = 'instrumented' THEN 1 END) AS instrumented
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND model_used IS NULL
      AND actual_model IS NULL
      AND routing_model IS NULL
    GROUP BY agent_id, status
    ORDER BY runs DESC
    LIMIT 20
  `);
  console.table(noInfo.rows);

  // ── 6. Sample recent instrumented runs with NULL model_used ──
  console.log('\n=== Recent instrumented runs with NULL model_used (last 5) ===\n');
  const instrSamples = await client.query(`
    SELECT id, agent_id, task, status, actual_model, model_used, routing_model,
           cost, total_cost_usd, llm_cost_usd, cost_source,
           total_input_tokens, total_output_tokens,
           created_at
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '7 days'
      AND model_used IS NULL
      AND cost_source = 'instrumented'
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.table(instrSamples.rows);

  // ── 7. Haiku negative cost investigation ──
  console.log('\n=== Haiku Runs — Cost breakdown (Last 30d) ===\n');
  const haiku = await client.query(`
    SELECT agent_id, status, 
           total_input_tokens, total_output_tokens, total_thinking_tokens,
           cost, llm_cost_usd, total_cost_usd, total_tool_cost_usd,
           cost_source, model_used, routing_model, actual_model
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND (model_used ILIKE '%haiku%' OR routing_model ILIKE '%haiku%' OR actual_model ILIKE '%haiku%')
    ORDER BY COALESCE(total_cost_usd, cost, 0) ASC
    LIMIT 15
  `);
  console.table(haiku.rows);

  // ── 8. model_used vs actual_model comparison ──
  console.log('\n=== model_used vs actual_model mismatch count (Last 30d) ===\n');
  const mismatch = await client.query(`
    SELECT 
      COUNT(*) AS total,
      COUNT(CASE WHEN model_used IS NOT NULL AND actual_model IS NOT NULL AND model_used != actual_model THEN 1 END) AS mismatched,
      COUNT(CASE WHEN model_used IS NOT NULL AND actual_model IS NULL THEN 1 END) AS model_used_only,
      COUNT(CASE WHEN model_used IS NULL AND actual_model IS NOT NULL THEN 1 END) AS actual_model_only,
      COUNT(CASE WHEN model_used IS NOT NULL AND actual_model IS NOT NULL AND model_used = actual_model THEN 1 END) AS matched,
      COUNT(CASE WHEN model_used IS NULL AND actual_model IS NULL THEN 1 END) AS both_null
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
  `);
  console.table(mismatch.rows);

  await client.end();
}
main().catch(console.error);

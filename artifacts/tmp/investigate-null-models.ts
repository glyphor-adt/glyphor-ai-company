import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // ── 1. NULL model_used: which agents, and do they have routing_model? ──
  console.log('=== NULL model_used — Breakdown (Last 30d) ===\n');
  const nullBreakdown = await client.query(`
    SELECT agent_id,
           COUNT(*) AS runs,
           COUNT(CASE WHEN routing_model IS NOT NULL THEN 1 END) AS has_routing_model,
           COUNT(CASE WHEN model IS NOT NULL THEN 1 END) AS has_model_col,
           COUNT(CASE WHEN actual_model IS NOT NULL THEN 1 END) AS has_actual_model,
           COUNT(CASE WHEN cost IS NOT NULL AND cost > 0 THEN 1 END) AS has_cost,
           COUNT(CASE WHEN total_cost_usd IS NOT NULL AND total_cost_usd > 0 THEN 1 END) AS has_total_cost,
           COUNT(CASE WHEN llm_cost_usd IS NOT NULL AND llm_cost_usd > 0 THEN 1 END) AS has_llm_cost,
           COUNT(CASE WHEN cost_source IS NOT NULL THEN 1 END) AS has_cost_source,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS est_cost
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND model_used IS NULL
    GROUP BY agent_id
    ORDER BY runs DESC
  `);
  console.table(nullBreakdown.rows);

  // ── 2. Which columns are populated for runs WITH model_used? ──
  console.log('\n=== HAS model_used — Data quality (Last 30d) ===\n');
  const withModel = await client.query(`
    SELECT agent_id,
           COUNT(*) AS runs,
           COUNT(CASE WHEN routing_model IS NOT NULL THEN 1 END) AS has_routing_model,
           COUNT(CASE WHEN actual_model IS NOT NULL THEN 1 END) AS has_actual_model,
           COUNT(CASE WHEN total_cost_usd IS NOT NULL AND total_cost_usd > 0 THEN 1 END) AS has_total_cost,
           COUNT(CASE WHEN cost_source = 'instrumented' THEN 1 END) AS instrumented,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS est_cost
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND model_used IS NOT NULL
    GROUP BY agent_id
    ORDER BY runs DESC
  `);
  console.table(withModel.rows);

  // ── 3. Cost source breakdown ──
  console.log('\n=== Cost Source Breakdown (Last 30d) ===\n');
  const costSource = await client.query(`
    SELECT COALESCE(cost_source, 'NULL') AS cost_source,
           COUNT(*) AS runs,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 2) AS total_cost,
           COUNT(CASE WHEN model_used IS NOT NULL THEN 1 END) AS has_model_used
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY COALESCE(cost_source, 'NULL')
    ORDER BY runs DESC
  `);
  console.table(costSource.rows);

  // ── 4. Check: runs where model IS populated but model_used is not ──
  console.log('\n=== Has "model" column but NOT "model_used" — top models (Last 30d) ===\n');
  const modelGap = await client.query(`
    SELECT model, 
           COUNT(*) AS runs,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS est_cost
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND model_used IS NULL
      AND model IS NOT NULL
    GROUP BY model
    ORDER BY runs DESC
    LIMIT 20
  `);
  console.table(modelGap.rows);

  // ── 5. Check: runs where routing_model IS populated but model_used is not ──
  console.log('\n=== Has "routing_model" but NOT "model_used" — top routing models (Last 30d) ===\n');
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

  // ── 6. Sample NULL model_used runs — check what data IS there ──
  console.log('\n=== Sample NULL model_used runs (most recent 10) ===\n');
  const samples = await client.query(`
    SELECT id, agent_id, task, status, model, actual_model, model_used, routing_model,
           cost, total_cost_usd, llm_cost_usd, cost_source,
           total_input_tokens, total_output_tokens,
           created_at
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '7 days'
      AND model_used IS NULL
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.table(samples.rows);

  // ── 7. The haiku negative cost investigation ──
  console.log('\n=== Haiku Runs — Cost distribution (Last 30d) ===\n');
  const haiku = await client.query(`
    SELECT agent_id, status, 
           total_input_tokens, total_output_tokens, total_thinking_tokens,
           cost, llm_cost_usd, total_cost_usd, cost_source,
           model_used, routing_model, model
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND (model_used ILIKE '%haiku%' OR routing_model ILIKE '%haiku%' OR model ILIKE '%haiku%')
    ORDER BY cost ASC
    LIMIT 15
  `);
  console.table(haiku.rows);

  await client.end();
}
main().catch(console.error);

import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Yesterday's Gemini costs by agent — using agent_runs estimated costs
  console.log('=== Gemini Agent Runs — Yesterday ===\n');
  const byAgent = await client.query(`
    SELECT agent_id,
           COALESCE(model_used, routing_model) AS model,
           COUNT(*) AS runs,
           SUM(total_input_tokens) AS input_tokens,
           SUM(total_output_tokens) AS output_tokens,
           SUM(total_thinking_tokens) AS thinking_tokens,
           SUM(cached_input_tokens) AS cached_tokens,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS estimated_cost
    FROM agent_runs
    WHERE created_at >= (CURRENT_DATE - 1)
      AND created_at < CURRENT_DATE
      AND (COALESCE(model_used, routing_model, '') ILIKE '%gemini%')
    GROUP BY agent_id, COALESCE(model_used, routing_model)
    ORDER BY estimated_cost DESC
  `);
  console.table(byAgent.rows);

  // Totals
  console.log('\n=== Gemini Totals — Yesterday ===\n');
  const totals = await client.query(`
    SELECT 
      COUNT(*) AS total_runs,
      SUM(total_input_tokens) AS total_input,
      SUM(total_output_tokens) AS total_output,
      SUM(total_thinking_tokens) AS total_thinking,
      ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS total_estimated
    FROM agent_runs
    WHERE created_at >= (CURRENT_DATE - 1)
      AND created_at < CURRENT_DATE
      AND (COALESCE(model_used, routing_model, '') ILIKE '%gemini%')
  `);
  console.table(totals.rows);

  // Compare to actual GCP Gemini billing for yesterday
  console.log('\n=== Actual GCP Gemini Billing — Yesterday ===\n');
  const actual = await client.query(`
    SELECT service, product, cost_usd
    FROM gcp_billing
    WHERE service = 'gemini-api'
      AND (usage->>'date')::date = (CURRENT_DATE - 1)
  `);
  console.table(actual.rows);

  // Also show model breakdown
  console.log('\n=== Gemini Model Breakdown — Yesterday ===\n');
  const byModel = await client.query(`
    SELECT COALESCE(model_used, routing_model) AS model,
           COUNT(*) AS runs,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS estimated_cost
    FROM agent_runs
    WHERE created_at >= (CURRENT_DATE - 1)
      AND created_at < CURRENT_DATE
      AND (COALESCE(model_used, routing_model, '') ILIKE '%gemini%')
    GROUP BY COALESCE(model_used, routing_model)
    ORDER BY estimated_cost DESC
  `);
  console.table(byModel.rows);

  await client.end();
}
main().catch(console.error);

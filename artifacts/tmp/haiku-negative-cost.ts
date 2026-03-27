import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Check cached_input_tokens vs total_input_tokens for haiku
  console.log('=== Haiku Negative Cost — Token Breakdown ===\n');
  const haiku = await client.query(`
    SELECT id, agent_id, 
           total_input_tokens, cached_input_tokens, total_output_tokens,
           cost, llm_cost_usd, model_used, routing_model
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND model_used = 'claude-haiku-4-5'
      AND cost < 0
    ORDER BY cost ASC
    LIMIT 10
  `);
  console.table(haiku.rows);

  // Also check: is the column `cached_input_tokens` or is it computed?
  console.log('\n=== Cached vs Input Token ratio for ALL runs with negative cost ===\n');
  const negCost = await client.query(`
    SELECT model_used, routing_model,
           total_input_tokens, cached_input_tokens, total_output_tokens, total_thinking_tokens,
           cost, llm_cost_usd
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND (cost < 0 OR llm_cost_usd < 0 OR total_cost_usd < 0)
    ORDER BY cost ASC
    LIMIT 15
  `);
  console.table(negCost.rows);

  await client.end();
}
main().catch(console.error);

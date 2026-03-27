import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const ACTUAL_BILL = 76.39; // User's actual Gemini bill for Mar 25

  // 1. Detailed token counts by Gemini model for Mar 25
  console.log('=== Gemini Token Usage by Model — Mar 25 ===\n');
  const byModel = await client.query(`
    SELECT COALESCE(model_used, routing_model) AS model,
           COUNT(*) AS runs,
           SUM(total_input_tokens) AS input_tokens,
           SUM(cached_input_tokens) AS cached_tokens,
           SUM(total_output_tokens) AS output_tokens,
           SUM(total_thinking_tokens) AS thinking_tokens,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS current_estimate
    FROM agent_runs
    WHERE created_at >= '2026-03-25' AND created_at < '2026-03-26'
      AND (COALESCE(model_used, routing_model, '') ILIKE '%gemini%')
    GROUP BY COALESCE(model_used, routing_model)
    ORDER BY input_tokens DESC NULLS LAST
  `);
  console.table(byModel.rows);

  // 2. Total token counts across all Gemini runs
  console.log('\n=== Gemini Total Tokens — Mar 25 ===\n');
  const totals = await client.query(`
    SELECT 
      COUNT(*) AS runs,
      SUM(total_input_tokens) AS total_input,
      SUM(cached_input_tokens) AS total_cached,
      SUM(total_output_tokens) AS total_output,
      SUM(total_thinking_tokens) AS total_thinking,
      SUM(total_input_tokens) + SUM(total_output_tokens) + SUM(COALESCE(total_thinking_tokens,0)) AS grand_total_tokens,
      ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS current_estimate
    FROM agent_runs
    WHERE created_at >= '2026-03-25' AND created_at < '2026-03-26'
      AND (COALESCE(model_used, routing_model, '') ILIKE '%gemini%')
  `);
  console.table(totals.rows);

  const row = totals.rows[0];
  const totalInput = Number(row.total_input || 0);
  const totalCached = Number(row.total_cached || 0);
  const totalOutput = Number(row.total_output || 0);
  const totalThinking = Number(row.total_thinking || 0);
  const currentEstimate = Number(row.current_estimate || 0);

  console.log(`\n=== REVERSE-ENGINEERED RATES ===\n`);
  console.log(`Actual Gemini bill (user):  $${ACTUAL_BILL}`);
  console.log(`BQ export (pre-discount):   $96.80`);
  console.log(`Current estimate:           $${currentEstimate.toFixed(2)}`);
  console.log(`Gap vs actual:              $${(ACTUAL_BILL - currentEstimate).toFixed(2)} (${((currentEstimate / ACTUAL_BILL) * 100).toFixed(1)}% coverage)\n`);

  console.log(`Total input tokens:    ${totalInput.toLocaleString()}`);
  console.log(`  of which cached:     ${totalCached.toLocaleString()}`);
  console.log(`  uncached input:      ${(totalInput - totalCached).toLocaleString()}`);
  console.log(`Total output tokens:   ${totalOutput.toLocaleString()}`);
  console.log(`Total thinking tokens: ${totalThinking.toLocaleString()}`);
  console.log(`Grand total tokens:    ${(totalInput + totalOutput + totalThinking).toLocaleString()}\n`);

  // Method 1: Simple blended rate (all tokens treated equally)
  const allTokens = totalInput + totalOutput + totalThinking;
  const blendedRate = (ACTUAL_BILL / allTokens) * 1_000_000;
  console.log(`--- Method 1: Blended rate (all tokens equal) ---`);
  console.log(`$${ACTUAL_BILL} / ${(allTokens / 1_000_000).toFixed(1)}M tokens = $${blendedRate.toFixed(2)} per 1M tokens\n`);

  // Method 2: Assume 3:1 output:input ratio (typical Gemini pricing), solve for base
  // cost = input * R_in + output * R_out + thinking * R_think
  // Gemini charges output at ~6x input, thinking at ~6x input
  // So: cost = (input - cached) * R + cached * R * 0.25 + output * 6R + thinking * 6R
  // Then: R = cost / ((input - cached) + cached*0.25 + output*6 + thinking*6)
  const uncachedInput = totalInput - totalCached;
  const weightedDenom = uncachedInput + (totalCached * 0.25) + (totalOutput * 6) + (totalThinking * 6);
  const impliedInputRate = (ACTUAL_BILL / weightedDenom) * 1_000_000;
  const impliedOutputRate = impliedInputRate * 6;
  console.log(`--- Method 2: Assuming 6:1 output:input ratio (Gemini standard) ---`);
  console.log(`Implied input rate:    $${impliedInputRate.toFixed(2)} per 1M tokens`);
  console.log(`Implied output rate:   $${impliedOutputRate.toFixed(2)} per 1M tokens`);
  console.log(`Implied thinking rate: $${impliedOutputRate.toFixed(2)} per 1M tokens`);
  
  // Verify
  const verifyMethodTwo = (
    (uncachedInput * impliedInputRate / 1_000_000) +
    (totalCached * impliedInputRate * 0.25 / 1_000_000) +
    (totalOutput * impliedOutputRate / 1_000_000) +
    (totalThinking * impliedOutputRate / 1_000_000)
  );
  console.log(`Verification: $${verifyMethodTwo.toFixed(2)} (should = $${ACTUAL_BILL})\n`);

  // Method 3: Using current SUPPORTED_MODELS rates for gemini-3-flash-preview ($0.50 / $3.00)
  // Compare what the cost SHOULD be at those rates
  const officialEstimate = (
    (uncachedInput * 0.50 / 1_000_000) +
    (totalCached * 0.50 * 0.10 / 1_000_000) +   // 10% cache discount
    (totalOutput * 3.00 / 1_000_000) +
    (totalThinking * 3.00 / 1_000_000)
  );
  console.log(`--- Method 3: At current SUPPORTED_MODELS rates (input=$0.50, output=$3.00) ---`);
  console.log(`Expected cost:    $${officialEstimate.toFixed(2)}`);
  console.log(`Actual bill:      $${ACTUAL_BILL}`);
  console.log(`Multiplier:       ${(ACTUAL_BILL / officialEstimate).toFixed(1)}x\n`);

  // Method 4: What if rates should be from Google's actual pricing page?
  // gemini-2.0-flash: input $0.10, output $0.40, thinking $0.40 per 1M
  // gemini-1.5-flash: input $0.075, output $0.30
  // gemini-1.5-pro: input $1.25, output $5.00
  // But Gemini 3-flash-preview pricing isn't public yet, could be higher
  
  // Let's calculate what multiplier on BOTH input and output makes it match
  const currentRateEstimate = officialEstimate;
  const rateMultiplier = ACTUAL_BILL / currentRateEstimate;
  console.log(`--- Summary ---`);
  console.log(`Current rates produce:   $${currentRateEstimate.toFixed(2)}`);
  console.log(`Need to multiply by:     ${rateMultiplier.toFixed(2)}x to match $${ACTUAL_BILL}`);
  console.log(`Corrected input rate:    $${(0.50 * rateMultiplier).toFixed(2)} per 1M`);
  console.log(`Corrected output rate:   $${(3.00 * rateMultiplier).toFixed(2)} per 1M`);
  console.log(`Corrected thinking rate: $${(3.00 * rateMultiplier).toFixed(2)} per 1M\n`);

  // 3. Also check: are there Gemini calls outside agent_runs? (GraphRAG, embeddings, etc.)
  console.log('=== Non-Agent Gemini Usage Check ===\n');

  // Check if graphrag-indexer runs exist
  const graphrag = await client.query(`
    SELECT agent_id, COUNT(*) AS runs,
           SUM(total_input_tokens) AS tokens,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS cost
    FROM agent_runs
    WHERE created_at >= '2026-03-25' AND created_at < '2026-03-26'
      AND agent_id ILIKE '%graph%'
    GROUP BY agent_id
  `);
  if (graphrag.rows.length > 0) {
    console.log('GraphRAG runs found:');
    console.table(graphrag.rows);
  } else {
    console.log('No GraphRAG agent runs on Mar 25');
  }

  // Check for embedding-related calls
  const embeddings = await client.query(`
    SELECT agent_id, task, COUNT(*) AS runs
    FROM agent_runs
    WHERE created_at >= '2026-03-25' AND created_at < '2026-03-26'
      AND (task ILIKE '%embed%' OR task ILIKE '%index%' OR task ILIKE '%graphrag%')
    GROUP BY agent_id, task
  `);
  if (embeddings.rows.length > 0) {
    console.log('Embedding/indexing runs:');
    console.table(embeddings.rows);
  } else {
    console.log('No embedding/indexing runs on Mar 25');
  }

  // 4. Runs per agent on Mar 25 — ALL models, to see the scale
  console.log('\n=== All Runs by Agent — Mar 25 (any model) ===\n');
  const allByAgent = await client.query(`
    SELECT agent_id,
           COUNT(*) AS runs,
           COUNT(CASE WHEN COALESCE(model_used, routing_model, '') ILIKE '%gemini%' THEN 1 END) AS gemini_runs,
           SUM(total_input_tokens) AS total_tokens,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS est_cost
    FROM agent_runs
    WHERE created_at >= '2026-03-25' AND created_at < '2026-03-26'
    GROUP BY agent_id
    ORDER BY est_cost DESC
    LIMIT 20
  `);
  console.table(allByAgent.rows);

  await client.end();
}
main().catch(console.error);

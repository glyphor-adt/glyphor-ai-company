import pg from 'pg';
const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // 1. GCP billing for Gemini on Mar 25
  console.log('=== GCP Billing — Gemini API on Mar 25 ===\n');
  const gemini = await client.query(`
    SELECT service, product, ROUND(cost_usd::numeric, 4) AS cost_usd, usage
    FROM gcp_billing
    WHERE usage->>'date' = '2026-03-25'
      AND service ILIKE '%gemini%'
  `);
  console.table(gemini.rows.map(r => ({ service: r.service, product: r.product, cost_usd: r.cost_usd })));
  if (gemini.rows.length > 0) {
    console.log('Usage detail:', JSON.stringify(gemini.rows[0].usage, null, 2));
  }

  // 2. All GCP billing for Mar 25
  console.log('\n=== ALL GCP Billing — Mar 25 ===\n');
  const all = await client.query(`
    SELECT service, product, ROUND(cost_usd::numeric, 4) AS cost_usd
    FROM gcp_billing
    WHERE usage->>'date' = '2026-03-25'
    ORDER BY cost_usd DESC
  `);
  console.table(all.rows);

  // 3. Count embedding calls — memories saved on Mar 25
  console.log('\n=== Memory Saves (embedding calls) on Mar 25 ===\n');
  const memories = await client.query(`
    SELECT agent_id, COUNT(*) AS memories_saved
    FROM agent_memory
    WHERE created_at >= '2026-03-25' AND created_at < '2026-03-26'
    GROUP BY agent_id
    ORDER BY memories_saved DESC
  `);
  console.table(memories.rows);
  const totalMemories = memories.rows.reduce((sum: number, r: { memories_saved: string }) => sum + parseInt(r.memories_saved), 0);
  console.log(`Total memories saved: ${totalMemories}`);

  // 4. Total agent runs on Mar 25 (each generates 1 JIT embedding call)
  const runs = await client.query(`
    SELECT COUNT(*) AS total_runs
    FROM agent_runs
    WHERE created_at >= '2026-03-25' AND created_at < '2026-03-26'
  `);
  const totalRuns = parseInt(runs.rows[0].total_runs);
  console.log(`\nTotal agent runs on Mar 25: ${totalRuns}`);
  
  // Estimate embedding token usage
  // JIT: ~200 tokens per task embedding
  // Memory save: ~150 tokens per memory embedding
  const jitTokens = totalRuns * 200;
  const memTokens = totalMemories * 150;
  const totalEmbedTokens = jitTokens + memTokens;
  // gemini-embedding-001 @ $0.15/1M tokens
  const embeddingCost = (totalEmbedTokens / 1_000_000) * 0.15;
  
  console.log(`\nEstimated embedding usage:`);
  console.log(`  JIT embeddings: ${totalRuns} calls × ~200 tokens = ${jitTokens.toLocaleString()} tokens`);
  console.log(`  Memory embeddings: ${totalMemories} calls × ~150 tokens = ${memTokens.toLocaleString()} tokens`);
  console.log(`  Total embedding tokens: ${totalEmbedTokens.toLocaleString()}`);
  console.log(`  Estimated embedding cost: $${embeddingCost.toFixed(4)}`);

  // 5. Direct Gemini tool calls (enhance_video_prompt, profile generation)
  console.log('\n=== Direct Gemini Tool Calls on Mar 25 ===\n');
  const directCalls = await client.query(`
    SELECT agent_id, task, 
           total_input_tokens, total_output_tokens
    FROM agent_runs
    WHERE created_at >= '2026-03-25' AND created_at < '2026-03-26'
      AND (task ILIKE '%video%' OR task ILIKE '%profile%' OR task ILIKE '%enhance%prompt%')
    ORDER BY created_at
  `);
  if (directCalls.rows.length > 0) {
    console.table(directCalls.rows);
  } else {
    console.log('No video/profile tasks found on Mar 25');
  }

  // 6. Summary
  console.log('\n=== COST RECONCILIATION SUMMARY ===\n');
  const geminiActual = gemini.rows.length > 0 ? parseFloat(gemini.rows[0].cost_usd) : 0;
  console.log(`GCP Gemini bill (Mar 25): $${geminiActual.toFixed(2)}`);
  console.log(`Estimated embedding cost: $${embeddingCost.toFixed(4)}`);
  console.log(`Generation cost (bill - embedding): $${(geminiActual - embeddingCost).toFixed(2)}`);
  console.log(`Agent run estimate (current rates): $14.97`);
  
  const genCost = geminiActual - embeddingCost;
  const multiplier = genCost / 14.97;
  console.log(`\nAdjusted multiplier (excluding embeddings): ${multiplier.toFixed(2)}x`);
  console.log(`Current rates: input=$0.50, output=$3.00, thinking=$3.00 per 1M`);
  console.log(`Adjusted rates: input=$${(0.50 * multiplier).toFixed(2)}, output=$${(3.00 * multiplier).toFixed(2)}, thinking=$${(3.00 * multiplier).toFixed(2)} per 1M`);

  await client.end();
}
main().catch(console.error);

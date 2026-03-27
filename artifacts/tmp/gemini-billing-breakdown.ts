import pg from 'pg';
const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // 1. Check GCP billing detail for Mar 25 — all Gemini-related SKUs
  console.log('=== GCP Billing Detail for Gemini on Mar 25 ===\n');
  const detail = await client.query(`
    SELECT service, product, 
           ROUND(cost_usd::numeric, 4) AS cost_usd,
           usage
    FROM gcp_billing
    WHERE billing_date >= '2026-03-25' AND billing_date < '2026-03-26'
      AND (service ILIKE '%gemini%' OR service ILIKE '%vertex%' OR service ILIKE '%generative%' 
           OR service ILIKE '%ai platform%' OR product ILIKE '%gemini%')
    ORDER BY cost_usd DESC
  `);
  console.table(detail.rows);

  // 2. Check ALL GCP billing for Mar 25 to see full picture
  console.log('\n=== ALL GCP Billing — Mar 25 ===\n');
  const all = await client.query(`
    SELECT service, product,
           ROUND(SUM(cost_usd)::numeric, 4) AS total_cost
    FROM gcp_billing
    WHERE billing_date >= '2026-03-25' AND billing_date < '2026-03-26'
    GROUP BY service, product
    ORDER BY total_cost DESC
  `);
  console.table(all.rows);

  // 3. What does the 'usage' JSONB contain for Gemini entries?
  console.log('\n=== Gemini Usage JSONB Samples ===\n');
  const usage = await client.query(`
    SELECT service, product, usage, ROUND(cost_usd::numeric, 4) AS cost_usd
    FROM gcp_billing
    WHERE billing_date >= '2026-03-25' AND billing_date < '2026-03-26'
      AND (service ILIKE '%gemini%' OR product ILIKE '%gemini%')
    LIMIT 10
  `);
  for (const row of usage.rows) {
    console.log(`Service: ${row.service}, Product: ${row.product}, Cost: $${row.cost_usd}`);
    console.log('Usage:', JSON.stringify(row.usage, null, 2));
    console.log('---');
  }

  // 4. Count embedding calls — how many memories were saved on Mar 25?
  console.log('\n=== Memory Saves (embedding calls) on Mar 25 ===\n');
  const memories = await client.query(`
    SELECT am.agent_id, COUNT(*) AS memories_saved
    FROM agent_memory am
    WHERE am.created_at >= '2026-03-25' AND am.created_at < '2026-03-26'
    GROUP BY am.agent_id
    ORDER BY memories_saved DESC
  `);
  console.table(memories.rows);
  const totalMemories = memories.rows.reduce((sum: number, r: { memories_saved: string }) => sum + parseInt(r.memories_saved), 0);
  console.log(`Total memories saved: ${totalMemories}`);

  // 5. How many total agent runs? (each does 1 JIT embedding call)
  const runs = await client.query(`
    SELECT COUNT(*) AS total_runs
    FROM agent_runs
    WHERE created_at >= '2026-03-25' AND created_at < '2026-03-26'
  `);
  console.log(`\nTotal agent runs on Mar 25: ${runs.rows[0].total_runs}`);
  console.log(`Estimated embedding calls: ${parseInt(runs.rows[0].total_runs) + totalMemories} (runs + memory saves)`);

  // Gemini embedding-001 pricing: $0.15 per 1M tokens
  // Average task text ≈ 200 tokens, average memory ≈ 100 tokens
  const embeddingTokens = parseInt(runs.rows[0].total_runs) * 200 + totalMemories * 100;
  const embeddingCost = (embeddingTokens / 1_000_000) * 0.15;
  console.log(`Estimated embedding tokens: ${embeddingTokens.toLocaleString()}`);
  console.log(`Estimated embedding cost: $${embeddingCost.toFixed(4)}`);

  await client.end();
}
main().catch(console.error);

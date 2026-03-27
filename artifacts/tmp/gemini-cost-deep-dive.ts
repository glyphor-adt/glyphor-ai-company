import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // 1. All GCP billing for March 25 — not just gemini-api
  console.log('=== ALL GCP Billing for Mar 25 ===\n');
  const allGcp = await client.query(`
    SELECT service, product, cost_usd
    FROM gcp_billing
    WHERE (usage->>'date')::date = '2026-03-25'
    ORDER BY cost_usd DESC
  `);
  console.table(allGcp.rows);
  
  const total = allGcp.rows.reduce((s: number, r: any) => s + Number(r.cost_usd), 0);
  console.log(`Total GCP for Mar 25: $${total.toFixed(4)}`);

  // 2. When was the last billing sync?
  console.log('\n=== Most Recent GCP Billing Dates ===\n');
  const recentDates = await client.query(`
    SELECT (usage->>'date')::date AS billing_date,
           COUNT(*) AS rows,
           ROUND(SUM(cost_usd)::numeric, 2) AS total_cost,
           MAX(recorded_at) AS last_recorded
    FROM gcp_billing
    WHERE recorded_at >= NOW() - INTERVAL '14 days'
    GROUP BY (usage->>'date')::date
    ORDER BY billing_date DESC
    LIMIT 14
  `);
  console.table(recentDates.rows);

  // 3. Check all Gemini-related services across ALL projects for Mar 25
  console.log('\n=== ALL Gemini/Vertex/AI services for Mar 25 ===\n');
  const geminiAll = await client.query(`
    SELECT service, product, project, cost_usd, usage
    FROM gcp_billing
    WHERE (usage->>'date')::date = '2026-03-25'
      AND (service ILIKE '%gemini%' OR service ILIKE '%vertex%' OR service ILIKE '%ai%')
    ORDER BY cost_usd DESC
  `);
  console.table(geminiAll.rows);

  // 4. Check the raw project values to see if anything is missing
  console.log('\n=== Distinct projects in gcp_billing (last 7d) ===\n');
  const projects = await client.query(`
    SELECT DISTINCT project, product, 
           usage->>'project' AS raw_project
    FROM gcp_billing
    WHERE recorded_at >= NOW() - INTERVAL '7 days'
    ORDER BY project
  `);
  console.table(projects.rows);

  // 5. Total agent_runs Gemini estimated cost for Mar 25
  console.log('\n=== Agent Runs Gemini Estimated — Mar 25 ===\n');
  const agentEst = await client.query(`
    SELECT 
      ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS estimated,
      COUNT(*) AS runs,
      SUM(total_input_tokens) AS input_tokens,
      SUM(total_output_tokens) AS output_tokens,
      SUM(total_thinking_tokens) AS thinking_tokens
    FROM agent_runs
    WHERE created_at >= '2026-03-25' AND created_at < '2026-03-26'
      AND (COALESCE(model_used, routing_model, '') ILIKE '%gemini%')
  `);
  console.table(agentEst.rows);

  // 6. ALL agent runs (any model) for Mar 25 — see the total
  console.log('\n=== ALL Agent Runs Cost (any model) — Mar 25 ===\n');
  const allAgent = await client.query(`
    SELECT 
      ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS total_estimated,
      COUNT(*) AS total_runs,
      COUNT(CASE WHEN COALESCE(model_used, routing_model, '') ILIKE '%gemini%' THEN 1 END) AS gemini_runs,
      COUNT(CASE WHEN model_used IS NULL AND routing_model IS NULL THEN 1 END) AS unattributed_runs,
      ROUND(SUM(CASE WHEN model_used IS NULL AND routing_model IS NULL 
                THEN COALESCE(total_cost_usd, cost, 0) ELSE 0 END)::numeric, 4) AS unattributed_cost
    FROM agent_runs
    WHERE created_at >= '2026-03-25' AND created_at < '2026-03-26'
  `);
  console.table(allAgent.rows);

  // 7. Unattributed runs with tokens — these might be Gemini
  console.log('\n=== Unattributed Runs WITH tokens (likely Gemini via model-router) — Mar 25 ===\n');
  const unattr = await client.query(`
    SELECT agent_id,
           COUNT(*) AS runs,
           SUM(total_input_tokens) AS input_tokens,
           SUM(total_output_tokens) AS output_tokens,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS est_cost
    FROM agent_runs
    WHERE created_at >= '2026-03-25' AND created_at < '2026-03-26'
      AND model_used IS NULL AND routing_model IS NULL
      AND total_input_tokens > 0
    GROUP BY agent_id
    ORDER BY est_cost DESC
  `);
  console.table(unattr.rows);

  // 8. Unattributed runs WITHOUT tokens — cost comes from where?
  console.log('\n=== Unattributed Runs WITHOUT tokens — Mar 25 ===\n');
  const noTokens = await client.query(`
    SELECT agent_id,
           COUNT(*) AS runs,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS est_cost
    FROM agent_runs
    WHERE created_at >= '2026-03-25' AND created_at < '2026-03-26'
      AND model_used IS NULL AND routing_model IS NULL
      AND (total_input_tokens IS NULL OR total_input_tokens = 0)
    GROUP BY agent_id
    ORDER BY est_cost DESC
  `);
  console.table(noTokens.rows);

  await client.end();
}
main().catch(console.error);

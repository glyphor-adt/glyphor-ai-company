import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // ── 1. Actual API billing by provider+model (last 30 days) ────────
  console.log('=== ACTUAL BILLING — By Provider/Model (Last 30d) ===\n');
  const actual = await client.query(`
    SELECT provider, service AS model,
           SUM(cost_usd) AS actual_cost
    FROM api_billing
    WHERE recorded_at >= NOW() - INTERVAL '30 days'
    GROUP BY provider, service
    ORDER BY actual_cost DESC
  `);
  console.table(actual.rows);

  // ── 2. Actual Gemini billing from GCP (this is missing from api_billing) ──
  console.log('\n=== ACTUAL GCP — Gemini API Cost (Last 30d) ===\n');
  const geminiActual = await client.query(`
    SELECT service, product, SUM(cost_usd) AS actual_cost
    FROM gcp_billing
    WHERE service = 'gemini-api'
      AND recorded_at >= NOW() - INTERVAL '30 days'
    GROUP BY service, product
    ORDER BY actual_cost DESC
  `);
  console.table(geminiActual.rows);

  // ── 3. Agent runs estimated costs by model_used (last 30 days) ────
  console.log('\n=== AGENT RUNS — Estimated Cost by model_used (Last 30d) ===\n');
  const estByModel = await client.query(`
    SELECT COALESCE(model_used, routing_model, 'unknown') AS model,
           COUNT(*) AS runs,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS estimated_cost,
           ROUND(AVG(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS avg_per_run
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY COALESCE(model_used, routing_model, 'unknown')
    ORDER BY estimated_cost DESC
  `);
  console.table(estByModel.rows);

  // ── 4. Agent runs estimated costs by agent_id (last 30 days) ──────
  console.log('\n=== AGENT RUNS — Estimated Cost by Agent (Last 30d) ===\n');
  const estByAgent = await client.query(`
    SELECT agent_id,
           COALESCE(model_used, routing_model, 'unknown') AS primary_model,
           COUNT(*) AS runs,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS estimated_cost
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY agent_id, COALESCE(model_used, routing_model, 'unknown')
    ORDER BY estimated_cost DESC
    LIMIT 30
  `);
  console.table(estByAgent.rows);

  // ── 5. Provider-level reconciliation ──────────────────────────────
  console.log('\n=== RECONCILIATION — Actual vs Estimated by Provider (Last 30d) ===\n');

  // Map model_used values → providers
  const recon = await client.query(`
    WITH actual AS (
      SELECT provider, SUM(cost_usd) AS actual_cost
      FROM api_billing
      WHERE recorded_at >= NOW() - INTERVAL '30 days'
      GROUP BY provider
      UNION ALL
      SELECT 'google' AS provider, SUM(cost_usd) AS actual_cost
      FROM gcp_billing
      WHERE service = 'gemini-api'
        AND recorded_at >= NOW() - INTERVAL '30 days'
    ),
    estimated AS (
      SELECT
        CASE
          WHEN COALESCE(model_used, routing_model, '') ILIKE '%gemini%' THEN 'google'
          WHEN COALESCE(model_used, routing_model, '') ILIKE '%gpt%' THEN 'openai'
          WHEN COALESCE(model_used, routing_model, '') ILIKE '%claude%' THEN 'anthropic'
          WHEN COALESCE(model_used, routing_model, '') ILIKE '%o1%' OR COALESCE(model_used, routing_model, '') ILIKE '%o3%' OR COALESCE(model_used, routing_model, '') ILIKE '%o4%' THEN 'openai'
          ELSE 'unknown'
        END AS provider,
        SUM(COALESCE(total_cost_usd, cost, 0)) AS estimated_cost,
        COUNT(*) AS runs
      FROM agent_runs
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY 1
    )
    SELECT
      COALESCE(a.provider, e.provider) AS provider,
      ROUND(COALESCE(a.actual_cost, 0)::numeric, 2) AS actual_cost,
      ROUND(COALESCE(e.estimated_cost, 0)::numeric, 2) AS estimated_cost,
      COALESCE(e.runs, 0) AS runs,
      ROUND((COALESCE(a.actual_cost, 0) - COALESCE(e.estimated_cost, 0))::numeric, 2) AS gap,
      CASE WHEN COALESCE(e.estimated_cost, 0) > 0
           THEN ROUND(((COALESCE(a.actual_cost, 0) / e.estimated_cost) * 100)::numeric, 1)
           ELSE NULL END AS actual_pct_of_est
    FROM actual a
    FULL OUTER JOIN estimated e ON a.provider = e.provider
    ORDER BY actual_cost DESC NULLS LAST
  `);
  console.table(recon.rows);

  // ── 6. Check what model_used values exist that don't map to a provider ──
  console.log('\n=== UNMAPPED MODELS in agent_runs (Last 30d) ===\n');
  const unmapped = await client.query(`
    SELECT COALESCE(model_used, routing_model, 'NULL') AS model,
           COUNT(*) AS runs,
           ROUND(SUM(COALESCE(total_cost_usd, cost, 0))::numeric, 4) AS estimated_cost
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND COALESCE(model_used, routing_model, '') NOT ILIKE '%gemini%'
      AND COALESCE(model_used, routing_model, '') NOT ILIKE '%gpt%'
      AND COALESCE(model_used, routing_model, '') NOT ILIKE '%claude%'
      AND COALESCE(model_used, routing_model, '') NOT ILIKE '%o1%'
      AND COALESCE(model_used, routing_model, '') NOT ILIKE '%o3%'
      AND COALESCE(model_used, routing_model, '') NOT ILIKE '%o4%'
    GROUP BY COALESCE(model_used, routing_model, 'NULL')
    ORDER BY estimated_cost DESC
  `);
  console.table(unmapped.rows);

  // ── 7. Token data availability check ──────────────────────────────
  console.log('\n=== TOKEN DATA AVAILABILITY (Last 30d) ===\n');
  const tokenCheck = await client.query(`
    SELECT
      COUNT(*) AS total_runs,
      COUNT(CASE WHEN input_tokens IS NOT NULL AND input_tokens > 0 THEN 1 END) AS has_input_tokens,
      COUNT(CASE WHEN output_tokens IS NOT NULL AND output_tokens > 0 THEN 1 END) AS has_output_tokens,
      COUNT(CASE WHEN cost IS NOT NULL AND cost > 0 THEN 1 END) AS has_cost,
      COUNT(CASE WHEN total_cost_usd IS NOT NULL AND total_cost_usd > 0 THEN 1 END) AS has_total_cost_usd,
      COUNT(CASE WHEN model_used IS NOT NULL THEN 1 END) AS has_model_used,
      COUNT(CASE WHEN routing_model IS NOT NULL THEN 1 END) AS has_routing_model
    FROM agent_runs
    WHERE created_at >= NOW() - INTERVAL '30 days'
  `);
  console.table(tokenCheck.rows);

  await client.end();
}
main().catch(console.error);

import { Client } from 'pg';

async function main() {
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// 1. API Billing — last 30 days by provider, grouped by day
console.log('=== API BILLING — Last 30 Days by Provider ===\n');
const apiByProvider = await client.query(`
  SELECT provider,
         COUNT(*) AS rows,
         SUM(cost_usd) AS total_cost,
         MIN(recorded_at::date) AS earliest,
         MAX(recorded_at::date) AS latest
  FROM api_billing
  WHERE recorded_at >= NOW() - INTERVAL '30 days'
  GROUP BY provider
  ORDER BY total_cost DESC
`);
console.table(apiByProvider.rows);

// 2. API Billing — daily totals by provider (last 14 days)
console.log('\n=== API BILLING — Daily by Provider (Last 14 Days) ===\n');
const apiDaily = await client.query(`
  SELECT (usage->>'date')::date AS day,
         provider,
         SUM(cost_usd) AS cost_usd,
         COUNT(*) AS line_items
  FROM api_billing
  WHERE recorded_at >= NOW() - INTERVAL '14 days'
  GROUP BY (usage->>'date')::date, provider
  ORDER BY day DESC, cost_usd DESC
`);
console.table(apiDaily.rows);

// 3. API Billing — top models/services (last 30 days)
console.log('\n=== API BILLING — Top Models/Services (Last 30 Days) ===\n');
const apiModels = await client.query(`
  SELECT provider, service, 
         SUM(cost_usd) AS total_cost,
         COUNT(*) AS days_active
  FROM api_billing
  WHERE recorded_at >= NOW() - INTERVAL '30 days'
  GROUP BY provider, service
  ORDER BY total_cost DESC
  LIMIT 25
`);
console.table(apiModels.rows);

// 4. GCP Billing — last 30 days by service
console.log('\n=== GCP BILLING — Last 30 Days by Service ===\n');
const gcpByService = await client.query(`
  SELECT service,
         product,
         SUM(cost_usd) AS total_cost,
         COUNT(*) AS rows,
         MIN(recorded_at::date) AS earliest,
         MAX(recorded_at::date) AS latest
  FROM gcp_billing
  WHERE recorded_at >= NOW() - INTERVAL '30 days'
  GROUP BY service, product
  ORDER BY total_cost DESC
  LIMIT 25
`);
console.table(gcpByService.rows);

// 5. GCP Billing — daily totals (last 14 days)
console.log('\n=== GCP BILLING — Daily Totals (Last 14 Days) ===\n');
const gcpDaily = await client.query(`
  SELECT (usage->>'date')::date AS day,
         SUM(cost_usd) AS cost_usd,
         COUNT(*) AS services
  FROM gcp_billing
  WHERE recorded_at >= NOW() - INTERVAL '14 days'
  GROUP BY (usage->>'date')::date
  ORDER BY day DESC
`);
console.table(gcpDaily.rows);

// 6. Grand total — all sources, last 30 days
console.log('\n=== GRAND TOTAL — Last 30 Days ===\n');
const grandTotal = await client.query(`
  SELECT 'api_billing' AS source, SUM(cost_usd) AS total_30d
  FROM api_billing WHERE recorded_at >= NOW() - INTERVAL '30 days'
  UNION ALL
  SELECT 'gcp_billing', SUM(cost_usd)
  FROM gcp_billing WHERE recorded_at >= NOW() - INTERVAL '30 days'
  UNION ALL
  SELECT 'agent_runs_estimated', SUM(COALESCE(total_cost_usd, cost, 0))
  FROM agent_runs WHERE created_at >= NOW() - INTERVAL '30 days'
`);
console.table(grandTotal.rows);

await client.end();
}
main().catch(console.error);

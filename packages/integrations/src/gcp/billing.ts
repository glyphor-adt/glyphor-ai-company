/**
 * GCP Billing — Query billing export from BigQuery and sync to Supabase
 */

import { BigQuery } from '@google-cloud/bigquery';
import type { SupabaseClient } from '@supabase/supabase-js';

let bqClient: BigQuery | null = null;

function getBigQueryClient(): BigQuery {
  if (!bqClient) bqClient = new BigQuery();
  return bqClient;
}

/** GCP project → Glyphor product mapping */
const PROJECT_TO_PRODUCT: Record<string, string> = {
  'ai-glyphor-company': 'glyphor',
  'glyphor-pulse': 'pulse',
  'gen-lang-client-0834143721': 'fuse',
};

export interface DailyCost {
  date: string;
  service: string;
  cost: number;
  currency: string;
  project: string;
}

/**
 * Query GCP billing export for cost breakdown by service.
 * Requires billing export to BigQuery to be configured.
 */
export async function queryBillingExport(
  projectId: string,
  billingDataset: string,
  billingTable: string,
  days = 90,
): Promise<DailyCost[]> {
  const bq = getBigQueryClient();

  // First check: does the table have any rows at all?
  const countQuery = `SELECT COUNT(*) as total FROM \`${projectId}.${billingDataset}.${billingTable}\``;
  const [countResult] = await bq.query({ query: countQuery });
  const totalRows = countResult?.[0]?.total ?? 0;
  console.log(`[GCP Billing] Table ${projectId}.${billingDataset}.${billingTable} has ${totalRows} total rows`);

  const query = `
    SELECT
      FORMAT_DATE('%Y-%m-%d', usage_start_time) AS date,
      project.id AS project,
      IFNULL(service.description, 'Unattributed') AS service,
      SUM(cost) AS cost,
      currency
    FROM \`${projectId}.${billingDataset}.${billingTable}\`
    WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
    GROUP BY date, project, service, currency
    ORDER BY date DESC, cost DESC
  `;

  console.log(`[GCP Billing] Querying last ${days} days`);
  const [rows] = await bq.query({ query });

  console.log(`[GCP Billing] Query returned ${rows?.length ?? 0} rows`);
  return (rows as DailyCost[]) ?? [];
}

/** Normalize GCP service names to short slugs for the gcp_billing table */
function slugifyService(description: string): string {
  return description
    .toLowerCase()
    .replace(/google\s+/gi, '')
    .replace(/cloud\s+/gi, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Sync GCP billing data into both:
 *  - `financials` table: daily aggregate infra_cost (for CFO dashboard)
 *  - `gcp_billing` table: per-service per-day rows (for cost-analyst / devops agents)
 */
export async function syncBillingToSupabase(
  supabase: SupabaseClient,
  projectId: string,
  billingDataset: string,
  billingTable: string,
  days = 90,
): Promise<{ synced: number; services: number }> {
  const costs = await queryBillingExport(projectId, billingDataset, billingTable, days);

  // ── 1. Write per-service rows to gcp_billing ──────────────────────────
  let servicesSynced = 0;
  if (costs.length > 0) {
    const uniqueDates = [...new Set(costs.map((r) => r.date))];

    // Delete stale rows for the dates we are about to re-write so re-syncs don't stack duplicates
    for (const date of uniqueDates) {
      const { error: delErr } = await supabase
        .from('gcp_billing')
        .delete()
        .eq('usage->>date', date);
      if (delErr) console.warn('[GCP Billing] gcp_billing delete error:', delErr.message);
    }

    const gcpRows = costs.map((row) => ({
      service: slugifyService(row.service),
      cost_usd: parseFloat(row.cost.toFixed(4)),
      project: row.project || null,
      product: PROJECT_TO_PRODUCT[row.project] || null,
      usage: { date: row.date, currency: row.currency, raw_service: row.service, project: row.project },
      recorded_at: new Date(`${row.date}T12:00:00Z`).toISOString(),
    }));

    // Insert in batches of 100
    for (let i = 0; i < gcpRows.length; i += 100) {
      const batch = gcpRows.slice(i, i + 100);
      const { error } = await supabase.from('gcp_billing').insert(batch);
      if (error) console.warn('[GCP Billing] gcp_billing insert error:', error.message);
      servicesSynced += batch.length;
    }
    console.log(`[GCP Billing] Wrote ${servicesSynced} per-service rows to gcp_billing`);
  }

  // ── 2. Aggregate by date → financials (daily total + per-product) ───
  // Build daily totals (overall) and per-product
  const dailyTotals = new Map<string, number>();
  const dailyByProduct = new Map<string, Map<string, number>>(); // date → product → cost
  for (const row of costs) {
    // Overall total
    dailyTotals.set(row.date, (dailyTotals.get(row.date) ?? 0) + row.cost);
    // Per-product breakdown
    const product = PROJECT_TO_PRODUCT[row.project] || 'unattributed';
    if (!dailyByProduct.has(row.date)) dailyByProduct.set(row.date, new Map());
    const productMap = dailyByProduct.get(row.date)!;
    productMap.set(product, (productMap.get(product) ?? 0) + row.cost);
  }

  let synced = 0;

  // Helper to upsert a financials row
  async function upsertFinancial(date: string, product: string | null, cost: number, details: Record<string, unknown>) {
    let query = supabase
      .from('financials')
      .select('id')
      .eq('date', date)
      .eq('metric', 'infra_cost');
    if (product === null) {
      query = query.is('product', null);
    } else {
      query = query.eq('product', product);
    }
    const { data: existing } = await query.limit(1);

    if (existing && existing.length > 0) {
      await supabase.from('financials').update({ value: parseFloat(cost.toFixed(2)) }).eq('id', existing[0].id);
    } else {
      await supabase.from('financials').insert({
        date,
        product,
        metric: 'infra_cost',
        value: parseFloat(cost.toFixed(2)),
        details,
      });
    }
    synced++;
  }

  // Write overall daily totals (product = null, for backward compat)
  for (const [date, totalCost] of dailyTotals) {
    await upsertFinancial(date, null, totalCost, {
      source: 'gcp_billing_export',
      services: costs.filter((c) => c.date === date),
    });
  }

  // Write per-product daily totals
  for (const [date, productMap] of dailyByProduct) {
    for (const [product, cost] of productMap) {
      if (product === 'unattributed') continue; // skip unknown projects
      await upsertFinancial(date, product, cost, {
        source: 'gcp_billing_export',
        project: Object.entries(PROJECT_TO_PRODUCT).find(([, v]) => v === product)?.[0],
      });
    }
  }

  console.log(`[GCP Billing] Synced ${synced} daily totals to financials`);
  return { synced, services: servicesSynced };
}

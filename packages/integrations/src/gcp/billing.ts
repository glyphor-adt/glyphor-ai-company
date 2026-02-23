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

export interface DailyCost {
  date: string;
  service: string;
  cost: number;
  currency: string;
}

/**
 * Query GCP billing export for cost breakdown by service.
 * Requires billing export to BigQuery to be configured.
 */
export async function queryBillingExport(
  projectId: string,
  billingDataset: string,
  billingTable: string,
  days = 7,
): Promise<DailyCost[]> {
  const bq = getBigQueryClient();

  const query = `
    SELECT
      FORMAT_DATE('%Y-%m-%d', usage_start_time) AS date,
      service.description AS service,
      SUM(cost) AS cost,
      currency
    FROM \`${projectId}.${billingDataset}.${billingTable}\`
    WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
      AND project.id = @projectId
    GROUP BY date, service, currency
    ORDER BY date DESC, cost DESC
  `;

  const [rows] = await bq.query({
    query,
    params: { days, projectId },
  });

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
  days = 7,
): Promise<{ synced: number; services: number }> {
  const costs = await queryBillingExport(projectId, billingDataset, billingTable, days);

  // ── 1. Write per-service rows to gcp_billing ──────────────────────────
  let servicesSynced = 0;
  if (costs.length > 0) {
    const gcpRows = costs.map((row) => ({
      service: slugifyService(row.service),
      cost_usd: parseFloat(row.cost.toFixed(4)),
      usage: { date: row.date, currency: row.currency, raw_service: row.service },
      recorded_at: new Date(`${row.date}T12:00:00Z`).toISOString(),
    }));

    // Upsert in batches of 100
    for (let i = 0; i < gcpRows.length; i += 100) {
      const batch = gcpRows.slice(i, i + 100);
      const { error } = await supabase.from('gcp_billing').upsert(batch, {
        onConflict: 'service,recorded_at',
        ignoreDuplicates: false,
      });
      if (error) {
        // Fallback: insert ignoring conflicts
        await supabase.from('gcp_billing').insert(batch).throwOnError().catch(() => null);
      }
      servicesSynced += batch.length;
    }
    console.log(`[GCP Billing] Wrote ${servicesSynced} per-service rows to gcp_billing`);
  }

  // ── 2. Aggregate by date → financials (daily total) ───────────────────
  const dailyTotals = new Map<string, number>();
  for (const row of costs) {
    const current = dailyTotals.get(row.date) ?? 0;
    dailyTotals.set(row.date, current + row.cost);
  }

  let synced = 0;
  for (const [date, totalCost] of dailyTotals) {
    const { data: existing } = await supabase
      .from('financials')
      .select('id')
      .eq('date', date)
      .eq('metric', 'infra_cost')
      .is('product', null)
      .limit(1);

    if (existing && existing.length > 0) {
      await supabase.from('financials').update({ value: totalCost }).eq('id', existing[0].id);
    } else {
      await supabase.from('financials').insert({
        date,
        product: null,
        metric: 'infra_cost',
        value: parseFloat(totalCost.toFixed(2)),
        details: { source: 'gcp_billing_export', services: costs.filter((c) => c.date === date) },
      });
    }
    synced++;
  }

  console.log(`[GCP Billing] Synced ${synced} daily totals to financials`);
  return { synced, services: servicesSynced };
}

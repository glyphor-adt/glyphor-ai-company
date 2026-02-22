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

/**
 * Sync GCP billing data into Supabase financials table.
 * Aggregates costs per day and writes as infra_cost metric.
 */
export async function syncBillingToSupabase(
  supabase: SupabaseClient,
  projectId: string,
  billingDataset: string,
  billingTable: string,
  days = 7,
): Promise<{ synced: number }> {
  const costs = await queryBillingExport(projectId, billingDataset, billingTable, days);

  // Aggregate by date
  const dailyTotals = new Map<string, number>();
  for (const row of costs) {
    const current = dailyTotals.get(row.date) ?? 0;
    dailyTotals.set(row.date, current + row.cost);
  }

  let synced = 0;
  for (const [date, totalCost] of dailyTotals) {
    // Check if row exists
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

  console.log(`[GCP Billing] Synced ${synced} daily cost records`);
  return { synced };
}

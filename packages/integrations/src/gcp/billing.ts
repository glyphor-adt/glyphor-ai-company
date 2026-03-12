/**
 * GCP Billing — Query billing export from BigQuery and sync to database
 */

import { BigQuery } from '@google-cloud/bigquery';
import { systemQuery } from '@glyphor/shared/db';

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

function buildBillingTableRef(projectId: string, billingDataset: string, billingTable: string): string {
  const clean = (v: string) => v.trim().replace(/`/g, '');
  const sanitizedProject = clean(projectId);
  const sanitizedDataset = clean(billingDataset);
  const rawTable = clean(billingTable);

  // Support callers passing a fully-qualified table id in billingTable.
  if (rawTable.includes('.')) {
    const parts = rawTable.split('.').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 3) {
      const [p, d, t] = parts;
      return `${p}.${d}.${t}`;
    }
  }

  return `${sanitizedProject}.${sanitizedDataset}.${rawTable}`;
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
  const tableRef = buildBillingTableRef(projectId, billingDataset, billingTable);

  // First check: does the table have any rows at all?
  const countQuery = `SELECT COUNT(*) as total FROM \`${tableRef}\``;
  const [countResult] = await bq.query({ query: countQuery });
  const totalRows = countResult?.[0]?.total ?? 0;
  console.log(`[GCP Billing] Table ${tableRef} has ${totalRows} total rows`);

  const query = `
    SELECT
      FORMAT_DATE('%Y-%m-%d', usage_start_time) AS date,
      project.id AS project,
      IFNULL(service.description, 'Unattributed') AS service,
      SUM(cost) AS cost,
      currency
    FROM \`${tableRef}\`
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
export async function syncBillingToDB(
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
      await systemQuery(
        "DELETE FROM gcp_billing WHERE usage->>'date' = $1",
        [date],
      );
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
      for (const row of batch) {
        await systemQuery(
          'INSERT INTO gcp_billing (service, cost_usd, project, product, usage, recorded_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [row.service, row.cost_usd, row.project, row.product, JSON.stringify(row.usage), row.recorded_at],
        );
      }
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
    let existing: { id: string }[];
    if (product === null) {
      existing = await systemQuery<{ id: string }>(
        'SELECT id FROM financials WHERE date = $1 AND metric = $2 AND product IS NULL LIMIT 1',
        [date, 'infra_cost'],
      );
    } else {
      existing = await systemQuery<{ id: string }>(
        'SELECT id FROM financials WHERE date = $1 AND metric = $2 AND product = $3 LIMIT 1',
        [date, 'infra_cost', product],
      );
    }

    if (existing.length > 0) {
      await systemQuery('UPDATE financials SET value = $1 WHERE id = $2', [parseFloat(cost.toFixed(2)), existing[0].id]);
    } else {
      await systemQuery(
        'INSERT INTO financials (date, product, metric, value, details) VALUES ($1, $2, $3, $4, $5)',
        [date, product, 'infra_cost', parseFloat(cost.toFixed(2)), JSON.stringify(details)],
      );
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

/**
 * OpenAI Billing — Query costs via the Organization Costs API and sync to Supabase
 *
 * Requires an OpenAI Admin API key (sk-admin-...) set as OPENAI_ADMIN_KEY env var.
 * API docs: https://platform.openai.com/docs/api-reference/organization/costs
 */

import { systemQuery } from '@glyphor/shared/db';

const OPENAI_COSTS_URL = 'https://api.openai.com/v1/organization/costs';

export interface OpenAICostBucket {
  start_time: number;
  end_time: number;
  results: Array<{
    object: string;
    amount: { value: number; currency: string };
    line_item: string | null;
  }>;
}

export interface OpenAICostsResponse {
  object: string;
  data: OpenAICostBucket[];
  has_more: boolean;
  next_page: string | null;
}

/**
 * Fetch cost data from OpenAI's Organization Costs API.
 * Returns daily cost buckets grouped by line_item (model).
 */
export async function queryOpenAICosts(
  adminKey: string,
  days = 30,
): Promise<OpenAICostBucket[]> {
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - days * 86400;

  const url = new URL(OPENAI_COSTS_URL);
  url.searchParams.set('start_time', String(startTime));
  url.searchParams.set('end_time', String(endTime));
  url.searchParams.set('bucket_width', '1d');
  url.searchParams.set('group_by[]', 'line_item');

  const allBuckets: OpenAICostBucket[] = [];
  let pageToken: string | null = null;

  do {
    const fetchUrl = new URL(url.toString());
    if (pageToken) fetchUrl.searchParams.set('page', pageToken);

    const response = await fetch(fetchUrl.toString(), {
      headers: { Authorization: `Bearer ${adminKey}` },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI Costs API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as OpenAICostsResponse;
    allBuckets.push(...data.data);
    pageToken = data.has_more && data.next_page ? data.next_page : null;
  } while (pageToken);

  console.log(`[OpenAI Billing] Fetched ${allBuckets.length} daily cost buckets`);
  return allBuckets;
}

/**
 * Sync OpenAI costs into:
 *  - `api_billing` table: per-model per-day rows
 *  - `financials` table: daily aggregate for product attribution
 */
export async function syncOpenAIBilling(
  adminKey: string,
  product = 'pulse',
  days = 30,
): Promise<{ synced: number; models: number }> {
  const buckets = await queryOpenAICosts(adminKey, days);

  // Flatten buckets into per-model per-day rows
  const rows: Array<{
    provider: string;
    service: string;
    cost_usd: number;
    usage: Record<string, unknown>;
    product: string;
    recorded_at: string;
  }> = [];

  const dailyTotals = new Map<string, number>();

  for (const bucket of buckets) {
    const date = new Date(bucket.start_time * 1000).toISOString().split('T')[0];

    for (const result of bucket.results) {
      const costValue = Number(result.amount?.value ?? 0);
      if (!costValue || isNaN(costValue)) continue;

      const model = result.line_item ?? 'unknown';
      rows.push({
        provider: 'openai',
        service: model,
        cost_usd: parseFloat(costValue.toFixed(4)),
        usage: {
          date,
          currency: result.amount?.currency ?? 'usd',
          object: result.object,
        },
        product,
        recorded_at: new Date(`${date}T12:00:00Z`).toISOString(),
      });

      const current = dailyTotals.get(date) ?? 0;
      dailyTotals.set(date, current + costValue);
    }
  }

  // ── 1. Write per-model rows to api_billing ────────────────────────
  if (rows.length > 0) {
    // Delete stale rows for the dates we're about to write
    const uniqueDates = [...new Set(rows.map((r) => (r.usage as { date: string }).date))];
    for (const date of uniqueDates) {
      await systemQuery(
        "DELETE FROM api_billing WHERE provider = $1 AND usage->>'date' = $2",
        ['openai', date],
      );
    }

    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      for (const row of batch) {
        await systemQuery(
          'INSERT INTO api_billing (provider, service, cost_usd, usage, product, recorded_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [row.provider, row.service, row.cost_usd, JSON.stringify(row.usage), row.product, row.recorded_at],
        );
      }
    }
    console.log(`[OpenAI Billing] Wrote ${rows.length} per-model rows to api_billing`);
  }

  // ── 2. Aggregate by date → financials (daily total for product) ───
  let synced = 0;
  for (const [date, totalCost] of dailyTotals) {
    const existing = await systemQuery<{ id: string }>(
      "SELECT id FROM financials WHERE date = $1 AND metric = $2 AND product = $3 AND details->>'source' = 'openai' LIMIT 1",
      [date, 'api_cost', product],
    );

    const details = {
      source: 'openai',
      models: rows
        .filter((r) => (r.usage as { date: string }).date === date)
        .map((r) => ({ model: r.service, cost: r.cost_usd })),
    };

    if (existing.length > 0) {
      await systemQuery('UPDATE financials SET value = $1, details = $2 WHERE id = $3', [totalCost, JSON.stringify(details), existing[0].id]);
    } else {
      await systemQuery(
        'INSERT INTO financials (date, product, metric, value, details) VALUES ($1, $2, $3, $4, $5)',
        [date, product, 'api_cost', parseFloat(totalCost.toFixed(4)), JSON.stringify(details)],
      );
    }
    synced++;
  }

  const uniqueModels = new Set(rows.map((r) => r.service));
  console.log(`[OpenAI Billing] Synced ${synced} daily totals, ${uniqueModels.size} models`);
  return { synced, models: uniqueModels.size };
}

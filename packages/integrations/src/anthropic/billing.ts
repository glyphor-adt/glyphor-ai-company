/**
 * Anthropic Billing — Query usage via the Admin Usage Report API and sync to database
 *
 * This is for the DIRECT Anthropic API (api.anthropic.com). Claude usage routed
 * through AWS Bedrock lives in AWS Cost Explorer, not here.
 *
 * Requires ANTHROPIC_ADMIN_KEY env var.
 */
import { systemQuery } from '@glyphor/shared/db';

const ANTHROPIC_API_BASE = 'https://api.anthropic.com';

/** USD per 1M tokens — direct Anthropic list price (not Bedrock) */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  // Legacy
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing =
    MODEL_PRICING[model]
    ?? Object.entries(MODEL_PRICING).find(([key]) => model.startsWith(key.split('-').slice(0, 3).join('-')))?.[1]
    ?? { input: 3.0, output: 15.0 };
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export interface AnthropicDailyUsage {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  cost: number;
}

export async function queryAnthropicUsage(adminKey: string, days = 30): Promise<AnthropicDailyUsage[]> {
  const endDate = new Date();
  const startDate = new Date(Date.now() - days * 86400000);
  const startStr = startDate.toISOString().replace(/\.\d+Z$/, 'Z');
  const endStr = endDate.toISOString().replace(/\.\d+Z$/, 'Z');

  const allBuckets: AnthropicDailyUsage[] = [];
  let page: string | null = null;

  do {
    const params = new URLSearchParams({
      starting_at: startStr,
      ending_at: endStr,
      bucket_width: '1d',
      'group_by[]': 'model',
    });
    if (page) params.set('page', page);

    const url = `${ANTHROPIC_API_BASE}/v1/organizations/usage_report/messages?${params.toString()}`;
    const response = await fetch(url, {
      headers: {
        'x-api-key': adminKey,
        'anthropic-version': '2023-06-01',
      },
    });

    if (response.status === 403 || response.status === 404) {
      console.warn(
        `[Anthropic Billing] Usage API returned ${response.status} — endpoint may not be available for this API key. ` +
        `Set ANTHROPIC_ADMIN_KEY to an admin-scoped key for usage access.`,
      );
      return [];
    }
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic Usage API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      data?: Array<{
        starting_at: string;
        results: Array<{
          model: string;
          uncached_input_tokens?: number;
          cached_input_tokens?: number;
          cache_creation_input_tokens?: number;
          output_tokens?: number;
        }>;
      }>;
      has_more?: boolean;
      next_page?: string | null;
    };

    for (const bucket of data.data ?? []) {
      const date = bucket.starting_at.split('T')[0];
      for (const r of bucket.results) {
        const inputTokens =
          (r.uncached_input_tokens ?? 0)
          + (r.cached_input_tokens ?? 0)
          + (r.cache_creation_input_tokens ?? 0);
        allBuckets.push({
          date,
          model: r.model,
          inputTokens,
          outputTokens: r.output_tokens ?? 0,
          requests: 0,
          cost: estimateCost(r.model, inputTokens, r.output_tokens ?? 0),
        });
      }
    }

    page = data.has_more ? (data.next_page ?? null) : null;
  } while (page);

  return allBuckets;
}

export async function syncAnthropicBilling(
  adminKey: string,
  product = 'glyphor',
  days = 30,
): Promise<{ synced: number; models: number }> {
  const buckets = await queryAnthropicUsage(adminKey, days);
  if (buckets.length === 0) {
    console.log('[Anthropic Billing] No usage data available — skipping');
    return { synced: 0, models: 0 };
  }

  const rows = buckets
    .filter((b) => b.cost > 0)
    .map((b) => ({
      provider: 'anthropic',
      service: b.model,
      cost_usd: parseFloat(b.cost.toFixed(4)),
      usage: {
        date: b.date,
        input_tokens: b.inputTokens,
        output_tokens: b.outputTokens,
        requests: b.requests,
      },
      product,
      recorded_at: new Date(`${b.date}T12:00:00Z`).toISOString(),
    }));

  if (rows.length > 0) {
    const uniqueDates = [...new Set(rows.map((r) => r.usage.date))];
    for (const date of uniqueDates) {
      await systemQuery("DELETE FROM api_billing WHERE provider = $1 AND usage->>'date' = $2", ['anthropic', date]);
    }
    for (const row of rows) {
      await systemQuery(
        'INSERT INTO api_billing (provider, service, cost_usd, usage, product, recorded_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [row.provider, row.service, row.cost_usd, JSON.stringify(row.usage), row.product, row.recorded_at],
      );
    }
    console.log(`[Anthropic Billing] Wrote ${rows.length} per-model rows to api_billing`);
  }

  const dailyTotals = new Map<string, number>();
  for (const b of buckets) dailyTotals.set(b.date, (dailyTotals.get(b.date) ?? 0) + b.cost);

  let synced = 0;
  for (const [date, totalCost] of dailyTotals) {
    const existing = await systemQuery<{ id: string }>(
      "SELECT id FROM financials WHERE date = $1 AND metric = $2 AND product = $3 AND details->>'source' = 'anthropic' LIMIT 1",
      [date, 'api_cost', product],
    );
    const details = {
      source: 'anthropic',
      models: rows.filter((r) => r.usage.date === date).map((r) => ({ model: r.service, cost: r.cost_usd })),
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
  console.log(`[Anthropic Billing] Synced ${synced} daily totals, ${uniqueModels.size} models`);
  return { synced, models: uniqueModels.size };
}

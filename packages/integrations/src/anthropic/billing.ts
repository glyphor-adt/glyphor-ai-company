/**
 * Anthropic Billing — Query usage via the Admin API and sync to Supabase
 *
 * Requires an Anthropic Admin API key set as ANTHROPIC_ADMIN_KEY env var.
 * Uses the /v1/messages/count_tokens-style usage tracking plus the
 * organization usage endpoint when available.
 *
 * Pricing (as of 2025, per 1M tokens):
 *   claude-sonnet-4-20250514:    input $3,   output $15
 *   Claude 3.5 Haiku:  input $0.80, output $4
 *   Claude 3 Opus:     input $15,   output $75
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const ANTHROPIC_API_BASE = 'https://api.anthropic.com';

/** Token pricing per 1M tokens (USD) */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Find matching pricing (prefix match for model variants)
  const pricing = MODEL_PRICING[model]
    ?? Object.entries(MODEL_PRICING).find(([key]) => model.startsWith(key.split('-').slice(0, 3).join('-')))?.[1]
    ?? { input: 3.0, output: 15.0 }; // default to Sonnet pricing

  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export interface AnthropicUsageBucket {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  cost: number;
}

/**
 * Fetch usage data from Anthropic's API.
 * Uses the /v1/organizations/usage endpoint if available.
 */
export async function queryAnthropicUsage(
  adminKey: string,
  days = 30,
): Promise<AnthropicUsageBucket[]> {
  const endDate = new Date();
  const startDate = new Date(Date.now() - days * 86400000);

  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];

  // Try the organization usage endpoint
  const url = `${ANTHROPIC_API_BASE}/v1/usage?start_date=${startStr}&end_date=${endStr}`;

  const response = await fetch(url, {
    headers: {
      'x-api-key': adminKey,
      'anthropic-version': '2023-06-01',
    },
  });

  if (response.ok) {
    const data = await response.json() as {
      data: Array<{
        date: string;
        model: string;
        input_tokens: number;
        output_tokens: number;
        api_requests: number;
      }>;
    };

    return (data.data ?? []).map((d) => ({
      date: d.date,
      model: d.model,
      inputTokens: d.input_tokens,
      outputTokens: d.output_tokens,
      requests: d.api_requests,
      cost: estimateCost(d.model, d.input_tokens, d.output_tokens),
    }));
  }

  // If the usage endpoint isn't available (403/404), fall back to
  // token-based cost estimation from the api_billing table history
  if (response.status === 403 || response.status === 404) {
    console.warn(
      `[Anthropic Billing] Usage API returned ${response.status} — ` +
      `endpoint may not be available for this API key. ` +
      `Set ANTHROPIC_ADMIN_KEY to an admin-scoped key for usage access.`
    );
    return [];
  }

  const body = await response.text();
  throw new Error(`Anthropic Usage API error ${response.status}: ${body}`);
}

/**
 * Sync Anthropic usage/cost into:
 *  - `api_billing` table: per-model per-day rows
 *  - `financials` table: daily aggregate for product attribution
 */
export async function syncAnthropicBilling(
  supabase: SupabaseClient,
  adminKey: string,
  product = 'glyphor-ai-company',
  days = 30,
): Promise<{ synced: number; models: number }> {
  const buckets = await queryAnthropicUsage(adminKey, days);

  if (buckets.length === 0) {
    console.log('[Anthropic Billing] No usage data available — skipping');
    return { synced: 0, models: 0 };
  }

  // ── 1. Write per-model rows to api_billing ────────────────────────
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
    const uniqueDates = [...new Set(rows.map((r) => (r.usage as { date: string }).date))];
    for (const date of uniqueDates) {
      await supabase
        .from('api_billing')
        .delete()
        .eq('provider', 'anthropic')
        .eq('usage->>date', date);
    }

    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await supabase.from('api_billing').insert(batch);
      if (error) console.warn('[Anthropic Billing] api_billing insert error:', error.message);
    }
    console.log(`[Anthropic Billing] Wrote ${rows.length} per-model rows to api_billing`);
  }

  // ── 2. Aggregate by date → financials ─────────────────────────────
  const dailyTotals = new Map<string, number>();
  for (const b of buckets) {
    const current = dailyTotals.get(b.date) ?? 0;
    dailyTotals.set(b.date, current + b.cost);
  }

  let synced = 0;
  for (const [date, totalCost] of dailyTotals) {
    const { data: existing } = await supabase
      .from('financials')
      .select('id')
      .eq('date', date)
      .eq('metric', 'api_cost')
      .eq('product', product)
      .contains('details', { source: 'anthropic' })
      .limit(1);

    const details = {
      source: 'anthropic',
      models: rows
        .filter((r) => (r.usage as { date: string }).date === date)
        .map((r) => ({ model: r.service, cost: r.cost_usd })),
    };

    if (existing && existing.length > 0) {
      await supabase.from('financials').update({ value: totalCost, details }).eq('id', existing[0].id);
    } else {
      await supabase.from('financials').insert({
        date,
        product,
        metric: 'api_cost',
        value: parseFloat(totalCost.toFixed(4)),
        details,
      });
    }
    synced++;
  }

  const uniqueModels = new Set(rows.map((r) => r.service));
  console.log(`[Anthropic Billing] Synced ${synced} daily totals, ${uniqueModels.size} models`);
  return { synced, models: uniqueModels.size };
}

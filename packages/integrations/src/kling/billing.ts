/**
 * Kling AI Billing — Query usage via Kling's API and sync to Supabase
 *
 * Kling AI (by Kuaishou) provides video/image generation.
 * Requires KLING_API_KEY and KLING_ACCESS_KEY env vars.
 *
 * API base: https://api.klingai.com
 * Usage endpoint: /v1/usage (returns token/credit usage by date)
 *
 * Pricing (approximate, per generation):
 *   Standard video (5s):   ~$0.035 per generation
 *   Professional video:     ~$0.070 per generation
 *   Image generation:       ~$0.005 per generation
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const KLING_API_BASE = 'https://api.klingai.com';

/** Per-task-type pricing estimates (USD) */
const TASK_PRICING: Record<string, number> = {
  'video-standard-5s': 0.035,
  'video-standard-10s': 0.070,
  'video-professional-5s': 0.070,
  'video-professional-10s': 0.140,
  'image-standard': 0.005,
  'image-professional': 0.010,
};

export interface KlingUsageBucket {
  date: string;
  taskType: string;
  count: number;
  cost: number;
}

/**
 * Fetch usage data from Kling's API.
 */
export async function queryKlingUsage(
  apiKey: string,
  days = 30,
): Promise<KlingUsageBucket[]> {
  const endDate = new Date();
  const startDate = new Date(Date.now() - days * 86400000);

  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];

  // Try the usage/billing endpoint
  const url = `${KLING_API_BASE}/v1/usage?start_date=${startStr}&end_date=${endStr}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    // If no usage endpoint available, try the tasks list to derive usage
    if (response.status === 404) {
      console.log('[Kling Billing] Usage endpoint not available, trying task history');
      return queryKlingTaskHistory(apiKey, days);
    }
    const body = await response.text();
    throw new Error(`Kling Usage API error ${response.status}: ${body}`);
  }

  const data = await response.json() as {
    data: Array<{
      date: string;
      task_type: string;
      count: number;
      credits_used?: number;
    }>;
  };

  return (data.data ?? []).map((d) => ({
    date: d.date,
    taskType: d.task_type,
    count: d.count,
    cost: d.credits_used
      ? d.credits_used / 100 // credits to USD
      : (TASK_PRICING[d.task_type] ?? 0.035) * d.count,
  }));
}

/**
 * Fallback: Derive usage from task history if no dedicated usage endpoint.
 */
async function queryKlingTaskHistory(
  apiKey: string,
  days: number,
): Promise<KlingUsageBucket[]> {
  const buckets = new Map<string, KlingUsageBucket>();

  // Query recent video generation tasks
  for (const endpoint of ['/v1/videos/image2video', '/v1/videos/text2video', '/v1/images/generations']) {
    try {
      const response = await fetch(`${KLING_API_BASE}${endpoint}?page_size=100`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) continue;

      const data = await response.json() as {
        data: Array<{
          created_at: number;
          task_type?: string;
          task_status: string;
        }>;
      };

      const cutoff = Date.now() - days * 86400000;

      for (const task of data.data ?? []) {
        if (task.task_status !== 'succeed') continue;
        const createdAt = task.created_at * 1000;
        if (createdAt < cutoff) continue;

        const date = new Date(createdAt).toISOString().split('T')[0];
        const taskType = task.task_type ?? (endpoint.includes('image') ? 'image-standard' : 'video-standard-5s');
        const key = `${date}:${taskType}`;

        const existing = buckets.get(key);
        if (existing) {
          existing.count++;
          existing.cost += TASK_PRICING[taskType] ?? 0.035;
        } else {
          buckets.set(key, {
            date,
            taskType,
            count: 1,
            cost: TASK_PRICING[taskType] ?? 0.035,
          });
        }
      }
    } catch {
      // Continue to next endpoint
    }
  }

  const result = [...buckets.values()];
  console.log(`[Kling Billing] Derived ${result.length} usage buckets from task history`);
  return result;
}

/**
 * Sync Kling usage/cost into:
 *  - `api_billing` table: per-task-type per-day rows
 *  - `financials` table: daily aggregate for product attribution
 */
export async function syncKlingBilling(
  supabase: SupabaseClient,
  apiKey: string,
  product = 'pulse',
  days = 30,
): Promise<{ synced: number; taskTypes: number }> {
  const buckets = await queryKlingUsage(apiKey, days);

  if (buckets.length === 0) {
    console.log('[Kling Billing] No usage data available');
    return { synced: 0, taskTypes: 0 };
  }

  // ── 1. Write per-taskType rows to api_billing ─────────────────────
  const rows = buckets
    .filter((b) => b.cost > 0)
    .map((b) => ({
      provider: 'kling',
      service: b.taskType,
      cost_usd: parseFloat(b.cost.toFixed(4)),
      usage: {
        date: b.date,
        count: b.count,
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
        .eq('provider', 'kling')
        .eq('usage->>date', date);
    }

    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await supabase.from('api_billing').insert(batch);
      if (error) console.warn('[Kling Billing] api_billing insert error:', error.message);
    }
    console.log(`[Kling Billing] Wrote ${rows.length} per-taskType rows to api_billing`);
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
      .contains('details', { source: 'kling' })
      .limit(1);

    const details = {
      source: 'kling',
      tasks: rows
        .filter((r) => (r.usage as { date: string }).date === date)
        .map((r) => ({ type: r.service, cost: r.cost_usd, count: (r.usage as { count: number }).count })),
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

  const uniqueTaskTypes = new Set(rows.map((r) => r.service));
  console.log(`[Kling Billing] Synced ${synced} daily totals, ${uniqueTaskTypes.size} task types`);
  return { synced, taskTypes: uniqueTaskTypes.size };
}

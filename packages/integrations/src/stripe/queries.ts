/**
 * Stripe Queries — Scheduled sync functions for pulling financial data
 *
 * These run on a schedule (daily) to sync MRR, subscription counts,
 * and churn rates from Stripe into the Supabase financials table.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getStripeClient } from './client.js';

/** Sync current MRR from Stripe subscriptions into the financials table */
export async function syncMRR(supabase: SupabaseClient): Promise<{ mrr: number; subscriptions: number }> {
  const stripe = getStripeClient();
  const date = new Date().toISOString().split('T')[0];

  let totalMRR = 0;
  let activeCount = 0;
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params: Record<string, unknown> = { status: 'active', limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;

    const subs = await stripe.subscriptions.list(params as Parameters<typeof stripe.subscriptions.list>[0]);

    for (const sub of subs.data) {
      activeCount++;
      const product = sub.metadata?.product || null;
      const monthlyAmount = sub.items.data.reduce((sum, item) => {
        const unitAmount = item.price?.unit_amount ?? 0;
        const qty = item.quantity ?? 1;
        const interval = item.price?.recurring?.interval;
        const intervalCount = item.price?.recurring?.interval_count ?? 1;
        // Normalize to monthly
        if (interval === 'year') return sum + (unitAmount * qty) / (12 * intervalCount);
        if (interval === 'week') return sum + (unitAmount * qty * 4.33) / intervalCount;
        return sum + (unitAmount * qty) / intervalCount; // monthly default
      }, 0);
      totalMRR += monthlyAmount;

      // Track per-product MRR if product metadata is set
      if (product) {
        await upsertFinancial(supabase, date, product, 'mrr', monthlyAmount / 100);
      }
    }

    hasMore = subs.has_more;
    if (subs.data.length > 0) {
      startingAfter = subs.data[subs.data.length - 1].id;
    }
  }

  const totalMRRDollars = totalMRR / 100;

  // Write total MRR
  await upsertFinancial(supabase, date, null, 'mrr', totalMRRDollars);
  // Write subscription count
  await upsertFinancial(supabase, date, null, 'active_subscriptions', activeCount);

  console.log(`[Stripe Sync] MRR: $${totalMRRDollars.toFixed(2)}, Active subscriptions: ${activeCount}`);
  return { mrr: totalMRRDollars, subscriptions: activeCount };
}

/** Sync churn rate (canceled subscriptions in last 30 days vs active) */
export async function syncChurnRate(supabase: SupabaseClient): Promise<{ churnRate: number }> {
  const stripe = getStripeClient();
  const date = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

  // Count canceled subscriptions in last 30 days
  let canceledCount = 0;
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params: Record<string, unknown> = {
      status: 'canceled',
      limit: 100,
      created: { gte: thirtyDaysAgo },
    };
    if (startingAfter) params.starting_after = startingAfter;

    const subs = await stripe.subscriptions.list(params as Parameters<typeof stripe.subscriptions.list>[0]);
    canceledCount += subs.data.length;
    hasMore = subs.has_more;
    if (subs.data.length > 0) {
      startingAfter = subs.data[subs.data.length - 1].id;
    }
  }

  // Get active count
  const activeSubs = await stripe.subscriptions.list({ status: 'active', limit: 1 });
  const totalActive = activeSubs.data.length > 0 ? (activeSubs as unknown as { total_count?: number }).total_count ?? 1 : 1;

  const churnRate = totalActive > 0 ? (canceledCount / totalActive) * 100 : 0;

  await upsertFinancial(supabase, date, null, 'churn_rate', parseFloat(churnRate.toFixed(2)));

  console.log(`[Stripe Sync] Churn rate: ${churnRate.toFixed(2)}% (${canceledCount} canceled / ${totalActive} active)`);
  return { churnRate };
}

/** Run all Stripe sync operations */
export async function syncAll(supabase: SupabaseClient) {
  const [mrrResult, churnResult] = await Promise.all([
    syncMRR(supabase),
    syncChurnRate(supabase),
  ]);
  return { ...mrrResult, ...churnResult };
}

async function upsertFinancial(
  supabase: SupabaseClient,
  date: string,
  product: string | null,
  metric: string,
  value: number,
) {
  // Try update first, insert if not exists
  const query = supabase.from('financials').select('id').eq('date', date).eq('metric', metric);
  if (product) {
    query.eq('product', product);
  } else {
    query.is('product', null);
  }
  const { data: existing } = await query.limit(1);

  if (existing && existing.length > 0) {
    await supabase.from('financials').update({ value }).eq('id', existing[0].id);
  } else {
    await supabase.from('financials').insert({ date, product, metric, value });
  }
}

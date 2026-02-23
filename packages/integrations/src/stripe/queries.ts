/**
 * Stripe Queries — Scheduled sync functions for pulling financial data
 *
 * These run on a schedule (daily) to sync MRR, subscription counts,
 * and churn rates from Stripe into the Supabase financials table.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getStripeClient } from './client.js';

/** Compute normalized monthly amount for a subscription */
function normalizedMonthlyAmount(sub: { items: { data: Array<{ price?: { unit_amount?: number | null; recurring?: { interval?: string; interval_count?: number } | null }; quantity?: number | null }> } }): number {
  return sub.items.data.reduce((sum, item) => {
    const unitAmount = item.price?.unit_amount ?? 0;
    const qty = item.quantity ?? 1;
    const interval = item.price?.recurring?.interval;
    const intervalCount = item.price?.recurring?.interval_count ?? 1;
    if (interval === 'year') return sum + (unitAmount * qty) / (12 * intervalCount);
    if (interval === 'week') return sum + (unitAmount * qty * 4.33) / intervalCount;
    return sum + (unitAmount * qty) / intervalCount;
  }, 0);
}

/** Sync current MRR from Stripe subscriptions into financials + stripe_data tables */
export async function syncMRR(supabase: SupabaseClient): Promise<{ mrr: number; subscriptions: number }> {
  const stripe = getStripeClient();
  const date = new Date().toISOString().split('T')[0];

  let totalMRR = 0;
  let activeCount = 0;
  let hasMore = true;
  let startingAfter: string | undefined;

  // Collect per-subscription rows for stripe_data
  const stripeRows: Array<Record<string, unknown>> = [];

  while (hasMore) {
    const params: Record<string, unknown> = { status: 'active', limit: 100, expand: ['data.customer'] };
    if (startingAfter) params.starting_after = startingAfter;

    const subs = await stripe.subscriptions.list(params as Parameters<typeof stripe.subscriptions.list>[0]);

    for (const sub of subs.data) {
      activeCount++;
      const product = sub.metadata?.product || (sub.items.data[0]?.price?.nickname ?? null);
      const plan = sub.items.data[0]?.price?.id ?? null;
      const monthlyAmount = normalizedMonthlyAmount(sub);
      totalMRR += monthlyAmount;
      const monthlyDollars = monthlyAmount / 100;

      // cohort_month = YYYY-MM of subscription creation
      const cohortDate = new Date(sub.created * 1000);
      const cohortMonth = `${cohortDate.getFullYear()}-${String(cohortDate.getMonth() + 1).padStart(2, '0')}`;

      // customer_id: either email or stripe customer id
      const customer = sub.customer;
      const customerId = typeof customer === 'string'
        ? customer
        : (customer as { id?: string })?.id ?? null;

      stripeRows.push({
        record_type: 'subscription',
        customer_id: customerId,
        product,
        plan,
        amount_usd: parseFloat(monthlyDollars.toFixed(2)),
        status: sub.status,
        cohort_month: cohortMonth,
        properties: {
          stripe_subscription_id: sub.id,
          interval: sub.items.data[0]?.price?.recurring?.interval,
          trial_end: sub.trial_end,
          cancel_at_period_end: sub.cancel_at_period_end,
        },
        recorded_at: new Date().toISOString(),
      });

      if (product) {
        await upsertFinancial(supabase, date, product, 'mrr', monthlyDollars);
      }
    }

    hasMore = subs.has_more;
    if (subs.data.length > 0) {
      startingAfter = subs.data[subs.data.length - 1].id;
    }
  }

  const totalMRRDollars = totalMRR / 100;

  // Write totals to financials
  await upsertFinancial(supabase, date, null, 'mrr', totalMRRDollars);
  await upsertFinancial(supabase, date, null, 'active_subscriptions', activeCount);

  // Write MRR snapshot to stripe_data
  stripeRows.push({
    record_type: 'mrr_snapshot',
    amount_usd: parseFloat(totalMRRDollars.toFixed(2)),
    properties: { date, subscription_count: activeCount },
    recorded_at: new Date().toISOString(),
  });

  // Upsert per-subscription rows into stripe_data in batches
  if (stripeRows.length > 0) {
    for (let i = 0; i < stripeRows.length; i += 100) {
      const { error } = await supabase.from('stripe_data').insert(stripeRows.slice(i, i + 100));
      if (error) console.warn('[Stripe Sync] stripe_data insert partial error:', error.message);
    }
    console.log(`[Stripe Sync] Wrote ${stripeRows.length} rows to stripe_data`);
  }

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

/** Sync recent charges (last 30 days) into stripe_data for revenue analysis */
export async function syncRecentCharges(supabase: SupabaseClient): Promise<{ charges: number }> {
  const stripe = getStripeClient();
  const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

  let chargeCount = 0;
  let hasMore = true;
  let startingAfter: string | undefined;
  const rows: Array<Record<string, unknown>> = [];

  while (hasMore && rows.length < 500) {
    const params: Record<string, unknown> = { limit: 100, created: { gte: thirtyDaysAgo } };
    if (startingAfter) params.starting_after = startingAfter;

    const charges = await stripe.charges.list(params as Parameters<typeof stripe.charges.list>[0]);

    for (const charge of charges.data) {
      if (charge.status !== 'succeeded') continue;

      const cohortDate = new Date(charge.created * 1000);
      const cohortMonth = `${cohortDate.getFullYear()}-${String(cohortDate.getMonth() + 1).padStart(2, '0')}`;

      rows.push({
        record_type: 'charge',
        customer_id: typeof charge.customer === 'string' ? charge.customer : null,
        amount_usd: parseFloat((charge.amount / 100).toFixed(2)),
        status: charge.status,
        cohort_month: cohortMonth,
        properties: {
          stripe_charge_id: charge.id,
          description: charge.description,
          invoice: charge.invoice,
          currency: charge.currency,
        },
        recorded_at: new Date(charge.created * 1000).toISOString(),
      });
    }

    chargeCount += charges.data.length;
    hasMore = charges.has_more;
    if (charges.data.length > 0) startingAfter = charges.data[charges.data.length - 1].id;
  }

  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabase.from('stripe_data').insert(rows.slice(i, i + 100));
      if (error) console.warn('[Stripe Sync] charges insert error:', error.message);
    }
    console.log(`[Stripe Sync] Wrote ${rows.length} charge rows to stripe_data`);
  }

  return { charges: rows.length };
}

/** Run all Stripe sync operations */
export async function syncAll(supabase: SupabaseClient) {
  const [mrrResult, churnResult, chargesResult] = await Promise.all([
    syncMRR(supabase),
    syncChurnRate(supabase),
    syncRecentCharges(supabase),
  ]);
  return { ...mrrResult, ...churnResult, ...chargesResult };
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

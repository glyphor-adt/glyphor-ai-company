/**
 * Mercury Queries — Sync banking data to Supabase financials table
 *
 * Writes these metrics:
 * - cash_balance: Total cash across all Mercury accounts
 * - cash_inflow: Daily deposits/credits
 * - cash_outflow: Daily debits/withdrawals
 * - burn_rate: 30-day average daily net spend
 * - vendor_subscription: Monthly cost per vendor (recurring payments)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { listAccounts, listTransactions } from './client.js';

/** Sync total cash balance across all Mercury accounts */
export async function syncCashBalance(supabase: SupabaseClient): Promise<{ totalBalance: number }> {
  const accounts = await listAccounts();
  const date = new Date().toISOString().split('T')[0];

  let totalBalance = 0;
  for (const account of accounts) {
    if (account.status === 'active') {
      totalBalance += account.currentBalance;
    }
  }

  await upsertFinancial(supabase, date, null, 'cash_balance', totalBalance, {
    source: 'mercury',
    accounts: accounts.map((a) => ({ name: a.name, balance: a.currentBalance, status: a.status })),
  });

  console.log(`[Mercury] Cash balance: $${totalBalance.toFixed(2)} across ${accounts.length} accounts`);
  return { totalBalance };
}

/** Sync daily cash flows (inflows/outflows) for the last N days */
export async function syncCashFlows(
  supabase: SupabaseClient,
  days = 30,
): Promise<{ synced: number }> {
  const accounts = await listAccounts();
  const activeAccounts = accounts.filter((a) => a.status === 'active');

  const end = new Date().toISOString().split('T')[0];
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Aggregate flows by date across all accounts
  const dailyInflow = new Map<string, number>();
  const dailyOutflow = new Map<string, number>();

  for (const account of activeAccounts) {
    const transactions = await listTransactions(account.id, start, end);

    for (const tx of transactions) {
      if (tx.status === 'cancelled' || tx.status === 'failed') continue;
      const txDate = (tx.postedAt ?? tx.createdAt).split('T')[0];

      if (tx.amount > 0) {
        dailyInflow.set(txDate, (dailyInflow.get(txDate) ?? 0) + tx.amount);
      } else {
        dailyOutflow.set(txDate, (dailyOutflow.get(txDate) ?? 0) + Math.abs(tx.amount));
      }
    }
  }

  let synced = 0;

  // Write inflows
  for (const [date, amount] of dailyInflow) {
    await upsertFinancial(supabase, date, null, 'cash_inflow', amount, { source: 'mercury' });
    synced++;
  }

  // Write outflows
  for (const [date, amount] of dailyOutflow) {
    await upsertFinancial(supabase, date, null, 'cash_outflow', amount, { source: 'mercury' });
    synced++;
  }

  // Calculate 30-day burn rate (average daily net spend)
  const totalOutflow = Array.from(dailyOutflow.values()).reduce((sum, v) => sum + v, 0);
  const totalInflow = Array.from(dailyInflow.values()).reduce((sum, v) => sum + v, 0);
  const netBurn = totalOutflow - totalInflow;
  const dailyBurn = netBurn / days;

  if (dailyBurn > 0) {
    await upsertFinancial(supabase, end, null, 'burn_rate', parseFloat((dailyBurn * 30).toFixed(2)), {
      source: 'mercury',
      period_days: days,
      total_outflow: totalOutflow,
      total_inflow: totalInflow,
    });
    synced++;
  }

  console.log(`[Mercury] Synced ${synced} cash flow records over ${days} days`);
  return { synced };
}

/**
 * Sync vendor subscription breakdown from Mercury transactions.
 * Looks at 90 days of outgoing transactions, groups by counterparty,
 * and identifies recurring vendor payments (2+ occurrences).
 */
export async function syncSubscriptions(
  supabase: SupabaseClient,
  days = 90,
): Promise<{ vendors: number }> {
  const accounts = await listAccounts();
  const activeAccounts = accounts.filter((a) => a.status === 'active');

  const end = new Date().toISOString().split('T')[0];
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Collect all outgoing transactions across accounts
  const vendorTotals = new Map<string, { total: number; count: number; lastDate: string }>();

  for (const account of activeAccounts) {
    const transactions = await listTransactions(account.id, start, end);

    for (const tx of transactions) {
      if (tx.status === 'cancelled' || tx.status === 'failed') continue;
      if (tx.amount >= 0) continue; // skip inflows
      if (!tx.counterpartyName) continue;

      // Skip internal transfers and Mercury fees
      const name = tx.counterpartyName.trim();
      if (name.toLowerCase().includes('mercury') || name.toLowerCase().includes('transfer')) continue;

      const existing = vendorTotals.get(name) ?? { total: 0, count: 0, lastDate: '' };
      existing.total += Math.abs(tx.amount);
      existing.count += 1;
      const txDate = (tx.postedAt ?? tx.createdAt).split('T')[0];
      if (txDate > existing.lastDate) existing.lastDate = txDate;
      vendorTotals.set(name, existing);
    }
  }

  // Only include vendors with 2+ payments (recurring) OR known SaaS vendors
  const months = days / 30;
  const today = new Date().toISOString().split('T')[0];
  let vendors = 0;

  for (const [vendor, { total, count, lastDate }] of vendorTotals) {
    if (count < 2) continue; // skip one-off payments
    const monthlyAvg = parseFloat((total / months).toFixed(2));

    await upsertFinancial(supabase, today, vendor, 'vendor_subscription', monthlyAvg, {
      source: 'mercury',
      total_spent: total,
      payment_count: count,
      last_payment: lastDate,
      period_days: days,
    });
    vendors++;
  }

  console.log(`[Mercury] Synced ${vendors} vendor subscriptions over ${days} days`);
  return { vendors };
}

/** Run all Mercury sync operations */
export async function syncAll(supabase: SupabaseClient) {
  const [balanceResult, flowResult, subResult] = await Promise.all([
    syncCashBalance(supabase),
    syncCashFlows(supabase),
    syncSubscriptions(supabase),
  ]);
  return { ...balanceResult, ...flowResult, ...subResult };
}

async function upsertFinancial(
  supabase: SupabaseClient,
  date: string,
  product: string | null,
  metric: string,
  value: number,
  details?: Record<string, unknown>,
) {
  let query = supabase.from('financials').select('id').eq('date', date).eq('metric', metric);
  if (product) {
    query = query.eq('product', product);
  } else {
    query = query.is('product', null);
  }
  const { data: existing } = await query.limit(1);

  if (existing && existing.length > 0) {
    await supabase.from('financials').update({ value, details }).eq('id', existing[0].id);
  } else {
    await supabase.from('financials').insert({ date, product, metric, value, details });
  }
}

/**
 * Cloud credit ledger — Postgres-backed usage with in-memory remaining-credit cache.
 */

import { systemQuery, systemTransaction } from '@glyphor/shared/db';
import { estimateModelCost, getModel, resolveModel } from '@glyphor/shared';
import type { PoolClient } from 'pg';

export type CreditCloud = 'aws' | 'azure' | 'gcp';

const STARTING_CREDITS_USD: Record<CreditCloud, number> = {
  aws: 1100,
  azure: 1000,
  gcp: 1000,
};

const CACHE_TTL_MS = 60_000;
let cache: { at: number; remaining: Record<CreditCloud, number> } | null = null;

export function inferBillingCloud(modelId: string): CreditCloud {
  const resolved = resolveModel(modelId);
  const def = getModel(resolved);
  if (def?.cloud) return def.cloud;
  if (resolved.startsWith('gemini-') || resolved.startsWith('deep-research-')) return 'gcp';
  if (
    resolved.startsWith('gpt-')
    || /^o[134](-|$)/.test(resolved)
    || resolved === 'model-router'
    || resolved.startsWith('model-router')
  ) {
    return 'azure';
  }
  if (resolved.startsWith('claude-') || resolved.startsWith('deepseek-')) return 'aws';
  return 'azure';
}

export async function recordUsage(
  cloud: CreditCloud,
  modelId: string,
  tokensIn: number,
  tokensOut: number,
  tenantId?: string | null,
  client?: PoolClient,
): Promise<void> {
  const resolved = resolveModel(modelId);
  const est = estimateModelCost(resolved, tokensIn, tokensOut);
  const run = async (c: PoolClient) => {
    await c.query(
      `INSERT INTO cloud_credit_ledger (cloud, model_id, tokens_in, tokens_out, est_cost_usd, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [cloud, resolved, tokensIn, tokensOut, est, tenantId ?? null],
    );
  };
  try {
    if (client) {
      await run(client);
    } else {
      await systemTransaction(run);
    }
    cache = null;
  } catch (e) {
    console.warn('[cloud_credit_ledger] recordUsage failed:', e);
  }
}

export async function getRemainingCredits(cloud: CreditCloud): Promise<number> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return cache.remaining[cloud];
  }

  const clouds: CreditCloud[] = ['aws', 'azure', 'gcp'];
  const spent: number[] = [];
  for (const c of clouds) {
    try {
      const rows = await systemQuery<{ s: string }>(
        `SELECT COALESCE(SUM(est_cost_usd), 0)::text AS s FROM cloud_credit_ledger WHERE cloud = $1`,
        [c],
      );
      spent.push(parseFloat(rows[0]?.s ?? '0') || 0);
    } catch {
      spent.push(0);
    }
  }

  const remaining: Record<CreditCloud, number> = {
    aws: Math.max(0, STARTING_CREDITS_USD.aws - (spent[0] ?? 0)),
    azure: Math.max(0, STARTING_CREDITS_USD.azure - (spent[1] ?? 0)),
    gcp: Math.max(0, STARTING_CREDITS_USD.gcp - (spent[2] ?? 0)),
  };
  cache = { at: now, remaining };
  return remaining[cloud];
}

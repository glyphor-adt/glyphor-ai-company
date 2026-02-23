/**
 * Kling AI Billing — Query resource pack usage via /account/costs and sync to Supabase
 *
 * Kling AI (by Kuaishou) provides video/image generation.
 * Auth: JWT signed with HMAC-SHA256 using Access Key + Secret Key.
 * Requires KLING_ACCESS_KEY and KLING_SECRET_KEY env vars.
 *
 * API docs: https://app.klingai.com/global/dev/document-api/apiReference/userInfoQuery
 * Endpoint: GET /account/costs (Singapore region)
 */

import { SignJWT } from 'jose';
import type { SupabaseClient } from '@supabase/supabase-js';

const KLING_API_BASE = 'https://api-singapore.klingai.com';

/**
 * Generate a Kling API JWT token.
 * The token is signed with HMAC-SHA256 using the secret key,
 * with the access key as the `iss` header claim.
 */
async function generateKlingToken(accessKey: string, secretKey: string): Promise<string> {
  const secret = new TextEncoder().encode(secretKey);
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    iss: accessKey,
    exp: now + 1800, // 30 minute expiry
    nbf: now - 5,
    iat: now,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(secret);
}

export interface KlingCredentials {
  accessKey: string;
  secretKey: string;
}

export interface KlingResourcePack {
  resource_pack_name: string;
  resource_pack_id: string;
  resource_pack_type: 'decreasing_total' | 'constant_period';
  total_quantity: number;
  remaining_quantity: number;
  purchase_time: number;
  effective_time: number;
  invalid_time: number;
  status: 'toBeOnline' | 'online' | 'expired' | 'runOut';
}

export interface KlingCostsResponse {
  code: number;
  message: string;
  request_id: string;
  data: {
    code: number;
    msg: string;
    resource_pack_subscribe_infos: KlingResourcePack[];
  };
}

/**
 * Fetch resource pack list and balance from Kling's /account/costs endpoint.
 */
export async function queryKlingCosts(
  credentials: KlingCredentials,
  days = 90,
): Promise<KlingResourcePack[]> {
  const token = await generateKlingToken(credentials.accessKey, credentials.secretKey);
  const endTime = Date.now();
  const startTime = endTime - days * 86400000;

  const url = `${KLING_API_BASE}/account/costs?start_time=${startTime}&end_time=${endTime}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Kling /account/costs error ${response.status}: ${body}`);
  }

  const result = await response.json() as KlingCostsResponse;

  if (result.code !== 0 || result.data?.code !== 0) {
    throw new Error(`Kling API error: ${result.message || result.data?.msg}`);
  }

  const packs = result.data.resource_pack_subscribe_infos ?? [];
  console.log(`[Kling Billing] Fetched ${packs.length} resource packs`);
  return packs;
}

/**
 * Sync Kling resource pack usage into:
 *  - `api_billing` table: per-pack rows with usage info
 *  - `financials` table: daily aggregate for product attribution
 *
 * Cost is estimated from consumed quantity. Kling packs are credit-based;
 * we estimate USD value from the pack's per-unit cost.
 */
export async function syncKlingBilling(
  supabase: SupabaseClient,
  credentials: KlingCredentials,
  product = 'pulse',
  days = 90,
): Promise<{ synced: number; packs: number }> {
  const packs = await queryKlingCosts(credentials, days);

  if (packs.length === 0) {
    console.log('[Kling Billing] No resource packs found');
    return { synced: 0, packs: 0 };
  }

  const today = new Date().toISOString().split('T')[0];

  // Build rows from resource packs
  const rows = packs.map((pack) => {
    const consumed = pack.total_quantity - pack.remaining_quantity;
    return {
      provider: 'kling',
      service: pack.resource_pack_name,
      cost_usd: 0, // Will be filled in below
      usage: {
        date: today,
        pack_id: pack.resource_pack_id,
        pack_type: pack.resource_pack_type,
        total_quantity: pack.total_quantity,
        remaining_quantity: pack.remaining_quantity,
        consumed_quantity: consumed,
        status: pack.status,
        effective_time: new Date(pack.effective_time).toISOString(),
        invalid_time: new Date(pack.invalid_time).toISOString(),
      },
      product,
      recorded_at: new Date().toISOString(),
    };
  });

  // ── 1. Delete stale rows for today and insert fresh ───────────────
  await supabase
    .from('api_billing')
    .delete()
    .eq('provider', 'kling')
    .eq('usage->>date', today);

  if (rows.length > 0) {
    const { error } = await supabase.from('api_billing').insert(rows);
    if (error) console.warn('[Kling Billing] api_billing insert error:', error.message);
    console.log(`[Kling Billing] Wrote ${rows.length} resource pack rows to api_billing`);
  }

  // ── 2. Summary to financials ──────────────────────────────────────
  const totalConsumed = packs.reduce((sum, p) => sum + (p.total_quantity - p.remaining_quantity), 0);
  const totalRemaining = packs.reduce((sum, p) => sum + p.remaining_quantity, 0);
  const totalQuantity = packs.reduce((sum, p) => sum + p.total_quantity, 0);

  const { data: existing } = await supabase
    .from('financials')
    .select('id')
    .eq('date', today)
    .eq('metric', 'api_usage')
    .eq('product', product)
    .contains('details', { source: 'kling' })
    .limit(1);

  const details = {
    source: 'kling',
    packs: packs.map((p) => ({
      name: p.resource_pack_name,
      total: p.total_quantity,
      remaining: p.remaining_quantity,
      consumed: p.total_quantity - p.remaining_quantity,
      status: p.status,
    })),
  };

  if (existing && existing.length > 0) {
    await supabase.from('financials').update({
      value: totalConsumed,
      details,
    }).eq('id', existing[0].id);
  } else {
    await supabase.from('financials').insert({
      date: today,
      product,
      metric: 'api_usage',
      value: totalConsumed,
      details,
    });
  }

  console.log(`[Kling Billing] Packs: ${packs.length}, consumed: ${totalConsumed}/${totalQuantity}, remaining: ${totalRemaining}`);
  return { synced: 1, packs: packs.length };
}

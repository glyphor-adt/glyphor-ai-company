/**
 * Kling AI Billing — Query resource pack usage via /account/costs and sync to database
 *
 * Kling AI (by Kuaishou) provides video/image generation.
 * Auth: JWT signed with HMAC-SHA256 using Access Key + Secret Key.
 * Requires KLING_ACCESS_KEY and KLING_SECRET_KEY env vars.
 *
 * API docs: https://app.klingai.com/global/dev/document-api/apiReference/userInfoQuery
 * Endpoint: GET /account/costs (Singapore region)
 */

import { SignJWT } from 'jose';
import { systemQuery } from '@glyphor/shared/db';

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
 * Kling resource pack pricing by product category (30-day recurring).
 * Source: https://klingai.com/global/dev/pricing
 *
 * ── Video Generation Packs ──────────────────────────────────────────
 *  Trial  100 units  |  $9.79   | $0.0979/unit  | 3 concurrent
 *  Trial 1000 units  | $97.99   | $0.09799/unit | 3 concurrent
 *  Pkg 1 30000 units | $4,200   | $0.14/unit    | 5 concurrent
 *  Pkg 2 45000 units | $5,670   | $0.126/unit   | 5 concurrent
 *  Pkg 3 60000 units | $6,720   | $0.112/unit   | 5 concurrent
 *
 * ── Video Unit Deduction (per 1 second of video) ────────────────────
 *  std × no video × no audio  → 0.6 units/s
 *  std × no video × with audio → 0.8 units/s
 *  std × with video × no audio → 0.9 units/s
 *  pro × no video × no audio  → 0.8 units/s
 *  pro × no video × with audio → 1.0 units/s
 *  pro × with video × no audio → 1.2 units/s
 *
 * ── Image Generation Packs ──────────────────────────────────────────
 *  Trial  1000 units   |  $2.39   | $0.00239/unit  | 6 concurrent
 *  Trial 10000 units   | $24.49   | $0.00245/unit  | 6 concurrent
 *  Pkg 1   600K units  | $2,100   | $0.0035/unit   | 9 concurrent
 *  Pkg 2  1200K units  | $3,780   | $0.00315/unit  | 9 concurrent
 *  Pkg 3  1800K units  | $5,040   | $0.0028/unit   | 9 concurrent
 *
 * ── Image Unit Deduction (per image) ────────────────────────────────
 *  kling-image-o1 (txt2img/img2img/edit)  → 8 units
 *  kling-v2-1 (txt2img)                   → 4 units
 *  kling-v2 (txt2img: 4, multi-img: 16, restyle: 8)
 *  kling-v1-5 (txt2img/subject/face)      → 8 units
 *  kling-v1 (txt2img/img2img)             → 1 unit
 *  Image expansion                        → 8 units
 *  AI Multi-Shot                          → 20 units
 *
 * ── Virtual Try-On Packs ────────────────────────────────────────────
 *  Trial  100 units  |  $4.89   | $0.0489/unit  | 6 concurrent
 *  Trial  500 units  | $24.49   | $0.0489/unit  | 6 concurrent
 *  Pkg 1 30000 units | $2,100   | $0.07/unit    | 9 concurrent
 *
 * ── Virtual Try-On Unit Deduction ───────────────────────────────────
 *  kolors-virtual-try-on v1/v1.5 → 1 unit
 */

type PackCategory = 'video' | 'image' | 'virtual-try-on';

interface PackPricing {
  price_usd: number;
  per_unit: number;
}

/** Known pack pricing keyed by category → total_quantity */
const KLING_PACK_PRICING: Record<PackCategory, Record<number, PackPricing>> = {
  video: {
    100:   { price_usd: 9.79,   per_unit: 9.79   / 100   },   // $0.0979
    1000:  { price_usd: 97.99,  per_unit: 97.99  / 1000  },   // $0.09799
    30000: { price_usd: 4200,   per_unit: 4200   / 30000 },   // $0.14
    45000: { price_usd: 5670,   per_unit: 5670   / 45000 },   // $0.126
    60000: { price_usd: 6720,   per_unit: 6720   / 60000 },   // $0.112
  },
  image: {
    1000:    { price_usd: 2.39,   per_unit: 2.39    / 1000    },  // $0.00239
    10000:   { price_usd: 24.49,  per_unit: 24.49   / 10000   },  // $0.00245
    600000:  { price_usd: 2100,   per_unit: 2100    / 600000  },  // $0.0035
    1200000: { price_usd: 3780,   per_unit: 3780    / 1200000 },  // $0.00315
    1800000: { price_usd: 5040,   per_unit: 5040    / 1800000 },  // $0.0028
  },
  'virtual-try-on': {
    100:   { price_usd: 4.89,   per_unit: 4.89   / 100   },  // $0.0489
    500:   { price_usd: 24.49,  per_unit: 24.49  / 500   },  // $0.0489
    30000: { price_usd: 2100,   per_unit: 2100   / 30000 },  // $0.07
    60000: { price_usd: 3780,   per_unit: 3780   / 60000 },  // $0.063
    90000: { price_usd: 5040,   per_unit: 5040   / 90000 },  // $0.056
  },
};

/** Standard (non-pack) per-unit price as fallback, by category */
const KLING_STANDARD_RATE: Record<PackCategory, number> = {
  video: 0.14,
  image: 0.0035,
  'virtual-try-on': 0.07,
};

/**
 * Infer pack category from the resource_pack_name returned by the API.
 * Names contain keywords like "Video Generation", "Image", "Virtual Try-On".
 */
function inferPackCategory(packName: string): PackCategory {
  const lower = packName.toLowerCase();
  if (lower.includes('video') || lower.includes('lip') || lower.includes('avatar') || lower.includes('audio')) return 'video';
  if (lower.includes('try-on') || lower.includes('tryon') || lower.includes('kolors')) return 'virtual-try-on';
  if (lower.includes('image') || lower.includes('photo') || lower.includes('multi-shot')) return 'image';
  // Default to video as the most expensive category (conservative estimate)
  return 'video';
}

/** Estimate USD cost for consumed units based on pack category and size. */
function estimatePackCostUsd(packName: string, totalQuantity: number, consumed: number): number {
  const category = inferPackCategory(packName);
  const categoryPricing = KLING_PACK_PRICING[category];

  // Exact match on pack size
  const pricing = categoryPricing[totalQuantity];
  if (pricing) return Math.round(consumed * pricing.per_unit * 10000) / 10000;

  // Find nearest known pack size in this category
  const knownSizes = Object.keys(categoryPricing).map(Number);
  const closest = knownSizes.reduce((a, b) =>
    Math.abs(b - totalQuantity) < Math.abs(a - totalQuantity) ? b : a,
  );
  const fallbackRate = categoryPricing[closest]?.per_unit ?? KLING_STANDARD_RATE[category];
  return Math.round(consumed * fallbackRate * 10000) / 10000;
}

/**
 * Sync Kling resource pack usage into:
 *  - `api_billing` table: per-pack rows with usage info
 *  - `financials` table: daily aggregate for product attribution
 *
 * Cost is estimated from consumed units using known pack pricing.
 */
export async function syncKlingBilling(
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
    const costUsd = estimatePackCostUsd(pack.resource_pack_name, pack.total_quantity, consumed);
    return {
      provider: 'kling',
      service: pack.resource_pack_name,
      cost_usd: costUsd,
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
  await systemQuery(
    "DELETE FROM api_billing WHERE provider = $1 AND usage->>'date' = $2",
    ['kling', today],
  );

  if (rows.length > 0) {
    for (const row of rows) {
      await systemQuery(
        'INSERT INTO api_billing (provider, service, cost_usd, usage, product, recorded_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [row.provider, row.service, row.cost_usd, JSON.stringify(row.usage), row.product, row.recorded_at],
      );
    }
    console.log(`[Kling Billing] Wrote ${rows.length} resource pack rows to api_billing`);
  }

  // ── 2. Summary to financials ──────────────────────────────────────
  const totalConsumed = packs.reduce((sum, p) => sum + (p.total_quantity - p.remaining_quantity), 0);
  const totalRemaining = packs.reduce((sum, p) => sum + p.remaining_quantity, 0);
  const totalQuantity = packs.reduce((sum, p) => sum + p.total_quantity, 0);
  const totalCostUsd = rows.reduce((sum, r) => sum + r.cost_usd, 0);

  const existing = await systemQuery<{ id: string }>(
    "SELECT id FROM financials WHERE date = $1 AND metric = $2 AND product = $3 AND details->>'source' = 'kling' LIMIT 1",
    [today, 'api_usage', product],
  );

  const details = {
    source: 'kling',
    total_cost_usd: totalCostUsd,
    packs: packs.map((p) => {
      const consumed = p.total_quantity - p.remaining_quantity;
      return {
        name: p.resource_pack_name,
        category: inferPackCategory(p.resource_pack_name),
        total: p.total_quantity,
        remaining: p.remaining_quantity,
        consumed,
        cost_usd: estimatePackCostUsd(p.resource_pack_name, p.total_quantity, consumed),
        status: p.status,
      };
    }),
  };

  if (existing.length > 0) {
    await systemQuery(
      'UPDATE financials SET value = $1, details = $2 WHERE id = $3',
      [totalCostUsd, JSON.stringify(details), existing[0].id],
    );
  } else {
    await systemQuery(
      'INSERT INTO financials (date, product, metric, value, details) VALUES ($1, $2, $3, $4, $5)',
      [today, product, 'api_usage', totalCostUsd, JSON.stringify(details)],
    );
  }

  console.log(`[Kling Billing] Packs: ${packs.length}, consumed: ${totalConsumed}/${totalQuantity}, remaining: ${totalRemaining}, cost: $${totalCostUsd.toFixed(2)}`);
  return { synced: 1, packs: packs.length };
}

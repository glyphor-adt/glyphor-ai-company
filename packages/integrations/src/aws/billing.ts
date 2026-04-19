/**
 * AWS Cost Explorer — Query daily Bedrock spend and sync to `api_billing`.
 *
 * Uses AWS SigV4 signing via fetch so no SDK dependency is needed.
 *
 * Requires IAM permission `ce:GetCostAndUsage` on the AWS identity whose
 * credentials are configured via the standard env chain
 * (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION, or AWS_PROFILE).
 */
import { createHash, createHmac } from 'node:crypto';
import { systemQuery } from '@glyphor/shared/db';

const CE_ENDPOINT = 'https://ce.us-east-1.amazonaws.com/';
const CE_REGION = 'us-east-1'; // Cost Explorer is only available in us-east-1
const CE_SERVICE = 'ce';

interface SigningCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

function getCreds(): SigningCreds {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials missing: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
  }
  return { accessKeyId, secretAccessKey, sessionToken: process.env.AWS_SESSION_TOKEN };
}

function hash(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function signRequest(method: string, path: string, body: string, target: string, creds: SigningCreds) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = path;
  const canonicalQuery = '';
  const payloadHash = hash(body);
  const host = 'ce.us-east-1.amazonaws.com';

  const headersList: Array<[string, string]> = [
    ['content-type', 'application/x-amz-json-1.1'],
    ['host', host],
    ['x-amz-date', amzDate],
    ['x-amz-target', target],
  ];
  if (creds.sessionToken) headersList.push(['x-amz-security-token', creds.sessionToken]);
  headersList.sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalHeaders = headersList.map(([k, v]) => `${k}:${v.trim()}`).join('\n') + '\n';
  const signedHeaders = headersList.map(([k]) => k).join(';');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = `${dateStamp}/${CE_REGION}/${CE_SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, hash(canonicalRequest)].join('\n');

  const kDate = hmac('AWS4' + creds.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, CE_REGION);
  const kService = hmac(kRegion, CE_SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    'content-type': 'application/x-amz-json-1.1',
    'host': host,
    'x-amz-date': amzDate,
    'x-amz-target': target,
    'authorization': authorization,
  };
  if (creds.sessionToken) headers['x-amz-security-token'] = creds.sessionToken;
  return headers;
}

interface CeGroup {
  Keys: string[];
  Metrics: Record<string, { Amount: string; Unit: string }>;
}

interface CeResultByTime {
  TimePeriod: { Start: string; End: string };
  Groups?: CeGroup[];
  Total?: Record<string, { Amount: string; Unit: string }>;
}

interface CeResponse {
  ResultsByTime: CeResultByTime[];
  DimensionValueAttributes?: unknown;
  NextPageToken?: string;
}

export interface AwsBedrockDailyRow {
  date: string;
  usageType: string;
  cost: number;
  currency: string;
}

/**
 * Query AWS Cost Explorer for daily Bedrock spend grouped by USAGE_TYPE
 * (which encodes model + input/output for Bedrock on-demand invocations).
 */
export async function queryBedrockCosts(days = 30): Promise<AwsBedrockDailyRow[]> {
  const creds = getCreds();
  const endDate = new Date();
  const startDate = new Date(Date.now() - days * 86400000);
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];

  const rows: AwsBedrockDailyRow[] = [];
  let nextToken: string | undefined;

  do {
    const payload: Record<string, unknown> = {
      TimePeriod: { Start: startStr, End: endStr },
      Granularity: 'DAILY',
      Metrics: ['UnblendedCost'],
      Filter: {
        Dimensions: { Key: 'SERVICE', Values: ['Amazon Bedrock'] },
      },
      GroupBy: [{ Type: 'DIMENSION', Key: 'USAGE_TYPE' }],
    };
    if (nextToken) payload.NextPageToken = nextToken;
    const body = JSON.stringify(payload);
    const headers = signRequest('POST', '/', body, 'AWSInsightsIndexService.GetCostAndUsage', creds);

    const res = await fetch(CE_ENDPOINT, { method: 'POST', headers, body });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Cost Explorer error ${res.status}: ${errText}`);
    }
    const data = (await res.json()) as CeResponse;

    for (const period of data.ResultsByTime ?? []) {
      const date = period.TimePeriod.Start;
      for (const g of period.Groups ?? []) {
        const amount = parseFloat(g.Metrics?.UnblendedCost?.Amount ?? '0');
        if (!amount || Number.isNaN(amount)) continue;
        rows.push({
          date,
          usageType: g.Keys?.[0] ?? 'unknown',
          cost: parseFloat(amount.toFixed(6)),
          currency: g.Metrics?.UnblendedCost?.Unit ?? 'USD',
        });
      }
    }

    nextToken = data.NextPageToken;
  } while (nextToken);

  console.log(`[AWS Bedrock Billing] Fetched ${rows.length} daily-per-usage-type rows`);
  return rows;
}

/**
 * Map a Bedrock usage_type string (e.g. "USW2-bedrock:anthropic.claude-sonnet-4-20250514-v1:0:0:input-tokens")
 * to a normalized model slug matching our model_rate_card.
 */
function normalizeUsageType(usageType: string): { model: string; kind: 'input' | 'output' | 'other' } {
  const lower = usageType.toLowerCase();
  let kind: 'input' | 'output' | 'other' = 'other';
  if (lower.includes('input-tokens')) kind = 'input';
  else if (lower.includes('output-tokens')) kind = 'output';

  // Pull model id out of the usage type
  // Common pattern: "<region>-bedrock:<vendor>.<model-id>-<version>:...:..."
  const bedrockMatch = usageType.match(/bedrock:([a-z0-9.\-]+)/i);
  const modelRaw = bedrockMatch ? bedrockMatch[1] : usageType;

  // Best-effort mapping to our slugs
  let model = modelRaw;
  if (/claude-sonnet-4-(6|20250514|20240620|20241022)/i.test(modelRaw)) model = 'claude-sonnet-4-6';
  else if (/claude-sonnet-4-5/i.test(modelRaw)) model = 'claude-sonnet-4-5';
  else if (/claude-haiku-4-5/i.test(modelRaw)) model = 'claude-haiku-4-5';
  else if (/claude-opus-4-7/i.test(modelRaw)) model = 'claude-opus-4-7';
  else if (/claude-opus/i.test(modelRaw)) model = 'claude-opus-4-7';

  return { model, kind };
}

export async function syncAwsBedrockBilling(
  product = 'glyphor',
  days = 30,
): Promise<{ synced: number; models: number }> {
  const rawRows = await queryBedrockCosts(days);
  if (rawRows.length === 0) {
    console.log('[AWS Bedrock Billing] No Bedrock cost data — skipping');
    return { synced: 0, models: 0 };
  }

  const dailyTotals = new Map<string, number>();
  const inserts: Array<{
    provider: string;
    service: string;
    cost_usd: number;
    usage: Record<string, unknown>;
    product: string;
    recorded_at: string;
  }> = [];

  for (const r of rawRows) {
    const { model, kind } = normalizeUsageType(r.usageType);
    inserts.push({
      provider: 'aws',
      service: model,
      cost_usd: parseFloat(r.cost.toFixed(4)),
      usage: { date: r.date, usage_type: r.usageType, kind, currency: r.currency, cloud: 'aws', bedrock: true },
      product,
      recorded_at: new Date(`${r.date}T12:00:00Z`).toISOString(),
    });
    dailyTotals.set(r.date, (dailyTotals.get(r.date) ?? 0) + r.cost);
  }

  const uniqueDates = [...new Set(inserts.map((r) => (r.usage as { date: string }).date))];
  for (const date of uniqueDates) {
    await systemQuery("DELETE FROM api_billing WHERE provider = $1 AND usage->>'date' = $2", ['aws', date]);
  }
  for (const row of inserts) {
    await systemQuery(
      'INSERT INTO api_billing (provider, service, cost_usd, usage, product, recorded_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [row.provider, row.service, row.cost_usd, JSON.stringify(row.usage), row.product, row.recorded_at],
    );
  }
  console.log(`[AWS Bedrock Billing] Wrote ${inserts.length} rows to api_billing`);

  let synced = 0;
  for (const [date, totalCost] of dailyTotals) {
    const existing = await systemQuery<{ id: string }>(
      "SELECT id FROM financials WHERE date = $1 AND metric = $2 AND product = $3 AND details->>'source' = 'aws_bedrock' LIMIT 1",
      [date, 'api_cost', product],
    );
    const details = {
      source: 'aws_bedrock',
      models: inserts.filter((r) => (r.usage as { date: string }).date === date).map((r) => ({ model: r.service, cost: r.cost_usd })),
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

  const uniqueModels = new Set(inserts.map((r) => r.service));
  console.log(`[AWS Bedrock Billing] Synced ${synced} daily totals, ${uniqueModels.size} models`);
  return { synced, models: uniqueModels.size };
}

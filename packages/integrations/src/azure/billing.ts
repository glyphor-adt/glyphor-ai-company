/**
 * Azure Cost Management — Query daily Cognitive Services (Azure OpenAI)
 * spend and sync to `api_billing`.
 *
 * Uses OAuth2 client-credentials flow via fetch so no SDK dependency is needed.
 *
 * Env vars required:
 *   AZURE_TENANT_ID             — directory (tenant) ID
 *   AZURE_CLIENT_ID             — service principal app ID
 *   AZURE_CLIENT_SECRET         — SP secret
 *   AZURE_SUBSCRIPTION_ID       — subscription scope for cost query
 *
 * The SP needs the "Cost Management Reader" role (or broader) on the subscription.
 */
import { systemQuery } from '@glyphor/shared/db';

interface AzureCreds {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId: string;
}

function getCreds(): AzureCreds {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  if (!tenantId || !clientId || !clientSecret || !subscriptionId) {
    throw new Error(
      'Azure credentials missing: set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_SUBSCRIPTION_ID',
    );
  }
  return { tenantId, clientId, clientSecret, subscriptionId };
}

async function getAccessToken(creds: AzureCreds): Promise<string> {
  const url = `https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: 'https://management.azure.com/.default',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Azure token error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

interface AzureCostRow {
  date: string;          // yyyy-mm-dd
  serviceName: string;
  meter: string;         // meter name (e.g. "gpt-5.4 Input Tokens")
  cost: number;
  currency: string;
}

/**
 * Query Cost Management for daily Cognitive Services spend
 * grouped by ServiceName and MeterName.
 */
export async function queryAzureOpenAiCosts(days = 30): Promise<AzureCostRow[]> {
  const creds = getCreds();
  const token = await getAccessToken(creds);
  const endDate = new Date();
  const startDate = new Date(Date.now() - days * 86400000);
  const startStr = startDate.toISOString();
  const endStr = endDate.toISOString();

  const url =
    `https://management.azure.com/subscriptions/${creds.subscriptionId}` +
    `/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;

  const payload = {
    type: 'ActualCost',
    timeframe: 'Custom',
    timePeriod: { from: startStr, to: endStr },
    dataset: {
      granularity: 'Daily',
      aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
      grouping: [
        { type: 'Dimension', name: 'ServiceName' },
        { type: 'Dimension', name: 'MeterName' },
      ],
      filter: {
        Dimensions: {
          Name: 'ServiceName',
          Operator: 'In',
          Values: ['Cognitive Services', 'Azure OpenAI'],
        },
      },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Azure Cost Management error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    properties?: {
      columns?: Array<{ name: string; type: string }>;
      rows?: Array<Array<string | number>>;
    };
  };

  const cols = data.properties?.columns ?? [];
  const rows = data.properties?.rows ?? [];
  const idx = (name: string) => cols.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
  const iCost = idx('PreTaxCost') >= 0 ? idx('PreTaxCost') : idx('Cost');
  const iDate = idx('UsageDate');
  const iService = idx('ServiceName');
  const iMeter = idx('MeterName');
  const iCurrency = idx('Currency');

  const out: AzureCostRow[] = [];
  for (const row of rows) {
    const rawDate = String(row[iDate] ?? '');
    // Azure returns yyyymmdd as a number or string like "20260418"
    const date = /^\d{8}$/.test(rawDate) ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : rawDate;
    const cost = Number(row[iCost] ?? 0);
    if (!cost || Number.isNaN(cost)) continue;
    out.push({
      date,
      serviceName: String(row[iService] ?? 'unknown'),
      meter: String(row[iMeter] ?? 'unknown'),
      cost: parseFloat(cost.toFixed(6)),
      currency: String(row[iCurrency] ?? 'USD'),
    });
  }

  console.log(`[Azure OpenAI Billing] Fetched ${out.length} daily-per-meter rows`);
  return out;
}

/**
 * Map an Azure meter name to our rate-card model slug where possible.
 * Meter names vary; we make a best-effort classification.
 */
function normalizeMeter(meter: string): { model: string; kind: 'input' | 'output' | 'other' } {
  const lower = meter.toLowerCase();
  let kind: 'input' | 'output' | 'other' = 'other';
  if (lower.includes('input') || lower.includes('prompt')) kind = 'input';
  else if (lower.includes('output') || lower.includes('completion')) kind = 'output';

  let model = meter;
  if (/gpt-5\.4\s*mini/.test(lower)) model = 'gpt-5.4-mini';
  else if (/gpt-5\.4\s*nano/.test(lower)) model = 'gpt-5.4-nano';
  else if (/gpt-5\.4/.test(lower)) model = 'gpt-5.4';
  else if (/gpt-5\.2/.test(lower)) model = 'gpt-5.2';
  else if (/gpt-5\.1/.test(lower)) model = 'gpt-5.1';
  else if (/gpt-5\s*mini/.test(lower)) model = 'gpt-5-mini';
  else if (/gpt-5\s*nano/.test(lower)) model = 'gpt-5-nano';
  else if (/gpt-5\b/.test(lower)) model = 'gpt-5';
  else if (/\bo3\b/.test(lower)) model = 'o3';
  else if (/\bo4[\s-]?mini\b/.test(lower)) model = 'o4-mini';
  else if (/model[- ]router/.test(lower)) model = 'model-router';

  return { model, kind };
}

export async function syncAzureOpenAiBilling(
  product = 'glyphor',
  days = 30,
): Promise<{ synced: number; models: number }> {
  const rawRows = await queryAzureOpenAiCosts(days);
  if (rawRows.length === 0) {
    console.log('[Azure OpenAI Billing] No cost data — skipping');
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
    const { model, kind } = normalizeMeter(r.meter);
    inserts.push({
      provider: 'azure',
      service: model,
      cost_usd: parseFloat(r.cost.toFixed(4)),
      usage: {
        date: r.date,
        meter: r.meter,
        kind,
        service_name: r.serviceName,
        currency: r.currency,
        cloud: 'azure',
      },
      product,
      recorded_at: new Date(`${r.date}T12:00:00Z`).toISOString(),
    });
    dailyTotals.set(r.date, (dailyTotals.get(r.date) ?? 0) + r.cost);
  }

  const uniqueDates = [...new Set(inserts.map((r) => (r.usage as { date: string }).date))];
  for (const date of uniqueDates) {
    await systemQuery("DELETE FROM api_billing WHERE provider = $1 AND usage->>'date' = $2", ['azure', date]);
  }
  for (const row of inserts) {
    await systemQuery(
      'INSERT INTO api_billing (provider, service, cost_usd, usage, product, recorded_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [row.provider, row.service, row.cost_usd, JSON.stringify(row.usage), row.product, row.recorded_at],
    );
  }
  console.log(`[Azure OpenAI Billing] Wrote ${inserts.length} rows to api_billing`);

  let synced = 0;
  for (const [date, totalCost] of dailyTotals) {
    const existing = await systemQuery<{ id: string }>(
      "SELECT id FROM financials WHERE date = $1 AND metric = $2 AND product = $3 AND details->>'source' = 'azure_openai' LIMIT 1",
      [date, 'api_cost', product],
    );
    const details = {
      source: 'azure_openai',
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
  console.log(`[Azure OpenAI Billing] Synced ${synced} daily totals, ${uniqueModels.size} models`);
  return { synced, models: uniqueModels.size };
}

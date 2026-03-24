/**
 * modelChecker.ts
 * ---------------------------------------------------------------------------
 * Monthly model availability drift check.
 *
 * Fetches live model catalogs from:
 *   - Gemini API (x-goog-api-key)
 *   - Vertex AI Model Garden (ADC bearer token)
 *   - Azure AI Foundry (api-key on resource endpoint)
 *
 * Writes findings to fleet_findings and sends founder DMs via Agent365 when
 * there are actionable changes.
 * ---------------------------------------------------------------------------
 */

import { A365TeamsChatClient } from '@glyphor/integrations';
import { systemQuery } from '@glyphor/shared/db';
import { ALL_ACTIVE_MODELS, isDisabled, MODEL_CONFIG } from '@glyphor/shared';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { GoogleAuth } from 'google-auth-library';

type ProviderKey = 'gemini' | 'vertexAI' | 'azureFoundry';

export interface ModelCheckerResult {
  checkedAt: string;
  findingsCount: number;
  missingCount: number;
  newCount: number;
  fetchResults: Record<string, { ok: boolean; error?: string; count?: number }>;
  missing: Record<string, string[]>;
  discovered: Record<string, string[]>;
}

const secretClient = new SecretManagerServiceClient();
const gcpAuth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function providerOwnsModel(provider: ProviderKey, model: string): boolean {
  const owns = (MODEL_CONFIG.providers[provider].owns ?? []) as readonly string[];
  return owns.some((prefix) => model.startsWith(prefix));
}

function inferProvider(model: string): ProviderKey | null {
  if (providerOwnsModel('gemini', model)) return 'gemini';
  if (providerOwnsModel('vertexAI', model)) return 'vertexAI';
  if (providerOwnsModel('azureFoundry', model)) return 'azureFoundry';
  return null;
}

async function getSecret(envVar: string): Promise<string> {
  const fromEnv = process.env[envVar]?.trim();
  if (fromEnv) return fromEnv;

  const secretName = envVar.toLowerCase().replace(/_/g, '-');
  const projectId = MODEL_CONFIG.providers.vertexAI.gcpProject;
  const [version] = await secretClient.accessSecretVersion({
    name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
  });
  return version.payload?.data?.toString() ?? '';
}

async function fetchGeminiModels(): Promise<string[]> {
  const cfg = MODEL_CONFIG.providers.gemini;
  const apiKey = await getSecret(cfg.secretEnvVar);
  const res = await fetch(`${cfg.listEndpoint}?key=${encodeURIComponent(apiKey)}`);

  if (!res.ok) {
    throw new Error(`Gemini API ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as { models?: Array<{ name?: string }> };
  return dedupe((data.models ?? [])
    .map((m) => (m.name ?? '').replace('models/', '').trim())
    .filter(Boolean));
}

async function fetchVertexAnthropicModels(): Promise<string[]> {
  const cfg = MODEL_CONFIG.providers.vertexAI;
  const client = await gcpAuth.getClient();
  const token = await client.getAccessToken();
  const bearer = typeof token === 'string' ? token : token?.token;

  if (!bearer) {
    throw new Error('Vertex AI auth token unavailable');
  }

  const res = await fetch(cfg.listEndpoint, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Vertex AI ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as {
    publisherModels?: Array<{ name?: string; versionId?: string; model?: string }>;
    models?: Array<{ name?: string; versionId?: string; model?: string }>;
  };

  const source = data.publisherModels ?? data.models ?? [];
  return dedupe(source
    .map((m) => {
      if (m.versionId?.trim()) return m.versionId.trim();
      if (m.model?.trim()) return m.model.trim();
      const rawName = m.name?.trim() ?? '';
      if (!rawName) return '';
      const parts = rawName.split('/').filter(Boolean);
      return parts[parts.length - 1] ?? '';
    })
    .filter(Boolean));
}

async function fetchAzureFoundryModels(): Promise<string[]> {
  const cfg = MODEL_CONFIG.providers.azureFoundry;
  const apiKey = await getSecret(cfg.secretEnvVar);
  const baseUrl = await getSecret(cfg.resourceEnvVar);
  const endpoint = baseUrl.replace(/\/$/, '') + '/openai/v1/models';

  const res = await fetch(endpoint, {
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Azure Foundry ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as { data?: Array<{ id?: string }> };
  return dedupe((data.data ?? [])
    .map((m) => (m.id ?? '').trim())
    .filter(Boolean));
}

function modelFoundInProvider(liveModels: string[], model: string): boolean {
  if (liveModels.includes(model)) return true;

  // Vertex and some partner catalogs can include versioned suffixes.
  const coarsePrefix = model.split('-').slice(0, 3).join('-');
  if (!coarsePrefix) return false;

  return liveModels.some((live) =>
    live.startsWith(model) || model.startsWith(live) || live.startsWith(coarsePrefix));
}

async function writeFleetFinding(
  severity: 'P0' | 'P1' | 'P2',
  title: string,
  description: string,
  data: Record<string, unknown>,
): Promise<void> {
  const fullDescription = `${title}\n\n${description}\n\nEvidence: ${JSON.stringify(data)}`;
  await systemQuery(
    `INSERT INTO fleet_findings (agent_id, severity, finding_type, description)
     VALUES ($1, $2, $3, $4)`,
    ['model-checker', severity, 'model_config_drift', fullDescription],
  );
}

async function notifyFounders(subject: string, body: string): Promise<void> {
  try {
    const client = A365TeamsChatClient.fromEnv('ops');
    const founderEmails = [
      process.env.TEAMS_USER_KRISTINA_EMAIL ?? 'kristina@glyphor.ai',
      process.env.TEAMS_USER_ANDREW_EMAIL ?? 'andrew@glyphor.ai',
    ];

    for (const email of founderEmails) {
      const chatId = await client.createOrGetOneOnOneChat(email, undefined, 'ops');
      await client.postChatMessage(chatId, `**${subject}**\n\n${body}`, 'ops');
    }
  } catch (err) {
    console.warn('[ModelChecker] Teams notification failed:', (err as Error).message);
  }
}

async function updateReviewMeta(): Promise<void> {
  const now = new Date();
  const nextReview = new Date(now);
  nextReview.setMonth(nextReview.getMonth() + 1);

  await systemQuery(
    `INSERT INTO system_config (key, value, updated_at)
     VALUES ('model_config_meta', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [JSON.stringify({
      lastReviewedAt: now.toISOString(),
      nextReviewAt: nextReview.toISOString(),
      reviewedBy: 'model-checker-cron',
    })],
  );
}

export async function runModelChecker(): Promise<ModelCheckerResult> {
  console.log('[ModelChecker] Starting monthly model check...');

  const findings: string[] = [];
  const missing: Record<string, string[]> = {};
  const discovered: Record<string, string[]> = {};
  const checkedAt = new Date().toISOString();

  const liveModels: Record<string, string[]> = {};
  const fetchResults: Record<string, { ok: boolean; error?: string; count?: number }> = {};
  const fetchers: Array<[ProviderKey, () => Promise<string[]>]> = [
    ['gemini', fetchGeminiModels],
    ['vertexAI', fetchVertexAnthropicModels],
    ['azureFoundry', fetchAzureFoundryModels],
  ];

  for (const [name, fetcher] of fetchers) {
    try {
      liveModels[name] = await fetcher();
      fetchResults[name] = { ok: true, count: liveModels[name].length };
      console.log(`[ModelChecker] ${name}: ${liveModels[name].length} models available`);
    } catch (err) {
      const message = (err as Error).message;
      fetchResults[name] = { ok: false, error: message };
      findings.push(`Could not fetch ${name} model list: ${message}`);
      console.error(`[ModelChecker] Failed to fetch ${name} models:`, message);
    }
  }

  const activeConfiguredModels = dedupe(ALL_ACTIVE_MODELS.filter((model) => !isDisabled(model)));

  for (const model of activeConfiguredModels) {
    const provider = inferProvider(model);
    if (!provider) continue;

    const providerLiveModels = liveModels[provider] ?? [];
    if (providerLiveModels.length === 0) continue;

    if (!modelFoundInProvider(providerLiveModels, model)) {
      missing[provider] = missing[provider] ?? [];
      missing[provider].push(model);
      findings.push(`Missing in ${provider}: ${model}`);
    }
  }

  const interestingPatterns = [
    /^claude-(opus|sonnet|haiku)-\d/i,
    /^gemini-[3-9]\./i,
    /^gpt-[5-9]/i,
    /^o[3-9]-/i,
    /^imagen-[4-9]/i,
  ];

  for (const [provider, models] of Object.entries(liveModels)) {
    for (const model of models) {
      const known = activeConfiguredModels.some((m) => m.startsWith(model) || model.startsWith(m));
      const knownDisabled = Object.keys(MODEL_CONFIG.disabled).some((m) => m.startsWith(model) || model.startsWith(m));
      const isInteresting = interestingPatterns.some((p) => p.test(model));

      if (!known && !knownDisabled && isInteresting) {
        discovered[provider] = discovered[provider] ?? [];
        discovered[provider].push(model);
      }
    }
  }

  for (const key of Object.keys(missing)) missing[key] = dedupe(missing[key]);
  for (const key of Object.keys(discovered)) discovered[key] = dedupe(discovered[key]);

  const missingList = Object.values(missing).flat();
  const discoveredList = Object.values(discovered).flat();

  if (missingList.length > 0 || discoveredList.length > 0 || findings.length > 0) {
    await writeFleetFinding(
      missingList.length > 0 ? 'P1' : 'P2',
      `Monthly model check: ${findings.length} item(s)`,
      findings.length > 0 ? findings.join('\n') : 'New models detected for review.',
      { checkedAt, missing, discovered, fetchResults },
    );
  }

  if (missingList.length > 0 || discoveredList.length > 0) {
    const providerStatus = Object.entries(fetchResults)
      .map(([provider, result]) => `${provider}: ${result.ok ? 'ok' : 'error'}`)
      .join(' | ');

    const body = [
      '**Missing configured models:**',
      missingList.length > 0 ? missingList.map((m) => `- ${m}`).join('\n') : 'None',
      '',
      '**New models worth review:**',
      discoveredList.length > 0
        ? Object.entries(discovered).map(([provider, models]) => `- ${provider}: ${models.join(', ')}`).join('\n')
        : 'None',
      '',
      `Provider status: ${providerStatus}`,
    ].join('\n');

    await notifyFounders('Monthly Model Check - Action Required', body);
  } else {
    await notifyFounders(
      'Monthly Model Check - All Clear',
      'All configured active models were confirmed live. No notable new models detected.',
    );
  }

  await updateReviewMeta();

  console.log(
    `[ModelChecker] Done. Missing: ${missingList.length}, New: ${discoveredList.length}, Findings: ${findings.length}`,
  );

  return {
    checkedAt,
    findingsCount: findings.length,
    missingCount: missingList.length,
    newCount: discoveredList.length,
    fetchResults,
    missing,
    discovered,
  };
}
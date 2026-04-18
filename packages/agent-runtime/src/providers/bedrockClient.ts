/**
 * AWS Bedrock Runtime — InvokeModel / InvokeModelWithResponseStream helpers.
 *
 * Uses inference profile IDs (e.g. us.anthropic.claude-sonnet-4-6, us.deepseek.r1-v1:0).
 * IDs must match the Bedrock console / AWS docs for your account and region.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';

export interface BedrockInvokeResult {
  bodyJson: Record<string, unknown>;
  rawBytes: Uint8Array;
}

let cachedClient: BedrockRuntimeClient | null = null;
let secretManagerCredentials: { accessKeyId: string; secretAccessKey: string } | null = null;

/**
 * Bedrock is on when BEDROCK_ENABLED=true.
 * Credentials: optional IAM keys in env, or the SDK default chain (aws login, ~/.aws/credentials, SSO, AWS_PROFILE).
 */
export function isBedrockEnabled(): boolean {
  return process.env.BEDROCK_ENABLED === 'true';
}

export function getBedrockRegion(): string {
  return process.env.AWS_REGION?.trim() || 'us-east-1';
}

/**
 * Attempt to load AWS credentials from GCP Secret Manager as a fallback
 * when env vars are not available (e.g. wiped by a Cloud Run redeploy).
 * Uses the REST API with default service account token to avoid extra dependencies.
 */
async function loadCredentialsFromSecretManager(): Promise<{ accessKeyId: string; secretAccessKey: string } | null> {
  if (secretManagerCredentials) return secretManagerCredentials;
  const projectId = process.env.GCP_PROJECT_ID?.trim();
  if (!projectId) return null;

  try {
    // Get access token from GCP metadata server (works on Cloud Run)
    const tokenRes = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' } },
    );
    if (!tokenRes.ok) return null;
    const { access_token } = await tokenRes.json() as { access_token: string };

    const readSecret = async (secretName: string): Promise<string | null> => {
      const url = `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets/${secretName}/versions/latest:access`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
      if (!res.ok) return null;
      const data = await res.json() as { payload?: { data?: string } };
      return data.payload?.data ? Buffer.from(data.payload.data, 'base64').toString('utf-8').trim() : null;
    };

    const accessKeyId = await readSecret('aws-access-key-id');
    const secretAccessKey = await readSecret('aws-secret-access-key');
    if (accessKeyId && secretAccessKey) {
      secretManagerCredentials = { accessKeyId, secretAccessKey };
      console.log('[Bedrock] Loaded AWS credentials from GCP Secret Manager (env vars were missing)');
      return secretManagerCredentials;
    }
  } catch (err) {
    console.warn('[Bedrock] Failed to load credentials from Secret Manager:', (err as Error).message);
  }
  return null;
}

export async function ensureBedrockCredentials(): Promise<void> {
  if (process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim()) return;
  const creds = await loadCredentialsFromSecretManager();
  if (creds) {
    process.env.AWS_ACCESS_KEY_ID = creds.accessKeyId;
    process.env.AWS_SECRET_ACCESS_KEY = creds.secretAccessKey;
    // Reset cached client so it picks up new credentials
    cachedClient = null;
  }
}

export function getBedrockRuntimeClient(): BedrockRuntimeClient {
  if (cachedClient) return cachedClient;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  cachedClient = new BedrockRuntimeClient({
    region: getBedrockRegion(),
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });
  return cachedClient;
}

/**
 * Non-streaming InvokeModel. `modelId` is the Bedrock model or inference profile ID.
 * `extraHeaders` — for Anthropic beta features on Bedrock, `anthropic-beta` is injected
 * into the request body as `anthropic_beta` (Bedrock's native mechanism).
 */
export async function invokeBedrockModel(
  modelId: string,
  body: Uint8Array | string,
  extraHeaders?: Record<string, string>,
): Promise<BedrockInvokeResult> {
  await ensureBedrockCredentials();
  const client = getBedrockRuntimeClient();

  // Bedrock doesn't support custom HTTP headers on InvokeModel.
  // For Anthropic beta features, inject into the body as `anthropic_beta`.
  let bodyBytes: Uint8Array;
  if (extraHeaders?.['anthropic-beta'] && typeof body === 'string') {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    parsed.anthropic_beta = extraHeaders['anthropic-beta'].split(',').map(s => s.trim());
    bodyBytes = Buffer.from(JSON.stringify(parsed), 'utf-8');
  } else {
    bodyBytes = typeof body === 'string' ? Buffer.from(body, 'utf-8') : Buffer.from(body);
  }
  const resp = await client.send(
    new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: bodyBytes,
    }),
  );
  const text = resp.body ? await resp.body.transformToString() : '';
  const raw = text ? new TextEncoder().encode(text) : new Uint8Array();
  let bodyJson: Record<string, unknown> = {};
  try {
    bodyJson = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    bodyJson = { _parse_error: text.slice(0, 2000) };
  }
  return { bodyJson, rawBytes: raw };
}

export interface BedrockStreamChunk {
  bodyJson: Record<string, unknown>;
}

/**
 * Streaming InvokeModelWithResponseStream — yields parsed JSON chunks (provider-specific).
 */
export async function* invokeBedrockModelStream(
  modelId: string,
  body: Uint8Array | string,
  contentType = 'application/json',
): AsyncGenerator<BedrockStreamChunk> {
  await ensureBedrockCredentials();
  const client = getBedrockRuntimeClient();
  const bodyBytes = typeof body === 'string' ? Buffer.from(body, 'utf-8') : Buffer.from(body);
  const resp = await client.send(
    new InvokeModelWithResponseStreamCommand({
      modelId,
      contentType,
      accept: 'application/json',
      body: bodyBytes,
    }),
  );
  if (!resp.body) return;

  for await (const event of resp.body) {
    if (event.chunk?.bytes) {
      const text = new TextDecoder().decode(event.chunk.bytes);
      try {
        const bodyJson = JSON.parse(text) as Record<string, unknown>;
        yield { bodyJson };
      } catch {
        yield { bodyJson: { _raw_chunk: text.slice(0, 500) } };
      }
    }
  }
}

/** Lower-level name matching task spec — delegates to invokeBedrockModel. */
export async function invokeBedrock(
  modelId: string,
  messages: unknown,
  options: {
    system?: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    anthropicVersion?: string;
    /** When true, build Anthropic Messages API-compatible JSON for Bedrock. */
    format: 'anthropic_messages' | 'deepseek_completion';
    /** For deepseek_completion: single flattened prompt string */
    deepSeekPrompt?: string;
  },
): Promise<BedrockInvokeResult> {
  if (options.format === 'anthropic_messages') {
    const payload: Record<string, unknown> = {
      anthropic_version: options.anthropicVersion ?? 'bedrock-2023-05-31',
      max_tokens: options.maxTokens ?? 16_384,
      messages,
    };
    if (options.system) payload.system = options.system;
    if (options.temperature !== undefined) payload.temperature = options.temperature;
    if (options.topP !== undefined) payload.top_p = options.topP;
    return invokeBedrockModel(modelId, JSON.stringify(payload));
  }

  const prompt = options.deepSeekPrompt ?? '';
  const payload = {
    prompt,
    max_tokens: Math.min(options.maxTokens ?? 4096, 8192),
    temperature: options.temperature ?? 0.7,
    top_p: options.topP ?? 0.9,
  };
  return invokeBedrockModel(modelId, JSON.stringify(payload));
}

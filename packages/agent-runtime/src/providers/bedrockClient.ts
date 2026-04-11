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

export function getBedrockRuntimeClient(): BedrockRuntimeClient {
  if (cachedClient) return cachedClient;
  cachedClient = new BedrockRuntimeClient({
    region: getBedrockRegion(),
  });
  return cachedClient;
}

/**
 * Non-streaming InvokeModel. `modelId` is the Bedrock model or inference profile ID.
 */
export async function invokeBedrockModel(
  modelId: string,
  body: Uint8Array | string,
  contentType = 'application/json',
): Promise<BedrockInvokeResult> {
  const client = getBedrockRuntimeClient();
  const bodyBytes = typeof body === 'string' ? Buffer.from(body, 'utf-8') : Buffer.from(body);
  const resp = await client.send(
    new InvokeModelCommand({
      modelId,
      contentType,
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

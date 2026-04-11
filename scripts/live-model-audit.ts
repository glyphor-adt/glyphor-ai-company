import { ModelClient } from '../packages/agent-runtime/src/modelClient.js';
import { getGoogleAiApiKey } from '../packages/shared/src/googleAiEnv.js';
import { SUPPORTED_MODELS } from '../packages/shared/src/models.js';

interface AuditRow {
  model: string;
  provider: 'gemini' | 'openai' | 'anthropic';
  tier: string;
  mode: 'text' | 'image' | 'unsupported';
  status: 'pass' | 'fail' | 'skipped';
  detail: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

function getProvider(model: string): 'gemini' | 'openai' | 'anthropic' {
  if (model.startsWith('gemini-')) return 'gemini';
  if (model.startsWith('gpt-') || /^o[134](-|$)/.test(model)) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  throw new Error(`Unknown provider for model ${model}`);
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function truncate(input: string, max = 260): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 3)}...`;
}

async function main(): Promise<void> {
  const client = new ModelClient({
    geminiApiKey: getGoogleAiApiKey(),
    azureFoundryEndpoint: env('AZURE_FOUNDRY_ENDPOINT') ?? env('AZURE_OPENAI_ENDPOINT'),
    azureFoundryApi: env('AZURE_FOUNDRY_API') ?? env('AZURE_OPENAI_API_KEY'),
    azureFoundryApiVersion: env('AZURE_FOUNDRY_API_VERSION') ?? env('AZURE_OPENAI_API_VERSION'),
  });

  const rows: AuditRow[] = [];

  for (const model of SUPPORTED_MODELS) {
    const provider = getProvider(model.id);

    if (model.id.startsWith('gpt-image-')) {
      const started = Date.now();
      try {
        await client.generateImageOpenAI('Create a tiny monochrome checkmark icon on transparent background.', model.id);
        rows.push({
          model: model.id,
          provider,
          tier: model.tier,
          mode: 'image',
          status: 'pass',
          detail: 'Image generation call succeeded.',
          durationMs: Date.now() - started,
        });
      } catch (error) {
        rows.push({
          model: model.id,
          provider,
          tier: model.tier,
          mode: 'image',
          status: 'fail',
          detail: truncate((error as Error).message ?? String(error)),
          durationMs: Date.now() - started,
        });
      }
      continue;
    }

    if (model.id === 'gemini-embedding-001' || model.id === 'gpt-realtime-2025-08-28' || model.id.endsWith('-deep-research')) {
      rows.push({
        model: model.id,
        provider,
        tier: model.tier,
        mode: 'unsupported',
        status: 'skipped',
        detail: model.id.endsWith('-deep-research')
          ? 'Requires dedicated deep-research tool workflow (web_search/mcp/file_search) beyond simple text ping.'
          : 'Not callable through ModelClient.generate text path in current runtime.',
      });
      continue;
    }

    const started = Date.now();
    try {
      const response = await client.generate({
        model: model.id,
        systemInstruction: 'You are a terse test assistant. Reply with exactly the word OK.',
        contents: [{ role: 'user', content: 'Reply with OK only.', timestamp: Date.now() }],
        fallbackScope: 'none',
        temperature: 0,
        thinkingEnabled: false,
        callTimeoutMs: 45000,
      });

      rows.push({
        model: model.id,
        provider,
        tier: model.tier,
        mode: 'text',
        status: 'pass',
        detail: truncate(response.text ?? 'No text content returned.'),
        durationMs: Date.now() - started,
        inputTokens: response.usageMetadata.inputTokens,
        outputTokens: response.usageMetadata.outputTokens,
      });
    } catch (error) {
      rows.push({
        model: model.id,
        provider,
        tier: model.tier,
        mode: 'text',
        status: 'fail',
        detail: truncate((error as Error).message ?? String(error)),
        durationMs: Date.now() - started,
      });
    }
  }

  const summary = {
    total: rows.length,
    pass: rows.filter((r) => r.status === 'pass').length,
    fail: rows.filter((r) => r.status === 'fail').length,
    skipped: rows.filter((r) => r.status === 'skipped').length,
    byProvider: {
      gemini: rows.filter((r) => r.provider === 'gemini').length,
      openai: rows.filter((r) => r.provider === 'openai').length,
      anthropic: rows.filter((r) => r.provider === 'anthropic').length,
    },
  };

  console.log(JSON.stringify({ summary, rows }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

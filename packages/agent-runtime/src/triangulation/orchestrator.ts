import { classifyQuery } from './queryRouter.js';
import { fanOut, type ProviderResponse } from './fanOut.js';
import { runJudge } from './judge.js';
import { calculateCost } from './costCalculator.js';
import { buildTriangulationContext } from './ragContext.js';
import { DEFAULT_TRIANGULATION_MODEL_SELECTION, TRIANGULATION_MODELS } from '@glyphor/shared';
import type { TriangulationResult, QueryTier } from '@glyphor/shared';
import type { TriangulationModelSelection } from '@glyphor/shared';
import type { ModelClient } from '../modelClient.js';
import type { EmbeddingClient } from '../jitContextRetriever.js';
import type { RedisCache } from '../redisCache.js';
import type { ReasoningLevel } from '../providers/types.js';

export async function triangulate(
  message: string,
  options: {
    systemPrompt: string;
    enableWebSearch?: boolean;
    enableDeepThinking?: boolean;
    enableInternalSearch?: boolean;
    attachments?: Array<{ name: string; mimeType: string; base64: string }>;
    maxOutputTokens?: number;
    triangulationModels?: Partial<TriangulationModelSelection>;
    reasoningLevel?: ReasoningLevel;
    history?: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>;
  },
  deps: {
    modelClient: ModelClient;
    embeddingClient: EmbeddingClient;
    redisCache?: RedisCache;
  },
): Promise<TriangulationResult> {
  const startedAt = Date.now();
  const modelSelection: TriangulationModelSelection = {
    ...DEFAULT_TRIANGULATION_MODEL_SELECTION,
    ...options.triangulationModels,
  };

  // 1. Classify the query to determine tier
  const tier = await classifyQuery(message, deps.modelClient, {
    forceDeep: options.enableDeepThinking,
    forceTriangulation: options.enableWebSearch,
  });

  // classifyQuery doesn't return token usage
  const routerUsage = null;

  // 2. Build RAG context if internal search is enabled
  let contextBlock = '';
  if (options.enableInternalSearch) {
    const ctx = await buildTriangulationContext(
      message, deps.embeddingClient, deps.modelClient, deps.redisCache,
    );
    contextBlock = ctx.contextBlock;
  }
  const fullSystemPrompt = contextBlock
    ? `${options.systemPrompt}\n\n${contextBlock}`
    : options.systemPrompt;

  // 3. SIMPLE tier — single model shortcut
  if (tier === 'SIMPLE') {
    const start = Date.now();
    const result = await deps.modelClient.generate({
      model: modelSelection.claude,
      systemInstruction: fullSystemPrompt,
      contents: [
        ...(options.history ?? []).map((h) => ({
          role: h.role === 'assistant' ? 'assistant' as const : 'user' as const,
          content: h.content,
          timestamp: h.timestamp,
        })),
        { role: 'user' as const, content: message, timestamp: Date.now() },
      ],
      maxTokens: options.maxOutputTokens ?? 8192,
      thinkingEnabled: options.reasoningLevel === 'deep',
      reasoningLevel: options.reasoningLevel,
    });
    return {
      tier: 'SIMPLE',
      selectedProvider: 'claude',
      models: modelSelection,
      selectedResponse: result.text ?? '',
      confidence: 75,
      consensusLevel: 'n/a',
      reasoning: 'Simple query — single model response',
      scores: {},
      divergences: [],
      allResponses: { claude: result.text ?? '' },
      cost: calculateCost(null, [{
        provider: 'claude', text: result.text ?? '', latencyMs: Date.now() - start,
        tokenUsage: { input: result.usageMetadata.inputTokens, output: result.usageMetadata.outputTokens, thinking: result.usageMetadata.thinkingTokens ?? 0 },
        status: 'success',
      }], null),
      latencyMs: { claude: Date.now() - start },
      durationMs: Date.now() - startedAt,
    };
  }

  // 4. Fan out to 3 models (STANDARD / DEEP)
  const responses = await fanOut(message, fullSystemPrompt, tier, deps.modelClient, {
    enableWebSearch: options.enableWebSearch,
    attachments: options.attachments,
    maxOutputTokens: options.maxOutputTokens,
    modelSelection,
    reasoningLevel: options.reasoningLevel,
    history: options.history,
  });

  // 5. Check if any responses succeeded
  const successful = responses.filter(r => r.status === 'success');
  const failed = responses.filter(r => r.status === 'error');
  for (const f of failed) {
    console.warn(`[triangulate] Provider "${f.provider}" failed: ${f.error}`);
  }
  if (successful.length === 0) {
    throw new Error('All providers failed during triangulation');
  }

  // 6. Run judge
  const judgeResult = await runJudge(message, responses, deps.modelClient, modelSelection);

  // 7. Build allResponses map
  const allResponses: Record<string, string> = {};
  for (const r of responses) {
    allResponses[r.provider] = r.status === 'success' ? r.text : `[ERROR: ${r.error}]`;
  }

  // 8. Build latencyMs map
  const latencyMs: Record<string, number> = {};
  for (const r of responses) { latencyMs[r.provider] = r.latencyMs; }

  // 9. Calculate cost
  const cost = calculateCost(null, responses, {
    input: judgeResult.judgeTokenUsage.input,
    output: judgeResult.judgeTokenUsage.output,
    thinking: 0,
  });

  // 10. Return TriangulationResult
  return {
    tier,
    selectedProvider: judgeResult.selected,
    models: modelSelection,
    selectedResponse: allResponses[judgeResult.selected] ?? successful[0].text,
    confidence: judgeResult.confidence,
    consensusLevel: judgeResult.consensusLevel,
    reasoning: judgeResult.reasoning,
    scores: judgeResult.scores,
    divergences: judgeResult.divergences,
    allResponses,
    cost,
    latencyMs,
    durationMs: Date.now() - startedAt,
  };
}

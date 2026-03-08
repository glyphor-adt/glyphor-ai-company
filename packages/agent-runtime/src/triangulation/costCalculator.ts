import { SUPPORTED_MODELS } from '@glyphor/shared/models';
import type { ProviderResponse } from './fanOut.js';
import { TRIANGULATION_MODELS } from '@glyphor/shared';

interface TokenUsage {
  input: number;
  output: number;
  thinking: number;
}

function getModelPricing(modelId: string): { inputPer1M: number; outputPer1M: number; thinkingPer1M?: number } {
  const model = SUPPORTED_MODELS.find(m => m.id === modelId);
  if (!model) return { inputPer1M: 1, outputPer1M: 5 }; // safe fallback
  return { inputPer1M: model.inputPer1M, outputPer1M: model.outputPer1M, thinkingPer1M: model.thinkingPer1M };
}

function calculateTokenCost(modelId: string, usage: TokenUsage): number {
  const pricing = getModelPricing(modelId);
  const thinkingRate = pricing.thinkingPer1M ?? pricing.outputPer1M;
  return (usage.input / 1_000_000) * pricing.inputPer1M
       + (usage.output / 1_000_000) * pricing.outputPer1M
       + (usage.thinking / 1_000_000) * thinkingRate;
}

export function calculateCost(
  routerUsage: TokenUsage | null,
  responses: ProviderResponse[],
  judgeUsage: TokenUsage | null,
): { perProvider: Record<string, number>; total: number } {
  const perProvider: Record<string, number> = {};

  // Router cost
  if (routerUsage) {
    perProvider.router = calculateTokenCost(TRIANGULATION_MODELS.router, routerUsage);
  }

  // Provider costs — map provider name to model ID
  const providerModelMap: Record<string, string> = {
    claude: TRIANGULATION_MODELS.primary,
    gemini: TRIANGULATION_MODELS.validator1,
    openai: TRIANGULATION_MODELS.validator2,
  };

  for (const resp of responses) {
    const modelId = providerModelMap[resp.provider] ?? TRIANGULATION_MODELS.primary;
    perProvider[resp.provider] = calculateTokenCost(modelId, resp.tokenUsage);
  }

  // Judge cost
  if (judgeUsage) {
    perProvider.judge = calculateTokenCost(TRIANGULATION_MODELS.judge, judgeUsage);
  }

  const total = Object.values(perProvider).reduce((sum, c) => sum + c, 0);
  return { perProvider, total };
}

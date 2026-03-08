import { JitContextRetriever } from '../jitContextRetriever.js';
import type { JitContext, EmbeddingClient } from '../jitContextRetriever.js';
import { ContextDistiller } from '../contextDistiller.js';
import type { ModelClient } from '../modelClient.js';
import type { RedisCache } from '../redisCache.js';

export async function buildTriangulationContext(
  query: string,
  embeddingClient: EmbeddingClient,
  modelClient: ModelClient,
  cache?: RedisCache,
): Promise<{ contextBlock: string; totalTokens: number }> {
  try {
    const retriever = new JitContextRetriever(embeddingClient, cache);
    const jitContext = await retriever.retrieve('ora', query, 4000);

    if (jitContext.tokenEstimate === 0) {
      return { contextBlock: '', totalTokens: 0 };
    }

    // If context is large, distill it
    if (jitContext.tokenEstimate > 4000) {
      const distiller = new ContextDistiller(modelClient, cache ?? null);
      const distilled = await distiller.distill('ora', query, query, jitContext);
      const block = formatContextBlock(distilled.briefing, distilled.keyFacts);
      return { contextBlock: block, totalTokens: distilled.tokenEstimate };
    }

    const block = formatRawContext(jitContext);
    return { contextBlock: block, totalTokens: jitContext.tokenEstimate };
  } catch (err) {
    console.warn(
      '[triangulation/ragContext] Retrieval failed, proceeding without context:',
      (err as Error).message,
    );
    return { contextBlock: '', totalTokens: 0 };
  }
}

function formatContextBlock(briefing: string, keyFacts: string[]): string {
  let block = '--- INTERNAL KNOWLEDGE ---\n';
  block += briefing + '\n';
  if (keyFacts.length > 0) {
    block += '\nKey Facts:\n';
    keyFacts.forEach((fact, i) => {
      block += `[${i + 1}] ${fact}\n`;
    });
  }
  block += '--- END ---';
  return block;
}

function formatRawContext(ctx: JitContext): string {
  const allItems = [
    ...ctx.relevantKnowledge,
    ...ctx.relevantMemories,
    ...ctx.relevantGraphNodes,
    ...ctx.relevantEpisodes,
    ...ctx.relevantProcedures,
  ].sort((a, b) => b.score - a.score);

  if (allItems.length === 0) return '';

  let block = '--- INTERNAL KNOWLEDGE ---\n';
  allItems.forEach((item, i) => {
    block += `[Source ${i + 1}: ${item.source}]\n${item.content}\n\n`;
  });
  block += '--- END ---';
  return block;
}

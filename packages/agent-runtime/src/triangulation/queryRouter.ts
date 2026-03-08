import { QueryTier, TRIANGULATION_MODELS } from '@glyphor/shared';
import { ModelClient } from '../modelClient.js';

const ROUTER_PROMPT = `You are a query complexity classifier.
SIMPLE — Greetings, single-fact lookups, clarifications.
STANDARD — Analysis, research, content generation, substantive questions.
DEEP — Multi-step reasoning, strategic analysis, financial modeling, critical decisions.
Respond with ONLY: SIMPLE, STANDARD, or DEEP.`;

export async function classifyQuery(
  message: string,
  modelClient: ModelClient,
  overrides?: { forceDeep?: boolean; forceTriangulation?: boolean }
): Promise<QueryTier> {
  if (overrides?.forceDeep) return 'DEEP';
  if (overrides?.forceTriangulation) return 'STANDARD';

  try {
    const result = await modelClient.generate({
      model: TRIANGULATION_MODELS.router,
      systemInstruction: ROUTER_PROMPT,
      contents: [{ role: 'user', content: message, timestamp: Date.now() }],
      maxTokens: 10,
    });

    const tier = (result.text ?? '').trim().toUpperCase();
    return ['SIMPLE', 'STANDARD', 'DEEP'].includes(tier) ? tier as QueryTier : 'STANDARD';
  } catch {
    return 'STANDARD'; // Default on failure
  }
}

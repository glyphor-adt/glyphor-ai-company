import { ModelClient } from '../modelClient.js';
import { TRIANGULATION_MODELS, TRIANGULATION_TIMEOUTS } from '@glyphor/shared';
import type { ProviderScores, Divergence } from '@glyphor/shared';
import type { ProviderResponse } from './fanOut.js';

// ─── Types ──────────────────────────────────────────────────────

export interface JudgeResult {
  selected: 'claude' | 'gemini' | 'openai';
  confidence: number;
  consensusLevel: 'high' | 'moderate' | 'low';
  reasoning: string;
  scores: Record<string, ProviderScores | null>;
  divergences: Divergence[];
  judgeTokenUsage: { input: number; output: number };
}

// ─── Constants ──────────────────────────────────────────────────

const LABEL_TO_PROVIDER: Record<string, ProviderResponse['provider']> = {
  A: 'claude',
  B: 'gemini',
  C: 'openai',
};

const PROVIDER_TO_LABEL: Record<ProviderResponse['provider'], string> = {
  claude: 'A',
  gemini: 'B',
  openai: 'C',
};

const JUDGE_SYSTEM_PROMPT = `You are a response quality evaluator. You receive a user query and three AI responses labeled A, B, C.

1. Score each response (0-100) on: accuracy, completeness, reasoning, relevance, actionability.
2. Identify divergences where responses disagree on specific claims.
3. Select the best response.
4. Assign confidence (0-100): all agree = 85-100, 2 of 3 agree = 60-84, all disagree = 30-59.

Respond in JSON only (no markdown fences):
{
  "selected": "A" | "B" | "C",
  "confidence": <0-100>,
  "consensus_level": "high" | "moderate" | "low",
  "reasoning": "<why>",
  "scores": {
    "A": { "accuracy": N, "completeness": N, "reasoning": N, "relevance": N, "actionability": N, "total": N },
    "B": { ... }, "C": { ... }
  },
  "divergences": [
    { "claim": "<claim>", "agree": ["A","B"], "disagree": ["C"], "likely_correct": "<assessment>" }
  ]
}`;

// ─── Helpers ────────────────────────────────────────────────────

function mapLabelToProvider(label: string): ProviderResponse['provider'] {
  return LABEL_TO_PROVIDER[label] ?? 'claude';
}

function mapLabelsToProviders(labels: string[]): string[] {
  return labels.map((l) => LABEL_TO_PROVIDER[l] ?? l);
}

function buildFallbackResult(
  response: ProviderResponse,
  confidence: number,
  consensusLevel: 'high' | 'moderate' | 'low',
): JudgeResult {
  return {
    selected: response.provider,
    confidence,
    consensusLevel,
    reasoning: 'Fallback: judge evaluation unavailable',
    scores: {
      [response.provider]: null,
    },
    divergences: [],
    judgeTokenUsage: { input: 0, output: 0 },
  };
}

// ─── Main ───────────────────────────────────────────────────────

export async function runJudge(
  query: string,
  responses: ProviderResponse[],
  modelClient: ModelClient,
): Promise<JudgeResult> {
  const successful = responses.filter((r) => r.status === 'success');

  if (successful.length === 0) {
    throw new Error('All provider responses failed; cannot run judge');
  }

  // Single success → return directly, no judge call needed
  if (successful.length === 1) {
    return buildFallbackResult(successful[0], 50, 'low');
  }

  // Build per-provider lookup
  const byProvider: Record<string, ProviderResponse> = {};
  for (const r of responses) {
    byProvider[r.provider] = r;
  }

  const textFor = (provider: ProviderResponse['provider']): string => {
    const r = byProvider[provider];
    return r && r.status === 'success' ? r.text : '[UNAVAILABLE]';
  };

  const userPrompt = `## User Query
${query}

## Response A (Claude Opus 4.6)
${textFor('claude')}

## Response B (Gemini 3.1 Pro)
${textFor('gemini')}

## Response C (GPT-5.4)
${textFor('openai')}

Evaluate now.`;

  // Call judge model
  let resultText: string;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const result = await modelClient.generate({
      model: TRIANGULATION_MODELS.judge,
      systemInstruction: JUDGE_SYSTEM_PROMPT,
      contents: [{ role: 'user', content: userPrompt, timestamp: Date.now() }],
      callTimeoutMs: TRIANGULATION_TIMEOUTS.judge,
    });

    resultText = result.text ?? '';
    inputTokens = result.usageMetadata.inputTokens;
    outputTokens = result.usageMetadata.outputTokens;
  } catch {
    // Judge call failed entirely → fallback to first successful
    return buildFallbackResult(successful[0], 55, 'moderate');
  }

  // Parse judge JSON
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    // JSON parse failed → fallback
    return buildFallbackResult(successful[0], 55, 'moderate');
  }

  // Map selected letter to provider
  const selectedLabel = parsed.selected as string;
  const selected = mapLabelToProvider(selectedLabel);

  // Map scores from letter keys to provider names
  const rawScores = (parsed.scores ?? {}) as Record<string, ProviderScores | null>;
  const scores: Record<string, ProviderScores | null> = {};
  for (const [label, value] of Object.entries(rawScores)) {
    const provider = LABEL_TO_PROVIDER[label];
    if (provider) {
      scores[provider] = value;
    }
  }

  // Map divergences
  const rawDivergences = (parsed.divergences ?? []) as Array<{
    claim: string;
    agree: string[];
    disagree: string[];
    likely_correct: string;
  }>;
  const divergences: Divergence[] = rawDivergences.map((d) => ({
    claim: d.claim,
    providersAgree: mapLabelsToProviders(d.agree ?? []),
    providerDisagrees: mapLabelsToProviders(d.disagree ?? []),
    likelyCorrect: d.likely_correct ?? '',
  }));

  return {
    selected,
    confidence: (parsed.confidence as number) ?? 70,
    consensusLevel: (parsed.consensus_level as JudgeResult['consensusLevel']) ?? 'moderate',
    reasoning: (parsed.reasoning as string) ?? '',
    scores,
    divergences,
    judgeTokenUsage: { input: inputTokens, output: outputTokens },
  };
}

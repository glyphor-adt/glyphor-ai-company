import { z } from 'zod';
import { ModelClient } from '../modelClient.js';
import {
  DEFAULT_TRIANGULATION_MODEL_SELECTION,
  TRIANGULATION_MODELS,
  TRIANGULATION_TIMEOUTS,
} from '@glyphor/shared';
import type {
  ProviderScores,
  Divergence,
  TriangulationModelSelection,
} from '@glyphor/shared';
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

type Provider = ProviderResponse['provider'];
type Label = 'A' | 'B' | 'C';

interface NormalizedJudgeScores {
  correctness: number;
  instruction_following: number;
  completeness: number;
  clarity: number;
  actionability: number;
  safety: number;
  total: number;
  critical_issues: string[];
  strengths: string[];
  weaknesses: string[];
}

// ─── Constants ──────────────────────────────────────────────────

const LABELS: Label[] = ['A', 'B', 'C'];
const PROVIDERS: Provider[] = ['claude', 'gemini', 'openai'];

const SCORE_WEIGHTS = {
  correctness: 0.4,
  instruction_following: 0.2,
  completeness: 0.15,
  clarity: 0.1,
  actionability: 0.1,
  safety: 0.05,
} as const;

const SCORE_KEYS = [
  'correctness',
  'instruction_following',
  'completeness',
  'clarity',
  'actionability',
  'safety',
] as const;

const JUDGE_SYSTEM_PROMPT = `You are an evaluator ranking three anonymous candidate answers to the same user query.

Your priorities, in order:
1. Correctness
2. Instruction following
3. Completeness
4. Clarity
5. Actionability
6. Safety

Rules:
- Do not prefer an answer just because it is longer, more polished, or more confident.
- Penalize unsupported claims, hallucinations, contradictions, and irrelevant detail.
- Penalize unnecessary refusal.
- Treat A, B, and C as fully anonymous. Do not infer identity from writing style.
- If a response is unavailable, empty, generic, malformed, or obviously failed, score it very poorly.
- Be conservative in confidence when the top two answers are close.

Return JSON only, with no markdown fences:
{
  "selected": "A" | "B" | "C",
  "confidence": <0-100>,
  "consensus_level": "high" | "moderate" | "low",
  "reasoning": "<brief explanation>",
  "scores": {
    "A": {
      "correctness": <0-100>,
      "instruction_following": <0-100>,
      "completeness": <0-100>,
      "clarity": <0-100>,
      "actionability": <0-100>,
      "safety": <0-100>,
      "critical_issues": ["..."],
      "strengths": ["..."],
      "weaknesses": ["..."]
    },
    "B": { ... },
    "C": { ... }
  },
  "divergences": [
    {
      "claim": "<specific disputed claim>",
      "agree": ["A"],
      "disagree": ["B","C"],
      "likely_correct": "<brief assessment>"
    }
  ]
}`;

// ─── Schemas ────────────────────────────────────────────────────

const ScoreSchema = z.object({
  correctness: z.number().min(0).max(100),
  instruction_following: z.number().min(0).max(100),
  completeness: z.number().min(0).max(100),
  clarity: z.number().min(0).max(100),
  actionability: z.number().min(0).max(100),
  safety: z.number().min(0).max(100),
  critical_issues: z.array(z.string()).default([]),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
});

const JudgeSchema = z.object({
  selected: z.enum(['A', 'B', 'C']),
  confidence: z.number().min(0).max(100),
  consensus_level: z.enum(['high', 'moderate', 'low']),
  reasoning: z.string(),
  scores: z.object({
    A: ScoreSchema,
    B: ScoreSchema,
    C: ScoreSchema,
  }),
  divergences: z.array(
    z.object({
      claim: z.string(),
      agree: z.array(z.enum(['A', 'B', 'C'])).default([]),
      disagree: z.array(z.enum(['A', 'B', 'C'])).default([]),
      likely_correct: z.string(),
    }),
  ).default([]),
});

// ─── Helpers ────────────────────────────────────────────────────

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function isUnavailableText(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    !t ||
    t === '[unavailable]' ||
    t.length < 24 ||
    t.includes('error occurred') ||
    t.includes('i cannot assist with that request') ||
    t.includes('i’m sorry, but i can’t') ||
    t.includes("i'm sorry, but i can't")
  );
}

function buildLabelMaps() {
  const shuffledProviders = shuffle(PROVIDERS);
  const labelToProvider: Record<Label, Provider> = {
    A: shuffledProviders[0],
    B: shuffledProviders[1],
    C: shuffledProviders[2],
  };

  const providerToLabel = Object.fromEntries(
    Object.entries(labelToProvider).map(([label, provider]) => [provider, label]),
  ) as Record<Provider, Label>;

  return { labelToProvider, providerToLabel };
}

function mapLabelsToProviders(
  labels: string[],
  labelToProvider: Record<Label, Provider>,
): Provider[] {
  return labels
    .filter((l): l is Label => l === 'A' || l === 'B' || l === 'C')
    .map((l) => labelToProvider[l]);
}

function computeWeightedTotal(score: Omit<NormalizedJudgeScores, 'total'>): number {
  const total =
    score.correctness * SCORE_WEIGHTS.correctness +
    score.instruction_following * SCORE_WEIGHTS.instruction_following +
    score.completeness * SCORE_WEIGHTS.completeness +
    score.clarity * SCORE_WEIGHTS.clarity +
    score.actionability * SCORE_WEIGHTS.actionability +
    score.safety * SCORE_WEIGHTS.safety;

  return Math.round(total);
}

function normalizeScore(score: z.infer<typeof ScoreSchema>): NormalizedJudgeScores {
  const base = {
    correctness: clamp(score.correctness, 0, 100),
    instruction_following: clamp(score.instruction_following, 0, 100),
    completeness: clamp(score.completeness, 0, 100),
    clarity: clamp(score.clarity, 0, 100),
    actionability: clamp(score.actionability, 0, 100),
    safety: clamp(score.safety, 0, 100),
    critical_issues: score.critical_issues ?? [],
    strengths: score.strengths ?? [],
    weaknesses: score.weaknesses ?? [],
  };

  return {
    ...base,
    total: computeWeightedTotal(base),
  };
}

function toProviderScores(score: NormalizedJudgeScores): ProviderScores {
  return {
    accuracy: score.correctness,
    completeness: score.completeness,
    reasoning: score.clarity,
    relevance: score.instruction_following,
    actionability: score.actionability,
    total: score.total,
  };
}

function buildFallbackResult(
  response: ProviderResponse,
  confidence: number,
  consensusLevel: 'high' | 'moderate' | 'low',
  reason: string,
): JudgeResult {
  return {
    selected: response.provider,
    confidence,
    consensusLevel,
    reasoning: reason,
    scores: {
      [response.provider]: null,
    },
    divergences: [],
    judgeTokenUsage: { input: 0, output: 0 },
  };
}

function chooseHeuristicWinner(successful: ProviderResponse[], query: string): ProviderResponse {
  const queryTerms = new Set(
    query
      .toLowerCase()
      .split(/\W+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 4),
  );

  const scored = successful.map((r) => {
    const text = r.text ?? '';
    const lower = text.toLowerCase();

    let score = 0;

    if (!isUnavailableText(text)) score += 30;

    score += Math.min(text.length / 40, 40);

    const keywordHits = [...queryTerms].filter((term) => lower.includes(term)).length;
    score += Math.min(keywordHits * 4, 20);

    if (/\b(step|first|second|third|example|here's|summary)\b/i.test(text)) score += 5;
    if (/\b(can't|cannot|unable|sorry)\b/i.test(text) && text.length < 150) score -= 15;

    return { response: r, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].response;
}

function deriveConsensusLevelFromGap(gap: number): JudgeResult['consensusLevel'] {
  if (gap >= 15) return 'high';
  if (gap >= 7) return 'moderate';
  return 'low';
}

function deriveConfidence(
  selectedScore: number,
  runnerUpScore: number,
  criticalIssueCount: number,
  divergenceCount: number,
  judgeConfidence?: number,
): number {
  const gap = selectedScore - runnerUpScore;
  let derived = 45 + gap * 2;

  if (selectedScore >= 85) derived += 8;
  if (criticalIssueCount > 0) derived -= 10;
  if (divergenceCount >= 2) derived -= 5;

  if (typeof judgeConfidence === 'number') {
    derived = Math.round(0.6 * derived + 0.4 * judgeConfidence);
  }

  return clamp(Math.round(derived), 20, 98);
}

// ─── Main ───────────────────────────────────────────────────────

export async function runJudge(
  query: string,
  responses: ProviderResponse[],
  modelClient: ModelClient,
  modelSelection: TriangulationModelSelection = DEFAULT_TRIANGULATION_MODEL_SELECTION,
): Promise<JudgeResult> {
  const successful = responses.filter((r) => r.status === 'success');

  if (successful.length === 0) {
    throw new Error('All provider responses failed; cannot run judge');
  }

  if (successful.length === 1) {
    return buildFallbackResult(
      successful[0],
      50,
      'low',
      'Only one provider response succeeded; returning sole available response.',
    );
  }

  const byProvider: Partial<Record<Provider, ProviderResponse>> = {};
  for (const r of responses) {
    byProvider[r.provider] = r;
  }

  const { labelToProvider, providerToLabel } = buildLabelMaps();

  const textForProvider = (provider: Provider): string => {
    const r = byProvider[provider];
    return r && r.status === 'success' ? r.text : '[UNAVAILABLE]';
  };

  const promptSections = LABELS.map((label) => {
    const provider = labelToProvider[label];
    return `## Response ${label}
${textForProvider(provider)}`;
  });

  const userPrompt = `## User Query
${query}

${promptSections.join('\n\n')}

Evaluate now.`;

  let resultText = '';
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
    const heuristic = chooseHeuristicWinner(successful, query);
    return buildFallbackResult(
      heuristic,
      52,
      'low',
      'Fallback: judge model call failed; selected using local heuristic ranking.',
    );
  }

  const parsedResult = JudgeSchema.safeParse(JSON.parseSafe?.(resultText) ?? safeJsonParse(resultText));
  if (!parsedResult.success) {
    const heuristic = chooseHeuristicWinner(successful, query);
    return buildFallbackResult(
      heuristic,
      54,
      'low',
      'Fallback: judge response was invalid JSON or failed schema validation; selected using local heuristic ranking.',
    );
  }

  const parsed = parsedResult.data;

  const normalizedByLabel: Record<Label, NormalizedJudgeScores> = {
    A: normalizeScore(parsed.scores.A),
    B: normalizeScore(parsed.scores.B),
    C: normalizeScore(parsed.scores.C),
  };

  const scoresByProvider: Record<string, ProviderScores | null> = {};
  for (const label of LABELS) {
    const provider = labelToProvider[label];
    const providerResponse = byProvider[provider];

    if (!providerResponse || providerResponse.status !== 'success' || isUnavailableText(providerResponse.text ?? '')) {
      scoresByProvider[provider] = {
        accuracy: 0,
        completeness: 0,
        reasoning: 0,
        relevance: 0,
        actionability: 0,
        total: 0,
      };
      continue;
    }

    scoresByProvider[provider] = toProviderScores(normalizedByLabel[label]);
  }

  const ranking = Object.entries(scoresByProvider)
    .filter((entry): entry is [Provider, ProviderScores] => entry[1] !== null)
    .sort((a, b) => (b[1]?.total ?? 0) - (a[1]?.total ?? 0));

  const topProvider = ranking[0]?.[0];
  const topScore = ranking[0]?.[1]?.total ?? 0;
  const runnerUpScore = ranking[1]?.[1]?.total ?? 0;
  const gap = topScore - runnerUpScore;

  const judgeSelectedProvider = labelToProvider[parsed.selected];
  const selected = topProvider ?? judgeSelectedProvider;

  const selectedLabel = providerToLabel[selected];
  const selectedScore = normalizedByLabel[selectedLabel];
  const criticalIssueCount = selectedScore.critical_issues.length;

  const divergences: Divergence[] = parsed.divergences.map((d) => ({
    claim: d.claim,
    providersAgree: mapLabelsToProviders(d.agree, labelToProvider),
    providerDisagrees: mapLabelsToProviders(d.disagree, labelToProvider),
    likelyCorrect: d.likely_correct,
  }));

  const confidence = deriveConfidence(
    topScore,
    runnerUpScore,
    criticalIssueCount,
    divergences.length,
    parsed.confidence,
  );

  const consensusLevel = deriveConsensusLevelFromGap(gap);

  const reasoningParts = [
    `Selected ${selected} based on weighted rubric scoring.`,
    `Top score: ${topScore}. Runner-up: ${runnerUpScore}. Gap: ${gap}.`,
    parsed.reasoning?.trim() ? `Judge rationale: ${parsed.reasoning.trim()}` : '',
    criticalIssueCount > 0
      ? `Selected answer has ${criticalIssueCount} flagged critical issue(s): ${selectedScore.critical_issues.join('; ')}`
      : '',
  ].filter(Boolean);

  return {
    selected,
    confidence,
    consensusLevel,
    reasoning: reasoningParts.join(' '),
    scores: scoresByProvider,
    divergences,
    judgeTokenUsage: { input: inputTokens, output: outputTokens },
  };
}

// ─── Safe JSON Parse ────────────────────────────────────────────

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}
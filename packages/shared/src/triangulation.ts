/**
 * Triangulated Chat — Shared types and constants
 *
 * Used by agent-runtime (engine) and dashboard (UI) packages.
 */

// ─── Query Tier ─────────────────────────────────────────────────

export type QueryTier = 'SIMPLE' | 'STANDARD' | 'DEEP';

// ─── Model Config ───────────────────────────────────────────────

export const TRIANGULATION_MODELS = {
  primary: 'claude-opus-4-6',
  validator1: 'gemini-3.1-pro-preview',
  validator2: 'gpt-5.4',
  judge: 'claude-sonnet-4-6',
  router: 'gemini-3-flash-preview',
} as const;

export interface TriangulationModelSelection {
  claude: string;
  gemini: string;
  openai: string;
}

export const DEFAULT_TRIANGULATION_MODEL_SELECTION: TriangulationModelSelection = {
  claude: TRIANGULATION_MODELS.primary,
  gemini: TRIANGULATION_MODELS.validator1,
  openai: TRIANGULATION_MODELS.validator2,
};

// ─── Timeouts ───────────────────────────────────────────────────

export const TRIANGULATION_TIMEOUTS = {
  standard: 300_000,
  deep: 300_000,
  judge: 300_000,
  router: 10_000,
} as const;

// ─── Scoring Types ──────────────────────────────────────────────

export interface ProviderScores {
  accuracy: number;
  completeness: number;
  reasoning: number;
  relevance: number;
  actionability: number;
  total: number;
}

export interface Divergence {
  claim: string;
  providersAgree: string[];
  providerDisagrees: string[];
  likelyCorrect: string;
}

// ─── Result ─────────────────────────────────────────────────────

export interface TriangulationResult {
  tier: QueryTier;
  selectedProvider: 'claude' | 'gemini' | 'openai';
  models: TriangulationModelSelection;
  selectedResponse: string;
  confidence: number;
  consensusLevel: 'high' | 'moderate' | 'low' | 'n/a';
  reasoning: string;
  scores: Record<string, ProviderScores | null>;
  divergences: Divergence[];
  allResponses: Record<string, string>;
  cost: { perProvider: Record<string, number>; total: number };
  latencyMs: Record<string, number>;
  durationMs: number;
}

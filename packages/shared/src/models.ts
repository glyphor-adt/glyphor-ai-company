/**
 * Glyphor AI Model Registry — Single Source of Truth
 *
 * All model references across the codebase MUST use this registry.
 * No hardcoded model strings elsewhere. This file defines:
 *
 *   1. SUPPORTED_MODELS — the canonical list of models we support
 *   2. MODEL_TIERS      — which models serve which purpose
 *   3. MODEL_PRICING     — cost per 1M tokens (input/output)
 *   4. FALLBACK_CHAINS   — what to try when a model fails
 *   5. DEPRECATED_MODELS — old model names → their replacement
 *   6. Helper functions  — resolveModel(), getFallback(), etc.
 *
 * When adding or removing a model, update ONLY this file.
 * Dashboard dropdowns, pricing, fallbacks, and defaults all derive from here.
 */

// ─── Provider type ───────────────────────────────────────────

export type ModelProvider = 'gemini' | 'openai' | 'anthropic';

// ─── Model tiers ─────────────────────────────────────────────

export type ModelTier =
  | 'flagship'    // highest quality, most expensive
  | 'standard'    // daily-driver, good quality/cost balance
  | 'economy'     // cheap, fast, for high-volume work
  | 'reasoning'   // o-series / thinking models
  | 'specialized'; // embedding, realtime, image — not for general chat

// ─── Model definition ───────────────────────────────────────

export interface ModelDef {
  id: string;
  label: string;
  provider: ModelProvider;
  tier: ModelTier;
  /** Cost per 1 million input tokens in USD */
  inputPer1M: number;
  /** Cost per 1 million output tokens in USD */
  outputPer1M: number;
  /** Cost per 1 million thinking/reasoning tokens in USD (defaults to outputPer1M if absent) */
  thinkingPer1M?: number;
  /** Discount multiplier for cached input tokens (e.g. 0.25 = 75% off). Defaults to 1.0 (no discount). */
  cachedInputDiscount?: number;
  /** If true, this model is available in agent assignment dropdowns */
  selectable: boolean;
  /** If true, this model can be used as a cross-model verifier */
  verifier: boolean;
}

// ─── The canonical model list ────────────────────────────────

export const SUPPORTED_MODELS: readonly ModelDef[] = [
  // ── Google Gemini ──────────────────────────────────────────
  // Gemini cached input = 10% of input price (90% off). Thinking tokens billed at output rate.
  // Prices are for prompts ≤200K tokens. >200K prompts cost 2× input and 1.5× output for Pro/Flash models.
  // Source: https://ai.google.dev/gemini-api/docs/pricing (verified 2026-02-26)
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro',         provider: 'gemini',    tier: 'flagship',  inputPer1M: 2.00,  outputPer1M: 12.0,  thinkingPer1M: 12.0,  cachedInputDiscount: 0.10, selectable: true,  verifier: false },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash',         provider: 'gemini',    tier: 'standard',  inputPer1M: 0.50,  outputPer1M: 3.00,  thinkingPer1M: 3.00,  cachedInputDiscount: 0.10, selectable: true,  verifier: true  },
  { id: 'gemini-3-pro-preview',   label: 'Gemini 3 Pro',           provider: 'gemini',    tier: 'flagship',  inputPer1M: 2.00,  outputPer1M: 12.0,  thinkingPer1M: 12.0,  cachedInputDiscount: 0.10, selectable: true,  verifier: true  },
  { id: 'gemini-2.5-flash',       label: 'Gemini 2.5 Flash',       provider: 'gemini',    tier: 'economy',   inputPer1M: 0.30,  outputPer1M: 2.50,  thinkingPer1M: 2.50,  cachedInputDiscount: 0.10, selectable: true,  verifier: true  },
  { id: 'gemini-2.5-flash-lite',  label: 'Gemini 2.5 Flash Lite',  provider: 'gemini',    tier: 'economy',   inputPer1M: 0.10,  outputPer1M: 0.40,  cachedInputDiscount: 0.10, selectable: true,  verifier: false },
  { id: 'gemini-2.5-pro',         label: 'Gemini 2.5 Pro',         provider: 'gemini',    tier: 'flagship',  inputPer1M: 1.25,  outputPer1M: 10.0,  thinkingPer1M: 10.0,  cachedInputDiscount: 0.10, selectable: true,  verifier: false },

  // ── OpenAI ─────────────────────────────────────────────────
  // GPT-5.x cached input = 10% of input price. GPT-4.1/o-series cached = 25% of input price.
  // Reasoning tokens (o-series) billed at output rate.
  // Source: https://developers.openai.com/api/docs/pricing (verified 2026-02-26)
  { id: 'gpt-5.2',                label: 'GPT-5.2',                provider: 'openai',    tier: 'flagship',  inputPer1M: 1.75,  outputPer1M: 14.0,  cachedInputDiscount: 0.10, selectable: true,  verifier: false },
  { id: 'gpt-5.2-pro',            label: 'GPT-5.2 Pro',            provider: 'openai',    tier: 'flagship',  inputPer1M: 21.0,  outputPer1M: 168.0, selectable: true,  verifier: false },
  { id: 'gpt-5.1',                label: 'GPT-5.1',                provider: 'openai',    tier: 'standard',  inputPer1M: 1.25,  outputPer1M: 10.0,  cachedInputDiscount: 0.10, selectable: true,  verifier: false },
  { id: 'gpt-5',                  label: 'GPT-5',                  provider: 'openai',    tier: 'standard',  inputPer1M: 1.25,  outputPer1M: 10.0,  cachedInputDiscount: 0.10, selectable: true,  verifier: false },
  { id: 'gpt-5-mini',             label: 'GPT-5 Mini',             provider: 'openai',    tier: 'economy',   inputPer1M: 0.25,  outputPer1M: 2.00,  cachedInputDiscount: 0.10, selectable: true,  verifier: true  },
  { id: 'gpt-5-mini-2025-08-07',   label: 'GPT-5 Mini (Aug 2025)',  provider: 'openai',    tier: 'economy',   inputPer1M: 0.25,  outputPer1M: 2.00,  cachedInputDiscount: 0.10, selectable: true,  verifier: true  },
  { id: 'gpt-5-nano',             label: 'GPT-5 Nano',             provider: 'openai',    tier: 'economy',   inputPer1M: 0.05,  outputPer1M: 0.40,  cachedInputDiscount: 0.10, selectable: true,  verifier: false },
  { id: 'gpt-4.1',                label: 'GPT-4.1',                provider: 'openai',    tier: 'economy',   inputPer1M: 2.00,  outputPer1M: 8.00,  cachedInputDiscount: 0.25, selectable: true,  verifier: false },
  { id: 'gpt-4.1-mini',           label: 'GPT-4.1 Mini',           provider: 'openai',    tier: 'economy',   inputPer1M: 0.40,  outputPer1M: 1.60,  cachedInputDiscount: 0.25, selectable: true,  verifier: false },
  { id: 'o3',                     label: 'o3',                     provider: 'openai',    tier: 'reasoning', inputPer1M: 2.00,  outputPer1M: 8.00,  thinkingPer1M: 8.00, cachedInputDiscount: 0.25, selectable: true,  verifier: false },
  { id: 'o4-mini',                label: 'o4-mini',                provider: 'openai',    tier: 'reasoning', inputPer1M: 1.10,  outputPer1M: 4.40,  thinkingPer1M: 4.40, cachedInputDiscount: 0.25, selectable: true,  verifier: false },

  // ── Anthropic ──────────────────────────────────────────────
  // Anthropic cache read = 10% of input price. Cache creation = 125% of input price (amortized, treated as full price).
  // Source: https://platform.claude.com/docs/en/docs/about-claude/pricing (verified 2026-02-26)
  { id: 'claude-opus-4-6',        label: 'Claude Opus 4.6',        provider: 'anthropic', tier: 'flagship',  inputPer1M: 5.00,  outputPer1M: 25.0,  cachedInputDiscount: 0.10, selectable: true,  verifier: true  },
  { id: 'claude-sonnet-4-6',      label: 'Claude Sonnet 4.6',      provider: 'anthropic', tier: 'standard',  inputPer1M: 3.00,  outputPer1M: 15.0,  cachedInputDiscount: 0.10, selectable: true,  verifier: true  },
  { id: 'claude-sonnet-4-5',      label: 'Claude Sonnet 4.5',      provider: 'anthropic', tier: 'standard',  inputPer1M: 3.00,  outputPer1M: 15.0,  cachedInputDiscount: 0.10, selectable: true,  verifier: false },
  { id: 'claude-haiku-4-5',       label: 'Claude Haiku 4.5',       provider: 'anthropic', tier: 'economy',   inputPer1M: 1.00,  outputPer1M: 5.00,  cachedInputDiscount: 0.10, selectable: true,  verifier: false },

  // ── Specialized (not selectable for general agent assignment) ─
  { id: 'gemini-embedding-001',       label: 'Gemini Embedding',       provider: 'gemini',    tier: 'specialized', inputPer1M: 0.15, outputPer1M: 0,    selectable: false, verifier: false },
  { id: 'gpt-realtime-2025-08-28',    label: 'GPT Realtime',            provider: 'openai',    tier: 'specialized', inputPer1M: 5.00, outputPer1M: 20.0, selectable: false, verifier: false },
  { id: 'gpt-image-1.5-2025-12-16',    label: 'GPT Image 1.5',          provider: 'openai',    tier: 'specialized', inputPer1M: 0,    outputPer1M: 0,    selectable: false, verifier: false },

] as const;

// ─── Deprecated model mapping ────────────────────────────────
// Old model IDs that may still exist in the database → their replacement.
// Used by resolveModel() to auto-upgrade agents stuck on old models.

export const DEPRECATED_MODELS: Record<string, string> = {
  // Gemini 2.x and older
  'gemini-2.0-flash-001':       'gemini-2.5-flash',
  'gemini-2.0-flash':           'gemini-2.5-flash',
  'gemini-2.0-flash-exp':       'gemini-2.5-flash',
  'gemini-2.0-pro':             'gemini-2.5-pro',
  'gemini-1.5-flash':           'gemini-2.5-flash',
  'gemini-1.5-pro':             'gemini-2.5-pro',
  'gemini-3.0-flash-preview':   'gemini-3-flash-preview',  // version typo in seed-memory.sh

  // OpenAI legacy
  'gpt-4o':                     'gpt-5-mini',
  'gpt-4o-mini':                'gpt-5-nano',
  'gpt-4-turbo':                'gpt-4.1',
  'gpt-4':                      'gpt-4.1',
  'gpt-3.5-turbo':              'gpt-4.1-mini',
  'gpt-4.1-nano':               'gpt-4.1-mini',

  // Anthropic legacy
  'claude-sonnet-4-20250514':   'claude-sonnet-4-6',
  'claude-3-5-sonnet-20241022': 'claude-sonnet-4-6',
  'claude-3-5-sonnet-latest':   'claude-sonnet-4-6',
  'claude-3-5-haiku-20241022':  'claude-haiku-4-5',
  'claude-3-5-haiku-latest':    'claude-haiku-4-5',
  'claude-3-opus-20240229':     'claude-opus-4-6',
  'claude-3-haiku-20240307':    'claude-haiku-4-5',
  'claude-opus-4-20250514':     'claude-opus-4-6',
};

// ─── Default models by purpose ───────────────────────────────

/** The default model assigned to new agents */
export const DEFAULT_AGENT_MODEL = 'gpt-5-mini-2025-08-07';

/** The model used for web search (needs OpenAI Responses API) */
export const WEB_SEARCH_MODEL = 'gpt-5-mini-2025-08-07';

/** The model used for realtime voice */
export const REALTIME_MODEL = 'gpt-realtime-2025-08-28';

/** The model used for realtime input audio transcription */
export const TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';

/** The model used for text embeddings */
export const EMBEDDING_MODEL = 'gemini-embedding-001';

/** The model used for image generation */
export const IMAGE_MODEL = 'gpt-image-1.5-2025-12-16';

/** The model used for GraphRAG extraction */
export const GRAPHRAG_MODEL = 'gemini-2.5-flash';

// ─── Fallback chains ────────────────────────────────────────
// When a model fails with a non-retryable error (e.g., rate limit, outage),
// try the next model in the chain. Each chain crosses providers.

export const FALLBACK_CHAINS: Record<string, readonly string[]> = {
  // Gemini primary → try another Gemini tier first, then cheapest cross-provider
  'gemini-3.1-pro-preview': ['gemini-3-pro-preview', 'gpt-5-mini'],
  'gemini-3-flash-preview': ['gemini-2.5-flash', 'gpt-5-mini'],
  'gemini-3-pro-preview':   ['gemini-3-flash-preview', 'gpt-5-mini'],
  'gemini-2.5-flash':       ['gemini-3-flash-preview', 'gpt-5-mini'],
  'gemini-2.5-flash-lite':  ['gemini-2.5-flash', 'gpt-5-nano'],
  'gemini-2.5-pro':         ['gemini-3-pro-preview', 'gpt-5-mini'],

  // OpenAI primary → try Gemini first (GCP-resident, cheapest), then economy cross-provider
  'gpt-5.2':                ['gemini-3-flash-preview', 'claude-haiku-4-5'],
  'gpt-5.2-pro':            ['gemini-3-flash-preview', 'claude-haiku-4-5'],
  'gpt-5.1':                ['gemini-2.5-flash', 'claude-haiku-4-5'],
  'gpt-5':                  ['gemini-2.5-flash', 'claude-haiku-4-5'],
  'gpt-5-mini':             ['gemini-2.5-flash', 'claude-haiku-4-5'],
  'gpt-5-mini-2025-08-07':  ['gemini-2.5-flash', 'claude-haiku-4-5'],
  'gpt-5-nano':             ['gemini-2.5-flash-lite', 'claude-haiku-4-5'],
  'gpt-4.1':                ['gemini-2.5-flash', 'claude-haiku-4-5'],
  'gpt-4.1-mini':           ['gemini-2.5-flash-lite', 'claude-haiku-4-5'],
  'o3':                     ['gemini-3-flash-preview', 'claude-haiku-4-5'],
  'o4-mini':                ['gemini-2.5-flash', 'claude-haiku-4-5'],

  // Anthropic primary → try Gemini first (GCP-resident), then cheapest OpenAI
  'claude-opus-4-6':        ['gemini-3-flash-preview', 'gpt-5-mini'],
  'claude-sonnet-4-6':      ['gemini-2.5-flash', 'gpt-5-mini'],
  'claude-sonnet-4-5':      ['gemini-2.5-flash', 'gpt-5-mini'],
  'claude-haiku-4-5':       ['gemini-2.5-flash', 'gpt-5-nano'],
};

// ─── Cross-model verifier mapping ────────────────────────────
// Maps a primary model to its cross-provider verifier.
// Always uses a DIFFERENT provider to prevent correlated errors.

export const VERIFIER_MAP: Record<string, string> = {
  // Gemini primary → cheapest cross-provider verifier
  'gemini-3.1-pro-preview': 'gpt-5-mini',
  'gemini-3-flash-preview': 'gpt-5-mini',
  'gemini-3-pro-preview':   'gpt-5-mini',
  'gemini-2.5-flash':       'gpt-5-mini',
  'gemini-2.5-flash-lite':  'gpt-5-nano',
  'gemini-2.5-pro':         'gpt-5-mini',

  // OpenAI primary → Gemini verifier (GCP-native, cheap)
  'gpt-5.2':                'gemini-2.5-flash',
  'gpt-5.2-pro':            'gemini-3-flash-preview',
  'gpt-5.1':                'gemini-2.5-flash',
  'gpt-5':                  'gemini-2.5-flash',
  'gpt-5-mini':             'gemini-2.5-flash',
  'gpt-5-mini-2025-08-07':  'gemini-2.5-flash',
  'gpt-5-nano':             'gemini-2.5-flash-lite',
  'gpt-4.1':                'gemini-2.5-flash',
  'gpt-4.1-mini':           'gemini-2.5-flash-lite',
  'o3':                     'gemini-2.5-flash',
  'o4-mini':                'gemini-2.5-flash',

  // Claude primary → Gemini verifier (GCP-native, cheap)
  'claude-opus-4-6':        'gemini-2.5-flash',
  'claude-sonnet-4-6':      'gemini-2.5-flash',
  'claude-sonnet-4-5':      'gemini-2.5-flash',
  'claude-haiku-4-5':       'gemini-2.5-flash-lite',
};

// ─── Deep dive research models ──────────────────────────────
// GCP-first strategy: majority of research areas use Gemini (lower cost on our
// infra), with select areas using OpenAI/Anthropic for perspective diversity.

export const DEEP_DIVE_MODELS: Record<string, string> = {
  overview:             'gemini-2.5-flash',
  financials:           'gemini-2.5-flash',
  technology:           'gemini-2.5-flash',
  market:               'gemini-2.5-flash',
  competitive:          'gemini-2.5-flash',
  leadership:           'gemini-2.5-flash',
  customers:            'gemini-2.5-flash',
  risks:                'gemini-2.5-flash',
  company_profile:      'gemini-2.5-flash',
  strategic_direction:  'gemini-2.5-flash',
  segment_analysis:     'gemini-2.5-flash',
  ma_activity:          'gemini-2.5-flash',
  ai_impact:            'gemini-2.5-flash',
  talent_assessment:    'gemini-2.5-flash',
  regulatory_landscape: 'gemini-2.5-flash',
};

/** The two models used for cross-model deep dive verification (Gemini-first, cost-optimised) */
export const DEEP_DIVE_VERIFICATION_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash'] as const;

/** The two models used for reasoning engine verification (Gemini-first, cost-optimised) */
export const REASONING_VERIFICATION_MODELS = ['gemini-2.5-flash', 'gpt-5-mini'] as const;

// ─── Helper functions ────────────────────────────────────────

/** Look up a model definition by ID. Returns undefined if not found. */
export function getModel(id: string): ModelDef | undefined {
  return SUPPORTED_MODELS.find(m => m.id === id);
}

/** Get all models selectable in UI dropdowns, grouped by provider. */
export function getSelectableModels(): ModelDef[] {
  return SUPPORTED_MODELS.filter(m => m.selectable);
}

/** Get selectable models grouped by provider for dropdown rendering. */
export function getSelectableModelsByProvider(): Record<ModelProvider, ModelDef[]> {
  const models = getSelectableModels();
  return {
    gemini:    models.filter(m => m.provider === 'gemini'),
    openai:    models.filter(m => m.provider === 'openai'),
    anthropic: models.filter(m => m.provider === 'anthropic'),
  };
}

/** Get models that can serve as cross-model verifiers. */
export function getVerifierModels(): ModelDef[] {
  return SUPPORTED_MODELS.filter(m => m.verifier);
}

/**
 * Resolve a model ID — if it's deprecated, return the replacement.
 * If it's current, return as-is. If completely unknown, return the default.
 */
export function resolveModel(modelId: string): string {
  // Check deprecated mapping first
  if (DEPRECATED_MODELS[modelId]) {
    return DEPRECATED_MODELS[modelId];
  }
  // Check if it's a known current model
  if (SUPPORTED_MODELS.some(m => m.id === modelId)) {
    return modelId;
  }
  // Unknown model — return default
  console.warn(`[ModelRegistry] Unknown model "${modelId}", falling back to ${DEFAULT_AGENT_MODEL}`);
  return DEFAULT_AGENT_MODEL;
}

/**
 * Detect provider from model ID prefix.
 */
export function detectProvider(model: string): ModelProvider {
  if (model.startsWith('gemini-')) return 'gemini';
  if (model.startsWith('gpt-') || /^o[134](-|$)/.test(model)) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  throw new Error(`Unknown model provider for "${model}"`);
}

/**
 * Get the fallback chain for a model. Returns empty array if no fallbacks defined.
 */
export function getFallbackChain(model: string): readonly string[] {
  return FALLBACK_CHAINS[model] ?? [];
}

/**
 * Get the cross-provider verifier model for a given primary model.
 */
export function getVerifierFor(primaryModel: string): string {
  // Direct mapping
  if (VERIFIER_MAP[primaryModel]) return VERIFIER_MAP[primaryModel];

  // Prefix-based fallback — always cross-provider, cheapest viable
  if (primaryModel.startsWith('gemini-')) return 'gpt-5-mini';
  if (primaryModel.startsWith('gpt-') || /^o[134](-|$)/.test(primaryModel)) return 'gemini-2.5-flash';
  if (primaryModel.startsWith('claude-')) return 'gemini-2.5-flash';

  return 'gemini-2.5-flash';
}

/**
 * Estimate the cost of a model call with full token breakdown.
 *
 * - thinkingTokens: billed at thinkingPer1M (or outputPer1M if unset). NOT included in outputTokens.
 * - cachedInputTokens: billed at inputPer1M × cachedInputDiscount (or full price if unset). Already included in inputTokens.
 */
export function estimateModelCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  thinkingTokens = 0,
  cachedInputTokens = 0,
): number {
  const def = getModel(model);
  const pricing = def
    ?? SUPPORTED_MODELS.find(m => model.startsWith(m.id.split('-').slice(0, 2).join('-')))
    ?? { inputPer1M: 0.10, outputPer1M: 0.40, thinkingPer1M: undefined, cachedInputDiscount: undefined };

  const thinkingRate = pricing.thinkingPer1M ?? pricing.outputPer1M;
  const cacheDiscount = pricing.cachedInputDiscount ?? 1.0;

  // Cached tokens are already counted in inputTokens — adjust by giving back the discount portion
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const inputCost = (uncachedInputTokens * pricing.inputPer1M + cachedInputTokens * pricing.inputPer1M * cacheDiscount) / 1_000_000;
  const outputCost = (outputTokens * pricing.outputPer1M) / 1_000_000;
  const thinkingCost = (thinkingTokens * thinkingRate) / 1_000_000;

  return inputCost + outputCost + thinkingCost;
}

/**
 * Check if a model ID is deprecated.
 */
export function isDeprecated(modelId: string): boolean {
  return modelId in DEPRECATED_MODELS;
}

/**
 * Get the provider label for display.
 */
export function getProviderLabel(provider: ModelProvider): string {
  switch (provider) {
    case 'gemini': return 'Google Gemini';
    case 'openai': return 'OpenAI';
    case 'anthropic': return 'Anthropic';
  }
}

// ─── Cost Optimizer ─────────────────────────────────────────
//
// Maps agent roles to model tiers based on task complexity.
// Goal: stop using expensive models for routine tasks.
//
// Tiers:
//   economy  → gemini-2.5-flash-lite ($0.10/$0.40)  — structured, repetitive tasks
//   standard → gemini-2.5-flash      ($0.30/$2.50)  — analysis, creative, department mgmt
//   pro      → gemini-3-flash-preview ($0.50/$3.00)  — orchestration, strategic, founder-chat
//
// GCP-native Gemini models preferred to minimise egress costs.

export type CostTier = 'economy' | 'standard' | 'pro';

/** Preferred model for each cost tier (GCP-first). */
export const TIER_MODELS: Record<CostTier, string> = {
  economy:  'gemini-2.5-flash-lite',   // $0.10 / $0.40
  standard: 'gemini-2.5-flash',        // $0.30 / $2.50
  pro:      'gemini-3-flash-preview',   // $0.50 / $3.00
};

/** Model used for on_demand chat with founder-facing executives. */
export const EXEC_CHAT_MODEL = 'gemini-3-flash-preview'; // was gemini-3-pro-preview ($2/$12)

/** Role → tier mapping. Unlisted roles default to 'standard'. */
export const ROLE_COST_TIER: Record<string, CostTier> = {
  // ── Economy: routine, structured, low-complexity ────────────
  'support-triage':        'economy',
  'onboarding-specialist': 'economy',
  'm365-admin':            'economy',
  'global-admin':          'economy',
  'data-integrity-auditor':'economy',
  'seo-analyst':           'economy',
  'social-media-manager':  'economy',
  'cost-analyst':          'economy',
  'revenue-analyst':       'economy',
  'account-research':      'economy',
  'adi-rose':              'economy',

  // ── Standard: analysis, creative, department-level ──────────
  'content-creator':       'standard',
  'design-critic':         'standard',
  'ui-ux-designer':        'standard',
  'frontend-engineer':     'standard',
  'template-architect':    'standard',
  'user-researcher':       'standard',
  'competitive-intel':     'standard',
  'devops-engineer':       'standard',
  'platform-engineer':     'standard',
  'quality-engineer':      'standard',
  'head-of-hr':            'standard',
  'vp-customer-success':   'standard',
  'vp-sales':              'standard',
  'vp-design':             'standard',
  'bob-the-tax-pro':       'standard',
  'tax-strategy-specialist':'standard',
  'lead-gen-specialist':   'standard',
  'enterprise-account-researcher': 'standard',
  'marketing-intelligence-analyst': 'standard',
  'competitive-research-analyst':   'standard',
  'market-research-analyst':        'standard',
  'technical-research-analyst':     'standard',
  'industry-research-analyst':      'standard',
  'ai-impact-analyst':     'standard',
  'org-analyst':           'standard',

  // ── Pro: orchestrators, C-suite, strategic planning ─────────
  'chief-of-staff':        'pro',
  'cto':                   'pro',
  'cfo':                   'pro',
  'cpo':                   'pro',
  'cmo':                   'pro',
  'clo':                   'pro',
  'vp-research':           'pro',
  'ops':                   'pro',
};

/**
 * Pick the optimal model for a given role and task.
 *
 * Priority:
 *   1. If the DB has an explicitly-set model, respect it (user override).
 *   2. Otherwise, use the cost tier for the role.
 *   3. For on_demand chat with pro-tier roles, use EXEC_CHAT_MODEL.
 *
 * Returns the model ID string to use.
 */
export function optimizeModel(
  role: string,
  task: string,
  dbModel?: string | null,
): string {
  // Explicit DB assignment always wins (resolve deprecated names)
  if (dbModel) return resolveModel(dbModel);

  const tier = ROLE_COST_TIER[role] ?? 'standard';

  // Pro-tier roles get the exec chat model for on_demand (founder-facing conversations)
  if (task === 'on_demand' && tier === 'pro') {
    return EXEC_CHAT_MODEL;
  }

  return TIER_MODELS[tier];
}

/**
 * Estimate cost per 1K output tokens for quick comparison. Useful for budget guards.
 */
export function costPer1KOutput(modelId: string): number {
  const def = getModel(modelId);
  return def ? (def.outputPer1M / 1000) : 0.003;
}

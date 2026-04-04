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
export type ReasoningLevel = 'none' | 'standard' | 'deep';

export interface ReasoningSupport {
  levels: ReasoningLevel[];
  defaultLevel: ReasoningLevel;
}

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
  /** Maximum input context window in tokens. Null/undefined = use provider default. */
  contextWindowTokens?: number;
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
  // Rates calibrated against actual GCP billing (Mar 25 2026): 126 runs, $76.39 actual vs $14.97 prior estimate → 5x correction.
  // RETIRED (Mar 26 2026): gemini-3.1-pro-preview, gemini-3-flash-preview, gemini-2.5-flash — cost prohibitive. Kept for pricing lookups only.
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (retired)',  provider: 'gemini',    tier: 'flagship',  inputPer1M: 10.00, outputPer1M: 60.0,  thinkingPer1M: 60.0,  cachedInputDiscount: 0.10, contextWindowTokens: 2_000_000, selectable: false, verifier: false },
  { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite', provider: 'gemini', tier: 'economy', inputPer1M: 1.25, outputPer1M: 7.50, thinkingPer1M: 7.50, cachedInputDiscount: 0.10, contextWindowTokens: 1_000_000, selectable: true, verifier: true  },
  { id: 'gemini-3-flash-preview',  label: 'Gemini 3 Flash (retired)', provider: 'gemini',    tier: 'standard',  inputPer1M: 2.50,  outputPer1M: 15.00, thinkingPer1M: 15.00, cachedInputDiscount: 0.10, contextWindowTokens: 1_000_000, selectable: false, verifier: false },
  { id: 'gemini-2.5-flash',        label: 'Gemini 2.5 Flash (retired)', provider: 'gemini', tier: 'standard',  inputPer1M: 1.50,  outputPer1M: 12.50, thinkingPer1M: 12.50, cachedInputDiscount: 0.10, contextWindowTokens: 1_000_000, selectable: false, verifier: false },
  { id: 'gemini-2.5-flash-lite',   label: 'Gemini 2.5 Flash Lite', provider: 'gemini',    tier: 'economy',   inputPer1M: 0.50,  outputPer1M: 2.00,  cachedInputDiscount: 0.10, contextWindowTokens: 1_000_000, selectable: true,  verifier: false },

  // ── OpenAI ─────────────────────────────────────────────────
  // GPT-5.x cached input = 10% of input price. o-series cached = 25% of input price.
  // Reasoning tokens (o-series) billed at output rate.
  // Source: https://developers.openai.com/api/docs/pricing (verified 2026-02-26)
  // Azure Foundry catalog: https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure
  { id: 'gpt-5.4',                label: 'GPT-5.4',                provider: 'openai',    tier: 'flagship',  inputPer1M: 2.50,  outputPer1M: 15.0,  cachedInputDiscount: 0.10, contextWindowTokens: 256_000, selectable: true,  verifier: true  },
  { id: 'gpt-5.4-pro',            label: 'GPT-5.4 Pro',            provider: 'openai',    tier: 'flagship',  inputPer1M: 30.0,  outputPer1M: 180.0, contextWindowTokens: 256_000, selectable: true,  verifier: false },
  { id: 'gpt-5.3-codex',          label: 'GPT-5.3 Codex',          provider: 'openai',    tier: 'specialized', inputPer1M: 1.75, outputPer1M: 14.0, cachedInputDiscount: 0.10, contextWindowTokens: 256_000, selectable: true,  verifier: false },
  { id: 'gpt-5.2',                label: 'GPT-5.2',                provider: 'openai',    tier: 'flagship',  inputPer1M: 1.75,  outputPer1M: 14.0,  cachedInputDiscount: 0.10, contextWindowTokens: 256_000, selectable: true,  verifier: false },
  { id: 'gpt-5.2-pro',            label: 'GPT-5.2 Pro',            provider: 'openai',    tier: 'flagship',  inputPer1M: 21.0,  outputPer1M: 168.0, contextWindowTokens: 256_000, selectable: true,  verifier: false },
  { id: 'gpt-5.2-codex',          label: 'GPT-5.2 Codex',          provider: 'openai',    tier: 'specialized', inputPer1M: 1.75, outputPer1M: 14.0, cachedInputDiscount: 0.10, contextWindowTokens: 256_000, selectable: true,  verifier: false },
  { id: 'gpt-5.1',                label: 'GPT-5.1',                provider: 'openai',    tier: 'standard',  inputPer1M: 1.25,  outputPer1M: 10.0,  cachedInputDiscount: 0.10, contextWindowTokens: 256_000, selectable: true,  verifier: false },
  { id: 'gpt-5.1-codex',          label: 'GPT-5.1 Codex',          provider: 'openai',    tier: 'specialized', inputPer1M: 1.25, outputPer1M: 10.0, cachedInputDiscount: 0.10, contextWindowTokens: 256_000, selectable: true,  verifier: false },
  { id: 'gpt-5.1-codex-mini',     label: 'GPT-5.1 Codex Mini',     provider: 'openai',    tier: 'specialized', inputPer1M: 0.75, outputPer1M: 6.00, cachedInputDiscount: 0.10, contextWindowTokens: 256_000, selectable: true,  verifier: false },
  { id: 'gpt-5.1-codex-max',      label: 'GPT-5.1 Codex Max',      provider: 'openai',    tier: 'specialized', inputPer1M: 2.50, outputPer1M: 15.0, cachedInputDiscount: 0.10, contextWindowTokens: 256_000, selectable: true,  verifier: false },
  { id: 'gpt-5',                  label: 'GPT-5',                  provider: 'openai',    tier: 'standard',  inputPer1M: 1.25,  outputPer1M: 10.0,  cachedInputDiscount: 0.10, contextWindowTokens: 128_000, selectable: true,  verifier: false },
  { id: 'gpt-5-pro',              label: 'GPT-5 Pro',              provider: 'openai',    tier: 'flagship',  inputPer1M: 15.0,  outputPer1M: 120.0, cachedInputDiscount: 0.10, contextWindowTokens: 128_000, selectable: true,  verifier: false },
  { id: 'gpt-5-codex',            label: 'GPT-5 Codex',            provider: 'openai',    tier: 'specialized', inputPer1M: 1.25, outputPer1M: 10.0, cachedInputDiscount: 0.10, contextWindowTokens: 256_000, selectable: true,  verifier: false },
  { id: 'gpt-5-mini',             label: 'GPT-5 Mini',             provider: 'openai',    tier: 'economy',   inputPer1M: 0.25,  outputPer1M: 2.00,  cachedInputDiscount: 0.10, contextWindowTokens: 128_000, selectable: true,  verifier: true  },
  { id: 'gpt-5-mini-2025-08-07',   label: 'GPT-5 Mini (Aug 2025)',  provider: 'openai',    tier: 'economy',   inputPer1M: 0.25,  outputPer1M: 2.00,  cachedInputDiscount: 0.10, contextWindowTokens: 128_000, selectable: true,  verifier: true  },
  { id: 'gpt-5-nano',             label: 'GPT-5 Nano',             provider: 'openai',    tier: 'economy',   inputPer1M: 0.05,  outputPer1M: 0.40,  cachedInputDiscount: 0.10, contextWindowTokens: 128_000, selectable: true,  verifier: false },
  { id: 'gpt-5.4-mini',            label: 'GPT-5.4 Mini',           provider: 'openai',    tier: 'economy',   inputPer1M: 0.75,  outputPer1M: 4.50,  cachedInputDiscount: 0.10, contextWindowTokens: 256_000, selectable: true,  verifier: false },
  { id: 'gpt-5.4-nano',            label: 'GPT-5.4 Nano',           provider: 'openai',    tier: 'economy',   inputPer1M: 0.20,  outputPer1M: 1.25,  cachedInputDiscount: 0.10, contextWindowTokens: 256_000, selectable: true,  verifier: false },
  // Azure AI Foundry model-router (2025-11-18): Chat Completions only; billing = underlying model picked.
  // https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/model-router
  { id: 'model-router',           label: 'Model Router (Foundry)', provider: 'openai',    tier: 'standard',  inputPer1M: 0.75,  outputPer1M: 4.50,  cachedInputDiscount: 0.10, selectable: true,  verifier: false },

  { id: 'o3',                     label: 'o3',                     provider: 'openai',    tier: 'reasoning', inputPer1M: 2.00,  outputPer1M: 8.00,  thinkingPer1M: 8.00, cachedInputDiscount: 0.25, contextWindowTokens: 200_000, selectable: true,  verifier: false },
  { id: 'o3-pro',                 label: 'o3 Pro',                 provider: 'openai',    tier: 'reasoning', inputPer1M: 3.00,  outputPer1M: 15.0, thinkingPer1M: 15.0, cachedInputDiscount: 0.25, contextWindowTokens: 200_000, selectable: true,  verifier: false },
  { id: 'o4-mini',                label: 'o4-mini',                provider: 'openai',    tier: 'reasoning', inputPer1M: 1.10,  outputPer1M: 4.40,  thinkingPer1M: 4.40, cachedInputDiscount: 0.25, contextWindowTokens: 200_000, selectable: true,  verifier: false },
  { id: 'o3-deep-research',       label: 'o3 Deep Research',       provider: 'openai',    tier: 'specialized', inputPer1M: 2.00,  outputPer1M: 8.00,  thinkingPer1M: 8.00, cachedInputDiscount: 0.25, contextWindowTokens: 200_000, selectable: false, verifier: false },
  { id: 'o4-mini-deep-research',  label: 'o4-mini Deep Research',  provider: 'openai',    tier: 'specialized', inputPer1M: 1.10,  outputPer1M: 4.40,  thinkingPer1M: 4.40, cachedInputDiscount: 0.25, contextWindowTokens: 200_000, selectable: false, verifier: false },

  // ── Anthropic ──────────────────────────────────────────────
  // Anthropic cache read = 10% of input price. Cache creation = 125% of input price (amortized, treated as full price).
  // Source: https://platform.claude.com/docs/en/docs/about-claude/pricing (verified 2026-02-26)
  // RETIRED (Mar 26 2026): claude-opus-4-6 — cost prohibitive ($5/$25 per MTok). Kept for pricing lookups.
  { id: 'claude-opus-4-6',        label: 'Claude Opus 4.6 (retired)', provider: 'anthropic', tier: 'flagship',  inputPer1M: 5.00,  outputPer1M: 25.0,  cachedInputDiscount: 0.10, contextWindowTokens: 200_000, selectable: false, verifier: false },
  { id: 'claude-sonnet-4-6',      label: 'Claude Sonnet 4.6',      provider: 'anthropic', tier: 'standard',  inputPer1M: 3.00,  outputPer1M: 15.0,  cachedInputDiscount: 0.10, contextWindowTokens: 200_000, selectable: true,  verifier: true  },
  { id: 'claude-sonnet-4-5',      label: 'Claude Sonnet 4.5',      provider: 'anthropic', tier: 'standard',  inputPer1M: 3.00,  outputPer1M: 15.0,  cachedInputDiscount: 0.10, contextWindowTokens: 200_000, selectable: true,  verifier: false },
  { id: 'claude-haiku-4-5',        label: 'Claude Haiku 4.5',       provider: 'anthropic', tier: 'economy',   inputPer1M: 1.00,  outputPer1M: 5.00,  cachedInputDiscount: 0.10, contextWindowTokens: 200_000, selectable: true,  verifier: false },

  // ── Specialized (not selectable for general agent assignment) ─
  { id: 'gemini-embedding-001',       label: 'Gemini Embedding',       provider: 'gemini',    tier: 'specialized', inputPer1M: 0.15, outputPer1M: 0,    selectable: false, verifier: false },
  { id: 'gpt-realtime-2025-08-28',    label: 'GPT Realtime',            provider: 'openai',    tier: 'specialized', inputPer1M: 5.00, outputPer1M: 20.0, selectable: false, verifier: false },
  { id: 'gpt-image-1',                label: 'GPT Image 1',            provider: 'openai',    tier: 'specialized', inputPer1M: 0,    outputPer1M: 0,    selectable: false, verifier: false },
  { id: 'gpt-image-1.5',            label: 'GPT Image 1.5',          provider: 'openai',    tier: 'specialized', inputPer1M: 0,    outputPer1M: 0,    selectable: false, verifier: false },
  { id: 'gpt-image-1-mini',         label: 'GPT Image 1 Mini',       provider: 'openai',    tier: 'specialized', inputPer1M: 0,    outputPer1M: 0,    selectable: false, verifier: false },
  { id: 'sora-2',                   label: 'Sora 2',                 provider: 'openai',    tier: 'specialized', inputPer1M: 0,    outputPer1M: 0,    selectable: false, verifier: false },

] as const;

// ─── Deprecated model mapping ────────────────────────────────
// Old model IDs that may still exist in the database → their replacement.
// Used by resolveModel() to auto-upgrade agents stuck on old models.
// (Includes removed-from-catalog slugs like gemini-2.5-pro — never call the API with them.)

export const DEPRECATED_MODELS: Record<string, string> = {
  // Gemini 2.x and older (shutdown June 1, 2026) — default migration target is GPT workhorse
  'gemini-2.0-flash-001':       'gpt-5.4-mini',
  'gemini-2.0-flash':           'gpt-5.4-mini',
  'gemini-2.0-flash-exp':       'gpt-5.4-mini',
  'gemini-2.0-pro':             'gpt-5.4',
  'gemini-1.5-flash':           'gpt-5.4-mini',
  'gemini-1.5-pro':             'gpt-5.4',
  'gemini-3.0-flash-preview':   'gpt-5.4-mini',
  'gemini-3-pro-preview':       'gpt-5.4',
  'gemini-2.5-pro':             'gpt-5.4',

  // Gemini retired (cost-prohibitive, Mar 26 2026)
  'gemini-3.1-pro-preview':     'gpt-5.4',
  'gemini-3-flash-preview':     'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash':           'gemini-3.1-flash-lite-preview',

  // OpenAI legacy
  'gpt-4o':                     'gpt-5-mini',
  'gpt-4o-mini':                'gpt-5-nano',
  'gpt-4-turbo':                'gpt-5-mini-2025-08-07',
  'gpt-4':                      'gpt-5-mini-2025-08-07',
  'gpt-3.5-turbo':              'gpt-5-nano',
  'gpt-4.1-nano':               'gpt-5-nano',
  'gpt-4.1':                    'gpt-5-mini-2025-08-07',
  'gpt-4.1-mini':               'gpt-5-nano',
  'gpt-5.4-nano':               'model-router',
  'gpt-image-1.5-2025-12-16':   'gpt-image-1.5',

  // Anthropic legacy
  'claude-sonnet-4-20250514':   'gpt-5.4-mini',
  'claude-3-5-sonnet-20241022': 'gpt-5.4-mini',
  'claude-3-5-sonnet-latest':   'gpt-5.4-mini',
  'claude-3-5-haiku-20241022':  'claude-sonnet-4-5',
  'claude-3-5-haiku-latest':    'claude-sonnet-4-5',
  'claude-3-opus-20240229':     'claude-sonnet-4-5',
  'claude-3-haiku-20240307':    'claude-sonnet-4-5',
  'claude-opus-4-20250514':     'claude-sonnet-4-5',
  'claude-opus-4-6-20260205':   'claude-sonnet-4-5',
  'claude-opus-4-6':            'claude-sonnet-4-5',
  'claude-sonnet-4-6-20260217': 'gpt-5.4-mini',
};

// ─── Default models by purpose ───────────────────────────────

/** The default model assigned to new agents */
export const DEFAULT_AGENT_MODEL = 'model-router';

/** The model used for web search (needs OpenAI Responses API; not model-router) */
export const WEB_SEARCH_MODEL = 'gpt-5.4-mini';

/** The model used for realtime voice */
export const REALTIME_MODEL = 'gpt-realtime-2025-08-28';

/** The model used for realtime input audio transcription */
export const TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';

/** The model used for text embeddings */
export const EMBEDDING_MODEL = 'gemini-embedding-001';

/** The model used for image generation */
export const IMAGE_MODEL = 'gpt-image-1.5';

/** The model used for GraphRAG extraction */
export const GRAPHRAG_MODEL = 'model-router';

// ─── Fallback chains ────────────────────────────────────────
// When a model fails with a non-retryable error (e.g., rate limit, outage),
// try the next model in the chain. Each chain crosses providers.

export const FALLBACK_CHAINS: Record<string, readonly string[]> = {
  // Gemini primary → try same-provider tier first, then cheapest cross-provider
  'gemini-3.1-flash-lite-preview':  ['gemini-2.5-flash-lite', 'gpt-5-mini'],
  'gemini-2.5-flash-lite':          ['gemini-3.1-flash-lite-preview', 'model-router'],

  // OpenAI primary → same-provider first (required for Azure-only: deployments are on one endpoint),
  // then Gemini as cross-provider fallback.
  'gpt-5.4':                ['gpt-5.4-mini', 'gpt-5-mini-2025-08-07', 'gemini-3.1-flash-lite-preview'],
  'gpt-5.4-pro':            ['gpt-5.4', 'gpt-5.4-mini', 'gemini-3.1-flash-lite-preview'],
  'gpt-5.4-mini':           ['gpt-5-mini-2025-08-07', 'model-router'],
  'gpt-5.4-nano':           ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite-preview'],
  'model-router':           ['gpt-5.4-mini', 'gpt-5-mini-2025-08-07', 'gemini-3.1-flash-lite-preview'],
  'gpt-5.2':                ['gemini-3.1-flash-lite-preview', 'gpt-5.4-mini'],
  'gpt-5.2-pro':            ['gemini-3.1-flash-lite-preview', 'gpt-5.4-mini'],
  'gpt-5.3-codex':          ['gpt-5.2-codex', 'gpt-5.1-codex', 'gpt-5-mini-2025-08-07', 'gemini-3.1-flash-lite-preview'],
  'gpt-5.2-codex':          ['gpt-5.1-codex', 'gpt-5.1', 'gpt-5-mini-2025-08-07', 'gemini-3.1-flash-lite-preview'],
  'gpt-5.1-codex':          ['gpt-5.1', 'gpt-5-mini-2025-08-07', 'gemini-3.1-flash-lite-preview'],
  'gpt-5.1-codex-mini':     ['gpt-5.1-codex', 'gpt-5-nano', 'gemini-3.1-flash-lite-preview'],
  'gpt-5.1-codex-max':      ['gpt-5.4', 'gpt-5.1-codex', 'gpt-5-mini-2025-08-07', 'gemini-3.1-flash-lite-preview'],
  'gpt-5-codex':            ['gpt-5.1-codex', 'gpt-5', 'gpt-5-mini-2025-08-07', 'gemini-3.1-flash-lite-preview'],
  'gpt-5-pro':              ['gpt-5.4', 'gpt-5.4-mini', 'gemini-3.1-flash-lite-preview'],
  'gpt-5.1':                ['gemini-3.1-flash-lite-preview', 'gpt-5.4-mini'],
  'gpt-5':                  ['gemini-3.1-flash-lite-preview', 'gpt-5.4-mini'],
  'gpt-5-mini':             ['gemini-3.1-flash-lite-preview', 'gemini-2.5-flash-lite'],
  'gpt-5-mini-2025-08-07':  ['gemini-3.1-flash-lite-preview', 'gemini-2.5-flash-lite'],
  'gpt-5-nano':             ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite-preview'],
  'o3':                     ['gemini-3.1-flash-lite-preview', 'gpt-5.4-mini'],
  'o3-pro':                 ['o3', 'gpt-5.4', 'gpt-5.4-mini'],
  'o4-mini':                ['gemini-3.1-flash-lite-preview', 'gpt-5.4-mini'],
  'o3-deep-research':       ['gpt-5.4', 'o3'],
  'o4-mini-deep-research':  ['o4-mini', 'gpt-5.4-mini'],

  // Anthropic primary → try Gemini first (GCP-resident), then cheapest OpenAI
  'claude-sonnet-4-6':      ['gemini-3.1-flash-lite-preview', 'gpt-5.4'],
  'claude-sonnet-4-5':      ['gemini-3.1-flash-lite-preview', 'gpt-5-mini'],
  'claude-haiku-4-5':       ['gemini-3.1-flash-lite-preview', 'gpt-5.4-mini'],
};

/**
 * When primary model's cross-provider chain is entirely Gemini, use these for Atlas (ops) instead.
 * Temporary mitigation for Gemini tool-schema errors (defer_loading, thought_signature, etc.).
 */
const OPS_AGENT_FALLBACK_WHEN_ALL_GEMINI: Record<string, readonly string[]> = {
  'gpt-5.4': ['gpt-5.4-mini', 'gpt-5-mini-2025-08-07'],
  'gpt-5.4-pro': ['gpt-5.4', 'gpt-5.4-mini'],
  'gpt-5.2': ['gpt-5.4-mini', 'gpt-5-mini-2025-08-07'],
  'gpt-5.2-pro': ['gpt-5.4', 'gpt-5.4-mini'],
  'gpt-5.3-codex': ['gpt-5.2-codex', 'gpt-5.1-codex', 'gpt-5.4-mini'],
  'gpt-5.2-codex': ['gpt-5.1-codex', 'gpt-5.4-mini'],
  'gpt-5.1-codex': ['gpt-5.1', 'gpt-5.4-mini'],
  'gpt-5.1-codex-mini': ['gpt-5.1-codex', 'gpt-5.4-mini'],
  'gpt-5.1-codex-max': ['gpt-5.4', 'gpt-5.1-codex', 'gpt-5.4-mini'],
  'gpt-5-codex': ['gpt-5.1-codex', 'gpt-5.4-mini'],
  'gpt-5-pro': ['gpt-5.4', 'gpt-5.4-mini'],
  'gpt-5.1': ['gpt-5.4-mini', 'gpt-5-mini-2025-08-07'],
  'gpt-5': ['gpt-5.4-mini', 'gpt-5-mini-2025-08-07'],
  'o3-pro': ['o3', 'gpt-5.4', 'gpt-5.4-mini'],
  'gpt-5.4-nano': ['gpt-5.4-mini', 'gpt-5-mini-2025-08-07'],
  'gpt-5-nano': ['gpt-5.4-mini', 'gpt-5-mini-2025-08-07'],
  'model-router': ['gpt-5.4-mini', 'gpt-5-mini-2025-08-07'],
};

/** Last resort when no Gemini-free chain can be derived (should be rare). */
const OPS_AGENT_FALLBACK_DEFAULT: readonly string[] = ['gpt-5.4-mini', 'gpt-5-mini-2025-08-07'];

function getOpsFallbackChainExcludingGemini(model: string): readonly string[] {
  const base = FALLBACK_CHAINS[model] ?? [];
  const filtered = base.filter((m) => !m.startsWith('gemini-'));
  if (filtered.length > 0) {
    return filtered;
  }

  return OPS_AGENT_FALLBACK_WHEN_ALL_GEMINI[model] ?? OPS_AGENT_FALLBACK_DEFAULT;
}

// ─── Provider-local fallback chains ─────────────────────────
// Used when a workflow needs to preserve provider identity, such as
// triangulation slots where the OpenAI/Gemini/Claude lanes must remain stable.

export const PROVIDER_LOCAL_FALLBACK_CHAINS: Record<string, readonly string[]> = {
  // Gemini (only flash-lite + lite remain active)
  'gemini-3.1-flash-lite-preview': ['gemini-2.5-flash-lite'],
  'gemini-2.5-flash-lite':         ['gemini-3.1-flash-lite-preview'],

  // OpenAI
  'gpt-5.4-pro':            ['gpt-5.4', 'gpt-5.2', 'gpt-5-mini-2025-08-07'],
  'gpt-5.4':                ['gpt-5.2', 'gpt-5.1', 'gpt-5-mini-2025-08-07'],
  'gpt-5.4-mini':           ['gpt-5-mini-2025-08-07', 'model-router'],
  'gpt-5.4-nano':           ['gpt-5-nano', 'gpt-5-mini-2025-08-07'],
  'model-router':           ['gpt-5.4-mini', 'gpt-5-mini-2025-08-07'],
  'gpt-5.2-pro':            ['gpt-5.2', 'gpt-5.1', 'gpt-5-mini-2025-08-07'],
  'gpt-5.2':                ['gpt-5.1', 'gpt-5-mini-2025-08-07'],
  'gpt-5.3-codex':          ['gpt-5.2-codex', 'gpt-5.1-codex', 'gpt-5-mini-2025-08-07'],
  'gpt-5.2-codex':          ['gpt-5.1-codex', 'gpt-5-mini-2025-08-07'],
  'gpt-5.1-codex':          ['gpt-5-mini-2025-08-07', 'gpt-5-nano'],
  'gpt-5.1-codex-mini':     ['gpt-5.1-codex', 'gpt-5-nano'],
  'gpt-5.1-codex-max':      ['gpt-5.4', 'gpt-5.1-codex', 'gpt-5-mini-2025-08-07'],
  'gpt-5-codex':            ['gpt-5.1-codex', 'gpt-5-mini-2025-08-07'],
  'gpt-5-pro':              ['gpt-5.4', 'gpt-5.2', 'gpt-5-mini-2025-08-07'],
  'gpt-5.1':                ['gpt-5-mini-2025-08-07', 'gpt-5-nano'],
  'gpt-5':                  ['gpt-5-mini-2025-08-07', 'gpt-5-nano'],
  'o3':                     ['gpt-5.1', 'gpt-5-mini-2025-08-07'],
  'o3-pro':                 ['o3', 'gpt-5.1', 'gpt-5-mini-2025-08-07'],
  'o4-mini':                ['gpt-5-mini-2025-08-07', 'gpt-5-nano'],
  'o3-deep-research':       ['o3', 'gpt-5.1', 'gpt-5-mini-2025-08-07'],
  'o4-mini-deep-research':  ['o4-mini', 'gpt-5-mini-2025-08-07'],

  // Anthropic
  'claude-sonnet-4-6':      ['claude-sonnet-4-5'],
  'claude-sonnet-4-5':      ['claude-haiku-4-5'],
  'claude-haiku-4-5':       [],
};

// ─── Cross-model verifier mapping ────────────────────────────
// Maps a primary model to its cross-provider verifier.
// Always uses a DIFFERENT provider to prevent correlated errors.

export const VERIFIER_MAP: Record<string, string> = {
  // Gemini primary → cheapest cross-provider verifier
  'gemini-3.1-flash-lite-preview': 'gpt-5-nano',
  'gemini-2.5-flash-lite':         'gpt-5-nano',

  // OpenAI primary → Gemini verifier (GCP-native, cheap)
  'gpt-5.4-pro':            'gemini-3.1-flash-lite-preview',
  'gpt-5.4':                'gemini-3.1-flash-lite-preview',
  'gpt-5.4-mini':           'gemini-3.1-flash-lite-preview',
  'gpt-5.4-nano':           'gemini-2.5-flash-lite',
  'model-router':           'gemini-3.1-flash-lite-preview',
  'gpt-5.2':                'gemini-3.1-flash-lite-preview',
  'gpt-5.2-pro':            'gemini-3.1-flash-lite-preview',
  'gpt-5.3-codex':          'gemini-3.1-flash-lite-preview',
  'gpt-5.2-codex':          'gemini-3.1-flash-lite-preview',
  'gpt-5.1-codex':          'gemini-3.1-flash-lite-preview',
  'gpt-5.1-codex-mini':     'gemini-3.1-flash-lite-preview',
  'gpt-5.1-codex-max':      'gemini-3.1-flash-lite-preview',
  'gpt-5-codex':            'gemini-3.1-flash-lite-preview',
  'gpt-5-pro':              'gemini-3.1-flash-lite-preview',
  'gpt-5.1':                'gemini-3.1-flash-lite-preview',
  'gpt-5':                  'gemini-3.1-flash-lite-preview',
  'gpt-5-mini':             'gemini-3.1-flash-lite-preview',
  'gpt-5-mini-2025-08-07':  'gemini-3.1-flash-lite-preview',
  'gpt-5-nano':             'gemini-2.5-flash-lite',

  'o3':                     'gemini-3.1-flash-lite-preview',
  'o3-pro':                 'gemini-3.1-flash-lite-preview',
  'o4-mini':                'gemini-3.1-flash-lite-preview',
  'o3-deep-research':       'gemini-3.1-flash-lite-preview',
  'o4-mini-deep-research':  'gemini-3.1-flash-lite-preview',

  // Claude primary → Gemini verifier (GCP-native, cheap)
  'claude-sonnet-4-6':      'gemini-3.1-flash-lite-preview',
  'claude-sonnet-4-5':      'gemini-3.1-flash-lite-preview',
  'claude-haiku-4-5':       'gemini-2.5-flash-lite',
};

// ─── Deep dive research models ──────────────────────────────
// Gemini Deep Research API: https://ai.google.dev/gemini-api/docs/deep-research

export const DEEP_DIVE_MODELS: Record<string, string> = {
  overview:             'deep-research-pro-preview-12-2025',
  financials:           'deep-research-pro-preview-12-2025',
  technology:           'deep-research-pro-preview-12-2025',
  market:               'deep-research-pro-preview-12-2025',
  competitive:          'deep-research-pro-preview-12-2025',
  leadership:           'deep-research-pro-preview-12-2025',
  customers:            'deep-research-pro-preview-12-2025',
  risks:                'deep-research-pro-preview-12-2025',
  company_profile:      'deep-research-pro-preview-12-2025',
  strategic_direction:  'deep-research-pro-preview-12-2025',
  segment_analysis:     'deep-research-pro-preview-12-2025',
  ma_activity:          'deep-research-pro-preview-12-2025',
  ai_impact:            'deep-research-pro-preview-12-2025',
  talent_assessment:    'deep-research-pro-preview-12-2025',
  regulatory_landscape: 'deep-research-pro-preview-12-2025',
};

/** Cross-model verification after deep-dive synthesis */
export const DEEP_DIVE_VERIFICATION_MODELS = ['deep-research-pro-preview-12-2025'] as const;

/** Reasoning engine verification (cross-provider) */
export const REASONING_VERIFICATION_MODELS = ['gpt-5.4-mini', 'gpt-5-mini'] as const;

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
  if (model === 'model-router' || model.startsWith('model-router')) return 'openai';
  if (model.startsWith('gpt-') || /^o[134](-|$)/.test(model)) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  throw new Error(`Unknown model provider for "${model}"`);
}

/**
 * Get the fallback chain for a model. Returns empty array if no fallbacks defined.
 * When `agentRole` is `ops` (Atlas), omits Gemini models so fallbacks use OpenAI/Anthropic only
 * (mitigates Gemini tool declaration / thought_signature client errors).
 */
export function getFallbackChain(model: string, agentRole?: string): readonly string[] {
  if (agentRole === 'ops') {
    return getOpsFallbackChainExcludingGemini(model);
  }
  return FALLBACK_CHAINS[model] ?? [];
}

/**
 * Get a fallback chain that stays within the same provider family.
 * For `ops`, Gemini entries are stripped when present.
 */
export function getProviderLocalFallbackChain(model: string, agentRole?: string): readonly string[] {
  const chain = PROVIDER_LOCAL_FALLBACK_CHAINS[model] ?? [];
  if (agentRole === 'ops') {
    return chain.filter((m) => !m.startsWith('gemini-'));
  }
  return chain;
}

/**
 * Get the cross-provider verifier model for a given primary model.
 */
export function getVerifierFor(primaryModel: string): string {
  // Direct mapping
  if (VERIFIER_MAP[primaryModel]) return VERIFIER_MAP[primaryModel];

  // Prefix-based fallback — always cross-provider, cheapest viable
  if (primaryModel.startsWith('gemini-')) return 'gpt-5-mini';
  if (primaryModel.startsWith('gpt-') || /^o[134](-|$)/.test(primaryModel)) return 'gemini-3.1-flash-lite-preview';
  if (primaryModel.startsWith('claude-')) return 'gpt-5.4-mini';

  return 'gpt-5.4-mini';
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

  // Some providers (Anthropic) report cached tokens separately (additive) while
  // others include them in the input total.  When cached > input the caller is
  // using additive semantics — derive the real total so the math stays positive.
  const totalInput = cachedInputTokens > inputTokens
    ? inputTokens + cachedInputTokens   // additive: inputTokens is uncached-only
    : inputTokens;                       // inclusive: inputTokens already contains cached
  const uncachedInputTokens = totalInput - cachedInputTokens;
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

/** Provider-level default context windows (tokens). */
const PROVIDER_DEFAULT_CONTEXT_WINDOWS: Record<ModelProvider, number> = {
  gemini:    1_000_000,
  openai:    128_000,
  anthropic: 200_000,
};

/**
 * Get the context window size (in tokens) for a model.
 * Falls back to provider defaults if the model entry doesn't specify one.
 */
export function getContextWindow(modelId: string): number {
  const resolved = resolveModel(modelId);
  const def = getModel(resolved);
  if (def?.contextWindowTokens) return def.contextWindowTokens;
  try {
    const provider = detectProvider(resolved);
    return PROVIDER_DEFAULT_CONTEXT_WINDOWS[provider];
  } catch {
    return 128_000; // Safe fallback
  }
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

/**
 * Returns the supported reasoning levels for a model.
 * These reflect provider/model-family limitations rather than generic UI choices.
 */
export function getReasoningSupport(modelId: string): ReasoningSupport {
  const model = resolveModel(modelId);

  // Foundry model-router forwards reasoning_effort to underlying models when applicable (2025-11-18+).
  if (model === 'model-router' || model.startsWith('model-router')) {
    return { levels: ['none', 'standard', 'deep'], defaultLevel: 'standard' };
  }

  if (/^gpt-5\.[12]/.test(model)) {
    return { levels: ['none', 'standard'], defaultLevel: 'standard' };
  }

  if (model.startsWith('gpt-5') || /^o[134](-|$)/.test(model)) {
    return { levels: ['standard', 'deep'], defaultLevel: 'standard' };
  }

  if (model.startsWith('gemini-')) {
    return { levels: ['none', 'deep'], defaultLevel: 'deep' };
  }

  if (model.startsWith('claude-')) {
    return { levels: ['none', 'deep'], defaultLevel: 'deep' };
  }

  return { levels: ['none', 'standard'], defaultLevel: 'standard' };
}

export function normalizeReasoningLevel(modelId: string, requested?: ReasoningLevel): ReasoningLevel {
  const support = getReasoningSupport(modelId);
  if (requested && support.levels.includes(requested)) {
    return requested;
  }
  return support.defaultLevel;
}

// ─── Cost Optimizer ─────────────────────────────────────────
//
// Maps agent roles to model tiers based on task complexity.
//
// Tiers (OpenAI-first defaults):
//   economy  → model-router — triage, high-volume
//   standard → model-router — default workhorse (Foundry routes to best model)
//   pro      → model-router — orchestration, strategic, founder-chat

export type CostTier = 'economy' | 'standard' | 'pro';

/** Preferred model for each cost tier. */
export const TIER_MODELS: Record<CostTier, string> = {
  economy:  'model-router',
  standard: 'model-router',
  pro:      'model-router',
};

/** Model used for on_demand chat with founder-facing executives. */
export const EXEC_CHAT_MODEL = 'model-router';

/** Role → tier mapping. Unlisted roles default to 'standard'. */
export const ROLE_COST_TIER: Record<string, CostTier> = {
  // ── Economy: routine, structured, low-complexity ────────────
  'm365-admin':            'economy',
  'global-admin':          'economy',
  'seo-analyst':           'economy',
  'social-media-manager':  'economy',
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
  'vp-sales':              'standard',
  'vp-design':             'standard',
  'bob-the-tax-pro':       'standard',
  'marketing-intelligence-analyst': 'standard',
  'competitive-research-analyst':   'standard',
  'market-research-analyst':        'standard',

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

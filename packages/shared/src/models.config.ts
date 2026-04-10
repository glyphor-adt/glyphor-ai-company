/**
 * models.config.ts
 * -----------------------------------------------------------------------------
 * THE ONLY FILE YOU EDIT WHEN MODELS CHANGE.
 *
 * All model strings in the codebase flow from here.
 * Never hardcode model strings elsewhere.
 *
 * Last reviewed: 2026-04-11
 * -----------------------------------------------------------------------------
 */

export const MODEL_CONFIG = {

  // -- General agent routing ---------------------------------------------------
  tiers: {
    // Bulk scheduled: heartbeat, memory writes, classification, routing
    fast: 'gemini-3.1-flash-lite-preview', // GCP — Gemini API

    // Most agent work: analysis, drafting, tool use, standard assignments
    default: 'gemini-3.1-flash-lite-preview', // GCP — workhorse

    // High stakes: founder-facing, CoS orchestration, complex reasoning
    high: 'claude-sonnet-4-6', // AWS Bedrock — Claude Sonnet 4.6

    // <1% highest-stakes turns (explicit policy / orchestration only)
    max: 'claude-opus-4-6', // AWS Bedrock — Claude Opus 4.6

    // Long chain-of-thought / math-style reasoning
    reasoning: 'deepseek-r1', // AWS Bedrock — DeepSeek R1
  },

  // -- Specialized paths -------------------------------------------------------
  specialized: {
    web_search:    'gpt-5.4-mini',                      // Azure Foundry — OpenAI Responses API + grounding
    embeddings:    'gemini-embedding-001',               // Gemini API
    voice:         'gpt-realtime-2025-08-28',            // Azure Foundry
    transcription: 'gpt-4o-transcribe',                  // Azure Foundry
    images:        'gpt-image-1.5',                      // Azure Foundry
    reflection:    'claude-haiku-4-5',                   // AWS Bedrock — fast self-eval
    /** Dashboard `quick_demo_web_app` — single-file HTML; Codex via Azure Foundry */
    quick_demo_web: 'gpt-5.3-codex',
    /** Full web builds — DeepSeek V3.2 primary (Bedrock), Gemini Pro fallback via `fallbacks` */
    code_generation: 'deepseek-v3-2',
    shadow_eval:   'gemini-3.1-flash-lite-preview',
    deep_research: 'deep-research-pro-preview-12-2025',
  },

  // -- Fallback chains ---------------------------------------------------------
  fallbacks: {
    'gemini-3.1-flash-lite-preview': 'gemini-2.5-flash-lite',
    'gpt-5-nano':                    'gemini-2.5-flash-lite',
    'gpt-5.3-codex':                 'gemini-3.1-flash-lite-preview',
    'deepseek-v3-2':                 'gemini-3.1-pro-preview',
  },

  // -- Disabled models ---------------------------------------------------------
  disabled: {
    'gemini-3-pro-preview':      true,
    'gemini-2.0-flash-lite':     true,
    'gemini-3-flash-preview':    true,
    'gemini-2.5-flash':          true,
    'claude-sonnet-4-5':         true,
    'claude-sonnet-4-20250514':  true,
    'gpt-5-mini-2025-08-07':     true,
  },

  // -- Provider configuration --------------------------------------------------
  providers: {

    gemini: {
      type: 'gemini-api' as const,
      listEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
      authHeader:   'x-goog-api-key',
      secretEnvVar: 'GEMINI_API_KEY',
      owns: ['gemini-', 'imagen-', 'deep-research-'],
      docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    },

    vertexAI: {
      type: 'vertex-ai' as const,
      listEndpoint: 'https://us-central1-aiplatform.googleapis.com/v1/publishers/anthropic/models',
      authType: 'gcp-adc',
      gcpProject: 'ai-glyphor-company',
      gcpRegion:  'us-central1',
      deprecationsUrl: 'https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/available-models',
      owns: ['claude-'],
      docsUrl: 'https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude',
    },

    azureFoundry: {
      type: 'azure-foundry' as const,
      authHeader:   'api-key',
      secretEnvVar: 'AZURE_FOUNDRY_API',
      resourceEnvVar: 'AZURE_FOUNDRY_ENDPOINT',
      owns: ['gpt-', 'o1-', 'o3-', 'o4-'],
      docsUrl: 'https://learn.microsoft.com/en-us/azure/foundry/openai/latest',
    },
  },

  meta: {
    lastReviewedAt: '2026-04-11T00:00:00Z',
    nextReviewAt:   '2026-05-11T00:00:00Z',
    reviewedBy:     'model-checker-cron',
    configVersion:  6,
  },

} as const;

export type ModelTier       = keyof typeof MODEL_CONFIG.tiers;
export type SpecializedPath = keyof typeof MODEL_CONFIG.specialized;

export const getTierModel   = (tier: ModelTier): string       => MODEL_CONFIG.tiers[tier];
export const getSpecialized = (path: SpecializedPath): string => MODEL_CONFIG.specialized[path];
export const getFallback    = (model: string): string | null  =>
  (MODEL_CONFIG.fallbacks as Record<string, string>)[model] ?? null;
export const isDisabled     = (model: string): boolean        =>
  (MODEL_CONFIG.disabled as Record<string, boolean>)[model] === true;

export const ALL_ACTIVE_MODELS: string[] = [
  ...Object.values(MODEL_CONFIG.tiers),
  ...Object.values(MODEL_CONFIG.specialized),
  ...Object.values(MODEL_CONFIG.fallbacks),
].filter((m) => !isDisabled(m));

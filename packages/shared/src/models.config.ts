/**
 * models.config.ts
 * -----------------------------------------------------------------------------
 * THE ONLY FILE YOU EDIT WHEN MODELS CHANGE.
 *
 * All model strings in the codebase flow from here.
 * Never hardcode model strings elsewhere.
 *
 * Last reviewed: 2026-03-24
 * Next automated review: 2026-04-24 (runs via Cloud Scheduler)
 * -----------------------------------------------------------------------------
 */

export const MODEL_CONFIG = {

  // -- General agent routing ---------------------------------------------------
  tiers: {
    // Bulk scheduled: heartbeat, memory writes, classification, routing
    fast: 'gpt-5-nano',                       // $0.05/$0.40 per MTok - via Azure Foundry

    // Most agent work: analysis, drafting, tool use, standard assignments
    default: 'gemini-3.1-flash-lite-preview', // ~$0.10/$0.40 per MTok - via Gemini API

    // High stakes: founder-facing, CoS orchestration, code, complex reasoning
    high: 'gpt-5.4-mini',                     // lower-cost high-stakes default via Azure Foundry
  },

  // -- Specialized paths -------------------------------------------------------
  specialized: {
    web_search:    'gpt-5.4-mini',                      // Azure Foundry - OpenAI Responses API
    embeddings:    'gemini-embedding-001',               // Gemini API - 768 dims, GA stable
    voice:         'gpt-realtime-2025-08-28',            // Azure Foundry - Teams audio bridge
    transcription: 'gpt-4o-transcribe',                  // Azure Foundry - Teams audio bridge
    images:        'gpt-image-1.5',                      // OpenAI image generation
    reflection:    'gpt-5-mini',                         // lower-cost agent self-eval
    shadow_eval:   'gemini-3.1-flash-lite-preview',      // Gemini API - shadow runner
    deep_research: 'deep-research-pro-preview-12-2025',  // Gemini API - strategy reports
  },

  // -- Fallback chains ---------------------------------------------------------
  fallbacks: {
    'gemini-3.1-flash-lite-preview': 'gemini-2.5-flash-lite', // preview -> lite
    'gpt-5-nano':                    'gemini-2.5-flash-lite', // Azure down -> Google
  },

  // -- Disabled models ---------------------------------------------------------
  disabled: {
    'gemini-3-pro-preview':      true, // shut down March 9 2026
    'gemini-2.0-flash-lite':     true, // shuts down June 1 2026
    'gemini-3-flash-preview':    true, // retired Mar 26 2026 - cost prohibitive
    'gemini-3.1-pro-preview':    true, // retired Mar 26 2026 - cost prohibitive
    'gemini-2.5-flash':          true, // retired Mar 26 2026 - cost prohibitive
    'claude-opus-4-6':           true, // retired Mar 26 2026 - cost prohibitive ($5/$25 per MTok)
    'claude-sonnet-4-20250514':  true, // stale string - was reflection model
    'claude-sonnet-4-6':          true, // disabled for cost-control policy
    'gpt-5-mini-2025-08-07':     true, // 4 hardcoded agents - migrate to default tier
  },

  // -- Provider configuration --------------------------------------------------
  // Defines how the checker reaches each provider to list available models.
  // Each provider is different because of how you access them.
  providers: {

    // Gemini API - direct Google, used for Gemini models + embeddings + images + deep research
    gemini: {
      type: 'gemini-api' as const,
      listEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
      authHeader:   'x-goog-api-key',
      secretEnvVar: 'GEMINI_API_KEY',
      // Models we source from here
      owns: ['gemini-', 'imagen-', 'deep-research-'],
      docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    },

    // Vertex AI - GCP, used for Anthropic/Claude models via Model Garden
    // Auth uses GCP Application Default Credentials (ADC), not an API key
    vertexAI: {
      type: 'vertex-ai' as const,
      // Lists Anthropic publisher models available in your GCP project
      listEndpoint: 'https://us-central1-aiplatform.googleapis.com/v1/publishers/anthropic/models',
      authType: 'gcp-adc', // uses Application Default Credentials
      gcpProject: 'ai-glyphor-company',
      gcpRegion:  'us-central1',
      // Partner model deprecations page - parsed by checker for upcoming shutdowns
      deprecationsUrl: 'https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/available-models',
      owns: ['claude-'],
      docsUrl: 'https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude',
    },

    // Azure AI Foundry - used for OpenAI models (GPT-5, gpt-realtime, etc.)
    // Lists YOUR deployed models, not the global catalog
    // Deployment names = model names in your config (you control this mapping)
    azureFoundry: {
      type: 'azure-foundry' as const,
      // /openai/v1/models lists currently available models in your Foundry resource
      // listEndpoint constructed at runtime from AZURE_FOUNDRY_ENDPOINT + '/openai/v1/models'
      authHeader:   'api-key',
      secretEnvVar: 'AZURE_FOUNDRY_API',
      resourceEnvVar: 'AZURE_FOUNDRY_ENDPOINT', // full endpoint URL, e.g. https://glyphor.openai.azure.com
      owns: ['gpt-', 'o1-', 'o3-', 'o4-'],
      docsUrl: 'https://learn.microsoft.com/en-us/azure/foundry/openai/latest',
    },
  },

  // -- Review metadata ---------------------------------------------------------
  meta: {
    lastReviewedAt: '2026-03-24T00:00:00Z',
    nextReviewAt:   '2026-04-24T00:00:00Z',
    reviewedBy:     'model-checker-cron',
    configVersion:  5,
  },

} as const;

// -- Type helpers --------------------------------------------------------------
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

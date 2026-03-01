/**
 * Model Registry — Dashboard Frontend
 *
 * Single source of truth for AI models available in the dashboard.
 * Must match the backend registry in @glyphor/shared/models.
 *
 * When adding or removing models, update BOTH this file
 * and packages/shared/src/models.ts.
 */

export type ModelProvider = 'gemini' | 'openai' | 'anthropic';

export interface ModelOption {
  value: string;
  label: string;
  provider: ModelProvider;
  default?: boolean;
}

export const PROVIDER_LABELS: Record<ModelProvider, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

/**
 * All models available for agent assignment in the dashboard.
 * Ordered by provider, then by tier (flagship → standard → economy).
 */
export const MODELS: ModelOption[] = [
  // ── Google Gemini ──
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro',         provider: 'gemini'  },
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash',         provider: 'gemini', default: true },
  { value: 'gemini-3-pro-preview',   label: 'Gemini 3 Pro',           provider: 'gemini'  },
  { value: 'gemini-2.5-flash',       label: 'Gemini 2.5 Flash',       provider: 'gemini'  },
  { value: 'gemini-2.5-flash-lite',  label: 'Gemini 2.5 Flash Lite',  provider: 'gemini'  },
  { value: 'gemini-2.5-pro',         label: 'Gemini 2.5 Pro',         provider: 'gemini'  },

  // ── OpenAI ──
  { value: 'gpt-5.2',     label: 'GPT-5.2',       provider: 'openai' },
  { value: 'gpt-5.2-pro', label: 'GPT-5.2 Pro',   provider: 'openai' },
  { value: 'gpt-5.1',     label: 'GPT-5.1',       provider: 'openai' },
  { value: 'gpt-5',       label: 'GPT-5',         provider: 'openai' },
  { value: 'gpt-5-mini',  label: 'GPT-5 Mini',    provider: 'openai' },
  { value: 'gpt-5-nano',  label: 'GPT-5 Nano',    provider: 'openai' },
  { value: 'gpt-4.1',     label: 'GPT-4.1',       provider: 'openai' },
  { value: 'gpt-4.1-mini',label: 'GPT-4.1 Mini',  provider: 'openai' },
  { value: 'o3',           label: 'o3',            provider: 'openai' },
  { value: 'o4-mini',      label: 'o4-mini',       provider: 'openai' },

  // ── Anthropic ──
  { value: 'claude-opus-4-6',   label: 'Claude Opus 4.6',   provider: 'anthropic' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { value: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  provider: 'anthropic' },
];

export const DEFAULT_MODEL = MODELS.find(m => m.default)?.value ?? 'gemini-3-flash-preview';

/** Group models by provider for optgroup rendering */
export function getModelsByProvider(): Record<ModelProvider, ModelOption[]> {
  return {
    gemini:    MODELS.filter(m => m.provider === 'gemini'),
    openai:    MODELS.filter(m => m.provider === 'openai'),
    anthropic: MODELS.filter(m => m.provider === 'anthropic'),
  };
}

/** Verification models available for reasoning engine config */
export const VERIFICATION_MODELS = ['gemini-3-flash-preview', 'gpt-5-mini', 'claude-sonnet-4-6'] as const;

/** Check if a model value is recognized. Unrecognized = likely deprecated. */
export function isKnownModel(value: string): boolean {
  return MODELS.some(m => m.value === value);
}

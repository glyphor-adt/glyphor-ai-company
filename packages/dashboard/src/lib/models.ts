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
export type ReasoningLevel = 'none' | 'standard' | 'deep';

export interface ReasoningSupport {
  levels: ReasoningLevel[];
  defaultLevel: ReasoningLevel;
}

export interface ModelOption {
  value: string;
  label: string;
  provider: ModelProvider;
  inputPer1M?: number;
  outputPer1M?: number;
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
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro',         provider: 'gemini', inputPer1M: 2.00, outputPer1M: 12.0 },
  { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite', provider: 'gemini', inputPer1M: 0.25, outputPer1M: 1.50 },
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash',         provider: 'gemini', inputPer1M: 0.50, outputPer1M: 3.00 },
  { value: 'gemini-2.5-flash',   label: 'Gemini 2.5 Flash',    provider: 'gemini', inputPer1M: 0.30, outputPer1M: 2.50 },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', provider: 'gemini', inputPer1M: 0.10, outputPer1M: 0.40 },

  // ── OpenAI ──
  { value: 'gpt-5.4',     label: 'GPT-5.4',       provider: 'openai', inputPer1M: 2.50, outputPer1M: 15.0 },
  { value: 'gpt-5.4-pro', label: 'GPT-5.4 Pro',   provider: 'openai', inputPer1M: 30.0, outputPer1M: 180.0 },
  { value: 'model-router', label: 'Model Router (Foundry)', provider: 'openai', inputPer1M: 0.75, outputPer1M: 4.50, default: true },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini',  provider: 'openai', inputPer1M: 0.75, outputPer1M: 4.50 },
  { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano',  provider: 'openai', inputPer1M: 0.20, outputPer1M: 1.25 },
  { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', provider: 'openai', inputPer1M: 1.75, outputPer1M: 14.0 },
  { value: 'gpt-5.2',     label: 'GPT-5.2',       provider: 'openai', inputPer1M: 1.75, outputPer1M: 14.0 },
  { value: 'gpt-5.2-pro', label: 'GPT-5.2 Pro',   provider: 'openai', inputPer1M: 21.0, outputPer1M: 168.0 },
  { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', provider: 'openai', inputPer1M: 1.75, outputPer1M: 14.0 },
  { value: 'gpt-5.1',     label: 'GPT-5.1',       provider: 'openai', inputPer1M: 1.25, outputPer1M: 10.0 },
  { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', provider: 'openai', inputPer1M: 1.25, outputPer1M: 10.0 },
  { value: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini', provider: 'openai', inputPer1M: 0.75, outputPer1M: 6.00 },
  { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max', provider: 'openai', inputPer1M: 2.50, outputPer1M: 15.0 },
  { value: 'gpt-5',       label: 'GPT-5',         provider: 'openai', inputPer1M: 1.25, outputPer1M: 10.0 },
  { value: 'gpt-5-pro',   label: 'GPT-5 Pro',     provider: 'openai', inputPer1M: 15.0, outputPer1M: 120.0 },
  { value: 'gpt-5-codex', label: 'GPT-5 Codex',   provider: 'openai', inputPer1M: 1.25, outputPer1M: 10.0 },
  { value: 'gpt-5-mini',  label: 'GPT-5 Mini',    provider: 'openai', inputPer1M: 0.25, outputPer1M: 2.00 },
  { value: 'gpt-5-mini-2025-08-07', label: 'GPT-5 Mini (Aug 2025)', provider: 'openai', inputPer1M: 0.25, outputPer1M: 2.00 },
  { value: 'gpt-5-nano',  label: 'GPT-5 Nano',    provider: 'openai', inputPer1M: 0.05, outputPer1M: 0.40 },

  { value: 'o3',           label: 'o3',            provider: 'openai', inputPer1M: 2.00, outputPer1M: 8.00 },
  { value: 'o3-pro',       label: 'o3 Pro',        provider: 'openai', inputPer1M: 3.00, outputPer1M: 15.0 },
  { value: 'o4-mini',      label: 'o4-mini',       provider: 'openai', inputPer1M: 1.10, outputPer1M: 4.40 },
  { value: 'o3-deep-research',      label: 'o3 Deep Research',      provider: 'openai', inputPer1M: 2.00, outputPer1M: 8.00 },
  { value: 'o4-mini-deep-research', label: 'o4-mini Deep Research', provider: 'openai', inputPer1M: 1.10, outputPer1M: 4.40 },

  // ── Anthropic ──
  { value: 'claude-opus-4-6',   label: 'Claude Opus 4.6',   provider: 'anthropic', inputPer1M: 5.00, outputPer1M: 25.0 },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', inputPer1M: 3.00, outputPer1M: 15.0 },
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', provider: 'anthropic', inputPer1M: 3.00, outputPer1M: 15.0 },
  { value: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  provider: 'anthropic', inputPer1M: 1.00, outputPer1M: 5.00 },

];

export const DEFAULT_MODEL = MODELS.find(m => m.default)?.value ?? 'model-router';

/** Group models by provider for optgroup rendering */
export function getModelsByProvider(): Record<ModelProvider, ModelOption[]> {
  return {
    gemini:    MODELS.filter(m => m.provider === 'gemini'),
    openai:    MODELS.filter(m => m.provider === 'openai'),
    anthropic: MODELS.filter(m => m.provider === 'anthropic'),
  };
}

export function getModelLabel(value: string): string {
  return MODELS.find((model) => model.value === value)?.label ?? value;
}

export function getReasoningSupport(modelValue: string): ReasoningSupport {
  if (modelValue === 'model-router' || modelValue.startsWith('model-router')) {
    return { levels: ['none', 'standard', 'deep'], defaultLevel: 'standard' };
  }

  if (/^gpt-5\.[12]/.test(modelValue)) {
    return { levels: ['none', 'standard'], defaultLevel: 'standard' };
  }

  if (modelValue.startsWith('gpt-5') || /^o[134](-|$)/.test(modelValue)) {
    return { levels: ['standard', 'deep'], defaultLevel: 'standard' };
  }

  if (modelValue.startsWith('gemini-')) {
    return { levels: ['none', 'deep'], defaultLevel: 'deep' };
  }

  if (modelValue.startsWith('claude-')) {
    return { levels: ['none', 'deep'], defaultLevel: 'deep' };
  }

  return { levels: ['none', 'standard'], defaultLevel: 'standard' };
}

export function normalizeReasoningLevel(modelValue: string, requested?: ReasoningLevel): ReasoningLevel {
  const support = getReasoningSupport(modelValue);
  if (requested && support.levels.includes(requested)) {
    return requested;
  }
  return support.defaultLevel;
}

/** Verification models available for reasoning engine config */
export const VERIFICATION_MODELS = ['gpt-5.4-mini', 'gpt-5-mini', 'claude-sonnet-4-6'] as const;

/** Check if a model value is recognized. Unrecognized = likely deprecated. */
export function isKnownModel(value: string): boolean {
  return MODELS.some(m => m.value === value);
}

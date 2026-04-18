/**
 * Model Registry — Dashboard Frontend
 *
 * Derives available models from @glyphor/shared/models (single source of truth).
 * No manual duplication needed.
 */

import {
  SUPPORTED_MODELS,
  getSelectableModels,
  getSelectableModelsByProvider,
  resolveModel,
  type ModelDef,
  type ModelProvider,
} from '@glyphor/shared/models';

export type { ModelProvider };
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

export const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
};

function toModelOption(m: ModelDef): ModelOption {
  return {
    value: m.id,
    label: m.label,
    provider: m.provider,
    inputPer1M: m.inputPer1M,
    outputPer1M: m.outputPer1M,
    default: m.id === 'model-router' ? true : undefined,
  };
}

/**
 * All models available for agent assignment in the dashboard.
 * Derived from @glyphor/shared — no manual list to maintain.
 */
export const MODELS: ModelOption[] = getSelectableModels().map(toModelOption);

export const DEFAULT_MODEL = 'model-router';

/** Group models by provider for optgroup rendering */
export function getModelsByProvider(): Record<string, ModelOption[]> {
  const byProvider = getSelectableModelsByProvider();
  const result: Record<string, ModelOption[]> = {};
  for (const [provider, models] of Object.entries(byProvider)) {
    if (models.length > 0) {
      result[provider] = models.map(toModelOption);
    }
  }
  return result;
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
export const VERIFICATION_MODELS = ['gpt-5.4-mini', 'gpt-5-mini', 'gemini-3.1-flash-lite-preview'] as const;

/** Check if a model value is recognized. Unrecognized = likely deprecated. */
export function isKnownModel(value: string): boolean {
  return MODELS.some(m => m.value === value);
}

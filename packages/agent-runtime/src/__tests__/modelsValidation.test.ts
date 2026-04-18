import { describe, expect, it } from 'vitest';

import {
  SUPPORTED_MODELS,
  FALLBACK_CHAINS,
  DEPRECATED_MODELS,
  PROVIDER_LOCAL_FALLBACK_CHAINS,
  VERIFIER_MAP,
  resolveModel,
  getBedrockInferenceId,
} from '@glyphor/shared/models';
import { MODEL_CONFIG } from '@glyphor/shared';

describe('Model system invariants', () => {
  const allModelIds = new Set(SUPPORTED_MODELS.map(m => m.id));

  it('every model in a fallback chain exists in SUPPORTED_MODELS', () => {
    for (const [primary, chain] of Object.entries(FALLBACK_CHAINS)) {
      expect(allModelIds.has(primary), `primary "${primary}" not in SUPPORTED_MODELS`).toBe(true);
      for (const fallback of chain) {
        expect(allModelIds.has(fallback), `fallback "${fallback}" (in chain for "${primary}") not in SUPPORTED_MODELS`).toBe(true);
      }
    }
  });

  it('every provider-local chain entry exists', () => {
    for (const [primary, chain] of Object.entries(PROVIDER_LOCAL_FALLBACK_CHAINS)) {
      expect(allModelIds.has(primary), `primary "${primary}" not in SUPPORTED_MODELS`).toBe(true);
      for (const fallback of chain) {
        expect(allModelIds.has(fallback), `fallback "${fallback}" (in local chain for "${primary}") not in SUPPORTED_MODELS`).toBe(true);
      }
    }
  });

  it('every anthropic model has a bedrockId', () => {
    for (const m of SUPPORTED_MODELS) {
      if (m.provider === 'anthropic') {
        expect(m.bedrockId, `anthropic model "${m.id}" missing bedrockId`).toBeTruthy();
      }
    }
  });

  it('every deepseek model has a bedrockId', () => {
    for (const m of SUPPORTED_MODELS) {
      if (m.provider === 'deepseek') {
        expect(m.bedrockId, `deepseek model "${m.id}" missing bedrockId`).toBeTruthy();
      }
    }
  });

  it('every deprecated model resolves to a valid, non-deprecated model (no chains)', () => {
    for (const [old, replacement] of Object.entries(DEPRECATED_MODELS)) {
      expect(allModelIds.has(replacement), `"${old}" maps to "${replacement}" which is not in SUPPORTED_MODELS`).toBe(true);
      expect(DEPRECATED_MODELS[replacement], `"${old}" maps to "${replacement}" which is also deprecated (chain detected)`).toBeUndefined();
    }
  });

  it('resolveModel is idempotent', () => {
    for (const m of SUPPORTED_MODELS) {
      expect(resolveModel(m.id)).toBe(m.id);
    }
    for (const [old] of Object.entries(DEPRECATED_MODELS)) {
      const resolved = resolveModel(old);
      expect(resolveModel(resolved), `resolveModel not idempotent: "${old}" -> "${resolved}" -> "${resolveModel(resolved)}"`).toBe(resolved);
    }
  });

  it('every tier points to a valid model', () => {
    for (const [tier, modelId] of Object.entries(MODEL_CONFIG.tiers)) {
      expect(allModelIds.has(modelId), `tier "${tier}" points to "${modelId}" which is not in SUPPORTED_MODELS`).toBe(true);
    }
  });

  it('every specialized path points to a valid model or known purpose-specific model', () => {
    // Purpose-specific models (transcription, embeddings, voice, deep_research) are not in the
    // general SUPPORTED_MODELS catalog but are valid Azure Foundry / Gemini API models
    const PURPOSE_SPECIFIC = new Set(['transcription', 'embeddings', 'voice', 'deep_research']);
    for (const [path, modelId] of Object.entries(MODEL_CONFIG.specialized)) {
      if (PURPOSE_SPECIFIC.has(path)) continue;
      expect(allModelIds.has(modelId), `specialized "${path}" points to "${modelId}" which is not in SUPPORTED_MODELS`).toBe(true);
    }
  });

  it('every verifier map entry references valid models', () => {
    for (const [primary, verifier] of Object.entries(VERIFIER_MAP)) {
      expect(allModelIds.has(primary), `verifier primary "${primary}" not in SUPPORTED_MODELS`).toBe(true);
      expect(allModelIds.has(verifier), `verifier "${verifier}" (for "${primary}") not in SUPPORTED_MODELS`).toBe(true);
    }
  });

  it('no disabled model appears as a tier or specialized default', () => {
    const disabled = new Set(Object.keys(MODEL_CONFIG.disabled));
    for (const [tier, modelId] of Object.entries(MODEL_CONFIG.tiers)) {
      expect(disabled.has(modelId), `tier "${tier}" uses disabled model "${modelId}"`).toBe(false);
    }
    for (const [path, modelId] of Object.entries(MODEL_CONFIG.specialized)) {
      expect(disabled.has(modelId), `specialized "${path}" uses disabled model "${modelId}"`).toBe(false);
    }
  });

  it('high-tier fallback chains cross cloud boundaries', () => {
    const getProvider = (id: string) => SUPPORTED_MODELS.find(m => m.id === id)?.provider;
    // Only enforce cross-provider for premium/standard tier models.
    // Economy, reasoning, and router models may stay within one provider.
    const model = (id: string) => SUPPORTED_MODELS.find(m => m.id === id);
    for (const [primary, chain] of Object.entries(FALLBACK_CHAINS)) {
      const m = model(primary);
      if (!m || chain.length === 0) continue;
      if (m.tier === 'economy' || m.tier === 'reasoning' || m.tier === 'specialized') continue;
      const primaryProvider = getProvider(primary);
      const hasCrossProvider = chain.some(f => getProvider(f) !== primaryProvider);
      expect(hasCrossProvider, `chain for "${primary}" (tier: ${m.tier}) has no cross-provider fallback`).toBe(true);
    }
  });
});

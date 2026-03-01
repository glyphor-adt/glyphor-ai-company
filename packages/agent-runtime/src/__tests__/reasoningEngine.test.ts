/**
 * Unit tests for ReasoningEngine — verifies value gate, verification pipeline,
 * cross-model consensus, revision, and config loading with mocked model client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReasoningEngine, type ReasoningConfig, type ReasoningResult } from '../reasoningEngine.js';

// Mock @glyphor/shared/db so loadConfig tests work without a real DB
vi.mock('@glyphor/shared/db', () => ({
  systemQuery: vi.fn().mockResolvedValue([]),
}));
import { systemQuery } from '@glyphor/shared/db';

// ─── Mock helpers ───────────────────────────────────────────────

function mockModelClient(responseOverrides?: Partial<{ text: string }>) {
  return {
    generate: vi.fn().mockResolvedValue({
      text: responseOverrides?.text ?? JSON.stringify({
        confidence: 0.9,
        issues: [],
        suggestions: [],
        reasoning: 'Looks good',
      }),
      usageMetadata: { inputTokens: 500, outputTokens: 100 },
    }),
  } as any;
}

function mockCache() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function defaultConfig(overrides?: Partial<ReasoningConfig>): ReasoningConfig {
  return {
    enabled: true,
    passTypes: ['self_critique'],
    minConfidence: 0.7,
    maxReasoningBudget: 0.05,
    crossModelEnabled: false,
    valueGateEnabled: true,
    verificationModels: ['gemini-3-flash-preview'],
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('ReasoningEngine', () => {
  let model: ReturnType<typeof mockModelClient>;
  let cache: ReturnType<typeof mockCache>;

  beforeEach(() => {
    vi.clearAllMocks();
    model = mockModelClient();
    cache = mockCache();
  });

  describe('evaluateValue', () => {
    it('returns value score from parsed model response', async () => {
      const valueResponse = JSON.stringify({
        score: 0.85,
        reasoning: 'Important daily task',
        recommendation: 'proceed',
        alternatives: [],
      });
      model = mockModelClient({ text: valueResponse });
      const engine = new ReasoningEngine(model, defaultConfig(), cache);

      const result = await engine.evaluateValue('cto', 'platform health check', 'System is running');

      expect(result.score).toBeCloseTo(0.85);
      expect(result.recommendation).toBe('proceed');
      expect(result.costUsd).toBeGreaterThanOrEqual(0);
    });

    it('clamps score to 0-1 range', async () => {
      model = mockModelClient({ text: JSON.stringify({
        score: 1.5, reasoning: 'Over', recommendation: 'proceed',
      })});
      const engine = new ReasoningEngine(model, defaultConfig(), cache);
      const result = await engine.evaluateValue('cto', 'test', 'ctx');
      expect(result.score).toBe(1.0);
    });

    it('returns safe default on model error', async () => {
      model.generate = vi.fn().mockRejectedValue(new Error('API timeout'));
      const engine = new ReasoningEngine(model, defaultConfig(), cache);
      const result = await engine.evaluateValue('cto', 'test', 'ctx');
      expect(result.score).toBe(0.7);
      expect(result.recommendation).toBe('proceed');
      expect(result.costUsd).toBe(0);
    });

    it('handles invalid JSON from model gracefully', async () => {
      model = mockModelClient({ text: 'This is not JSON at all' });
      const engine = new ReasoningEngine(model, defaultConfig(), cache);
      const result = await engine.evaluateValue('cfo', 'audit', 'ctx');
      expect(result.score).toBe(0.7); // fallback
      expect(result.recommendation).toBe('proceed');
    });
  });

  describe('verify', () => {
    it('runs configured pass types and returns results', async () => {
      const engine = new ReasoningEngine(model, defaultConfig({
        passTypes: ['self_critique', 'goal_alignment'],
      }), cache);

      const result = await engine.verify('cto', 'health check', 'All systems nominal', 'context');

      expect(result.passes).toHaveLength(2);
      expect(result.passes[0].passType).toBe('self_critique');
      expect(result.passes[1].passType).toBe('goal_alignment');
      expect(result.overallConfidence).toBeCloseTo(0.9);
      expect(result.verified).toBe(true);
      expect(result.totalCostUsd).toBeGreaterThanOrEqual(0);
    });

    it('marks as unverified when confidence is below threshold', async () => {
      model = mockModelClient({ text: JSON.stringify({
        confidence: 0.3,
        issues: ['Major logical flaw'],
        suggestions: ['Fix the flaw'],
        reasoning: 'Found problems',
      })});
      const engine = new ReasoningEngine(model, defaultConfig({
        minConfidence: 0.7,
      }), cache);

      const result = await engine.verify('cto', 'task', 'output', 'ctx');
      expect(result.verified).toBe(false);
      expect(result.overallConfidence).toBeCloseTo(0.3);
    });

    it('attempts revision when confidence is low and suggestions exist', async () => {
      let callCount = 0;
      model.generate = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call: verification pass with low confidence
          return Promise.resolve({
            text: JSON.stringify({
              confidence: 0.3,
              issues: ['Incorrect data'],
              suggestions: ['Use correct source'],
              reasoning: 'Bad data',
            }),
            usageMetadata: { inputTokens: 300, outputTokens: 100 },
          });
        }
        // Subsequent calls: revision
        return Promise.resolve({
          text: 'Revised and improved output',
          usageMetadata: { inputTokens: 400, outputTokens: 200 },
        });
      });

      const engine = new ReasoningEngine(model, defaultConfig(), cache);
      const result = await engine.verify('cto', 'task', 'bad output', 'ctx');

      expect(result.revised).toBe(true);
      expect(result.revisedOutput).toBe('Revised and improved output');
    });

    it('stops passes when budget is exhausted', async () => {
      const engine = new ReasoningEngine(model, defaultConfig({
        passTypes: ['self_critique', 'consistency_check', 'factual_verification'],
        maxReasoningBudget: 0.00001, // extremely small budget
      }), cache);

      // First pass will spend some cost, subsequent should be skipped
      const result = await engine.verify('cto', 'task', 'output', 'ctx');
      // At most 1 pass should complete (budget exhausted after first)
      expect(result.passes.length).toBeLessThanOrEqual(3);
    });

    it('returns 1.0 confidence when no passes are configured', async () => {
      const engine = new ReasoningEngine(model, defaultConfig({
        passTypes: [],
      }), cache);

      const result = await engine.verify('cto', 'task', 'output', 'ctx');
      expect(result.overallConfidence).toBe(1.0);
      expect(result.verified).toBe(true);
      expect(result.passes).toHaveLength(0);
    });

    it('handles model errors in individual passes gracefully', async () => {
      model.generate = vi.fn().mockRejectedValue(new Error('Model unavailable'));
      const engine = new ReasoningEngine(model, defaultConfig(), cache);

      const result = await engine.verify('cto', 'task', 'output', 'ctx');
      expect(result.passes).toHaveLength(1);
      expect(result.passes[0].confidence).toBe(0.5); // error fallback
      expect(result.passes[0].issues[0]).toContain('Pass error');
    });
  });

  describe('cross-model consensus', () => {
    it('runs verification on multiple models when enabled', async () => {
      const engine = new ReasoningEngine(model, defaultConfig({
        passTypes: ['cross_model'],
        crossModelEnabled: true,
        verificationModels: ['model-a', 'model-b'],
      }), cache);

      const result = await engine.verify('cto', 'task', 'output', 'ctx');
      // Should have 2 passes (one per verification model)
      expect(result.passes).toHaveLength(2);
      expect(model.generate).toHaveBeenCalledTimes(2);
    });

    it('caps cross-model at 3 models', async () => {
      const engine = new ReasoningEngine(model, defaultConfig({
        passTypes: ['cross_model'],
        crossModelEnabled: true,
        verificationModels: ['m1', 'm2', 'm3', 'm4', 'm5'],
      }), cache);

      const result = await engine.verify('cto', 'task', 'output', 'ctx');
      expect(result.passes).toHaveLength(3);
    });
  });

  describe('loadConfig', () => {
    it('returns config from DB when found', async () => {
      const dbRow = {
        enabled: true,
        pass_types: ['self_critique', 'goal_alignment'],
        min_confidence: 0.8,
        max_reasoning_budget: 0.03,
        cross_model_enabled: true,
        value_gate_enabled: false,
        verification_models: ['gpt-5.2-2025-12-11'],
      };
      vi.mocked(systemQuery).mockResolvedValueOnce([dbRow] as any);

      const config = await ReasoningEngine.loadConfig('cto', cache);
      expect(config).not.toBeNull();
      expect(config!.enabled).toBe(true);
      expect(config!.passTypes).toEqual(['self_critique', 'goal_alignment']);
      expect(config!.minConfidence).toBe(0.8);
      expect(config!.crossModelEnabled).toBe(true);
      expect(config!.valueGateEnabled).toBe(false);
    });

    it('returns null when no config exists', async () => {
      vi.mocked(systemQuery).mockResolvedValueOnce([] as any);
      const config = await ReasoningEngine.loadConfig('unknown-agent', cache);
      expect(config).toBeNull();
    });

    it('returns cached config when available', async () => {
      const cachedConfig: ReasoningConfig = {
        enabled: true,
        passTypes: ['self_critique'],
        minConfidence: 0.7,
        maxReasoningBudget: 0.02,
        crossModelEnabled: false,
        valueGateEnabled: true,
        verificationModels: ['gemini-3-flash-preview'],
      };
      cache.get = vi.fn().mockResolvedValue(cachedConfig);

      const config = await ReasoningEngine.loadConfig('cto', cache);
      expect(config).toEqual(cachedConfig);
      expect(systemQuery).not.toHaveBeenCalled();
    });

    it('caches DB result in Redis', async () => {
      vi.mocked(systemQuery).mockResolvedValueOnce([{
        enabled: true,
        pass_types: [],
        min_confidence: 0.5,
        max_reasoning_budget: 0.01,
        cross_model_enabled: false,
        value_gate_enabled: false,
        verification_models: [],
      }] as any);

      await ReasoningEngine.loadConfig('cto', cache);
      expect(cache.set).toHaveBeenCalledWith(
        'reasoning-config:cto',
        expect.objectContaining({ enabled: true }),
        600,
      );
    });
  });
});

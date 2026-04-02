import { describe, expect, it } from 'vitest';
import {
  getJitSelectionConfigFromEnv,
  selectJitItems,
  type JitSelectionConfig,
} from '../memory/jitContextSelector.js';
import type { JitContextItem } from '../jitContextRetriever.js';

const ENABLED_CONFIG: JitSelectionConfig = {
  enabled: true,
  maxSelectedItems: 5,
  maxPerSource: 2,
  staleDaysThreshold: 30,
  veryStaleDaysThreshold: 90,
  stalePenaltyMultiplier: 0.9,
  veryStalePenaltyMultiplier: 0.75,
};

describe('jitContextSelector', () => {
  it('parses selector config from env', () => {
    const cfg = getJitSelectionConfigFromEnv({
      JIT_SELECTOR_ENABLED: 'true',
      JIT_SELECTOR_MAX_ITEMS: '4',
      JIT_SELECTOR_MAX_PER_SOURCE: '1',
      JIT_SELECTOR_STALE_DAYS_THRESHOLD: '20',
      JIT_SELECTOR_VERY_STALE_DAYS_THRESHOLD: '80',
      JIT_SELECTOR_STALE_PENALTY_MULTIPLIER: '0.85',
      JIT_SELECTOR_VERY_STALE_PENALTY_MULTIPLIER: '0.6',
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.maxSelectedItems).toBe(4);
    expect(cfg.maxPerSource).toBe(1);
    expect(cfg.staleDaysThreshold).toBe(20);
    expect(cfg.veryStaleDaysThreshold).toBe(80);
    expect(cfg.stalePenaltyMultiplier).toBe(0.85);
    expect(cfg.veryStalePenaltyMultiplier).toBe(0.6);
  });

  it('respects per-source cap then fills remaining slots', () => {
    const items: JitContextItem[] = [
      { source: 'memory', content: 'm1', score: 0.98 },
      { source: 'memory', content: 'm2', score: 0.96 },
      { source: 'memory', content: 'm3', score: 0.95 },
      { source: 'procedure', content: 'p1', score: 0.94 },
      { source: 'graph', content: 'g1', score: 0.93 },
      { source: 'knowledge', content: 'k1', score: 0.92 },
    ];

    const selected = selectJitItems(items, { ...ENABLED_CONFIG, maxSelectedItems: 4, maxPerSource: 1 });
    const memoryCount = selected.filter((item) => item.source === 'memory').length;
    expect(selected).toHaveLength(4);
    expect(memoryCount).toBe(1);
  });

  it('returns all items when selector disabled', () => {
    const items: JitContextItem[] = [
      { source: 'memory', content: 'm1', score: 0.8 },
      { source: 'graph', content: 'g1', score: 0.7 },
    ];
    const selected = selectJitItems(items, { ...ENABLED_CONFIG, enabled: false });
    expect(selected).toEqual(items);
  });

  it('down-ranks stale items when freshness metadata is available', () => {
    const nowIso = new Date().toISOString();
    const staleIso = new Date(Date.now() - 120 * 86_400_000).toISOString();
    const items: JitContextItem[] = [
      {
        source: 'memory',
        content: 'old but high raw score',
        score: 1.0,
        metadata: { updatedAt: staleIso },
      },
      {
        source: 'knowledge',
        content: 'recent slightly lower raw score',
        score: 0.95,
        metadata: { updatedAt: nowIso },
      },
    ];

    const selected = selectJitItems(items, {
      ...ENABLED_CONFIG,
      maxSelectedItems: 1,
      maxPerSource: 1,
      staleDaysThreshold: 30,
      veryStaleDaysThreshold: 90,
      stalePenaltyMultiplier: 0.9,
      veryStalePenaltyMultiplier: 0.6,
    });

    expect(selected).toHaveLength(1);
    expect(selected[0].content).toContain('recent slightly lower raw score');
  });
});


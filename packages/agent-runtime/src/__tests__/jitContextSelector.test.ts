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
};

describe('jitContextSelector', () => {
  it('parses selector config from env', () => {
    const cfg = getJitSelectionConfigFromEnv({
      JIT_SELECTOR_ENABLED: 'true',
      JIT_SELECTOR_MAX_ITEMS: '4',
      JIT_SELECTOR_MAX_PER_SOURCE: '1',
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.maxSelectedItems).toBe(4);
    expect(cfg.maxPerSource).toBe(1);
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
});


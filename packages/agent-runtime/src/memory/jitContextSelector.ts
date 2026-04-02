import type { JitContextItem } from '../jitContextRetriever.js';

export interface JitSelectionConfig {
  enabled: boolean;
  maxSelectedItems: number;
  maxPerSource: number;
}

const DEFAULT_MAX_SELECTED_ITEMS = 5;
const DEFAULT_MAX_PER_SOURCE = 2;

function parseIntWithDefault(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function getJitSelectionConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): JitSelectionConfig {
  return {
    enabled: isTruthy(env.JIT_SELECTOR_ENABLED),
    maxSelectedItems: parseIntWithDefault(
      env.JIT_SELECTOR_MAX_ITEMS,
      DEFAULT_MAX_SELECTED_ITEMS,
    ),
    maxPerSource: parseIntWithDefault(
      env.JIT_SELECTOR_MAX_PER_SOURCE,
      DEFAULT_MAX_PER_SOURCE,
    ),
  };
}

export function selectJitItems(
  items: JitContextItem[],
  config: JitSelectionConfig,
): JitContextItem[] {
  if (!config.enabled || items.length === 0) return items;

  const sorted = [...items].sort((left, right) => right.score - left.score);
  const selected: JitContextItem[] = [];
  const perSourceCount = new Map<JitContextItem['source'], number>();

  for (const item of sorted) {
    if (selected.length >= config.maxSelectedItems) break;
    const sourceCount = perSourceCount.get(item.source) ?? 0;
    if (sourceCount >= config.maxPerSource) continue;
    perSourceCount.set(item.source, sourceCount + 1);
    selected.push(item);
  }

  // Fill any remaining slots with best leftovers regardless of source caps.
  if (selected.length < config.maxSelectedItems) {
    for (const item of sorted) {
      if (selected.length >= config.maxSelectedItems) break;
      if (selected.includes(item)) continue;
      selected.push(item);
    }
  }

  return selected;
}


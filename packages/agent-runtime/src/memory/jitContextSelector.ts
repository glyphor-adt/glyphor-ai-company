import type { JitContextItem } from '../jitContextRetriever.js';

export interface JitSelectionConfig {
  enabled: boolean;
  maxSelectedItems: number;
  maxPerSource: number;
  staleDaysThreshold: number;
  veryStaleDaysThreshold: number;
  stalePenaltyMultiplier: number;
  veryStalePenaltyMultiplier: number;
}

export type JitFreshnessBucket = 'fresh' | 'stale' | 'very_stale' | 'unknown';

const DEFAULT_MAX_SELECTED_ITEMS = 5;
const DEFAULT_MAX_PER_SOURCE = 2;
const DEFAULT_STALE_DAYS_THRESHOLD = 30;
const DEFAULT_VERY_STALE_DAYS_THRESHOLD = 90;
const DEFAULT_STALE_PENALTY_MULTIPLIER = 0.9;
const DEFAULT_VERY_STALE_PENALTY_MULTIPLIER = 0.75;

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

function parseFloatWithDefault(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

function resolveUpdatedTimestamp(item: JitContextItem): string | null {
  const metadata = item.metadata ?? {};
  const raw = metadata.updatedAt
    ?? metadata.updated_at
    ?? metadata.createdAt
    ?? metadata.created_at
    ?? metadata.timestamp;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
}

function resolveFreshnessBucket(
  item: JitContextItem,
  config: JitSelectionConfig,
): JitFreshnessBucket {
  const timestamp = resolveUpdatedTimestamp(item);
  if (!timestamp) return 'unknown';
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return 'unknown';
  const ageDays = Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
  if (ageDays >= config.veryStaleDaysThreshold) {
    return 'very_stale';
  }
  if (ageDays >= config.staleDaysThreshold) {
    return 'stale';
  }
  return 'fresh';
}

function resolveFreshnessMultiplier(
  item: JitContextItem,
  config: JitSelectionConfig,
): number {
  const bucket = resolveFreshnessBucket(item, config);
  if (bucket === 'very_stale') return config.veryStalePenaltyMultiplier;
  if (bucket === 'stale') return config.stalePenaltyMultiplier;
  return 1;
}

function getAdjustedScore(item: JitContextItem, config: JitSelectionConfig): number {
  return item.score * resolveFreshnessMultiplier(item, config);
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
    staleDaysThreshold: parseIntWithDefault(
      env.JIT_SELECTOR_STALE_DAYS_THRESHOLD,
      DEFAULT_STALE_DAYS_THRESHOLD,
    ),
    veryStaleDaysThreshold: parseIntWithDefault(
      env.JIT_SELECTOR_VERY_STALE_DAYS_THRESHOLD,
      DEFAULT_VERY_STALE_DAYS_THRESHOLD,
    ),
    stalePenaltyMultiplier: parseFloatWithDefault(
      env.JIT_SELECTOR_STALE_PENALTY_MULTIPLIER,
      DEFAULT_STALE_PENALTY_MULTIPLIER,
    ),
    veryStalePenaltyMultiplier: parseFloatWithDefault(
      env.JIT_SELECTOR_VERY_STALE_PENALTY_MULTIPLIER,
      DEFAULT_VERY_STALE_PENALTY_MULTIPLIER,
    ),
  };
}

export function selectJitItems(
  items: JitContextItem[],
  config: JitSelectionConfig,
): JitContextItem[] {
  if (!config.enabled || items.length === 0) return items;

  const sorted = [...items].sort((left, right) => {
    const scoreDelta = getAdjustedScore(right, config) - getAdjustedScore(left, config);
    if (scoreDelta !== 0) return scoreDelta;
    return right.score - left.score;
  });
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

export function summarizeFreshnessBuckets(
  items: JitContextItem[],
  config: JitSelectionConfig,
): Record<JitFreshnessBucket, number> {
  const summary: Record<JitFreshnessBucket, number> = {
    fresh: 0,
    stale: 0,
    very_stale: 0,
    unknown: 0,
  };
  for (const item of items) {
    summary[resolveFreshnessBucket(item, config)] += 1;
  }
  return summary;
}


import type { ModelProvider, RequestSource } from './providers/types.js';

export interface CompactionMetadata {
  occurred: boolean;
  count: number;
  summary?: string;
}

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const ANTHROPIC_COMPACTION_BETA = 'compact-2026-01-12';

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function isCompactionEnabled(): boolean {
  const value = process.env.COMPACTION_ENABLED?.trim().toLowerCase();
  return value ? TRUTHY_VALUES.has(value) : false;
}

export function shouldUseServerSideCompaction(provider: ModelProvider, source?: RequestSource): boolean {
  return isCompactionEnabled()
    && source === 'on_demand'
    && (provider === 'openai' || provider === 'anthropic');
}

export function shouldUseClientSideHistoryCompression(provider: ModelProvider, source?: RequestSource): boolean {
  return !shouldUseServerSideCompaction(provider, source);
}

export function buildOpenAIContextManagement(source?: RequestSource): Array<Record<string, unknown>> | undefined {
  if (!shouldUseServerSideCompaction('openai', source)) return undefined;

  const threshold = parsePositiveInt(process.env.OPENAI_COMPACTION_THRESHOLD);
  return [{
    type: 'compaction',
    ...(threshold ? { compact_threshold: threshold } : {}),
  }];
}

export function buildAnthropicContextManagement(source?: RequestSource): Record<string, unknown> | undefined {
  if (!shouldUseServerSideCompaction('anthropic', source)) return undefined;

  const trigger = parsePositiveInt(process.env.ANTHROPIC_COMPACTION_TRIGGER_TOKENS);
  return {
    edits: [{ type: 'compact_20260112' }],
    ...(trigger && trigger >= 50_000 ? { trigger } : {}),
  };
}

export function getAnthropicCompactionBetas(source?: RequestSource): string[] | undefined {
  if (!shouldUseServerSideCompaction('anthropic', source)) return undefined;
  return [ANTHROPIC_COMPACTION_BETA];
}

export function extractOpenAICompactionMetadata(response: unknown): CompactionMetadata | undefined {
  const output = Array.isArray((response as { output?: unknown[] } | undefined)?.output)
    ? ((response as { output: unknown[] }).output)
    : [];
  const compactionItems = output.filter((item): item is Record<string, unknown> =>
    Boolean(item)
      && typeof item === 'object'
      && (item as { type?: unknown }).type === 'compaction',
  );

  if (compactionItems.length === 0) return undefined;

  const summary = [...compactionItems]
    .reverse()
    .map((item) => {
      if (typeof item.summary === 'string') return item.summary;
      if (typeof item.text === 'string') return item.text;
      return undefined;
    })
    .find((value): value is string => Boolean(value));

  return {
    occurred: true,
    count: compactionItems.length,
    summary,
  };
}

export function extractAnthropicCompactionMetadata(response: unknown): CompactionMetadata | undefined {
  const content = Array.isArray((response as { content?: unknown[] } | undefined)?.content)
    ? ((response as { content: unknown[] }).content)
    : [];
  const compactionBlocks = content.filter((block): block is Record<string, unknown> =>
    Boolean(block)
      && typeof block === 'object'
      && (block as { type?: unknown }).type === 'compaction',
  );

  if (compactionBlocks.length === 0) return undefined;

  const summary = [...compactionBlocks]
    .reverse()
    .map((block) => {
      if (typeof block.summary === 'string') return block.summary;
      if (typeof block.text === 'string') return block.text;
      return undefined;
    })
    .find((value): value is string => Boolean(value));

  return {
    occurred: true,
    count: compactionBlocks.length,
    summary,
  };
}

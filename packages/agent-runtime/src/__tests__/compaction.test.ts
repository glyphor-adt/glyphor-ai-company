import { afterEach, describe, expect, it } from 'vitest';
import {
  buildAnthropicContextManagement,
  buildOpenAIContextManagement,
  extractAnthropicCompactionMetadata,
  extractOpenAICompactionMetadata,
  shouldUseServerSideCompaction,
} from '../compaction.js';

const originalCompactionEnabled = process.env.COMPACTION_ENABLED;

describe('compaction helpers', () => {
  afterEach(() => {
    if (originalCompactionEnabled === undefined) {
      delete process.env.COMPACTION_ENABLED;
    } else {
      process.env.COMPACTION_ENABLED = originalCompactionEnabled;
    }
    delete process.env.OPENAI_COMPACTION_THRESHOLD;
    delete process.env.ANTHROPIC_COMPACTION_TRIGGER_TOKENS;
  });

  it('only enables server-side compaction for on-demand OpenAI and Anthropic runs', () => {
    process.env.COMPACTION_ENABLED = 'true';

    expect(shouldUseServerSideCompaction('openai', 'on_demand')).toBe(true);
    expect(shouldUseServerSideCompaction('anthropic', 'on_demand')).toBe(true);
    expect(shouldUseServerSideCompaction('gemini', 'on_demand')).toBe(false);
    expect(shouldUseServerSideCompaction('openai', 'scheduled')).toBe(false);
  });

  it('builds provider request payloads only when the feature flag is enabled', () => {
    expect(buildOpenAIContextManagement('on_demand')).toBeUndefined();
    expect(buildAnthropicContextManagement('on_demand')).toBeUndefined();

    process.env.COMPACTION_ENABLED = 'true';
    process.env.OPENAI_COMPACTION_THRESHOLD = '6000';
    process.env.ANTHROPIC_COMPACTION_TRIGGER_TOKENS = '50000';

    expect(buildOpenAIContextManagement('on_demand')).toEqual([
      { type: 'compaction', compact_threshold: 6000 },
    ]);
    expect(buildAnthropicContextManagement('on_demand')).toEqual({
      edits: [{ type: 'compact_20260112' }],
      trigger: 50000,
    });
  });

  it('extracts OpenAI compaction metadata from Responses API output items', () => {
    expect(
      extractOpenAICompactionMetadata({
        output: [
          { type: 'message', content: [] },
          { type: 'compaction', summary: 'Earlier context was summarized.' },
        ],
      }),
    ).toEqual({
      occurred: true,
      count: 1,
      summary: 'Earlier context was summarized.',
    });
  });

  it('extracts Anthropic compaction metadata from compaction blocks', () => {
    expect(
      extractAnthropicCompactionMetadata({
        content: [
          { type: 'compaction', summary: 'Prior turns were compacted.' },
          { type: 'text', text: 'Continuing with the latest request.' },
        ],
      }),
    ).toEqual({
      occurred: true,
      count: 1,
      summary: 'Prior turns were compacted.',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { compressComposedHistory } from '../context/historyCompressor.js';
import type { ConversationTurn } from '../types.js';

describe('compressComposedHistory — quick_demo_web_app', () => {
  it('does not clip successful quick_demo tool_result to ~1.8k chars', () => {
    const longHtml = `<!DOCTYPE html><html><body>${'z'.repeat(12_000)}</body></html>`;
    const content = JSON.stringify({
      format: 'single_file_html',
      html_document: longHtml,
      char_count: longHtml.length,
    });
    const history: ConversationTurn[] = [
      {
        role: 'user',
        content: '[CONTEXT — test frame]',
        timestamp: 1,
      },
      { role: 'user', content: 'Build a weather app', timestamp: 2 },
      {
        role: 'tool_call',
        content: '{"description":"weather"}',
        toolName: 'quick_demo_web_app',
        timestamp: 3,
      },
      {
        role: 'tool_result',
        content,
        toolName: 'quick_demo_web_app',
        toolResult: { success: true, data: JSON.parse(content) },
        timestamp: 4,
      },
    ];

    const { history: out } = compressComposedHistory(history, { maxTokens: 50_000 });
    const tr = out.find((t) => t.role === 'tool_result' && t.toolName === 'quick_demo_web_app');
    expect(tr).toBeDefined();
    expect(tr!.content.length).toBeGreaterThan(10_000);
    expect(tr!.content).toContain(longHtml.slice(0, 100));
  });
});

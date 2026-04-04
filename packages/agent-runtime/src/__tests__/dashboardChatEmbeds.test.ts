import { describe, expect, it } from 'vitest';
import { extractDashboardChatEmbedsFromHistory } from '../dashboardChatEmbeds.js';
import type { ConversationTurn } from '../types.js';

describe('extractDashboardChatEmbedsFromHistory', () => {
  it('extracts preview_url from last invoke_web_build in the current user segment', () => {
    const history: ConversationTurn[] = [
      { role: 'user', content: 'older', timestamp: 1 },
      { role: 'assistant', content: 'old reply', timestamp: 2 },
      { role: 'user', content: 'build me a site', timestamp: 3 },
      {
        role: 'tool_call',
        content: '{}',
        toolName: 'invoke_web_build',
        timestamp: 4,
      },
      {
        role: 'tool_result',
        content: '{}',
        toolName: 'invoke_web_build',
        toolResult: {
          success: true,
          data: {
            preview_url: 'https://acme-abc123.vercel.app',
            deploy_url: 'https://acme.preview.glyphor.ai',
          },
        },
        timestamp: 5,
      },
      { role: 'assistant', content: 'Done.', timestamp: 6 },
    ];

    const embeds = extractDashboardChatEmbedsFromHistory(history);
    expect(embeds).toEqual([
      { kind: 'iframe_preview', url: 'https://acme-abc123.vercel.app/', label: 'Live preview' },
    ]);
  });

  it('uses latest_preview_url for invoke_web_coding_loop', () => {
    const history: ConversationTurn[] = [
      { role: 'user', content: 'improve it', timestamp: 1 },
      {
        role: 'tool_result',
        content: '{}',
        toolName: 'invoke_web_coding_loop',
        toolResult: {
          success: true,
          data: {
            latest_preview_url: 'https://proj-git-main-org.vercel.app',
            latest_deploy_url: 'https://proj.preview.glyphor.ai',
          },
        },
        timestamp: 2,
      },
      { role: 'assistant', content: 'Updated.', timestamp: 3 },
    ];

    const embeds = extractDashboardChatEmbedsFromHistory(history);
    expect(embeds[0]?.url).toBe('https://proj-git-main-org.vercel.app/');
  });
});

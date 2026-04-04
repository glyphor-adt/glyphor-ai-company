import type { ConversationTurn } from './types.js';
import type { DashboardChatEmbed } from './types.js';

const WEB_PREVIEW_TOOLS = new Set([
  'invoke_web_build',
  'invoke_web_iterate',
  'invoke_web_upgrade',
  'invoke_web_coding_loop',
]);

function readHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t.startsWith('https://')) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

function primaryPreviewFromToolData(
  toolName: string,
  data: Record<string, unknown>,
): string | null {
  if (toolName === 'invoke_web_coding_loop') {
    return (
      readHttpsUrl(data.latest_preview_url)
      ?? readHttpsUrl(data.latest_deploy_url)
    );
  }
  return readHttpsUrl(data.preview_url) ?? readHttpsUrl(data.deploy_url);
}

/**
 * Collect the latest successful web preview URL from the current user-turn segment
 * (walking backward from the end of history until the preceding `user` message).
 * Used only by the dashboard to render an iframe; Teams/Slack stay text-only.
 */
export function extractDashboardChatEmbedsFromHistory(history: ConversationTurn[]): DashboardChatEmbed[] {
  let lastUrl: string | null = null;

  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i];
    if (t.role === 'user') break;

    if (t.role !== 'tool_result' || !t.toolName || !WEB_PREVIEW_TOOLS.has(t.toolName)) continue;
    if (!t.toolResult?.success || t.toolResult.data == null) continue;
    const data = t.toolResult.data;
    if (typeof data !== 'object' || Array.isArray(data)) continue;

    const url = primaryPreviewFromToolData(t.toolName, data as Record<string, unknown>);
    if (url) lastUrl = url;
  }

  if (!lastUrl) return [];
  return [{ kind: 'iframe_preview', url: lastUrl, label: 'Live preview' }];
}

/**
 * MCP Email Server — Tool Definitions
 *
 * Three tools:
 *   send_email     — Send email from the agent's shared mailbox
 *   read_inbox     — Read messages from the agent's inbox
 *   reply_to_email — Reply to a message in the agent's inbox
 *
 * Each tool handler receives `agentRole` from the request context
 * (passed via X-Agent-Role header or extracted from auth token).
 */

import { getGraphToken } from './graphClient.js';
import { getAgentEmail, FOUNDER_CC, type AgentEmailEntry } from './emailConfig.js';

// ── Markdown Stripping ─────────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(?<![\w*])\*([^*]+)\*(?![\w*])/g, '$1')
    .replace(/(?<![\w_])_([^_]+)_(?![\w_])/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```\w*\n?/g, '').trim())
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*_]{3,}$/gm, '');
}

// ── HTML Email Formatting ──────────────────────────────────────

function formatEmailHtml(body: string, agent: AgentEmailEntry): string {
  if (body.trim().toLowerCase().startsWith('<!doctype') || body.trim().toLowerCase().startsWith('<html')) {
    return body;
  }

  const cleanBody = stripMarkdown(body);
  const hasHtml = /<[a-z][\s\S]*>/i.test(cleanBody);
  const formattedBody = hasHtml ? cleanBody : cleanBody.replace(/\n/g, '<br>');

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; color: #1a1a1a; line-height: 1.6;">
  ${formattedBody}
  <br>
  <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e0e0e0;">
    <strong style="color: #1a1a1a;">${agent.displayName}</strong><br>
    <span style="color: #555;">${agent.title}</span><br>
    <span style="color: #555;">Glyphor AI</span><br>
    <a href="mailto:${agent.email}" style="color: #0066cc; text-decoration: none;">${agent.email}</a>
  </div>
</div>`;
}

// ── Tool Interface ─────────────────────────────────────────────

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; items?: { type: string }; enum?: string[] }>;
    required?: string[];
  };
  handler: (params: Record<string, unknown>, agentRole: string) => Promise<unknown>;
}

// ── Tool Definitions ───────────────────────────────────────────

export const tools: McpToolDef[] = [
  /* ── send_email ──────────────────────── */
  {
    name: 'send_email',
    description:
      'Send an email from YOUR mailbox (e.g. sarah@glyphor.ai). Always YELLOW — requires founder approval before sending. Write the message body only — your signature is added automatically. Format the body like a real email: greeting, concise content, professional sign-off. NEVER use markdown formatting (no **, ##, `, ~~, bullet markers, or []() links) — write in plain professional prose.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'array', description: 'Recipient email addresses', items: { type: 'string' } },
        subject: { type: 'string', description: 'Email subject line' },
        body: {
          type: 'string',
          description:
            'Email body in plain professional prose. Do NOT use markdown formatting — no **, ##, `, or []() syntax. Write like a human composing a normal email.',
        },
        cc: { type: 'array', description: 'CC email addresses (optional)', items: { type: 'string' } },
        importance: { type: 'string', description: 'Email importance', enum: ['low', 'normal', 'high'] },
      },
      required: ['to', 'subject', 'body'],
    },

    async handler(params, agentRole) {
      const token = await getGraphToken();
      const agent = getAgentEmail(agentRole);

      const toAddrs = (params.to as string[]).map((email) => ({
        emailAddress: { address: email },
      }));

      // Merge agent-specified CCs with founder CCs (deduped)
      const agentCc = params.cc ? (params.cc as string[]) : [];
      const allCc = [...new Set([...agentCc, ...FOUNDER_CC])];
      const toSet = new Set((params.to as string[]).map((e) => e.toLowerCase()));
      const ccRecipients = allCc
        .filter((e) => !toSet.has(e.toLowerCase()))
        .map((email) => ({ emailAddress: { address: email } }));

      const payload = {
        message: {
          subject: params.subject as string,
          body: { contentType: 'HTML', content: formatEmailHtml(params.body as string, agent) },
          toRecipients: toAddrs,
          ...(ccRecipients.length > 0 && { ccRecipients }),
          importance: (params.importance as string) ?? 'normal',
        },
        saveToSentItems: true,
      };

      const response = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(agent.email)}/sendMail`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to send email (${response.status}): ${text}`);
      }

      return { sent: true, from: agent.email, to: params.to, subject: params.subject };
    },
  },

  /* ── read_inbox ──────────────────────── */
  {
    name: 'read_inbox',
    description:
      'Check YOUR email inbox for new messages. GREEN — agents can always read their own mailbox. Returns unread messages by default.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max messages to return (default: 10, max 50)' },
        from_filter: { type: 'string', description: 'Only show messages from addresses containing this string' },
        include_read: { type: 'string', description: 'Include already-read messages (default: false). Pass "true" to include.' },
        mark_as_read: { type: 'string', description: 'Mark returned messages as read (default: false). Pass "true" to mark.' },
      },
    },

    async handler(params, agentRole) {
      const token = await getGraphToken();
      const agent = getAgentEmail(agentRole);

      const limit = Math.min(typeof params.limit === 'number' ? params.limit : 10, 50);
      const includeRead = params.include_read === 'true' || params.include_read === true;
      const markAsRead = params.mark_as_read === 'true' || params.mark_as_read === true;

      const queryParams = new URLSearchParams({
        $top: String(limit),
        $select: 'id,subject,from,receivedDateTime,bodyPreview,isRead,hasAttachments',
        $orderby: 'receivedDateTime desc',
      });

      const filters: string[] = [];
      if (!includeRead) {
        filters.push('isRead eq false');
      }
      if (params.from_filter) {
        const safe = (params.from_filter as string).replace(/'/g, "''");
        filters.push(`contains(from/emailAddress/address, '${safe}')`);
      }
      if (filters.length > 0) {
        queryParams.set('$filter', filters.join(' and '));
      }

      const response = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(agent.email)}/mailFolders/inbox/messages?${queryParams.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to read inbox (${response.status}): ${text}`);
      }

      interface GraphMessage {
        id: string;
        subject: string;
        from: { emailAddress: { address: string; name: string } };
        receivedDateTime: string;
        bodyPreview: string;
        isRead: boolean;
        hasAttachments: boolean;
      }
      const data = (await response.json()) as { value: GraphMessage[] };

      const messages = data.value.map((m) => ({
        id: m.id,
        subject: m.subject,
        from: m.from?.emailAddress?.address ?? '',
        fromName: m.from?.emailAddress?.name ?? '',
        receivedAt: m.receivedDateTime,
        preview: m.bodyPreview,
        isRead: m.isRead,
        hasAttachments: m.hasAttachments,
      }));

      // Optionally mark as read
      if (markAsRead && messages.length > 0) {
        const unreadIds = messages.filter((m) => !m.isRead).map((m) => m.id);
        await Promise.all(
          unreadIds.map((id) =>
            fetch(
              `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(agent.email)}/messages/${encodeURIComponent(id)}`,
              {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ isRead: true }),
              },
            ),
          ),
        );
      }

      return { mailbox: agent.email, count: messages.length, messages };
    },
  },

  /* ── reply_to_email ──────────────────── */
  {
    name: 'reply_to_email',
    description:
      'Reply to an email in YOUR inbox. Always YELLOW — requires founder approval. Use the message ID from read_inbox results. Write the reply body only — your signature is added automatically. Format like a real email reply. NEVER use markdown formatting — write in plain professional prose.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'The message ID to reply to (from read_inbox)' },
        body: {
          type: 'string',
          description: 'Reply body in plain professional prose. Do NOT use markdown formatting.',
        },
        reply_all: { type: 'string', description: 'Reply to all recipients instead of just the sender (default: false). Pass "true" to reply all.' },
      },
      required: ['message_id', 'body'],
    },

    async handler(params, agentRole) {
      const token = await getGraphToken();
      const agent = getAgentEmail(agentRole);

      const replyAll = params.reply_all === 'true' || params.reply_all === true;
      const endpoint = replyAll ? 'replyAll' : 'reply';

      const response = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(agent.email)}/messages/${encodeURIComponent(params.message_id as string)}/${endpoint}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            comment: formatEmailHtml(params.body as string, agent),
          }),
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to reply to email (${response.status}): ${text}`);
      }

      return { replied: true, from: agent.email, messageId: params.message_id, replyAll };
    },
  },
];

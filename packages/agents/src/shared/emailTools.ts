/**
 * Shared Email Tools — Per-Agent Mailbox Operations
 *
 * Every agent sends/reads email from their own M365 shared mailbox:
 *   sarah@glyphor.ai   (chief-of-staff)
 *   marcus@glyphor.ai  (cto)
 *   …etc.
 *
 * Tools:
 *   send_email      — Send email from the agent's mailbox
 *   read_inbox      — Check the agent's inbox for new messages
 *   reply_to_email  — Reply to a specific email thread
 *
 * Graph API endpoints used:
 *   POST /users/{agentEmail}/sendMail
 *   GET  /users/{agentEmail}/mailFolders/inbox/messages
 *   POST /users/{agentEmail}/messages/{id}/reply
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { getAgentEmail } from '@glyphor/agent-runtime';
import type { AgentEmailEntry } from '@glyphor/agent-runtime';
import { GraphTeamsClient, GraphEmailClient } from '@glyphor/integrations';

/* ── HTML Email Template ──────────────────── */

/**
 * Wrap raw email body content in a professional HTML email template
 * with a consistent signature block.  Agents write the message text;
 * this function adds the structure, styling, and sign-off automatically.
 */
function formatEmailHtml(body: string, agent: AgentEmailEntry): string {
  // If the agent already included full HTML structure, don't double-wrap
  if (body.trim().toLowerCase().startsWith('<!doctype') || body.trim().toLowerCase().startsWith('<html')) {
    return body;
  }

  // Convert plain-text line breaks to <br> if the body has no HTML tags
  const hasHtml = /<[a-z][\s\S]*>/i.test(body);
  const formattedBody = hasHtml ? body : body.replace(/\n/g, '<br>');

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

/* ── Factory ──────────────────────────────── */

export function createEmailTools(): ToolDefinition[] {
  // Initialize Graph email client — will be null if Azure credentials aren't set
  let emailClient: GraphEmailClient | null = null;
  try {
    const graphClient = GraphTeamsClient.fromEnv();
    emailClient = GraphEmailClient.fromEnv(graphClient);
  } catch {
    // Graph API not configured — tools will return helpful error
  }
  return [

    /* ── send_email ─────────────────────── */
    {
      name: 'send_email',
      description:
        'Send an email from YOUR mailbox (e.g. sarah@glyphor.ai). Always YELLOW — requires founder approval before sending. Write the message body only — your signature is added automatically. Format the body like a real email: greeting, concise content, professional sign-off (e.g. Best regards, Thanks).',
      parameters: {
        to: {
          type: 'array',
          description: 'Recipient email addresses',
          required: true,
          items: { type: 'string', description: 'Email address' },
        },
        subject: {
          type: 'string',
          description: 'Email subject line',
          required: true,
        },
        body: {
          type: 'string',
          description: 'Email body (HTML supported)',
          required: true,
        },
        cc: {
          type: 'array',
          description: 'CC email addresses',
          required: false,
          items: { type: 'string', description: 'Email address' },
        },
        importance: {
          type: 'string',
          description: 'Email importance',
          required: false,
          enum: ['low', 'normal', 'high'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        if (!emailClient) {
          return { success: false, error: 'Email client not configured. Set GLYPHOR_MAIL_SENDER_ID.' };
        }

        const agentEmail = getAgentEmail(ctx.agentRole);

        const toAddrs = (params.to as string[]).map(email => ({ email }));
        const ccAddrs = params.cc ? (params.cc as string[]).map(email => ({ email })) : undefined;

        await emailClient.sendEmailAs(agentEmail.email, {
          to: toAddrs,
          cc: ccAddrs,
          subject: params.subject as string,
          body: formatEmailHtml(params.body as string, agentEmail),
          importance: (params.importance as 'low' | 'normal' | 'high') ?? 'normal',
        });

        return {
          success: true,
          data: {
            sent: true,
            from: agentEmail.email,
            to: params.to,
            subject: params.subject,
          },
        };
      },
    },

    /* ── read_inbox ─────────────────────── */
    {
      name: 'read_inbox',
      description:
        'Check YOUR email inbox for new messages. GREEN — agents can always read their own mailbox. Returns unread messages by default.',
      parameters: {
        limit: {
          type: 'number',
          description: 'Max messages to return (default: 10, max 50)',
          required: false,
        },
        from_filter: {
          type: 'string',
          description: 'Only show messages from addresses containing this string',
          required: false,
        },
        include_read: {
          type: 'boolean',
          description: 'Include already-read messages (default: false)',
          required: false,
        },
        mark_as_read: {
          type: 'boolean',
          description: 'Mark returned messages as read (default: false)',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        if (!emailClient) {
          return { success: false, error: 'Email client not configured. Set GLYPHOR_MAIL_SENDER_ID.' };
        }

        const agentEmail = getAgentEmail(ctx.agentRole);

        const messages = await emailClient.readInbox(agentEmail.email, {
          limit: params.limit as number | undefined,
          unreadOnly: params.include_read !== true,
          fromFilter: params.from_filter as string | undefined,
          markAsRead: params.mark_as_read === true,
        });

        return {
          success: true,
          data: {
            mailbox: agentEmail.email,
            count: messages.length,
            messages,
          },
        };
      },
    },

    /* ── reply_to_email ─────────────────── */
    {
      name: 'reply_to_email',
      description:
        'Reply to an email in YOUR inbox. Always YELLOW — requires founder approval. Use the message ID from read_inbox results. Write the reply body only — your signature is added automatically. Format like a real email reply: address the sender, respond to their points, professional sign-off.',
      parameters: {
        message_id: {
          type: 'string',
          description: 'The message ID to reply to (from read_inbox)',
          required: true,
        },
        body: {
          type: 'string',
          description: 'Reply body (HTML supported)',
          required: true,
        },
        reply_all: {
          type: 'boolean',
          description: 'Reply to all recipients instead of just the sender (default: false)',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        if (!emailClient) {
          return { success: false, error: 'Email client not configured. Set GLYPHOR_MAIL_SENDER_ID.' };
        }

        const agentEmail = getAgentEmail(ctx.agentRole);

        await emailClient.replyToEmail(agentEmail.email, {
          messageId: params.message_id as string,
          body: formatEmailHtml(params.body as string, agentEmail),
          replyAll: params.reply_all === true,
        });

        return {
          success: true,
          data: {
            replied: true,
            from: agentEmail.email,
            messageId: params.message_id,
            replyAll: params.reply_all === true,
          },
        };
      },
    },
  ];
}

/**
 * Email — send / read / reply via Microsoft Graph API
 *
 * Sends email from a shared mailbox or service account using
 * client credentials (app-only) auth. Supports per-agent mailboxes.
 *
 * Required Entra ID permissions (Application):
 *   Mail.Send       — send on behalf of any mailbox
 *   Mail.ReadWrite  — read inbox / reply
 *
 * Governance:
 *   YELLOW — all executive agents (requires founder approval)
 *   BLOCKED — sub-team agents
 */

import type { GraphTeamsClient } from './graphClient.js';
import { applyDisclosurePolicy, isGlyphorInternalEmail } from '@glyphor/agent-runtime';

// ─── TYPES ──────────────────────────────────────────────────────

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailAttachment {
  name: string;
  contentType: string;
  /** Base64-encoded content */
  contentBytes: string;
}

export interface SendEmailOptions {
  agentId?: string;
  to: EmailRecipient[];
  cc?: EmailRecipient[];
  subject: string;
  /** HTML body content */
  body: string;
  attachments?: EmailAttachment[];
  /** Importance: low | normal | high (default: normal) */
  importance?: 'low' | 'normal' | 'high';
  /** If true, save a copy in Sent Items (default: true) */
  saveToSentItems?: boolean;
}

export interface ReadInboxOptions {
  /** Max messages to return (default: 10, max 50) */
  limit?: number;
  /** Only return unread messages (default: true) */
  unreadOnly?: boolean;
  /** Filter by sender email contains */
  fromFilter?: string;
  /** Mark returned messages as read (default: false) */
  markAsRead?: boolean;
}

export interface InboxMessage {
  id: string;
  subject: string;
  from: string;
  fromName: string;
  receivedAt: string;
  preview: string;
  isRead: boolean;
  hasAttachments: boolean;
}

export interface ReplyOptions {
  agentId?: string;
  /** Message ID to reply to */
  messageId: string;
  /** Reply body (HTML) */
  body: string;
  /** If true, reply-all instead of reply-to-sender (default: false) */
  replyAll?: boolean;
}

// ─── EMAIL CLIENT ───────────────────────────────────────────────

export class GraphEmailClient {
  private readonly senderUserId: string;

  constructor(
    private readonly graphClient: GraphTeamsClient,
    senderUserId: string,
  ) {
    this.senderUserId = senderUserId;
  }

  /**
   * Create from environment. Returns null if sender is not configured.
   *
   * Env vars:
   *   GLYPHOR_MAIL_SENDER_ID — Entra Object ID of the shared mailbox or service account
   */
  static fromEnv(graphClient: GraphTeamsClient): GraphEmailClient | null {
    const senderId = process.env.GLYPHOR_MAIL_SENDER_ID;
    if (!senderId) return null;
    return new GraphEmailClient(graphClient, senderId);
  }

  /**
   * Send an email via Graph API.
   */
  async sendEmail(options: SendEmailOptions): Promise<void> {
    const token = await this.getGraphToken();

    const toRecipients = options.to.map(r => ({
      emailAddress: { address: r.email, name: r.name },
    }));
    const ccRecipients = (options.cc ?? []).map(r => ({
      emailAddress: { address: r.email, name: r.name },
    }));

    const attachments = (options.attachments ?? []).map(a => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.name,
      contentType: a.contentType,
      contentBytes: a.contentBytes,
    }));
    const recipients = [...options.to, ...(options.cc ?? [])].map((r) => r.email);
    const internalOnly = recipients.length > 0 && recipients.every((email) => isGlyphorInternalEmail(email));
    const senderIdentity = process.env.GLYPHOR_MAIL_SENDER_EMAIL ?? this.senderUserId;
    const disclosure = await applyDisclosurePolicy(
      options.agentId ?? senderIdentity,
      'email',
      { body: options.body },
      internalOnly ? 'internal' : 'external',
      { toolName: 'send_email' },
    );
    const signedBody = String(disclosure.payload.body ?? options.body);

    const payload = {
      message: {
        subject: options.subject,
        body: {
          contentType: 'HTML',
          content: signedBody,
        },
        toRecipients,
        ...(ccRecipients.length > 0 && { ccRecipients }),
        importance: options.importance ?? 'normal',
        ...(attachments.length > 0 && { attachments }),
      },
      saveToSentItems: options.saveToSentItems ?? true,
    };

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.senderUserId)}/sendMail`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    // sendMail returns 202 Accepted on success
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to send email (${response.status}): ${text}`);
    }
  }

  // ─── PER-AGENT SENDER ────────────────────────────────────────

  /**
   * Send email FROM a specific mailbox (agent's shared mailbox).
   * Uses `POST /users/{senderEmail}/sendMail`.
   */
  async sendEmailAs(senderEmail: string, options: SendEmailOptions): Promise<void> {
    const token = await this.getGraphToken();

    const toRecipients = options.to.map(r => ({
      emailAddress: { address: r.email, name: r.name },
    }));
    const ccRecipients = (options.cc ?? []).map(r => ({
      emailAddress: { address: r.email, name: r.name },
    }));
    const attachments = (options.attachments ?? []).map(a => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.name,
      contentType: a.contentType,
      contentBytes: a.contentBytes,
    }));
    const recipients = [...options.to, ...(options.cc ?? [])].map((r) => r.email);
    const internalOnly = recipients.length > 0 && recipients.every((email) => isGlyphorInternalEmail(email));
    const disclosure = await applyDisclosurePolicy(
      options.agentId ?? senderEmail,
      'email',
      { body: options.body },
      internalOnly ? 'internal' : 'external',
      { toolName: 'send_email' },
    );
    const signedBody = String(disclosure.payload.body ?? options.body);

    const payload = {
      message: {
        subject: options.subject,
        body: { contentType: 'HTML', content: signedBody },
        toRecipients,
        ...(ccRecipients.length > 0 && { ccRecipients }),
        importance: options.importance ?? 'normal',
        ...(attachments.length > 0 && { attachments }),
      },
      saveToSentItems: options.saveToSentItems ?? true,
    };

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to send email as ${senderEmail} (${response.status}): ${text}`);
    }
  }

  // ─── READ INBOX ──────────────────────────────────────────────

  /**
   * Read messages from a mailbox inbox.
   * Uses `GET /users/{mailboxEmail}/mailFolders/inbox/messages`.
   */
  async readInbox(mailboxEmail: string, options: ReadInboxOptions = {}): Promise<InboxMessage[]> {
    const token = await this.getGraphToken();

    const limit = Math.min(options.limit ?? 10, 50);
    const params = new URLSearchParams({
      $top: String(limit),
      $select: 'id,subject,from,receivedDateTime,bodyPreview,isRead,hasAttachments',
      $orderby: 'receivedDateTime desc',
    });

    const filters: string[] = [];
    if (options.unreadOnly !== false) {
      filters.push('isRead eq false');
    }
    if (options.fromFilter) {
      filters.push(`contains(from/emailAddress/address, '${options.fromFilter.replace(/'/g, "''")}')`);
    }
    if (filters.length > 0) {
      params.set('$filter', filters.join(' and '));
    }

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}/mailFolders/inbox/messages?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to read inbox for ${mailboxEmail} (${response.status}): ${text}`);
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

    const messages: InboxMessage[] = data.value.map((m) => ({
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
    if (options.markAsRead && messages.length > 0) {
      const unreadIds = messages.filter(m => !m.isRead).map(m => m.id);
      await Promise.all(
        unreadIds.map(id =>
          fetch(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}/messages/${encodeURIComponent(id)}`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ isRead: true }),
            },
          ),
        ),
      );
    }

    return messages;
  }

  // ─── REPLY ───────────────────────────────────────────────────

  /**
   * Reply to a message in a mailbox.
   * Uses `POST /users/{mailboxEmail}/messages/{messageId}/reply`.
   */
  async replyToEmail(mailboxEmail: string, options: ReplyOptions): Promise<void> {
    const token = await this.getGraphToken();
    const endpoint = options.replyAll ? 'replyAll' : 'reply';
    const disclosure = await applyDisclosurePolicy(
      options.agentId ?? mailboxEmail,
      'email',
      { body: options.body },
      'external',
      { toolName: 'reply_to_email' },
    );
    const signedBody = String(disclosure.payload.body ?? options.body);

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}/messages/${encodeURIComponent(options.messageId)}/${endpoint}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          comment: signedBody,
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to reply to email (${response.status}): ${text}`);
    }
  }

  // ─── PRIVATE ─────────────────────────────────────────────────

  private async getGraphToken(): Promise<string> {
    return (this.graphClient as unknown as { getToken(): Promise<string> }).getToken();
  }
}

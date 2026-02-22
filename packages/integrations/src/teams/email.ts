/**
 * Email — send mail via Microsoft Graph API
 *
 * Sends email from a shared mailbox or service account using
 * client credentials (app-only) auth.
 *
 * Required Entra ID permission (Application): Mail.Send
 *
 * Governance:
 *   YELLOW — all executive agents (requires founder approval)
 *   BLOCKED — sub-team agents
 */

import type { GraphTeamsClient } from './graphClient.js';

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
    const token = await (this.graphClient as unknown as { getToken(): Promise<string> }).getToken();

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

    const payload = {
      message: {
        subject: options.subject,
        body: {
          contentType: 'HTML',
          content: options.body,
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
}

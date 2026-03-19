/**
 * DocuSign Connect Webhook Handler
 *
 * Processes incoming DocuSign Connect notifications (JSON SIM format).
 * Validates HMAC-SHA256 signatures when an HMAC secret is configured,
 * parses the event payload, and returns a structured event for the
 * WakeRouter and activity_log.
 *
 * Supported envelope events:
 *   envelope-sent, envelope-delivered, envelope-completed,
 *   envelope-declined, envelope-voided, envelope-resent
 *
 * Supported recipient events:
 *   recipient-sent, recipient-delivered, recipient-completed,
 *   recipient-declined, recipient-authenticationfailed
 *
 * Ref: https://developers.docusign.com/platform/webhooks/connect/json-sim-event-model/
 * Ref: https://developers.docusign.com/platform/webhooks/connect/hmac/
 */

import * as crypto from 'node:crypto';

// ── Types ────────────────────────────────────────────────────────────────────

/** The top-level JSON SIM event payload from DocuSign Connect */
export interface DocuSignConnectEvent {
  /** e.g. 'envelope-completed', 'recipient-declined' */
  event: string;
  /** API version string (e.g. 'v2.1') */
  apiVersion: string;
  /** URI path to the envelope resource */
  uri: string;
  /** ISO 8601 timestamp when the event was generated */
  retryCount: number;
  configurationId: number;
  generatedDateTime: string;
  data: {
    accountId: string;
    userId?: string;
    envelopeId: string;
    envelopeSummary?: {
      status: string;
      emailSubject: string;
      sentDateTime?: string;
      completedDateTime?: string;
      voidedDateTime?: string;
      voidedReason?: string;
      declinedDateTime?: string;
      recipients?: {
        signers?: Array<{
          email: string;
          name: string;
          status: string;
          recipientId: string;
          signedDateTime?: string;
          declinedDateTime?: string;
          declinedReason?: string;
        }>;
        carbonCopies?: Array<{
          email: string;
          name: string;
          status: string;
        }>;
      };
    };
    recipientId?: string;
  };
}

/** Normalized event returned to the caller */
export interface DocuSignWebhookResult {
  /** Whether the webhook was processed successfully */
  ok: boolean;
  /** The raw event type from DocuSign (e.g. 'envelope-completed') */
  event: string;
  /** The envelope ID this event pertains to */
  envelopeId: string;
  /** Current envelope status */
  envelopeStatus: string;
  /** Email subject of the envelope */
  emailSubject: string;
  /** Summary of what happened (human-readable) */
  summary: string;
  /** All signer statuses (if available) */
  signers: Array<{
    email: string;
    name: string;
    status: string;
    signedAt?: string;
    declinedAt?: string;
    declinedReason?: string;
  }>;
  /** Raw timestamp from DocuSign */
  timestamp: string;
}

// ── HMAC Verification ────────────────────────────────────────────────────────

/**
 * Verify the HMAC-SHA256 signature from DocuSign Connect.
 *
 * DocuSign sends `X-DocuSign-Signature-1` (and optionally -2, -3…)
 * headers, each hashed with a different HMAC key configured in the
 * Connect admin. We validate against any of them.
 */
export function verifyHmac(
  rawBody: string,
  hmacSecret: string,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const expected = crypto
    .createHmac('sha256', hmacSecret)
    .update(rawBody, 'utf8')
    .digest('base64');

  // Check all X-DocuSign-Signature-N headers
  for (let i = 1; i <= 100; i++) {
    const headerName = `x-docusign-signature-${i}`;
    const value = headers[headerName];
    if (!value) break; // no more signature headers

    const sig = Array.isArray(value) ? value[0] : value;
    if (sig && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return true;
    }
  }

  return false;
}

// ── Event Processing ─────────────────────────────────────────────────────────

/**
 * Parse and normalize a DocuSign Connect JSON SIM event.
 */
export function processConnectEvent(payload: DocuSignConnectEvent): DocuSignWebhookResult {
  const envelope = payload.data.envelopeSummary;
  const signers = envelope?.recipients?.signers?.map((s) => ({
    email: s.email,
    name: s.name,
    status: s.status,
    signedAt: s.signedDateTime,
    declinedAt: s.declinedDateTime,
    declinedReason: s.declinedReason,
  })) || [];

  const envelopeStatus = envelope?.status || 'unknown';
  const emailSubject = envelope?.emailSubject || '';
  const summary = buildSummary(payload.event, envelopeStatus, emailSubject, signers);

  return {
    ok: true,
    event: payload.event,
    envelopeId: payload.data.envelopeId,
    envelopeStatus,
    emailSubject,
    summary,
    signers,
    timestamp: payload.generatedDateTime,
  };
}

function buildSummary(
  event: string,
  status: string,
  subject: string,
  signers: Array<{ name: string; status: string }>,
): string {
  const subjectSnippet = subject ? ` "${subject}"` : '';
  switch (event) {
    case 'envelope-completed':
      return `Envelope${subjectSnippet} has been completed — all parties signed.`;
    case 'envelope-declined': {
      const decliner = signers.find((s) => s.status === 'declined');
      return `Envelope${subjectSnippet} was declined${decliner ? ` by ${decliner.name}` : ''}.`;
    }
    case 'envelope-voided':
      return `Envelope${subjectSnippet} was voided.`;
    case 'envelope-sent':
      return `Envelope${subjectSnippet} was sent to ${signers.length} recipient(s).`;
    case 'envelope-delivered':
      return `Envelope${subjectSnippet} was viewed by all recipients.`;
    case 'envelope-resent':
      return `Reminder sent for envelope${subjectSnippet}.`;
    case 'recipient-completed': {
      const signer = signers.find((s) => s.status === 'completed');
      return `${signer?.name || 'A recipient'} signed envelope${subjectSnippet}.`;
    }
    case 'recipient-declined': {
      const decliner = signers.find((s) => s.status === 'declined');
      return `${decliner?.name || 'A recipient'} declined envelope${subjectSnippet}.`;
    }
    case 'recipient-delivered': {
      return `A recipient viewed envelope${subjectSnippet}.`;
    }
    case 'recipient-sent':
      return `Signing notification sent to a recipient for envelope${subjectSnippet}.`;
    default:
      return `DocuSign event "${event}" for envelope${subjectSnippet} (status: ${status}).`;
  }
}

/**
 * Full webhook handler: verify HMAC (if secret provided), parse, return result.
 *
 * Returns { status, body } suitable for HTTP response.
 */
export function handleDocuSignWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
): { status: number; body: DocuSignWebhookResult | { error: string } } {
  const hmacSecret = process.env.DOCUSIGN_CONNECT_HMAC_SECRET;

  // Verify HMAC if a secret is configured
  if (hmacSecret) {
    if (!verifyHmac(rawBody, hmacSecret, headers)) {
      return { status: 401, body: { error: 'Invalid HMAC signature' } };
    }
  }

  let payload: DocuSignConnectEvent;
  try {
    payload = JSON.parse(rawBody) as DocuSignConnectEvent;
  } catch {
    return { status: 400, body: { error: 'Invalid JSON payload' } };
  }

  if (!payload.event || !payload.data?.envelopeId) {
    return { status: 400, body: { error: 'Missing event or envelopeId' } };
  }

  const result = processConnectEvent(payload);
  return { status: 200, body: result };
}

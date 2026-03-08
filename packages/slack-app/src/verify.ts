/**
 * Slack request signature verification.
 * Validates the X-Slack-Signature header using the HMAC-SHA256 scheme.
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SLACK_VERSION = 'v0';
// Reject requests older than 5 minutes to prevent replay attacks
const MAX_AGE_SECONDS = 5 * 60;

export function verifySlackSignature(
  signingSecret: string,
  body: string,
  timestamp: string,
  signature: string,
): boolean {
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - ts);
  if (ageSeconds > MAX_AGE_SECONDS) return false;

  const sigBase = `${SLACK_VERSION}:${timestamp}:${body}`;
  const expected = `${SLACK_VERSION}=` + createHmac('sha256', signingSecret).update(sigBase).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Inbox Check — Polls M365 mailboxes for unread email
 *
 * Called during the heartbeat cycle. Checks the inbox of each
 * email-enabled agent and fires a WakeRouter event when unread
 * external mail is found.
 *
 * Only checks executives + ops + m365-admin — the agents that
 * have email tools wired in. Runs on the MEDIUM tier cadence
 * (every 2nd heartbeat = ~20 min).
 */

import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import { AGENT_EMAIL_MAP } from '@glyphor/agent-runtime';
import { getM365Token } from '@glyphor/integrations';

/**
 * Poll only dedicated inbox triage/admin roles.
 * This avoids unsolicited founder pings from broad automatic inbox wakes.
 */
const EMAIL_ENABLED_AGENTS: CompanyAgentRole[] = ['m365-admin', 'global-admin'];

export interface InboxCheckResult {
  checked: number;
  withMail: { role: CompanyAgentRole; count: number; subjects: string[]; signature: string }[];
  errors: string[];
  skippedInvalidMailboxes: string[];
}

/**
 * Mailboxes that returned ErrorInvalidUser (404) are cached here
 * so we don't spam Graph API + logs every heartbeat cycle.
 * Cleared on process restart so newly-created mailboxes are picked up.
 */
const INVALID_MAILBOXES = new Set<CompanyAgentRole>();

function isLowSignalTeamsPing(message: { subject?: string | null }): boolean {
  const subject = (message.subject ?? '').trim();
  if (!subject) return false;

  // These notification-only subjects often contain no actionable content and can trigger noisy wake loops.
  return [
    /is trying to reach you in microsoft teams/i,
    /reaching me in teams/i,
    /following up on your teams message/i,
    /^re:\s*teams ping/i,
    /^teams ping/i,
  ].some((pattern) => pattern.test(subject));
}

/**
 * Check all email-enabled agents for unread mail.
 * Returns which agents have new messages so the heartbeat can wake them.
 */
export async function checkAgentInboxes(): Promise<InboxCheckResult> {
  let token: string;
  try {
    token = await getM365Token('agent365_mail_read_inbox');
  } catch (err) {
    return {
      checked: 0,
      withMail: [],
      errors: [`Failed to acquire mail token: ${(err as Error).message}`],
      skippedInvalidMailboxes: [],
    };
  }

  const result: InboxCheckResult = { checked: 0, withMail: [], errors: [], skippedInvalidMailboxes: [] };

  // Check all inboxes in parallel (lightweight HEAD-style queries)
  const checks = EMAIL_ENABLED_AGENTS.map(async (role) => {
    // Skip mailboxes that previously returned ErrorInvalidUser
    if (INVALID_MAILBOXES.has(role)) {
      result.skippedInvalidMailboxes.push(role);
      return;
    }

    const entry = AGENT_EMAIL_MAP[role];
    if (!entry) return;

    try {
      const params = new URLSearchParams({
        $top: '5',
        $select: 'id,subject,from,receivedDateTime',
        $filter: 'isRead eq false',
        $orderby: 'receivedDateTime desc',
      });

      const response = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(entry.email)}/mailFolders/inbox/messages?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        const text = await response.text();
        // Cache invalid mailboxes to avoid spamming Graph API + logs every heartbeat
        if (response.status === 404 && text.includes('ErrorInvalidUser')) {
          INVALID_MAILBOXES.add(role);
          result.errors.push(`${role} (${entry.email}): Mailbox does not exist in M365 — skipping future checks until restart. Create with: New-Mailbox -Shared -Name "${entry.displayName}" -PrimarySmtpAddress "${entry.email}"`);
          return;
        }
        result.errors.push(`${role} (${entry.email}): ${response.status} ${text.slice(0, 200)}`);
        return;
      }

      interface GraphMessage {
        id: string;
        subject: string;
        from: { emailAddress: { address: string; name: string } };
        receivedDateTime: string;
      }

      const data = (await response.json()) as { value: GraphMessage[] };
      result.checked++;

      const actionableMessages = data.value.filter((message) => !isLowSignalTeamsPing(message));

      if (actionableMessages.length > 0) {
        const signature = actionableMessages.map((message) => message.id).join('|');
        result.withMail.push({
          role,
          count: actionableMessages.length,
          subjects: actionableMessages.map((message) => message.subject ?? '(no subject)'),
          signature,
        });
      }
    } catch (err) {
      result.errors.push(`${role}: ${(err as Error).message}`);
    }
  });

  await Promise.all(checks);
  return result;
}

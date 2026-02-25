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

/** Agents whose inboxes we poll (those with createEmailTools wired in). */
const EMAIL_ENABLED_AGENTS: CompanyAgentRole[] = [
  'chief-of-staff',
  'cto',
  'cfo',
  'cpo',
  'cmo',
  'vp-customer-success',
  'vp-sales',
  'vp-design',
  'm365-admin',
  'ops',
  'global-admin',
];

export interface InboxCheckResult {
  checked: number;
  withMail: { role: CompanyAgentRole; count: number; subjects: string[] }[];
  errors: string[];
}

/**
 * Check all email-enabled agents for unread mail.
 * Returns which agents have new messages so the heartbeat can wake them.
 */
export async function checkAgentInboxes(): Promise<InboxCheckResult> {
  let token: string;
  try {
    token = await getM365Token('read_inbox');
  } catch (err) {
    return {
      checked: 0,
      withMail: [],
      errors: [`Failed to acquire mail token: ${(err as Error).message}`],
    };
  }

  const result: InboxCheckResult = { checked: 0, withMail: [], errors: [] };

  // Check all inboxes in parallel (lightweight HEAD-style queries)
  const checks = EMAIL_ENABLED_AGENTS.map(async (role) => {
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

      if (data.value.length > 0) {
        result.withMail.push({
          role,
          count: data.value.length,
          subjects: data.value.map(m => m.subject ?? '(no subject)'),
        });
      }
    } catch (err) {
      result.errors.push(`${role}: ${(err as Error).message}`);
    }
  });

  await Promise.all(checks);
  return result;
}

/**
 * Agent Email Registry — Maps agent roles to M365 Shared Mailboxes
 *
 * Each agent has a dedicated shared mailbox (FREE, 50 GB each) in the
 * glyphor.ai tenant.  The Graph API uses the mailbox UPN/email as the
 * sender identity:
 *
 *   POST /users/{agentEmail}/sendMail
 *   GET  /users/{agentEmail}/mailFolders/inbox/messages
 *
 * Prereqs in Entra:
 *   • Entra app registration (AZURE_MAIL_*) needs Mail.Send + Mail.ReadWrite
 *   • Each shared mailbox created via Exchange admin center or PowerShell
 */

import type { CompanyAgentRole } from '../types.js';

export interface AgentEmailEntry {
  email: string;
  displayName: string;
  title: string;
}

/**
 * Live runtime roles → their dedicated shared mailbox.
 */
export const AGENT_EMAIL_MAP: Readonly<Record<string, AgentEmailEntry>> = {
  'chief-of-staff':       { email: 'sarah@glyphor.ai',     displayName: 'Sarah Chen',        title: 'Chief of Staff' },
  'cto':                  { email: 'marcus@glyphor.ai',    displayName: 'Marcus Reeves',     title: 'CTO' },
  'cfo':                  { email: 'nadia@glyphor.ai',     displayName: 'Nadia Okafor',      title: 'CFO' },
  'cpo':                  { email: 'elena@glyphor.ai',     displayName: 'Elena Vasquez',     title: 'CPO' },
  'cmo':                  { email: 'maya@glyphor.ai',      displayName: 'Maya Brooks',       title: 'CMO' },
  'vp-design':            { email: 'mia@glyphor.ai',       displayName: 'Mia Tanaka',        title: 'VP Design' },
  'ops':                  { email: 'atlas@glyphor.ai',     displayName: 'Atlas Vega',        title: 'Operations & System Intelligence' },
  'vp-research':          { email: 'sophia@glyphor.ai',    displayName: 'Sophia Lin',        title: 'VP of Research & Intelligence' },
};

/** Founder email addresses for resolveRecipient(). */
export const FOUNDER_EMAILS: Record<string, string> = {
  kristina: 'kristina@glyphor.ai',
  andrew:   'andrew@glyphor.ai',
};

/**
 * Look up an email address for arecipient — accepts agent role slugs,
 * founder first names, or raw email addresses.
 *
 * Returns `null` if the identifier is unrecognized.
 */
export function resolveRecipient(identifier: string): string | null {
  const normalizedIdentifier = identifier.trim().toLowerCase();

  // Agent role slug
  const agentEntry = AGENT_EMAIL_MAP[normalizedIdentifier];
  if (agentEntry) return agentEntry.email;

  // Founder first name
  const founderEmail = FOUNDER_EMAILS[normalizedIdentifier];
  if (founderEmail) return founderEmail;

  // Already an email address — pass through
  if (identifier.includes('@')) return identifier;

  return null;
}

/**
 * Get the agent email entry for a role. Throws if the role is invalid.
 */
export function getAgentEmail(role: CompanyAgentRole): AgentEmailEntry {
  const entry = AGENT_EMAIL_MAP[role];
  if (!entry) throw new Error(`No live email configured for agent role: ${role}`);
  return entry;
}

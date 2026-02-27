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
 * Every agent role → their dedicated shared mailbox.
 */
export const AGENT_EMAIL_MAP: Record<CompanyAgentRole, AgentEmailEntry> = {
  'chief-of-staff':       { email: 'sarah@glyphor.ai',     displayName: 'Sarah Chen',        title: 'Chief of Staff' },
  'cto':                  { email: 'marcus@glyphor.ai',    displayName: 'Marcus Reeves',     title: 'CTO' },
  'cpo':                  { email: 'elena@glyphor.ai',     displayName: 'Elena Vasquez',     title: 'CPO' },
  'cmo':                  { email: 'maya@glyphor.ai',      displayName: 'Maya Brooks',       title: 'CMO' },
  'cfo':                  { email: 'nadia@glyphor.ai',     displayName: 'Nadia Okafor',      title: 'CFO' },
  'clo':                  { email: 'victoria@glyphor.ai',  displayName: 'Victoria Chase',    title: 'CLO' },
  'vp-customer-success':  { email: 'james@glyphor.ai',     displayName: 'James Turner',      title: 'VP Customer Success' },
  'vp-sales':             { email: 'rachel@glyphor.ai',    displayName: 'Rachel Kim',        title: 'VP Sales' },
  'vp-design':            { email: 'mia@glyphor.ai',       displayName: 'Mia Tanaka',        title: 'VP Design' },
  'platform-engineer':    { email: 'alex@glyphor.ai',      displayName: 'Alex Park',         title: 'Platform Engineer' },
  'quality-engineer':     { email: 'sam@glyphor.ai',       displayName: 'Sam DeLuca',        title: 'Quality Engineer' },
  'devops-engineer':      { email: 'jordan@glyphor.ai',    displayName: 'Jordan Hayes',      title: 'DevOps Engineer' },
  'user-researcher':      { email: 'priya@glyphor.ai',     displayName: 'Priya Sharma',      title: 'User Researcher' },
  'competitive-intel':    { email: 'daniel@glyphor.ai',    displayName: 'Daniel Ortiz',      title: 'Competitive Intel' },
  'revenue-analyst':      { email: 'anna@glyphor.ai',      displayName: 'Anna Park',         title: 'Revenue Analyst' },
  'cost-analyst':         { email: 'omar@glyphor.ai',      displayName: 'Omar Hassan',       title: 'Cost Analyst' },
  'content-creator':      { email: 'tyler@glyphor.ai',     displayName: 'Tyler Reed',        title: 'Content Creator' },
  'seo-analyst':          { email: 'lisa@glyphor.ai',      displayName: 'Lisa Chen',         title: 'SEO Analyst' },
  'social-media-manager': { email: 'kai@glyphor.ai',       displayName: 'Kai Johnson',       title: 'Social Media Manager' },
  'onboarding-specialist':{ email: 'emma@glyphor.ai',      displayName: 'Emma Wright',       title: 'Onboarding Specialist' },
  'support-triage':       { email: 'david@glyphor.ai',     displayName: 'David Santos',      title: 'Support Triage' },
  'account-research':     { email: 'nathan@glyphor.ai',    displayName: 'Nathan Cole',       title: 'Account Research' },
  'm365-admin':           { email: 'riley@glyphor.ai',     displayName: 'Riley Morgan',      title: 'M365 Admin' },
  'ui-ux-designer':       { email: 'leo@glyphor.ai',       displayName: 'Leo Vargas',        title: 'UI/UX Designer' },
  'frontend-engineer':    { email: 'ava@glyphor.ai',       displayName: 'Ava Chen',          title: 'Frontend Engineer' },
  'design-critic':        { email: 'sofia@glyphor.ai',     displayName: 'Sofia Marchetti',   title: 'Design Critic' },
  'template-architect':   { email: 'ryan@glyphor.ai',      displayName: 'Ryan Park',         title: 'Template Architect' },
  'ops':                  { email: 'atlas@glyphor.ai',     displayName: 'Atlas Vega',        title: 'Operations & System Intelligence' },
  'global-admin':          { email: 'morgan@glyphor.ai',    displayName: 'Morgan Blake',      title: 'Global Administrator' },
  // Research & Intelligence
  'vp-research':                    { email: 'sophia@glyphor.ai',   displayName: 'Sophia Lin',        title: 'VP of Research & Intelligence' },
  'competitive-research-analyst': { email: 'lena@glyphor.ai',    displayName: 'Lena Park',         title: 'Competitive Research Analyst' },
  'market-research-analyst':      { email: 'dokafor@glyphor.ai', displayName: 'Daniel Okafor',     title: 'Market Research Analyst' },
  'technical-research-analyst':   { email: 'kain@glyphor.ai',    displayName: 'Kai Nakamura',      title: 'Technical Research Analyst' },
  'industry-research-analyst':    { email: 'amara@glyphor.ai',   displayName: 'Amara Diallo',      title: 'Industry Research Analyst' },
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
  // Agent role slug
  const agentEntry = AGENT_EMAIL_MAP[identifier as CompanyAgentRole];
  if (agentEntry) return agentEntry.email;

  // Founder first name
  const founderEmail = FOUNDER_EMAILS[identifier.toLowerCase()];
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
  if (!entry) throw new Error(`No email configured for agent role: ${role}`);
  return entry;
}

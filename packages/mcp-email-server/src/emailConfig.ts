/**
 * Agent Email Registry — Maps agent roles to M365 Shared Mailboxes
 *
 * Duplicated from @glyphor/agent-runtime so the MCP email server
 * remains self-contained (no cross-package imports).
 *
 * If agents are added/removed, update this file to match
 * packages/agent-runtime/src/config/agentEmails.ts.
 */

export interface AgentEmailEntry {
  email: string;
  displayName: string;
  title: string;
}

export const AGENT_EMAIL_MAP: Record<string, AgentEmailEntry> = {
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
  'global-admin':         { email: 'morgan@glyphor.ai',    displayName: 'Morgan Blake',      title: 'Global Administrator' },
  'head-of-hr':           { email: 'jasmine@glyphor.ai',   displayName: 'Jasmine Rivera',    title: 'Head of People & Culture' },
  'vp-research':          { email: 'sophia@glyphor.ai',    displayName: 'Sophia Lin',        title: 'VP of Research & Intelligence' },
  'competitive-research-analyst': { email: 'lena@glyphor.ai',    displayName: 'Lena Park',         title: 'Competitive Research Analyst' },
  'market-research-analyst':      { email: 'dokafor@glyphor.ai', displayName: 'Daniel Okafor',     title: 'Market Research Analyst' },
  'technical-research-analyst':   { email: 'kain@glyphor.ai',    displayName: 'Kai Nakamura',      title: 'Technical Research Analyst' },
  'industry-research-analyst':    { email: 'amara@glyphor.ai',   displayName: 'Amara Diallo',      title: 'Industry Research Analyst' },
  'enterprise-account-researcher': { email: 'ethan@glyphor.ai',   displayName: 'Ethan Morse',       title: 'Enterprise Account Researcher' },
  'bob-the-tax-pro':               { email: 'bob@glyphor.ai',     displayName: 'Robert Finley',     title: 'CPA & Tax Strategist' },
  'data-integrity-auditor':        { email: 'grace@glyphor.ai',   displayName: 'Grace Hwang',       title: 'Data Integrity Auditor' },
  'tax-strategy-specialist':       { email: 'mariana@glyphor.ai', displayName: 'Mariana Solis',     title: 'Tax Strategy Specialist' },
  'lead-gen-specialist':           { email: 'derek@glyphor.ai',   displayName: 'Derek Owens',       title: 'Lead Generation Specialist' },
  'marketing-intelligence-analyst': { email: 'zara@glyphor.ai',  displayName: 'Zara Petrov',       title: 'Marketing Intelligence Analyst' },
  'ai-impact-analyst':             { email: 'riya@glyphor.ai',    displayName: 'Riya Mehta',        title: 'AI Impact Analyst' },
  'org-analyst':                   { email: 'marcus.c@glyphor.ai', displayName: 'Marcus Chen',      title: 'Organizational & Talent Analyst' },
  'adi-rose':                      { email: 'adi@glyphor.ai',     displayName: 'Adi Rose',          title: 'Executive Assistant to COO' },
};

export const FOUNDER_EMAILS: Record<string, string> = {
  kristina: 'kristina@glyphor.ai',
  andrew:   'andrew@glyphor.ai',
};

/** Always CC both founders on every outgoing agent email. */
export const FOUNDER_CC = Object.values(FOUNDER_EMAILS);

export function getAgentEmail(role: string): AgentEmailEntry {
  const entry = AGENT_EMAIL_MAP[role];
  if (!entry) {
    throw new Error(`No email configured for agent role: ${role}`);
  }
  return entry;
}

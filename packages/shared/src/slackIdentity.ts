import { systemQuery } from './db.js';

const DASHBOARD_BASE_URL = (process.env.DASHBOARD_URL?.trim() || 'https://dashboard.glyphor.com').replace(/\/$/, '');
const IDENTITY_CACHE_TTL_MS = 5 * 60 * 1000;

const SLACK_TITLE_LABELS: Record<string, string> = {
  'chief-of-staff': 'Chief of Staff',
  cto: 'CTO',
  cfo: 'CFO',
  cpo: 'CPO',
  cmo: 'CMO',
  clo: 'CLO',
  'vp-sales': 'VP Sales',
  'vp-design': 'VP Design',
  'vp-research': 'VP Research',
  ops: 'Ops',
  'content-creator': 'Content Creator',
  'seo-analyst': 'SEO Analyst',
  'social-media-manager': 'Social Media Manager',
  'platform-engineer': 'Platform Engineer',
  'quality-engineer': 'Quality Engineer',
  'devops-engineer': 'DevOps Engineer',
  'user-researcher': 'User Researcher',
  'competitive-intel': 'Competitive Intel',
  'm365-admin': 'M365 Administrator',
  'global-admin': 'Global Administrator',
  'head-of-hr': 'Head of HR',
  'vp-customer-success': 'VP Customer Success',
  'onboarding-specialist': 'Onboarding Specialist',
  'support-triage': 'Support Triage',
  'revenue-analyst': 'Revenue Analyst',
  'cost-analyst': 'Cost Analyst',
  'account-research': 'Account Research',
  'lead-gen-specialist': 'Lead Gen Specialist',
  'marketing-intelligence-analyst': 'Marketing Intelligence',
  'competitive-research-analyst': 'Competitive Research',
  'market-research-analyst': 'Market Research',
  'technical-research-analyst': 'Technical Research',
  'enterprise-account-researcher': 'Enterprise Account Research',
  'industry-research-analyst': 'Industry Research',
  'ai-impact-analyst': 'AI Impact Analyst',
  'data-integrity-auditor': 'Data Integrity Auditor',
  'tax-strategy-specialist': 'Tax Strategy',
  'bob-the-tax-pro': 'Tax Strategy',
  'adi-rose': 'Executive Support',
  'platform-intel': 'Platform Intelligence',
};

export interface SlackAgentIdentity {
  agentRole: string;
  displayName: string;
  title: string;
  username: string;
  iconUrl: string;
  contextText: string;
}

type CachedIdentity = {
  value: SlackAgentIdentity;
  fetchedAt: number;
};

const identityCache = new Map<string, CachedIdentity>();

function toAbsoluteAvatarUrl(value: string | null | undefined, agentRole: string): string {
  const avatarPath = (value && value.trim().length > 0)
    ? value.trim()
    : `/avatars/${agentRole}.png`;

  try {
    return new URL(avatarPath, DASHBOARD_BASE_URL).toString();
  } catch {
    return `${DASHBOARD_BASE_URL}${avatarPath.startsWith('/') ? '' : '/'}${avatarPath}`;
  }
}

function resolveSlackTitle(agentRole: string, title: string | null | undefined): string {
  const trimmedTitle = title?.trim();
  if (SLACK_TITLE_LABELS[agentRole]) return SLACK_TITLE_LABELS[agentRole];
  if (trimmedTitle) return trimmedTitle;
  return agentRole;
}

export function buildSlackAgentContextBlock(identity: SlackAgentIdentity): unknown {
  return {
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `*${identity.displayName}* · ${identity.title} · Glyphor`,
    }],
  };
}

export function decorateSlackBlocks(
  blocks: unknown[] | undefined,
  identity: SlackAgentIdentity | null,
): unknown[] | undefined {
  if (!identity) return blocks;
  const identityBlock = buildSlackAgentContextBlock(identity);
  return blocks ? [identityBlock, ...blocks] : [identityBlock];
}

export async function getSlackAgentIdentity(agentRole: string): Promise<SlackAgentIdentity | null> {
  const role = agentRole.trim();
  if (!role) return null;

  const cached = identityCache.get(role);
  if (cached && Date.now() - cached.fetchedAt < IDENTITY_CACHE_TTL_MS) {
    return cached.value;
  }

  const rows = await systemQuery<{
    role: string;
    display_name: string | null;
    title: string | null;
    avatar_url: string | null;
  }>(
    `SELECT ca.role,
            COALESCE(NULLIF(TRIM(ca.display_name), ''), NULLIF(TRIM(ca.name), ''), ca.role) AS display_name,
            COALESCE(NULLIF(TRIM(ca.title), ''), NULLIF(TRIM(ap.title), ''), ca.role) AS title,
            COALESCE(NULLIF(TRIM(ap.avatar_url), ''), '/avatars/' || ca.role || '.png') AS avatar_url
     FROM company_agents ca
     LEFT JOIN agent_profiles ap ON ap.agent_id = ca.role
     WHERE ca.role = $1
     LIMIT 1`,
    [role],
  );

  const row = rows[0];
  if (!row) return null;

  const displayName = row.display_name?.trim() || row.role;
  const title = resolveSlackTitle(row.role, row.title);
  const identity: SlackAgentIdentity = {
    agentRole: row.role,
    displayName,
    title,
    username: `${displayName} · ${title}`,
    iconUrl: toAbsoluteAvatarUrl(row.avatar_url, row.role),
    contextText: `*${displayName}* · ${title} · Glyphor`,
  };

  identityCache.set(role, { value: identity, fetchedAt: Date.now() });
  return identity;
}

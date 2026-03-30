import { systemQuery } from './db.js';

const DASHBOARD_BASE_URL = (process.env.DASHBOARD_URL?.trim() || 'https://dashboard.glyphor.com').replace(/\/$/, '');
const IDENTITY_CACHE_TTL_MS = 5 * 60 * 1000;

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

function getFirstName(displayName: string | null | undefined, agentRole: string): string {
  const trimmedName = displayName?.trim();
  if (trimmedName) {
    const firstToken = trimmedName.split(/\s+/)[0]?.trim();
    if (firstToken) return firstToken;
  }

  const fallback = agentRole.split('-')[0]?.trim();
  if (!fallback) return agentRole;
  return fallback.charAt(0).toUpperCase() + fallback.slice(1);
}

export function buildSlackAgentContextBlock(identity: SlackAgentIdentity): unknown {
  return {
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `*${identity.displayName}*`,
    }],
  };
}

export function decorateSlackBlocks(
  blocks: unknown[] | undefined,
  identity: SlackAgentIdentity | null,
  fallbackText?: string,
): unknown[] | undefined {
  if (!identity) return blocks;
  const identityBlock = buildSlackAgentContextBlock(identity);
  if (blocks && blocks.length > 0) {
    return [identityBlock, ...blocks];
  }

  const trimmedText = fallbackText?.trim();
  if (!trimmedText) {
    return [identityBlock];
  }

  return [
    identityBlock,
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: trimmedText,
      },
    },
  ];
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
            COALESCE(NULLIF(TRIM(ca.title), ''), ca.role) AS title,
            COALESCE(NULLIF(TRIM(ap.avatar_url), ''), '/avatars/' || ca.role || '.png') AS avatar_url
     FROM company_agents ca
     LEFT JOIN agent_profiles ap ON ap.agent_id = ca.role
     WHERE ca.role = $1
     LIMIT 1`,
    [role],
  );

  const row = rows[0];
  if (!row) return null;

  const displayName = getFirstName(row.display_name, row.role);
  const title = row.title?.trim() || row.role;
  const identity: SlackAgentIdentity = {
    agentRole: row.role,
    displayName,
    title,
    username: displayName,
    iconUrl: toAbsoluteAvatarUrl(row.avatar_url, row.role),
    contextText: `*${displayName}*`,
  };

  identityCache.set(role, { value: identity, fetchedAt: Date.now() });
  return identity;
}

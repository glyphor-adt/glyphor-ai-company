/**
 * Graph API channel @mentions for founders on #Deliverables posts.
 *
 * Plain "@Kristina" in HTML is not a Teams mention — Graph requires
 * `<at id="N">Display Name</at>` in the body plus a `mentions` array
 * with Entra (AAD) object IDs.
 *
 * Set TEAMS_FOUNDER_*_AAD_ID in the environment (Entra user object IDs
 * from Azure Portal → Users → select user → Object ID).
 */

export interface GraphChannelMention {
  id: number;
  mentionText: string;
  mentioned: {
    user: {
      displayName: string;
      id: string;
      userIdentityType: 'aadUser';
    };
  };
}

export interface DeliverablesFounderMentions {
  appendHtml: string;
  mentions: GraphChannelMention[];
}

export type FounderMentionTarget = 'kristina' | 'andrew';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Returns HTML footer + Graph mentions for requested founders.
 * If no targets are provided, defaults to both founders.
 * Returns null when none of the requested founders are configured.
 */
export function buildDeliverablesFounderMentions(
  targets?: FounderMentionTarget[],
): DeliverablesFounderMentions | null {
  const kId = process.env.TEAMS_FOUNDER_KRISTINA_AAD_ID?.trim();
  const aId = process.env.TEAMS_FOUNDER_ANDREW_AAD_ID?.trim();

  const kName = process.env.TEAMS_FOUNDER_KRISTINA_DISPLAY_NAME?.trim() || 'Kristina Denney';
  const aName = process.env.TEAMS_FOUNDER_ANDREW_DISPLAY_NAME?.trim() || 'Andrew Zwelling';

  const requestedBase: FounderMentionTarget[] = targets && targets.length > 0
    ? targets
    : ['kristina', 'andrew'];
  const requested: FounderMentionTarget[] = Array.from(new Set(requestedBase));

  const founderConfig: Record<FounderMentionTarget, { id?: string; name: string }> = {
    kristina: { id: kId, name: kName },
    andrew: { id: aId, name: aName },
  };

  const selected = requested
    .map((target) => founderConfig[target])
    .filter((item): item is { id: string; name: string } => Boolean(item.id));

  if (selected.length === 0) return null;

  // Inner text of <at> must match mentionText for Teams to resolve the mention.
  const atBlocks = selected.map((item, index) => `<at id="${index}">${escapeHtml(item.name)}</at>`).join(' ');
  const appendHtml = `<br/><br/>${atBlocks} — review requested.`;

  const mentions: GraphChannelMention[] = selected.map((item, index) => ({
    id: index,
    mentionText: item.name,
    mentioned: {
      user: {
        displayName: item.name,
        id: item.id,
        userIdentityType: 'aadUser',
      },
    },
  }));

  return { appendHtml, mentions };
}

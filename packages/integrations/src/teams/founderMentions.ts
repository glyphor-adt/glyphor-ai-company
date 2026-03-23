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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Returns HTML footer + Graph mentions when both founder AAD IDs are configured.
 * Otherwise returns null (caller should use a plain-text footer).
 */
export function buildDeliverablesFounderMentions(): DeliverablesFounderMentions | null {
  const kId = process.env.TEAMS_FOUNDER_KRISTINA_AAD_ID?.trim();
  const aId = process.env.TEAMS_FOUNDER_ANDREW_AAD_ID?.trim();
  if (!kId || !aId) return null;

  const kName = process.env.TEAMS_FOUNDER_KRISTINA_DISPLAY_NAME?.trim() || 'Kristina Denney';
  const aName = process.env.TEAMS_FOUNDER_ANDREW_DISPLAY_NAME?.trim() || 'Andrew Zwelling';

  // Inner text of <at> must match mentionText for Teams to resolve the mention.
  const appendHtml =
    `<br/><br/><at id="0">${escapeHtml(kName)}</at> <at id="1">${escapeHtml(aName)}</at> — review requested.`;

  const mentions: GraphChannelMention[] = [
    {
      id: 0,
      mentionText: kName,
      mentioned: {
        user: {
          displayName: kName,
          id: kId,
          userIdentityType: 'aadUser',
        },
      },
    },
    {
      id: 1,
      mentionText: aName,
      mentioned: {
        user: {
          displayName: aName,
          id: aId,
          userIdentityType: 'aadUser',
        },
      },
    },
  ];

  return { appendHtml, mentions };
}

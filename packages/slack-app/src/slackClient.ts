/**
 * Slack API client — minimal fetch-based wrapper for posting messages
 * and retrieving customer tenant configuration from the database.
 */
import { systemQuery } from '@glyphor/shared/db';
import { decorateSlackBlocks, getSlackAgentIdentity } from '@glyphor/shared';
import type { DbCustomerTenant } from './types.js';

const SLACK_API_BASE = 'https://slack.com/api';

export interface PostMessageOptions {
  channel: string;
  text?: string;
  blocks?: unknown[];
  thread_ts?: string;
}

export interface PostMessageIdentity {
  agentRole: string;
}

export interface SlackApiResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function postMessage(
  botToken: string,
  opts: PostMessageOptions,
  identity?: PostMessageIdentity,
): Promise<SlackApiResponse> {
  const slackIdentity = identity?.agentRole ? await getSlackAgentIdentity(identity.agentRole) : null;
  const res = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({
      ...opts,
      ...(slackIdentity ? {
        username: slackIdentity.username,
        icon_url: slackIdentity.iconUrl,
        blocks: decorateSlackBlocks(opts.blocks, slackIdentity, opts.text),
      } : {}),
    }),
  });
  return res.json() as Promise<SlackApiResponse>;
}

export async function postEphemeral(
  botToken: string,
  channel: string,
  user: string,
  text: string,
): Promise<SlackApiResponse> {
  const res = await fetch(`${SLACK_API_BASE}/chat.postEphemeral`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({ channel, user, text }),
  });
  return res.json() as Promise<SlackApiResponse>;
}

export async function getCustomerTenantByTeamId(
  slackTeamId: string,
): Promise<DbCustomerTenant | null> {
  const rows = await systemQuery<DbCustomerTenant>(
    `SELECT * FROM customer_tenants WHERE slack_team_id = $1 AND status = 'active' LIMIT 1`,
    [slackTeamId],
  );
  return rows[0] ?? null;
}

export async function getCustomerTenantById(
  id: string,
): Promise<DbCustomerTenant | null> {
  const rows = await systemQuery<DbCustomerTenant>(
    `SELECT * FROM customer_tenants WHERE id = $1 AND status = 'active' LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function openDM(
  botToken: string,
  userId: string,
): Promise<{ ok: boolean; channelId: string | null }> {
  const res = await fetch(`${SLACK_API_BASE}/conversations.open`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({ users: userId }),
  });
  const data = (await res.json()) as { ok: boolean; channel?: { id: string } };
  return { ok: data.ok, channelId: data.channel?.id ?? null };
}

export async function openModal(
  botToken: string,
  triggerId: string,
  view: Record<string, unknown>,
): Promise<SlackApiResponse> {
  const res = await fetch(`${SLACK_API_BASE}/views.open`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({ trigger_id: triggerId, view }),
  });
  return res.json() as Promise<SlackApiResponse>;
}

export async function updateMessage(
  botToken: string,
  channel: string,
  ts: string,
  opts: { text?: string; blocks?: unknown[] },
): Promise<SlackApiResponse> {
  const res = await fetch(`${SLACK_API_BASE}/chat.update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({ channel, ts, ...opts }),
  });
  return res.json() as Promise<SlackApiResponse>;
}

export async function publishHomeTab(
  botToken: string,
  userId: string,
): Promise<SlackApiResponse> {
  const res = await fetch(`${SLACK_API_BASE}/views.publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({
      user_id: userId,
      view: {
        type: 'home',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Welcome to Glyphor* :rocket:\nYour AI marketing team is ready.',
            },
          },
          { type: 'divider' },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'Use `/glyphor` to give instructions, or send messages directly in the *Messages* tab.',
            },
          },
        ],
      },
    }),
  });
  return res.json() as Promise<SlackApiResponse>;
}

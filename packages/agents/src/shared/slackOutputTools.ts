/**
 * Slack Output Tools — Agent tools for posting to customer Slack workspaces.
 *
 * Tools:
 *   post_to_slack          — Post a message to the tenant's Slack workspace
 *   request_slack_approval — Send a deliverable for approval via interactive buttons
 *
 * These tools resolve the tenant from the agent run context and route messages
 * to the correct Slack channel based on content type (deliverable, briefing,
 * report, question, update).
 *
 * Channel config is stored in customer_tenants.settings.channels:
 *   { deliverables: "C...", briefings: "C...", reports: "C...", dm_owner: "D...", general: "C..." }
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { decorateSlackBlocks, getSlackAgentIdentity } from '@glyphor/shared';

const SLACK_API_BASE = 'https://slack.com/api';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Types ───────────────────────────────────────────────────────────────────

interface SlackIntegration {
  customerTenantId: string;
  tenantId: string;
  botToken: string;
  channels: {
    deliverables: string | null;
    briefings: string | null;
    reports: string | null;
    dm_owner: string | null;
    general: string | null;
  };
  agentChannelPermissions: Record<string, string[]>;
}

interface SlackPostResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getSlackIntegration(tenantId: string): Promise<SlackIntegration | null> {
  const rows = await systemQuery<{
    id: string;
    tenant_id: string;
    bot_token: string;
    settings: Record<string, unknown>;
    default_channel: string | null;
  }>(
    `SELECT id, tenant_id, bot_token, settings, default_channel
     FROM customer_tenants
     WHERE tenant_id = $1 AND status = 'active'
     LIMIT 1`,
    [tenantId],
  );

  const row = rows[0];
  if (!row) return null;

  const settings = row.settings ?? {};
  const channels = (settings['channels'] as Record<string, string | null>) ?? {};
  const agentChannelPermissions = (settings['agent_channel_permissions'] as Record<string, unknown>) ??
    (settings['agentChannelPermissions'] as Record<string, unknown>) ?? {};

  const normalizedPermissions: Record<string, string[]> = {};
  for (const [agentRole, permissions] of Object.entries(agentChannelPermissions)) {
    if (Array.isArray(permissions)) {
      normalizedPermissions[agentRole] = permissions.filter((permission): permission is string => typeof permission === 'string');
    }
  }

  return {
    customerTenantId: row.id,
    tenantId: row.tenant_id,
    botToken: row.bot_token,
    channels: {
      deliverables: channels['deliverables'] ?? null,
      briefings: channels['briefings'] ?? null,
      reports: channels['reports'] ?? null,
      dm_owner: channels['dm_owner'] ?? null,
      general: channels['general'] ?? row.default_channel ?? null,
    },
    agentChannelPermissions: normalizedPermissions,
  };
}

async function slackPost(
  botToken: string,
  payload: Record<string, unknown>,
  agentRole?: string,
): Promise<SlackPostResponse> {
  const slackIdentity = agentRole ? await getSlackAgentIdentity(agentRole) : null;
  const usernameOverride = typeof payload.sender_name === 'string'
    ? payload.sender_name
    : typeof payload.senderName === 'string'
      ? payload.senderName
      : null;
  const effectiveIdentity = slackIdentity && usernameOverride
    ? { ...slackIdentity, username: usernameOverride }
    : slackIdentity;
  const res = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({
      ...payload,
      ...(effectiveIdentity ? {
        username: effectiveIdentity.username,
        icon_url: effectiveIdentity.iconUrl,
        blocks: decorateSlackBlocks(
          (payload.blocks as unknown[] | undefined),
          effectiveIdentity,
          typeof payload.text === 'string' ? payload.text : undefined,
        ),
      } : {}),
    }),
  });
  return res.json() as Promise<SlackPostResponse>;
}

async function resolveTenantIdFromRunId(runId: string | undefined): Promise<string | null> {
  if (!runId || !UUID_RE.test(runId)) {
    return null;
  }

  const runRows = await systemQuery<{ tenant_id: string }>(
    `SELECT tenant_id FROM agent_runs WHERE id = $1 LIMIT 1`,
    [runId],
  );

  return runRows[0]?.tenant_id ?? null;
}

function resolveChannel(
  integration: SlackIntegration,
  contextType: string,
): string | null {
  switch (contextType) {
    case 'question':    return integration.channels.dm_owner;
    case 'deliverable': return integration.channels.deliverables;
    case 'briefing':    return integration.channels.briefings;
    case 'report':      return integration.channels.reports;
    case 'update':      return integration.channels.general;
    default:            return integration.channels.general;
  }
}

function getChannelKey(channel: string, channels: SlackIntegration['channels']): string | null {
  for (const [key, configuredChannel] of Object.entries(channels)) {
    if (configuredChannel && configuredChannel === channel) {
      return key;
    }
  }

  return null;
}

function getDefaultChannelPermissions(agentRole: string): string[] {
  switch (agentRole) {
    case 'chief-of-staff':
      return ['briefings', 'reports', 'general', 'dm_owner'];
    case 'cmo':
      return ['deliverables', 'briefings', 'reports', 'general', 'dm_owner'];
    case 'content-creator':
      return ['deliverables', 'general'];
    case 'seo-analyst':
      return ['reports', 'general'];
    case 'social-media-manager':
      return ['deliverables', 'general'];
    default:
      return [];
  }
}

// ─── Tool Factory ────────────────────────────────────────────────────────────

export function createSlackOutputTools(): ToolDefinition[] {
  return [
    // ── post_to_slack ──────────────────────────────────────────────
    {
      name: 'post_to_slack',
      description:
        'Post a message to the customer\'s Slack workspace. Use context_type to route ' +
        'to the correct channel: "deliverable" → deliverables channel, "briefing" → briefings, ' +
        '"report" → reports, "question" → DM the workspace owner, "update" → general channel. ' +
        'Only use this for customer-facing output — internal agent communication uses send_agent_message.',
      parameters: {
        message: {
          type: 'string',
          description: 'The message to post. Supports Slack mrkdwn formatting.',
          required: true,
        },
        context_type: {
          type: 'string',
          description: 'Content type — determines which channel receives the message.',
          required: true,
          enum: ['question', 'deliverable', 'briefing', 'report', 'update'],
        },
        thread_ts: {
          type: 'string',
          description: 'Thread timestamp to reply in a thread. Omit to start a new message.',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const message = (params.message as string ?? '').trim();
        const contextType = params.context_type as string ?? 'update';
        const threadTs = params.thread_ts as string | undefined;
        const agentRole = ctx.agentRole;

        if (!message) {
          return { success: false, error: 'message is required' };
        }

        if (!agentRole) {
          return { success: false, error: 'No agent role available for permission enforcement.' };
        }

        // Resolve tenant — the agent's run context carries tenantId in the run config
        // For now, look up the first active customer tenant associated with the run
        const tenantId = await resolveTenantIdFromRunId(ctx.runId);

        if (!tenantId) {
          return {
            success: false,
            error: 'No tenant context available. post_to_slack requires a customer tenant context.',
          };
        }

        const integration = await getSlackIntegration(tenantId);
        if (!integration) {
          return { success: false, error: `No active Slack integration found for tenant ${tenantId}` };
        }

        const channel = resolveChannel(integration, contextType);
        if (!channel) {
          return {
            success: false,
            error: `No channel configured for context_type="${contextType}". Ask the customer to configure their ${contextType} channel.`,
          };
        }

        const channelKey = getChannelKey(channel, integration.channels);
        if (!channelKey) {
          return {
            success: false,
            error: `Unable to resolve permission key for Slack channel ${channel}.`,
          };
        }

        const agentPermissions = integration.agentChannelPermissions[agentRole] ?? getDefaultChannelPermissions(agentRole);
        if (!agentPermissions.includes(channelKey)) {
          return {
            success: false,
            error: `${agentRole} is not permitted to post to ${channelKey}`,
          };
        }

        const result = await slackPost(integration.botToken, {
          channel,
          text: message,
          ...(threadTs ? { thread_ts: threadTs } : {}),
        }, agentRole);

        if (!result.ok) {
          return { success: false, error: `Slack API error: ${result.error ?? 'unknown'}` };
        }

        return {
          success: true,
          data: {
            channel,
            context_type: contextType,
            ts: result.ts,
            note: `Message posted to ${contextType} channel`,
          },
        };
      },
    },

    // ── request_slack_approval ──────────────────────────────────────
    {
      name: 'request_slack_approval',
      description:
        'Send a deliverable to the customer for approval via Slack interactive buttons. ' +
        'Posts to the workspace owner\'s DM with Approve/Reject/View Brief buttons. ' +
        'Use this when you have completed a deliverable that needs customer sign-off before publishing.',
      parameters: {
        summary: {
          type: 'string',
          description: 'Brief description of the deliverable (shown in the approval card)',
          required: true,
        },
        details: {
          type: 'string',
          description: 'Detailed content or key facts about the deliverable',
          required: false,
        },
        deliverable_type: {
          type: 'string',
          description: 'Type of deliverable',
          required: false,
          enum: ['campaign_brief', 'video_ad', 'social_post', 'report', 'design', 'other'],
        },
        estimated_cost: {
          type: 'string',
          description: 'Estimated cost if applicable (e.g. "$4.75")',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const summary = (params.summary as string ?? '').trim();
        const details = (params.details as string) ?? '';
        const deliverableType = (params.deliverable_type as string) ?? 'other';
        const estimatedCost = (params.estimated_cost as string) ?? null;

        if (!summary) {
          return { success: false, error: 'summary is required' };
        }

        const agentRole = ctx.agentRole;
        const tenantId = await resolveTenantIdFromRunId(ctx.runId);

        if (!tenantId) {
          return { success: false, error: 'No tenant context available.' };
        }

        const integration = await getSlackIntegration(tenantId);
        if (!integration) {
          return { success: false, error: `No active Slack integration for tenant ${tenantId}` };
        }

        const dmChannel = integration.channels.dm_owner;
        if (!dmChannel) {
          return { success: false, error: 'No dm_owner channel configured. Onboarding may not be complete.' };
        }

        // Create approval row in slack_approvals
        const approvalRows = await systemQuery<{ id: string }>(
          `INSERT INTO slack_approvals
             (tenant_id, customer_tenant_id, kind, destination, payload,
              status, slack_channel_id)
           VALUES ($1, $2, 'request', $3, $4, 'pending', $5)
           RETURNING id`,
          [
            tenantId,
            integration.customerTenantId,
            agentRole,
            JSON.stringify({
              summary,
              details,
              deliverable_type: deliverableType,
              estimated_cost: estimatedCost,
              agent_role: agentRole,
              run_id: ctx.runId ?? null,
            }),
            dmChannel,
          ],
        );

        const approvalId = approvalRows[0]?.id;
        if (!approvalId) {
          return { success: false, error: 'Failed to create approval row' };
        }

        // Build the agent-branded approval card
        const AGENT_NAMES: Record<string, string> = {
          'chief-of-staff': 'Sarah', cmo: 'Maya', cto: 'Marcus',
          cfo: 'Nadia', cpo: 'Elena', 'content-creator': 'Tyler',
          'seo-analyst': 'Lisa', 'social-media-manager': 'Kai',
        };
        const agentName = AGENT_NAMES[agentRole] ?? agentRole;
        const costLine = estimatedCost ? ` — ${estimatedCost} est.` : '';

        const blocks: unknown[] = [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${agentName}*`,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${summary}${costLine}`,
            },
          },
        ];

        if (details) {
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: details.length > 500 ? details.slice(0, 497) + '…' : details,
            },
          });
        }

        blocks.push({
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Approve', emoji: true },
              style: 'primary',
              action_id: `approve_${approvalId}`,
              value: approvalId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Reject', emoji: true },
              style: 'danger',
              action_id: `reject_${approvalId}`,
              value: approvalId,
            },
          ],
        });

        const postResult = await slackPost(integration.botToken, {
          channel: dmChannel,
          text: `${agentName} has a ${deliverableType.replace(/_/g, ' ')} ready for review.`,
          blocks,
        }, agentRole);

        if (!postResult.ok) {
          return { success: false, error: `Slack API error: ${postResult.error ?? 'unknown'}` };
        }

        return {
          success: true,
          data: {
            approval_id: approvalId,
            channel: dmChannel,
            note: `Approval request sent to workspace owner. Waiting for Approve/Reject.`,
          },
        };
      },
    },
  ];
}

/**
 * Teams Output Tools — Agent tools for posting to customer Teams workspaces.
 *
 * Tools:
 *   post_to_customer_teams   — Post a message to the tenant's Teams workspace
 *   request_teams_approval   — Send a deliverable for approval via Adaptive Card buttons
 *
 * These tools resolve the tenant from the agent run context and route messages
 * to the correct Teams channel based on content type (deliverable, briefing,
 * report, question, update).
 *
 * Channel config is stored in customer_tenants.settings.channels:
 *   { deliverables: "19:...", briefings: "19:...", reports: "19:...",
 *     dm_owner: "<installer-aad-id>", general: "19:..." }
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TeamsIntegration {
  customerTenantId: string;
  tenantId: string;
  teamsTenantId: string;
  teamsTeamId: string | null;
  serviceUrl: string;
  conversationId: string | null;
  installerAadId: string | null;
  channels: {
    deliverables: string | null;
    briefings: string | null;
    reports: string | null;
    dm_owner: string | null;   // installer's AAD Object ID for 1:1 chat
    general: string | null;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getTeamsIntegration(tenantId: string): Promise<TeamsIntegration | null> {
  const rows = await systemQuery<{
    id: string;
    tenant_id: string;
    teams_tenant_id: string;
    teams_team_id: string | null;
    teams_service_url: string;
    teams_conversation_id: string | null;
    teams_installer_aad_id: string | null;
    settings: Record<string, unknown>;
  }>(
    `SELECT id, tenant_id, teams_tenant_id, teams_team_id,
            teams_service_url, teams_conversation_id, teams_installer_aad_id, settings
     FROM customer_tenants
     WHERE tenant_id = $1
       AND teams_tenant_id IS NOT NULL
       AND status = 'active'
     LIMIT 1`,
    [tenantId],
  );

  const row = rows[0];
  if (!row || !row.teams_service_url) return null;

  const settings = row.settings ?? {};
  const channels = (settings['channels'] as Record<string, string | null>) ?? {};

  return {
    customerTenantId: row.id,
    tenantId: row.tenant_id,
    teamsTenantId: row.teams_tenant_id,
    teamsTeamId: row.teams_team_id,
    serviceUrl: row.teams_service_url,
    conversationId: row.teams_conversation_id,
    installerAadId: row.teams_installer_aad_id,
    channels: {
      deliverables: channels['deliverables'] ?? null,
      briefings: channels['briefings'] ?? null,
      reports: channels['reports'] ?? null,
      dm_owner: row.teams_installer_aad_id,
      general: channels['general'] ?? null,
    },
  };
}

/**
 * Acquire a Graph API token for posting into a customer's Teams workspace.
 * Uses the multi-tenant bot app registration credentials.
 */
async function getCustomerGraphToken(): Promise<string | null> {
  const clientId = process.env.AGENT365_CLIENT_ID?.trim();
  const clientSecret = process.env.AGENT365_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  // Multi-tenant: authenticate against the common endpoint
  const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  const res = await fetch(tokenUrl, { method: 'POST', body });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

/**
 * Post a message to a Teams channel via Graph API.
 */
async function postToTeamsChannel(
  teamsTeamId: string,
  channelId: string,
  html: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = `${GRAPH_BASE}/teams/${encodeURIComponent(teamsTeamId)}/channels/${encodeURIComponent(channelId)}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body: { contentType: 'html', content: html } }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `Graph API ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

/**
 * Send a 1:1 proactive message via the Bot Framework service URL.
 */
async function sendProactiveMessage(
  serviceUrl: string,
  conversationId: string,
  message: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = `${serviceUrl.replace(/\/$/, '')}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'message',
      text: message,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `Bot service ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

/**
 * Send an Adaptive Card via the Bot Framework service URL.
 */
async function sendProactiveCard(
  serviceUrl: string,
  conversationId: string,
  card: Record<string, unknown>,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = `${serviceUrl.replace(/\/$/, '')}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: card,
      }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `Bot service ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

/** Resolve the target channel / conversation for a given context type. */
function resolveTarget(
  integration: TeamsIntegration,
  contextType: string,
): { type: 'channel'; channelId: string } | { type: 'conversation'; conversationId: string } | null {
  const ch = integration.channels;
  switch (contextType) {
    case 'question':
      // DM the installer via the install conversation
      return integration.conversationId
        ? { type: 'conversation', conversationId: integration.conversationId }
        : null;
    case 'deliverable':
      return ch.deliverables && integration.teamsTeamId
        ? { type: 'channel', channelId: ch.deliverables }
        : (integration.conversationId
            ? { type: 'conversation', conversationId: integration.conversationId }
            : null);
    case 'briefing':
      return ch.briefings && integration.teamsTeamId
        ? { type: 'channel', channelId: ch.briefings }
        : (integration.conversationId
            ? { type: 'conversation', conversationId: integration.conversationId }
            : null);
    case 'report':
      return ch.reports && integration.teamsTeamId
        ? { type: 'channel', channelId: ch.reports }
        : (integration.conversationId
            ? { type: 'conversation', conversationId: integration.conversationId }
            : null);
    case 'update':
    default:
      return ch.general && integration.teamsTeamId
        ? { type: 'channel', channelId: ch.general }
        : (integration.conversationId
            ? { type: 'conversation', conversationId: integration.conversationId }
            : null);
  }
}

// ─── Tool Factory ────────────────────────────────────────────────────────────

export function createTeamsOutputTools(): ToolDefinition[] {
  return [
    // ── post_to_customer_teams ─────────────────────────────────────
    {
      name: 'post_to_customer_teams',
      description:
        'Post a message to the customer\'s Microsoft Teams workspace. Use context_type to route ' +
        'to the correct channel: "deliverable" → deliverables channel, "briefing" → briefings, ' +
        '"report" → reports, "question" → DM the workspace owner, "update" → general channel. ' +
        'Only use this for customer-facing output — internal agent communication uses send_agent_message.',
      parameters: {
        message: {
          type: 'string',
          description: 'The message to post. Plain text or basic markdown.',
          required: true,
        },
        context_type: {
          type: 'string',
          description: 'Content type — determines which channel receives the message.',
          required: true,
          enum: ['question', 'deliverable', 'briefing', 'report', 'update'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const message = (params.message as string ?? '').trim();
        const contextType = params.context_type as string ?? 'update';

        if (!message) {
          return { success: false, error: 'message is required' };
        }

        // Resolve tenant from the agent run
        const runId = ctx.runId;
        let tenantId: string | null = null;

        if (runId) {
          const runRows = await systemQuery<{ tenant_id: string }>(
            `SELECT tenant_id FROM agent_runs WHERE id = $1 LIMIT 1`,
            [runId],
          );
          tenantId = runRows[0]?.tenant_id ?? null;
        }

        if (!tenantId) {
          return {
            success: false,
            error: 'No tenant context available. post_to_customer_teams requires a customer tenant context.',
          };
        }

        const integration = await getTeamsIntegration(tenantId);
        if (!integration) {
          return { success: false, error: `No active Teams integration found for tenant ${tenantId}` };
        }

        const token = await getCustomerGraphToken();
        if (!token) {
          return { success: false, error: 'Failed to acquire Graph API token for customer Teams posting' };
        }

        const target = resolveTarget(integration, contextType);
        if (!target) {
          return {
            success: false,
            error: `No channel configured for context_type="${contextType}". Ask the customer to configure their ${contextType} channel.`,
          };
        }

        let result: { ok: boolean; error?: string };
        if (target.type === 'channel' && integration.teamsTeamId) {
          result = await postToTeamsChannel(integration.teamsTeamId, target.channelId, message, token);
        } else if (target.type === 'conversation') {
          result = await sendProactiveMessage(integration.serviceUrl, target.conversationId, message, token);
        } else {
          return { success: false, error: 'No valid target resolved for this message' };
        }

        if (!result.ok) {
          return { success: false, error: `Teams delivery failed: ${result.error}` };
        }

        return {
          success: true,
          data: {
            context_type: contextType,
            target_type: target.type,
            note: `Message posted to ${contextType} ${target.type}`,
          },
        };
      },
    },

    // ── request_teams_approval ──────────────────────────────────────
    {
      name: 'request_teams_approval',
      description:
        'Send a deliverable to the customer for approval via Teams Adaptive Card buttons. ' +
        'Posts to the workspace owner\'s chat with Approve/Reject buttons. ' +
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
        const runId = ctx.runId;
        let tenantId: string | null = null;

        if (runId) {
          const runRows = await systemQuery<{ tenant_id: string }>(
            `SELECT tenant_id FROM agent_runs WHERE id = $1 LIMIT 1`,
            [runId],
          );
          tenantId = runRows[0]?.tenant_id ?? null;
        }

        if (!tenantId) {
          return { success: false, error: 'No tenant context available.' };
        }

        const integration = await getTeamsIntegration(tenantId);
        if (!integration) {
          return { success: false, error: `No active Teams integration for tenant ${tenantId}` };
        }

        if (!integration.conversationId) {
          return { success: false, error: 'No conversation stored for this Teams install. Onboarding may not be complete.' };
        }

        const token = await getCustomerGraphToken();
        if (!token) {
          return { success: false, error: 'Failed to acquire Graph API token' };
        }

        // Create approval row
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
              run_id: runId,
              platform: 'teams',
            }),
            integration.conversationId,
          ],
        );

        const approvalId = approvalRows[0]?.id;
        if (!approvalId) {
          return { success: false, error: 'Failed to create approval row' };
        }

        // Build agent-branded Adaptive Card
        const AGENT_NAMES: Record<string, string> = {
          'chief-of-staff': 'Sarah Chen', cmo: 'Maya Brooks', cto: 'Marcus Reeves',
          cfo: 'Nadia Okafor', cpo: 'Elena Vasquez', 'content-creator': 'Tyler Reed',
          'seo-analyst': 'Lisa Chen', 'social-media-manager': 'Kai Johnson',
        };
        const agentName = AGENT_NAMES[agentRole] ?? agentRole;
        const costLine = estimatedCost ? ` — ${estimatedCost} est.` : '';

        const cardBody: Record<string, unknown>[] = [
          {
            type: 'TextBlock',
            text: `${agentName} · ${agentRole}`,
            weight: 'Bolder',
            size: 'Medium',
          },
          {
            type: 'TextBlock',
            text: `${summary}${costLine}`,
            wrap: true,
          },
        ];

        if (details) {
          cardBody.push({
            type: 'TextBlock',
            text: details.length > 500 ? details.slice(0, 497) + '…' : details,
            wrap: true,
            isSubtle: true,
          });
        }

        const card: Record<string, unknown> = {
          type: 'AdaptiveCard',
          version: '1.4',
          body: cardBody,
          actions: [
            {
              type: 'Action.Execute',
              title: 'Approve',
              verb: 'customer_approval.approve',
              data: { approval_id: approvalId, action: 'approve' },
              style: 'positive',
            },
            {
              type: 'Action.Execute',
              title: 'Reject',
              verb: 'customer_approval.reject',
              data: { approval_id: approvalId, action: 'reject' },
              style: 'destructive',
            },
          ],
        };

        const result = await sendProactiveCard(
          integration.serviceUrl,
          integration.conversationId,
          card,
          token,
        );

        if (!result.ok) {
          return { success: false, error: `Teams card delivery failed: ${result.error}` };
        }

        return {
          success: true,
          data: {
            approval_id: approvalId,
            platform: 'teams',
            note: 'Approval request sent to Teams with Approve/Reject buttons.',
          },
        };
      },
    },
  ];
}

/**
 * Teams Output Tools — customer-facing Teams delivery.
 *
 * Hardening rules:
 *   1. Customer Teams tools require a verified tenant binding.
 *   2. Proactive chat/card sends use a Bot Framework audience token, not Graph.
 *   3. Channel posting via Graph is an explicit exception path, disabled by default.
 */

import { buildTool, type ToolDefinition, type ToolResult } from '@glyphor/agent-runtime';
import {
  canonicalTeamsWorkspaceKey,
  isSystemTenantId,
} from '@glyphor/integrations';
import { systemQuery } from '@glyphor/shared/db';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const BOT_FRAMEWORK_SCOPE = 'https://api.botframework.com/.default';
const CUSTOMER_TEAMS_GRAPH_CHANNEL_WRITE_ALLOWED =
  process.env.ALLOW_CUSTOMER_TEAMS_GRAPH_CHANNEL_WRITE === 'true';

interface TeamsIntegration {
  customerTenantId: string;
  tenantId: string;
  teamsTenantId: string;
  teamsTeamId: string | null;
  serviceUrl: string;
  conversationId: string | null;
  installerAadId: string | null;
  bindingWorkspaceKey: string | null;
  channels: {
    deliverables: string | null;
    briefings: string | null;
    reports: string | null;
    dm_owner: string | null;
    general: string | null;
  };
}

async function getRunTenantId(runId: string | undefined): Promise<string | null> {
  if (!runId) return null;
  const runRows = await systemQuery<{ tenant_id: string | null }>(
    `SELECT tenant_id FROM agent_runs WHERE id = $1 LIMIT 1`,
    [runId],
  );
  return runRows[0]?.tenant_id ?? null;
}

async function getVerifiedTeamsIntegration(tenantId: string): Promise<TeamsIntegration | null> {
  const rows = await systemQuery<{
    id: string;
    tenant_id: string;
    teams_tenant_id: string;
    teams_team_id: string | null;
    teams_service_url: string;
    teams_conversation_id: string | null;
    teams_installer_aad_id: string | null;
    teams_binding_workspace_key: string | null;
    settings: Record<string, unknown>;
  }>(
    `SELECT id, tenant_id, teams_tenant_id, teams_team_id,
            teams_service_url, teams_conversation_id, teams_installer_aad_id,
            teams_binding_workspace_key, settings
       FROM customer_tenants
      WHERE tenant_id = $1
        AND teams_tenant_id IS NOT NULL
        AND teams_binding_status = 'verified'
        AND status = 'active'
      LIMIT 1`,
    [tenantId],
  );

  const row = rows[0];
  if (!row || !row.teams_service_url) return null;

  const expectedWorkspaceKey = canonicalTeamsWorkspaceKey(row.teams_tenant_id, row.teams_team_id);
  if (row.teams_binding_workspace_key && row.teams_binding_workspace_key !== expectedWorkspaceKey) {
    return null;
  }

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
    bindingWorkspaceKey: row.teams_binding_workspace_key,
    channels: {
      deliverables: channels['deliverables'] ?? null,
      briefings: channels['briefings'] ?? null,
      reports: channels['reports'] ?? null,
      dm_owner: row.teams_installer_aad_id,
      general: channels['general'] ?? null,
    },
  };
}

async function requireVerifiedTeamsContext(runId: string | undefined): Promise<{
  tenantId: string;
  integration: TeamsIntegration;
}> {
  const tenantId = await getRunTenantId(runId);
  if (!tenantId || isSystemTenantId(tenantId)) {
    throw new Error(
      'No verified customer tenant context is available for this run. ' +
      'Customer Teams delivery requires a verified Teams tenant binding.',
    );
  }

  const integration = await getVerifiedTeamsIntegration(tenantId);
  if (!integration) {
    throw new Error(
      `No verified Teams integration found for tenant ${tenantId}. ` +
      'Complete Teams tenant binding before attempting customer-facing Teams actions.',
    );
  }

  return { tenantId, integration };
}

async function acquireClientCredentialToken(tenantId: string, scope: string): Promise<string | null> {
  const clientId = process.env.AGENT365_CLIENT_ID?.trim();
  const clientSecret = process.env.AGENT365_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });

  const res = await fetch(tokenUrl, { method: 'POST', body });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

async function getCustomerBotToken(teamsTenantId: string): Promise<string | null> {
  return acquireClientCredentialToken(teamsTenantId, BOT_FRAMEWORK_SCOPE);
}

async function getCustomerTeamsGraphToken(teamsTenantId: string): Promise<string | null> {
  return acquireClientCredentialToken(teamsTenantId, GRAPH_SCOPE);
}

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

function resolveTarget(
  integration: TeamsIntegration,
  contextType: string,
): { type: 'channel'; channelId: string } | { type: 'conversation'; conversationId: string } | null {
  const ch = integration.channels;
  const preferChannel = CUSTOMER_TEAMS_GRAPH_CHANNEL_WRITE_ALLOWED && Boolean(integration.teamsTeamId);

  const choose = (channelId: string | null) => {
    if (preferChannel && channelId && integration.teamsTeamId) {
      return { type: 'channel' as const, channelId };
    }
    if (integration.conversationId) {
      return { type: 'conversation' as const, conversationId: integration.conversationId };
    }
    if (channelId && integration.teamsTeamId) {
      return { type: 'channel' as const, channelId };
    }
    return null;
  };

  switch (contextType) {
    case 'question':
      return integration.conversationId
        ? { type: 'conversation', conversationId: integration.conversationId }
        : null;
    case 'deliverable':
      return choose(ch.deliverables);
    case 'briefing':
      return choose(ch.briefings);
    case 'report':
      return choose(ch.reports);
    case 'update':
    default:
      return choose(ch.general);
  }
}

const requireVerifiedTeamsBinding = async (context: {
  runId?: string;
}): Promise<{ allow: boolean; reason?: string }> => {
  try {
    await requireVerifiedTeamsContext(context.runId);
    return { allow: true };
  } catch (err) {
    return { allow: false, reason: (err as Error).message };
  }
};

export function createTeamsOutputTools(): ToolDefinition[] {
  return [
    buildTool({
      name: 'post_to_customer_teams',
      description:
        'Post a message to the customer\'s Microsoft Teams workspace. Requires a verified Teams tenant binding. ' +
        'Customer channel posting via Graph is disabled by default; when channel write is not explicitly enabled, ' +
        'customer-facing output falls back to the verified install conversation.',
      parameters: {
        message: {
          type: 'string',
          description: 'The message to post. Plain text or basic markdown.',
          required: true,
        },
        context_type: {
          type: 'string',
          description: 'Content type — determines which delivery target receives the message.',
          required: true,
          enum: ['question', 'deliverable', 'briefing', 'report', 'update'],
        },
      },
      preHooks: [requireVerifiedTeamsBinding],
      execute: async (params, ctx): Promise<ToolResult> => {
        const message = (params.message as string ?? '').trim();
        const contextType = params.context_type as string ?? 'update';
        if (!message) {
          return { success: false, error: 'message is required' };
        }

        const { integration } = await requireVerifiedTeamsContext(ctx.runId);
        const target = resolveTarget(integration, contextType);
        if (!target) {
          return {
            success: false,
            error: `No verified Teams destination is configured for context_type="${contextType}".`,
          };
        }

        let result: { ok: boolean; error?: string };
        let deliveryPath: 'bot_framework' | 'graph_exception';
        if (target.type === 'conversation') {
          const token = await getCustomerBotToken(integration.teamsTenantId);
          if (!token) {
            return { success: false, error: 'Failed to acquire Bot Framework token for customer Teams delivery' };
          }
          result = await sendProactiveMessage(integration.serviceUrl, target.conversationId, message, token);
          deliveryPath = 'bot_framework';
        } else {
          if (!CUSTOMER_TEAMS_GRAPH_CHANNEL_WRITE_ALLOWED) {
            return {
              success: false,
              error:
                'Customer Teams channel posting is disabled until ALLOW_CUSTOMER_TEAMS_GRAPH_CHANNEL_WRITE=true ' +
                'is explicitly enabled for this environment.',
            };
          }
          if (!integration.teamsTeamId) {
            return { success: false, error: 'No Teams team id stored for this verified install.' };
          }
          const token = await getCustomerTeamsGraphToken(integration.teamsTenantId);
          if (!token) {
            return { success: false, error: 'Failed to acquire tenant-scoped Graph token for customer Teams channel post' };
          }
          result = await postToTeamsChannel(integration.teamsTeamId, target.channelId, message, token);
          deliveryPath = 'graph_exception';
        }

        if (!result.ok) {
          return { success: false, error: `Teams delivery failed: ${result.error}` };
        }

        return {
          success: true,
          data: {
            context_type: contextType,
            target_type: target.type,
            delivery_path: deliveryPath,
            binding_workspace_key: integration.bindingWorkspaceKey,
            note: `Message posted to verified customer Teams ${target.type}.`,
          },
        };
      },
    }),

    buildTool({
      name: 'request_teams_approval',
      description:
        'Send a deliverable to the customer for approval via Teams Adaptive Card buttons. ' +
        'Requires a verified Teams tenant binding and uses the verified install conversation.',
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
      preHooks: [requireVerifiedTeamsBinding],
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
        const { tenantId, integration } = await requireVerifiedTeamsContext(runId);
        if (!integration.conversationId) {
          return {
            success: false,
            error: 'No verified install conversation is stored for this Teams workspace.',
          };
        }

        const token = await getCustomerBotToken(integration.teamsTenantId);
        if (!token) {
          return { success: false, error: 'Failed to acquire Bot Framework token for Teams approval' };
        }

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
              binding_workspace_key: integration.bindingWorkspaceKey,
            }),
            integration.conversationId,
          ],
        );

        const approvalId = approvalRows[0]?.id;
        if (!approvalId) {
          return { success: false, error: 'Failed to create approval row' };
        }

        const AGENT_NAMES: Record<string, string> = {
          'chief-of-staff': 'Sarah', cmo: 'Maya', cto: 'Marcus',
          cfo: 'Nadia', cpo: 'Elena',
        };
        const agentName = AGENT_NAMES[agentRole] ?? agentRole;
        const costLine = estimatedCost ? ` — ${estimatedCost} est.` : '';

        const cardBody: Record<string, unknown>[] = [
          {
            type: 'TextBlock',
            text: agentName,
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
            delivery_path: 'bot_framework',
            binding_workspace_key: integration.bindingWorkspaceKey,
            note: 'Approval request sent to verified Teams workspace with Approve/Reject buttons.',
          },
        };
      },
    }),
  ];
}

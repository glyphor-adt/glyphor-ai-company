/**
 * Slash command handler — processes /glyphor commands from customer workspaces.
 *
 * Slack sends slash commands as URL-encoded POST bodies with fields:
 *   team_id, user_id, text, response_url, channel_id, command, trigger_id
 *
 * The handler:
 *   1. Identifies the tenant from team_id
 *   2. Persists the command as a customer_content row (source='slash_command')
 *   3. Creates a directive for the CoS/CMO to pick up
 *   4. Posts a threaded acknowledgement via response_url
 *
 * Special commands:
 *   - `/glyphor offboard confirm` revokes the workspace installation
 */
import { systemQuery } from '@glyphor/shared/db';
import { getCustomerTenantByTeamId } from './slackClient.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SlackCommandPayload {
  team_id: string;
  user_id: string;
  text: string;
  response_url: string;
  channel_id: string;
  command: string;
  trigger_id: string;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handleSlackCommand(payload: SlackCommandPayload): Promise<void> {
  const { team_id, user_id, text, response_url, channel_id } = payload;
  const commandText = text.trim();

  if (!commandText) {
    await respondToSlack(response_url, 'Usage: `/glyphor <instruction>` — e.g. `/glyphor brief the team on the Still You campaign`');
    return;
  }

  // 1. Find tenant
  const customerTenant = await getCustomerTenantByTeamId(team_id);
  if (!customerTenant) {
    await respondToSlack(response_url, "This workspace isn't connected to Glyphor yet. Ask your admin to install the Glyphor app.");
    return;
  }

  console.log(`[Slack] Command from ${user_id} in team=${team_id}: /glyphor ${commandText.slice(0, 80)}`);

  if (/^(offboard|disconnect)(?:\s+confirm)?$/i.test(commandText)) {
    if (!/confirm$/i.test(commandText)) {
      await respondToSlack(
        response_url,
        'This will revoke the Slack workspace connection. Run `/glyphor offboard confirm` to proceed.',
      );
      return;
    }

    await systemQuery(
      `UPDATE customer_tenants
       SET status = 'revoked',
           settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        customerTenant.id,
        JSON.stringify({
          onboarding_phase: 'offboarded',
          offboarded_at: new Date().toISOString(),
          offboarded_by: user_id,
        }),
      ],
    );

    await respondToSlack(
      response_url,
      'Workspace offboarded. The Slack app is now revoked for this tenant.',
    );

    console.log(`[Slack] Workspace offboarded for tenant=${customerTenant.id} by user=${user_id}`);
    return;
  }

  // 2. Persist as customer_content
  const contentRows = await systemQuery<{ id: string }>(
    `INSERT INTO customer_content
       (tenant_id, customer_tenant_id, kind, body, slack_channel_id, submitted_by, status,
        metadata)
     VALUES ($1, $2, 'snippet', $3, $4, $5, 'pending', $6)
     RETURNING id`,
    [
      customerTenant.tenant_id,
      customerTenant.id,
      commandText,
      channel_id,
      user_id,
      JSON.stringify({ source: 'slash_command', response_url }),
    ],
  );

  const contentId = contentRows[0]?.id;

  // 3. Create a directive for the agent fleet to pick up
  await systemQuery(
    `INSERT INTO customer_content
       (tenant_id, customer_tenant_id, kind, title, body, submitted_by, status,
        metadata)
     VALUES ($1, $2, 'note', 'Slack Command Directive', $3, $4, 'pending', $5)`,
    [
      customerTenant.tenant_id,
      customerTenant.id,
      commandText,
      user_id,
      JSON.stringify({
        source: 'slash_command',
        content_id: contentId,
        response_url,
        channel_id,
      }),
    ],
  );

  // 4. Acknowledge via response_url
  await respondToSlack(
    response_url,
    `Got it — I'm working on: *${commandText.length > 200 ? commandText.slice(0, 197) + '…' : commandText}*\nI'll post results when ready.`,
  );

  console.log(`[Slack] Command directive created for tenant=${customerTenant.id} content=${contentId}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function respondToSlack(responseUrl: string, text: string): Promise<void> {
  try {
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response_type: 'ephemeral', text }),
    });
  } catch (err) {
    console.error('[Slack] Failed to respond via response_url:', err);
  }
}

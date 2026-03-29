/**
 * Slack event handler — processes inbound Slack Events API payloads.
 *
 * Supported event types:
 *   app_mention      — Bot is @-mentioned in a channel
 *   message.im       — DM sent to the bot
 *   message.channels — Message posted in a channel the bot is in
 *   file_shared      — File shared in a workspace (queued for content ingestion)
 *
 * Each inbound message is:
 *   1. Persisted to customer_content (status='pending')
 *   2. Classified by routeMessage() into a destination + intent label
 *   3. If the routing rule requires approval, createApproval() posts an
 *      interactive Slack message and persists a slack_approvals row.
 *   4. Otherwise, Sarah sends the immediate acknowledgement in-thread.
 */
import { systemQuery } from '@glyphor/shared/db';
import { postMessage, publishHomeTab } from './slackClient.js';
import { routeMessage } from './router.js';
import { createApproval } from './approvalHandler.js';
import { handleOnboardingReply } from './onboardingHandler.js';
import type { DbCustomerTenant, SlackInnerEvent } from './types.js';

export async function handleSlackEvent(
  customerTenant: DbCustomerTenant,
  event: SlackInnerEvent,
): Promise<void> {
  const { type } = event;

  if (type === 'app_home_opened' && event.user) {
    await publishHomeTab(customerTenant.bot_token, event.user);
    return;
  }

  if (type === 'app_mention' || type === 'message') {
    await handleMessage(customerTenant, event);
    return;
  }

  if (type === 'file_shared') {
    await handleFileShared(customerTenant, event);
    return;
  }

  // Unknown event — log and ignore
  console.log(`[Slack] Unhandled event type: ${type} (team=${customerTenant.slack_team_id})`);
}

async function handleMessage(
  customerTenant: DbCustomerTenant,
  event: SlackInnerEvent,
): Promise<void> {
  // Ignore bot messages to avoid loops
  if (event.bot_id) return;

  const channel = event.channel;
  const text = (event.text ?? '').trim();
  const threadTs = event.thread_ts ?? event.ts;

  if (!channel || !text) return;

  console.log(`[Slack] Message from ${event.user} in ${channel}: ${text.slice(0, 80)}`);

  // 0. Check if this message is part of the onboarding questionnaire
  const isOnboarding = await handleOnboardingReply(customerTenant, channel, text);
  if (isOnboarding) return;

  // 1. Persist to customer_content
  const contentRows = await systemQuery<{ id: string }>(
    `INSERT INTO customer_content
       (tenant_id, customer_tenant_id, kind, body, slack_channel_id, slack_message_ts, submitted_by, status)
     VALUES ($1, $2, 'snippet', $3, $4, $5, $6, 'pending')
     RETURNING id`,
    [
      customerTenant.tenant_id,
      customerTenant.id,
      text,
      channel,
      event.ts ?? null,
      event.user ?? null,
    ],
  );

  const contentId = contentRows[0]?.id;

  // 2. Route the message
  const decision = await routeMessage(customerTenant.tenant_id, text);

  console.log(
    `[Slack] Routed team=${customerTenant.slack_team_id} → ` +
    `destination=${decision.destination} intent=${decision.intentLabel} ` +
    `approval=${decision.requiresApproval}`,
  );

  // 3a. Approval path — post interactive approval request instead of direct reply
  if (decision.requiresApproval && contentId) {
    await createApproval({
      customerTenant,
      contentId,
      decision,
      originalText: text,
      slackChannelId: channel,
      slackMessageTs: event.ts ?? '',
      submittedBy: event.user ?? null,
    });
    return;
  }

  // 3b. Direct acknowledgement with routing context
  const ackText = buildAckText(decision.destination, decision.intentLabel);
  await postMessage(customerTenant.bot_token, {
    channel,
    text: ackText,
    thread_ts: threadTs,
  }, { agentRole: 'chief-of-staff' });

  // Mark content as processing now that it has been routed
  if (contentId) {
    await systemQuery(
      `UPDATE customer_content SET status = 'processing', updated_at = NOW() WHERE id = $1`,
      [contentId],
    );
  }
}

async function handleFileShared(
  customerTenant: DbCustomerTenant,
  event: SlackInnerEvent,
): Promise<void> {
  const files = event.files ?? [];
  for (const file of files) {
    console.log(`[Slack] File shared: ${file.name} (${file.mimetype}, ${file.size} bytes)`);

    await systemQuery(
      `INSERT INTO customer_content
         (tenant_id, customer_tenant_id, kind, body, slack_channel_id, slack_file_id,
          title, mime_type, byte_size, submitted_by, status)
       VALUES ($1, $2, 'file', '', $3, $4, $5, $6, $7, $8, 'pending')`,
      [
        customerTenant.tenant_id,
        customerTenant.id,
        event.channel ?? null,
        file.id,
        file.name,
        file.mimetype,
        file.size,
        event.user ?? null,
      ],
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildAckText(destination: string, intentLabel: string): string {
  const teamLabel: Record<string, string> = {
    'chief-of-staff': 'Sarah',
    billing: 'billing team',
    engineering: 'engineering team',
    sales: 'sales team',
    support: 'support team',
    general: 'team',
  };
  const label = teamLabel[destination] ?? 'team';
  const intentMap: Record<string, string> = {
    coordinator_intake: 'request',
    billing_inquiry: 'billing question',
    bug_report: 'technical issue',
    sales_inquiry: 'question about plans',
    escalation: 'concern',
    general_inquiry: 'question',
  };
  const friendly = intentMap[intentLabel] ?? 'message';
  if (destination === 'chief-of-staff') {
    return `Sarah is on it. She’ll review your ${friendly} and route it to the right team.`;
  }
  return `Got it — I've forwarded your ${friendly} to the ${label} and someone will follow up shortly.`;
}

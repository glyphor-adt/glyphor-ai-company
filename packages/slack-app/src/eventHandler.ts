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
 *   1. Checked against onboarding flow first
 *   2. Routed to Sarah as a directive for triage
 *   3. Queued in agent_wake_queue for chief-of-staff processing
 *   4. Given a delayed fallback acknowledgement if no run starts
 */
import { systemQuery, systemTransaction } from '@glyphor/shared/db';
import { postMessage, publishHomeTab } from './slackClient.js';
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
  // Ignore bot messages and non-user message mutations
  const subtype = typeof event.subtype === 'string' ? event.subtype : undefined;
  if (event.bot_id || subtype === 'bot_message') return;
  if (subtype === 'message_changed' || subtype === 'message_deleted') return;

  const channel = event.channel;
  const text = (event.text ?? '').trim();

  if (!channel || !text) return;

  console.log(`[Slack] Message from ${event.user} in ${channel}: ${text.slice(0, 80)}`);

  // 0. Check if this message is part of the onboarding questionnaire
  const isOnboarding = await handleOnboardingReply(customerTenant, channel, text);
  if (isOnboarding) return;

  await routeToChiefOfStaff(customerTenant, event, text);
}

async function routeToChiefOfStaff(
  customerTenant: DbCustomerTenant,
  event: SlackInnerEvent,
  text: string,
): Promise<void> {
  try {
    const directiveId = await systemTransaction(async (db) => {
      const createdBy = `slack:${event.user ?? 'unknown-user'}`;
      const title = `Slack message from ${event.user ?? 'unknown-user'}`;
      const reason = `Slack directive from ${event.user ?? 'unknown-user'} in ${event.channel ?? 'unknown-channel'}`;

      const directiveResult = await db.query<{ id: string }>(
        `INSERT INTO founder_directives
           (tenant_id, title, description, priority, category, status, created_by, target_agents, source)
         VALUES ($1, $2, $3, 'high', 'general', 'active', $4, ARRAY['chief-of-staff'], 'external_a2a')
         RETURNING id`,
        [customerTenant.tenant_id, title, text, createdBy],
      );

      const insertedDirectiveId = directiveResult.rows[0]?.id ?? null;

      await db.query(
        `INSERT INTO agent_wake_queue (agent_role, task, reason, context)
         VALUES ('chief-of-staff', 'process_directive', $1, $2::jsonb)`,
        [
          reason,
          JSON.stringify({
            directive_id: insertedDirectiveId,
            tenant_id: customerTenant.tenant_id,
            source: 'slack_message',
            user_id: event.user ?? null,
            channel: event.channel ?? null,
            text,
            ts: event.ts ?? null,
          }),
        ],
      );

      return insertedDirectiveId;
    });

    console.log(
      `[Slack] Created founder directive ${directiveId ?? 'unknown'} and queued chief-of-staff wake ` +
      `(team=${customerTenant.slack_team_id})`,
    );
  } catch (error) {
    console.error('[Slack] Failed to create founder directive:', error);
    return;
  }

  const channel = event.channel;
  const ts = event.ts;
  if (!channel || !ts) return;

  // 8-second slow-ack fallback if no recent chief-of-staff run is detected.
  setTimeout(() => {
    void sendSlowAckFallback(customerTenant, channel, ts);
  }, 8000);
}

async function sendSlowAckFallback(
  customerTenant: DbCustomerTenant,
  channel: string,
  ts: string,
): Promise<void> {
  try {
    const recentRuns = await systemQuery<{ id: string }>(
      `SELECT id
       FROM agent_runs
       WHERE agent_id = 'chief-of-staff'
         AND created_at > NOW() - INTERVAL '8 seconds'
       LIMIT 1`,
      [],
    );

    if (recentRuns.length === 0) {
      await postMessage(customerTenant.bot_token, {
        channel,
        thread_ts: ts,
        text: 'On it.',
      });
    }
  } catch (e) {
    console.error('[Slack] Slow ack fallback failed:', e);
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


/**
 * Onboarding handler — connection card flow after OAuth install.
 *
 * Flow:
 *   1. OAuth completes → startOnboarding() DMs Sarah's intro and the live connection card
 *   2. Customer clicks "Connect Website" → modal opens for URL input
 *   3. URL submitted → triggerWebsiteIngestion() scrapes, extracts brand signals
 *   4. Sarah introduces the team first; Maya follows after source ingestion
 *   5. Marketing department agents provisioned, work begins
 *
 * Also handles a single channel-setup reply:
 *   After ingestion, Maya asks "Which channel should completed work go to?"
 *   The reply sets settings.channels.deliverables.
 *
 * State is tracked in customer_tenants.settings:
 *   { "onboarding_phase": "awaiting_connect" | "awaiting_channel" | "complete",
 *     "onboarding_dm": "D...", "installer_user_id": "U..." }
 */
import { systemQuery } from '@glyphor/shared/db';
import { postMessage, openDM } from './slackClient.js';
import { provisionMarketingDepartment } from './tenantProvisioning.js';
import type { DbCustomerTenant } from './types.js';

const DEFAULT_SCHEDULER_URL = 'https://glyphor-scheduler-610179349713.us-central1.run.app';

// ─── Start onboarding — post connection card ─────────────────────────────────

export async function startOnboarding(
  customerTenantId: string,
  botToken: string,
  installerUserId: string,
): Promise<void> {
  const dmResult = await openDM(botToken, installerUserId);
  if (!dmResult.ok || !dmResult.channelId) {
    console.error(`[Onboarding] Failed to open DM with ${installerUserId}`);
    return;
  }

  const dmChannelId = dmResult.channelId;

  await postMessage(botToken, {
    channel: dmChannelId,
    text: 'Sarah here. I’ll introduce the team and then Maya will analyze whatever you connect.',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Sarah Chen, Chief of Staff*\nI’ll get you oriented, then Maya will review the sources you connect and ask for anything still missing.',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Glyphor team*\n• *Sarah* — Chief of Staff: coordinates onboarding and keeps the team aligned.\n• *Maya* — CMO: analyzes your connected sources and turns them into brand and marketing direction.\n• *Marcus* — CTO: handles platform and technical execution.\n• *Nadia* — CFO: handles costs, operating discipline, and financial planning.\n• *Elena* — CPO: handles product direction and roadmap.',
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'Website connection is live today. LinkedIn and Google Drive are not live yet and will be added separately.',
          },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Connect Website' },
            action_id: 'connect_website',
            value: customerTenantId,
          },
        ],
      },
    ],
  });

  await systemQuery(
    `UPDATE customer_tenants
     SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [
      customerTenantId,
      JSON.stringify({
        onboarding_phase: 'awaiting_connect',
        onboarding_dm: dmChannelId,
        installer_user_id: installerUserId,
        channels: { dm_owner: dmChannelId },
      }),
    ],
  );

  console.log(`[Onboarding] Connection card sent for tenant=${customerTenantId} dm=${dmChannelId}`);
}

// ─── Handle reply during onboarding (channel setup) ──────────────────────────

/**
 * Returns true if this message was consumed by the onboarding flow,
 * false if it should be processed normally.
 */
export async function handleOnboardingReply(
  customerTenant: DbCustomerTenant,
  channel: string,
  text: string,
): Promise<boolean> {
  const settings = customerTenant.settings ?? {};
  const phase = settings['onboarding_phase'] as string | undefined;
  const onboardingDm = settings['onboarding_dm'] as string | undefined;

  if (!phase || !onboardingDm || channel !== onboardingDm) return false;

  if (phase === 'awaiting_channel') {
    const channelName = text.trim().replace(/^#/, '');
    const existingChannels = (settings['channels'] as Record<string, string | null>) ?? {};

    await systemQuery(
      `UPDATE customer_tenants
       SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        customerTenant.id,
        JSON.stringify({
          onboarding_phase: 'complete',
          channels: { ...existingChannels, deliverables: channelName },
        }),
      ],
    );

    await postMessage(customerTenant.bot_token, {
      channel: onboardingDm,
      text: `Got it — deliverables will go to #${channelName}.`,
    });

    console.log(`[Onboarding] Channel set to #${channelName} for tenant=${customerTenant.id}`);
    return true;
  }

  return false;
}

// ─── Website ingestion trigger ───────────────────────────────────────────────

export async function triggerWebsiteIngestion(
  customerTenantId: string,
  url: string,
): Promise<void> {
  const rows = await systemQuery<DbCustomerTenant>(
    `SELECT * FROM customer_tenants WHERE id = $1 AND status = 'active' LIMIT 1`,
    [customerTenantId],
  );
  const ct = rows[0];
  if (!ct) {
    console.error(`[Onboarding] Tenant not found: ${customerTenantId}`);
    return;
  }

  const dmChannel = ((ct.settings ?? {})['onboarding_dm'] as string) ?? null;

  if (dmChannel) {
    await postMessage(ct.bot_token, {
      channel: dmChannel,
      text: `Reading ${url} now. This will take a minute.`,
    });
  }

  // Store URL as customer_knowledge entry
  await systemQuery(
    `INSERT INTO customer_knowledge
       (tenant_id, section, title, content, content_type, audience, tags, is_active, version, last_edited_by)
     VALUES ($1, 'source', 'Website URL', $2, 'text', 'all', ARRAY['onboarding', 'website'], true, 1, 'onboarding')
     ON CONFLICT DO NOTHING`,
    [ct.tenant_id, url],
  );

  // Dispatch scrape_website to the scheduler for the CMO agent
  const schedulerUrl = process.env.SCHEDULER_URL?.trim() || (
    process.env.NODE_ENV === 'production' ? DEFAULT_SCHEDULER_URL : 'http://localhost:8080'
  );
  const schedulerEndpoint = `${schedulerUrl.replace(/\/$/, '')}/run`;
  try {
    const res = await fetch(schedulerEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentRole: 'cmo',
        task: 'onboarding_ingestion',
        message: `Scrape the customer website at ${url}, extract brand signals, synthesize a company brief, then send the first message. Tenant: ${ct.tenant_id}`,
        payload: {
          tenant_id: ct.tenant_id,
          customer_tenant_id: customerTenantId,
          website_url: url,
          onboarding: true,
        },
      }),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Scheduler responded ${res.status}${errorText ? `: ${errorText.slice(0, 200)}` : ''}`);
    }

    console.log(`[Onboarding] Website ingestion dispatched for ${url} tenant=${ct.tenant_id} via ${schedulerEndpoint}`);
  } catch (err) {
    console.error(`[Onboarding] Failed to dispatch website ingestion:`, err);
    if (dmChannel) {
      await postMessage(ct.bot_token, {
        channel: dmChannel,
        text: 'Something went wrong starting the website analysis. Retrying shortly.',
      });
    }
  }

  // Transition to awaiting_channel phase
  await systemQuery(
    `UPDATE customer_tenants
     SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [
      customerTenantId,
      JSON.stringify({ onboarding_phase: 'awaiting_channel' }),
    ],
  );

  // Provision the marketing department
  await provisionMarketingDepartment(ct.tenant_id);

  // Ask the channel question
  if (dmChannel) {
    await postMessage(ct.bot_token, {
      channel: dmChannel,
      text: 'Which channel should completed work go to? (e.g. #marketing)',
    });
  }
}

import { sendTeamsWebhook, type AdaptiveCard, type TeamsWebhookPayload } from '@glyphor/integrations';
import { systemQuery } from '@glyphor/shared/db';
import type { AgentNotifier } from './agentNotifier.js';
import { getEconomicsQualityOverview } from './metricsAdminApi.js';

function economicsNotifyWindowDays(): 7 | 30 | 90 {
  const raw = Number(process.env.ECONOMICS_GUARD_ALERT_WINDOW_DAYS ?? '30');
  if (raw === 7 || raw === 30 || raw === 90) return raw;
  return 30;
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(3)}`;
}

function buildEconomicsAdaptivePayload(
  alerts: string[],
  windowDays: number,
  fleet: {
    runCompletionRate: number;
    avgCostUsdPerCompleted: number | null;
    p95LatencyMinutes: number | null;
    gatePassRate: number;
    sumCostUsdRecorded: number;
  },
): TeamsWebhookPayload {
  const facts = [
    { title: 'Window', value: `${windowDays}d` },
    { title: 'Run completion', value: `${(fleet.runCompletionRate * 100).toFixed(1)}%` },
    { title: 'Avg $ / completed run', value: formatUsd(fleet.avgCostUsdPerCompleted) },
    { title: 'P95 latency', value: fleet.p95LatencyMinutes != null ? `${fleet.p95LatencyMinutes.toFixed(1)} min` : '—' },
    { title: 'Gate pass (fleet)', value: `${(fleet.gatePassRate * 100).toFixed(1)}%` },
    { title: 'Σ cost recorded', value: formatUsd(fleet.sumCostUsdRecorded) },
  ];

  const alertBlocks = alerts.map((text) => ({
    type: 'TextBlock' as const,
    text: `• ${text}`,
    wrap: true,
    color: 'warning' as const,
    spacing: 'small' as const,
  }));

  const card: AdaptiveCard = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      {
        type: 'TextBlock',
        text: 'Glyphor — economics guardrails',
        size: 'large',
        weight: 'bolder',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: 'One or more ECONOMICS_ALERT_* thresholds were breached. Review Governance → Reliability → Stage 5.',
        size: 'small',
        wrap: true,
      },
      { type: 'FactSet', facts },
      { type: 'TextBlock', text: 'Alerts', weight: 'bolder', wrap: true, spacing: 'medium' },
      ...alertBlocks,
    ],
  };

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: card,
      },
    ],
  };
}

/** Legacy Office 365 connector MessageCard (set TEAMS_ECONOMICS_USE_LEGACY_MESSAGE_CARD=true). */
async function postLegacyMessageCard(webhookUrl: string, title: string, text: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      themeColor: 'FF8C00',
      summary: title,
      title,
      text,
    }),
  });
  if (!response.ok) {
    const t = await response.text();
    throw new Error(`Teams legacy webhook failed (${response.status}): ${t}`);
  }
}

export interface EconomicsGuardrailNotifyResult {
  success: boolean;
  windowDays: number;
  alertCount: number;
  notified: boolean;
  teamsDelivery: 'incoming_webhook' | 'legacy_webhook' | 'agent_notifier' | 'none';
  error?: string;
}

/**
 * Evaluates economics guardrails and posts to Teams when breached.
 *
 * Delivery order:
 * 1. `TEAMS_ECONOMICS_ALERT_WEBHOOK_URL` — Incoming Webhook (Adaptive Card by default; legacy MessageCard if TEAMS_ECONOMICS_USE_LEGACY_MESSAGE_CARD=true).
 * 2. Else `AgentNotifier` — same path as planning-gate (#briefings / DM fallback).
 *
 * Optional: `TEAMS_ECONOMICS_WEBHOOK_BEARER_TOKEN` for Power Platform–style webhook URLs.
 */
export async function runEconomicsGuardrailNotify(agentNotifier: AgentNotifier): Promise<EconomicsGuardrailNotifyResult> {
  const windowDays = economicsNotifyWindowDays();
  let overview: Awaited<ReturnType<typeof getEconomicsQualityOverview>>;
  try {
    overview = await getEconomicsQualityOverview(windowDays);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      windowDays,
      alertCount: 0,
      notified: false,
      teamsDelivery: 'none',
      error: message,
    };
  }

  if (overview.alerts.length === 0) {
    return {
      success: true,
      windowDays,
      alertCount: 0,
      notified: false,
      teamsDelivery: 'none',
    };
  }

  const summary = overview.alerts.join(' | ');
  const webhookUrl = process.env.TEAMS_ECONOMICS_ALERT_WEBHOOK_URL?.trim();
  const bearer = process.env.TEAMS_ECONOMICS_WEBHOOK_BEARER_TOKEN?.trim();
  const legacy = process.env.TEAMS_ECONOMICS_USE_LEGACY_MESSAGE_CARD?.trim().toLowerCase() === 'true';

  let teamsDelivery: EconomicsGuardrailNotifyResult['teamsDelivery'] = 'none';

  try {
    if (webhookUrl) {
      if (legacy) {
        const text = [
          `**Window:** ${windowDays}d`,
          `**Run completion:** ${(overview.fleet.runCompletionRate * 100).toFixed(1)}%`,
          `**Gate pass:** ${(overview.fleet.gatePassRate * 100).toFixed(1)}%`,
          '',
          ...overview.alerts.map((a) => `• ${a}`),
        ].join('\n');
        await postLegacyMessageCard(webhookUrl, 'Glyphor economics guardrails', text);
        teamsDelivery = 'legacy_webhook';
      } else {
        await sendTeamsWebhook(
          webhookUrl,
          buildEconomicsAdaptivePayload(overview.alerts, windowDays, overview.fleet),
          bearer || undefined,
        );
        teamsDelivery = 'incoming_webhook';
      }
    } else {
      const notifyBlock = [
        `<notify type="blocker" to="both" title="Economics guardrail breach">`,
        ...overview.alerts,
        '',
        `Window: ${windowDays}d`,
        `Run completion: ${Math.round(overview.fleet.runCompletionRate * 100)}%`,
        `Avg cost/completed: ${formatUsd(overview.fleet.avgCostUsdPerCompleted)}`,
        `P95 latency: ${overview.fleet.p95LatencyMinutes != null ? `${overview.fleet.p95LatencyMinutes.toFixed(1)} min` : '—'}`,
        `Gate pass: ${Math.round(overview.fleet.gatePassRate * 100)}%`,
        `Set TEAMS_ECONOMICS_ALERT_WEBHOOK_URL to post a dedicated channel card without AgentNotifier.`,
        `</notify>`,
      ].join('\n');
      await agentNotifier.processAgentOutput('ops', notifyBlock);
      teamsDelivery = 'agent_notifier';
    }

    await systemQuery(
      `INSERT INTO activity_log (agent_role, action, summary, details, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        'ops',
        'economics_guardrail.alert',
        summary,
        JSON.stringify({
          window_days: windowDays,
          teams_delivery: teamsDelivery,
          alerts: overview.alerts,
          fleet: overview.fleet,
        }),
      ],
    );

    return {
      success: true,
      windowDays,
      alertCount: overview.alerts.length,
      notified: true,
      teamsDelivery,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[EconomicsGuardrailNotify] Failed:', message);
    try {
      await systemQuery(
        `INSERT INTO activity_log (agent_role, action, summary, details, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [
          'ops',
          'economics_guardrail.notify_failed',
          summary,
          JSON.stringify({ error: message, alerts: overview.alerts }),
        ],
      );
    } catch {
      // ignore log failure
    }
    return {
      success: false,
      windowDays,
      alertCount: overview.alerts.length,
      notified: false,
      teamsDelivery,
      error: message,
    };
  }
}

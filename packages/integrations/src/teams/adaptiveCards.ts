/**
 * Teams Adaptive Card Templates
 *
 * Rich message cards for briefings, decisions, and alerts.
 */

import type {
  TeamsWebhookPayload,
  AdaptiveCard,
  AdaptiveCardElement,
} from './webhooks.js';

// ─── BRIEFING CARD ──────────────────────────────────────────────

export interface BriefingCardData {
  recipient: string;
  date: string;
  metrics: Array<{ label: string; value: string; trend: 'up' | 'down' | 'flat' }>;
  markdown: string;
  actionItems: string[];
}

const TREND_ICONS: Record<string, string> = {
  up: '📈',
  down: '📉',
  flat: '➡️',
};

export function formatBriefingCard(data: BriefingCardData): TeamsWebhookPayload {
  const metricColumns = data.metrics.slice(0, 4).map((m) => ({
    type: 'Column' as const,
    width: 'stretch',
    items: [
      {
        type: 'TextBlock' as const,
        text: m.label,
        size: 'small',
        color: 'accent',
        wrap: true,
      },
      {
        type: 'TextBlock' as const,
        text: `${m.value} ${TREND_ICONS[m.trend]}`,
        size: 'large',
        weight: 'bolder',
        wrap: true,
      },
    ] as AdaptiveCardElement[],
  }));

  const body: AdaptiveCardElement[] = [
    // Header
    {
      type: 'TextBlock',
      text: `☀️ Good Morning, ${capitalize(data.recipient)}`,
      size: 'large',
      weight: 'bolder',
      wrap: true,
    },
    {
      type: 'TextBlock',
      text: `Glyphor Daily Briefing — ${data.date}`,
      size: 'small',
      color: 'accent',
      wrap: true,
      spacing: 'none',
    },

    // Metrics strip
    {
      type: 'ColumnSet',
      columns: metricColumns,
    },

    // Separator
    {
      type: 'TextBlock',
      text: '',
      separator: true,
      spacing: 'medium',
      wrap: true,
    },

    // Main briefing content
    {
      type: 'TextBlock',
      text: data.markdown,
      wrap: true,
    },
  ];

  // Action items section
  if (data.actionItems.length > 0) {
    body.push(
      {
        type: 'TextBlock',
        text: '⚡ Action Required',
        size: 'medium',
        weight: 'bolder',
        color: 'attention',
        separator: true,
        wrap: true,
      },
      ...data.actionItems.map(
        (item): AdaptiveCardElement => ({
          type: 'TextBlock',
          text: `• ${item}`,
          wrap: true,
        }),
      ),
    );
  }

  const card: AdaptiveCard = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body,
    actions: [
      {
        type: 'Action.OpenUrl',
        title: '🔗 Open Dashboard',
        url: process.env.DASHBOARD_URL || 'https://dashboard.glyphor.com',
      },
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

// ─── DECISION CARD ──────────────────────────────────────────────

export interface DecisionCardData {
  id: string;
  tier: string;
  title: string;
  summary: string;
  proposedBy: string;
  reasoning: string;
  assignedTo: string[];
}

const TIER_COLORS: Record<string, string> = {
  yellow: 'warning',
  red: 'attention',
};

const TIER_LABELS: Record<string, string> = {
  yellow: '🟡 YELLOW — One Founder Approval Needed',
  red: '🔴 RED — Both Founders Required',
};

export function formatDecisionCard(data: DecisionCardData): TeamsWebhookPayload {
  const body: AdaptiveCardElement[] = [
    {
      type: 'TextBlock',
      text: TIER_LABELS[data.tier] || `Decision: ${data.tier}`,
      size: 'medium',
      weight: 'bolder',
      color: TIER_COLORS[data.tier] || 'default',
      wrap: true,
    },
    {
      type: 'TextBlock',
      text: data.title,
      size: 'large',
      weight: 'bolder',
      wrap: true,
    },
    {
      type: 'FactSet',
      facts: [
        { title: 'Proposed by', value: data.proposedBy },
        { title: 'Assigned to', value: data.assignedTo.join(', ') },
        { title: 'Decision ID', value: data.id },
      ],
    },
    {
      type: 'TextBlock',
      text: '**Summary**',
      weight: 'bolder',
      separator: true,
      wrap: true,
    },
    {
      type: 'TextBlock',
      text: data.summary,
      wrap: true,
    },
    {
      type: 'TextBlock',
      text: '**Reasoning**',
      weight: 'bolder',
      separator: true,
      wrap: true,
    },
    {
      type: 'TextBlock',
      text: data.reasoning,
      wrap: true,
    },
  ];

  const card: AdaptiveCard = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body,
    actions: [
      {
        type: 'Action.OpenUrl',
        title: '🔗 View in Dashboard',
        url: `${process.env.DASHBOARD_URL || 'https://dashboard.glyphor.com'}/decisions`,
      },
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

// ─── ALERT CARD ─────────────────────────────────────────────────

export interface AlertCardData {
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  agent: string;
  product?: string;
}

const SEVERITY_ICONS: Record<string, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  critical: '🚨',
};

export function formatAlertCard(data: AlertCardData): TeamsWebhookPayload {
  const card: AdaptiveCard = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      {
        type: 'TextBlock',
        text: `${SEVERITY_ICONS[data.severity]} ${data.title}`,
        size: 'medium',
        weight: 'bolder',
        color: data.severity === 'critical' ? 'attention' : data.severity === 'warning' ? 'warning' : 'accent',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: data.message,
        wrap: true,
      },
      {
        type: 'FactSet',
        facts: [
          { title: 'Agent', value: data.agent },
          ...(data.product ? [{ title: 'Product', value: data.product }] : []),
          { title: 'Time', value: new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }) },
        ],
      },
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

// ─── UTILS ──────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Teams Adaptive Card Templates
 *
 * Rich message cards for briefings, decisions, and alerts.
 */

import type {
  TeamsWebhookPayload,
  AdaptiveCard,
  AdaptiveCardAction,
  AdaptiveCardElement,
} from './webhooks.js';

export type { AdaptiveCard, AdaptiveCardAction, AdaptiveCardElement };

// ─── BRIEFING CARD ──────────────────────────────────────────────

export interface BriefingCardData {
  recipient: string;
  date: string;
  metrics: Array<{ label: string; value: string; trend: 'up' | 'down' | 'flat' }>;
  markdown: string;
  actionItems: string[];
}

const DASHBOARD_BASE_URL = (process.env.DASHBOARD_URL || 'https://dashboard.glyphor.com').replace(/\/$/, '');

function dashboardUrl(path: string = ''): string {
  if (!path) return DASHBOARD_BASE_URL;
  return `${DASHBOARD_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

const TREND_ICONS: Record<string, string> = {
  up: '(up)',
  down: '(down)',
  flat: '(flat)',
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
    {
      type: 'TextBlock',
      text: `GLYPHOR DAILY BRIEF — ${data.date}`,
      size: 'large',
      weight: 'bolder',
      wrap: true,
    },
    {
      type: 'TextBlock',
      text: `Prepared by Sarah Chen, Chief of Staff · ${capitalize(data.recipient)}`,
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
        text: 'Action Required',
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
        title: 'Open Dashboard',
        url: dashboardUrl('/'),
      },
      {
        type: 'Action.OpenUrl',
        title: 'View Operations',
        url: dashboardUrl('/operations'),
      },
      {
        type: 'Action.OpenUrl',
        title: 'New Directive',
        url: dashboardUrl('/directives'),
      },
      {
        type: 'Action.OpenUrl',
        title: 'Chat with Ora',
        url: dashboardUrl('/ora'),
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
  actionMode?: 'openUrl' | 'execute' | 'none';
}

const TIER_COLORS: Record<string, string> = {
  yellow: 'warning',
  red: 'attention',
};

const TIER_LABELS: Record<string, string> = {
  yellow: 'YELLOW DECISION',
  red: 'RED DECISION',
};

export function formatDecisionCard(data: DecisionCardData): TeamsWebhookPayload {
  const actionMode = data.actionMode ?? 'openUrl';
  const body: AdaptiveCardElement[] = [
    {
      type: 'TextBlock',
      text: `${data.tier === 'red' ? '🔴' : '🟡'} ${TIER_LABELS[data.tier] || `Decision: ${data.tier}`}`,
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
    actions: actionMode === 'execute'
      ? [
          {
            type: 'Action.Execute',
            title: 'Approve',
            verb: 'decision.approve',
            data: { decisionId: data.id },
          },
          {
            type: 'Action.Execute',
            title: 'Reject',
            verb: 'decision.reject',
            data: { decisionId: data.id },
          },
          {
            type: 'Action.OpenUrl',
            title: 'View Full',
            url: dashboardUrl(`/approvals?decision=${encodeURIComponent(data.id)}`),
          },
        ]
      : actionMode === 'none'
        ? [
            {
              type: 'Action.OpenUrl',
              title: 'View Full',
              url: dashboardUrl(`/approvals?decision=${encodeURIComponent(data.id)}`),
            },
          ]
        : [
            {
              type: 'Action.OpenUrl',
              title: 'Approve',
              url: dashboardUrl(`/approvals?decision=${encodeURIComponent(data.id)}&decisionAction=approve`),
            },
            {
              type: 'Action.OpenUrl',
              title: 'Reject',
              url: dashboardUrl(`/approvals?decision=${encodeURIComponent(data.id)}&decisionAction=reject`),
            },
            {
              type: 'Action.OpenUrl',
              title: 'View Full',
              url: dashboardUrl(`/approvals?decision=${encodeURIComponent(data.id)}`),
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
  info: '[info]',
  warning: '[warning]',
  critical: '[critical]',
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

// ─── AGENT NOTIFICATION CARD ────────────────────────────────────

export type NotificationType = 'update' | 'question' | 'blocker' | 'completed' | 'fyi';

export interface NotificationCardData {
  type: NotificationType;
  agent: string;
  agentRole: string;
  title: string;
  message: string;
  /** Optional action options for questions/blockers */
  options?: string[];
}

const NOTIFICATION_ICONS: Record<NotificationType, string> = {
  update: '📋',
  question: '❓',
  blocker: '🚫',
  completed: '✅',
  fyi: 'ℹ️',
};

const NOTIFICATION_COLORS: Record<NotificationType, string> = {
  update: 'accent',
  question: 'warning',
  blocker: 'attention',
  completed: 'good',
  fyi: 'default',
};

export function formatNotificationCard(data: NotificationCardData): TeamsWebhookPayload {
  const icon = NOTIFICATION_ICONS[data.type];
  const color = NOTIFICATION_COLORS[data.type];

  const body: AdaptiveCardElement[] = [
    {
      type: 'TextBlock',
      text: `${icon} ${data.title}`,
      size: 'medium',
      weight: 'bolder',
      color,
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
        { title: 'From', value: data.agent },
        { title: 'Type', value: capitalize(data.type) },
        { title: 'Time', value: new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }) },
      ],
    },
  ];

  if (data.options?.length) {
    body.push({
      type: 'TextBlock',
      text: '**Options:**',
      wrap: true,
    } as AdaptiveCardElement);
    for (const opt of data.options) {
      body.push({
        type: 'TextBlock',
        text: `• ${opt}`,
        wrap: true,
      } as AdaptiveCardElement);
    }
  }

  const card: AdaptiveCard = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body,
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

// ─── DIRECTIVE PROPOSAL CARD ────────────────────────────────────

export interface DirectiveProposalCardData {
  directiveId: string;
  title: string;
  description: string;
  priority: string;
  category: string;
  targetAgents: string[];
  proposalReason: string;
  dueDate?: string;
  approveUrl: string;
  rejectUrl: string;
}

export function formatDirectiveProposalCard(data: DirectiveProposalCardData): AdaptiveCard {
  const priorityColor: Record<string, string> = {
    critical: 'Attention',
    high: 'Warning',
    medium: 'Accent',
    low: 'Good',
  };
  const color = priorityColor[data.priority] ?? 'Default';

  const facts = [
    { title: 'Priority', value: data.priority.toUpperCase() },
    { title: 'Category', value: capitalize(data.category.replace(/_/g, ' ')) },
    { title: 'Agents', value: data.targetAgents.join(', ') },
  ];
  if (data.dueDate) {
    facts.push({ title: 'Suggested Deadline', value: data.dueDate });
  }

  const body: AdaptiveCardElement[] = [
    {
      type: 'Container',
      style: 'emphasis',
      items: [
        {
          type: 'TextBlock',
          text: '📋 Directive Proposal — Decision Needed',
          weight: 'bolder',
          size: 'small',
          color: 'accent',
          wrap: true,
        } as AdaptiveCardElement,
        {
          type: 'TextBlock',
          text: data.title,
          weight: 'bolder',
          size: 'large',
          color,
          wrap: true,
        } as AdaptiveCardElement,
        {
          type: 'TextBlock',
          text: `Proposed by Sarah Chen, Chief of Staff`,
          size: 'small',
          color: 'accent',
          spacing: 'none',
          wrap: true,
        } as AdaptiveCardElement,
      ],
    } as AdaptiveCardElement,
    {
      type: 'FactSet',
      facts,
    } as AdaptiveCardElement,
    {
      type: 'TextBlock',
      text: '**Why this is needed**',
      weight: 'bolder',
      size: 'small',
      spacing: 'medium',
      wrap: true,
    } as AdaptiveCardElement,
    {
      type: 'TextBlock',
      text: data.proposalReason,
      wrap: true,
      size: 'small',
    } as AdaptiveCardElement,
    {
      type: 'TextBlock',
      text: '**Scope**',
      weight: 'bolder',
      size: 'small',
      spacing: 'medium',
      wrap: true,
    } as AdaptiveCardElement,
    {
      type: 'TextBlock',
      text: data.description,
      wrap: true,
      size: 'small',
    } as AdaptiveCardElement,
    {
      type: 'TextBlock',
      text: `Directive ID: ${data.directiveId} · Expires in 48h`,
      size: 'small',
      color: 'accent',
      spacing: 'medium',
      wrap: true,
    } as AdaptiveCardElement,
  ];

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body,
    actions: [
      {
        type: 'Action.OpenUrl',
        title: '✓ Approve Directive',
        url: data.approveUrl,
      } as AdaptiveCardAction,
      {
        type: 'Action.OpenUrl',
        title: '✕ Reject Directive',
        url: data.rejectUrl,
      } as AdaptiveCardAction,
    ],
  };
}

// ─── UTILS ──────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

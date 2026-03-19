/**
 * Nexus — Teams Adaptive Card Builders
 *
 * Builds Adaptive Cards for approval requests and daily reports,
 * delivered to founders via the existing Teams proactive DM infrastructure.
 */

export interface ApprovalCardParams {
  title: string;
  rationale: string;
  actionDescription: string;
  impact: string;
  urgency: 'low' | 'medium' | 'high';
  targetAgent?: string;
  approveUrl: string;
  rejectUrl: string;
  actionId: string;
}

export interface PlatformIntelReport {
  gtmStatus: 'READY' | 'NOT_READY' | 'INSUFFICIENT_DATA';
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  autonomousActionsCount: number;
  pendingApprovalCount: number;
  autonomousActions: Array<{ description: string }>;
  blockingIssues: string[];
}

export function buildApprovalCard(params: ApprovalCardParams): Record<string, unknown> {
  const urgencyColor: Record<string, string> = { low: 'good', medium: 'warning', high: 'attention' };
  const color = urgencyColor[params.urgency] ?? 'default';

  return {
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      {
        type: 'Container',
        style: 'emphasis',
        items: [
          {
            type: 'ColumnSet',
            columns: [
              {
                type: 'Column',
                width: 'stretch',
                items: [{
                  type: 'TextBlock',
                  text: '⚡ Nexus — Action Required',
                  weight: 'Bolder',
                  size: 'Small',
                  color: 'Accent',
                }],
              },
              {
                type: 'Column',
                width: 'auto',
                items: [{
                  type: 'TextBlock',
                  text: params.urgency.toUpperCase(),
                  weight: 'Bolder',
                  size: 'Small',
                  color: color === 'good' ? 'Good' : color === 'attention' ? 'Attention' : 'Warning',
                }],
              },
            ],
          },
          {
            type: 'TextBlock',
            text: params.title,
            weight: 'Bolder',
            size: 'Large',
            wrap: true,
          },
          ...(params.targetAgent
            ? [{
                type: 'TextBlock',
                text: `Agent: \`${params.targetAgent}\``,
                size: 'Small',
                color: 'Accent',
                spacing: 'None',
              }]
            : []),
        ],
      },
      {
        type: 'Container',
        spacing: 'Medium',
        items: [
          {
            type: 'TextBlock',
            text: '**Why this action is needed**',
            weight: 'Bolder',
            size: 'Small',
          },
          {
            type: 'TextBlock',
            text: params.rationale,
            wrap: true,
            size: 'Small',
            color: 'Default',
          },
          {
            type: 'TextBlock',
            text: '**What will happen on approval**',
            weight: 'Bolder',
            size: 'Small',
            spacing: 'Medium',
          },
          {
            type: 'TextBlock',
            text: params.actionDescription,
            wrap: true,
            size: 'Small',
            fontType: 'Monospace',
          },
          {
            type: 'TextBlock',
            text: '**Expected outcome**',
            weight: 'Bolder',
            size: 'Small',
            spacing: 'Medium',
          },
          {
            type: 'TextBlock',
            text: params.impact,
            wrap: true,
            size: 'Small',
          },
        ],
      },
      {
        type: 'TextBlock',
        text: `Action ID: ${params.actionId} · Expires in 48h`,
        size: 'Small',
        color: 'Subtle',
        spacing: 'Medium',
      },
    ],
    actions: [
      {
        type: 'Action.OpenUrl',
        title: '✓ Approve',
        url: params.approveUrl,
        style: 'positive',
      },
      {
        type: 'Action.OpenUrl',
        title: '✕ Reject',
        url: params.rejectUrl,
        style: 'destructive',
      },
    ],
  };
}

export function buildDailyReportCard(report: PlatformIntelReport): Record<string, unknown> {
  const statusEmoji: Record<string, string> = {
    READY: '🟢',
    NOT_READY: '🔴',
    INSUFFICIENT_DATA: '🟡',
  };
  const emoji = statusEmoji[report.gtmStatus] ?? '🟡';

  return {
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: `Nexus Daily Report — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        weight: 'Bolder',
        size: 'Large',
      },
      {
        type: 'FactSet',
        facts: [
          { title: 'GTM Status', value: `${emoji} ${report.gtmStatus.replace(/_/g, ' ')}` },
          { title: 'Fleet Health', value: `${report.healthyCount} healthy · ${report.degradedCount} degraded · ${report.unhealthyCount} unhealthy` },
          { title: 'Autonomous Actions', value: `${report.autonomousActionsCount} taken` },
          { title: 'Awaiting Approval', value: `${report.pendingApprovalCount} requests sent` },
        ],
      },
      // Autonomous actions taken
      ...(report.autonomousActions.length > 0
        ? [
            { type: 'TextBlock', text: '**Actions Taken**', weight: 'Bolder', size: 'Small', spacing: 'Medium' },
            ...report.autonomousActions.map((action) => ({
              type: 'TextBlock',
              text: `✓ ${action.description}`,
              wrap: true,
              size: 'Small',
              color: 'Good',
            })),
          ]
        : []),
      // Blocking issues
      ...(report.blockingIssues.length > 0
        ? [
            { type: 'TextBlock', text: '**Blocking GTM**', weight: 'Bolder', size: 'Small', spacing: 'Medium', color: 'Attention' },
            ...report.blockingIssues.map((issue) => ({
              type: 'TextBlock',
              text: `✕ ${issue}`,
              wrap: true,
              size: 'Small',
              color: 'Attention',
            })),
          ]
        : []),
    ],
    actions: [
      {
        type: 'Action.OpenUrl',
        title: 'Open Dashboard',
        url: `${process.env.DASHBOARD_URL ?? ''}/cockpit/eval`,
      },
    ],
  };
}

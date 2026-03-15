/**
 * Teams Webhook Integration
 *
 * Phase 1: Incoming webhooks for posting to Teams channels.
 * Phase 2+: Upgrade to full Bot Framework for interactive Adaptive Cards.
 */

/**
 * Send a message/card to a Teams channel via incoming webhook.
 */
export async function sendTeamsWebhook(
  webhookUrl: string,
  payload: TeamsWebhookPayload,
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Teams webhook failed (${response.status}): ${text}`);
  }
}

/**
 * Teams webhook payload — Adaptive Card format for Power Automate / Workflows connectors.
 */
export interface TeamsWebhookPayload {
  type: 'message';
  attachments: Array<{
    contentType: 'application/vnd.microsoft.card.adaptive';
    contentUrl: null;
    content: AdaptiveCard;
  }>;
}

export interface AdaptiveCard {
  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json';
  type: 'AdaptiveCard';
  version: '1.5';
  body: AdaptiveCardElement[];
  actions?: AdaptiveCardAction[];
}

export type AdaptiveCardElement =
  | { type: 'TextBlock'; text: string; size?: string; weight?: string; color?: string; wrap?: boolean; spacing?: string; separator?: boolean }
  | { type: 'Image'; url: string; size?: string; altText?: string; horizontalAlignment?: string; spacing?: string }
  | { type: 'ColumnSet'; columns: Array<{ type: 'Column'; width: string; items: AdaptiveCardElement[] }> }
  | { type: 'FactSet'; facts: Array<{ title: string; value: string }> }
  | { type: 'Container'; items: AdaptiveCardElement[]; style?: string; bleed?: boolean; separator?: boolean };

export type AdaptiveCardAction =
  | { type: 'Action.OpenUrl'; title: string; url: string }
  | { type: 'Action.Submit'; title: string; data: unknown }
  | { type: 'Action.Execute'; title: string; verb: string; data?: unknown; id?: string };

// Legacy webhook support (still usable for simple setups)
export { sendTeamsWebhook, type TeamsWebhookPayload, type AdaptiveCard } from './teams/webhooks.js';

// Adaptive Card templates
export {
  formatBriefingCard,
  formatDecisionCard,
  formatAlertCard,
  type BriefingCardData,
  type DecisionCardData,
  type AlertCardData,
} from './teams/adaptiveCards.js';

// Graph API Teams client (primary integration)
export {
  GraphTeamsClient,
  buildChannelMap,
  sendToTeamsChannel,
  type GraphTeamsConfig,
  type ChannelTarget,
  type ChannelMap,
} from './teams/graphClient.js';

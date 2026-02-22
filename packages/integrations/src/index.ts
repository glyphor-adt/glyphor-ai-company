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

// Stripe integration
export {
  getStripeClient,
  handleStripeWebhook,
  syncMRR,
  syncChurnRate,
  syncAll as syncStripeAll,
} from './stripe/index.js';

// GCP monitoring & billing
export {
  queryCloudRunMetrics,
  queryAllServices,
  queryBillingExport,
  syncBillingToSupabase,
  pingService,
  pingServices,
  type CloudRunMetrics,
  type DailyCost,
  type ServiceHealth,
} from './gcp/index.js';

// Mercury banking
export {
  listAccounts as listMercuryAccounts,
  syncCashBalance,
  syncCashFlows,
  syncAll as syncMercuryAll,
  type MercuryAccount,
} from './mercury/index.js';

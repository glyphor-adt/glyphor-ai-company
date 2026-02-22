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

// Teams Direct Messages (1:1 chat via Graph API)
export {
  TeamsDirectMessageClient,
  buildFounderDirectory,
  type FounderContact,
} from './teams/directMessages.js';

// Teams Bot (Bot Framework integration)
export {
  TeamsBotHandler,
  extractBearerToken,
  type BotConfig,
  type TeamsActivity,
  type BotResponse,
} from './teams/bot.js';

// Email (Graph API sendMail)
export {
  GraphEmailClient,
  type SendEmailOptions,
  type EmailRecipient,
  type EmailAttachment,
} from './teams/email.js';

// Calendar (Graph API events)
export {
  GraphCalendarClient,
  type CreateEventOptions,
  type CreatedEvent,
  type CalendarAttendee,
} from './teams/calendar.js';

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
  syncSubscriptions,
  syncAll as syncMercuryAll,
  type MercuryAccount,
} from './mercury/index.js';

// SendGrid email
export { SendGridClient } from './sendgrid/index.js';

// Ghost CMS
export { GhostClient } from './ghost/index.js';

// Buffer social media scheduling
export { BufferClient } from './buffer/index.js';

// Ahrefs SEO analysis
export { AhrefsClient } from './ahrefs/index.js';

// Apollo company & people enrichment
export { ApolloClient } from './apollo/index.js';

// Crunchbase funding & company data
export { CrunchbaseClient } from './crunchbase/index.js';

// PostHog product analytics
export { PostHogClient } from './posthog/index.js';

// Intercom support & conversations
export { IntercomClient } from './intercom/index.js';

// Wappalyzer tech stack detection
export { WappalyzerClient } from './wappalyzer/index.js';

// Google Search Console
export { SearchConsoleClient } from './search-console/index.js';

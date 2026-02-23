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
  BotTokenValidator,
  extractBearerToken,
  type BotConfig,
  type AgentBotConfig,
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

// OpenAI billing
export { queryOpenAICosts, syncOpenAIBilling } from './openai/index.js';

// Anthropic billing
export { queryAnthropicUsage, syncAnthropicBilling } from './anthropic/index.js';

// Kling AI billing
export { queryKlingUsage, syncKlingBilling, type KlingCredentials } from './kling/index.js';

// Platform audit logging
export { auditedFetch, logPlatformAudit, type AuditContext } from './audit.js';

// Credential routing
export { getM365Client, getM365Token, type M365Operation } from './credentials/m365Router.js';
export { getScopedGitHubClient, validateGitHubScope, GITHUB_AGENT_SCOPES, type GitHubScope } from './credentials/githubScoping.js';

// Governance sync
export { syncGCPIAMState, syncSecretRotationStatus, runGovernanceSync } from './governance/iamSync.js';

// Web search (Serper)
export {
  searchWeb,
  searchNews,
  batchSearch,
  searchResultsToContext,
  type SearchResult,
  type NewsResult,
  type WebSearchOptions,
} from './webSearch.js';

// GitHub — repo access for Marcus (CTO) and engineering team
export {
  getGitHubClient,
  listOpenPRs,
  listWorkflowRuns,
  getRepoStats,
  createIssue,
  listRecentCommits,
  commentOnPR,
  GLYPHOR_REPOS,
  type GlyphorRepo,
  type PullRequest,
  type WorkflowRun,
  type RepoStats,
} from './github/index.js';

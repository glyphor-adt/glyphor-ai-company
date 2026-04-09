// Legacy webhook support (still usable for simple setups)
export { sendTeamsWebhook, type TeamsWebhookPayload, type AdaptiveCard } from './teams/webhooks.js';

// Adaptive Card templates
export {
  formatBriefingCard,
  formatDecisionCard,
  formatAlertCard,
  formatNotificationCard,
  formatDirectiveProposalCard,
  type BriefingCardData,
  type DecisionCardData,
  type AlertCardData,
  type NotificationCardData,
  type NotificationType,
  type DirectiveProposalCardData,
} from './teams/adaptiveCards.js';

// Graph API Teams client (primary integration)
export {
  GraphTeamsClient,
  buildChannelMap,
  sendToTeamsChannel,
  postCardToChannel,
  postTextToChannel,
  type PostResult,
  type GraphTeamsConfig,
  type ChannelTarget,
  type ChannelMap,
  type TeamsChannelTextOptions,
} from './teams/graphClient.js';

export {
  buildDeliverablesFounderMentions,
  type GraphChannelMention,
  type FounderMentionTarget,
} from './teams/founderMentions.js';

// Teams Direct Messages (1:1 chat via Graph API)
export {
  TeamsDirectMessageClient,
  buildFounderDirectory,
  type FounderContact,
} from './teams/directMessages.js';

// Graph Chat Handler (1:1 DMs to agent user accounts)
export {
  GraphChatHandler,
  type ChatChangeNotification,
  type ChatChangePayload,
  type ChatMessage,
} from './teams/graphChatHandler.js';

// Teams Message Formatter
export {
  formatTeamsMessage,
  markdownToTeamsHtml,
  type FormattedTeamsMessage,
} from './teams/messageFormatter.js';

// Chat Subscription Manager (Graph change notifications)
export {
  ChatSubscriptionManager,
  type ChatSubscription,
} from './teams/chatSubscription.js';

export {
  DEFAULT_SYSTEM_TENANT_ID,
  buildTeamsInstallProof,
  buildTeamsWorkspaceKeys,
  canonicalTeamsWorkspaceKey,
  isSystemTenantId,
  resolveVerifiedTeamsTenantBinding,
  type TeamsInstallProofInput,
  type TeamsTenantBindingResolution,
} from './teams/tenantBinding.js';

// Calendar (Graph API events)
export {
  FounderCalendarMcpWrapper,
  GraphCalendarClient,
  type CreateEventOptions,
  type CreatedEvent,
  type CalendarAttendee,
  type FounderCalendarMcpWrapperMode,
  type FounderCalendarMcpTargetMode,
  type FounderCalendarMcpCreateOptions,
  type FounderCalendarMcpCancelOptions,
  type FounderCalendarMcpDeleteOptions,
  type FounderCalendarMcpGetOptions,
  type FounderCalendarMcpResult,
} from './teams/calendar.js';

// Calendar Webhooks (Graph change notifications for auto-join)
export {
  CalendarWebhookManager,
  type CalendarSubscription,
  type GraphChangeNotification,
  type GraphChangePayload,
} from './teams/calendarWebhook.js';

// Stripe integration
export {
  getStripeClient,
  handleStripeWebhook,
  syncMRR,
  syncChurnRate,
  syncAll as syncStripeAll,
} from './stripe/index.js';

// GCP monitoring, billing & Cloud Build
export {
  queryCloudRunMetrics,
  queryAllServices,
  queryBillingExport,
  syncBillingToDB,
  pingService,
  pingServices,
  listCloudBuilds,
  getCloudBuildDetails,
  resolveGcpProjectIdForCloudBuild,
  normalizeCloudBuildId,
  type CloudRunMetrics,
  type DailyCost,
  type ServiceHealth,
  type CloudBuildSummary,
  type CloudBuildLog,
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

// PostHog product analytics
export { PostHogClient } from './posthog/index.js';

// Google Search Console
export { SearchConsoleClient } from './search-console/index.js';

// OpenAI billing
export { queryOpenAICosts, syncOpenAIBilling } from './openai/index.js';

// Anthropic billing
export { queryAnthropicUsage, syncAnthropicBilling } from './anthropic/index.js';

// Kling AI billing
export { queryKlingCosts, syncKlingBilling, type KlingCredentials } from './kling/index.js';

// Platform audit logging
export {
  auditedFetch,
  logPlatformAudit,
  logMicrosoftWriteAudit,
  type AuditContext,
  type MicrosoftWriteAuditContext,
} from './audit.js';

// Credential routing
export { getM365Client, getM365Token, type M365Operation } from './credentials/m365Router.js';
export { getScopedGitHubClient, validateGitHubScope, GITHUB_AGENT_SCOPES, type GitHubScope } from './credentials/githubScoping.js';

// Governance sync
export { syncGCPIAMState, syncSecretRotationStatus, runGovernanceSync } from './governance/iamSync.js';

// SharePoint knowledge sync
export {
  syncSharePointKnowledge,
  uploadToSharePoint,
  uploadBinaryToSharePoint,
  searchSharePoint,
  listSharePointFolders,
  listSharePointFiles,
  readSharePointDocument,
  createSharePointPage,
  resolveSharePointGraphToken,
  markdownToPdf,
  type SharePointSyncOptions,
  type SharePointSyncResult,
  type SharePointUploadOptions,
  type SharePointBinaryUploadOptions,
  type SharePointSearchOptions,
  type SharePointDocument,
  type DocxConvertOptions,
  type ResolvedSharePointGraphToken,
} from './sharepoint/index.js';

// Web search (OpenAI Responses API + web_search_preview; OPENAI_API_KEY only)
export {
  searchWeb,
  searchNews,
  batchSearch,
  searchResultsToContext,
  buildSearchWebPrompt,
  type SearchResult,
  type NewsResult,
  type WebSearchOptions,
} from './webSearch.js';

// GitHub — repo access for Marcus (CTO) and engineering team
export {
  getGitHubClient,
  buildGitHubRepoContext,
  listOpenPRs,
  listWorkflowRuns,
  getRepoStats,
  createIssue,
  listRecentCommits,
  commentOnPR,
  submitPRReview,
  getPRDiff,
  createCheckRun,
  getFileContents,
  createOrUpdateFile,
  createBranch,
  createGitHubPR,
  mergeGitHubPR,
  createIssueForCopilot,
  findPRForIssue,
  getIssueDetails,
  createGithubFromTemplateTools,
  createGithubPushFilesTools,
  createGithubReadRepositoryFileTools,
  createGithubPullRequestTools,
  GLYPHOR_REPOS,
  type GlyphorRepo,
  type PullRequest,
  type WorkflowRun,
  type RepoStats,
  type GitHubRepoContextResult,
  type FileContents,
  type ReviewEvent,
} from './github/index.js';

// Vercel — deployment management, health, and usage metrics
export {
  listDeployments,
  getDeployment,
  listProjects as listVercelProjects,
  triggerDeployment,
  rollbackDeployment,
  queryVercelHealth,
  queryVercelUsage,
  createVercelProjectTools,
  VERCEL_TEAMS,
  type VercelTeamKey,
  type VercelDeployment,
  type VercelProjectInfo,
  type VercelHealthSummary,
  type VercelUsageSummary,
} from './vercel/index.js';

export {
  createCloudflarePreviewTools,
} from './cloudflare/index.js';

// Facebook / Meta Graph API — page publishing, insights, audience data
export {
  createPagePost,
  schedulePagePost,
  getPagePosts,
  getPost as getFacebookPost,
  deletePost as deleteFacebookPost,
  getPageInsights,
  getPostInsights,
  getAudienceDemographics,
  checkFacebookHealth,
  type FacebookPost,
  type FacebookPostResult,
  type FacebookPageInsights,
  type FacebookPostInsights,
} from './facebook/index.js';

// LinkedIn — Organization page posting, analytics, follower stats
export {
  createLinkedInPost,
  scheduleLinkedInPost,
  getLinkedInPosts,
  deleteLinkedInPost,
  getLinkedInPostAnalytics,
  getLinkedInFollowerStats,
  getLinkedInPageStats,
  getLinkedInFollowerDemographics,
  checkLinkedInHealth,
  type LinkedInPost,
  type LinkedInPostResult,
  type LinkedInPostAnalytics,
  type LinkedInFollowerStats,
  type LinkedInPageStats,
} from './linkedin/index.js';

// DocuSign eSignature — envelope creation, signing, status tracking, Connect webhooks
export {
  DocuSignClient,
  type DocuSignConfig,
  type Signer as DocuSignSigner,
  type SignerTabs,
  type TabPosition,
  type EnvelopeDocument,
  type CreateEnvelopeOptions,
  type EnvelopeStatus,
  type RecipientStatus,
  type EnvelopeSummary,
  handleDocuSignWebhook,
  verifyHmac as verifyDocuSignHmac,
  processConnectEvent as processDocuSignConnectEvent,
  type DocuSignConnectEvent,
  type DocuSignWebhookResult,
} from './docusign/index.js';

// Canva Connect API — design creation, brand templates, autofill, export
export {
  createDesign,
  getDesign,
  listDesigns,
  uploadAsset,
  getAssetUploadJob,
  listBrandTemplates,
  getBrandTemplateDataset,
  createAutofillJob,
  getAutofillJob,
  waitForAutofillJob,
  createExportJob,
  getExportJob,
  waitForExportJob,
  exchangeCanvaCode,
  clearCanvaTokenCache,
} from './canva/index.js';

// Agent 365 MCP Bridge — Microsoft Agent 365 governed MCP tool servers
export {
  AGENT365_CALENDAR_SERVER_NAME,
  createAgent365ConfigFromEnv,
  createAgent365Tools,
  createAgent365ToolsFromManifest,
  getAgenticGraphToken,
  invokeAgent365Tool,
  withAgent365Tool,
  type Agent365Config,
  type Agent365ToolBridge,
  type InvokeAgent365ToolOptions,
} from './agent365/index.js';

export { A365TeamsChatClient } from './agent365/teamsChatClient.js';


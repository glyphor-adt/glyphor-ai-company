/**
 * Maps tool names → platform/source for display in the dashboard.
 *
 * Platforms:
 *   core       – Glyphor agent runtime built-ins (memory, communication, assignments, events)
 *   gcp        – GCP Cloud Run, Cloud Build, Secret Manager, Vercel deploy/rollback
 *   m365       – Microsoft 365 via Agent 365 MCP (Mail, Calendar, Teams, Word, SharePoint, Admin)
 *   glyphor-data       – Glyphor MCP Data Server
 *   glyphor-marketing  – Glyphor MCP Marketing Server
 *   glyphor-engineering – Glyphor MCP Engineering Server
 *   glyphor-design     – Glyphor MCP Design Server
 *   glyphor-finance    – Glyphor MCP Finance Server
 *   glyphor-hr         – Glyphor MCP HR Server
 *   glyphor-legal      – Glyphor MCP Legal Server
 *   github     – GitHub integration tools
 *   web        – Web search/fetch tools
 *   governance – Governance & company intelligence tools
 *   specialist – Agent-specific domain tools
 */

export type ToolPlatform =
  | 'core'
  | 'gcp'
  | 'm365'
  | 'glyphor-data'
  | 'glyphor-marketing'
  | 'glyphor-engineering'
  | 'glyphor-design'
  | 'glyphor-finance'
  | 'glyphor-hr'
  | 'glyphor-legal'
  | 'github'
  | 'web'
  | 'governance'
  | 'specialist';

interface PlatformMeta {
  label: string;
  color: string;       // Tailwind text color
  bgColor: string;     // Tailwind bg color
  borderColor: string; // Tailwind border color
  badge: string;       // CSS badge class from global theme (e.g. 'badge-cyan')
}

export const PLATFORM_META: Record<ToolPlatform, PlatformMeta> = {
  core:                 { label: 'Core',        color: 'text-cyan',            bgColor: 'bg-cyan/10',            borderColor: 'border-cyan/25',            badge: 'badge-cyan' },
  gcp:                  { label: 'GCP',         color: 'text-sky-400',         bgColor: 'bg-sky-400/10',         borderColor: 'border-sky-400/25',         badge: 'badge-sky' },
  m365:                 { label: 'M365',        color: 'text-blue-400',        bgColor: 'bg-blue-400/10',        borderColor: 'border-blue-400/25',        badge: 'badge-blue' },
  'glyphor-data':       { label: 'Data',        color: 'text-emerald-400',     bgColor: 'bg-emerald-400/10',     borderColor: 'border-emerald-400/25',     badge: 'badge-emerald' },
  'glyphor-marketing':  { label: 'Marketing',   color: 'text-pink-400',        bgColor: 'bg-pink-400/10',        borderColor: 'border-pink-400/25',        badge: 'badge-pink' },
  'glyphor-engineering':{ label: 'Engineering',  color: 'text-orange-400',      bgColor: 'bg-orange-400/10',      borderColor: 'border-orange-400/25',      badge: 'badge-orange' },
  'glyphor-design':     { label: 'Design',      color: 'text-violet-400',      bgColor: 'bg-violet-400/10',      borderColor: 'border-violet-400/25',      badge: 'badge-violet' },
  'glyphor-finance':    { label: 'Finance',     color: 'text-amber-400',       bgColor: 'bg-amber-400/10',       borderColor: 'border-amber-400/25',       badge: 'badge-amber' },
  'glyphor-hr':         { label: 'HR',          color: 'text-teal-400',        bgColor: 'bg-teal-400/10',        borderColor: 'border-teal-400/25',        badge: 'badge-teal' },
  'glyphor-legal':      { label: 'Legal',       color: 'text-slate-400',       bgColor: 'bg-slate-400/10',       borderColor: 'border-slate-400/25',       badge: 'badge-gray' },
  github:               { label: 'GitHub',      color: 'text-gray-300',        bgColor: 'bg-gray-300/10',        borderColor: 'border-gray-300/25',        badge: 'badge-gray' },
  web:                  { label: 'Web',         color: 'text-indigo-400',      bgColor: 'bg-indigo-400/10',      borderColor: 'border-indigo-400/25',      badge: 'badge-indigo' },
  governance:           { label: 'Governance',  color: 'text-yellow-400',      bgColor: 'bg-yellow-400/10',      borderColor: 'border-yellow-400/25',      badge: 'badge-yellow' },
  specialist:           { label: 'Specialist',  color: 'text-prism-elevated',  bgColor: 'bg-prism-elevated/10',  borderColor: 'border-prism-elevated/25',  badge: 'badge-amber' },
};

// ── Known tool → platform mapping ────────────────────────────────

const TOOL_PLATFORM_MAP: Record<string, ToolPlatform> = {
  // Core runtime
  read_my_assignments: 'core', submit_assignment_output: 'core', flag_assignment_blocker: 'core',
  send_agent_message: 'core', check_messages: 'core', call_meeting: 'core',
  save_memory: 'core', recall_memories: 'core',
  request_tool_access: 'core', request_new_tool: 'core',
  grant_tool_access: 'core', revoke_tool_access: 'core',
  emit_insight: 'core', emit_alert: 'core',
  send_teams_dm: 'core', read_teams_dm: 'core',
  publish_deliverable: 'core', get_deliverables: 'core',
  log_activity: 'core', get_recent_activity: 'core',
  create_specialist_agent: 'core', list_my_created_agents: 'core', retire_created_agent: 'core',
  get_agent_directory: 'core', who_handles: 'core',

  // Governance & Company Intelligence
  get_company_vitals: 'governance', update_company_vitals: 'governance', update_vitals_highlights: 'governance',
  promote_to_org_knowledge: 'governance', get_org_knowledge: 'governance',
  create_knowledge_route: 'governance', get_knowledge_routes: 'governance',
  detect_contradictions: 'governance', record_process_pattern: 'governance', get_process_patterns: 'governance',
  propose_authority_change: 'governance', get_authority_proposals: 'governance',
  trace_causes: 'governance', trace_impact: 'governance', query_knowledge_graph: 'governance', add_knowledge: 'governance',
  read_company_memory: 'governance', write_company_memory: 'governance',
  get_pending_decisions: 'governance', create_decision: 'governance', send_briefing: 'governance',
  list_tool_requests: 'governance', review_tool_request: 'governance',
  register_tool: 'governance', deactivate_tool: 'governance', list_registered_tools: 'governance',
  view_access_matrix: 'governance', view_pending_grant_requests: 'governance',
  audit_workforce: 'governance', validate_agent: 'governance',

  // M365 / SharePoint (upload_to_sharepoint has DB sync; rest via Agent365 mcp_ODSPRemoteServer)
  upload_to_sharepoint: 'm365', search_sharepoint: 'm365', read_sharepoint_document: 'm365',
  list_users: 'm365', get_user: 'm365',
  list_channels: 'm365', list_channel_members: 'm365', add_channel_member: 'm365', create_channel: 'm365', post_to_channel: 'm365',
  create_calendar_event: 'm365', list_calendar_events: 'm365',
  list_licenses: 'm365', list_groups: 'm365', list_group_members: 'm365',
  list_app_registrations: 'm365', list_sharepoint_sites: 'm365', get_sharepoint_site_permissions: 'm365',
  write_admin_log: 'm365', check_my_access: 'm365',
  list_project_iam: 'm365', grant_project_role: 'm365', revoke_project_role: 'm365',
  // M365 — Agent365 MCP PascalCase tools (mcp_MailTools)
  send_email: 'm365', reply_to_email: 'm365', read_inbox: 'm365', reply_email_with_attachments: 'm365',
  ReadInbox: 'm365', SendEmail: 'm365', ReplyToEmail: 'm365', ReplyAll: 'm365', ForwardMessage: 'm365',
  SearchEmails: 'm365', GetMessage: 'm365', GetMessages: 'm365', CreateDraftMessage: 'm365',
  UpdateDraftMessage: 'm365', DeleteMessage: 'm365', MoveMessage: 'm365', FlagEmail: 'm365',
  AddDraftAttachments: 'm365', DownloadAttachment: 'm365', DeleteAttachment: 'm365',
  GetMailFolders: 'm365', CreateMailFolder: 'm365', MoveMailFolder: 'm365', DeleteMailFolder: 'm365',
  GetFocusedInbox: 'm365',
  // M365 — Agent365 MCP PascalCase tools (mcp_CalendarTools)
  CreateEvent: 'm365', GetEvents: 'm365', GetEvent: 'm365', UpdateEvent: 'm365', DeleteEvent: 'm365',
  DeleteEventById: 'm365', AcceptEvent: 'm365', DeclineEvent: 'm365', TentativelyAcceptEvent: 'm365',
  FindMeetingTimes: 'm365', CancelEvent: 'm365',
  GetCalendarView: 'm365', GetCalendars: 'm365', CreateCalendar: 'm365',
  GetCalendarDateAndTimeSettings: 'm365',
  // M365 — Agent365 MCP PascalCase tools (mcp_TeamsServer)
  GetTeams: 'm365', GetChannels: 'm365', GetChannel: 'm365', CreateChannel: 'm365', CreatePrivateChannel: 'm365',
  SendMessage: 'm365', ReplyToMessage: 'm365',
  GetChats: 'm365', GetChat: 'm365', CreateChat: 'm365', GetChatMessages: 'm365', SendChatMessage: 'm365',
  AddChatMember: 'm365', AddChannelMember: 'm365', AddComment: 'm365',
  DeleteChat: 'm365', DeleteChatMessage: 'm365',
  GetMessageWithFullThread: 'm365',
  // M365 — Agent365 MCP PascalCase tools (mcp_ODSPRemoteServer / OneDrive + SharePoint)
  ListDrives: 'm365', ListItems: 'm365', GetItem: 'm365', SearchFiles: 'm365', DownloadFile: 'm365',
  UploadFile: 'm365', CreateFolder: 'm365', MoveItem: 'm365', CopyItem: 'm365', DeleteItem: 'm365',
  GetPermissions: 'm365', ShareItem: 'm365', GetRecentFiles: 'm365', GetSharedWithMe: 'm365',
  ListSites: 'm365', GetSitePages: 'm365', SearchSites: 'm365',
  // M365 — Agent365 MCP PascalCase tools (mcp_WordServer)
  CreateDocument: 'm365', GetDocument: 'm365', UpdateDocument: 'm365', SearchDocument: 'm365',
  InsertContent: 'm365', ReplaceContent: 'm365',
  // M365 — Agent365 MCP PascalCase tools (mcp_UserProfile)
  GetMyProfile: 'm365', GetUserProfile: 'm365', GetDirectReports: 'm365', GetManager: 'm365',
  GetPeople: 'm365', SearchUsers: 'm365', GetPresence: 'm365',
  // M365 — Agent365 MCP PascalCase tools (mcp_SharePointLists)
  GetLists: 'm365', GetList: 'm365', GetListItems: 'm365', CreateListItem: 'm365',
  UpdateListItem: 'm365', DeleteListItem: 'm365',
  // M365 — Agent365 MCP PascalCase tools (mcp_AdminCenter)
  GetTenantInfo: 'm365', GetSubscriptions: 'm365', GetServiceHealth: 'm365',
  GetUserActivity: 'm365', GetMailboxUsage: 'm365',
  // M365 — Agent365 MCP PascalCase tools (mcp_M365Copilot)
  AskCopilot: 'm365',

  // GitHub
  get_github_pr_status: 'github', create_github_issue: 'github', create_github_bug: 'github',
  get_github_actions_runs: 'github', get_recent_commits: 'github', comment_on_pr: 'github',
  get_repo_code_health: 'github', create_component_branch: 'github', create_component_pr: 'github',
  get_ci_health: 'github', get_repo_stats: 'github', create_branch: 'github',
  create_github_pr: 'github', merge_github_pr: 'github', list_recent_commits: 'github',
  create_or_update_file: 'github',

  // GCP — Cloud Run, Cloud Build, Secret Manager, Vercel
  deploy_cloud_run: 'gcp', rollback_cloud_run: 'gcp',
  inspect_cloud_run_service: 'gcp', update_cloud_run_secrets: 'gcp',
  list_cloud_builds: 'gcp', get_cloud_build_logs: 'gcp',
  trigger_vercel_deploy: 'gcp', rollback_vercel_deploy: 'gcp', list_vercel_deployments: 'gcp',
  create_incident: 'gcp', resolve_incident: 'gcp',
  update_model_config: 'gcp', query_ai_usage: 'gcp',
  list_agents: 'gcp', get_agent_run_history: 'gcp', update_agent_status: 'gcp',
  get_agent_schedules: 'gcp', update_agent_schedule: 'gcp', get_agent_performance: 'gcp',
  query_db_health: 'gcp', query_db_table: 'gcp',

  // Glyphor MCP — Data Server
  query_content_drafts: 'glyphor-data', query_content_metrics: 'glyphor-data', query_seo_data: 'glyphor-data',
  query_financials: 'glyphor-data', query_company_pulse: 'glyphor-data', query_analytics_events: 'glyphor-data',
  query_support_tickets: 'glyphor-data', query_company_research: 'glyphor-data',
  query_agent_runs: 'glyphor-data', query_agent_activities: 'glyphor-data',
  query_incidents: 'glyphor-data', query_data_sync_status: 'glyphor-data',

  // Glyphor MCP — Finance Server
  query_stripe_data: 'glyphor-finance', query_gcp_billing: 'glyphor-finance', query_cost_metrics: 'glyphor-finance',
  query_api_billing: 'glyphor-finance', query_infrastructure_costs: 'glyphor-finance',
  query_stripe_mrr: 'glyphor-finance', query_stripe_subscriptions: 'glyphor-finance', query_stripe_revenue: 'glyphor-finance',
  query_revenue_by_product: 'glyphor-finance', query_revenue_by_cohort: 'glyphor-finance',
  calculate_unit_economics: 'glyphor-finance', write_financial_report: 'glyphor-finance',
  calculate_ltv_cac: 'glyphor-finance', forecast_revenue: 'glyphor-finance', query_churn_revenue: 'glyphor-finance',
  query_db_usage: 'glyphor-finance', query_gemini_cost: 'glyphor-finance', query_agent_run_costs: 'glyphor-finance',
  identify_waste: 'glyphor-finance', calculate_unit_cost: 'glyphor-finance', project_costs: 'glyphor-finance',
  query_vercel_usage: 'glyphor-finance', query_cost_trends: 'glyphor-finance',
  query_attribution: 'glyphor-finance',

  // Glyphor MCP — Marketing Server
  query_scheduled_posts: 'glyphor-marketing', query_social_metrics: 'glyphor-marketing',
  query_email_metrics: 'glyphor-marketing', query_experiment_designs: 'glyphor-marketing',
  draft_blog_post: 'glyphor-marketing', draft_social_post: 'glyphor-marketing',
  draft_case_study: 'glyphor-marketing', draft_email: 'glyphor-marketing',
  query_content_performance: 'glyphor-marketing', query_top_performing_content: 'glyphor-marketing',
  write_content: 'glyphor-marketing',
  query_seo_rankings: 'glyphor-marketing', query_keyword_data: 'glyphor-marketing',
  discover_keywords: 'glyphor-marketing', query_competitor_rankings: 'glyphor-marketing',
  query_backlinks: 'glyphor-marketing', analyze_content_seo: 'glyphor-marketing',
  schedule_social_post: 'glyphor-marketing', query_post_performance: 'glyphor-marketing',
  query_optimal_times: 'glyphor-marketing', query_audience_demographics: 'glyphor-marketing',
  monitor_mentions: 'glyphor-marketing',

  // Glyphor MCP — Engineering Server
  query_infrastructure_metrics: 'glyphor-engineering', query_cloud_run_metrics: 'glyphor-engineering',
  get_platform_health: 'glyphor-engineering', get_cloud_run_metrics: 'glyphor-engineering',
  write_health_report: 'glyphor-engineering',
  run_health_check: 'glyphor-engineering', query_gemini_latency: 'glyphor-engineering',
  query_uptime: 'glyphor-engineering',
  query_build_logs: 'glyphor-engineering', query_error_patterns: 'glyphor-engineering',
  query_test_results: 'glyphor-engineering', create_bug_report: 'glyphor-engineering',
  query_cache_metrics: 'glyphor-engineering', query_pipeline_metrics: 'glyphor-engineering',
  query_resource_utilization: 'glyphor-engineering', query_cold_starts: 'glyphor-engineering',
  identify_unused_resources: 'glyphor-engineering', calculate_cost_savings: 'glyphor-engineering',
  get_pipeline_runs: 'glyphor-engineering', query_vercel_builds: 'glyphor-engineering', query_vercel_health: 'glyphor-engineering',
  trigger_agent_run: 'glyphor-engineering', retry_failed_run: 'glyphor-engineering', retry_data_sync: 'glyphor-engineering',
  pause_agent: 'glyphor-engineering', query_agent_health: 'glyphor-engineering', query_events_backlog: 'glyphor-engineering',

  // Glyphor MCP — Design Server
  query_design_reviews: 'glyphor-design', query_design_assets: 'glyphor-design',
  query_failed_reviews: 'glyphor-design', query_figma_assets: 'glyphor-design', query_review_scores: 'glyphor-design',
  run_lighthouse: 'glyphor-design', run_lighthouse_batch: 'glyphor-design',
  get_design_quality_summary: 'glyphor-design', get_design_tokens: 'glyphor-design',
  get_component_library: 'glyphor-design', get_template_registry: 'glyphor-design', write_design_audit: 'glyphor-design',
  save_component_spec: 'glyphor-design', query_design_tokens: 'glyphor-design', query_component_implementations: 'glyphor-design',
  get_file_contents: 'glyphor-design', push_component: 'glyphor-design',
  save_component_implementation: 'glyphor-design', query_component_specs: 'glyphor-design', query_my_implementations: 'glyphor-design',
  grade_build: 'glyphor-design', query_build_grades: 'glyphor-design', query_build_grades_by_template: 'glyphor-design',
  save_template_variant: 'glyphor-design', query_template_variants: 'glyphor-design', update_template_status: 'glyphor-design',
  invoke_web_build: 'glyphor-design', invoke_web_iterate: 'glyphor-design', invoke_web_upgrade: 'glyphor-design',
  quick_demo_web_app: 'glyphor-design',
  build_website_foundation: 'glyphor-design',
  github_create_from_template: 'glyphor-engineering', github_push_files: 'glyphor-engineering',
  github_create_pull_request: 'glyphor-engineering', github_get_pull_request_status: 'glyphor-engineering', github_wait_for_pull_request_checks: 'glyphor-engineering', github_merge_pull_request: 'glyphor-engineering',
  vercel_create_project: 'glyphor-engineering', vercel_get_preview_url: 'glyphor-engineering', vercel_get_production_url: 'glyphor-engineering',
  cloudflare_register_preview: 'glyphor-engineering', cloudflare_update_preview: 'glyphor-engineering',

  // Glyphor MCP — HR
  update_agent_profile: 'glyphor-hr', update_agent_name: 'glyphor-hr',
  retire_agent: 'glyphor-hr', reactivate_agent: 'glyphor-hr', list_stale_agents: 'glyphor-hr',
  set_reports_to: 'glyphor-hr', write_hr_log: 'glyphor-hr',
  generate_avatar: 'glyphor-hr', provision_agent: 'glyphor-hr', enrich_agent_profile: 'glyphor-hr',

  // Web / Research
  web_search: 'web', web_fetch: 'web', search_news: 'web',
  submit_research_packet: 'web',
  save_research: 'web', search_research: 'web', get_research_timeline: 'web', create_research_brief: 'web',
  create_monitor: 'web', check_monitors: 'web', get_monitor_history: 'web',
  search_academic_papers: 'web', track_open_source: 'web',
  track_industry_events: 'web', track_regulatory_changes: 'web',
  analyze_ai_adoption: 'web', track_ai_benchmarks: 'web',
  compile_research_digest: 'web', identify_research_gaps: 'web', cross_reference_findings: 'web',
  analyze_org_structure: 'web',

  // Specialist — Sales
  write_pipeline_report: 'specialist',
  search_company_info: 'specialist', search_funding_data: 'specialist', analyze_tech_stack: 'specialist',
  search_key_people: 'specialist', search_job_postings: 'specialist', estimate_dev_spend: 'specialist', compile_dossier: 'specialist',
  search_competitor_updates: 'specialist', search_competitor_news: 'specialist', search_product_launches: 'specialist',
  fetch_pricing_intel: 'specialist', query_competitor_tech_stack: 'specialist', check_job_postings: 'specialist', store_intel: 'specialist',

  // Specialist — Product
  get_product_metrics: 'specialist', write_product_analysis: 'specialist',
  query_user_analytics: 'specialist', query_build_metadata: 'specialist', query_onboarding_funnel: 'specialist',
  run_cohort_analysis: 'specialist', query_churn_data: 'specialist', design_experiment: 'specialist',
};

/**
 * Resolve the platform for a given tool name.
 * Falls back to 'specialist' for unrecognised tools.
 */
export function getToolPlatform(toolName: string): ToolPlatform {
  if (TOOL_PLATFORM_MAP[toolName]) return TOOL_PLATFORM_MAP[toolName];

  // Agent365 MCP tools come through with PascalCase names and are not in the static map.
  // Match common M365 patterns by prefix/suffix.
  if (/^(Get|Send|Reply|Create|Update|Delete|Move|Copy|Search|List|Forward|Accept|Decline|Cancel|Find|Flag|Download|Upload|Insert|Replace|Add|Remove|Share|Void|Resend|Check|Tentatively)[A-Z]/.test(toolName)) {
    return 'm365';
  }

  return 'specialist';
}

/**
 * Get display metadata for a tool's platform.
 */
export function getToolPlatformMeta(toolName: string): PlatformMeta {
  return PLATFORM_META[getToolPlatform(toolName)];
}

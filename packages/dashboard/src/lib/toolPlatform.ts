/**
 * Maps tool names → platform/source for display in the dashboard.
 *
 * Platforms:
 *   core       – Glyphor agent runtime built-ins (memory, communication, assignments, events)
 *   m365       – Microsoft 365 via Agent 365 MCP (Mail, Calendar, Teams, Word, SharePoint, Admin)
 *   glyphor-data       – Glyphor MCP Data Server
 *   glyphor-marketing  – Glyphor MCP Marketing Server
 *   glyphor-engineering – Glyphor MCP Engineering Server
 *   glyphor-design     – Glyphor MCP Design Server
 *   glyphor-finance    – Glyphor MCP Finance Server
 *   glyphor-hr         – Glyphor MCP HR Server
 *   glyphor-legal      – Glyphor MCP Legal Server
 *   glyphor-email      – Glyphor MCP Email Server
 *   github     – GitHub integration tools
 *   web        – Web search/fetch tools
 *   governance – Governance & company intelligence tools
 *   specialist – Agent-specific domain tools
 */

export type ToolPlatform =
  | 'core'
  | 'm365'
  | 'glyphor-data'
  | 'glyphor-marketing'
  | 'glyphor-engineering'
  | 'glyphor-design'
  | 'glyphor-finance'
  | 'glyphor-hr'
  | 'glyphor-legal'
  | 'glyphor-email'
  | 'github'
  | 'web'
  | 'governance'
  | 'specialist';

interface PlatformMeta {
  label: string;
  color: string;       // Tailwind text color
  bgColor: string;     // Tailwind bg color
  borderColor: string; // Tailwind border color
}

export const PLATFORM_META: Record<ToolPlatform, PlatformMeta> = {
  core:                 { label: 'Core',        color: 'text-cyan',            bgColor: 'bg-cyan/10',            borderColor: 'border-cyan/25' },
  m365:                 { label: 'M365',        color: 'text-blue-400',        bgColor: 'bg-blue-400/10',        borderColor: 'border-blue-400/25' },
  'glyphor-data':       { label: 'Data',        color: 'text-emerald-400',     bgColor: 'bg-emerald-400/10',     borderColor: 'border-emerald-400/25' },
  'glyphor-marketing':  { label: 'Marketing',   color: 'text-pink-400',        bgColor: 'bg-pink-400/10',        borderColor: 'border-pink-400/25' },
  'glyphor-engineering':{ label: 'Engineering',  color: 'text-orange-400',      bgColor: 'bg-orange-400/10',      borderColor: 'border-orange-400/25' },
  'glyphor-design':     { label: 'Design',      color: 'text-violet-400',      bgColor: 'bg-violet-400/10',      borderColor: 'border-violet-400/25' },
  'glyphor-finance':    { label: 'Finance',     color: 'text-amber-400',       bgColor: 'bg-amber-400/10',       borderColor: 'border-amber-400/25' },
  'glyphor-hr':         { label: 'HR',          color: 'text-teal-400',        bgColor: 'bg-teal-400/10',        borderColor: 'border-teal-400/25' },
  'glyphor-legal':      { label: 'Legal',       color: 'text-slate-400',       bgColor: 'bg-slate-400/10',       borderColor: 'border-slate-400/25' },
  'glyphor-email':      { label: 'Email',       color: 'text-sky-400',         bgColor: 'bg-sky-400/10',         borderColor: 'border-sky-400/25' },
  github:               { label: 'GitHub',      color: 'text-gray-300',        bgColor: 'bg-gray-300/10',        borderColor: 'border-gray-300/25' },
  web:                  { label: 'Web',         color: 'text-indigo-400',      bgColor: 'bg-indigo-400/10',      borderColor: 'border-indigo-400/25' },
  governance:           { label: 'Governance',  color: 'text-yellow-400',      bgColor: 'bg-yellow-400/10',      borderColor: 'border-yellow-400/25' },
  specialist:           { label: 'Specialist',  color: 'text-prism-elevated',  bgColor: 'bg-prism-elevated/10',  borderColor: 'border-prism-elevated/25' },
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
  send_email: 'core', read_inbox: 'core', reply_to_email: 'core',
  publish_deliverable: 'core', get_deliverables: 'core',
  log_activity: 'core', get_recent_activity: 'core',
  create_specialist_agent: 'core', list_my_created_agents: 'core', retire_created_agent: 'core',
  get_agent_directory: 'core', who_handles: 'core',

  // Governance & Company Intelligence
  get_company_pulse: 'governance', update_company_pulse: 'governance', update_pulse_highlights: 'governance',
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
  upload_to_sharepoint: 'm365',
  list_users: 'm365', get_user: 'm365',
  list_channels: 'm365', list_channel_members: 'm365', add_channel_member: 'm365', create_channel: 'm365', post_to_channel: 'm365',
  create_calendar_event: 'm365', list_calendar_events: 'm365',
  list_licenses: 'm365', list_groups: 'm365', list_group_members: 'm365',
  list_app_registrations: 'm365', list_sharepoint_sites: 'm365', get_sharepoint_site_permissions: 'm365',
  write_admin_log: 'm365', check_my_access: 'm365',
  list_project_iam: 'm365', grant_project_role: 'm365', revoke_project_role: 'm365',

  // GitHub
  get_github_pr_status: 'github', create_github_issue: 'github', create_github_bug: 'github',
  get_github_actions_runs: 'github', get_recent_commits: 'github', comment_on_pr: 'github',
  get_repo_code_health: 'github', create_component_branch: 'github', create_component_pr: 'github',

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
  query_db_health: 'glyphor-engineering', query_uptime: 'glyphor-engineering',
  query_build_logs: 'glyphor-engineering', query_error_patterns: 'glyphor-engineering',
  query_test_results: 'glyphor-engineering', create_bug_report: 'glyphor-engineering',
  list_cloud_builds: 'glyphor-engineering', get_cloud_build_logs: 'glyphor-engineering',
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
  return TOOL_PLATFORM_MAP[toolName] ?? 'specialist';
}

/**
 * Get display metadata for a tool's platform.
 */
export function getToolPlatformMeta(toolName: string): PlatformMeta {
  return PLATFORM_META[getToolPlatform(toolName)];
}

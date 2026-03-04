/**
 * Tool Registry — Central lookup for tool names.
 *
 * Maps tool names (from skills.tools_granted) to a flag indicating
 * the tool exists in the system. Agents' run.ts files already assemble
 * full ToolDefinition[] arrays; this registry lets the skill system
 * and the dynamic grant system verify which tools are available
 * without importing every tool module.
 *
 * Two sources: static KNOWN_TOOLS set (compiled in) + dynamic
 * tool_registry DB table (loaded on demand).
 */

import { systemQuery } from '@glyphor/shared/db';

/** All known tool names in the system. */
const KNOWN_TOOLS = new Set([
  // ── Shared tools (all agents) ──
  'save_memory',
  'recall_memories',
  'search_memories',
  'read_my_assignments',
  'submit_assignment_output',
  'flag_assignment_blocker',
  'send_agent_message',
  'check_messages',
  'call_meeting',
  'log_activity',
  'get_agent_directory',
  'who_handles',

  // ── Collective Intelligence tools ──
  'get_company_pulse',
  'update_company_pulse',
  'update_pulse_highlights',
  'contribute_knowledge',
  'promote_to_org_knowledge',
  'get_org_knowledge',
  'create_knowledge_route',
  'get_knowledge_routes',
  'detect_contradictions',
  'record_process_pattern',
  'get_process_patterns',
  'propose_authority_change',
  'get_authority_proposals',
  'emit_insight',
  'emit_alert',

  // ── Graph tools ──
  'trace_causes',
  'trace_impact',
  'query_knowledge_graph',
  'add_knowledge',
  'add_graph_node',
  'add_graph_edge',

  // ── Chief of Staff tools ──
  'get_recent_activity',
  'get_pending_decisions',
  'get_product_metrics',
  'get_financials',
  'read_company_memory',
  'send_briefing',
  'create_decision',
  'check_escalations',
  'send_dm',
  'send_email',
  'read_inbox',
  'reply_to_email',
  'create_calendar_event',
  'read_founder_directives',
  'create_work_assignments',
  'dispatch_assignment',
  'check_assignment_status',
  'evaluate_assignment',
  'update_directive_progress',
  'grant_tool_access',
  'revoke_tool_access',
  'request_new_tool',
  'check_tool_request_status',
  'list_tool_requests',
  'review_tool_request',
  'register_tool',
  'deactivate_tool',
  'list_registered_tools',
  'propose_directive',

  // ── CTO tools ──
  'get_platform_health',
  'get_cloud_run_metrics',
  'get_infrastructure_costs',
  'write_health_report',
  'get_github_pr_status',
  'get_ci_health',
  'get_repo_stats',
  'create_github_issue',
  'get_file_contents',
  'create_or_update_file',
  'create_branch',
  'create_github_pr',
  'merge_github_pr',
  'query_vercel_health',
  'trigger_vercel_deploy',
  'rollback_vercel_deploy',

  // ── CFO tools ──
  'calculate_unit_economics',
  'write_financial_report',
  'query_stripe_mrr',
  'query_stripe_subscriptions',

  // ── CPO tools ──
  'write_product_analysis',

  // ── CMO tools ──
  'write_content',
  'write_company_memory',

  // ── VP Customer Success tools ──
  'write_health_report',

  // ── VP Sales tools ──
  'write_pipeline_report',

  // ── VP Design tools ──
  'run_lighthouse',
  'run_lighthouse_batch',
  'get_design_quality_summary',
  'get_design_tokens',
  'get_component_library',
  'get_template_registry',
  'write_design_audit',

  // ── Design Team shared tools ──
  // frontendCodeTools
  'read_frontend_file',
  'search_frontend_code',
  'list_frontend_files',
  'write_frontend_file',
  'create_design_branch',
  'create_frontend_pr',
  'check_pr_status',
  // screenshotTools
  'screenshot_page',
  'screenshot_component',
  'compare_screenshots',
  'check_responsive',
  // designSystemTools
  'update_design_token',
  'validate_tokens_vs_implementation',
  'get_color_palette',
  'get_typography_scale',
  'list_components',
  'get_component_usage',
  // auditTools
  'run_lighthouse_audit',
  'run_accessibility_audit',
  'check_ai_smell',
  'validate_brand_compliance',
  'check_bundle_size',
  'check_build_errors',
  // assetTools
  'generate_image',
  'upload_asset',
  'list_assets',
  'optimize_image',
  'generate_favicon_set',
  // scaffoldTools
  'scaffold_component',
  'scaffold_page',
  'list_templates',
  'clone_and_modify',
  // deployPreviewTools
  'deploy_preview',
  'get_deployment_status',
  'list_deployments',
  // figmaTools
  'get_figma_file',
  'export_figma_images',
  'get_figma_image_fills',
  'get_figma_components',
  'get_figma_team_components',
  'get_figma_styles',
  'get_figma_team_styles',
  'get_figma_comments',
  'post_figma_comment',
  'resolve_figma_comment',
  'get_figma_file_metadata',
  'get_figma_version_history',
  'get_figma_team_projects',
  'get_figma_project_files',
  'get_figma_dev_resources',
  'create_figma_dev_resource',
  'manage_figma_webhooks',
  // canvaTools
  'create_canva_design',
  'get_canva_design',
  'search_canva_designs',
  'list_canva_brand_templates',
  'get_canva_template_fields',
  'generate_canva_design',
  'export_canva_design',
  'upload_canva_asset',
  // logoTools
  'create_logo_variation',
  'restyle_logo',
  'create_social_avatar',
  // storybookTools
  'storybook_list_stories',
  'storybook_screenshot',
  'storybook_screenshot_all',
  'storybook_visual_diff',
  'storybook_save_baseline',
  'storybook_check_coverage',
  'storybook_get_story_source',
  // Design sub-agent role-specific tools
  'save_component_spec',
  'query_design_tokens',
  'query_component_implementations',
  'push_component',
  'create_component_branch',
  'create_component_pr',
  'save_component_implementation',
  'query_component_specs',
  'query_my_implementations',
  'grade_build',
  'query_build_grades',
  'save_template_variant',
  'query_template_variants',
  'update_template_status',
  'query_build_grades_by_template',

  // ── Ops (Atlas) tools ──
  'query_agent_runs',
  'query_agent_health',
  'query_data_sync_status',
  'query_events_backlog',
  'query_cost_trends',
  'trigger_agent_run',
  'retry_failed_run',
  'retry_data_sync',
  'pause_agent',
  'resume_agent',
  'create_incident',
  'resolve_incident',
  'post_system_status',
  'rollup_agent_performance',
  'detect_milestones',
  'update_growth_areas',

  // ── Platform Engineer (Alex) tools ──
  'query_cloud_run_metrics',
  'run_health_check',
  'query_gemini_latency',
  'query_db_health',
  'query_uptime',
  'get_repo_code_health',

  // ── Quality Engineer (Sam) tools ──
  'query_build_logs',
  'query_error_patterns',
  'create_bug_report',
  'query_test_results',

  // ── DevOps Engineer (Jordan) tools ──
  'query_cache_metrics',
  'query_pipeline_metrics',
  'query_resource_utilization',
  'query_cold_starts',
  'identify_unused_resources',
  'calculate_cost_savings',
  'get_pipeline_runs',
  'get_recent_commits',
  'comment_on_pr',
  'query_vercel_builds',

  // ── User Researcher (Priya) tools ──
  'query_user_analytics',
  'query_build_metadata',
  'query_onboarding_funnel',
  'run_cohort_analysis',
  'query_churn_data',
  'design_experiment',

  // ── Competitive Intel (Daniel) tools ──
  'fetch_github_releases',
  'search_hacker_news',
  'search_product_hunt',
  'fetch_pricing_pages',
  'query_competitor_tech_stack',
  'check_job_postings',
  'store_intel',

  // ── Revenue Analyst (Anna) tools ──
  'query_stripe_revenue',
  'query_revenue_by_product',
  'query_revenue_by_cohort',
  'query_attribution',
  'calculate_ltv_cac',
  'forecast_revenue',
  'query_churn_revenue',

  // ── Cost Analyst (Omar) tools ──
  'query_gcp_billing',
  'query_db_usage',
  'query_gemini_cost',
  'query_agent_run_costs',
  'identify_waste',
  'calculate_unit_cost',
  'project_costs',
  'query_vercel_usage',

  // ── Content Creator (Tyler) tools ──
  'draft_blog_post',
  'draft_social_post',
  'draft_case_study',
  'draft_email',
  'query_content_performance',
  'query_top_performing_content',

  // ── SEO Analyst (Lisa) tools ──
  'query_seo_rankings',
  'query_keyword_data',
  'discover_keywords',
  'query_competitor_rankings',
  'query_backlinks',
  'query_search_console',
  'analyze_content_seo',

  // ── Social Media Manager (Kai) tools ──
  'schedule_social_post',
  'query_social_metrics',
  'query_post_performance',
  'query_optimal_times',
  'query_audience_demographics',
  'monitor_mentions',

  // ── Onboarding Specialist (Emma) tools ──
  'query_first_build_metrics',
  'query_drop_off_points',
  'query_welcome_email_metrics',
  'query_activation_rate',
  'query_template_usage',
  'design_onboarding_experiment',

  // ── Support Triage (David) tools ──
  'query_support_tickets',
  'classify_ticket',
  'respond_to_ticket',
  'escalate_ticket',
  'query_knowledge_base',
  'batch_similar_tickets',

  // ── Account Research (Nathan) tools ──
  'search_company_info',
  'search_crunchbase',
  'analyze_tech_stack',
  'search_linkedin_profiles',
  'search_job_postings',
  'estimate_dev_spend',
  'compile_dossier',

  // ── M365 Admin (Riley) tools ──
  'list_users',
  'get_user',
  'list_channels',
  'list_channel_members',
  'add_channel_member',
  'create_channel',
  'post_to_channel',
  'list_calendar_events',
  'write_admin_log',

  // ── Global Admin (Morgan) tools ──
  // GCP
  'list_project_iam',
  'grant_project_role',
  'revoke_project_role',
  'list_service_accounts',
  'create_service_account',
  'list_secrets',
  'get_secret_iam',
  'grant_secret_access',
  'revoke_secret_access',
  'run_access_audit',
  'run_onboarding',
  // Entra ID / Azure AD
  'entra_list_users',
  'entra_create_user',
  'entra_disable_user',
  'entra_list_groups',
  'entra_list_group_members',
  'entra_add_group_member',
  'entra_remove_group_member',
  'entra_list_directory_roles',
  'entra_assign_directory_role',
  'entra_list_app_registrations',
  'entra_list_licenses',
  'entra_assign_license',
  'entra_revoke_license',
  'entra_audit_sign_ins',

  // ── Strategy Lab v2 Research Analyst tools ──
  'web_fetch',
  'search_news',
  'submit_research_packet',

  // ── External / legacy tools ──
  'web_search',
  'file_decision',
  'query_financials',
  'query_costs',
  'query_customers',
  'check_system_health',
  'query_logs',
  'read_file',
  'deploy_to_staging',

  // ── Pre-existing shared tools (missing from initial registry) ──
  // diagnosticTools
  'check_table_schema',
  'diagnose_column_error',
  'list_tables',
  'check_tool_health',
  // accessAuditTools
  'view_access_matrix',
  'view_pending_grant_requests',
  // agentCreationTools
  'create_specialist_agent',
  'list_my_created_agents',
  'retire_created_agent',
  // toolRequestTools
  'request_tool_access',
  // sharepointTools
  'search_sharepoint',
  'read_sharepoint_document',
  'upload_to_sharepoint',
  'list_sharepoint_folders',

  // ── Marketing shared tools (Wave 1) ──
  // contentTools
  'create_content_draft',
  'update_content_draft',
  'get_content_drafts',
  'publish_content',
  'get_content_metrics',
  'get_content_calendar',
  'generate_content_image',
  // seoTools
  'get_search_performance',
  'get_seo_data',
  'track_keyword_rankings',
  'analyze_page_seo',
  'get_indexing_status',
  'submit_sitemap',
  'update_seo_data',
  'get_backlink_profile',
  // socialMediaTools
  'get_scheduled_posts',
  'get_social_metrics',
  'get_post_performance',
  'get_social_audience',
  'reply_to_social',
  'get_trending_topics',
  // emailMarketingTools (Mailchimp)
  'get_mailchimp_lists',
  'get_mailchimp_members',
  'get_mailchimp_segments',
  'create_mailchimp_campaign',
  'set_campaign_content',
  'send_test_campaign',
  'send_campaign',
  'get_campaign_report',
  'get_campaign_list',
  'manage_mailchimp_tags',
  // emailMarketingTools (Mandrill)
  'send_transactional_email',
  'get_mandrill_stats',
  'search_mandrill_messages',
  'get_mandrill_templates',
  'render_mandrill_template',
  // marketingIntelTools
  'create_experiment',
  'get_experiment_results',
  'monitor_competitor_marketing',
  'analyze_market_trends',
  'get_attribution_data',
  'capture_lead',
  'get_lead_pipeline',
  'score_lead',
  'get_marketing_dashboard',

  // ── Finance shared tools (Wave 2) ──
  // revenueTools
  'get_mrr_breakdown',
  'get_subscription_details',
  'get_churn_analysis',
  'get_revenue_forecast',
  'get_stripe_invoices',
  'get_customer_ltv',
  // costManagementTools
  'get_gcp_costs',
  'get_ai_model_costs',
  'get_vendor_costs',
  'get_cost_anomalies',
  'get_burn_rate',
  'create_budget',
  'check_budget_status',
  'get_unit_economics',
  // cashFlowTools
  'get_cash_balance',
  'get_cash_flow',
  'get_pending_transactions',
  'generate_financial_report',
  'get_margin_analysis',

  // ── Product + Research shared tools (Wave 3) ──
  // productAnalyticsTools
  'query_analytics_events',
  'get_usage_metrics',
  'get_funnel_analysis',
  'get_cohort_retention',
  'get_feature_usage',
  'segment_users',
  // userResearchTools
  'create_survey',
  'get_survey_results',
  'analyze_support_tickets',
  'get_user_feedback',
  'create_user_persona',
  // competitiveIntelTools
  'track_competitor',
  'get_competitor_profile',
  'update_competitor_profile',
  'compare_features',
  'track_competitor_pricing',
  'monitor_competitor_launches',
  'get_market_landscape',
  // roadmapTools
  'create_roadmap_item',
  'score_feature_rice',
  'get_roadmap',
  'update_roadmap_item',
  'get_feature_requests',
  'manage_feature_flags',
  // researchRepoTools
  'save_research',
  'search_research',
  'get_research_timeline',
  'create_research_brief',
  // researchMonitoringTools
  'create_monitor',
  'check_monitors',
  'get_monitor_history',
  'track_competitor_product',
  'search_academic_papers',
  'track_open_source',
  'track_industry_events',
  'track_regulatory_changes',
  'analyze_ai_adoption',
  'track_ai_benchmarks',
  'analyze_org_structure',
  'compile_research_digest',
  'identify_research_gaps',
  'cross_reference_findings',

  // ── Governance shared tools (Wave 4) ──
  // legalTools
  'track_regulations',
  'get_compliance_status',
  'update_compliance_item',
  'create_compliance_alert',
  'get_contracts',
  'create_contract_review',
  'flag_contract_issue',
  'get_contract_renewals',
  'get_ip_portfolio',
  'create_ip_filing',
  'monitor_ip_infringement',
  'get_tax_calendar',
  'calculate_tax_estimate',
  'get_tax_research',
  'review_tax_strategy',
  'audit_data_flows',
  'check_data_retention',
  'get_privacy_requests',
  'audit_access_permissions',
  // hrTools
  'get_org_chart',
  'update_agent_profile',
  'get_agent_directory',
  'create_onboarding_plan',
  'get_agent_performance_summary',
  'create_performance_review',
  'run_engagement_survey',
  'get_team_dynamics',
  // opsExtensionTools
  'get_agent_health_dashboard',
  'get_event_bus_health',
  'get_data_freshness',
  'get_system_costs_realtime',
  'create_status_report',
  'predict_capacity',
  'get_access_matrix',
  'provision_access',
  'revoke_access',
  'audit_access',
  'rotate_secrets',
  'get_platform_audit_log',

  // ── Engineering gap tools (Wave 5) ──
  // engineeringGapTools
  'run_test_suite',
  'get_code_coverage',
  'get_quality_metrics',
  'create_test_plan',
  'get_container_logs',
  'scale_service',
  'get_build_queue',
  'get_deployment_history',
  'get_infrastructure_inventory',
  'get_service_dependencies',
]);

/**
 * Check whether a tool name is known to the system (static registry).
 */
export function isKnownTool(name: string): boolean {
  return KNOWN_TOOLS.has(name) || _dynamicToolCache.has(name);
}

/**
 * Filter a list of tool names to only those that exist in the system.
 */
export function filterKnownTools(toolNames: string[]): string[] {
  return toolNames.filter((n) => KNOWN_TOOLS.has(n) || _dynamicToolCache.has(n));
}

/**
 * Get all known tool names.
 */
export function getAllKnownTools(): string[] {
  return [...new Set([...KNOWN_TOOLS, ..._dynamicToolCache])];
}

// ── Dynamic Tool Registry (DB-backed) ────────────────────────────

/** Cache of dynamically registered tool names. Refreshed periodically. */
const _dynamicToolCache = new Set<string>();
let _dynamicToolCacheExpiry = 0;
const DYNAMIC_CACHE_TTL = 60_000; // 60 seconds

/**
 * Refresh the dynamic tool cache from the DB.
 */
export async function refreshDynamicToolCache(): Promise<void> {
  const data = await systemQuery<{ name: string }>(
    'SELECT name FROM tool_registry WHERE is_active = true',
    [],
  );

  _dynamicToolCache.clear();
  if (data) {
    for (const row of data) _dynamicToolCache.add(row.name);  }
  _dynamicToolCacheExpiry = Date.now() + DYNAMIC_CACHE_TTL;
}

/**
 * Check if a tool is known, including DB-registered tools.
 * Refreshes dynamic cache if stale.
 */
export async function isKnownToolAsync(name: string): Promise<boolean> {
  if (KNOWN_TOOLS.has(name)) return true;
  if (Date.now() > _dynamicToolCacheExpiry) {
    await refreshDynamicToolCache();
  }
  return _dynamicToolCache.has(name);
}

export interface RegisteredToolDef {
  name: string;
  description: string;
  category: string;
  parameters: Record<string, unknown>;
  api_config: ApiToolConfig | null;
}

export interface ApiToolConfig {
  method: string;
  url_template: string;
  headers_template?: Record<string, string>;
  body_template?: unknown;
  auth_type: 'bearer_env' | 'header_env' | 'none';
  auth_env_var?: string;
  response_path?: string;
}

/**
 * Load a registered tool definition from the DB.
 */
export async function loadRegisteredTool(
  name: string,
): Promise<RegisteredToolDef | null> {
  const [data] = await systemQuery<RegisteredToolDef>(
    'SELECT name, description, category, parameters, api_config FROM tool_registry WHERE name = $1 AND is_active = true LIMIT 1',
    [name],
  );

  return data ?? null;
}

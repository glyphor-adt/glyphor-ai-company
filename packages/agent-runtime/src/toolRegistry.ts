/**
 * Tool Registry — Central lookup for tool names.
 *
 * Maps tool names (from skills.tools_granted) to a flag indicating
 * the tool exists in the system. Agents' run.ts files already assemble
 * full ToolDefinition[] arrays; this registry lets the skill system
 * and the dynamic grant system verify which tools are available
 * without importing every tool module.
 */

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
  'query_supabase_health',
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
  'query_supabase_usage',
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
]);

/**
 * Check whether a tool name is known to the system.
 */
export function isKnownTool(name: string): boolean {
  return KNOWN_TOOLS.has(name);
}

/**
 * Filter a list of tool names to only those that exist in the system.
 */
export function filterKnownTools(toolNames: string[]): string[] {
  return toolNames.filter((n) => KNOWN_TOOLS.has(n));
}

/**
 * Get all known tool names.
 */
export function getAllKnownTools(): string[] {
  return [...KNOWN_TOOLS];
}

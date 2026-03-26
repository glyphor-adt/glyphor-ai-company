export interface ToolNamespaceConfig {
  name: string;
  description: string;
  toolPrefixes: string[];
}

export const TOOL_NAMESPACES: ToolNamespaceConfig[] = [
  {
    name: 'finance',
    description: 'Revenue, billing, costs, burn, and financial reporting tools.',
    toolPrefixes: ['query_financial', 'query_cost', 'query_stripe', 'get_burn', 'get_cash', 'get_margin', 'get_mrr', 'get_unit', 'get_revenue', 'forecast_revenue', 'generate_financial', 'write_financial', 'calculate_ltv', 'calculate_unit'],
  },
  {
    name: 'engineering',
    description: 'System health, logs, CI/CD, repository, deployment, and testing tools.',
    toolPrefixes: ['check_system', 'query_log', 'query_error', 'query_uptime', 'query_cloud', 'query_db', 'get_deployment', 'get_ci', 'get_pipeline', 'get_recent_commits', 'check_pr', 'check_build', 'create_github', 'create_branch', 'merge_github', 'comment_on_pr', 'run_test', 'query_test', 'get_quality', 'get_code_coverage', 'deploy_', 'scale_service', 'inspect_cloud', 'run_health', 'get_container', 'get_service_dep', 'get_infrastructure', 'list_deployments'],
  },
  {
    name: 'marketing',
    description: 'Content creation, SEO, social media, and marketing analytics tools.',
    toolPrefixes: ['draft_blog', 'draft_case', 'draft_email', 'draft_social', 'write_content', 'create_content', 'update_content', 'submit_content', 'approve_content', 'reject_content', 'publish_content', 'get_content', 'query_content', 'discover_keywords', 'track_keyword', 'query_keyword', 'query_seo', 'get_seo', 'update_seo', 'get_search_performance', 'query_search_console', 'analyze_page_seo', 'analyze_content_seo', 'get_backlink', 'query_backlink', 'schedule_social', 'get_social', 'query_social', 'query_audience', 'monitor_mentions', 'get_marketing', 'get_attribution'],
  },
  {
    name: 'design',
    description: 'Design tokens, component libraries, Figma, accessibility, and Storybook tools.',
    toolPrefixes: ['get_design', 'update_design', 'get_color', 'get_typography', 'get_component', 'save_component', 'query_component', 'check_ai_smell', 'run_accessibility', 'write_design', 'get_figma', 'export_figma', 'create_figma', 'post_figma', 'manage_figma', 'get_template', 'list_template', 'save_template', 'update_template', 'query_template', 'validate_tokens', 'create_logo', 'restyle_logo', 'generate_favicon', 'create_social_avatar', 'screenshot_component', 'screenshot_page', 'compare_screenshot', 'scaffold_component', 'scaffold_page', 'push_component', 'storybook_', 'invoke_web', 'normalize_design_brief', 'codex'],
  },
  {
    name: 'research',
    description: 'Web research, competitive intelligence, and monitoring tools.',
    toolPrefixes: ['web_search', 'web_fetch', 'search_research', 'save_research', 'submit_research', 'create_research', 'compile_research', 'identify_research', 'cross_reference', 'get_research', 'get_competitor', 'update_competitor', 'track_competitor', 'compare_features', 'search_crunchbase', 'search_product_hunt', 'fetch_pricing', 'fetch_github_releases', 'search_hacker_news', 'search_linkedin', 'search_news', 'search_academic', 'search_job_postings', 'check_job_postings', 'analyze_market', 'get_market', 'track_industry', 'track_open_source', 'track_regulatory', 'analyze_ai', 'track_ai', 'create_monitor', 'check_monitors', 'store_intel', 'analyze_org', 'analyze_tech'],
  },
  {
    name: 'operations',
    description: 'Agent health, run operations, retries, incidents, and operational reporting.',
    toolPrefixes: ['query_agent', 'get_agent', 'rollup_agent', 'trigger_agent', 'pause_agent', 'resume_agent', 'retry_failed', 'retry_data_sync', 'get_event_bus', 'check_tool_health', 'get_platform_health', 'get_system_cost', 'post_system_status', 'get_process_patterns', 'record_process', 'get_company_vitals', 'update_company_vitals', 'write_health_report', 'create_incident', 'resolve_incident'],
  },
  {
    name: 'legal',
    description: 'Contracts, compliance, IP, regulation, privacy, and signing tools.',
    toolPrefixes: ['get_contract', 'create_contract', 'flag_contract', 'get_compliance', 'create_compliance', 'update_compliance', 'get_ip_portfolio', 'create_ip_filing', 'monitor_ip', 'track_regulation', 'get_privacy', 'check_data_retention', 'audit_data_flows', 'create_signing', 'send_template_envelope', 'check_envelope', 'list_envelope', 'resend_envelope', 'void_envelope'],
  },
  {
    name: 'entra_m365',
    description: 'Microsoft Entra ID and M365 administration tools.',
    toolPrefixes: ['entra_', 'list_users', 'get_user', 'list_channels', 'list_channel_members', 'add_channel_member', 'create_channel', 'post_to_channel', 'list_calendar_events'],
  },
  {
    name: 'communication',
    description: 'Messaging, email, calendar, channels, and inter-agent communication tools.',
    toolPrefixes: ['send_teams', 'read_teams', 'post_to_channel', 'add_channel', 'create_channel', 'list_channel', 'list_channels', 'send_dm', 'check_messages', 'list_calendar', 'create_calendar', 'send_briefing', 'read_inbox', 'send_email', 'reply_to_email', 'forward_email'],
  },
  {
    name: 'pulse_creative',
    description: 'Pulse creative production tools for image, video, storyboard, and voice.',
    toolPrefixes: ['pulse_'],
  },
  {
    name: 'governance',
    description: 'Decision routing, directives, tool governance, and platform audit tools.',
    toolPrefixes: ['file_decision', 'propose_directive', 'propose_initiative', 'propose_authority', 'read_founder', 'read_initiative', 'read_proposed', 'update_directive', 'get_pending_decisions', 'get_authority', 'create_decision', 'run_access_audit', 'audit_access', 'get_access_matrix', 'view_access', 'view_pending', 'provision_access', 'revoke_access', 'grant_tool', 'revoke_tool', 'grant_project', 'revoke_project', 'review_tool_request', 'list_tool_requests', 'create_service_account', 'list_service_accounts', 'write_admin_log', 'get_platform_audit'],
  },
  {
    name: 'knowledge',
    description: 'Shared memory, doctrine, knowledge graph, and organizational knowledge tools.',
    toolPrefixes: ['save_memory', 'recall_memories', 'search_memories', 'contribute_knowledge', 'write_company_memory', 'read_company_memory', 'promote_to_org', 'get_org_knowledge', 'query_knowledge', 'add_knowledge', 'add_graph', 'detect_contradictions', 'read_company_doctrine', 'update_doctrine', 'create_knowledge_route', 'get_knowledge_routes'],
  },
  {
    name: 'mailchimp',
    description: 'Mailchimp and Mandrill campaign and transactional email tools.',
    toolPrefixes: ['get_campaign', 'get_mailchimp', 'get_mandrill', 'create_mailchimp', 'manage_mailchimp', 'send_campaign', 'send_test_campaign', 'set_campaign', 'search_mandrill', 'render_mandrill', 'send_transactional'],
  },
  {
    name: 'canva',
    description: 'Canva design and brand asset tools.',
    toolPrefixes: ['create_canva', 'generate_canva', 'get_canva', 'export_canva', 'search_canva', 'upload_canva', 'list_canva'],
  },
];

export function matchesNamespacePrefix(toolName: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => toolName.startsWith(prefix));
}

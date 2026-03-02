import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiCall, SCHEDULER_URL } from '../lib/firebase';
import { useAuth } from '../lib/auth';
import { DISPLAY_NAME_MAP, ROLE_DEPARTMENT, ROLE_TIER, ROLE_TITLE } from '../lib/types';
import { Card, SectionHeader, Skeleton, timeAgo, PageTabs, AgentAvatar } from '../components/ui';
import {
  MdExpandMore, MdChevronRight, MdCheck, MdWarning,
  MdLock, MdVpnKey, MdBarChart, MdClose,
  MdShield, MdPersonAdd, MdRemoveCircle, MdSearch,
  MdAdminPanelSettings, MdPending, MdCheckCircle,
} from 'react-icons/md';

/* ── Types ────────────────────────────────── */

interface IAMState {
  id: string;
  platform: string;
  credential_id: string;
  agent_role: string | null;
  permissions: Record<string, unknown>;
  desired_permissions: Record<string, unknown> | null;
  in_sync: boolean;
  drift_details: string | null;
  last_synced: string;
}

interface AuditEntry {
  id: string;
  agent_role: string;
  platform: string;
  action: string;
  resource: string | null;
  response_code: number | null;
  response_summary: string | null;
  cost_estimate: number | null;
  timestamp: string;
}

interface SecretRotation {
  id: string;
  platform: string;
  secret_name: string;
  created_at: string;
  expires_at: string | null;
  status: string;
}

type Platform = 'gcp' | 'm365' | 'github' | 'stripe' | 'vercel';

type GovernanceTab = 'platform' | 'admin';

/* ── Admin-only access gate ───────────────── */
const ADMIN_EMAILS = ['kristina@glyphor.ai', 'devops@glyphor.ai'];

interface ToolGrant {
  id: string;
  agent_role: string;
  tool_name: string;
  granted_by: string;
  reason: string | null;
  scope: string;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PendingApproval {
  id: string;
  tier: string;
  status: string;
  title: string;
  summary: string;
  proposed_by: string;
  data: Record<string, unknown> | null;
  created_at: string;
}

/* ── All agent roles for the grant dropdown ── */
const AGENT_ROLES = Object.keys(DISPLAY_NAME_MAP).sort();

/* ── Department ordering for org-grouped views ── */
const DEPT_ORDER = [
  'Executive Office',
  'Engineering',
  'Product',
  'Finance',
  'Marketing',
  'Customer Success',
  'Sales',
  'Design & Frontend',
  'Research & Intelligence',
  'Operations',
  'Operations & IT',
  'Legal',
  'People & Culture',
];

const TIER_PRIORITY: Record<string, number> = {
  Orchestrator: 0,
  Executive: 1,
  Specialist: 2,
  'Sub-Team': 3,
};

/** Group all agent roles by department, ordered by DEPT_ORDER */
function getAgentsByDepartment(): { dept: string; roles: string[] }[] {
  const deptMap = new Map<string, string[]>();
  for (const role of AGENT_ROLES) {
    const dept = ROLE_DEPARTMENT[role] ?? 'Other';
    if (!deptMap.has(dept)) deptMap.set(dept, []);
    deptMap.get(dept)!.push(role);
  }
  // Sort agents within each dept: execs first, then sub-team
  for (const [, list] of deptMap) {
    list.sort((a, b) => {
      const tierA = TIER_PRIORITY[ROLE_TIER[a] ?? 'Sub-Team'] ?? 3;
      const tierB = TIER_PRIORITY[ROLE_TIER[b] ?? 'Sub-Team'] ?? 3;
      if (tierA !== tierB) return tierA - tierB;
      return (DISPLAY_NAME_MAP[a] ?? a).localeCompare(DISPLAY_NAME_MAP[b] ?? b);
    });
  }
  // Order departments by DEPT_ORDER
  const ordered: { dept: string; roles: string[] }[] = [];
  for (const dept of DEPT_ORDER) {
    if (deptMap.has(dept)) {
      ordered.push({ dept, roles: deptMap.get(dept)! });
      deptMap.delete(dept);
    }
  }
  for (const [dept, roles] of deptMap) {
    ordered.push({ dept, roles });
  }
  return ordered;
}

/* ── Constants ────────────────────────────── */

const PLATFORM_LABELS: Record<Platform, string> = {
  gcp: 'Google Cloud Platform',
  m365: 'Microsoft 365 / Entra ID',
  github: 'GitHub',
  stripe: 'Stripe',
  vercel: 'Vercel',
};

const PLATFORM_COLORS: Record<Platform, string> = {
  gcp: '#4285F4',
  m365: '#0078D4',
  github: '#171515',
  stripe: '#635BFF',
  vercel: '#000000',
};

/* ── Tool Catalog ─────────────────────────── */

type ToolCategory = 'communication' | 'memory' | 'workflow' | 'platform' | 'github' | 'finance' | 'analytics' | 'content' | 'm365' | 'gcp-iam' | 'design' | 'support' | 'sales' | 'seo' | 'social' | 'operations' | 'research' | 'onboarding';

interface ToolInfo { description: string; category: ToolCategory; platform?: string }

const CATEGORY_LABELS: Record<ToolCategory, string> = {
  communication: 'Communication',
  memory: 'Memory & Knowledge',
  workflow: 'Workflow & Assignments',
  platform: 'Platform & Infrastructure',
  github: 'GitHub & Code',
  finance: 'Finance & Billing',
  analytics: 'Analytics & Data',
  content: 'Content & Marketing',
  m365: 'Microsoft 365 / Teams',
  'gcp-iam': 'GCP IAM & Secrets',
  design: 'Design & Quality',
  support: 'Customer Support',
  sales: 'Sales & Prospecting',
  seo: 'SEO & Search',
  social: 'Social Media',
  operations: 'Operations & Monitoring',
  research: 'Research & Intel',
  onboarding: 'Onboarding & Activation',
};

const CATEGORY_COLORS: Record<ToolCategory, string> = {
  communication: 'text-prism-sky',
  memory: 'text-prism-purple',
  workflow: 'text-prism-elevated',
  platform: 'text-[#4285F4]',
  github: 'text-txt-primary',
  finance: 'text-prism-teal',
  analytics: 'text-prism-secondary',
  content: 'text-prism-pink',
  m365: 'text-[#0078D4]',
  'gcp-iam': 'text-[#4285F4]',
  design: 'text-prism-purple',
  support: 'text-prism-elevated',
  sales: 'text-prism-teal',
  seo: 'text-prism-secondary',
  social: 'text-prism-pink',
  operations: 'text-prism-critical',
  research: 'text-prism-sky',
  onboarding: 'text-prism-teal',
};

const TOOL_CATALOG: Record<string, ToolInfo> = {
  // Communication
  send_email: { description: 'Send emails via company mail', category: 'communication', platform: 'm365' },
  read_inbox: { description: 'Read email inbox', category: 'communication', platform: 'm365' },
  reply_to_email: { description: 'Reply to email thread', category: 'communication', platform: 'm365' },
  send_dm: { description: 'Send direct message to agent or user', category: 'communication' },
  send_briefing: { description: 'Send daily briefing to founder', category: 'communication' },
  send_agent_message: { description: 'Send inter-agent messages', category: 'communication' },
  check_messages: { description: 'Check incoming agent messages', category: 'communication' },
  call_meeting: { description: 'Schedule a meeting between agents', category: 'communication' },
  create_calendar_event: { description: 'Create calendar event', category: 'communication', platform: 'm365' },

  // Memory & Knowledge
  save_memory: { description: 'Store information in agent memory', category: 'memory' },
  recall_memories: { description: 'Retrieve stored memories', category: 'memory' },
  search_memories: { description: 'Search across agent memories', category: 'memory' },
  contribute_knowledge: { description: 'Add to knowledge base', category: 'memory' },
  promote_to_org_knowledge: { description: 'Promote knowledge to org-wide', category: 'memory' },
  get_org_knowledge: { description: 'Query organizational knowledge', category: 'memory' },
  create_knowledge_route: { description: 'Create knowledge routing rule', category: 'memory' },
  get_knowledge_routes: { description: 'View knowledge routing config', category: 'memory' },
  add_knowledge: { description: 'Add to knowledge graph', category: 'memory' },
  add_graph_node: { description: 'Add node to knowledge graph', category: 'memory' },
  add_graph_edge: { description: 'Add edge to knowledge graph', category: 'memory' },
  query_knowledge_graph: { description: 'Query the knowledge graph', category: 'memory' },
  trace_causes: { description: 'Trace causal chains in graph', category: 'memory' },
  trace_impact: { description: 'Trace downstream impact in graph', category: 'memory' },
  read_company_memory: { description: 'Read company-wide memory store', category: 'memory' },
  write_company_memory: { description: 'Write to company memory', category: 'memory' },
  detect_contradictions: { description: 'Detect contradictions in knowledge', category: 'memory' },
  record_process_pattern: { description: 'Record a process pattern', category: 'memory' },
  get_process_patterns: { description: 'Get recorded process patterns', category: 'memory' },

  // Workflow & Assignments
  read_my_assignments: { description: 'Read assigned work items', category: 'workflow' },
  submit_assignment_output: { description: 'Submit completed work output', category: 'workflow' },
  flag_assignment_blocker: { description: 'Flag a blocker on assignment', category: 'workflow' },
  create_work_assignments: { description: 'Create work assignments for agents', category: 'workflow' },
  dispatch_assignment: { description: 'Dispatch assignment to agent', category: 'workflow' },
  check_assignment_status: { description: 'Check assignment completion status', category: 'workflow' },
  evaluate_assignment: { description: 'Evaluate assignment output quality', category: 'workflow' },
  read_founder_directives: { description: 'Read founder directives', category: 'workflow' },
  update_directive_progress: { description: 'Update directive progress', category: 'workflow' },
  propose_directive: { description: 'Propose a new directive', category: 'workflow' },
  create_decision: { description: 'Create decision for approval', category: 'workflow' },
  get_pending_decisions: { description: 'Get pending decisions queue', category: 'workflow' },
  check_escalations: { description: 'Check for escalated issues', category: 'workflow' },
  propose_authority_change: { description: 'Propose authority model change', category: 'workflow' },
  get_authority_proposals: { description: 'View authority change proposals', category: 'workflow' },
  log_activity: { description: 'Log agent activity', category: 'workflow' },
  get_agent_directory: { description: 'Get directory of all agents', category: 'workflow' },
  who_handles: { description: 'Find which agent handles a topic', category: 'workflow' },

  // Collective Intelligence
  get_company_pulse: { description: 'Get company health pulse', category: 'workflow' },
  update_company_pulse: { description: 'Update company pulse metrics', category: 'workflow' },
  update_pulse_highlights: { description: 'Update pulse highlights', category: 'workflow' },
  emit_insight: { description: 'Emit an insight to the org', category: 'workflow' },
  emit_alert: { description: 'Emit an alert to the org', category: 'workflow' },

  // Tool Management
  grant_tool_access: { description: 'Grant tool access to an agent', category: 'workflow' },
  revoke_tool_access: { description: 'Revoke agent tool access', category: 'workflow' },
  request_new_tool: { description: 'Request a new tool be built', category: 'workflow' },
  check_tool_request_status: { description: 'Check status of tool request', category: 'workflow' },
  list_tool_requests: { description: 'List all tool requests', category: 'workflow' },
  review_tool_request: { description: 'Review a tool request', category: 'workflow' },
  register_tool: { description: 'Register a new tool in registry', category: 'workflow' },
  deactivate_tool: { description: 'Deactivate a registered tool', category: 'workflow' },
  list_registered_tools: { description: 'List all registered tools', category: 'workflow' },

  // Platform & Infrastructure
  get_platform_health: { description: 'Get platform health overview', category: 'platform', platform: 'gcp' },
  get_cloud_run_metrics: { description: 'Get Cloud Run service metrics', category: 'platform', platform: 'gcp' },
  get_infrastructure_costs: { description: 'Get infrastructure cost breakdown', category: 'platform', platform: 'gcp' },
  get_recent_activity: { description: 'Get recent system activity', category: 'platform' },
  get_product_metrics: { description: 'Get product usage metrics', category: 'platform' },
  query_cloud_run_metrics: { description: 'Query Cloud Run metrics', category: 'platform', platform: 'gcp' },
  run_health_check: { description: 'Run platform health check', category: 'platform', platform: 'gcp' },
  query_gemini_latency: { description: 'Query Gemini API latency', category: 'platform', platform: 'gcp' },
  query_db_health: { description: 'Query database health', category: 'platform' },
  query_uptime: { description: 'Query service uptime stats', category: 'platform' },
  get_repo_code_health: { description: 'Get repository code health', category: 'platform', platform: 'github' },
  query_vercel_health: { description: 'Query Vercel deployment health', category: 'platform', platform: 'vercel' },
  trigger_vercel_deploy: { description: 'Trigger Vercel deployment', category: 'platform', platform: 'vercel' },
  rollback_vercel_deploy: { description: 'Rollback Vercel deployment', category: 'platform', platform: 'vercel' },
  check_system_health: { description: 'Check overall system health', category: 'platform' },
  deploy_to_staging: { description: 'Deploy to staging environment', category: 'platform' },

  // GitHub & Code
  get_github_pr_status: { description: 'Get PR status and reviews', category: 'github', platform: 'github' },
  get_ci_health: { description: 'Get CI pipeline health', category: 'github', platform: 'github' },
  get_repo_stats: { description: 'Get repository statistics', category: 'github', platform: 'github' },
  create_github_issue: { description: 'Create GitHub issue', category: 'github', platform: 'github' },
  get_file_contents: { description: 'Read file from repo', category: 'github', platform: 'github' },
  create_or_update_file: { description: 'Create or update repo file', category: 'github', platform: 'github' },
  create_branch: { description: 'Create Git branch', category: 'github', platform: 'github' },
  create_github_pr: { description: 'Create pull request', category: 'github', platform: 'github' },
  merge_github_pr: { description: 'Merge pull request', category: 'github', platform: 'github' },
  get_pipeline_runs: { description: 'Get CI pipeline runs', category: 'github', platform: 'github' },
  get_recent_commits: { description: 'Get recent commits', category: 'github', platform: 'github' },
  comment_on_pr: { description: 'Comment on pull request', category: 'github', platform: 'github' },
  query_vercel_builds: { description: 'Query Vercel build history', category: 'github', platform: 'vercel' },
  query_build_logs: { description: 'Query CI build logs', category: 'github', platform: 'github' },
  query_error_patterns: { description: 'Detect error patterns in builds', category: 'github', platform: 'github' },
  create_bug_report: { description: 'Create bug report from error', category: 'github', platform: 'github' },
  query_test_results: { description: 'Query test suite results', category: 'github', platform: 'github' },
  read_file: { description: 'Read file from filesystem', category: 'github' },

  // Finance & Billing
  get_financials: { description: 'Get financial overview', category: 'finance', platform: 'stripe' },
  calculate_unit_economics: { description: 'Calculate unit economics', category: 'finance' },
  write_financial_report: { description: 'Write financial report', category: 'finance' },
  query_stripe_mrr: { description: 'Query Stripe MRR metrics', category: 'finance', platform: 'stripe' },
  query_stripe_subscriptions: { description: 'Query Stripe subscriptions', category: 'finance', platform: 'stripe' },
  query_stripe_revenue: { description: 'Query Stripe revenue data', category: 'finance', platform: 'stripe' },
  query_revenue_by_product: { description: 'Revenue breakdown by product', category: 'finance', platform: 'stripe' },
  query_revenue_by_cohort: { description: 'Revenue breakdown by cohort', category: 'finance', platform: 'stripe' },
  query_attribution: { description: 'Query revenue attribution', category: 'finance', platform: 'stripe' },
  calculate_ltv_cac: { description: 'Calculate LTV/CAC ratios', category: 'finance', platform: 'stripe' },
  forecast_revenue: { description: 'Forecast future revenue', category: 'finance' },
  query_churn_revenue: { description: 'Query revenue churn', category: 'finance', platform: 'stripe' },
  query_gcp_billing: { description: 'Query GCP billing data', category: 'finance', platform: 'gcp' },
  query_db_usage: { description: 'Query database usage costs', category: 'finance', platform: 'gcp' },
  query_gemini_cost: { description: 'Query Gemini API costs', category: 'finance', platform: 'gcp' },
  query_agent_run_costs: { description: 'Query agent run costs', category: 'finance', platform: 'gcp' },
  identify_waste: { description: 'Identify cost waste', category: 'finance' },
  calculate_unit_cost: { description: 'Calculate per-unit costs', category: 'finance' },
  project_costs: { description: 'Project future costs', category: 'finance' },
  query_vercel_usage: { description: 'Query Vercel usage costs', category: 'finance', platform: 'vercel' },
  query_financials: { description: 'Query financial data', category: 'finance' },
  query_costs: { description: 'Query cost data', category: 'finance' },

  // Analytics & Data
  query_user_analytics: { description: 'Query user analytics data', category: 'analytics' },
  query_build_metadata: { description: 'Query build metadata', category: 'analytics' },
  query_onboarding_funnel: { description: 'Query onboarding funnel', category: 'analytics' },
  run_cohort_analysis: { description: 'Run cohort analysis', category: 'analytics' },
  query_churn_data: { description: 'Query user churn data', category: 'analytics' },
  design_experiment: { description: 'Design A/B experiment', category: 'analytics' },
  write_product_analysis: { description: 'Write product analysis report', category: 'analytics' },
  write_health_report: { description: 'Write health/status report', category: 'analytics' },
  write_pipeline_report: { description: 'Write pipeline report', category: 'analytics' },
  query_customers: { description: 'Query customer data', category: 'analytics' },

  // Content & Marketing
  write_content: { description: 'Write marketing content', category: 'content' },
  draft_blog_post: { description: 'Draft blog post', category: 'content' },
  draft_social_post: { description: 'Draft social media post', category: 'content' },
  draft_case_study: { description: 'Draft case study', category: 'content' },
  draft_email: { description: 'Draft marketing email', category: 'content' },
  query_content_performance: { description: 'Query content performance', category: 'content' },
  query_top_performing_content: { description: 'Find top performing content', category: 'content' },

  // SEO
  query_seo_rankings: { description: 'Query search rankings', category: 'seo' },
  query_keyword_data: { description: 'Query keyword data', category: 'seo' },
  discover_keywords: { description: 'Discover new keywords', category: 'seo' },
  query_competitor_rankings: { description: 'Query competitor rankings', category: 'seo' },
  query_backlinks: { description: 'Query backlink profile', category: 'seo' },
  query_search_console: { description: 'Query Google Search Console', category: 'seo', platform: 'gcp' },
  analyze_content_seo: { description: 'Analyze content for SEO', category: 'seo' },

  // Social Media
  schedule_social_post: { description: 'Schedule social media post', category: 'social' },
  query_social_metrics: { description: 'Query social media metrics', category: 'social' },
  query_post_performance: { description: 'Query post performance', category: 'social' },
  query_optimal_times: { description: 'Find optimal posting times', category: 'social' },
  query_audience_demographics: { description: 'Query audience demographics', category: 'social' },
  monitor_mentions: { description: 'Monitor brand mentions', category: 'social' },

  // Onboarding
  query_first_build_metrics: { description: 'Query first-build metrics', category: 'onboarding' },
  query_drop_off_points: { description: 'Find onboarding drop-off points', category: 'onboarding' },
  query_welcome_email_metrics: { description: 'Query welcome email metrics', category: 'onboarding' },
  query_activation_rate: { description: 'Query activation rate', category: 'onboarding' },
  query_template_usage: { description: 'Query template usage', category: 'onboarding' },
  design_onboarding_experiment: { description: 'Design onboarding experiment', category: 'onboarding' },

  // Support
  query_support_tickets: { description: 'Query support tickets', category: 'support' },
  classify_ticket: { description: 'Classify support ticket', category: 'support' },
  respond_to_ticket: { description: 'Respond to support ticket', category: 'support' },
  escalate_ticket: { description: 'Escalate support ticket', category: 'support' },
  query_knowledge_base: { description: 'Search support knowledge base', category: 'support' },
  batch_similar_tickets: { description: 'Batch similar tickets together', category: 'support' },

  // Sales & Prospecting
  search_company_info: { description: 'Search company information', category: 'sales' },
  search_crunchbase: { description: 'Search Crunchbase data', category: 'sales' },
  analyze_tech_stack: { description: 'Analyze prospect tech stack', category: 'sales' },
  search_linkedin_profiles: { description: 'Search LinkedIn profiles', category: 'sales' },
  search_job_postings: { description: 'Search job postings', category: 'sales' },
  estimate_dev_spend: { description: 'Estimate dev tool spend', category: 'sales' },
  compile_dossier: { description: 'Compile prospect dossier', category: 'sales' },

  // Design & Quality
  run_lighthouse: { description: 'Run Lighthouse audit', category: 'design' },
  run_lighthouse_batch: { description: 'Run batch Lighthouse audits', category: 'design' },
  get_design_quality_summary: { description: 'Get design quality summary', category: 'design' },
  get_design_tokens: { description: 'Get design system tokens', category: 'design' },
  get_component_library: { description: 'Get component library', category: 'design' },
  get_template_registry: { description: 'Get template registry', category: 'design' },
  write_design_audit: { description: 'Write design audit report', category: 'design' },

  // Operations & Monitoring
  query_agent_runs: { description: 'Query agent run history', category: 'operations' },
  query_agent_health: { description: 'Query agent health status', category: 'operations' },
  query_data_sync_status: { description: 'Query data sync status', category: 'operations' },
  query_events_backlog: { description: 'Query events backlog size', category: 'operations' },
  query_cost_trends: { description: 'Query cost trends', category: 'operations' },
  trigger_agent_run: { description: 'Trigger an agent run', category: 'operations' },
  retry_failed_run: { description: 'Retry a failed agent run', category: 'operations' },
  retry_data_sync: { description: 'Retry failed data sync', category: 'operations' },
  pause_agent: { description: 'Pause an agent', category: 'operations' },
  resume_agent: { description: 'Resume a paused agent', category: 'operations' },
  create_incident: { description: 'Create incident report', category: 'operations' },
  resolve_incident: { description: 'Resolve incident', category: 'operations' },
  post_system_status: { description: 'Post system status update', category: 'operations' },
  rollup_agent_performance: { description: 'Roll up performance metrics', category: 'operations' },
  detect_milestones: { description: 'Detect agent milestones', category: 'operations' },
  update_growth_areas: { description: 'Update agent growth areas', category: 'operations' },
  query_cache_metrics: { description: 'Query cache hit/miss metrics', category: 'operations' },
  query_pipeline_metrics: { description: 'Query CI pipeline metrics', category: 'operations' },
  query_resource_utilization: { description: 'Query resource utilization', category: 'operations' },
  query_cold_starts: { description: 'Query cold start frequency', category: 'operations' },
  identify_unused_resources: { description: 'Find unused resources', category: 'operations' },
  calculate_cost_savings: { description: 'Calculate potential savings', category: 'operations' },
  query_logs: { description: 'Query application logs', category: 'operations' },

  // M365 / Teams
  list_users: { description: 'List M365 users', category: 'm365', platform: 'm365' },
  get_user: { description: 'Get M365 user details', category: 'm365', platform: 'm365' },
  list_channels: { description: 'List Teams channels', category: 'm365', platform: 'm365' },
  list_channel_members: { description: 'List channel members', category: 'm365', platform: 'm365' },
  add_channel_member: { description: 'Add member to Teams channel', category: 'm365', platform: 'm365' },
  create_channel: { description: 'Create Teams channel', category: 'm365', platform: 'm365' },
  post_to_channel: { description: 'Post message to Teams channel', category: 'm365', platform: 'm365' },
  list_calendar_events: { description: 'List calendar events', category: 'm365', platform: 'm365' },
  write_admin_log: { description: 'Write M365 admin log entry', category: 'm365', platform: 'm365' },

  // GCP IAM & Secrets
  list_project_iam: { description: 'List GCP IAM bindings', category: 'gcp-iam', platform: 'gcp' },
  grant_project_role: { description: 'Grant GCP IAM role', category: 'gcp-iam', platform: 'gcp' },
  revoke_project_role: { description: 'Revoke GCP IAM role', category: 'gcp-iam', platform: 'gcp' },
  list_service_accounts: { description: 'List GCP service accounts', category: 'gcp-iam', platform: 'gcp' },
  create_service_account: { description: 'Create GCP service account', category: 'gcp-iam', platform: 'gcp' },
  list_secrets: { description: 'List Secret Manager secrets', category: 'gcp-iam', platform: 'gcp' },
  get_secret_iam: { description: 'Get IAM policy on secret', category: 'gcp-iam', platform: 'gcp' },
  grant_secret_access: { description: 'Grant access to secret', category: 'gcp-iam', platform: 'gcp' },
  revoke_secret_access: { description: 'Revoke access to secret', category: 'gcp-iam', platform: 'gcp' },
  run_access_audit: { description: 'Run full access audit', category: 'gcp-iam', platform: 'gcp' },
  run_onboarding: { description: 'Run agent onboarding flow', category: 'gcp-iam', platform: 'gcp' },

  // Entra ID
  entra_list_users: { description: 'List Entra ID users', category: 'm365', platform: 'm365' },
  entra_create_user: { description: 'Create Entra ID user', category: 'm365', platform: 'm365' },
  entra_disable_user: { description: 'Disable Entra ID user', category: 'm365', platform: 'm365' },
  entra_list_groups: { description: 'List Entra ID groups', category: 'm365', platform: 'm365' },
  entra_list_group_members: { description: 'List group members', category: 'm365', platform: 'm365' },
  entra_add_group_member: { description: 'Add member to group', category: 'm365', platform: 'm365' },
  entra_remove_group_member: { description: 'Remove member from group', category: 'm365', platform: 'm365' },
  entra_list_directory_roles: { description: 'List directory roles', category: 'm365', platform: 'm365' },
  entra_assign_directory_role: { description: 'Assign directory role', category: 'm365', platform: 'm365' },
  entra_list_app_registrations: { description: 'List app registrations', category: 'm365', platform: 'm365' },
  entra_list_licenses: { description: 'List available licenses', category: 'm365', platform: 'm365' },
  entra_assign_license: { description: 'Assign license to user', category: 'm365', platform: 'm365' },
  entra_revoke_license: { description: 'Revoke license from user', category: 'm365', platform: 'm365' },
  entra_audit_sign_ins: { description: 'Audit sign-in logs', category: 'm365', platform: 'm365' },

  // Research & Intel
  fetch_github_releases: { description: 'Fetch competitor releases', category: 'research', platform: 'github' },
  search_hacker_news: { description: 'Search Hacker News', category: 'research' },
  search_product_hunt: { description: 'Search Product Hunt', category: 'research' },
  fetch_pricing_pages: { description: 'Fetch competitor pricing', category: 'research' },
  query_competitor_tech_stack: { description: 'Analyze competitor tech', category: 'research' },
  check_job_postings: { description: 'Check competitor job posts', category: 'research' },
  store_intel: { description: 'Store competitive intel', category: 'research' },
  web_fetch: { description: 'Fetch web page content', category: 'research' },
  search_news: { description: 'Search news sources', category: 'research' },
  submit_research_packet: { description: 'Submit research packet', category: 'research' },
  web_search: { description: 'Web search query', category: 'research' },
  file_decision: { description: 'File a decision record', category: 'workflow' },
};

/** Get tool info with fallback for unknown tools */
function getToolInfo(toolName: string): ToolInfo {
  return TOOL_CATALOG[toolName] ?? { description: toolName.replace(/_/g, ' '), category: 'workflow' as ToolCategory };
}

/** Group tools by category for dropdown */
function getToolsByCategory(): { category: ToolCategory; label: string; tools: { name: string; description: string }[] }[] {
  const groups = new Map<ToolCategory, { name: string; description: string }[]>();
  for (const [name, info] of Object.entries(TOOL_CATALOG)) {
    if (!groups.has(info.category)) groups.set(info.category, []);
    groups.get(info.category)!.push({ name, description: info.description });
  }
  return [...groups.entries()]
    .map(([category, tools]) => ({ category, label: CATEGORY_LABELS[category], tools: tools.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/* ── Collapsible Section ──────────────────── */

function CollapsibleSection({ title, color, children, defaultOpen = true }: {
  title: string;
  color: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 text-left"
      >
        <span
          className="flex h-6 w-6 items-center justify-center rounded text-white"
          style={{ backgroundColor: color }}
        >
          {open ? <MdExpandMore className="text-[14px]" /> : <MdChevronRight className="text-[14px]" />}
        </span>
        <h3 className="text-sm font-semibold text-txt-primary">{title}</h3>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </Card>
  );
}

/* ── Platform Tables ──────────────────────── */

function GCPTable({ items }: { items: IAMState[] }) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleRow = (id: string) => setExpandedRows((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-txt-muted">
            <th className="pb-2 pr-4 font-medium">Service Account</th>
            <th className="pb-2 pr-4 font-medium">Agent</th>
            <th className="pb-2 pr-4 font-medium">Roles</th>
            <th className="pb-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const roles = (item.permissions as { roles?: string[] })?.roles ?? [];
            const isExpanded = expandedRows.has(item.id);
            const visibleRoles = isExpanded ? roles : roles.slice(0, 3);
            return (
              <tr key={item.id} className="border-b border-border/50 align-top">
                <td className="py-2.5 pr-4">
                  <code className="rounded bg-prism-bg2 px-1.5 py-0.5 text-[12px]">
                    {item.credential_id.split('@')[0]}
                  </code>
                </td>
                <td className="py-2.5 pr-4 text-txt-primary">
                  {item.agent_role
                    ? DISPLAY_NAME_MAP[item.agent_role] ?? item.agent_role
                    : <span className="text-txt-muted italic">(gated)</span>}
                </td>
                <td className="py-2.5 pr-4">
                  <div className="flex flex-wrap gap-1">
                    {visibleRoles.map((role) => (
                      <span
                        key={role}
                        className="inline-block rounded-full border border-[#4285F4]/20 bg-[#4285F4]/10 px-2 py-0.5 text-[11px] font-medium text-[#4285F4]"
                        title={role}
                      >
                        {role.replace(/^roles\//, '')}
                      </span>
                    ))}
                    {roles.length > 3 && !isExpanded && (
                      <button
                        onClick={() => toggleRow(item.id)}
                        className="inline-block rounded-full border border-border bg-prism-bg2 px-2 py-0.5 text-[11px] text-txt-muted hover:text-txt-primary"
                      >
                        +{roles.length - 3} more
                      </button>
                    )}
                    {isExpanded && roles.length > 3 && (
                      <button
                        onClick={() => toggleRow(item.id)}
                        className="inline-block rounded-full border border-border bg-prism-bg2 px-2 py-0.5 text-[11px] text-txt-muted hover:text-txt-primary"
                      >
                        show less
                      </button>
                    )}
                    {roles.length === 0 && (
                      <span className="text-[11px] text-txt-muted italic">no roles</span>
                    )}
                  </div>
                </td>
                <td className="py-2.5">
                  <SyncBadge inSync={item.in_sync} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function M365Table({ items }: { items: IAMState[] }) {
  // Map credential → agents
  const agentsByCredential: Record<string, string[]> = {
    'glyphor-teams-channels': ['All (17)'],
    'glyphor-teams-bot': ['chief-of-staff', 'ops'],
    'glyphor-mail': ['chief-of-staff', 'onboarding-specialist', 'support-triage', 'vp-sales'],
    'glyphor-files': ['cfo'],
    'glyphor-users': ['cmo'],
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-txt-muted">
            <th className="pb-2 pr-4 font-medium">App Registration</th>
            <th className="pb-2 pr-4 font-medium">Scopes</th>
            <th className="pb-2 font-medium">Agents Using</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const scopes = (item.permissions as { scopes?: string[] })?.scopes ?? [];
            const agents = agentsByCredential[item.credential_id] ?? [];
            return (
              <tr key={item.id} className="border-b border-border/50">
                <td className="py-2.5 pr-4 text-txt-primary font-medium">
                  {formatCredentialName(item.credential_id)}
                </td>
                <td className="py-2.5 pr-4">
                  {scopes.map((s) => (
                    <span key={s} className="mr-1.5 inline-block rounded bg-prism-tint-3 px-1.5 py-0.5 text-[11px] font-medium text-prism-sky">
                      {s}
                    </span>
                  ))}
                </td>
                <td className="py-2.5 text-txt-muted text-[12px]">
                  {agents.map((a) => DISPLAY_NAME_MAP[a] ?? a).join(', ')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GitHubTable({ items }: { items: IAMState[] }) {
  // Show per-agent scoping from the config
  const agentScopes = [
    { role: 'cto', repos: 'fuse, pulse, runtime', perms: 'contents: write, PRs: write, actions: write' },
    { role: 'platform-engineer', repos: 'fuse, pulse', perms: 'contents: read' },
    { role: 'quality-engineer', repos: 'fuse, pulse', perms: 'contents: write (test/*)' },
    { role: 'devops-engineer', repos: 'fuse, pulse', perms: 'actions: write' },
    { role: 'competitive-intel', repos: '(public only)', perms: 'contents: read' },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-txt-muted">
            <th className="pb-2 pr-4 font-medium">Agent</th>
            <th className="pb-2 pr-4 font-medium">Repos</th>
            <th className="pb-2 font-medium">Permissions</th>
          </tr>
        </thead>
        <tbody>
          {agentScopes.map((s) => (
            <tr key={s.role} className="border-b border-border/50">
              <td className="py-2.5 pr-4 text-txt-primary font-medium">
                {DISPLAY_NAME_MAP[s.role] ?? s.role}
              </td>
              <td className="py-2.5 pr-4 text-txt-muted">{s.repos}</td>
              <td className="py-2.5 text-txt-muted text-[12px]">{s.perms}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StripeTable({ items }: { items: IAMState[] }) {
  const keyAgents: Record<string, string> = {
    'restricted-key-finance': 'Nadia Okafor',
    'restricted-key-reporting': 'Anna Park, Omar Hassan',
    'restricted-key-cs': 'James Turner, David Santos',
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-txt-muted">
            <th className="pb-2 pr-4 font-medium">Key</th>
            <th className="pb-2 pr-4 font-medium">Agents</th>
            <th className="pb-2 font-medium">Resources</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const resources = (item.permissions as { resources?: string[] })?.resources ?? [];
            return (
              <tr key={item.id} className="border-b border-border/50">
                <td className="py-2.5 pr-4 text-txt-primary font-medium">{item.credential_id}</td>
                <td className="py-2.5 pr-4 text-txt-muted">{keyAgents[item.credential_id] ?? '—'}</td>
                <td className="py-2.5">
                  {resources.map((r) => (
                    <span key={r} className="mr-1.5 inline-block rounded bg-prism-tint-5 px-1.5 py-0.5 text-[11px] font-medium text-prism-violet">
                      {r}
                    </span>
                  ))}
                  <SyncBadge inSync={item.in_sync} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VercelTable({ items }: { items: IAMState[] }) {
  const tokenAgents: Record<string, string> = {
    'token-deploy': 'Marcus Reeves',
    'token-monitoring': 'Alex Park, Jordan Hayes',
    'token-billing': 'Omar Hassan, Nadia Okafor',
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-txt-muted">
            <th className="pb-2 pr-4 font-medium">Token</th>
            <th className="pb-2 pr-4 font-medium">Agents</th>
            <th className="pb-2 font-medium">Scopes</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const scopes = (item.permissions as { scopes?: string[] })?.scopes ?? [];
            return (
              <tr key={item.id} className="border-b border-border/50">
                <td className="py-2.5 pr-4 text-txt-primary font-medium">{item.credential_id}</td>
                <td className="py-2.5 pr-4 text-txt-muted">{tokenAgents[item.credential_id] ?? '—'}</td>
                <td className="py-2.5">
                  {scopes.map((s) => (
                    <span key={s} className="mr-1.5 inline-block rounded bg-prism-bg2 px-1.5 py-0.5 text-[11px] font-medium text-prism-secondary">
                      {s}
                    </span>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Helpers ──────────────────────────────── */

function SyncBadge({ inSync }: { inSync: boolean }) {
  return inSync ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-prism-tint-2 px-2 py-0.5 text-[11px] font-medium text-prism-teal">
      <MdCheck className="text-[13px]" /> Synced
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-prism-elevated/15 px-2 py-0.5 text-[11px] font-medium text-prism-elevated">
      <MdWarning className="text-[13px]" /> Drift
    </span>
  );
}

function formatCredentialName(id: string): string {
  return id
    .replace('glyphor-', 'Glyphor – ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (86400 * 1000));
}

function ExpiryBadge({ expiresAt, status }: { expiresAt: string | null; status: string }) {
  if (!expiresAt) {
    return <span className="text-[11px] text-txt-muted">never</span>;
  }
  const days = daysUntil(expiresAt);
  if (days === null) return null;

  if (status === 'expired' || days <= 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-prism-critical/15 px-2 py-0.5 text-[11px] font-medium text-prism-critical">
        Expired
      </span>
    );
  }
  if (days <= 90) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-prism-elevated/15 px-2 py-0.5 text-[11px] font-medium text-prism-elevated">
        <MdWarning className="text-[13px]" /> {days}d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-prism-tint-2 px-2 py-0.5 text-[11px] font-medium text-prism-teal">
      <MdCheck className="text-[13px]" /> {days}d
    </span>
  );
}

/* ── Admin & Access Panel ─────────────────── */

function AdminAccessPanel({ isAdmin }: { isAdmin: boolean }) {
  const [grants, setGrants] = useState<ToolGrant[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterGrantedBy, setFilterGrantedBy] = useState('all');

  // Grant form
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [grantRole, setGrantRole] = useState('');
  const [grantTool, setGrantTool] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [grantScope, setGrantScope] = useState<'full' | 'read_only'>('full');
  const [grantExpiry, setGrantExpiry] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadGrants = useCallback(async () => {
    setLoading(true);
    try {
      const [grantsData, approvalsData] = await Promise.all([
        apiCall<ToolGrant[]>('/api/agent-tool-grants?order=agent_role.asc,tool_name.asc'),
        apiCall<PendingApproval[]>('/api/decisions?status=pending&order=created_at.desc&limit=20'),
      ]);
      setGrants(grantsData ?? []);
      setPendingApprovals(
        (approvalsData ?? []).filter((d) =>
          d.title?.toLowerCase().includes('tool') ||
          d.title?.toLowerCase().includes('grant') ||
          d.title?.toLowerCase().includes('admin') ||
          d.summary?.toLowerCase().includes('tool access')
        ),
      );
    } catch {
      setGrants([]);
      setPendingApprovals([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadGrants(); }, [loadGrants]);

  const handleGrant = async () => {
    if (!grantRole || !grantTool || !grantReason) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        agent_role: grantRole,
        tool_name: grantTool,
        granted_by: 'kristina',
        reason: grantReason,
        scope: grantScope,
        is_active: true,
      };
      if (grantExpiry) {
        body.expires_at = new Date(grantExpiry).toISOString();
      }
      await apiCall('/api/agent-tool-grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setShowGrantForm(false);
      setGrantRole('');
      setGrantTool('');
      setGrantReason('');
      setGrantScope('full');
      setGrantExpiry('');
      await loadGrants();
    } catch { /* handled by apiCall */ }
    setSubmitting(false);
  };

  const handleRevoke = async (grant: ToolGrant) => {
    if (!confirm(`Revoke "${grant.tool_name}" from ${DISPLAY_NAME_MAP[grant.agent_role] ?? grant.agent_role}?`)) return;
    try {
      await apiCall(`/api/agent-tool-grants/${grant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      });
      await loadGrants();
    } catch { /* handled by apiCall */ }
  };

  const handleApproval = async (id: string, approve: boolean) => {
    try {
      await apiCall(`/api/decisions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: approve ? 'approved' : 'rejected',
          resolved_by: 'kristina',
          resolved_at: new Date().toISOString(),
        }),
      });
      await loadGrants();
    } catch { /* handled by apiCall */ }
  };

  // Filtered/searched grants
  const activeGrants = useMemo(() => grants.filter((g) => g.is_active), [grants]);
  const grantedByOptions = useMemo(
    () => [...new Set(activeGrants.map((g) => g.granted_by))].sort(),
    [activeGrants],
  );
  const filteredGrants = useMemo(() => {
    return activeGrants.filter((g) => {
      if (filterRole !== 'all' && g.agent_role !== filterRole) return false;
      if (filterGrantedBy !== 'all' && g.granted_by !== filterGrantedBy) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          g.agent_role.includes(term) ||
          g.tool_name.includes(term) ||
          (DISPLAY_NAME_MAP[g.agent_role] ?? '').toLowerCase().includes(term) ||
          (g.reason ?? '').toLowerCase().includes(term)
        );
      }
      return true;
    });
  }, [activeGrants, filterRole, filterGrantedBy, searchTerm]);

  // Group by agent for the matrix view — include ALL agents
  const grantsByAgent = useMemo(() => {
    const map: Record<string, ToolGrant[]> = {};
    for (const g of filteredGrants) {
      (map[g.agent_role] ??= []).push(g);
    }
    return map;
  }, [filteredGrants]);

  // Department-grouped view of ALL agents
  const agentsByDept = useMemo(() => {
    const allDepts = getAgentsByDepartment();
    // Apply filters
    return allDepts
      .map((group) => ({
        dept: group.dept,
        roles: group.roles.filter((r) => {
          if (filterRole !== 'all' && r !== filterRole) return false;
          if (searchTerm) {
            const term = searchTerm.toLowerCase();
            const hasGrant = (grantsByAgent[r] ?? []).some(
              (g) => g.tool_name.includes(term) || (g.reason ?? '').toLowerCase().includes(term),
            );
            return (
              r.includes(term) ||
              (DISPLAY_NAME_MAP[r] ?? '').toLowerCase().includes(term) ||
              hasGrant
            );
          }
          return true;
        }),
      }))
      .filter((group) => group.roles.length > 0);
  }, [filterRole, searchTerm, grantsByAgent]);

  // Stats
  const agentsWithGrants = new Set(activeGrants.map((g) => g.agent_role)).size;
  const totalAgents = AGENT_ROLES.length;
  const totalTools = new Set(activeGrants.map((g) => g.tool_name)).size;
  const expiringGrants = activeGrants.filter((g) => {
    if (!g.expires_at) return false;
    const days = (new Date(g.expires_at).getTime() - Date.now()) / (86400 * 1000);
    return days > 0 && days <= 7;
  });

  if (loading) {
    return <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full" />)}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Agents with Grants', value: `${agentsWithGrants} / ${totalAgents}`, icon: <MdPersonAdd className="text-prism-sky" /> },
          { label: 'Active Grants', value: activeGrants.length, icon: <MdShield className="text-prism-teal" /> },
          { label: 'Unique Tools', value: totalTools, icon: <MdAdminPanelSettings className="text-prism-violet" /> },
          { label: 'Pending Approvals', value: pendingApprovals.length, icon: <MdPending className="text-prism-elevated" /> },
        ].map((s) => (
          <Card key={s.label} className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-prism-card text-lg">{s.icon}</span>
            <div>
              <p className="text-2xl font-bold text-txt-primary">{s.value}</p>
              <p className="text-[12px] text-txt-muted">{s.label}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Expiring Grants Warning */}
      {expiringGrants.length > 0 && (
        <Card className="border-prism-elevated/30">
          <div className="flex items-start gap-3">
            <MdWarning className="mt-0.5 text-prism-elevated" />
            <div>
              <p className="text-[13px] font-medium text-prism-primary">
                {expiringGrants.length} grant{expiringGrants.length !== 1 ? 's' : ''} expiring within 7 days
              </p>
              <div className="mt-2 space-y-1">
                {expiringGrants.map((g) => (
                  <p key={g.id} className="text-[12px] text-txt-muted">
                    <span className="font-medium text-txt-secondary">{DISPLAY_NAME_MAP[g.agent_role] ?? g.agent_role}</span>
                    {' '}&rarr; <code className="rounded bg-prism-bg2 px-1 text-[11px]">{g.tool_name}</code>
                    {' '}expires {timeAgo(g.expires_at)}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Pending Approvals */}
      {pendingApprovals.length > 0 && isAdmin && (
        <Card>
          <SectionHeader title="Pending Tool/Admin Approvals" />
          <div className="space-y-3">
            {pendingApprovals.map((d) => (
              <div
                key={d.id}
                className="flex items-start justify-between gap-4 rounded-lg border border-prism-elevated/20 bg-prism-elevated/5 p-3"
              >
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-txt-primary">{d.title}</p>
                  <p className="mt-0.5 text-[12px] text-txt-muted">{d.summary}</p>
                  <p className="mt-1 text-[11px] text-txt-muted">
                    Proposed by <span className="font-medium">{DISPLAY_NAME_MAP[d.proposed_by] ?? d.proposed_by}</span>
                    {' '}&middot; {timeAgo(d.created_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApproval(d.id, true)}
                    className="rounded border border-prism-teal/30 bg-prism-teal/10 px-3 py-1 text-[11px] font-medium text-prism-teal transition-colors hover:bg-prism-teal/20"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleApproval(d.id, false)}
                    className="rounded border border-prism-critical/30 bg-prism-critical/10 px-3 py-1 text-[11px] font-medium text-prism-critical transition-colors hover:bg-prism-critical/20"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Toolbar: Search + Filters + Grant Button */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-txt-muted" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search agents, tools, or reasons…"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-[13px] text-txt-primary placeholder:text-txt-muted focus:border-prism-sky focus:outline-none"
          />
        </div>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-txt-primary"
        >
          <option value="all">All agents</option>
          {getAgentsByDepartment().map((group) => (
            <optgroup key={group.dept} label={group.dept}>
              {group.roles.map((r) => (
                <option key={r} value={r}>{DISPLAY_NAME_MAP[r] ?? r}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <select
          value={filterGrantedBy}
          onChange={(e) => setFilterGrantedBy(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-txt-primary"
        >
          <option value="all">All grantors</option>
          {grantedByOptions.map((g) => (
            <option key={g} value={g}>{DISPLAY_NAME_MAP[g] ?? g}</option>
          ))}
        </select>
        {isAdmin && (
          <button
            onClick={() => setShowGrantForm(!showGrantForm)}
            className="flex items-center gap-1.5 rounded-lg bg-prism-sky/15 px-4 py-2 text-[13px] font-medium text-prism-sky transition-colors hover:bg-prism-sky/25"
          >
            <MdPersonAdd className="text-[16px]" />
            Grant Access
          </button>
        )}
      </div>

      {/* Grant Form (Kristina only) */}
      {showGrantForm && isAdmin && (
        <Card className="border-prism-sky/30">
          <SectionHeader title="Grant Tool Access" />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-txt-muted">Agent</label>
              <select
                value={grantRole}
                onChange={(e) => setGrantRole(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-txt-primary"
              >
                <option value="">Select agent…</option>
                {getAgentsByDepartment().map((group) => (
                  <optgroup key={group.dept} label={group.dept}>
                    {group.roles.map((r) => (
                      <option key={r} value={r}>{DISPLAY_NAME_MAP[r] ?? r} ({r})</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-txt-muted">Tool</label>
              <select
                value={grantTool}
                onChange={(e) => setGrantTool(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-txt-primary"
              >
                <option value="">Select tool…</option>
                {getToolsByCategory().map((group) => (
                  <optgroup key={group.category} label={group.label}>
                    {group.tools.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name} — {t.description}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {grantTool && TOOL_CATALOG[grantTool] && (
                <p className="mt-1 text-[11px] text-txt-muted">
                  <span className={`font-medium ${CATEGORY_COLORS[TOOL_CATALOG[grantTool].category]}`}>
                    {CATEGORY_LABELS[TOOL_CATALOG[grantTool].category]}
                  </span>
                  {TOOL_CATALOG[grantTool].platform && (
                    <span className="ml-2 rounded bg-prism-bg2 px-1.5 py-0.5 text-[10px]">
                      {TOOL_CATALOG[grantTool].platform!.toUpperCase()}
                    </span>
                  )}
                  {' · '}{TOOL_CATALOG[grantTool].description}
                </p>
              )}
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-[12px] font-medium text-txt-muted">Reason</label>
              <input
                type="text"
                value={grantReason}
                onChange={(e) => setGrantReason(e.target.value)}
                placeholder="Why is this grant needed?"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-txt-primary placeholder:text-txt-muted"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-txt-muted">Scope</label>
              <select
                value={grantScope}
                onChange={(e) => setGrantScope(e.target.value as 'full' | 'read_only')}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-txt-primary"
              >
                <option value="full">Full Access</option>
                <option value="read_only">Read Only</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-txt-muted">Expires (optional)</label>
              <input
                type="datetime-local"
                value={grantExpiry}
                onChange={(e) => setGrantExpiry(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-txt-primary"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setShowGrantForm(false)}
              className="rounded-lg border border-border px-4 py-1.5 text-[13px] text-txt-muted hover:text-txt-primary"
            >
              Cancel
            </button>
            <button
              onClick={handleGrant}
              disabled={!grantRole || !grantTool || !grantReason || submitting}
              className="rounded-lg bg-prism-sky px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
            >
              {submitting ? 'Granting…' : 'Grant'}
            </button>
          </div>
        </Card>
      )}

      {/* Access Matrix — grouped by department */}
      {agentsByDept.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-[13px] text-txt-muted">No agents match your filters</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {agentsByDept.map(({ dept, roles }) => (
            <Card key={dept}>
              <SectionHeader
                title={dept}
                subtitle={`${roles.length} agent${roles.length !== 1 ? 's' : ''}`}
              />
              <div className="space-y-4">
                {roles.map((role) => {
                  const agentGrants = grantsByAgent[role] ?? [];
                  // Group grants by category
                  const byCategory = new Map<ToolCategory, ToolGrant[]>();
                  for (const g of agentGrants) {
                    const cat = getToolInfo(g.tool_name).category;
                    if (!byCategory.has(cat)) byCategory.set(cat, []);
                    byCategory.get(cat)!.push(g);
                  }
                  return (
                    <div key={role} className="rounded-lg border border-border/50 p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <AgentAvatar role={role} size={28} />
                        <div className="min-w-0">
                          <span className="text-[14px] font-semibold text-txt-primary">
                            {DISPLAY_NAME_MAP[role] ?? role}
                          </span>
                          <span className="ml-2 rounded bg-prism-bg2 px-1.5 py-0.5 text-[11px] text-txt-muted">{role}</span>
                          {ROLE_TITLE[role] && (
                            <p className="text-[11px] text-txt-muted">{ROLE_TITLE[role]}</p>
                          )}
                        </div>
                        <span className="ml-auto text-[12px] text-txt-muted">
                          {agentGrants.length > 0
                            ? `${agentGrants.length} tool${agentGrants.length !== 1 ? 's' : ''} · ${byCategory.size} categor${byCategory.size !== 1 ? 'ies' : 'y'}`
                            : 'No tools granted'}
                        </span>
                      </div>
                      {agentGrants.length === 0 ? (
                        <p className="py-2 text-[12px] text-txt-muted italic">No tool access grants configured</p>
                      ) : (
                      <div className="space-y-2">
                        {[...byCategory.entries()]
                          .sort(([a], [b]) => (CATEGORY_LABELS[a] ?? a).localeCompare(CATEGORY_LABELS[b] ?? b))
                          .map(([cat, catGrants]) => (
                          <div key={cat}>
                            <div className="mb-1 flex items-center gap-1.5">
                              <span className={`text-[11px] font-semibold ${CATEGORY_COLORS[cat]}`}>
                                {CATEGORY_LABELS[cat]}
                              </span>
                              <span className="text-[10px] text-txt-muted">({catGrants.length})</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {catGrants.map((g) => {
                                const info = getToolInfo(g.tool_name);
                                return (
                                <span
                                  key={g.id}
                                  className="group relative inline-flex items-center gap-1 rounded-full border border-border/50 bg-prism-card px-2.5 py-1 text-[12px] text-txt-secondary"
                                  title={`${info.description}\nGranted by ${DISPLAY_NAME_MAP[g.granted_by] ?? g.granted_by}${g.reason ? `\nReason: ${g.reason}` : ''}${g.scope === 'read_only' ? '\nRead Only' : ''}${info.platform ? `\nPlatform: ${info.platform.toUpperCase()}` : ''}`}
                                >
                                  {g.scope === 'read_only' && (
                                    <MdSearch className="text-[12px] text-prism-sky" />
                                  )}
                                  {g.tool_name}
                            {info.platform && (
                              <span className="rounded bg-prism-bg2 px-1 text-[9px] font-medium text-txt-muted">
                                {info.platform.toUpperCase()}
                              </span>
                            )}
                            {g.expires_at && (
                              <span className="text-[10px] text-prism-elevated">
                                &middot; exp {new Date(g.expires_at).toLocaleDateString()}
                              </span>
                            )}
                            {isAdmin && (
                              <button
                                onClick={() => handleRevoke(g)}
                                className="ml-0.5 hidden text-prism-critical transition-colors hover:text-prism-critical/80 group-hover:inline-flex"
                                title="Revoke"
                              >
                                <MdRemoveCircle className="text-[13px]" />
                              </button>
                            )}
                                </span>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Revocation History */}
      {grants.filter((g) => !g.is_active).length > 0 && (
        <Card>
          <SectionHeader
            title="Revocation History"
            subtitle="Previously revoked grants"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-txt-muted">
                  <th className="pb-2 pr-4 font-medium">Agent</th>
                  <th className="pb-2 pr-4 font-medium">Tool</th>
                  <th className="pb-2 pr-4 font-medium">Granted By</th>
                  <th className="pb-2 pr-4 font-medium">Reason</th>
                  <th className="pb-2 font-medium">Revoked</th>
                </tr>
              </thead>
              <tbody>
                {grants
                  .filter((g) => !g.is_active)
                  .slice(0, 20)
                  .map((g) => (
                    <tr key={g.id} className="border-b border-border/50 opacity-60">
                      <td className="py-2 pr-4 text-txt-primary">{DISPLAY_NAME_MAP[g.agent_role] ?? g.agent_role}</td>
                      <td className="py-2 pr-4"><code className="rounded bg-prism-bg2 px-1 text-[12px]">{g.tool_name}</code></td>
                      <td className="py-2 pr-4 text-txt-muted">{DISPLAY_NAME_MAP[g.granted_by] ?? g.granted_by}</td>
                      <td className="py-2 pr-4 text-txt-muted text-[12px]">{g.reason ?? '—'}</td>
                      <td className="py-2 text-[12px] text-txt-muted">{timeAgo(g.updated_at)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ── Page ─────────────────────────────────── */

export default function Governance() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<GovernanceTab>('platform');
  const isAdmin = ADMIN_EMAILS.includes(user?.email?.toLowerCase() ?? '');

  const [iamState, setIamState] = useState<IAMState[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [secrets, setSecrets] = useState<SecretRotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [auditing, setAuditing] = useState(false);

  // Audit log filters
  const [filterPlatform, setFilterPlatform] = useState<string>('all');
  const [filterAgent, setFilterAgent] = useState<string>('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [iamData, auditData, secretsData] = await Promise.all([
        apiCall<IAMState[]>('/api/platform-iam-state'),
        apiCall<AuditEntry[]>('/api/platform-audit-log?limit=50'),
        apiCall<SecretRotation[]>('/api/platform-secret-rotation'),
      ]);
      setIamState(iamData ?? []);
      setAuditLog(auditData ?? []);
      setSecrets(secretsData ?? []);
    } catch {
      setIamState([]);
      setAuditLog([]);
      setSecrets([]);
    }
    setLoading(false);
  }, []);

  const runAudit = useCallback(async () => {
    setAuditing(true);
    try {
      const schedulerUrl = SCHEDULER_URL;
      await fetch(`${schedulerUrl}/sync/governance`, { method: 'POST' });
    } catch { /* ignore — reload will show latest */ }
    await loadData();
    setAuditing(false);
  }, [loadData]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="space-y-6">
        <SectionHeader title="Platform Governance" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48 w-full" />)}
      </div>
    );
  }

  // Group IAM state by platform
  const byPlatform = (p: Platform) => iamState.filter((s) => s.platform === p);
  const driftItems = iamState.filter((s) => !s.in_sync);
  const expiringSecrets = secrets.filter((s) => {
    if (!s.expires_at) return false;
    const days = daysUntil(s.expires_at);
    return days !== null && days <= 90;
  });

  // Filter audit log
  const filteredAudit = auditLog.filter((e) => {
    if (filterPlatform !== 'all' && e.platform !== filterPlatform) return false;
    if (filterAgent !== 'all' && e.agent_role !== filterAgent) return false;
    return true;
  });

  // Stats
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayAudit = auditLog.filter((e) => new Date(e.timestamp) >= todayStart);
  const failures = todayAudit.filter((e) => e.response_code && e.response_code >= 400);

  const uniqueAgents = [...new Set(auditLog.map((e) => e.agent_role))].sort();
  const uniquePlatforms = [...new Set(auditLog.map((e) => e.platform))].sort();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-prism-critical/15">
            <MdLock className="text-lg text-prism-critical" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-txt-primary">Governance</h1>
            <p className="text-[13px] text-txt-muted">
              Access control, tool grants, and platform audit trail
            </p>
          </div>
        </div>
        {activeTab === 'platform' && (
          <button
            onClick={runAudit}
            disabled={auditing}
            className="rounded-lg border border-prism-border bg-prism-card px-4 py-2 text-[13px] font-medium text-prism-primary shadow-prism transition-colors hover:bg-prism-bg2 disabled:opacity-50"
          >
            {auditing ? 'Auditing…' : 'Run Audit Now'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <PageTabs<GovernanceTab>
        tabs={[
          { key: 'platform', label: 'Platform IAM' },
          { key: 'admin', label: 'Admin & Access' },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {/* Tab Content */}
      {activeTab === 'admin' ? (
        <AdminAccessPanel isAdmin={isAdmin} />
      ) : (
      <>

      {/* IAM Summary Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <p className="text-[12px] font-medium text-txt-muted">Total Identities</p>
          <p className="mt-1 text-2xl font-bold text-txt-primary">{iamState.length}</p>
        </Card>
        <Card>
          <p className="text-[12px] font-medium text-txt-muted">Out-of-Sync</p>
          <p className="mt-1 text-2xl font-bold text-prism-critical">{driftItems.length}</p>
        </Card>
        <Card>
          <p className="text-[12px] font-medium text-txt-muted">Expiring Secrets</p>
          <p className="mt-1 text-2xl font-bold text-prism-elevated">{expiringSecrets.length}</p>
        </Card>
        <Card>
          <p className="text-[12px] font-medium text-txt-muted">Platforms</p>
          <p className="mt-1 text-2xl font-bold text-prism-teal">
            {new Set(iamState.map((s) => s.platform)).size}
          </p>
        </Card>
      </div>

      {/* Drift Alerts */}
      {(driftItems.length > 0 || expiringSecrets.length > 0) && (
        <Card className="border-prism-elevated/30">
          <SectionHeader
            title={`Drift Alerts — ${driftItems.length + expiringSecrets.length} issue${driftItems.length + expiringSecrets.length !== 1 ? 's' : ''} detected`}
          />
          <div className="space-y-3">
            {driftItems.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-lg border border-prism-elevated/30 bg-prism-elevated/5 p-3"
              >
                <MdWarning className="mt-0.5 text-prism-elevated" />
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-prism-primary">
                    <code className="rounded bg-prism-bg2 px-1 text-[12px]">{item.credential_id}</code>
                    {' '}has unexpected permissions
                  </p>
                  {item.drift_details && (
                    <p className="mt-1 text-[12px] text-txt-muted">{item.drift_details}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button className="rounded border border-prism-elevated/30 bg-prism-card px-2.5 py-1 text-[11px] font-medium text-prism-elevated transition-colors hover:bg-prism-elevated/10">
                    Details
                  </button>
                </div>
              </div>
            ))}
            {expiringSecrets.map((secret) => (
              <div
                key={secret.id}
                className="flex items-start gap-3 rounded-lg border border-prism-elevated/30 bg-prism-elevated/5 p-3"
              >
                <MdVpnKey className="mt-0.5 text-prism-elevated" />
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-prism-primary">
                    Secret <code className="rounded bg-prism-bg2 px-1 text-[12px]">{secret.secret_name}</code>
                    {' '}expires in {daysUntil(secret.expires_at)} days
                  </p>
                </div>
                <button className="rounded border border-prism-elevated/30 bg-prism-card px-2.5 py-1 text-[11px] font-medium text-prism-elevated transition-colors hover:bg-prism-elevated/10">
                  Rotate Now
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Platform Sections */}
      {(['gcp', 'm365', 'github', 'stripe', 'vercel'] as Platform[]).map((platform) => {
        const items = byPlatform(platform);
        // GitHub uses hardcoded scope data — always show it
        if (items.length === 0 && platform !== 'github') return null;
        return (
          <CollapsibleSection
            key={platform}
            title={PLATFORM_LABELS[platform]}
            color={PLATFORM_COLORS[platform]}
            defaultOpen={platform === 'gcp' || platform === 'm365' || platform === 'github'}
          >
            {platform === 'gcp' && <GCPTable items={items} />}
            {platform === 'm365' && <M365Table items={items} />}
            {platform === 'github' && <GitHubTable items={items} />}
            {platform === 'stripe' && <StripeTable items={items} />}
            {platform === 'vercel' && <VercelTable items={items} />}
          </CollapsibleSection>
        );
      })}

      {/* Audit Log */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <SectionHeader title="Audit Log" />
          <div className="flex items-center gap-2">
            <select
              value={filterPlatform}
              onChange={(e) => setFilterPlatform(e.target.value)}
              className="rounded border border-border bg-surface px-2 py-1 text-[12px] text-txt-primary"
            >
              <option value="all">All platforms</option>
              {uniquePlatforms.map((p) => (
                <option key={p} value={p}>{p.toUpperCase()}</option>
              ))}
            </select>
            <select
              value={filterAgent}
              onChange={(e) => setFilterAgent(e.target.value)}
              className="rounded border border-border bg-surface px-2 py-1 text-[12px] text-txt-primary"
            >
              <option value="all">All agents</option>
              {uniqueAgents.map((a) => (
                <option key={a} value={a}>{DISPLAY_NAME_MAP[a] ?? a}</option>
              ))}
            </select>
          </div>
        </div>

        {filteredAudit.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-txt-muted">No audit entries yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-txt-muted">
                  <th className="pb-2 pr-4 font-medium">Time</th>
                  <th className="pb-2 pr-4 font-medium">Agent</th>
                  <th className="pb-2 pr-4 font-medium">Platform</th>
                  <th className="pb-2 pr-4 font-medium">Action</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAudit.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/50">
                    <td className="py-2 pr-4 text-txt-muted text-[12px]">{timeAgo(entry.timestamp)}</td>
                    <td className="py-2 pr-4 text-txt-primary">
                      {DISPLAY_NAME_MAP[entry.agent_role] ?? entry.agent_role}
                    </td>
                    <td className="py-2 pr-4">
                      <span className="rounded bg-prism-bg2 px-1.5 py-0.5 text-[11px] font-medium text-prism-secondary">
                        {entry.platform.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-txt-muted">{entry.action}</td>
                    <td className="py-2">
                      {entry.response_code ? (
                        entry.response_code < 400 ? (
                          <span className="text-prism-teal inline-flex items-center gap-1">{entry.response_code} <MdCheck className="text-[14px]" /></span>
                        ) : (
                          <span className="text-prism-critical inline-flex items-center gap-1">{entry.response_code} <MdClose className="text-[14px]" /></span>
                        )
                      ) : (
                        <span className="text-txt-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Stats bar */}
        <div className="mt-4 flex items-center gap-4 border-t border-border pt-3 text-[12px] text-txt-muted">
          <span><MdBarChart className="inline-block text-[14px] mr-1" />{todayAudit.length} calls today</span>
          <span>|</span>
          <span>{failures.length} failure{failures.length !== 1 ? 's' : ''}</span>
          <span>|</span>
          <span>0 security events</span>
        </div>
      </Card>

      {/* Secret Rotation Status */}
      <Card>
        <SectionHeader title="Secret Rotation Status" />
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-txt-muted">
                <th className="pb-2 pr-4 font-medium">Secret</th>
                <th className="pb-2 pr-4 font-medium">Platform</th>
                <th className="pb-2 pr-4 font-medium">Created</th>
                <th className="pb-2 pr-4 font-medium">Expires</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {secrets.map((secret) => (
                <tr key={secret.id} className="border-b border-border/50">
                  <td className="py-2.5 pr-4">
                    <code className="rounded bg-prism-bg2 px-1.5 py-0.5 text-[12px]">
                      {secret.secret_name}
                    </code>
                  </td>
                  <td className="py-2.5 pr-4 text-txt-muted">{secret.platform.toUpperCase()}</td>
                  <td className="py-2.5 pr-4 text-txt-muted text-[12px]">
                    {new Date(secret.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2.5 pr-4 text-txt-muted text-[12px]">
                    {secret.expires_at ? new Date(secret.expires_at).toLocaleDateString() : 'never'}
                  </td>
                  <td className="py-2.5">
                    <ExpiryBadge expiresAt={secret.expires_at} status={secret.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      </>
      )}
    </div>
  );
}

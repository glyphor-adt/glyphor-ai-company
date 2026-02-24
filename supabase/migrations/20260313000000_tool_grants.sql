-- ═══════════════════════════════════════════════════════════════════
-- DB-Driven Tool Grants — Dynamic tool access for agents
-- ═══════════════════════════════════════════════════════════════════
-- Lets Sarah (Chief of Staff) temporarily grant EXISTING tools to
-- agents without a code deploy. Supplements the static tool arrays
-- defined in each agent's tools.ts.

CREATE TABLE IF NOT EXISTS agent_tool_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  granted_by TEXT NOT NULL,                  -- 'system', 'kristina', 'andrew', 'chief-of-staff', 'cto'
  reason TEXT,                                -- why the grant was made
  directive_id UUID REFERENCES founder_directives(id),  -- optional: scoped to a directive
  scope TEXT DEFAULT 'full',                  -- 'full', 'read_only'
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ,                     -- auto-revoke after this time (for temp grants)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_role, tool_name)
);

-- Active grants by role (hot path for tool authorization)
CREATE INDEX idx_tool_grants_role ON agent_tool_grants(agent_role) WHERE is_active = true;

-- Grants scoped to a directive
CREATE INDEX idx_tool_grants_directive ON agent_tool_grants(directive_id);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION update_tool_grants_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tool_grants_updated_at
  BEFORE UPDATE ON agent_tool_grants
  FOR EACH ROW
  EXECUTE FUNCTION update_tool_grants_updated_at();

-- RLS: service_role full access (matches existing pattern)
ALTER TABLE agent_tool_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on agent_tool_grants"
  ON agent_tool_grants
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════
-- SEED: Existing hardcoded tool grants migrated to DB
-- These are the tools each agent gets via their tools.ts + shared tools.
-- granted_by = 'system' means these are the baseline static grants.
-- ═══════════════════════════════════════════════════════════════════

-- CTO (Marcus) tools
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('cto', 'get_platform_health', 'system'),
  ('cto', 'get_cloud_run_metrics', 'system'),
  ('cto', 'get_infrastructure_costs', 'system'),
  ('cto', 'get_recent_activity', 'system'),
  ('cto', 'read_company_memory', 'system'),
  ('cto', 'write_health_report', 'system'),
  ('cto', 'log_activity', 'system'),
  ('cto', 'get_github_pr_status', 'system'),
  ('cto', 'get_ci_health', 'system'),
  ('cto', 'get_repo_stats', 'system'),
  ('cto', 'create_github_issue', 'system'),
  ('cto', 'create_decision', 'system'),
  ('cto', 'get_file_contents', 'system'),
  ('cto', 'create_or_update_file', 'system'),
  ('cto', 'create_branch', 'system'),
  ('cto', 'create_github_pr', 'system'),
  ('cto', 'merge_github_pr', 'system'),
  -- Shared tools
  ('cto', 'save_memory', 'system'),
  ('cto', 'recall_memories', 'system'),
  ('cto', 'read_my_assignments', 'system'),
  ('cto', 'submit_assignment_output', 'system'),
  ('cto', 'flag_assignment_blocker', 'system'),
  ('cto', 'send_agent_message', 'system'),
  ('cto', 'check_messages', 'system'),
  ('cto', 'call_meeting', 'system'),
  ('cto', 'emit_insight', 'system'),
  ('cto', 'emit_alert', 'system'),
  ('cto', 'trace_causes', 'system'),
  ('cto', 'trace_impact', 'system'),
  ('cto', 'query_knowledge_graph', 'system'),
  ('cto', 'add_knowledge', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Chief of Staff (Sarah) tools
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('chief-of-staff', 'get_recent_activity', 'system'),
  ('chief-of-staff', 'get_pending_decisions', 'system'),
  ('chief-of-staff', 'get_product_metrics', 'system'),
  ('chief-of-staff', 'get_financials', 'system'),
  ('chief-of-staff', 'read_company_memory', 'system'),
  ('chief-of-staff', 'send_briefing', 'system'),
  ('chief-of-staff', 'create_decision', 'system'),
  ('chief-of-staff', 'log_activity', 'system'),
  ('chief-of-staff', 'check_escalations', 'system'),
  ('chief-of-staff', 'send_dm', 'system'),
  ('chief-of-staff', 'send_email', 'system'),
  ('chief-of-staff', 'create_calendar_event', 'system'),
  ('chief-of-staff', 'read_founder_directives', 'system'),
  ('chief-of-staff', 'create_work_assignments', 'system'),
  ('chief-of-staff', 'dispatch_assignment', 'system'),
  ('chief-of-staff', 'check_assignment_status', 'system'),
  ('chief-of-staff', 'evaluate_assignment', 'system'),
  ('chief-of-staff', 'update_directive_progress', 'system'),
  ('chief-of-staff', 'grant_tool_access', 'system'),
  ('chief-of-staff', 'revoke_tool_access', 'system'),
  -- Shared tools
  ('chief-of-staff', 'save_memory', 'system'),
  ('chief-of-staff', 'recall_memories', 'system'),
  ('chief-of-staff', 'read_my_assignments', 'system'),
  ('chief-of-staff', 'submit_assignment_output', 'system'),
  ('chief-of-staff', 'flag_assignment_blocker', 'system'),
  ('chief-of-staff', 'send_agent_message', 'system'),
  ('chief-of-staff', 'check_messages', 'system'),
  ('chief-of-staff', 'call_meeting', 'system'),
  ('chief-of-staff', 'get_company_pulse', 'system'),
  ('chief-of-staff', 'update_company_pulse', 'system'),
  ('chief-of-staff', 'update_pulse_highlights', 'system'),
  ('chief-of-staff', 'promote_to_org_knowledge', 'system'),
  ('chief-of-staff', 'get_org_knowledge', 'system'),
  ('chief-of-staff', 'create_knowledge_route', 'system'),
  ('chief-of-staff', 'get_knowledge_routes', 'system'),
  ('chief-of-staff', 'detect_contradictions', 'system'),
  ('chief-of-staff', 'record_process_pattern', 'system'),
  ('chief-of-staff', 'get_process_patterns', 'system'),
  ('chief-of-staff', 'propose_authority_change', 'system'),
  ('chief-of-staff', 'get_authority_proposals', 'system'),
  ('chief-of-staff', 'trace_causes', 'system'),
  ('chief-of-staff', 'trace_impact', 'system'),
  ('chief-of-staff', 'query_knowledge_graph', 'system'),
  ('chief-of-staff', 'add_knowledge', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- CFO (Nadia) tools
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('cfo', 'get_financials', 'system'),
  ('cfo', 'get_product_metrics', 'system'),
  ('cfo', 'get_recent_activity', 'system'),
  ('cfo', 'read_company_memory', 'system'),
  ('cfo', 'calculate_unit_economics', 'system'),
  ('cfo', 'write_financial_report', 'system'),
  ('cfo', 'log_activity', 'system'),
  ('cfo', 'query_stripe_mrr', 'system'),
  ('cfo', 'query_stripe_subscriptions', 'system'),
  ('cfo', 'create_decision', 'system'),
  ('cfo', 'save_memory', 'system'),
  ('cfo', 'recall_memories', 'system'),
  ('cfo', 'read_my_assignments', 'system'),
  ('cfo', 'submit_assignment_output', 'system'),
  ('cfo', 'flag_assignment_blocker', 'system'),
  ('cfo', 'send_agent_message', 'system'),
  ('cfo', 'check_messages', 'system'),
  ('cfo', 'call_meeting', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- CPO (Elena) tools
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('cpo', 'get_product_metrics', 'system'),
  ('cpo', 'get_recent_activity', 'system'),
  ('cpo', 'read_company_memory', 'system'),
  ('cpo', 'get_financials', 'system'),
  ('cpo', 'write_product_analysis', 'system'),
  ('cpo', 'log_activity', 'system'),
  ('cpo', 'create_decision', 'system'),
  ('cpo', 'save_memory', 'system'),
  ('cpo', 'recall_memories', 'system'),
  ('cpo', 'read_my_assignments', 'system'),
  ('cpo', 'submit_assignment_output', 'system'),
  ('cpo', 'flag_assignment_blocker', 'system'),
  ('cpo', 'send_agent_message', 'system'),
  ('cpo', 'check_messages', 'system'),
  ('cpo', 'call_meeting', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- CMO (Maya) tools
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('cmo', 'get_product_metrics', 'system'),
  ('cmo', 'get_recent_activity', 'system'),
  ('cmo', 'read_company_memory', 'system'),
  ('cmo', 'write_content', 'system'),
  ('cmo', 'write_company_memory', 'system'),
  ('cmo', 'log_activity', 'system'),
  ('cmo', 'create_decision', 'system'),
  ('cmo', 'save_memory', 'system'),
  ('cmo', 'recall_memories', 'system'),
  ('cmo', 'read_my_assignments', 'system'),
  ('cmo', 'submit_assignment_output', 'system'),
  ('cmo', 'flag_assignment_blocker', 'system'),
  ('cmo', 'send_agent_message', 'system'),
  ('cmo', 'check_messages', 'system'),
  ('cmo', 'call_meeting', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- VP Customer Success (James) tools
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('vp-customer-success', 'get_product_metrics', 'system'),
  ('vp-customer-success', 'get_recent_activity', 'system'),
  ('vp-customer-success', 'read_company_memory', 'system'),
  ('vp-customer-success', 'get_financials', 'system'),
  ('vp-customer-success', 'write_health_report', 'system'),
  ('vp-customer-success', 'write_company_memory', 'system'),
  ('vp-customer-success', 'log_activity', 'system'),
  ('vp-customer-success', 'create_decision', 'system'),
  ('vp-customer-success', 'save_memory', 'system'),
  ('vp-customer-success', 'recall_memories', 'system'),
  ('vp-customer-success', 'read_my_assignments', 'system'),
  ('vp-customer-success', 'submit_assignment_output', 'system'),
  ('vp-customer-success', 'flag_assignment_blocker', 'system'),
  ('vp-customer-success', 'send_agent_message', 'system'),
  ('vp-customer-success', 'check_messages', 'system'),
  ('vp-customer-success', 'call_meeting', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- VP Sales (Rachel) tools
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('vp-sales', 'get_product_metrics', 'system'),
  ('vp-sales', 'get_financials', 'system'),
  ('vp-sales', 'get_recent_activity', 'system'),
  ('vp-sales', 'read_company_memory', 'system'),
  ('vp-sales', 'write_pipeline_report', 'system'),
  ('vp-sales', 'write_company_memory', 'system'),
  ('vp-sales', 'log_activity', 'system'),
  ('vp-sales', 'create_decision', 'system'),
  ('vp-sales', 'save_memory', 'system'),
  ('vp-sales', 'recall_memories', 'system'),
  ('vp-sales', 'read_my_assignments', 'system'),
  ('vp-sales', 'submit_assignment_output', 'system'),
  ('vp-sales', 'flag_assignment_blocker', 'system'),
  ('vp-sales', 'send_agent_message', 'system'),
  ('vp-sales', 'check_messages', 'system'),
  ('vp-sales', 'call_meeting', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- VP Design (Mia) tools
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('vp-design', 'run_lighthouse', 'system'),
  ('vp-design', 'run_lighthouse_batch', 'system'),
  ('vp-design', 'get_design_quality_summary', 'system'),
  ('vp-design', 'get_design_tokens', 'system'),
  ('vp-design', 'get_component_library', 'system'),
  ('vp-design', 'get_template_registry', 'system'),
  ('vp-design', 'write_design_audit', 'system'),
  ('vp-design', 'get_recent_activity', 'system'),
  ('vp-design', 'read_company_memory', 'system'),
  ('vp-design', 'log_activity', 'system'),
  ('vp-design', 'create_decision', 'system'),
  ('vp-design', 'save_memory', 'system'),
  ('vp-design', 'recall_memories', 'system'),
  ('vp-design', 'read_my_assignments', 'system'),
  ('vp-design', 'submit_assignment_output', 'system'),
  ('vp-design', 'flag_assignment_blocker', 'system'),
  ('vp-design', 'send_agent_message', 'system'),
  ('vp-design', 'check_messages', 'system'),
  ('vp-design', 'call_meeting', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Ops (Atlas) tools
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('ops', 'query_agent_runs', 'system'),
  ('ops', 'query_agent_health', 'system'),
  ('ops', 'query_data_sync_status', 'system'),
  ('ops', 'query_events_backlog', 'system'),
  ('ops', 'query_cost_trends', 'system'),
  ('ops', 'trigger_agent_run', 'system'),
  ('ops', 'retry_failed_run', 'system'),
  ('ops', 'retry_data_sync', 'system'),
  ('ops', 'pause_agent', 'system'),
  ('ops', 'resume_agent', 'system'),
  ('ops', 'create_incident', 'system'),
  ('ops', 'resolve_incident', 'system'),
  ('ops', 'post_system_status', 'system'),
  ('ops', 'rollup_agent_performance', 'system'),
  ('ops', 'detect_milestones', 'system'),
  ('ops', 'update_growth_areas', 'system'),
  ('ops', 'send_dm', 'system'),
  ('ops', 'save_memory', 'system'),
  ('ops', 'recall_memories', 'system'),
  ('ops', 'read_my_assignments', 'system'),
  ('ops', 'submit_assignment_output', 'system'),
  ('ops', 'flag_assignment_blocker', 'system'),
  ('ops', 'send_agent_message', 'system'),
  ('ops', 'check_messages', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Sub-team: platform-engineer (Alex)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('platform-engineer', 'query_cloud_run_metrics', 'system'),
  ('platform-engineer', 'run_health_check', 'system'),
  ('platform-engineer', 'query_gemini_latency', 'system'),
  ('platform-engineer', 'query_supabase_health', 'system'),
  ('platform-engineer', 'query_uptime', 'system'),
  ('platform-engineer', 'get_repo_code_health', 'system'),
  ('platform-engineer', 'log_activity', 'system'),
  ('platform-engineer', 'save_memory', 'system'),
  ('platform-engineer', 'recall_memories', 'system'),
  ('platform-engineer', 'read_my_assignments', 'system'),
  ('platform-engineer', 'submit_assignment_output', 'system'),
  ('platform-engineer', 'flag_assignment_blocker', 'system'),
  ('platform-engineer', 'send_agent_message', 'system'),
  ('platform-engineer', 'check_messages', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Sub-team: quality-engineer (Sam)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('quality-engineer', 'query_build_logs', 'system'),
  ('quality-engineer', 'query_error_patterns', 'system'),
  ('quality-engineer', 'create_bug_report', 'system'),
  ('quality-engineer', 'query_test_results', 'system'),
  ('quality-engineer', 'log_activity', 'system'),
  ('quality-engineer', 'save_memory', 'system'),
  ('quality-engineer', 'recall_memories', 'system'),
  ('quality-engineer', 'read_my_assignments', 'system'),
  ('quality-engineer', 'submit_assignment_output', 'system'),
  ('quality-engineer', 'flag_assignment_blocker', 'system'),
  ('quality-engineer', 'send_agent_message', 'system'),
  ('quality-engineer', 'check_messages', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Sub-team: devops-engineer (Jordan)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('devops-engineer', 'query_cache_metrics', 'system'),
  ('devops-engineer', 'query_pipeline_metrics', 'system'),
  ('devops-engineer', 'query_resource_utilization', 'system'),
  ('devops-engineer', 'query_cold_starts', 'system'),
  ('devops-engineer', 'identify_unused_resources', 'system'),
  ('devops-engineer', 'calculate_cost_savings', 'system'),
  ('devops-engineer', 'log_activity', 'system'),
  ('devops-engineer', 'get_pipeline_runs', 'system'),
  ('devops-engineer', 'get_recent_commits', 'system'),
  ('devops-engineer', 'comment_on_pr', 'system'),
  ('devops-engineer', 'save_memory', 'system'),
  ('devops-engineer', 'recall_memories', 'system'),
  ('devops-engineer', 'read_my_assignments', 'system'),
  ('devops-engineer', 'submit_assignment_output', 'system'),
  ('devops-engineer', 'flag_assignment_blocker', 'system'),
  ('devops-engineer', 'send_agent_message', 'system'),
  ('devops-engineer', 'check_messages', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Sub-team: user-researcher (Priya)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('user-researcher', 'query_user_analytics', 'system'),
  ('user-researcher', 'query_build_metadata', 'system'),
  ('user-researcher', 'query_onboarding_funnel', 'system'),
  ('user-researcher', 'run_cohort_analysis', 'system'),
  ('user-researcher', 'query_churn_data', 'system'),
  ('user-researcher', 'design_experiment', 'system'),
  ('user-researcher', 'log_activity', 'system'),
  ('user-researcher', 'save_memory', 'system'),
  ('user-researcher', 'recall_memories', 'system'),
  ('user-researcher', 'read_my_assignments', 'system'),
  ('user-researcher', 'submit_assignment_output', 'system'),
  ('user-researcher', 'flag_assignment_blocker', 'system'),
  ('user-researcher', 'send_agent_message', 'system'),
  ('user-researcher', 'check_messages', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Sub-team: competitive-intel (Daniel)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('competitive-intel', 'fetch_github_releases', 'system'),
  ('competitive-intel', 'search_hacker_news', 'system'),
  ('competitive-intel', 'search_product_hunt', 'system'),
  ('competitive-intel', 'fetch_pricing_pages', 'system'),
  ('competitive-intel', 'query_competitor_tech_stack', 'system'),
  ('competitive-intel', 'check_job_postings', 'system'),
  ('competitive-intel', 'store_intel', 'system'),
  ('competitive-intel', 'log_activity', 'system'),
  ('competitive-intel', 'save_memory', 'system'),
  ('competitive-intel', 'recall_memories', 'system'),
  ('competitive-intel', 'read_my_assignments', 'system'),
  ('competitive-intel', 'submit_assignment_output', 'system'),
  ('competitive-intel', 'flag_assignment_blocker', 'system'),
  ('competitive-intel', 'send_agent_message', 'system'),
  ('competitive-intel', 'check_messages', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Sub-team: revenue-analyst (Anna)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('revenue-analyst', 'query_stripe_revenue', 'system'),
  ('revenue-analyst', 'query_revenue_by_product', 'system'),
  ('revenue-analyst', 'query_revenue_by_cohort', 'system'),
  ('revenue-analyst', 'query_attribution', 'system'),
  ('revenue-analyst', 'calculate_ltv_cac', 'system'),
  ('revenue-analyst', 'forecast_revenue', 'system'),
  ('revenue-analyst', 'query_churn_revenue', 'system'),
  ('revenue-analyst', 'log_activity', 'system'),
  ('revenue-analyst', 'save_memory', 'system'),
  ('revenue-analyst', 'recall_memories', 'system'),
  ('revenue-analyst', 'read_my_assignments', 'system'),
  ('revenue-analyst', 'submit_assignment_output', 'system'),
  ('revenue-analyst', 'flag_assignment_blocker', 'system'),
  ('revenue-analyst', 'send_agent_message', 'system'),
  ('revenue-analyst', 'check_messages', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Sub-team: cost-analyst (Omar)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('cost-analyst', 'query_gcp_billing', 'system'),
  ('cost-analyst', 'query_supabase_usage', 'system'),
  ('cost-analyst', 'query_gemini_cost', 'system'),
  ('cost-analyst', 'query_agent_run_costs', 'system'),
  ('cost-analyst', 'query_resource_utilization', 'system'),
  ('cost-analyst', 'identify_waste', 'system'),
  ('cost-analyst', 'calculate_unit_cost', 'system'),
  ('cost-analyst', 'project_costs', 'system'),
  ('cost-analyst', 'log_activity', 'system'),
  ('cost-analyst', 'save_memory', 'system'),
  ('cost-analyst', 'recall_memories', 'system'),
  ('cost-analyst', 'read_my_assignments', 'system'),
  ('cost-analyst', 'submit_assignment_output', 'system'),
  ('cost-analyst', 'flag_assignment_blocker', 'system'),
  ('cost-analyst', 'send_agent_message', 'system'),
  ('cost-analyst', 'check_messages', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Sub-team: content-creator (Tyler)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('content-creator', 'draft_blog_post', 'system'),
  ('content-creator', 'draft_social_post', 'system'),
  ('content-creator', 'draft_case_study', 'system'),
  ('content-creator', 'draft_email', 'system'),
  ('content-creator', 'query_content_performance', 'system'),
  ('content-creator', 'query_top_performing_content', 'system'),
  ('content-creator', 'log_activity', 'system'),
  ('content-creator', 'save_memory', 'system'),
  ('content-creator', 'recall_memories', 'system'),
  ('content-creator', 'read_my_assignments', 'system'),
  ('content-creator', 'submit_assignment_output', 'system'),
  ('content-creator', 'flag_assignment_blocker', 'system'),
  ('content-creator', 'send_agent_message', 'system'),
  ('content-creator', 'check_messages', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Sub-team: seo-analyst (Lisa)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('seo-analyst', 'query_seo_rankings', 'system'),
  ('seo-analyst', 'query_keyword_data', 'system'),
  ('seo-analyst', 'discover_keywords', 'system'),
  ('seo-analyst', 'query_competitor_rankings', 'system'),
  ('seo-analyst', 'query_backlinks', 'system'),
  ('seo-analyst', 'query_search_console', 'system'),
  ('seo-analyst', 'analyze_content_seo', 'system'),
  ('seo-analyst', 'log_activity', 'system'),
  ('seo-analyst', 'save_memory', 'system'),
  ('seo-analyst', 'recall_memories', 'system'),
  ('seo-analyst', 'read_my_assignments', 'system'),
  ('seo-analyst', 'submit_assignment_output', 'system'),
  ('seo-analyst', 'flag_assignment_blocker', 'system'),
  ('seo-analyst', 'send_agent_message', 'system'),
  ('seo-analyst', 'check_messages', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Sub-team: social-media-manager (Kai)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('social-media-manager', 'schedule_social_post', 'system'),
  ('social-media-manager', 'query_social_metrics', 'system'),
  ('social-media-manager', 'query_post_performance', 'system'),
  ('social-media-manager', 'query_optimal_times', 'system'),
  ('social-media-manager', 'query_audience_demographics', 'system'),
  ('social-media-manager', 'monitor_mentions', 'system'),
  ('social-media-manager', 'log_activity', 'system'),
  ('social-media-manager', 'save_memory', 'system'),
  ('social-media-manager', 'recall_memories', 'system'),
  ('social-media-manager', 'read_my_assignments', 'system'),
  ('social-media-manager', 'submit_assignment_output', 'system'),
  ('social-media-manager', 'flag_assignment_blocker', 'system'),
  ('social-media-manager', 'send_agent_message', 'system'),
  ('social-media-manager', 'check_messages', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Sub-team: onboarding-specialist (Emma)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('onboarding-specialist', 'query_onboarding_funnel', 'system'),
  ('onboarding-specialist', 'query_first_build_metrics', 'system'),
  ('onboarding-specialist', 'query_drop_off_points', 'system'),
  ('onboarding-specialist', 'query_welcome_email_metrics', 'system'),
  ('onboarding-specialist', 'query_activation_rate', 'system'),
  ('onboarding-specialist', 'query_template_usage', 'system'),
  ('onboarding-specialist', 'design_onboarding_experiment', 'system'),
  ('onboarding-specialist', 'log_activity', 'system'),
  ('onboarding-specialist', 'save_memory', 'system'),
  ('onboarding-specialist', 'recall_memories', 'system'),
  ('onboarding-specialist', 'read_my_assignments', 'system'),
  ('onboarding-specialist', 'submit_assignment_output', 'system'),
  ('onboarding-specialist', 'flag_assignment_blocker', 'system'),
  ('onboarding-specialist', 'send_agent_message', 'system'),
  ('onboarding-specialist', 'check_messages', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Sub-team: support-triage (David)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('support-triage', 'query_support_tickets', 'system'),
  ('support-triage', 'classify_ticket', 'system'),
  ('support-triage', 'respond_to_ticket', 'system'),
  ('support-triage', 'escalate_ticket', 'system'),
  ('support-triage', 'query_knowledge_base', 'system'),
  ('support-triage', 'batch_similar_tickets', 'system'),
  ('support-triage', 'log_activity', 'system'),
  ('support-triage', 'save_memory', 'system'),
  ('support-triage', 'recall_memories', 'system'),
  ('support-triage', 'read_my_assignments', 'system'),
  ('support-triage', 'submit_assignment_output', 'system'),
  ('support-triage', 'flag_assignment_blocker', 'system'),
  ('support-triage', 'send_agent_message', 'system'),
  ('support-triage', 'check_messages', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Sub-team: account-research (Nathan)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('account-research', 'search_company_info', 'system'),
  ('account-research', 'search_crunchbase', 'system'),
  ('account-research', 'analyze_tech_stack', 'system'),
  ('account-research', 'search_linkedin_profiles', 'system'),
  ('account-research', 'search_job_postings', 'system'),
  ('account-research', 'estimate_dev_spend', 'system'),
  ('account-research', 'compile_dossier', 'system'),
  ('account-research', 'log_activity', 'system'),
  ('account-research', 'save_memory', 'system'),
  ('account-research', 'recall_memories', 'system'),
  ('account-research', 'read_my_assignments', 'system'),
  ('account-research', 'submit_assignment_output', 'system'),
  ('account-research', 'flag_assignment_blocker', 'system'),
  ('account-research', 'send_agent_message', 'system'),
  ('account-research', 'check_messages', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Sub-team: m365-admin (Riley)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('m365-admin', 'list_users', 'system'),
  ('m365-admin', 'get_user', 'system'),
  ('m365-admin', 'list_channels', 'system'),
  ('m365-admin', 'list_channel_members', 'system'),
  ('m365-admin', 'add_channel_member', 'system'),
  ('m365-admin', 'create_channel', 'system'),
  ('m365-admin', 'post_to_channel', 'system'),
  ('m365-admin', 'send_email', 'system'),
  ('m365-admin', 'create_calendar_event', 'system'),
  ('m365-admin', 'list_calendar_events', 'system'),
  ('m365-admin', 'write_admin_log', 'system'),
  ('m365-admin', 'create_decision', 'system'),
  ('m365-admin', 'save_memory', 'system'),
  ('m365-admin', 'recall_memories', 'system'),
  ('m365-admin', 'read_my_assignments', 'system'),
  ('m365-admin', 'submit_assignment_output', 'system'),
  ('m365-admin', 'flag_assignment_blocker', 'system'),
  ('m365-admin', 'send_agent_message', 'system'),
  ('m365-admin', 'check_messages', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

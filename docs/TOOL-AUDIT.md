# Glyphor Platform — Tool Audit

> **Generated:** 2026-04-18 · **Total static tools:** 642 · **MCP servers:** 15 · **LLM-native tools:** 6 · **Agent roles:** 31

---

## Table of Contents

1. [Summary](#summary)
2. [LLM-Native / Provider Tools](#llm-native--provider-tools)
3. [MCP Server Tools](#mcp-server-tools)
4. [Core Pinned Tools (All Agents)](#core-pinned-tools-all-agents)
5. [Custom Platform Tools by Domain](#custom-platform-tools-by-domain)
6. [Agent Role → Tool Mapping](#agent-role--tool-mapping)
7. [Tool Selection Pipeline](#tool-selection-pipeline)
8. [Shared Tool Factory Files](#shared-tool-factory-files)

---

## Summary

| Category | Count | Type |
|----------|-------|------|
| LLM-native (provider-built) | 6 | Built into model API |
| Custom platform tools (static `KNOWN_TOOLS`) | 642 | Function-call definitions |
| Dynamic tools (DB `tool_registry`) | Variable | Runtime-registered |
| Glyphor MCP servers | 9 servers (~62 tools) | JSON-RPC microservices |
| Microsoft 365 MCP servers | 6 servers | Agent 365 bridge |
| Shared tool factory files | 75+ | `packages/agents/src/shared/` |
| Per-agent tool files | 27 | `packages/agents/src/*/tools.ts` |

---

## LLM-Native / Provider Tools

These are built into the model provider API — not custom function definitions. Enabled conditionally by the routing engine.

| # | Tool | Provider | Enable Flag | When Activated | Implementation |
|---|------|----------|-------------|----------------|----------------|
| 1 | `google_search` (grounding) | Gemini | `enableGoogleSearch` | `web_research` capability routes | `gemini.ts` — `{ googleSearch: {} }` pushed to tools array. **Cannot mix with functionDeclarations** (Gemini rejects mixed types). |
| 2 | `code_execution` | Gemini | `enableCodeExecution` | `financial_computation` routes | `gemini.ts` — `{ codeExecution: {} }`. Same no-mix constraint. |
| 3 | `web_search_preview` | OpenAI | `enableWebSearch` | `web_research` routes, `*-deep-research` models | `openai.ts` — `{ type: 'web_search_preview' }` in Responses API tools |
| 4 | `tool_search` | OpenAI | `USE_TOOL_SEARCH_OPENAI=true` + model ≥ gpt-5.4 | Code gen with `many_tools` capability | `openai.ts` — `{ type: 'tool_search' }`, all tools wrapped with namespaces |
| 5 | `tool_search_bm25` | Anthropic | `USE_TOOL_SEARCH_ANTHROPIC=true` + Sonnet 4+ / Opus 4+ | All qualifying Anthropic calls | `anthropicToolBuilder.ts` — `{ type: 'tool_search_tool_bm25_20251119' }`. Non-pinned tools get `defer_loading: true`. |
| 6 | `apply_patch_call` (V4A diff) | OpenAI | `enableApplyPatch` | Code gen with `needs_apply_patch` capability | `openai.ts` — function declaration with `repo`, `branch`, `commit_message`, `patch` params |

---

## MCP Server Tools

### Glyphor Custom MCP Servers

Gate: `GLYPHOR_MCP_ENABLED=true`

Tools are **dynamically discovered** at runtime via JSON-RPC `tools/list` call per server. Each server is a Cloud Run microservice with GCP identity token auth.

| # | Server | Env Var | Domain | Known Tools |
|---|--------|---------|--------|-------------|
| 1 | `mcp_GlyphorData` | `GLYPHOR_MCP_DATA_URL` | Cross-domain | `query_content_drafts`, `query_content_metrics`, `query_seo_data`, `query_scheduled_posts`, `query_analytics_events` |
| 2 | `mcp_GlyphorMarketing` | `GLYPHOR_MCP_MARKETING_URL` | Marketing | `query_content_drafts`, `query_content_metrics`, `query_seo_data`, `query_scheduled_posts`, `query_social_metrics`, `query_email_metrics`, `query_experiment_designs` |
| 3 | `mcp_GlyphorEngineering` | `GLYPHOR_MCP_ENGINEERING_URL` | Engineering | `query_infrastructure_metrics`, `query_incidents`, `query_agent_runs`, `query_data_sync_status`, `query_analytics_events` |
| 4 | `mcp_GlyphorDesign` | `GLYPHOR_MCP_DESIGN_URL` | Design | `query_design_reviews`, `query_design_assets`, `query_failed_reviews`, `query_figma_assets`, `query_review_scores` |
| 5 | `mcp_GlyphorFinance` | `GLYPHOR_MCP_FINANCE_URL` | Finance | `query_stripe_data`, `query_gcp_billing`, `query_cost_metrics`, `query_api_billing`, `query_infrastructure_costs`, `query_financials`, `query_company_vitals` |
| 6 | `mcp_GlyphorLegal` | `GLYPHOR_MCP_LEGAL_URL` | Legal | `track_regulations`, `get_compliance_status`, `get_contracts`, `get_contract_renewals`, `get_ip_portfolio`, `monitor_ip_infringement`, `get_tax_calendar`, `calculate_tax_estimate`, `audit_data_flows`, `check_data_retention`, `get_privacy_requests`, `audit_access_permissions`, `update_compliance_item`, `create_compliance_alert`, `create_contract_review`, `flag_contract_issue`, `create_ip_filing`, `get_tax_research`, `review_tax_strategy` |
| 7 | `mcp_GlyphorHR` | `GLYPHOR_MCP_HR_URL` | HR | `get_org_chart`, `get_agent_directory`, `get_agent_performance_summary`, `create_performance_review`, `get_team_dynamics`, `update_agent_profile`, `create_onboarding_plan`, `run_engagement_survey` |
| 8 | `mcp_GlyphorEmailMarketing` | `GLYPHOR_MCP_EMAIL_MARKETING_URL` | Marketing | Mailchimp/Mandrill tools |
| 9 | `mcp_Codex` | `GLYPHOR_MCP_CODEX_URL` | Engineering | Codex coding tools |

#### Glyphor MCP — Role Allowlist

| Role | Allowed Servers |
|------|----------------|
| `chief-of-staff` | `mcp_GlyphorData` |
| `cto` | `mcp_GlyphorEngineering`, `mcp_GlyphorData` |
| `cfo` | `mcp_GlyphorFinance`, `mcp_GlyphorData` |
| `cpo` | `mcp_GlyphorData` |
| `cmo` | `mcp_GlyphorMarketing`, `mcp_GlyphorData` |
| `vp-design` | `mcp_GlyphorDesign`, `mcp_GlyphorData` |
| `ops` | `mcp_GlyphorData` |
| `vp-research` | `mcp_GlyphorData` |
| *(all others)* | *(no default access)* |

### Microsoft 365 MCP Servers (Agent 365)

Gate: `AGENT365_ENABLED=true` + `AGENT365_CLIENT_ID` + `AGENT365_TENANT_ID`

Tools dynamically discovered via Agent 365 bridge. Plus custom `reply_email_with_attachments` for agents with a mailbox.

| # | Server | Purpose |
|---|--------|---------|
| 1 | `mcp_MailTools` | Email send/reply/read/forward/move |
| 2 | `mcp_CalendarTools` | Calendar event CRUD |
| 3 | `mcp_ODSPRemoteServer` | SharePoint / OneDrive |
| 4 | `mcp_TeamsServer` | Teams messaging & channels |
| 5 | `mcp_M365Copilot` | M365 Copilot integration |
| 6 | `mcp_WordServer` | Word document operations |

#### Agent 365 — Role Allowlist

| Role | Explicit Servers | Default (all roles) |
|------|-----------------|---------------------|
| `chief-of-staff` | `mcp_TeamsServer`, `mcp_CalendarTools` | + `mcp_ODSPRemoteServer`, `mcp_MailTools` |
| `ops` | `mcp_TeamsServer` | + `mcp_ODSPRemoteServer`, `mcp_MailTools` |
| *(all C-suite, VPs)* | *(none explicit)* | + `mcp_ODSPRemoteServer`, `mcp_MailTools` |

---

## Core Pinned Tools (All Agents)

These are **always loaded** for every agent via `CORE_PINNED_TOOLS`, regardless of task or retrieval:

| # | Tool | Category |
|---|------|----------|
| 1 | `save_memory` | Memory |
| 2 | `recall_memories` | Memory |
| 3 | `read_my_assignments` | Assignments |
| 4 | `submit_assignment_output` | Assignments |
| 5 | `flag_assignment_blocker` | Assignments |
| 6 | `send_agent_message` | Communication |
| 7 | `check_team_status` | Team Coordination |
| 8 | `check_team_assignments` | Team Coordination |
| 9 | `check_messages` | Communication |
| 10 | `request_tool_access` | Tool Management |
| 11 | `check_tool_access` | Tool Management |
| 12 | `list_my_tools` | Tool Management |
| 13 | `tool_search` | Tool Management |
| 14 | `search_sharepoint` | Document Access |
| 15 | `read_sharepoint_document` | Document Access |
| 16 | `upload_to_sharepoint` | Document Access |
| 17 | `read_inbox` | Email |
| 18 | `send_email` | Email |
| 19 | `reply_to_email` | Email |
| 20 | `reply_email_with_attachments` | Email |
| 21 | `forward_email` | Email |
| 22 | `mark_email_as_read` | Email |
| 23 | `move_email` | Email |
| 24 | `get_email_by_id` | Email |
| 25 | `get_message` | Email |
| 26 | `list_emails` | Email |
| 27 | `list_messages` | Email |
| 28 | `list_inbox` | Email |
| 29 | `list_mail_folders` | Email |
| 30 | `read_company_knowledge` | Knowledge |

---

## Custom Platform Tools by Domain

### Memory & Knowledge (30 tools)

| Tool | Type |
|------|------|
| `save_memory` | Custom |
| `recall_memories` | Custom |
| `search_memories` | Custom |
| `read_company_memory` | Custom |
| `write_company_memory` | Custom |
| `read_company_knowledge` | Custom |
| `get_company_vitals` | Custom |
| `update_company_vitals` | Custom |
| `update_vitals_highlights` | Custom |
| `contribute_knowledge` | Custom |
| `promote_to_org_knowledge` | Custom |
| `get_org_knowledge` | Custom |
| `read_company_doctrine` | Custom |
| `update_doctrine_section` | Custom |
| `create_knowledge_route` | Custom |
| `get_knowledge_routes` | Custom |
| `detect_contradictions` | Custom |
| `record_process_pattern` | Custom |
| `get_process_patterns` | Custom |
| `propose_authority_change` | Custom |
| `get_authority_proposals` | Custom |
| `emit_insight` | Custom |
| `emit_alert` | Custom |
| `trace_causes` | Custom |
| `trace_impact` | Custom |
| `query_knowledge_graph` | Custom |
| `add_knowledge` | Custom |
| `add_graph_node` | Custom |
| `add_graph_edge` | Custom |
| `search_company_info` | Custom |

### Communication & Messaging (20 tools)

| Tool | Type |
|------|------|
| `send_agent_message` | Custom |
| `check_messages` | Custom |
| `call_meeting` | Custom |
| `send_dm` | Custom |
| `send_teams_dm` | Custom |
| `read_teams_dm` | Custom |
| `send_briefing` | Custom |
| `post_to_channel` | Custom |
| `post_to_customer_teams` | Custom |
| `request_teams_approval` | Custom |
| `post_to_teams` | Custom |
| `post_to_slack` | Custom |
| `request_slack_approval` | Custom |
| `notify_founders` | Custom |
| `escalate_to_sarah` | Custom |
| `log_activity` | Custom |
| `who_handles` | Custom |
| `get_agent_directory` | Custom |
| `create_calendar_event` | Custom |
| `evaluate_calendar_mcp_founder_create_event` | Custom |

### Orchestration & Leadership (25 tools)

| Tool | Type |
|------|------|
| `read_founder_directives` | Custom |
| `create_work_assignments` | Custom |
| `dispatch_assignment` | Custom |
| `check_assignment_status` | Custom |
| `evaluate_assignment` | Custom |
| `update_directive_progress` | Custom |
| `create_decision` | Custom |
| `propose_directive` | Custom |
| `delegate_directive` | Custom |
| `propose_initiative` | Custom |
| `read_proposed_initiatives` | Custom |
| `read_initiatives` | Custom |
| `activate_initiative` | Custom |
| `create_specialist_agent` | Custom |
| `list_my_created_agents` | Custom |
| `retire_created_agent` | Custom |
| `create_peer_work_request` | Custom |
| `request_peer_work` | Custom |
| `create_handoff` | Custom |
| `peer_data_request` | Custom |
| `create_sub_team_assignment` | Custom |
| `assign_team_task` | Custom |
| `review_team_output` | Custom |
| `check_team_status` | Custom |
| `check_team_assignments` | Custom |

### Tool Management & Governance (20 tools)

| Tool | Type |
|------|------|
| `grant_tool_access` | Custom |
| `revoke_tool_access` | Custom |
| `request_tool_access` | Custom |
| `check_tool_access` | Custom |
| `list_my_tools` | Custom |
| `tool_search` | Custom |
| `request_new_tool` | Custom |
| `check_tool_request_status` | Custom |
| `list_tool_requests` | Custom |
| `review_tool_request` | Custom |
| `register_tool` | Custom |
| `deactivate_tool` | Custom |
| `list_registered_tools` | Custom |
| `grant_tool_to_agent` | Custom |
| `revoke_tool_from_agent` | Custom |
| `emergency_block_tool` | Custom |
| `register_dynamic_tool` | Custom |
| `update_dynamic_tool` | Custom |
| `create_tool_fix_proposal` | Custom |
| `list_tool_fix_proposals` | Custom |

### Engineering & Code (50+ tools)

| Tool | Type |
|------|------|
| `get_file_contents` | Custom |
| `create_or_update_file` | Custom |
| `create_branch` | Custom |
| `create_github_pr` | Custom |
| `merge_github_pr` | Custom |
| `create_github_issue` | Custom |
| `github_create_pull_request` | Custom |
| `github_list_branches` | Custom |
| `github_get_pull_request_status` | Custom |
| `github_wait_for_pull_request_checks` | Custom |
| `github_merge_pull_request` | Custom |
| `github_create_from_template` | Custom |
| `github_push_files` | Custom |
| `github_get_repository_file` | Custom |
| `get_github_pr_status` | Custom |
| `get_ci_health` | Custom |
| `get_repo_stats` | Custom |
| `get_repo_code_health` | Custom |
| `get_recent_commits` | Custom |
| `list_recent_commits` | Custom |
| `comment_on_pr` | Custom |
| `deploy_cloud_run` | Custom |
| `rollback_cloud_run` | Custom |
| `inspect_cloud_run_service` | Custom |
| `update_cloud_run_secrets` | Custom |
| `gcp_create_secret` | Custom |
| `deploy_to_staging` | Custom |
| `codex` | Custom |
| `codex-reply` | Custom |
| `apply_patch_call` | Custom |
| `sandbox_shell` | Custom |
| `sandbox_file_read` | Custom |
| `sandbox_file_write` | Custom |
| `sandbox_file_edit` | Custom |
| `read_frontend_file` | Custom |
| `search_frontend_code` | Custom |
| `list_frontend_files` | Custom |
| `write_frontend_file` | Custom |
| `create_design_branch` | Custom |
| `create_git_branch` | Custom |
| `create_frontend_pr` | Custom |
| `check_pr_status` | Custom |
| `run_test_suite` | Custom |
| `get_code_coverage` | Custom |
| `get_quality_metrics` | Custom |
| `create_test_plan` | Custom |
| `check_build_errors` | Custom |
| `check_bundle_size` | Custom |
| `get_container_logs` | Custom |
| `scale_service` | Custom |
| `get_build_queue` | Custom |
| `get_deployment_history` | Custom |
| `get_deployment_status` | Custom |
| `list_deployments` | Custom |
| `get_infrastructure_inventory` | Custom |
| `get_service_dependencies` | Custom |
| `vercel_create_project` | Custom |
| `vercel_get_preview_url` | Custom |
| `vercel_wait_for_preview_ready` | Custom |
| `vercel_get_production_url` | Custom |
| `vercel_get_deployment_logs` | Custom |
| `cloudflare_register_preview` | Custom |
| `cloudflare_update_preview` | Custom |

### Design & Visual (45+ tools)

| Tool | Type |
|------|------|
| `run_lighthouse` | Custom |
| `run_lighthouse_batch` | Custom |
| `run_lighthouse_audit` | Custom |
| `run_accessibility_audit` | Custom |
| `screenshot_page` | Custom |
| `screenshot_component` | Custom |
| `compare_screenshots` | Custom |
| `check_responsive` | Custom |
| `check_ai_smell` | Custom |
| `validate_brand_compliance` | Custom |
| `get_design_quality_summary` | Custom |
| `validate_tokens_vs_implementation` | Custom |
| `get_design_tokens` | Custom |
| `get_component_library` | Custom |
| `get_template_registry` | Custom |
| `update_design_token` | Custom |
| `get_color_palette` | Custom |
| `get_typography_scale` | Custom |
| `list_components` | Custom |
| `get_component_usage` | Custom |
| `scaffold_component` | Custom |
| `scaffold_page` | Custom |
| `list_templates` | Custom |
| `clone_and_modify` | Custom |
| `deploy_preview` | Custom |
| `normalize_design_brief` | Custom |
| `quick_demo_web_app` | Custom |
| `invoke_web_build` | Custom |
| `invoke_web_iterate` | Custom |
| `invoke_web_coding_loop` | Custom |
| `invoke_web_upgrade` | Custom |
| `build_website_foundation` | Custom |
| `write_design_audit` | Custom |
| `save_component_spec` | Custom |
| `query_design_tokens` | Custom |
| `query_component_implementations` | Custom |
| `push_component` | Custom |
| `create_component_branch` | Custom |
| `create_component_pr` | Custom |
| `save_component_implementation` | Custom |
| `query_component_specs` | Custom |
| `query_my_implementations` | Custom |
| `grade_build` | Custom |
| `query_build_grades` | Custom |
| `save_template_variant` | Custom |
| `query_template_variants` | Custom |
| `update_template_status` | Custom |
| `query_build_grades_by_template` | Custom |
| `generate_image` | Custom |
| `generate_and_publish_asset` | Custom |
| `publish_asset_deliverable` | Custom |
| `upload_asset` | Custom |
| `list_assets` | Custom |
| `optimize_image` | Custom |
| `generate_favicon_set` | Custom |

### Figma Integration (17 tools)

| Tool | Type |
|------|------|
| `get_figma_file` | Custom |
| `export_figma_images` | Custom |
| `get_figma_image_fills` | Custom |
| `get_figma_components` | Custom |
| `get_figma_team_components` | Custom |
| `get_figma_styles` | Custom |
| `get_figma_team_styles` | Custom |
| `get_figma_comments` | Custom |
| `post_figma_comment` | Custom |
| `resolve_figma_comment` | Custom |
| `get_figma_file_metadata` | Custom |
| `get_figma_version_history` | Custom |
| `get_figma_team_projects` | Custom |
| `get_figma_project_files` | Custom |
| `get_figma_dev_resources` | Custom |
| `create_figma_dev_resource` | Custom |
| `manage_figma_webhooks` | Custom |

### Canva Integration (8 tools)

| Tool | Type |
|------|------|
| `create_canva_design` | Custom |
| `get_canva_design` | Custom |
| `search_canva_designs` | Custom |
| `list_canva_brand_templates` | Custom |
| `get_canva_template_fields` | Custom |
| `generate_canva_design` | Custom |
| `export_canva_design` | Custom |
| `upload_canva_asset` | Custom |

### Storybook (7 tools)

| Tool | Type |
|------|------|
| `storybook_list_stories` | Custom |
| `storybook_screenshot` | Custom |
| `storybook_screenshot_all` | Custom |
| `storybook_visual_diff` | Custom |
| `storybook_save_baseline` | Custom |
| `storybook_check_coverage` | Custom |
| `storybook_get_story_source` | Custom |

### Logo & Branding (3 tools)

| Tool | Type |
|------|------|
| `create_logo_variation` | Custom |
| `restyle_logo` | Custom |
| `create_social_avatar` | Custom |

### Research & Intelligence (25+ tools)

| Tool | Type |
|------|------|
| `web_search` | Custom |
| `web_fetch` | Custom |
| `search_news` | Custom |
| `submit_research_packet` | Custom |
| `scrape_website` | Custom |
| `deep_research` | Custom (composite pipeline) |
| `fetch_github_releases` | Custom |
| `search_hacker_news` | Custom |
| `search_product_hunt` | Custom |
| `fetch_pricing_pages` | Custom |
| `save_research` | Custom |
| `search_research` | Custom |
| `get_research_timeline` | Custom |
| `create_research_brief` | Custom |
| `create_monitor` | Custom |
| `check_monitors` | Custom |
| `get_monitor_history` | Custom |
| `track_competitor_product` | Custom |
| `search_academic_papers` | Custom |
| `track_open_source` | Custom |
| `track_industry_events` | Custom |
| `track_regulatory_changes` | Custom |
| `analyze_ai_adoption` | Custom |
| `track_ai_benchmarks` | Custom |
| `compile_research_digest` | Custom |
| `identify_research_gaps` | Custom |
| `cross_reference_findings` | Custom |
| `analyze_org_structure` | Custom |

### Competitive Intelligence (10+ tools)

| Tool | Type |
|------|------|
| `get_competitor_intelligence` | Custom |
| `query_competitor_tech_stack` | Custom |
| `check_job_postings` | Custom |
| `store_intel` | Custom |
| `search_crunchbase` | Custom |
| `analyze_tech_stack` | Custom |
| `search_linkedin_profiles` | Custom |
| `search_job_postings` | Custom |
| `estimate_dev_spend` | Custom |
| `compile_dossier` | Custom |
| `track_competitor` | Custom |
| `get_competitor_profile` | Custom |
| `update_competitor_profile` | Custom |
| `compare_features` | Custom |
| `track_competitor_pricing` | Custom |
| `monitor_competitor_launches` | Custom |
| `get_market_landscape` | Custom |

### Finance (45+ tools)

| Tool | Type |
|------|------|
| `get_financials` | Custom |
| `query_financials` | Custom |
| `query_costs` | Custom |
| `calculate_unit_economics` | Custom |
| `write_financial_report` | Custom |
| `query_stripe_mrr` | Custom |
| `query_stripe_subscriptions` | Custom |
| `query_stripe_revenue` | Custom |
| `query_revenue_by_product` | Custom |
| `query_revenue_by_cohort` | Custom |
| `query_attribution` | Custom |
| `calculate_ltv_cac` | Custom |
| `forecast_revenue` | Custom |
| `query_churn_revenue` | Custom |
| `query_gcp_billing` | Custom |
| `query_db_usage` | Custom |
| `query_gemini_cost` | Custom |
| `query_agent_run_costs` | Custom |
| `identify_waste` | Custom |
| `calculate_unit_cost` | Custom |
| `project_costs` | Custom |
| `get_infrastructure_costs` | Custom |
| `get_mrr_breakdown` | Custom |
| `get_subscription_details` | Custom |
| `get_churn_analysis` | Custom |
| `get_revenue_forecast` | Custom |
| `get_stripe_invoices` | Custom |
| `get_customer_ltv` | Custom |
| `get_gcp_costs` | Custom |
| `get_ai_model_costs` | Custom |
| `get_vendor_costs` | Custom |
| `get_cost_anomalies` | Custom |
| `get_burn_rate` | Custom |
| `create_budget` | Custom |
| `check_budget_status` | Custom |
| `get_unit_economics` | Custom |
| `get_cash_balance` | Custom |
| `get_cash_flow` | Custom |
| `get_pending_transactions` | Custom |
| `generate_financial_report` | Custom |
| `get_margin_analysis` | Custom |
| `get_system_costs_realtime` | Custom |
| `predict_capacity` | Custom |
| `estimate_dev_spend` | Custom |

### Marketing & Content (40+ tools)

| Tool | Type |
|------|------|
| `create_content_draft` | Custom |
| `update_content_draft` | Custom |
| `get_content_drafts` | Custom |
| `submit_content_for_review` | Custom |
| `approve_content_draft` | Custom |
| `reject_content_draft` | Custom |
| `publish_content` | Custom |
| `get_content_metrics` | Custom |
| `get_content_calendar` | Custom |
| `generate_content_image` | Custom |
| `get_search_performance` | Custom |
| `get_seo_data` | Custom |
| `track_keyword_rankings` | Custom |
| `analyze_page_seo` | Custom |
| `get_indexing_status` | Custom |
| `submit_sitemap` | Custom |
| `update_seo_data` | Custom |
| `get_backlink_profile` | Custom |
| `get_scheduled_posts` | Custom |
| `get_social_metrics` | Custom |
| `get_post_performance` | Custom |
| `get_social_audience` | Custom |
| `reply_to_social` | Custom |
| `get_trending_topics` | Custom |
| `schedule_social_post` | Custom |
| `monitor_mentions` | Custom |
| `draft_blog_post` | Custom |
| `draft_social_post` | Custom |
| `draft_case_study` | Custom |
| `draft_email` | Custom |
| `query_content_performance` | Custom |
| `query_top_performing_content` | Custom |
| `query_seo_rankings` | Custom |
| `query_keyword_data` | Custom |
| `discover_keywords` | Custom |
| `query_competitor_rankings` | Custom |
| `query_backlinks` | Custom |
| `query_search_console` | Custom |
| `analyze_content_seo` | Custom |
| `create_experiment` | Custom |
| `get_experiment_results` | Custom |
| `monitor_competitor_marketing` | Custom |
| `analyze_market_trends` | Custom |
| `get_attribution_data` | Custom |
| `capture_lead` | Custom |
| `get_lead_pipeline` | Custom |
| `score_lead` | Custom |
| `get_marketing_dashboard` | Custom |

### Email Marketing — Mailchimp & Mandrill (15 tools)

| Tool | Type |
|------|------|
| `get_mailchimp_lists` | Custom |
| `get_mailchimp_members` | Custom |
| `get_mailchimp_segments` | Custom |
| `create_mailchimp_campaign` | Custom |
| `set_campaign_content` | Custom |
| `send_test_campaign` | Custom |
| `send_campaign` | Custom |
| `get_campaign_report` | Custom |
| `get_campaign_list` | Custom |
| `manage_mailchimp_tags` | Custom |
| `send_transactional_email` | Custom |
| `get_mandrill_stats` | Custom |
| `search_mandrill_messages` | Custom |
| `get_mandrill_templates` | Custom |
| `render_mandrill_template` | Custom |

### Legal & Compliance (25+ tools)

| Tool | Type |
|------|------|
| `track_regulations` | Custom |
| `get_compliance_status` | Custom |
| `update_compliance_item` | Custom |
| `create_compliance_alert` | Custom |
| `get_contracts` | Custom |
| `create_contract_review` | Custom |
| `flag_contract_issue` | Custom |
| `get_contract_renewals` | Custom |
| `get_ip_portfolio` | Custom |
| `create_ip_filing` | Custom |
| `monitor_ip_infringement` | Custom |
| `get_tax_calendar` | Custom |
| `calculate_tax_estimate` | Custom |
| `get_tax_research` | Custom |
| `review_tax_strategy` | Custom |
| `audit_data_flows` | Custom |
| `check_data_retention` | Custom |
| `get_privacy_requests` | Custom |
| `audit_access_permissions` | Custom |
| `create_signing_envelope` | Custom (DocuSign) |
| `send_template_envelope` | Custom (DocuSign) |
| `check_envelope_status` | Custom (DocuSign) |
| `list_envelopes` | Custom (DocuSign) |
| `void_envelope` | Custom (DocuSign) |
| `resend_envelope` | Custom (DocuSign) |

### Product Analytics & User Research (20+ tools)

| Tool | Type |
|------|------|
| `get_product_metrics` | Custom |
| `query_analytics_events` | Custom |
| `get_usage_metrics` | Custom |
| `get_funnel_analysis` | Custom |
| `get_cohort_retention` | Custom |
| `get_feature_usage` | Custom |
| `segment_users` | Custom |
| `create_survey` | Custom |
| `get_survey_results` | Custom |
| `analyze_support_tickets` | Custom |
| `get_user_feedback` | Custom |
| `create_user_persona` | Custom |
| `query_user_analytics` | Custom |
| `query_build_metadata` | Custom |
| `query_onboarding_funnel` | Custom |
| `run_cohort_analysis` | Custom |
| `query_churn_data` | Custom |
| `design_experiment` | Custom |
| `query_first_build_metrics` | Custom |
| `query_drop_off_points` | Custom |
| `query_welcome_email_metrics` | Custom |
| `query_activation_rate` | Custom |
| `query_template_usage` | Custom |
| `design_onboarding_experiment` | Custom |

### Roadmap & Features (6 tools)

| Tool | Type |
|------|------|
| `create_roadmap_item` | Custom |
| `score_feature_rice` | Custom |
| `get_roadmap` | Custom |
| `update_roadmap_item` | Custom |
| `get_feature_requests` | Custom |
| `manage_feature_flags` | Custom |

### HR & People (15+ tools)

| Tool | Type |
|------|------|
| `get_org_chart` | Custom |
| `update_agent_profile` | Custom |
| `create_onboarding_plan` | Custom |
| `get_agent_performance_summary` | Custom |
| `create_performance_review` | Custom |
| `run_engagement_survey` | Custom |
| `get_team_dynamics` | Custom |
| `audit_workforce` | Custom |
| `validate_agent` | Custom |
| `update_agent_name` | Custom |
| `retire_agent` | Custom |
| `reactivate_agent` | Custom |
| `list_stale_agents` | Custom |
| `set_reports_to` | Custom |
| `write_hr_log` | Custom |
| `generate_avatar` | Custom |
| `provision_agent` | Custom |
| `enrich_agent_profile` | Custom |

### Entra ID / Identity (15 tools)

| Tool | Type |
|------|------|
| `entra_list_users` | Custom |
| `entra_create_user` | Custom |
| `entra_disable_user` | Custom |
| `entra_enable_user` | Custom |
| `entra_list_groups` | Custom |
| `entra_list_group_members` | Custom |
| `entra_add_group_member` | Custom |
| `entra_remove_group_member` | Custom |
| `entra_list_directory_roles` | Custom |
| `entra_assign_directory_role` | Custom |
| `entra_list_app_registrations` | Custom |
| `entra_list_licenses` | Custom |
| `entra_assign_license` | Custom |
| `entra_revoke_license` | Custom |
| `entra_audit_sign_ins` | Custom |
| `entra_get_user_profile` | Custom |
| `entra_update_user_profile` | Custom |
| `entra_upload_user_photo` | Custom |
| `entra_set_manager` | Custom |
| `entra_hr_assign_license` | Custom |
| `entra_audit_profiles` | Custom |

### GCP IAM / Admin (12 tools)

| Tool | Type |
|------|------|
| `list_project_iam` | Custom |
| `grant_project_role` | Custom |
| `revoke_project_role` | Custom |
| `list_service_accounts` | Custom |
| `create_service_account` | Custom |
| `list_secrets` | Custom |
| `get_secret_iam` | Custom |
| `grant_secret_access` | Custom |
| `revoke_secret_access` | Custom |
| `run_access_audit` | Custom |
| `run_onboarding` | Custom |
| `update_secret_value` | Custom |

### Ops & Platform Health (30+ tools)

| Tool | Type |
|------|------|
| `query_agent_runs` | Custom |
| `query_agent_health` | Custom |
| `query_data_sync_status` | Custom |
| `query_events_backlog` | Custom |
| `query_cost_trends` | Custom |
| `trigger_agent_run` | Custom |
| `retry_failed_run` | Custom |
| `retry_data_sync` | Custom |
| `pause_agent` | Custom |
| `resume_agent` | Custom |
| `create_incident` | Custom |
| `resolve_incident` | Custom |
| `post_system_status` | Custom |
| `rollup_agent_performance` | Custom |
| `detect_milestones` | Custom |
| `update_growth_areas` | Custom |
| `query_cloud_run_metrics` | Custom |
| `run_health_check` | Custom |
| `query_gemini_latency` | Custom |
| `query_db_health` | Custom |
| `query_uptime` | Custom |
| `get_platform_health` | Custom |
| `get_cloud_run_metrics` | Custom |
| `write_health_report` | Custom |
| `get_agent_health_dashboard` | Custom |
| `get_event_bus_health` | Custom |
| `get_data_freshness` | Custom |
| `create_status_report` | Custom |
| `get_access_matrix` | Custom |
| `provision_access` | Custom |
| `revoke_access` | Custom |
| `audit_access` | Custom |
| `rotate_secrets` | Custom |
| `get_platform_audit_log` | Custom |

### Platform Intel — Self-Healing (20+ tools)

| Tool | Type |
|------|------|
| `read_gtm_report` | Custom |
| `read_fleet_health` | Custom |
| `read_agent_eval_detail` | Custom |
| `read_handoff_health` | Custom |
| `read_tool_failure_rates` | Custom |
| `read_tool_call_errors` | Custom |
| `read_tool_call_trace` | Custom |
| `validate_tool_sql` | Custom |
| `check_env_credentials` | Custom |
| `trigger_reflection_cycle` | Custom |
| `promote_prompt_version` | Custom |
| `discard_prompt_version` | Custom |
| `write_fleet_finding` | Custom |
| `write_world_model_correction` | Custom |
| `create_approval_request` | Custom |
| `mark_tool_fix_applied` | Custom |
| `read_agent_config` | Custom |
| `audit_knowledge_freshness` | Custom |
| `verify_knowledge_section` | Custom |
| `audit_channel_delivery_config` | Custom |
| `read_blocked_assignments` | Custom |
| `watch_tool_gaps` | Custom |

### Deliverables & Documents (8 tools)

| Tool | Type |
|------|------|
| `publish_deliverable` | Custom |
| `get_deliverables` | Custom |
| `post_to_deliverables` | Custom |
| `generate_pdf` | Custom |
| `generate_word_doc` | Custom |
| `write_product_analysis` | Custom |
| `write_content` | Custom |
| `write_pipeline_report` | Custom |

### Support & Tickets (6 tools)

| Tool | Type |
|------|------|
| `query_support_tickets` | Custom |
| `classify_ticket` | Custom |
| `respond_to_ticket` | Custom |
| `escalate_ticket` | Custom |
| `query_knowledge_base` | Custom |
| `batch_similar_tickets` | Custom |

### M365 Admin (15+ tools)

| Tool | Type |
|------|------|
| `list_users` | Custom |
| `get_user` | Custom |
| `list_channels` | Custom |
| `list_channel_members` | Custom |
| `add_channel_member` | Custom |
| `create_channel` | Custom |
| `list_calendar_events` | Custom |
| `write_admin_log` | Custom |
| `check_my_access` | Custom |
| `list_licenses` | Custom |
| `list_groups` | Custom |
| `list_group_members` | Custom |
| `list_app_registrations` | Custom |
| `list_sharepoint_sites` | Custom |
| `get_sharepoint_site_permissions` | Custom |
| `create_sharepoint_site` | Custom |
| `grant_site_permission` | Custom |
| `revoke_site_permission` | Custom |
| `create_sharepoint_list` | Custom |
| `update_site_settings` | Custom |
| `delete_sharepoint_list` | Custom |

### Social Platform Tools

| Tool | Type |
|------|------|
| Facebook tools (via `createFacebookTools()`) | Custom |
| LinkedIn tools (via `createLinkedInTools()`) | Custom |
| `query_social_metrics` | Custom |
| `query_post_performance` | Custom |
| `query_optimal_times` | Custom |
| `query_audience_demographics` | Custom |
| `monitor_mentions` | Custom |

### Diagnostic & Schema Tools (5 tools)

| Tool | Type |
|------|------|
| `check_table_schema` | Custom |
| `diagnose_column_error` | Custom |
| `list_tables` | Custom |
| `check_tool_health` | Custom |
| `view_access_matrix` | Custom |

---

## Agent Role → Tool Mapping

### Universal Pins (All 31 Agents)

Every agent gets these via `_universal` role pins:

`save_memory`, `recall_memories`, `send_agent_message`, `file_decision`, `tool_search`, `request_new_tool`, `post_to_deliverables`

### Per-Agent Tool Assignment

| # | Role | Agent Name | Role-Pinned Tools (beyond universal) | Tool Factories |
|---|------|-----------|---------------------------------------|----------------|
| 1 | `chief-of-staff` | Sarah Chen | `grant_tool_access`, `revoke_tool_access`, `create_work_assignments`, `dispatch_assignment`, `read_founder_directives`, `get_pending_decisions`, `send_briefing`, `generate_pdf`, `generate_word_doc`, `web_fetch` | `createChiefOfStaffTools()` — 23 tools |
| 2 | `cto` | Marcus Reeves | `grant_tool_access`, `revoke_tool_access`, `list_tool_requests`, `review_tool_request`, `register_tool`, `list_registered_tools`, `get_platform_health`, `get_github_pr_status`, `create_github_issue` | `createCTOTools()` — 41 tools |
| 3 | `cfo` | Nadia Okafor | `query_financials`, `query_costs`, `get_burn_rate` | `createCFOTools()` — 8 tools |
| 4 | `cpo` | Elena Vasquez | *(universal only)* | `createCPOTools()` — 7 tools |
| 5 | `cmo` | Maya Brooks | `get_content_calendar`, `approve_content_draft`, `validate_brand_compliance` | `createCMOTools()` — 7+ tools + Facebook + LinkedIn |
| 6 | `clo` | *(Legal)* | *(universal only)* | Legal tools |
| 7 | `vp-sales` | *(Sales)* | *(universal only)* | `createVPSalesTools()` — 8 tools |
| 8 | `vp-design` | Mia Tanaka | `normalize_design_brief`, `invoke_web_build`, `invoke_web_iterate`, `invoke_web_coding_loop`, `github_list_branches`, `github_create_pull_request`, `github_get_pull_request_status`, `github_wait_for_pull_request_checks`, `github_merge_pull_request` | `createVPDesignTools()` — 15 tools |
| 9 | `vp-research` | Sophia Lin | *(universal only)* | `createVPResearchTools()` — `deep_research`, `web_search`, `web_fetch`, `news_search`, `submit_research_packet` |
| 10 | `ops` | Atlas Vega | `get_platform_health`, `query_agent_health`, `trigger_agent_run`, `pause_agent`, `resume_agent` | `createOpsTools()` — 21 tools |
| 11 | `global-admin` | Morgan Blake | `grant_tool_access`, `revoke_tool_access` | `createGlobalAdminTools()` — 31 tools |
| 12 | `platform-engineer` | Alex Park | *(universal only)* | `createPlatformEngineerTools()` |
| 13 | `quality-engineer` | Sam DeLuca | *(universal only)* | `createQualityEngineerTools()` |
| 14 | `devops-engineer` | Jordan Hayes | *(universal only)* | `createDevOpsEngineerTools()` |
| 15 | `frontend-engineer` | Ava Chen | `normalize_design_brief`, `invoke_web_build`, `invoke_web_iterate`, `invoke_web_coding_loop` | `createFrontendEngineerTools()` |
| 16 | `ui-ux-designer` | Leo Vargas | `normalize_design_brief`, `invoke_web_build`, `invoke_web_iterate`, `invoke_web_coding_loop` | `createUiUxDesignerTools()` |
| 17 | `design-critic` | Sofia Marchetti | *(universal only)* | `createDesignCriticTools()` |
| 18 | `template-architect` | Ryan Park | *(universal only)* | `createTemplateArchitectTools()` |
| 19 | `content-creator` | Tyler Reed | `create_content_draft`, `submit_content_for_review`, `read_company_knowledge` | `createContentCreatorTools()` + Facebook + LinkedIn |
| 20 | `seo-analyst` | Lisa Chen | `analyze_content_seo`, `analyze_page_seo`, `discover_keywords`, `read_company_knowledge` | `createSeoAnalystTools()` |
| 21 | `social-media-manager` | Kai Johnson | `schedule_social_post`, `reply_to_social`, `read_company_knowledge` | `createSocialMediaManagerTools()` + Facebook + LinkedIn |
| 22 | `user-researcher` | Priya Sharma | *(universal only)* | `createUserResearcherTools()` |
| 23 | `competitive-intel` | Daniel Ortiz | *(universal only)* | `createCompetitiveIntelTools()` |
| 24 | `competitive-research-analyst` | Lena Park | *(universal only)* | `createCompetitiveResearchAnalystTools()` |
| 25 | `market-research-analyst` | Daniel Okafor | *(universal only)* | `createMarketResearchAnalystTools()` |
| 26 | `head-of-hr` | Jasmine Rivera | *(universal only)* | `createHeadOfHRTools()` — 12 tools |
| 27 | `m365-admin` | Riley Morgan | *(universal only)* | `createM365AdminTools()` — 24 tools |
| 28 | `platform-intel` | Nexus | `read_gtm_report`, `read_fleet_health`, `read_agent_eval_detail`, `read_handoff_health`, `read_tool_failure_rates`, `read_tool_call_errors`, `read_tool_call_trace`, `validate_tool_sql`, `check_env_credentials`, `trigger_reflection_cycle`, `promote_prompt_version`, `discard_prompt_version`, `pause_agent`, `resume_agent`, `write_fleet_finding`, `write_world_model_correction`, `create_approval_request`, `grant_tool_to_agent`, `revoke_tool_from_agent`, `emergency_block_tool`, `register_dynamic_tool`, `update_dynamic_tool`, `deactivate_tool`, `create_tool_fix_proposal`, `list_tool_fix_proposals`, `mark_tool_fix_applied`, `apply_patch_call`, `read_agent_config`, `check_table_schema`, `diagnose_column_error` | `createPlatformIntelTools()` — 34 tools |
| 29 | `bob-the-tax-pro` | Robert Finley | *(universal only)* | Tax tools |
| 30 | `marketing-intelligence-analyst` | Zara Petrov | *(universal only)* | Marketing intel tools |
| 31 | `adi-rose` | Adi Rose | *(universal only)* | *(no dedicated factory)* |

---

## Tool Selection Pipeline

```
Task arrives
  → inferCapabilities() detects needed capabilities
  → resolveModel() picks model + enables LLM-native features
  → Agent's run.ts assembles all tool factories
  → Agent365 MCP tools loaded (role-allowlisted)
  → Glyphor MCP tools loaded (role-allowlisted)
  → ToolRetriever.retrieve() applies:
      1. Role pins (always loaded)
      2. Core pins (30 universal tools)
      3. Department pins (search_sharepoint etc.)
      4. BM25 (35%) + vector (65%) hybrid retrieval for remaining slots
  → Capped to model limit:
      128 tools — GPT-5.4, Claude Opus 4.6+
       64 tools — GPT-4.1, Sonnet 4.5
       40 tools — minis
       20-25 tools — nanos
  → For Anthropic: non-pinned tools marked defer_loading=true (server-side BM25)
  → Tools sent to LLM
```

---

## Shared Tool Factory Files

75+ factory files in `packages/agents/src/shared/`:

| File | Domain |
|------|--------|
| `accessAuditTools.ts` | Access audit |
| `agent365Tools.ts` | Agent 365 MCP bridge |
| `agentCreationTools.ts` | Dynamic agent creation |
| `agentDirectoryTools.ts` | Agent directory lookup |
| `agentManagementTools.ts` | Agent management |
| `assignmentTools.ts` | Work assignment CRUD |
| `assetTools.ts` | Asset management |
| `auditTools.ts` | Audit trail |
| `calendarMcpProofTools.ts` | Calendar MCP PoC |
| `canvaTools.ts` | Canva integration |
| `cashFlowTools.ts` | Cash flow analysis |
| `channelNotifyTools.ts` | Channel notification |
| `claudeParityTools.ts` | Claude parity |
| `codexTools.ts` | Codex integration |
| `collectiveIntelligenceTools.ts` | Collective intelligence |
| `communicationTools.ts` | Inter-agent communication |
| `competitiveIntelTools.ts` | Competitive intel |
| `contentTools.ts` | Content management |
| `coreTools.ts` | Core shared (memory, messaging, decisions) |
| `costManagementTools.ts` | Cost management |
| `deepResearchTool.ts` | Composite deep research |
| `deliverableTools.ts` | Deliverable posting |
| `deployPreviewTools.ts` | Deploy preview |
| `designBriefTools.ts` | Design brief management |
| `designSystemTools.ts` | Design system |
| `diagnosticTools.ts` | Agent diagnostics |
| `dmTools.ts` | Direct messages |
| `docusignTools.ts` | DocuSign integration |
| `documentTools.ts` | Document gen (PDF, Word) |
| `emailMarketingTools.ts` | Email marketing (Mailchimp/Mandrill) |
| `engineeringGapTools.ts` | Engineering gap analysis |
| `entraHRTools.ts` | Entra HR integration |
| `eventTools.ts` | Event bus |
| `executiveOrchestrationTools.ts` | Executive orchestration |
| `externalA2aTools.ts` | External A2A protocol |
| `facebookTools.ts` | Facebook/Meta Page |
| `figmaTools.ts` | Figma integration |
| `frontendCodeTools.ts` | Frontend code gen |
| `glyphorMcpTools.ts` | Glyphor MCP factory |
| `graphTools.ts` | Knowledge graph |
| `hrTools.ts` | HR tools |
| `initiativeTools.ts` | Initiative management |
| `knowledgeRetrievalTools.ts` | Knowledge base retrieval |
| `legalDocumentTools.ts` | Legal documents |
| `legalTools.ts` | Legal tools |
| `linkedinTools.ts` | LinkedIn integration |
| `logoTools.ts` | Logo generation |
| `marketingIntelTools.ts` | Marketing intelligence |
| `memoryTools.ts` | Memory save/recall |
| `opsExtensionTools.ts` | Ops extensions |
| `peerCoordinationTools.ts` | Peer coordination |
| `productAnalyticsTools.ts` | Product analytics |
| `quickDemoAppTools.ts` | Quick demo app |
| `researchMonitoringTools.ts` | Research monitoring |
| `researchRepoTools.ts` | Research repository |
| `researchTools.ts` | Web search, deep research |
| `revenueTools.ts` | Revenue tracking |
| `roadmapTools.ts` | Roadmap management |
| `sandboxDevTools.ts` | Sandbox development |
| `scaffoldTools.ts` | Project scaffolding |
| `screenshotTools.ts` | Screenshot capture |
| `seoTools.ts` | SEO tools |
| `sharepointTools.ts` | SharePoint |
| `slackOutputTools.ts` | Slack output |
| `socialMediaTools.ts` | Social media scheduling |
| `storybookTools.ts` | Storybook |
| `teamOrchestrationTools.ts` | Team orchestration |
| `teamsOutputTools.ts` | Teams output |
| `toolGrantTools.ts` | Tool grant/revoke |
| `toolPermissionPolicy.ts` | Tool permission policy engine |
| `toolRegistryTools.ts` | Dynamic tool registry |
| `toolRequestTools.ts` | Tool request workflow |
| `userResearchTools.ts` | User research |
| `videoCreationTools.ts` | Video creation |
| `webBuildPlannerTools.ts` | Web build planning |
| `webBuildTools.ts` | Web build execution |
| `websiteIngestionTools.ts` | Website ingestion |

---

*End of audit. For questions about specific tool implementations, see the corresponding factory file in `packages/agents/src/shared/`.*

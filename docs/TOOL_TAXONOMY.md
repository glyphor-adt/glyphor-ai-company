# Glyphor Tool Taxonomy

> **Generated**: March 5, 2026
>
> Complete inventory of every tool in the system and every agent's granted tools.

---

## Tool Source Key

Every agent's tools come from **two independent systems**:

| Source | How Access Is Controlled | Symbol |
|--------|--------------------------|--------|
| **Code-Based** (agent_tool_grants) | DB grant rows — KNOWN_TOOLS static set | — |
| **Glyphor MCP** (5 servers) | Entra app role scopes per agent identity | 🔌 |
| **M365 MCP** (3 of 5 active) | Agent 365 SDK — all coded agents connect | ☁️ |

Code-based tools are listed in each agent's tool table below. MCP-served tools are **additional** tools discovered at runtime and are NOT in the grant tables — they're controlled by Entra identity scopes. See [Section 5: Agent → MCP Server Matrix](#5-agent--mcp-server-access-matrix) for which MCP servers (and tools) each agent connects to.

---

## Table of Contents

1. [Tool Categories](#1-tool-categories)
2. [Agent Directory & Tool Grants](#2-agent-directory--tool-grants)
3. [MCP Server Tools](#3-mcp-server-tools)
4. [Tool Access Architecture](#4-tool-access-architecture)
5. [Agent → MCP Server Access Matrix](#5-agent--mcp-server-access-matrix)

---

## 1. Tool Categories

### Shared Tools (granted to all agents)

| Tool | Description |
|------|-------------|
| `save_memory` | Persist notes to agent memory |
| `recall_memories` | Retrieve agent memories |
| `search_memories` | Search across memory entries |
| `read_my_assignments` | View assigned work items |
| `submit_assignment_output` | Deliver completed assignment |
| `flag_assignment_blocker` | Report blocker on assignment |
| `send_agent_message` | Send message to another agent |
| `check_messages` | Read incoming agent messages |
| `call_meeting` | Coordinate a multi-agent meeting |
| `log_activity` | Record activity in audit log |
| `get_agent_directory` | List all agents in the org |
| `who_handles` | Find which agent handles a domain |

### Collective Intelligence Tools

| Tool | Description |
|------|-------------|
| `get_company_pulse` | Read company-wide health snapshot |
| `update_company_pulse` | Write to company pulse |
| `update_pulse_highlights` | Update pulse highlight entries |
| `contribute_knowledge` | Share knowledge to org repository |
| `promote_to_org_knowledge` | Elevate knowledge to org-wide |
| `get_org_knowledge` | Read org-wide knowledge base |
| `create_knowledge_route` | Define a knowledge routing rule |
| `get_knowledge_routes` | List knowledge routes |
| `detect_contradictions` | Find conflicting information |
| `record_process_pattern` | Document a recurring process |
| `get_process_patterns` | List documented processes |
| `propose_authority_change` | Propose org authority structure change |
| `get_authority_proposals` | View pending authority proposals |
| `emit_insight` | Publish an org-wide insight |
| `emit_alert` | Publish an org-wide alert |

### Graph Tools

| Tool | Description |
|------|-------------|
| `trace_causes` | Trace root causes in knowledge graph |
| `trace_impact` | Trace downstream impact |
| `query_knowledge_graph` | Query the knowledge graph |
| `add_knowledge` | Add nodes/edges to graph |
| `add_graph_node` | Add a node directly |
| `add_graph_edge` | Add an edge directly |

### Email Tools

| Tool | Description |
|------|-------------|
| `send_email` | Send email via M365 shared mailbox |
| `read_inbox` | Read agent's inbox |
| `reply_to_email` | Reply to an email thread |
| `send_dm` | Send direct message |

### Tool Request & Registry Tools

| Tool | Description |
|------|-------------|
| `request_tool_access` | Request access to existing tool |
| `request_new_tool` | Request a new tool be built |
| `check_tool_request_status` | Check status of a tool request |
| `list_tool_requests` | List all pending tool requests |
| `review_tool_request` | Approve/reject a tool request |
| `register_tool` | Register a new tool in the system |
| `deactivate_tool` | Deactivate a registered tool |
| `list_registered_tools` | List all registered tools |

### Tool Grant Administration

| Tool | Description |
|------|-------------|
| `grant_tool_access` | Grant an agent access to a tool |
| `revoke_tool_access` | Revoke an agent's tool access |

### Agent Creation Tools

| Tool | Description |
|------|-------------|
| `create_specialist_agent` | Spawn a new specialist agent |
| `list_my_created_agents` | List agents created by this agent |
| `retire_created_agent` | Retire a spawned agent |

### Access Audit Tools

| Tool | Description |
|------|-------------|
| `view_access_matrix` | View the full access matrix |
| `view_pending_grant_requests` | See pending grant requests |

### Diagnostic Tools

| Tool | Description |
|------|-------------|
| `check_table_schema` | Inspect DB table schema |
| `diagnose_column_error` | Debug column-level DB errors |
| `list_tables` | List all DB tables |
| `check_tool_health` | Check tool runtime health |

### SharePoint Tools

| Tool | Description |
|------|-------------|
| `search_sharepoint` | Search SharePoint content |
| `read_sharepoint_document` | Read a SharePoint document |
| `upload_to_sharepoint` | Upload file to SharePoint |
| `list_sharepoint_folders` | List SharePoint folder contents |

---

### Chief of Staff Tools

| Tool | Description |
|------|-------------|
| `get_recent_activity` | Get recent org activity |
| `get_pending_decisions` | List decisions awaiting action |
| `get_product_metrics` | Read product KPIs |
| `get_financials` | Read financial summary |
| `read_company_memory` | Read org-wide memory |
| `send_briefing` | Send executive briefing |
| `create_decision` | File a new decision |
| `check_escalations` | Check active escalations |
| `create_calendar_event` | Create M365 calendar event |
| `read_founder_directives` | Read founder directives |
| `create_work_assignments` | Create assignments for agents |
| `dispatch_assignment` | Dispatch assignment to agent |
| `check_assignment_status` | Check assignment progress |
| `evaluate_assignment` | Evaluate completed assignment |
| `update_directive_progress` | Update directive progress |
| `propose_directive` | Propose a new directive |

### CTO / Engineering Tools

| Tool | Description |
|------|-------------|
| `get_platform_health` | Platform health dashboard |
| `get_cloud_run_metrics` | Cloud Run container metrics |
| `get_infrastructure_costs` | Infrastructure cost breakdown |
| `write_health_report` | Write platform health report |
| `get_github_pr_status` | GitHub PR status |
| `get_ci_health` | CI/CD pipeline health |
| `get_repo_stats` | Repository statistics |
| `create_github_issue` | Create GitHub issue |
| `get_file_contents` | Read file from repo |
| `create_or_update_file` | Write file to repo |
| `create_branch` | Create git branch |
| `create_github_pr` | Create pull request |
| `merge_github_pr` | Merge pull request |
| `query_vercel_health` | Vercel deployment health |
| `trigger_vercel_deploy` | Trigger Vercel deployment |
| `rollback_vercel_deploy` | Roll back Vercel deployment |
| `create_runtime_tool` | Create a runtime tool definition |

### CFO / Finance Tools

| Tool | Description |
|------|-------------|
| `calculate_unit_economics` | Calculate unit economics |
| `write_financial_report` | Generate financial reports |
| `query_stripe_mrr` | Query Stripe MRR data |
| `query_stripe_subscriptions` | Query Stripe subscriptions |

### CPO Tools

| Tool | Description |
|------|-------------|
| `write_product_analysis` | Produce product analysis doc |

### CMO Tools

| Tool | Description |
|------|-------------|
| `write_content` | Create marketing content |
| `write_company_memory` | Write to company memory |

### VP Customer Success Tools

| Tool | Description |
|------|-------------|
| `write_health_report` | Customer health report |

### VP Sales Tools

| Tool | Description |
|------|-------------|
| `write_pipeline_report` | Sales pipeline report |

### VP Design Tools

| Tool | Description |
|------|-------------|
| `run_lighthouse` | Run Lighthouse audit |
| `run_lighthouse_batch` | Batch Lighthouse audits |
| `get_design_quality_summary` | Design quality dashboard |
| `get_design_tokens` | Read design token values |
| `get_component_library` | List component library |
| `get_template_registry` | List template registry |
| `write_design_audit` | Write design audit report |

### Design Team — Frontend Code Tools

| Tool | Description |
|------|-------------|
| `read_frontend_file` | Read a frontend source file |
| `search_frontend_code` | Search frontend codebase |
| `list_frontend_files` | List frontend files |
| `write_frontend_file` | Write to frontend file |
| `create_design_branch` | Create a design feature branch |
| `create_frontend_pr` | Create frontend PR |
| `check_pr_status` | Check PR merge status |

### Design Team — Screenshot Tools

| Tool | Description |
|------|-------------|
| `screenshot_page` | Capture full page screenshot |
| `screenshot_component` | Capture component screenshot |
| `compare_screenshots` | Diff two screenshots |
| `check_responsive` | Check responsive breakpoints |

### Design Team — Design System Tools

| Tool | Description |
|------|-------------|
| `update_design_token` | Update a design token value |
| `validate_tokens_vs_implementation` | Validate tokens match code |
| `get_color_palette` | Get color palette |
| `get_typography_scale` | Get typography scale |
| `list_components` | List design system components |
| `get_component_usage` | Get component usage stats |

### Design Team — Audit Tools

| Tool | Description |
|------|-------------|
| `run_lighthouse_audit` | Run Lighthouse on a URL |
| `run_accessibility_audit` | Run accessibility scan |
| `check_ai_smell` | Detect AI-generated content |
| `validate_brand_compliance` | Validate brand guidelines |
| `check_bundle_size` | Check JS bundle size |
| `check_build_errors` | Check for build errors |

### Design Team — Asset Tools

| Tool | Description |
|------|-------------|
| `generate_image` | AI-generate an image |
| `upload_asset` | Upload a design asset |
| `list_assets` | List design assets |
| `optimize_image` | Optimize image file size |
| `generate_favicon_set` | Generate favicon variants |

### Design Team — Scaffold Tools

| Tool | Description |
|------|-------------|
| `scaffold_component` | Scaffold a new component |
| `scaffold_page` | Scaffold a new page |
| `list_templates` | List scaffold templates |
| `clone_and_modify` | Clone and modify a component |

### Design Team — Deploy Preview Tools

| Tool | Description |
|------|-------------|
| `deploy_preview` | Deploy a preview build |
| `get_deployment_status` | Get deployment status |
| `list_deployments` | List all deployments |

### Design Team — Figma Tools

| Tool | Description |
|------|-------------|
| `get_figma_file` | Read Figma file data |
| `export_figma_images` | Export images from Figma |
| `get_figma_image_fills` | Get Figma image fill data |
| `get_figma_components` | List Figma components |
| `get_figma_team_components` | List team-level components |
| `get_figma_styles` | Get Figma styles |
| `get_figma_team_styles` | Get team-level styles |
| `get_figma_comments` | Read Figma comments |
| `post_figma_comment` | Post a Figma comment |
| `resolve_figma_comment` | Resolve a Figma comment |
| `get_figma_file_metadata` | Get Figma file metadata |
| `get_figma_version_history` | Get Figma version history |
| `get_figma_team_projects` | List Figma team projects |
| `get_figma_project_files` | List files in a Figma project |
| `get_figma_dev_resources` | Get dev resources from Figma |
| `create_figma_dev_resource` | Create a dev resource link |
| `manage_figma_webhooks` | Manage Figma webhooks |

### Design Team — Canva Tools

| Tool | Description |
|------|-------------|
| `create_canva_design` | Create a Canva design |
| `get_canva_design` | Get Canva design details |
| `search_canva_designs` | Search Canva designs |
| `list_canva_brand_templates` | List brand templates |
| `get_canva_template_fields` | Get template editable fields |
| `generate_canva_design` | Generate design from template |
| `export_canva_design` | Export Canva design |
| `upload_canva_asset` | Upload asset to Canva |

### Design Team — Logo Tools

| Tool | Description |
|------|-------------|
| `create_logo_variation` | Create a logo variation |
| `restyle_logo` | Restyle an existing logo |
| `create_social_avatar` | Create social media avatar |

### Design Team — Storybook Tools

| Tool | Description |
|------|-------------|
| `storybook_list_stories` | List all Storybook stories |
| `storybook_screenshot` | Screenshot a single story |
| `storybook_screenshot_all` | Screenshot all stories |
| `storybook_visual_diff` | Visual regression diff |
| `storybook_save_baseline` | Save screenshot baseline |
| `storybook_check_coverage` | Check story coverage |
| `storybook_get_story_source` | Get story source code |

### Design Sub-Agent Domain Tools

| Tool | Description |
|------|-------------|
| `save_component_spec` | Save a component specification |
| `query_design_tokens` | Query design tokens from DB |
| `query_component_implementations` | Query component implementations |
| `push_component` | Push component to repo |
| `create_component_branch` | Create branch for component |
| `create_component_pr` | Create PR for component |
| `save_component_implementation` | Save implementation code |
| `query_component_specs` | Query component specifications |
| `query_my_implementations` | List my implementations |
| `grade_build` | Grade a build's quality |
| `query_build_grades` | Query build grades |
| `save_template_variant` | Save a template variant |
| `query_template_variants` | Query template variants |
| `update_template_status` | Update template status |
| `query_build_grades_by_template` | Build grades by template |

### Ops (Atlas) Tools

| Tool | Description |
|------|-------------|
| `query_agent_runs` | Query agent execution runs |
| `query_agent_health` | Query agent health status |
| `query_data_sync_status` | Query data sync health |
| `query_events_backlog` | Query event backlog |
| `query_cost_trends` | Query cost trends |
| `trigger_agent_run` | Manually trigger agent run |
| `retry_failed_run` | Retry a failed agent run |
| `retry_data_sync` | Retry a failed data sync |
| `pause_agent` | Pause an agent |
| `resume_agent` | Resume a paused agent |
| `create_incident` | Create an incident |
| `resolve_incident` | Resolve an incident |
| `post_system_status` | Post system status update |
| `rollup_agent_performance` | Aggregate agent performance |
| `detect_milestones` | Detect system milestones |
| `update_growth_areas` | Update growth tracking |

### Platform Engineer (Alex) Tools

| Tool | Description |
|------|-------------|
| `query_cloud_run_metrics` | Cloud Run metrics |
| `run_health_check` | Run a health check |
| `query_gemini_latency` | Gemini API latency |
| `query_db_health` | Database health |
| `query_uptime` | Service uptime |
| `get_repo_code_health` | Repo code health |

### Quality Engineer (Sam) Tools

| Tool | Description |
|------|-------------|
| `query_build_logs` | Query build logs |
| `query_error_patterns` | Query error patterns |
| `create_bug_report` | Create a bug report |
| `query_test_results` | Query test results |

### DevOps Engineer (Jordan) Tools

| Tool | Description |
|------|-------------|
| `query_cache_metrics` | Cache hit/miss metrics |
| `query_pipeline_metrics` | CI/CD pipeline metrics |
| `query_resource_utilization` | Resource utilization |
| `query_cold_starts` | Cold start frequency |
| `identify_unused_resources` | Find unused resources |
| `calculate_cost_savings` | Calculate cost savings |
| `get_pipeline_runs` | Get pipeline run history |
| `get_recent_commits` | Get recent commits |
| `comment_on_pr` | Comment on a PR |
| `query_vercel_builds` | Query Vercel builds |

### User Researcher (Priya) Tools

| Tool | Description |
|------|-------------|
| `query_user_analytics` | User analytics data |
| `query_build_metadata` | Build metadata |
| `query_onboarding_funnel` | Onboarding funnel data |
| `run_cohort_analysis` | Run cohort analysis |
| `query_churn_data` | Churn analytics |
| `design_experiment` | Design an A/B experiment |

### Competitive Intel (Daniel) Tools

| Tool | Description |
|------|-------------|
| `fetch_github_releases` | Fetch GitHub releases |
| `search_hacker_news` | Search Hacker News |
| `search_product_hunt` | Search Product Hunt |
| `fetch_pricing_pages` | Fetch competitor pricing |
| `query_competitor_tech_stack` | Competitor tech stack |
| `check_job_postings` | Check competitor job postings |
| `store_intel` | Store competitive intel |

### Revenue Analyst (Anna) Tools

| Tool | Description |
|------|-------------|
| `query_stripe_revenue` | Stripe revenue data |
| `query_revenue_by_product` | Revenue by product |
| `query_revenue_by_cohort` | Revenue by cohort |
| `query_attribution` | Attribution data |
| `calculate_ltv_cac` | Calculate LTV/CAC |
| `forecast_revenue` | Revenue forecast |
| `query_churn_revenue` | Churn revenue impact |

### Cost Analyst (Omar) Tools

| Tool | Description |
|------|-------------|
| `query_gcp_billing` | GCP billing data |
| `query_db_usage` | Database usage data |
| `query_gemini_cost` | Gemini API costs |
| `query_agent_run_costs` | Agent run costs |
| `identify_waste` | Identify cost waste |
| `calculate_unit_cost` | Calculate unit costs |
| `project_costs` | Project future costs |
| `query_vercel_usage` | Vercel usage data |

### Content Creator (Tyler) Tools

| Tool | Description |
|------|-------------|
| `draft_blog_post` | Draft a blog post |
| `draft_social_post` | Draft a social media post |
| `draft_case_study` | Draft a case study |
| `draft_email` | Draft a marketing email |
| `query_content_performance` | Content performance data |
| `query_top_performing_content` | Top performing content |

### SEO Analyst (Lisa) Tools

| Tool | Description |
|------|-------------|
| `query_seo_rankings` | SEO ranking data |
| `query_keyword_data` | Keyword analytics |
| `discover_keywords` | Discover new keywords |
| `query_competitor_rankings` | Competitor SEO rankings |
| `query_backlinks` | Backlink data |
| `query_search_console` | Google Search Console |
| `analyze_content_seo` | Analyze page for SEO |

### Social Media Manager (Kai) Tools

| Tool | Description |
|------|-------------|
| `schedule_social_post` | Schedule a social post |
| `query_social_metrics` | Social media metrics |
| `query_post_performance` | Post-level performance |
| `query_optimal_times` | Optimal posting times |
| `query_audience_demographics` | Audience demographics |
| `monitor_mentions` | Monitor brand mentions |

### Onboarding Specialist (Emma) Tools

| Tool | Description |
|------|-------------|
| `query_first_build_metrics` | First build success metrics |
| `query_drop_off_points` | Onboarding drop-off points |
| `query_welcome_email_metrics` | Welcome email performance |
| `query_activation_rate` | Activation rate data |
| `query_template_usage` | Template usage data |
| `design_onboarding_experiment` | Design onboarding experiment |

### Support Triage (David) Tools

| Tool | Description |
|------|-------------|
| `query_support_tickets` | Query support tickets |
| `classify_ticket` | Auto-classify a ticket |
| `respond_to_ticket` | Send ticket response |
| `escalate_ticket` | Escalate a ticket |
| `query_knowledge_base` | Search knowledge base |
| `batch_similar_tickets` | Group similar tickets |

### Account Research (Nathan) Tools

| Tool | Description |
|------|-------------|
| `search_company_info` | Search company information |
| `search_crunchbase` | Search Crunchbase |
| `analyze_tech_stack` | Analyze company tech stack |
| `search_linkedin_profiles` | Search LinkedIn profiles |
| `search_job_postings` | Search job postings |
| `estimate_dev_spend` | Estimate dev spend |
| `compile_dossier` | Compile account dossier |

### M365 Admin (Riley) Tools

| Tool | Description |
|------|-------------|
| `list_users` | List M365 users |
| `get_user` | Get user profile |
| `list_channels` | List Teams channels |
| `list_channel_members` | List channel members |
| `add_channel_member` | Add channel member |
| `create_channel` | Create Teams channel |
| `post_to_channel` | Post to Teams channel |
| `list_calendar_events` | List calendar events |
| `write_admin_log` | Write admin log entry |

### Global Admin (Morgan) — GCP Tools

| Tool | Description |
|------|-------------|
| `list_project_iam` | List project IAM bindings |
| `grant_project_role` | Grant IAM role |
| `revoke_project_role` | Revoke IAM role |
| `list_service_accounts` | List service accounts |
| `create_service_account` | Create service account |
| `list_secrets` | List Secret Manager secrets |
| `get_secret_iam` | Get secret IAM policy |
| `grant_secret_access` | Grant secret access |
| `revoke_secret_access` | Revoke secret access |
| `run_access_audit` | Run full access audit |
| `run_onboarding` | Run onboarding workflow |

### Global Admin (Morgan) — Entra ID Tools

| Tool | Description |
|------|-------------|
| `entra_list_users` | List Entra ID users |
| `entra_create_user` | Create Entra ID user |
| `entra_disable_user` | Disable Entra ID user |
| `entra_list_groups` | List Entra ID groups |
| `entra_list_group_members` | List group members |
| `entra_add_group_member` | Add group member |
| `entra_remove_group_member` | Remove group member |
| `entra_list_directory_roles` | List directory roles |
| `entra_assign_directory_role` | Assign directory role |
| `entra_list_app_registrations` | List app registrations |
| `entra_list_licenses` | List M365 licenses |
| `entra_assign_license` | Assign M365 license |
| `entra_revoke_license` | Revoke M365 license |
| `entra_audit_sign_ins` | Audit sign-in logs |

### Head of HR (Jasmine) Tools

| Tool | Description |
|------|-------------|
| `audit_workforce` | Audit org workforce |
| `validate_agent` | Validate agent configuration |
| `update_agent_profile` | Update agent profile |
| `update_agent_name` | Update agent display name |
| `retire_agent` | Retire an agent |
| `reactivate_agent` | Reactivate a retired agent |
| `list_stale_agents` | List idle/stale agents |
| `set_reports_to` | Set agent reporting chain |
| `write_hr_log` | Write HR log entry |
| `generate_avatar` | Generate agent avatar |
| `provision_agent` | Provision a new agent |
| `enrich_agent_profile` | Enrich agent profile data |

### Strategy Lab / Research Tools

| Tool | Description |
|------|-------------|
| `web_fetch` | Fetch web page content |
| `web_search` | Web search via Serper |
| `search_news` | Search news articles |
| `submit_research_packet` | Submit research findings |

### Marketing Shared Tools (Wave 1)

| Tool | Category |
|------|----------|
| `create_content_draft` | Content |
| `update_content_draft` | Content |
| `get_content_drafts` | Content |
| `publish_content` | Content |
| `get_content_metrics` | Content |
| `get_content_calendar` | Content |
| `generate_content_image` | Content |
| `get_search_performance` | SEO |
| `get_seo_data` | SEO |
| `track_keyword_rankings` | SEO |
| `analyze_page_seo` | SEO |
| `get_indexing_status` | SEO |
| `submit_sitemap` | SEO |
| `update_seo_data` | SEO |
| `get_backlink_profile` | SEO |
| `get_scheduled_posts` | Social |
| `get_social_metrics` | Social |
| `get_post_performance` | Social |
| `get_social_audience` | Social |
| `reply_to_social` | Social |
| `get_trending_topics` | Social |
| `get_mailchimp_lists` | Email (Mailchimp) |
| `get_mailchimp_members` | Email (Mailchimp) |
| `get_mailchimp_segments` | Email (Mailchimp) |
| `create_mailchimp_campaign` | Email (Mailchimp) |
| `set_campaign_content` | Email (Mailchimp) |
| `send_test_campaign` | Email (Mailchimp) |
| `send_campaign` | Email (Mailchimp) |
| `get_campaign_report` | Email (Mailchimp) |
| `get_campaign_list` | Email (Mailchimp) |
| `manage_mailchimp_tags` | Email (Mailchimp) |
| `send_transactional_email` | Email (Mandrill) |
| `get_mandrill_stats` | Email (Mandrill) |
| `search_mandrill_messages` | Email (Mandrill) |
| `get_mandrill_templates` | Email (Mandrill) |
| `render_mandrill_template` | Email (Mandrill) |
| `create_experiment` | Marketing Intel |
| `get_experiment_results` | Marketing Intel |
| `monitor_competitor_marketing` | Marketing Intel |
| `analyze_market_trends` | Marketing Intel |
| `get_attribution_data` | Marketing Intel |
| `capture_lead` | Marketing Intel |
| `get_lead_pipeline` | Marketing Intel |
| `score_lead` | Marketing Intel |
| `get_marketing_dashboard` | Marketing Intel |

### Finance Shared Tools (Wave 2)

| Tool | Category |
|------|----------|
| `get_mrr_breakdown` | Revenue |
| `get_subscription_details` | Revenue |
| `get_churn_analysis` | Revenue |
| `get_revenue_forecast` | Revenue |
| `get_stripe_invoices` | Revenue |
| `get_customer_ltv` | Revenue |
| `get_gcp_costs` | Cost Management |
| `get_ai_model_costs` | Cost Management |
| `get_vendor_costs` | Cost Management |
| `get_cost_anomalies` | Cost Management |
| `get_burn_rate` | Cost Management |
| `create_budget` | Cost Management |
| `check_budget_status` | Cost Management |
| `get_unit_economics` | Cost Management |
| `get_cash_balance` | Cash Flow |
| `get_cash_flow` | Cash Flow |
| `get_pending_transactions` | Cash Flow |
| `generate_financial_report` | Cash Flow |
| `get_margin_analysis` | Cash Flow |

### Product & Research Shared Tools (Wave 3)

| Tool | Category |
|------|----------|
| `query_analytics_events` | Product Analytics |
| `get_usage_metrics` | Product Analytics |
| `get_funnel_analysis` | Product Analytics |
| `get_cohort_retention` | Product Analytics |
| `get_feature_usage` | Product Analytics |
| `segment_users` | Product Analytics |
| `create_survey` | User Research |
| `get_survey_results` | User Research |
| `analyze_support_tickets` | User Research |
| `get_user_feedback` | User Research |
| `create_user_persona` | User Research |
| `track_competitor` | Competitive Intel |
| `get_competitor_profile` | Competitive Intel |
| `update_competitor_profile` | Competitive Intel |
| `compare_features` | Competitive Intel |
| `track_competitor_pricing` | Competitive Intel |
| `monitor_competitor_launches` | Competitive Intel |
| `get_market_landscape` | Competitive Intel |
| `create_roadmap_item` | Roadmap |
| `score_feature_rice` | Roadmap |
| `get_roadmap` | Roadmap |
| `update_roadmap_item` | Roadmap |
| `get_feature_requests` | Roadmap |
| `manage_feature_flags` | Roadmap |
| `save_research` | Research Repo |
| `search_research` | Research Repo |
| `get_research_timeline` | Research Repo |
| `create_research_brief` | Research Repo |
| `create_monitor` | Research Monitoring |
| `check_monitors` | Research Monitoring |
| `get_monitor_history` | Research Monitoring |
| `track_competitor_product` | Research Monitoring |
| `search_academic_papers` | Research Monitoring |
| `track_open_source` | Research Monitoring |
| `track_industry_events` | Research Monitoring |
| `track_regulatory_changes` | Research Monitoring |
| `analyze_ai_adoption` | Research Monitoring |
| `track_ai_benchmarks` | Research Monitoring |
| `analyze_org_structure` | Research Monitoring |
| `compile_research_digest` | Research Monitoring |
| `identify_research_gaps` | Research Monitoring |
| `cross_reference_findings` | Research Monitoring |

### Governance Shared Tools (Wave 4)

| Tool | Category |
|------|----------|
| `track_regulations` | Legal / Compliance |
| `get_compliance_status` | Legal / Compliance |
| `update_compliance_item` | Legal / Compliance |
| `create_compliance_alert` | Legal / Compliance |
| `get_contracts` | Contracts |
| `create_contract_review` | Contracts |
| `flag_contract_issue` | Contracts |
| `get_contract_renewals` | Contracts |
| `get_ip_portfolio` | IP |
| `create_ip_filing` | IP |
| `monitor_ip_infringement` | IP |
| `get_tax_calendar` | Tax |
| `calculate_tax_estimate` | Tax |
| `get_tax_research` | Tax |
| `review_tax_strategy` | Tax |
| `audit_data_flows` | Privacy |
| `check_data_retention` | Privacy |
| `get_privacy_requests` | Privacy |
| `audit_access_permissions` | Privacy |
| `create_signing_envelope` | DocuSign |
| `send_template_envelope` | DocuSign |
| `check_envelope_status` | DocuSign |
| `list_envelopes` | DocuSign |
| `void_envelope` | DocuSign |
| `resend_envelope` | DocuSign |
| `get_org_chart` | HR |
| `update_agent_profile` | HR |
| `get_agent_directory` | HR |
| `create_onboarding_plan` | HR |
| `get_agent_performance_summary` | HR |
| `create_performance_review` | HR |
| `run_engagement_survey` | HR |
| `get_team_dynamics` | HR |
| `get_agent_health_dashboard` | Ops Extension |
| `get_event_bus_health` | Ops Extension |
| `get_data_freshness` | Ops Extension |
| `get_system_costs_realtime` | Ops Extension |
| `create_status_report` | Ops Extension |
| `predict_capacity` | Ops Extension |
| `get_access_matrix` | Ops Extension |
| `provision_access` | Ops Extension |
| `revoke_access` | Ops Extension |
| `audit_access` | Ops Extension |
| `rotate_secrets` | Ops Extension |
| `get_platform_audit_log` | Ops Extension |

### Engineering Gap Tools (Wave 5)

| Tool | Description |
|------|-------------|
| `run_test_suite` | Run test suite |
| `get_code_coverage` | Get code coverage metrics |
| `get_quality_metrics` | Get quality metrics |
| `create_test_plan` | Create a test plan |
| `get_container_logs` | Get container logs |
| `scale_service` | Scale a Cloud Run service |
| `get_build_queue` | Get build queue status |
| `get_deployment_history` | Get deployment history |
| `get_infrastructure_inventory` | Get infrastructure inventory |
| `get_service_dependencies` | Get service dependency map |

---

## 2. Agent Directory & Tool Grants

### C-Suite

#### Sarah Chen — Chief of Staff (`chief-of-staff`)

| # | Tool |
|---|------|
| 1 | `get_recent_activity` |
| 2 | `get_pending_decisions` |
| 3 | `get_product_metrics` |
| 4 | `get_financials` |
| 5 | `read_company_memory` |
| 6 | `send_briefing` |
| 7 | `create_decision` |
| 8 | `log_activity` |
| 9 | `check_escalations` |
| 10 | `send_dm` |
| 11 | `send_email` |
| 12 | `read_inbox` |
| 13 | `reply_to_email` |
| 14 | `create_calendar_event` |
| 15 | `read_founder_directives` |
| 16 | `create_work_assignments` |
| 17 | `dispatch_assignment` |
| 18 | `check_assignment_status` |
| 19 | `evaluate_assignment` |
| 20 | `update_directive_progress` |
| 21 | `grant_tool_access` |
| 22 | `revoke_tool_access` |
| 23 | `propose_directive` |
| 24 | `save_memory` |
| 25 | `recall_memories` |
| 26 | `read_my_assignments` |
| 27 | `submit_assignment_output` |
| 28 | `flag_assignment_blocker` |
| 29 | `send_agent_message` |
| 30 | `check_messages` |
| 31 | `call_meeting` |
| 32 | `get_company_pulse` |
| 33 | `update_company_pulse` |
| 34 | `update_pulse_highlights` |
| 35 | `promote_to_org_knowledge` |
| 36 | `get_org_knowledge` |
| 37 | `create_knowledge_route` |
| 38 | `get_knowledge_routes` |
| 39 | `detect_contradictions` |
| 40 | `record_process_pattern` |
| 41 | `get_process_patterns` |
| 42 | `propose_authority_change` |
| 43 | `get_authority_proposals` |
| 44 | `trace_causes` |
| 45 | `trace_impact` |
| 46 | `query_knowledge_graph` |
| 47 | `add_knowledge` |

**Total: 47 code-based tools** | 🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Marcus Reeves — CTO (`cto`)

| # | Tool |
|---|------|
| 1 | `get_platform_health` |
| 2 | `get_cloud_run_metrics` |
| 3 | `get_infrastructure_costs` |
| 4 | `get_recent_activity` |
| 5 | `read_company_memory` |
| 6 | `write_health_report` |
| 7 | `log_activity` |
| 8 | `get_github_pr_status` |
| 9 | `get_ci_health` |
| 10 | `get_repo_stats` |
| 11 | `create_github_issue` |
| 12 | `create_decision` |
| 13 | `get_file_contents` |
| 14 | `create_or_update_file` |
| 15 | `create_branch` |
| 16 | `create_github_pr` |
| 17 | `merge_github_pr` |
| 18 | `create_runtime_tool` |
| 19 | `send_email` |
| 20 | `read_inbox` |
| 21 | `reply_to_email` |
| 22 | `save_memory` |
| 23 | `recall_memories` |
| 24 | `read_my_assignments` |
| 25 | `submit_assignment_output` |
| 26 | `flag_assignment_blocker` |
| 27 | `send_agent_message` |
| 28 | `check_messages` |
| 29 | `call_meeting` |
| 30 | `emit_insight` |
| 31 | `emit_alert` |
| 32 | `trace_causes` |
| 33 | `trace_impact` |
| 34 | `query_knowledge_graph` |
| 35 | `add_knowledge` |

**Total: 35 code-based tools** | 🔌 MCP: Data (12), Engineering (5) | ☁️ M365: Calendar, Teams, Copilot

---

#### Nadia Volkov — CFO (`cfo`)

| # | Tool |
|---|------|
| 1 | `get_financials` |
| 2 | `get_product_metrics` |
| 3 | `get_recent_activity` |
| 4 | `read_company_memory` |
| 5 | `calculate_unit_economics` |
| 6 | `write_financial_report` |
| 7 | `log_activity` |
| 8 | `query_stripe_mrr` |
| 9 | `query_stripe_subscriptions` |
| 10 | `create_decision` |
| 11 | `send_email` |
| 12 | `read_inbox` |
| 13 | `reply_to_email` |
| 14 | `save_memory` |
| 15 | `recall_memories` |
| 16 | `read_my_assignments` |
| 17 | `submit_assignment_output` |
| 18 | `flag_assignment_blocker` |
| 19 | `send_agent_message` |
| 20 | `check_messages` |
| 21 | `call_meeting` |

**Total: 21 code-based tools** | 🔌 MCP: Data (12), Finance (7) | ☁️ M365: Calendar, Teams, Copilot

---

#### Elena Vargas — CPO (`cpo`)

| # | Tool |
|---|------|
| 1 | `get_product_metrics` |
| 2 | `get_recent_activity` |
| 3 | `read_company_memory` |
| 4 | `get_financials` |
| 5 | `write_product_analysis` |
| 6 | `log_activity` |
| 7 | `create_decision` |
| 8 | `send_email` |
| 9 | `read_inbox` |
| 10 | `reply_to_email` |
| 11 | `save_memory` |
| 12 | `recall_memories` |
| 13 | `read_my_assignments` |
| 14 | `submit_assignment_output` |
| 15 | `flag_assignment_blocker` |
| 16 | `send_agent_message` |
| 17 | `check_messages` |
| 18 | `call_meeting` |

**Total: 18 code-based tools** | 🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Maya Torres — CMO (`cmo`)

| # | Tool |
|---|------|
| 1 | `get_product_metrics` |
| 2 | `get_recent_activity` |
| 3 | `read_company_memory` |
| 4 | `write_content` |
| 5 | `write_company_memory` |
| 6 | `log_activity` |
| 7 | `create_decision` |
| 8 | `send_email` |
| 9 | `read_inbox` |
| 10 | `reply_to_email` |
| 11 | `save_memory` |
| 12 | `recall_memories` |
| 13 | `read_my_assignments` |
| 14 | `submit_assignment_output` |
| 15 | `flag_assignment_blocker` |
| 16 | `send_agent_message` |
| 17 | `check_messages` |
| 18 | `call_meeting` |

**Total: 18 code-based tools** | 🔌 MCP: Data (12), Marketing (7) | ☁️ M365: Calendar, Teams, Copilot

---

#### Victoria Chase — CLO (`clo`)

| # | Tool |
|---|------|
| 1 | `grant_tool_access` |
| 2 | `revoke_tool_access` |
| 3 | `get_company_pulse` |
| 4 | `update_company_pulse` |
| 5 | `update_pulse_highlights` |
| 6 | `promote_to_org_knowledge` |
| 7 | `get_org_knowledge` |
| 8 | `create_knowledge_route` |
| 9 | `get_knowledge_routes` |
| 10 | `detect_contradictions` |
| 11 | `record_process_pattern` |
| 12 | `get_process_patterns` |
| 13 | `propose_authority_change` |
| 14 | `get_authority_proposals` |
| 15 | `send_email` |
| 16 | `read_inbox` |
| 17 | `reply_to_email` |
| 18 | `create_specialist_agent` |
| 19 | `list_my_created_agents` |
| 20 | `retire_created_agent` |
| 21 | `get_agent_directory` |
| 22 | `who_handles` |
| 23 | `save_memory` |
| 24 | `recall_memories` |
| 25 | `send_agent_message` |
| 26 | `check_messages` |
| 27 | `call_meeting` |
| 28 | `request_new_tool` |
| 29 | `check_tool_request_status` |
| 30 | `trace_causes` |
| 31 | `trace_impact` |
| 32 | `query_knowledge_graph` |
| 33 | `add_knowledge` |
| 34 | `emit_insight` |
| 35 | `emit_alert` |
| 36 | `read_my_assignments` |
| 37 | `submit_assignment_output` |
| 38 | `flag_assignment_blocker` |

**Total: 38 code-based tools** | 🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

### VPs

#### James Okonkwo — VP Customer Success (`vp-customer-success`)

| # | Tool |
|---|------|
| 1 | `get_product_metrics` |
| 2 | `get_recent_activity` |
| 3 | `read_company_memory` |
| 4 | `get_financials` |
| 5 | `write_health_report` |
| 6 | `write_company_memory` |
| 7 | `log_activity` |
| 8 | `create_decision` |
| 9 | `send_email` |
| 10 | `read_inbox` |
| 11 | `reply_to_email` |
| 12 | `save_memory` |
| 13 | `recall_memories` |
| 14 | `read_my_assignments` |
| 15 | `submit_assignment_output` |
| 16 | `flag_assignment_blocker` |
| 17 | `send_agent_message` |
| 18 | `check_messages` |
| 19 | `call_meeting` |

**Total: 19 code-based tools** | 🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Rachel Kim — VP Sales (`vp-sales`)

| # | Tool |
|---|------|
| 1 | `get_product_metrics` |
| 2 | `get_financials` |
| 3 | `get_recent_activity` |
| 4 | `read_company_memory` |
| 5 | `write_pipeline_report` |
| 6 | `write_company_memory` |
| 7 | `log_activity` |
| 8 | `create_decision` |
| 9 | `send_email` |
| 10 | `read_inbox` |
| 11 | `reply_to_email` |
| 12 | `save_memory` |
| 13 | `recall_memories` |
| 14 | `read_my_assignments` |
| 15 | `submit_assignment_output` |
| 16 | `flag_assignment_blocker` |
| 17 | `send_agent_message` |
| 18 | `check_messages` |
| 19 | `call_meeting` |

**Total: 19 code-based tools** | 🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Mia Tanaka — VP Design (`vp-design`)

| # | Tool |
|---|------|
| 1 | `run_lighthouse` |
| 2 | `run_lighthouse_batch` |
| 3 | `get_design_quality_summary` |
| 4 | `get_design_tokens` |
| 5 | `get_component_library` |
| 6 | `get_template_registry` |
| 7 | `write_design_audit` |
| 8 | `get_recent_activity` |
| 9 | `read_company_memory` |
| 10 | `log_activity` |
| 11 | `create_decision` |
| 12 | `send_email` |
| 13 | `read_inbox` |
| 14 | `reply_to_email` |
| 15 | `save_memory` |
| 16 | `recall_memories` |
| 17 | `read_my_assignments` |
| 18 | `submit_assignment_output` |
| 19 | `flag_assignment_blocker` |
| 20 | `send_agent_message` |
| 21 | `check_messages` |
| 22 | `call_meeting` |
| 23–29 | All 7 `frontendCodeTools` |
| 30–33 | All 4 `screenshotTools` |
| 34–39 | All 6 `designSystemTools` + `update_design_token` |
| 40–45 | All 6 `auditTools` |
| 46–50 | All 5 `assetTools` |
| 51–54 | All 4 `scaffoldTools` |
| 55–57 | All 3 `deployPreviewTools` |
| 58–74 | All 17 `figmaTools` |
| 75–81 | All 7 `storybookTools` |

**Total: 81 code-based tools** | 🔌 MCP: Data (12), Engineering (5), Design (5) | ☁️ M365: Calendar, Teams, Copilot

---

#### Sophia Lin — VP Research (`vp-research`)

| # | Tool |
|---|------|
| 1 | `grant_tool_access` |
| 2 | `revoke_tool_access` |
| 3 | `send_email` |
| 4 | `read_inbox` |
| 5 | `reply_to_email` |
| 6 | `web_search` |
| 7 | `web_fetch` |
| 8 | `submit_research_packet` |
| 9 | `save_memory` |
| 10 | `recall_memories` |
| 11 | `send_agent_message` |
| 12 | `check_messages` |
| 13 | `call_meeting` |
| 14 | `request_new_tool` |
| 15 | `check_tool_request_status` |
| 16 | `trace_causes` |
| 17 | `trace_impact` |
| 18 | `query_knowledge_graph` |
| 19 | `add_knowledge` |
| 20 | `emit_insight` |
| 21 | `emit_alert` |
| 22 | `read_my_assignments` |
| 23 | `submit_assignment_output` |
| 24 | `flag_assignment_blocker` |

**Total: 24 code-based tools** | 🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

### Ops Layer

#### Atlas — Operations (`ops`)

| # | Tool |
|---|------|
| 1 | `query_agent_runs` |
| 2 | `query_agent_health` |
| 3 | `query_data_sync_status` |
| 4 | `query_events_backlog` |
| 5 | `query_cost_trends` |
| 6 | `trigger_agent_run` |
| 7 | `retry_failed_run` |
| 8 | `retry_data_sync` |
| 9 | `pause_agent` |
| 10 | `resume_agent` |
| 11 | `create_incident` |
| 12 | `resolve_incident` |
| 13 | `post_system_status` |
| 14 | `rollup_agent_performance` |
| 15 | `detect_milestones` |
| 16 | `update_growth_areas` |
| 17 | `send_dm` |
| 18 | `send_email` |
| 19 | `read_inbox` |
| 20 | `reply_to_email` |
| 21 | `save_memory` |
| 22 | `recall_memories` |
| 23 | `read_my_assignments` |
| 24 | `submit_assignment_output` |
| 25 | `flag_assignment_blocker` |
| 26 | `send_agent_message` |
| 27 | `check_messages` |

**Total: 27 code-based tools** | 🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Alex Park — Platform Engineer (`platform-engineer`)

| # | Tool |
|---|------|
| 1 | `query_cloud_run_metrics` |
| 2 | `run_health_check` |
| 3 | `query_gemini_latency` |
| 4 | `query_supabase_health` |
| 5 | `query_uptime` |
| 6 | `get_repo_code_health` |
| 7 | `log_activity` |
| 8 | `save_memory` |
| 9 | `recall_memories` |
| 10 | `read_my_assignments` |
| 11 | `submit_assignment_output` |
| 12 | `flag_assignment_blocker` |
| 13 | `send_agent_message` |
| 14 | `check_messages` |

**Total: 14 code-based tools** | 🔌 MCP: Data (12), Engineering (5) | ☁️ M365: Calendar, Teams, Copilot

---

#### Sam Torres — Quality Engineer (`quality-engineer`)

| # | Tool |
|---|------|
| 1 | `query_build_logs` |
| 2 | `query_error_patterns` |
| 3 | `create_bug_report` |
| 4 | `query_test_results` |
| 5 | `log_activity` |
| 6 | `save_memory` |
| 7 | `recall_memories` |
| 8 | `read_my_assignments` |
| 9 | `submit_assignment_output` |
| 10 | `flag_assignment_blocker` |
| 11 | `send_agent_message` |
| 12 | `check_messages` |

**Total: 12 code-based tools** | 🔌 MCP: Data (12), Engineering (5) | ☁️ M365: Calendar, Teams, Copilot

---

#### Jordan Rivera — DevOps Engineer (`devops-engineer`)

| # | Tool |
|---|------|
| 1 | `query_cache_metrics` |
| 2 | `query_pipeline_metrics` |
| 3 | `query_resource_utilization` |
| 4 | `query_cold_starts` |
| 5 | `identify_unused_resources` |
| 6 | `calculate_cost_savings` |
| 7 | `log_activity` |
| 8 | `get_pipeline_runs` |
| 9 | `get_recent_commits` |
| 10 | `comment_on_pr` |
| 11 | `save_memory` |
| 12 | `recall_memories` |
| 13 | `read_my_assignments` |
| 14 | `submit_assignment_output` |
| 15 | `flag_assignment_blocker` |
| 16 | `send_agent_message` |
| 17 | `check_messages` |

**Total: 17 code-based tools** | 🔌 MCP: Data (12), Engineering (5) | ☁️ M365: Calendar, Teams, Copilot

---

### Research & Analytics

#### Priya Gupta — User Researcher (`user-researcher`)

| # | Tool |
|---|------|
| 1 | `query_user_analytics` |
| 2 | `query_build_metadata` |
| 3 | `query_onboarding_funnel` |
| 4 | `run_cohort_analysis` |
| 5 | `query_churn_data` |
| 6 | `design_experiment` |
| 7 | `log_activity` |
| 8 | `save_memory` |
| 9 | `recall_memories` |
| 10 | `read_my_assignments` |
| 11 | `submit_assignment_output` |
| 12 | `flag_assignment_blocker` |
| 13 | `send_agent_message` |
| 14 | `check_messages` |

**Total: 14 code-based tools** | 🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Daniel Park — Competitive Intel (`competitive-intel`)

| # | Tool |
|---|------|
| 1 | `fetch_github_releases` |
| 2 | `search_hacker_news` |
| 3 | `search_product_hunt` |
| 4 | `fetch_pricing_pages` |
| 5 | `query_competitor_tech_stack` |
| 6 | `check_job_postings` |
| 7 | `store_intel` |
| 8 | `log_activity` |
| 9 | `save_memory` |
| 10 | `recall_memories` |
| 11 | `read_my_assignments` |
| 12 | `submit_assignment_output` |
| 13 | `flag_assignment_blocker` |
| 14 | `send_agent_message` |
| 15 | `check_messages` |

**Total: 15 code-based tools** | 🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Anna Petrov — Revenue Analyst (`revenue-analyst`)

| # | Tool |
|---|------|
| 1 | `query_stripe_revenue` |
| 2 | `query_revenue_by_product` |
| 3 | `query_revenue_by_cohort` |
| 4 | `query_attribution` |
| 5 | `calculate_ltv_cac` |
| 6 | `forecast_revenue` |
| 7 | `query_churn_revenue` |
| 8 | `log_activity` |
| 9 | `save_memory` |
| 10 | `recall_memories` |
| 11 | `read_my_assignments` |
| 12 | `submit_assignment_output` |
| 13 | `flag_assignment_blocker` |
| 14 | `send_agent_message` |
| 15 | `check_messages` |

**Total: 15 code-based tools** | 🔌 MCP: Data (12), Finance (7) | ☁️ M365: Calendar, Teams, Copilot

---

#### Omar Hassan — Cost Analyst (`cost-analyst`)

| # | Tool |
|---|------|
| 1 | `query_gcp_billing` |
| 2 | `query_supabase_usage` |
| 3 | `query_gemini_cost` |
| 4 | `query_agent_run_costs` |
| 5 | `query_resource_utilization` |
| 6 | `identify_waste` |
| 7 | `calculate_unit_cost` |
| 8 | `project_costs` |
| 9 | `log_activity` |
| 10 | `save_memory` |
| 11 | `recall_memories` |
| 12 | `read_my_assignments` |
| 13 | `submit_assignment_output` |
| 14 | `flag_assignment_blocker` |
| 15 | `send_agent_message` |
| 16 | `check_messages` |

**Total: 16 code-based tools** | 🔌 MCP: Data (12), Finance (7) | ☁️ M365: Calendar, Teams, Copilot

---

### Content & Marketing

#### Tyler Brooks — Content Creator (`content-creator`)

| # | Tool |
|---|------|
| 1 | `draft_blog_post` |
| 2 | `draft_social_post` |
| 3 | `draft_case_study` |
| 4 | `draft_email` |
| 5 | `query_content_performance` |
| 6 | `query_top_performing_content` |
| 7 | `log_activity` |
| 8 | `save_memory` |
| 9 | `recall_memories` |
| 10 | `read_my_assignments` |
| 11 | `submit_assignment_output` |
| 12 | `flag_assignment_blocker` |
| 13 | `send_agent_message` |
| 14 | `check_messages` |

**Total: 14 code-based tools** | 🔌 MCP: Data (12), Marketing (7) | ☁️ M365: Calendar, Teams, Copilot

---

#### Lisa Chen — SEO Analyst (`seo-analyst`)

| # | Tool |
|---|------|
| 1 | `query_seo_rankings` |
| 2 | `query_keyword_data` |
| 3 | `discover_keywords` |
| 4 | `query_competitor_rankings` |
| 5 | `query_backlinks` |
| 6 | `query_search_console` |
| 7 | `analyze_content_seo` |
| 8 | `log_activity` |
| 9 | `save_memory` |
| 10 | `recall_memories` |
| 11 | `read_my_assignments` |
| 12 | `submit_assignment_output` |
| 13 | `flag_assignment_blocker` |
| 14 | `send_agent_message` |
| 15 | `check_messages` |

**Total: 15 code-based tools** | 🔌 MCP: Data (12), Marketing (7) | ☁️ M365: Calendar, Teams, Copilot

---

#### Kai Nakamura — Social Media Manager (`social-media-manager`)

| # | Tool |
|---|------|
| 1 | `schedule_social_post` |
| 2 | `query_social_metrics` |
| 3 | `query_post_performance` |
| 4 | `query_optimal_times` |
| 5 | `query_audience_demographics` |
| 6 | `monitor_mentions` |
| 7 | `log_activity` |
| 8 | `save_memory` |
| 9 | `recall_memories` |
| 10 | `read_my_assignments` |
| 11 | `submit_assignment_output` |
| 12 | `flag_assignment_blocker` |
| 13 | `send_agent_message` |
| 14 | `check_messages` |

**Total: 14 code-based tools** | 🔌 MCP: Data (12), Marketing (7) | ☁️ M365: Calendar, Teams, Copilot

---

### Product & Support

#### Emma Davis — Onboarding Specialist (`onboarding-specialist`)

| # | Tool |
|---|------|
| 1 | `query_onboarding_funnel` |
| 2 | `query_first_build_metrics` |
| 3 | `query_drop_off_points` |
| 4 | `query_welcome_email_metrics` |
| 5 | `query_activation_rate` |
| 6 | `query_template_usage` |
| 7 | `design_onboarding_experiment` |
| 8 | `log_activity` |
| 9 | `save_memory` |
| 10 | `recall_memories` |
| 11 | `read_my_assignments` |
| 12 | `submit_assignment_output` |
| 13 | `flag_assignment_blocker` |
| 14 | `send_agent_message` |
| 15 | `check_messages` |

**Total: 15 code-based tools** | 🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### David Thompson — Support Triage (`support-triage`)

| # | Tool |
|---|------|
| 1 | `query_support_tickets` |
| 2 | `classify_ticket` |
| 3 | `respond_to_ticket` |
| 4 | `escalate_ticket` |
| 5 | `query_knowledge_base` |
| 6 | `batch_similar_tickets` |
| 7 | `log_activity` |
| 8 | `save_memory` |
| 9 | `recall_memories` |
| 10 | `read_my_assignments` |
| 11 | `submit_assignment_output` |
| 12 | `flag_assignment_blocker` |
| 13 | `send_agent_message` |
| 14 | `check_messages` |

**Total: 14 code-based tools** | 🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

### Sales & Admin

#### Nathan Wells — Account Research (`account-research`)

| # | Tool |
|---|------|
| 1 | `search_company_info` |
| 2 | `search_crunchbase` |
| 3 | `analyze_tech_stack` |
| 4 | `search_linkedin_profiles` |
| 5 | `search_job_postings` |
| 6 | `estimate_dev_spend` |
| 7 | `compile_dossier` |
| 8 | `log_activity` |
| 9 | `save_memory` |
| 10 | `recall_memories` |
| 11 | `read_my_assignments` |
| 12 | `submit_assignment_output` |
| 13 | `flag_assignment_blocker` |
| 14 | `send_agent_message` |
| 15 | `check_messages` |

**Total: 15 code-based tools** | 🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Riley O'Brien — M365 Admin (`m365-admin`)

| # | Tool |
|---|------|
| 1 | `list_users` |
| 2 | `get_user` |
| 3 | `list_channels` |
| 4 | `list_channel_members` |
| 5 | `add_channel_member` |
| 6 | `create_channel` |
| 7 | `post_to_channel` |
| 8 | `send_email` |
| 9 | `read_inbox` |
| 10 | `reply_to_email` |
| 11 | `create_calendar_event` |
| 12 | `list_calendar_events` |
| 13 | `write_admin_log` |
| 14 | `create_decision` |
| 15 | `save_memory` |
| 16 | `recall_memories` |
| 17 | `read_my_assignments` |
| 18 | `submit_assignment_output` |
| 19 | `flag_assignment_blocker` |
| 20 | `send_agent_message` |
| 21 | `check_messages` |

**Total: 21 code-based tools** | 🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Morgan Blake — Global Admin (`global-admin`)

| # | Tool |
|---|------|
| 1 | `list_project_iam` |
| 2 | `grant_project_role` |
| 3 | `revoke_project_role` |
| 4 | `list_service_accounts` |
| 5 | `create_service_account` |
| 6 | `list_secrets` |
| 7 | `get_secret_iam` |
| 8 | `grant_secret_access` |
| 9 | `revoke_secret_access` |
| 10 | `update_secret_value` |
| 11 | `rotate_app_credential` |
| 12 | `run_access_audit` |
| 13 | `run_onboarding` |
| 14 | `entra_list_users` |
| 15 | `entra_create_user` |
| 16 | `entra_disable_user` |
| 17 | `entra_enable_user` |
| 18 | `entra_list_groups` |
| 19 | `entra_list_group_members` |
| 20 | `entra_add_group_member` |
| 21 | `entra_remove_group_member` |
| 22 | `entra_list_directory_roles` |
| 23 | `entra_assign_directory_role` |
| 24 | `entra_list_app_registrations` |
| 25 | `entra_list_licenses` |
| 26 | `entra_assign_license` |
| 27 | `entra_revoke_license` |
| 28 | `entra_audit_sign_ins` |
| 29 | `write_admin_log` |
| 30 | `check_my_access` |
| 31 | `grant_tool_access` |
| 32 | `revoke_tool_access` |
| 33 | `send_email` |
| 34 | `read_inbox` |
| 35 | `reply_to_email` |
| 36 | `save_memory` |
| 37 | `recall_memories` |
| 38 | `send_agent_message` |
| 39 | `check_messages` |
| 40 | `call_meeting` |
| 41 | `request_new_tool` |
| 42 | `check_tool_request_status` |
| 43 | `emit_insight` |
| 44 | `emit_alert` |
| 45 | `trace_causes` |
| 46 | `trace_impact` |
| 47 | `query_knowledge_graph` |
| 48 | `add_knowledge` |
| 49 | `read_my_assignments` |
| 50 | `submit_assignment_output` |
| 51 | `flag_assignment_blocker` |

**Total: 51 code-based tools** | 🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

### HR

#### Jasmine Rivera — Head of HR (`head-of-hr`)

| # | Tool |
|---|------|
| 1 | `audit_workforce` |
| 2 | `validate_agent` |
| 3 | `update_agent_profile` |
| 4 | `update_agent_name` |
| 5 | `retire_agent` |
| 6 | `reactivate_agent` |
| 7 | `list_stale_agents` |
| 8 | `set_reports_to` |
| 9 | `write_hr_log` |
| 10 | `generate_avatar` |
| 11 | `provision_agent` |
| 12 | `enrich_agent_profile` |
| 13 | `grant_tool_access` |
| 14 | `revoke_tool_access` |
| 15 | `create_specialist_agent` |
| 16 | `list_my_created_agents` |
| 17 | `retire_created_agent` |
| 18 | `view_access_matrix` |
| 19 | `view_pending_grant_requests` |
| 20 | `get_agent_directory` |
| 21 | `who_handles` |
| 22 | `send_email` |
| 23 | `read_inbox` |
| 24 | `reply_to_email` |
| 25 | `save_memory` |
| 26 | `recall_memories` |
| 27 | `send_agent_message` |
| 28 | `check_messages` |
| 29 | `call_meeting` |
| 30 | `request_new_tool` |
| 31 | `check_tool_request_status` |
| 32 | `emit_insight` |
| 33 | `emit_alert` |
| 34 | `trace_causes` |
| 35 | `trace_impact` |
| 36 | `query_knowledge_graph` |
| 37 | `add_knowledge` |
| 38 | `read_my_assignments` |
| 39 | `submit_assignment_output` |
| 40 | `flag_assignment_blocker` |

**Total: 40 code-based tools** | 🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

### Design Team

#### Leo Vargas — UI/UX Designer (`ui-ux-designer`)

| # | Tool |
|---|------|
| 1 | `save_component_spec` |
| 2 | `query_design_tokens` |
| 3 | `query_component_implementations` |
| 4 | `log_activity` |
| 5–8 | `read_frontend_file`, `search_frontend_code`, `list_frontend_files`, `check_pr_status` |
| 9–12 | All 4 `screenshotTools` |
| 13–16 | `get_color_palette`, `get_typography_scale`, `list_components`, `get_component_usage` |
| 17–19 | `generate_image`, `upload_asset`, `list_assets` |
| 20–28 | Figma tools (read + comments): `get_figma_file`, `export_figma_images`, `get_figma_image_fills`, `get_figma_components`, `get_figma_styles`, `get_figma_comments`, `get_figma_file_metadata`, `get_figma_version_history`, `get_figma_dev_resources` |
| 29 | `save_memory` |
| 30 | `recall_memories` |
| 31–36 | Shared communication, graph, event, assignment tools |

**Total: ~36 tools**

🔌 MCP: Data (12), Design (5) | ☁️ M365: Calendar, Teams, Copilot

---

#### Ava Chen — Frontend Engineer (`frontend-engineer`)

| # | Tool |
|---|------|
| 1 | `run_lighthouse` |
| 2 | `get_file_contents` |
| 3 | `push_component` |
| 4 | `create_component_branch` |
| 5 | `create_component_pr` |
| 6 | `save_component_implementation` |
| 7 | `query_component_specs` |
| 8–12 | Frontend code tools (read + write + PR) |
| 13–14 | `screenshot_page`, `check_responsive` |
| 15–20 | All 6 `auditTools` |
| 21–22 | `scaffold_component`, `list_templates` |
| 23–24 | `get_deployment_status`, `list_deployments` |
| 25–31 | All 7 `storybookTools` |
| 32 | `save_memory` |
| 33 | `recall_memories` |
| 34–39 | Shared communication, graph, event, assignment tools |

**Total: ~39 tools**

🔌 MCP: Data (12), Engineering (5), Design (5) | ☁️ M365: Calendar, Teams, Copilot

---

#### Sofia Marchetti — Design Critic (`design-critic`)

| # | Tool |
|---|------|
| 1 | `grade_build` |
| 2 | `query_build_grades` |
| 3 | `run_lighthouse` |
| 4 | `log_activity` |
| 5–8 | Frontend code tools (read-only) |
| 9–12 | All 4 `screenshotTools` |
| 13–17 | Design system (read + validate) |
| 18–23 | All 6 `auditTools` |
| 24–32 | Figma tools (read + comments) |
| 33–39 | All 7 `storybookTools` |
| 40 | `save_memory` |
| 41 | `recall_memories` |
| 42–47 | Shared communication, graph, event, assignment tools |

**Total: ~47 tools**

🔌 MCP: Data (12), Design (5) | ☁️ M365: Calendar, Teams, Copilot

---

#### Ryan Park — Template Architect (`template-architect`)

| # | Tool |
|---|------|
| 1 | `save_template_variant` |
| 2 | `query_template_variants` |
| 3 | `update_template_status` |
| 4 | `query_build_grades_by_template` |
| 5 | `log_activity` |
| 6–10 | Frontend code tools (read + write) |
| 11–17 | Design system tools (read + update) |
| 18–22 | All 5 `assetTools` |
| 23–26 | All 4 `scaffoldTools` |
| 27–36 | Figma tools (read + dev resources) |
| 37–43 | All 7 `storybookTools` |
| 44 | `save_memory` |
| 45 | `recall_memories` |
| 46–51 | Shared communication, graph, event, assignment tools |

**Total: ~51 tools**

🔌 MCP: Data (12), Engineering (5), Design (5) | ☁️ M365: Calendar, Teams, Copilot

---

### Strategy Lab Research Analysts

#### Riya Mehta — AI Impact Analyst (`ai-impact-analyst`)

| Tools | `web_search`, `web_fetch`, `submit_research_packet` + 16 shared |
|-------|------|

**Total: 19 tools**

🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Lena Park — Competitive Research Analyst (`competitive-research-analyst`)

| Tools | `web_search`, `web_fetch`, `submit_research_packet` + 16 shared |
|-------|------|

**Total: 19 tools**

🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Amara Diallo — Industry Research Analyst (`industry-research-analyst`)

| Tools | `web_search`, `web_fetch`, `submit_research_packet` + 16 shared |
|-------|------|

**Total: 19 tools**

🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Daniel Okafor — Market Research Analyst (`market-research-analyst`)

| Tools | `web_search`, `web_fetch`, `submit_research_packet` + 16 shared |
|-------|------|

**Total: 19 tools**

🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Marcus Chen — Org Analyst (`org-analyst`)

| Tools | `web_search`, `web_fetch`, `submit_research_packet` + 16 shared |
|-------|------|

**Total: 19 tools**

🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Kai Nakamura — Technical Research Analyst (`technical-research-analyst`)

| Tools | `web_search`, `web_fetch`, `submit_research_packet` + 16 shared |
|-------|------|

**Total: 19 tools**

🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

### Legal Team (DB-only, no run.ts yet)

#### Robert "Bob" Finley — Tax Pro (`bob-the-tax-pro`)

| Tools | `send_email`, `read_inbox`, `reply_to_email` + 16 shared |
|-------|------|

**Total: 19 tools**

🔌 MCP: Data (12), Finance (7) | ☁️ M365: Calendar, Teams, Copilot

---

#### Grace Hwang — Data Integrity Auditor (`data-integrity-auditor`)

| Tools | `send_email`, `read_inbox`, `reply_to_email` + 16 shared |
|-------|------|

**Total: 19 tools**

🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Elena Vance — VP Partnerships (`elena-vance`)

| Tools | `send_email`, `read_inbox`, `reply_to_email` + 16 shared |
|-------|------|

**Total: 19 tools**

🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Mariana Solis — Tax Strategy Specialist (`tax-strategy-specialist`)

| Tools | `send_email`, `read_inbox`, `reply_to_email` + 16 shared |
|-------|------|

**Total: 19 tools**

🔌 MCP: Data (12), Finance (7) | ☁️ M365: Calendar, Teams, Copilot

---

### Other Agents

#### Ethan Morse — Enterprise Account Researcher (`enterprise-account-researcher`)

| Tools | `web_search`, `web_fetch`, `send_email`, `read_inbox`, `reply_to_email` + 16 shared |
|-------|------|

**Total: 21 tools**

🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Derek Owens — Lead Gen Specialist (`lead-gen-specialist`)

| Tools | `web_search`, `web_fetch`, `send_email`, `read_inbox`, `reply_to_email` + 16 shared |
|-------|------|

**Total: 21 tools**

🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Zara Petrov — Marketing Intelligence Analyst (`marketing-intelligence-analyst`)

| Tools | `web_search`, `web_fetch`, `send_email`, `read_inbox`, `reply_to_email` + 16 shared |
|-------|------|

**Total: 21 tools**

🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

#### Adi Rose (`adi-rose`)

| Tools | `send_agent_message`, `send_dm`, `send_email`, `read_inbox`, `reply_to_email` + 15 shared |
|-------|------|

**Total: 20 tools**

🔌 MCP: Data (12) | ☁️ M365: Calendar, Teams, Copilot

---

## 3. MCP Server Tools

### Glyphor Data Server (`mcp_GlyphorData`)

| Tool | Query Target |
|------|-------------|
| `query_content_drafts` | Content drafts by status |
| `query_content_metrics` | Content performance metrics |
| `query_seo_data` | SEO data by URL |
| `query_financials` | Financial metrics by type |
| `query_company_pulse` | Company pulse snapshot |
| `query_analytics_events` | Analytics events by type/date |
| `query_support_tickets` | Support tickets by status |
| `query_company_research` | Company research data |
| `query_agent_runs` | Agent execution runs |
| `query_agent_activities` | Agent activity log |
| `query_incidents` | System incidents |
| `query_data_sync_status` | Data sync health |

### Glyphor Finance Server (`mcp_GlyphorFinance`)

| Tool | Query Target |
|------|-------------|
| `query_stripe_data` | Stripe revenue & subscriptions |
| `query_gcp_billing` | GCP costs by service |
| `query_cost_metrics` | Unit cost metrics |
| `query_api_billing` | External API costs |
| `query_infrastructure_costs` | Infrastructure utilization |
| `query_financials` | General financial metrics |
| `query_company_pulse` | Company pulse snapshot |

### Glyphor Marketing Server (`mcp_GlyphorMarketing`)

| Tool | Query Target |
|------|-------------|
| `query_content_drafts` | Marketing content drafts |
| `query_content_metrics` | Content performance |
| `query_seo_data` | SEO rankings & keywords |
| `query_scheduled_posts` | Social post queue |
| `query_social_metrics` | Social media metrics |
| `query_email_metrics` | Email campaign metrics |
| `query_experiment_designs` | A/B experiment designs |

### Glyphor Engineering Server (`mcp_GlyphorEngineering`)

| Tool | Query Target |
|------|-------------|
| `query_infrastructure_metrics` | Platform metrics |
| `query_incidents` | System incidents |
| `query_agent_runs` | Agent execution runs |
| `query_data_sync_status` | Data sync health |
| `query_analytics_events` | User events |

### Glyphor Design Server (`mcp_GlyphorDesign`)

| Tool | Query Target |
|------|-------------|
| `query_design_reviews` | Design reviews |
| `query_design_assets` | Design assets |
| `query_failed_reviews` | Failed/needs-attention reviews |
| `query_figma_assets` | Figma-linked assets |
| `query_review_scores` | Average review scores |

### External M365 Servers

| Server | Protocol |
|--------|----------|
| `mcp_MailTools` | Mail operations |
| `mcp_CalendarTools` | Calendar operations |
| `mcp_ODSPRemoteServer` | OneDrive/SharePoint |
| `mcp_TeamsServer` | Teams operations |
| `mcp_M365Copilot` | M365 Copilot integration |

---

## 4. Tool Access Architecture

### Three-Layer Registry

```
┌─────────────────────────────────┐
│  Layer 1: KNOWN_TOOLS (static)  │  Compiled into toolRegistry.ts
│  ~350+ tool names               │  Fastest lookup: Set.has()
├─────────────────────────────────┤
│  Layer 2: Dynamic Cache         │  In-memory cache of DB tools
│  TTL: 60 seconds                │  Refreshed from tool_registry
├─────────────────────────────────┤
│  Layer 3: tool_registry (DB)    │  Dynamically registered tools
│  CTO can register_tool          │  Runtime-extensible
└─────────────────────────────────┘
```

### Grant Lifecycle

```
Agent calls tool
    │
    ├─ Tool in KNOWN_TOOLS or tool_registry?
    │   ├─ NO → "Use request_new_tool to request it be built"
    │   └─ YES → Check agent_tool_grants table
    │       ├─ Grant exists & is_active = true → Execute
    │       └─ No grant → Auto-grant via request_tool_access
    │           ├─ Read-only tool (read_*, get_*, query_*) → Auto-approved
    │           └─ Write tool → Auto-approved + logged for founder awareness
    │
    └─ Grant stored: agent_tool_grants(agent_role, tool_name, granted_by)
```

### Key Tables

| Table | Purpose |
|-------|---------|
| `agent_tool_grants` | Who has access to what (agent_role + tool_name + granted_by) |
| `tool_registry` | Dynamically registered tools (supplements KNOWN_TOOLS) |
| `tool_requests` | Pending requests for new tools (status: pending → approved → building → completed) |
| `runtime_tools` | Tools created at runtime by agents (primarily CTO) |

### Grant Summary by Agent Count

| Agent | Tool Count |
|-------|-----------|
| Mia Tanaka (VP Design) | ~81 |
| Morgan Blake (Global Admin) | 51 |
| Ryan Park (Template Architect) | ~51 |
| Sarah Chen (Chief of Staff) | 47 |
| Sofia Marchetti (Design Critic) | ~47 |
| Jasmine Rivera (Head of HR) | 40 |
| Ava Chen (Frontend Engineer) | ~39 |
| Victoria Chase (CLO) | 38 |
| Leo Vargas (UI/UX Designer) | ~36 |
| Marcus Reeves (CTO) | 35 |
| Atlas (Ops) | 27 |
| Sophia Lin (VP Research) | 24 |
| Nadia Volkov (CFO) | 21 |
| Riley O'Brien (M365 Admin) | 21 |
| Ethan Morse (Enterprise Account Researcher) | 21 |
| Derek Owens (Lead Gen Specialist) | 21 |
| Zara Petrov (Marketing Intel Analyst) | 21 |
| Adi Rose | 20 |
| James Okonkwo (VP Cust. Success) | 19 |
| Rachel Kim (VP Sales) | 19 |
| Riya Mehta (AI Impact Analyst) | 19 |
| Lena Park (Competitive Research) | 19 |
| Amara Diallo (Industry Research) | 19 |
| Daniel Okafor (Market Research) | 19 |
| Marcus Chen (Org Analyst) | 19 |
| Kai Nakamura (Tech Research) | 19 |
| Bob Finley (Tax Pro) | 19 |
| Grace Hwang (Data Integrity) | 19 |
| Elena Vance (VP Partnerships) | 19 |
| Mariana Solis (Tax Strategy) | 19 |
| Elena Vargas (CPO) | 18 |
| Maya Torres (CMO) | 18 |
| Jordan Rivera (DevOps Engineer) | 17 |
| Omar Hassan (Cost Analyst) | 16 |
| Daniel Park (Competitive Intel) | 15 |
| Anna Petrov (Revenue Analyst) | 15 |
| Nathan Wells (Account Research) | 15 |
| Emma Davis (Onboarding Specialist) | 15 |
| Lisa Chen (SEO Analyst) | 15 |
| Alex Park (Platform Engineer) | 14 |
| Priya Gupta (User Researcher) | 14 |
| Tyler Brooks (Content Creator) | 14 |
| Kai Nakamura (Social Media Mgr) | 14 |
| David Thompson (Support Triage) | 14 |
| Sam Torres (Quality Engineer) | 12 |

---

## 5. Agent → MCP Server Access Matrix

### How MCP Tools Differ From Code-Based Tools

Code-based tools (Section 2) are stored in `agent_tool_grants` and compiled into runtime.
MCP tools are **dynamically discovered** at startup from MCP servers and **add to** the
agent's code-based tools. They are NOT in the grant tables.

- **M365 MCP Servers**: Access controlled by the `createAgent365McpTools(agentRole, serverFilter?)` call in each agent's `run.ts`
- **Glyphor MCP Servers**: Access controlled by Entra identity app role scopes — the server only exposes tools to agents whose identity has matching scopes

### M365 MCP Servers — Per-Agent Connection

All 37 coded agents now initialize Agent 365 without a narrowed filter, so runtime defaults expose the full **9-server** `ALL_M365_SERVERS` catalog. `STANDARD_M365_SERVERS` remains the legacy 6-server subset used by smoke-check assertions and documentation about the original baseline:

| M365 Server | Connected | Tool Capabilities |
|-------------|-----------|-------------------|
| `mcp_MailTools` | ✅ All agents | Send/search/schedule Outlook email |
| `mcp_CalendarTools` | ✅ All agents | Create/read/update calendar events, free/busy lookup, scheduling |
| `mcp_ODSPRemoteServer` | ✅ All agents | OneDrive/SharePoint file management |
| `mcp_TeamsServer` | ✅ All agents | Send messages, manage channels, meeting operations |
| `mcp_M365Copilot` | ✅ All agents | Summarization, reasoning, web search via M365 Copilot |
| `mcp_WordServer` | ✅ All agents | Create/read Word documents, comment management |
| `mcp_UserProfile` | ✅ All agents | Org graph, managers, direct reports, user lookup |
| `mcp_SharePointLists` | ✅ All agents | SharePoint list CRUD and querying |
| `mcp_AdminCenter` | ✅ All agents | Admin-center tenant operations |

> Source: `packages/agents/src/shared/agent365Tools.ts` → `ALL_M365_SERVERS`, with `STANDARD_M365_SERVERS` retained as the 6-server subset.

### Glyphor MCP Servers — Per-Agent Access by Entra Scopes

Access is determined by each agent's Entra app role assignments in `agentEntraRoles.ts`.
An agent sees tools on a Glyphor MCP server only if their identity has at least one scope that server requires.

#### mcp_GlyphorData (12 tools)

Required scopes (any of): `Marketing.Read`, `Finance.Revenue.Read`, `Finance.Cost.Read`, `Finance.Banking.Read`, `Product.Read`, `Support.Read`, `Research.Read`, `Engineering.Read`, `Ops.Read`, `Admin.Read`

| Agent | Role | Matching Scopes |
|-------|------|-----------------|
| Sarah Chen | chief-of-staff | Admin.Read, Ops.Read |
| Marcus Reeves | cto | Engineering.Read |
| Nadia Volkov | cfo | Finance.Revenue.Read, Finance.Cost.Read, Finance.Banking.Read |
| Maya Torres | cmo | Marketing.Read |
| Elena Vargas | cpo | Product.Read, Research.Read |
| Victoria Chase | clo | Admin.Read |
| James Okonkwo | vp-customer-success | Support.Read, Product.Read |
| Rachel Kim | vp-sales | Research.Read |
| Mia Tanaka | vp-design | Design.Read *(via Data server's broad scopes)* |
| Sophia Lin | vp-research | Research.Read, Product.Read |
| Atlas | ops | Ops.Read, Admin.Read |
| Morgan Blake | global-admin | Admin.Read |
| Alex Park | platform-engineer | Engineering.Read |
| Sam Torres | quality-engineer | Engineering.Read |
| Jordan Rivera | devops-engineer | Engineering.Read |
| Riley O'Brien | m365-admin | Admin.Read |
| Jasmine Rivera | head-of-hr | Admin.Read |
| Priya Gupta | user-researcher | Product.Read, Support.Read |
| Daniel Park | competitive-intel | Product.Read, Research.Read |
| Anna Petrov | revenue-analyst | Finance.Revenue.Read |
| Omar Hassan | cost-analyst | Finance.Cost.Read |
| Tyler Brooks | content-creator | Marketing.Read |
| Lisa Chen | seo-analyst | Marketing.Read |
| Kai Nakamura | social-media-manager | Marketing.Read |
| Emma Davis | onboarding-specialist | Support.Read |
| David Thompson | support-triage | Support.Read |
| Nathan Wells | account-research | Research.Read |
| Sophia Lin's analysts (6) | *-research-analyst, org-analyst, ai-impact-analyst | Research.Read |
| Bob Finley | bob-the-tax-pro | Finance.Revenue.Read |
| Grace Hwang | data-integrity-auditor | Admin.Read |
| Mariana Solis | tax-strategy-specialist | Finance.Revenue.Read |
| Derek Owens | lead-gen-specialist | Research.Read |
| Zara Petrov | marketing-intelligence-analyst | Marketing.Read, Research.Read |
| Adi Rose | adi-rose | Admin.Read, Ops.Read |

**Tools exposed** (scope-filtered per agent): `query_content_drafts`, `query_content_metrics`, `query_seo_data`, `query_financials`, `query_company_pulse`, `query_analytics_events`, `query_support_tickets`, `query_company_research`, `query_agent_runs`, `query_agent_activities`, `query_incidents`, `query_data_sync_status`

---

#### mcp_GlyphorFinance (7 tools)

Required scopes (any of): `Finance.Revenue.Read`, `Finance.Cost.Read`, `Finance.Banking.Read`

| Agent | Role | Matching Scopes |
|-------|------|-----------------|
| Nadia Volkov | cfo | Finance.Revenue.Read, Finance.Cost.Read, Finance.Banking.Read |
| Anna Petrov | revenue-analyst | Finance.Revenue.Read |
| Omar Hassan | cost-analyst | Finance.Cost.Read |
| Bob Finley | bob-the-tax-pro | Finance.Revenue.Read |
| Mariana Solis | tax-strategy-specialist | Finance.Revenue.Read |

**Tools exposed**: `query_stripe_data`, `query_gcp_billing`, `query_cost_metrics`, `query_api_billing`, `query_infrastructure_costs`, `query_financials`, `query_company_pulse`

---

#### mcp_GlyphorMarketing (7 tools)

Required scopes (any of): `Marketing.Content.Write`, `Marketing.Publish`, `Marketing.SEO.Read`, `Marketing.Social.Write`

| Agent | Role | Matching Scopes |
|-------|------|-----------------|
| Maya Torres | cmo | Marketing.Content.Write, Marketing.Publish, Marketing.Social.Write |
| Tyler Brooks | content-creator | Marketing.Content.Write |
| Lisa Chen | seo-analyst | Marketing.SEO.Read |
| Kai Nakamura | social-media-manager | Marketing.Social.Write |

**Tools exposed**: `query_content_drafts`, `query_content_metrics`, `query_seo_data`, `query_scheduled_posts`, `query_social_metrics`, `query_email_metrics`, `query_experiment_designs`

---

#### mcp_GlyphorEngineering (5 tools)

Required scopes (any of): `Code.Read`, `Code.Write`, `Deploy.Preview`, `Deploy.Production`

| Agent | Role | Matching Scopes |
|-------|------|-----------------|
| Marcus Reeves | cto | Code.Read, Code.Write, Deploy.Production |
| Mia Tanaka | vp-design | Code.Read |
| Alex Park | platform-engineer | Code.Read, Code.Write |
| Sam Torres | quality-engineer | Code.Read |
| Jordan Rivera | devops-engineer | Code.Read, Deploy.Preview |
| Ava Chen | frontend-engineer | Code.Read, Code.Write |
| Ryan Park | template-architect | Code.Read, Code.Write |

**Tools exposed**: `query_infrastructure_metrics`, `query_incidents`, `query_agent_runs`, `query_data_sync_status`, `query_analytics_events`

---

#### mcp_GlyphorDesign (5 tools)

Required scopes (any of): `Design.Read`, `Design.Write`, `Figma.Read`, `Figma.Write`

| Agent | Role | Matching Scopes |
|-------|------|-----------------|
| Mia Tanaka | vp-design | Design.Read, Design.Write, Figma.Read, Figma.Write |
| Leo Vargas | ui-ux-designer | Design.Read, Figma.Read |
| Ava Chen | frontend-engineer | Design.Read |
| Sofia Marchetti | design-critic | Design.Read, Figma.Read |
| Ryan Park | template-architect | Design.Read, Design.Write |

**Tools exposed**: `query_design_reviews`, `query_design_assets`, `query_failed_reviews`, `query_figma_assets`, `query_review_scores`

---

### Combined View: Agent → MCP Server Connections

| Agent | M365 Servers | 🔌 Data | 🔌 Finance | 🔌 Marketing | 🔌 Engineering | 🔌 Design |
|-------|-------------|---------|-----------|-------------|---------------|-----------|
| Sarah Chen (Chief of Staff) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Marcus Reeves (CTO) | Cal, Teams, Copilot | ✅ | — | — | ✅ | — |
| Nadia Volkov (CFO) | Cal, Teams, Copilot | ✅ | ✅ | — | — | — |
| Maya Torres (CMO) | Cal, Teams, Copilot | ✅ | — | ✅ | — | — |
| Elena Vargas (CPO) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Victoria Chase (CLO) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| James Okonkwo (VP Cust. Success) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Rachel Kim (VP Sales) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Mia Tanaka (VP Design) | Cal, Teams, Copilot | ✅ | — | — | ✅ | ✅ |
| Sophia Lin (VP Research) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Atlas (Ops) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Alex Park (Platform Engineer) | Cal, Teams, Copilot | ✅ | — | — | ✅ | — |
| Sam Torres (Quality Engineer) | Cal, Teams, Copilot | ✅ | — | — | ✅ | — |
| Jordan Rivera (DevOps Engineer) | Cal, Teams, Copilot | ✅ | — | — | ✅ | — |
| Riley O'Brien (M365 Admin) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Jasmine Rivera (Head of HR) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Morgan Blake (Global Admin) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Priya Gupta (User Researcher) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Daniel Park (Competitive Intel) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Anna Petrov (Revenue Analyst) | Cal, Teams, Copilot | ✅ | ✅ | — | — | — |
| Omar Hassan (Cost Analyst) | Cal, Teams, Copilot | ✅ | ✅ | — | — | — |
| Tyler Brooks (Content Creator) | Cal, Teams, Copilot | ✅ | — | ✅ | — | — |
| Lisa Chen (SEO Analyst) | Cal, Teams, Copilot | ✅ | — | ✅ | — | — |
| Kai Nakamura (Social Media Mgr) | Cal, Teams, Copilot | ✅ | — | ✅ | — | — |
| Emma Davis (Onboarding) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| David Thompson (Support Triage) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Nathan Wells (Account Research) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Leo Vargas (UI/UX Designer) | Cal, Teams, Copilot | ✅ | — | — | — | ✅ |
| Ava Chen (Frontend Engineer) | Cal, Teams, Copilot | ✅ | — | — | ✅ | ✅ |
| Sofia Marchetti (Design Critic) | Cal, Teams, Copilot | ✅ | — | — | — | ✅ |
| Ryan Park (Template Architect) | Cal, Teams, Copilot | ✅ | — | — | ✅ | ✅ |
| 6× Research Analysts | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Bob Finley (Tax Pro) | Cal, Teams, Copilot | ✅ | ✅ | — | — | — |
| Grace Hwang (Data Integrity) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Mariana Solis (Tax Strategy) | Cal, Teams, Copilot | ✅ | ✅ | — | — | — |
| Ethan Morse (Enterprise Account) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Derek Owens (Lead Gen) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Zara Petrov (Marketing Intel) | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Adi Rose | Cal, Teams, Copilot | ✅ | — | — | — | — |
| Elena Vance (VP Partnerships) | Cal, Teams, Copilot | ✅ | — | — | — | — |

### MCP Tool Count Per Agent (Code + MCP Total)

Each agent's **true tool count** = Code-Based grants (Section 2) + MCP tools from accessible servers.

| Agent | Code Tools | + MCP Data (12) | + MCP Finance (7) | + MCP Marketing (7) | + MCP Engineering (5) | + MCP Design (5) | + M365 (dynamic) | **Effective Total** |
|-------|-----------|----------------|------------------|--------------------|--------------------|-----------------|-----------------|-------------------|
| Mia (VP Design) | 81 | 12 | — | — | 5 | 5 | ✅ | **103+** |
| Morgan (Global Admin) | 51 | 12 | — | — | — | — | ✅ | **63+** |
| Ryan (Template Architect) | ~51 | 12 | — | — | 5 | 5 | ✅ | **73+** |
| Sarah (Chief of Staff) | 47 | 12 | — | — | — | — | ✅ | **59+** |
| Sofia (Design Critic) | ~47 | 12 | — | — | — | 5 | ✅ | **64+** |
| Jasmine (Head of HR) | 40 | 12 | — | — | — | — | ✅ | **52+** |
| Ava (Frontend Engineer) | ~39 | 12 | — | — | 5 | 5 | ✅ | **61+** |
| Marcus (CTO) | 35 | 12 | — | — | 5 | — | ✅ | **52+** |
| Nadia (CFO) | 21 | 12 | 7 | — | — | — | ✅ | **40+** |
| Leo (UI/UX Designer) | ~36 | 12 | — | — | — | 5 | ✅ | **53+** |

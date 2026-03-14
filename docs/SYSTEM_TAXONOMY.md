# Glyphor System Taxonomy (Live Snapshot)

Generated at: 2026-03-14T14:58:00.338Z

## Scope
This document captures the current, live state of three essentials:
1. Current agent roster (all agents that exist in company_agents)
2. Current tool registry (static runtime definitions + DB-registered tools + MCP server catalogs)
3. Current skill definitions (all rows in skills)

## 1) Current Agent Roster

Total agents: 27
Status counts: active=25, paused=2
Department counts: (unassigned)=4, Design & Frontend=5, Engineering=4, Executive Office=1, Finance=1, Legal=1, Marketing=4, Operations=1, Operations & IT=2, Product=1, Research & Intelligence=3

| Role | Name | Title | Department | Status | Reports To | ID |
|---|---|---|---|---|---|---|
| design-critic | Sofia Marchetti | Design Critic | Design & Frontend | active | vp-design | 1bb9f056-19a7-413c-8b35-24b2bafa67bf |
| frontend-engineer | Ava Chen | Frontend Engineer | Design & Frontend | active | vp-design | 31277d9f-e551-4217-8c03-54414c09511f |
| template-architect | Ryan Park | Template Architect | Design & Frontend | active | vp-design | 0ee2e025-4089-40aa-913e-d65773f3020a |
| ui-ux-designer | Leo Vargas | UI/UX Designer | Design & Frontend | active | vp-design | ffaafe52-6ffb-4d17-a44b-17213aee273e |
| cto | Marcus Reeves | Chief Technology Officer | Engineering | active | chief-of-staff | f7b7eac1-92a0-4944-83aa-7596aabe95dd |
| devops-engineer | Jordan Hayes | DevOps Engineer | Engineering | active | cto | b37d649d-2bac-4ea4-ab37-4d298b437e9f |
| platform-engineer | Alex Park | Platform Engineer | Engineering | active | cto | 190cda60-cdc4-4d38-b2b4-3d1940b94781 |
| quality-engineer | Sam DeLuca | Quality Engineer | Engineering | active | cto | 2c273ec1-7217-4bd2-b03e-477a71899a2b |
| chief-of-staff | Sarah Chen | Chief of Staff | Executive Office | active |  | 3a1dbb19-37f8-46fa-8a4b-37c5bcfea5d5 |
| cfo | Nadia Okafor | Chief Financial Officer | Finance | active | chief-of-staff | ef7a1567-b782-4f36-9d50-cad145b6ed9f |
| clo | Victoria Chase | Chief Legal Officer | Legal | active | chief-of-staff | 6f6b928f-5ded-4af4-8258-dc3d6ea54321 |
| cmo | Maya Brooks | Chief Marketing Officer | Marketing | active | chief-of-staff | 7e4d25b6-b94a-4c30-8b5f-8f453886fe8b |
| content-creator | Tyler Reed | Content Creator | Marketing | active | cmo | 024a349f-0d8d-4bcb-8bfe-8c54ecac4e99 |
| seo-analyst | Lisa Chen | SEO Analyst | Marketing | active | cmo | f1029336-b612-4fa7-b1cb-169717108abb |
| social-media-manager | Kai Johnson | Social Media Manager | Marketing | active | cmo | 0b8d987e-d6bd-4040-bfee-46eda6f0a5ea |
| ops | Atlas Vega | Operations & System Intelligence | Operations | active | chief-of-staff | 008ae65b-8ab2-4b7b-a1ae-df6844ceae9f |
| global-admin | Morgan Blake | Global Administrator | Operations & IT | active | chief-of-staff | 1f823f6b-658a-43a1-bd57-23e9fbe21616 |
| m365-admin | Riley Morgan | M365 Administrator | Operations & IT | active | ops | 6055480d-75d5-48be-98e4-10000fba7042 |
| competitive-research-analyst | Lena Park | Competitive Research Analyst | Research & Intelligence | active | vp-research | 7796d3f9-0054-4c8b-a8ee-70c64600ec7c |
| market-research-analyst | Daniel Okafor | Market Research Analyst | Research & Intelligence | active | vp-research | 0134918f-a25f-44d3-9821-441c4eba73fb |
| vp-research | Sophia Lin | VP Research & Intelligence | Research & Intelligence | active | chief-of-staff | 487c083a-a2d0-4c76-a4dc-f5092d5703da |
| adi-rose | Adi Rose | Executive Assistant to COO | (unassigned) | active | chief-of-staff | 9050da40-8f49-4cac-ad75-8b5635ed69e9 |
| bob-the-tax-pro | Robert Finley | CPA & Tax Strategist | (unassigned) | active | cfo | 1c481309-30d4-447d-9bc0-61fafd3306f6 |
| head-of-hr | Jasmine Rivera | Head of People & Culture | (unassigned) | active | chief-of-staff | 2d6d53bb-9c49-4638-a855-b12752f41707 |
| marketing-intelligence-analyst | Zara Petrov | Marketing Intelligence Analyst | (unassigned) | active | cmo | 7cb42087-f57c-4559-a81e-e0fe5f1e8838 |
| vp-design | Mia Tanaka | VP Design & Frontend | Design & Frontend | paused | chief-of-staff | f9cae8df-b148-4052-8978-0bcbbfad65d8 |
| cpo | Elena Vasquez | Chief Product Officer | Product | paused | chief-of-staff | e7377741-35c9-4873-bf3c-c1b02680042f |

## 2) Current Tool Registry

### 2.1 Static Runtime Tools (KNOWN_TOOLS)
Count: 570

Full list from packages/agent-runtime/src/toolRegistry.ts KNOWN_TOOLS:

- activate_initiative
- add_channel_member
- add_graph_edge
- add_graph_node
- add_knowledge
- analyze_ai_adoption
- analyze_content_seo
- analyze_market_trends
- analyze_org_structure
- analyze_page_seo
- analyze_support_tickets
- analyze_tech_stack
- approve_content_draft
- assign_team_task
- audit_access
- audit_access_permissions
- audit_data_flows
- batch_similar_tickets
- calculate_cost_savings
- calculate_ltv_cac
- calculate_tax_estimate
- calculate_unit_cost
- calculate_unit_economics
- call_meeting
- capture_lead
- check_ai_smell
- check_assignment_status
- check_budget_status
- check_build_errors
- check_bundle_size
- check_data_retention
- check_envelope_status
- check_escalations
- check_job_postings
- check_messages
- check_monitors
- check_pr_status
- check_responsive
- check_system_health
- check_table_schema
- check_team_status
- check_tool_access
- check_tool_health
- check_tool_request_status
- classify_ticket
- clone_and_modify
- comment_on_pr
- compare_features
- compare_screenshots
- compile_dossier
- compile_research_digest
- contribute_knowledge
- create_branch
- create_budget
- create_bug_report
- create_calendar_event
- create_canva_design
- create_channel
- create_compliance_alert
- create_component_branch
- create_component_pr
- create_content_draft
- create_contract_review
- create_decision
- create_design_branch
- create_experiment
- create_figma_dev_resource
- create_frontend_pr
- create_github_issue
- create_github_pr
- create_handoff
- create_incident
- create_ip_filing
- create_knowledge_route
- create_logo_variation
- create_mailchimp_campaign
- create_monitor
- create_onboarding_plan
- create_or_update_file
- create_peer_work_request
- create_performance_review
- create_research_brief
- create_roadmap_item
- create_service_account
- create_signing_envelope
- create_social_avatar
- create_specialist_agent
- create_status_report
- create_survey
- create_test_plan
- create_user_persona
- create_work_assignments
- cross_reference_findings
- deactivate_tool
- deploy_preview
- deploy_to_staging
- design_experiment
- design_onboarding_experiment
- detect_contradictions
- detect_milestones
- diagnose_column_error
- discover_keywords
- dispatch_assignment
- draft_blog_post
- draft_case_study
- draft_email
- draft_social_post
- emit_alert
- emit_insight
- entra_add_group_member
- entra_assign_directory_role
- entra_assign_license
- entra_audit_profiles
- entra_audit_sign_ins
- entra_create_user
- entra_disable_user
- entra_get_user_profile
- entra_hr_assign_license
- entra_list_app_registrations
- entra_list_directory_roles
- entra_list_group_members
- entra_list_groups
- entra_list_licenses
- entra_list_users
- entra_remove_group_member
- entra_revoke_license
- entra_set_manager
- entra_update_user_profile
- entra_upload_user_photo
- escalate_ticket
- escalate_to_sarah
- estimate_dev_spend
- evaluate_assignment
- export_canva_design
- export_figma_images
- fetch_github_releases
- fetch_pricing_pages
- file_decision
- flag_assignment_blocker
- flag_contract_issue
- forecast_revenue
- generate_and_publish_asset
- generate_canva_design
- generate_content_image
- generate_favicon_set
- generate_financial_report
- generate_image
- get_access_matrix
- get_agent_directory
- get_agent_health_dashboard
- get_agent_performance_summary
- get_ai_model_costs
- get_attribution_data
- get_authority_proposals
- get_backlink_profile
- get_build_queue
- get_burn_rate
- get_campaign_list
- get_campaign_report
- get_canva_design
- get_canva_template_fields
- get_cash_balance
- get_cash_flow
- get_churn_analysis
- get_ci_health
- get_cloud_run_metrics
- get_code_coverage
- get_cohort_retention
- get_color_palette
- get_company_pulse
- get_competitor_profile
- get_compliance_status
- get_component_library
- get_component_usage
- get_container_logs
- get_content_calendar
- get_content_drafts
- get_content_metrics
- get_contract_renewals
- get_contracts
- get_cost_anomalies
- get_customer_ltv
- get_data_freshness
- get_deliverables
- get_deployment_history
- get_deployment_status
- get_design_quality_summary
- get_design_tokens
- get_event_bus_health
- get_experiment_results
- get_feature_requests
- get_feature_usage
- get_figma_comments
- get_figma_components
- get_figma_dev_resources
- get_figma_file
- get_figma_file_metadata
- get_figma_image_fills
- get_figma_project_files
- get_figma_styles
- get_figma_team_components
- get_figma_team_projects
- get_figma_team_styles
- get_figma_version_history
- get_file_contents
- get_financials
- get_funnel_analysis
- get_gcp_costs
- get_github_pr_status
- get_indexing_status
- get_infrastructure_costs
- get_infrastructure_inventory
- get_ip_portfolio
- get_knowledge_routes
- get_lead_pipeline
- get_mailchimp_lists
- get_mailchimp_members
- get_mailchimp_segments
- get_mandrill_stats
- get_mandrill_templates
- get_margin_analysis
- get_market_landscape
- get_marketing_dashboard
- get_monitor_history
- get_mrr_breakdown
- get_org_chart
- get_org_knowledge
- get_pending_decisions
- get_pending_transactions
- get_pipeline_runs
- get_platform_audit_log
- get_platform_health
- get_post_performance
- get_privacy_requests
- get_process_patterns
- get_product_metrics
- get_quality_metrics
- get_recent_activity
- get_recent_commits
- get_repo_code_health
- get_repo_stats
- get_research_timeline
- get_revenue_forecast
- get_roadmap
- get_scheduled_posts
- get_search_performance
- get_secret_iam
- get_seo_data
- get_service_dependencies
- get_social_audience
- get_social_metrics
- get_stripe_invoices
- get_subscription_details
- get_survey_results
- get_system_costs_realtime
- get_tax_calendar
- get_tax_research
- get_team_dynamics
- get_template_registry
- get_trending_topics
- get_typography_scale
- get_unit_economics
- get_usage_metrics
- get_user
- get_user_feedback
- get_vendor_costs
- grade_build
- grant_project_role
- grant_secret_access
- grant_tool_access
- identify_research_gaps
- identify_unused_resources
- identify_waste
- list_assets
- list_calendar_events
- list_canva_brand_templates
- list_channel_members
- list_channels
- list_components
- list_deployments
- list_envelopes
- list_frontend_files
- list_my_created_agents
- list_my_tools
- list_project_iam
- list_registered_tools
- list_secrets
- list_service_accounts
- list_tables
- list_templates
- list_tool_requests
- list_users
- log_activity
- manage_feature_flags
- manage_figma_webhooks
- manage_mailchimp_tags
- merge_github_pr
- monitor_competitor_launches
- monitor_competitor_marketing
- monitor_ip_infringement
- monitor_mentions
- optimize_image
- pause_agent
- peer_data_request
- post_figma_comment
- post_system_status
- post_to_channel
- predict_capacity
- project_costs
- promote_to_org_knowledge
- propose_authority_change
- propose_directive
- propose_initiative
- provision_access
- publish_asset_deliverable
- publish_content
- publish_deliverable
- pulse_analyze_brand_website
- pulse_analyze_image_for_video
- pulse_batch_generate_videos
- pulse_check_subscription
- pulse_create_ad_storyboard
- pulse_create_hero_promo
- pulse_create_multi_angle
- pulse_create_narrative_storyboard
- pulse_create_product_showcase
- pulse_create_share_link
- pulse_create_storyboard
- pulse_delete_video
- pulse_doodle_to_image
- pulse_edit_image
- pulse_enhance_prompt
- pulse_enhance_video_prompt
- pulse_expand_image
- pulse_extract_image_text
- pulse_generate_avatar
- pulse_generate_concept_image
- pulse_generate_lipsync
- pulse_generate_music
- pulse_generate_promo_scenes
- pulse_generate_scene_images
- pulse_generate_sound_effect
- pulse_generate_storyboard_script
- pulse_generate_video
- pulse_generate_voiceover_script
- pulse_get_storyboard
- pulse_kling_multi_shot
- pulse_list_brand_kits
- pulse_list_concept_images
- pulse_list_storyboards
- pulse_list_videos
- pulse_polish_scene_prompt
- pulse_poll_avatar_status
- pulse_poll_lipsync_status
- pulse_poll_multi_shot
- pulse_poll_video_status
- pulse_product_recontext
- pulse_remix_video
- pulse_remove_background
- pulse_replace_image_text
- pulse_storyboard_chat
- pulse_suggest_scenes
- pulse_text_to_speech
- pulse_transform_viral_image
- pulse_upload_source_image
- pulse_upscale_image
- push_component
- query_activation_rate
- query_agent_health
- query_agent_run_costs
- query_agent_runs
- query_analytics_events
- query_attribution
- query_audience_demographics
- query_backlinks
- query_build_grades
- query_build_grades_by_template
- query_build_logs
- query_build_metadata
- query_cache_metrics
- query_churn_data
- query_churn_revenue
- query_cloud_run_metrics
- query_cold_starts
- query_competitor_rankings
- query_competitor_tech_stack
- query_component_implementations
- query_component_specs
- query_content_performance
- query_cost_trends
- query_costs
- query_customers
- query_data_sync_status
- query_db_health
- query_db_usage
- query_design_tokens
- query_drop_off_points
- query_error_patterns
- query_events_backlog
- query_financials
- query_first_build_metrics
- query_gcp_billing
- query_gemini_cost
- query_gemini_latency
- query_keyword_data
- query_knowledge_base
- query_knowledge_graph
- query_logs
- query_my_implementations
- query_onboarding_funnel
- query_optimal_times
- query_pipeline_metrics
- query_post_performance
- query_resource_utilization
- query_revenue_by_cohort
- query_revenue_by_product
- query_search_console
- query_seo_rankings
- query_social_metrics
- query_stripe_mrr
- query_stripe_revenue
- query_stripe_subscriptions
- query_support_tickets
- query_template_usage
- query_template_variants
- query_test_results
- query_top_performing_content
- query_uptime
- query_user_analytics
- query_welcome_email_metrics
- read_company_doctrine
- read_company_memory
- read_file
- read_founder_directives
- read_frontend_file
- read_initiatives
- read_my_assignments
- read_proposed_initiatives
- read_teams_dm
- recall_memories
- record_process_pattern
- register_tool
- reject_content_draft
- render_mandrill_template
- reply_to_social
- request_new_tool
- request_peer_work
- request_tool_access
- resend_envelope
- resolve_figma_comment
- resolve_incident
- respond_to_ticket
- restyle_logo
- resume_agent
- retire_created_agent
- retry_data_sync
- retry_failed_run
- review_tax_strategy
- review_team_output
- review_tool_request
- revoke_access
- revoke_project_role
- revoke_secret_access
- revoke_tool_access
- rollup_agent_performance
- rotate_secrets
- run_access_audit
- run_accessibility_audit
- run_cohort_analysis
- run_engagement_survey
- run_health_check
- run_lighthouse
- run_lighthouse_audit
- run_lighthouse_batch
- run_onboarding
- run_test_suite
- save_component_implementation
- save_component_spec
- save_memory
- save_research
- save_template_variant
- scaffold_component
- scaffold_page
- scale_service
- schedule_social_post
- score_feature_rice
- score_lead
- screenshot_component
- screenshot_page
- search_academic_papers
- search_canva_designs
- search_company_info
- search_crunchbase
- search_frontend_code
- search_hacker_news
- search_job_postings
- search_linkedin_profiles
- search_mandrill_messages
- search_memories
- search_news
- search_product_hunt
- search_research
- segment_users
- send_agent_message
- send_briefing
- send_campaign
- send_dm
- send_teams_dm
- send_template_envelope
- send_test_campaign
- send_transactional_email
- set_campaign_content
- store_intel
- storybook_check_coverage
- storybook_get_story_source
- storybook_list_stories
- storybook_save_baseline
- storybook_screenshot
- storybook_screenshot_all
- storybook_visual_diff
- submit_assignment_output
- submit_content_for_review
- submit_research_packet
- submit_sitemap
- tool_search
- trace_causes
- trace_impact
- track_ai_benchmarks
- track_competitor
- track_competitor_pricing
- track_competitor_product
- track_industry_events
- track_keyword_rankings
- track_open_source
- track_regulations
- track_regulatory_changes
- trigger_agent_run
- update_agent_profile
- update_company_pulse
- update_competitor_profile
- update_compliance_item
- update_content_draft
- update_design_token
- update_directive_progress
- update_doctrine_section
- update_growth_areas
- update_pulse_highlights
- update_roadmap_item
- update_seo_data
- update_template_status
- upload_asset
- upload_canva_asset
- upload_to_sharepoint
- validate_brand_compliance
- validate_tokens_vs_implementation
- view_access_matrix
- view_pending_grant_requests
- void_envelope
- web_fetch
- web_search
- who_handles
- write_admin_log
- write_company_memory
- write_content
- write_design_audit
- write_financial_report
- write_frontend_file
- write_health_report
- write_pipeline_report
- write_product_analysis

### 2.2 Dynamic DB-Registered Tools (tool_registry table)
Count: 1

| Name | Category | Active | Usage Count | Created By | Approved By | Last Used At | Description | Tags |
|---|---|---|---:|---|---|---|---|---|
| inspect_cloud_run_service | observability | true | 0 | cto | cto |  | Inspect a Cloud Run service configuration — see environment variables, secrets, resource limits, scaling, and current revision. Use this to diagnose missing env vars or secrets. |  |

### 2.3 Agent365 MCP Server Catalog
Standard server count: 6
Full supported catalog count: 8

| Server | In Standard Set |
|---|---|
| mcp_CalendarTools | yes |
| mcp_M365Copilot | yes |
| mcp_MailTools | yes |
| mcp_ODSPRemoteServer | yes |
| mcp_SharePointLists | no |
| mcp_TeamsServer | yes |
| mcp_UserProfile | no |
| mcp_WordServer | yes |

Note: runtime treats tool names starting with mcp_ as valid known tools. Concrete per-method tool names are discovered dynamically from connected MCP servers at runtime.

### 2.4 Glyphor MCP Server Catalog
Configured server family count (code-defined): 8

| MCP Server Name | Env Var |
|---|---|
| mcp_GlyphorData | GLYPHOR_MCP_DATA_URL |
| mcp_GlyphorDesign | GLYPHOR_MCP_DESIGN_URL |
| mcp_GlyphorEmailMarketing | GLYPHOR_MCP_EMAIL_MARKETING_URL |
| mcp_GlyphorEngineering | GLYPHOR_MCP_ENGINEERING_URL |
| mcp_GlyphorFinance | GLYPHOR_MCP_FINANCE_URL |
| mcp_GlyphorHR | GLYPHOR_MCP_HR_URL |
| mcp_GlyphorLegal | GLYPHOR_MCP_LEGAL_URL |
| mcp_GlyphorMarketing | GLYPHOR_MCP_MARKETING_URL |

## 3) Current Skill Definitions

Total skills: 19
Category counts: design=2, engineering=3, finance=3, leadership=2, marketing=3, operations=1, product=3, sales=2

### 3.1 Skill Summary Table
| Slug | Name | Category | Version | Tools Granted Count | Tools Granted |
|---|---|---|---:|---:|---|
| design-review | Design Review | design | 1 | 2 | read_file, save_memory |
| design-system-management | Design System Management | design | 1 | 2 | read_file, web_search |
| incident-response | Incident Response | engineering | 1 | 3 | check_system_health, query_logs, file_decision |
| platform-monitoring | Platform Monitoring | engineering | 1 | 2 | check_system_health, query_logs |
| tech-spec-writing | Technical Spec Writing | engineering | 1 | 2 | read_file, web_search |
| budget-monitoring | Budget Monitoring | finance | 1 | 3 | query_costs, file_decision, save_memory |
| financial-reporting | Financial Reporting | finance | 1 | 3 | query_financials, query_costs, file_decision |
| revenue-analysis | Revenue Analysis | finance | 1 | 2 | query_financials, query_customers |
| cross-team-coordination | Cross-Team Coordination | leadership | 1 | 3 | send_agent_message, file_decision, save_memory |
| decision-routing | Decision Routing | leadership | 1 | 3 | file_decision, send_agent_message, save_memory |
| content-creation | Content Creation | marketing | 1 | 2 | web_search, save_memory |
| seo-optimization | SEO Optimization | marketing | 1 | 1 | web_search |
| social-media-management | Social Media Management | marketing | 1 | 2 | web_search, save_memory |
| system-monitoring | System Monitoring | operations | 1 | 3 | check_system_health, query_logs, save_memory |
| competitive-analysis | Competitive Analysis | product | 1 | 2 | web_search, save_memory |
| roadmap-management | Roadmap Management | product | 1 | 2 | query_customers, file_decision |
| user-research | User Research | product | 1 | 2 | query_customers, query_financials |
| account-research | Account Research | sales | 1 | 2 | web_search, save_memory |
| proposal-generation | Proposal Generation | sales | 1 | 2 | web_search, query_financials |

### 3.2 Full Skill Definitions

#### design-review
- id: 67c0e40c-5209-4e07-897d-f2e95baf3d51
- name: Design Review
- category: design
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: read_file, save_memory
- description:
  Audit UI outputs for quality, consistency, and anti-AI-smell patterns.
- methodology:
  1. Load the design artifact (component, page, template) to review.
  2. Check against design system: spacing, typography, color palette.
  3. Scan for AI-smell patterns: generic layouts, stock-photo feel, bland copy.
  4. Evaluate accessibility: contrast ratios, touch targets, alt text.
  5. Score overall quality on a 0-100 scale with category breakdowns.
  6. Produce specific actionable feedback with before/after suggestions.

#### design-system-management
- id: 791765b6-c2d9-4554-a1c7-8ec06a4df387
- name: Design System Management
- category: design
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: read_file, web_search
- description:
  Maintain and evolve the component library, tokens, and patterns.
- methodology:
  1. Audit current design token usage across the codebase.
  2. Identify inconsistencies: color overrides, spacing violations, rogue fonts.
  3. Review component library for completeness and documentation.
  4. Propose new tokens or components based on usage patterns.
  5. Document any breaking changes with migration guides.
  6. Ensure all components have proper accessibility attributes.

#### incident-response
- id: 75c4f957-65d9-496e-86b2-79ba431d889d
- name: Incident Response
- category: engineering
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: check_system_health, query_logs, file_decision
- description:
  Detect, diagnose, and resolve production incidents following SRE best practices.
- methodology:
  1. Acknowledge the incident and classify severity (P0-P3).
  2. Gather metrics: error rates, latency, affected services via check_system_health.
  3. Identify blast radius — which users/features are impacted?
  4. Formulate hypothesis and test via targeted queries.
  5. Apply mitigation (rollback, scale, config change).
  6. Write post-incident summary with timeline, root cause, and follow-ups.
  7. File incident_report and notify stakeholders.

#### platform-monitoring
- id: 7097b3a1-fd82-4b91-8461-d58d8e6e2125
- name: Platform Monitoring
- category: engineering
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: check_system_health, query_logs
- description:
  Monitor infrastructure health, uptime, and performance metrics.
- methodology:
  1. Run check_system_health across all services.
  2. Compare latency, error rate, and throughput vs baselines.
  3. Check resource utilization (CPU, memory, connections).
  4. Identify any degradation trends over the past 24h.
  5. If any metric is outside SLA, create an alert.
  6. Produce a health summary with green/yellow/red status per service.

#### tech-spec-writing
- id: 51c65cb0-0182-406b-985c-dfcec294619b
- name: Technical Spec Writing
- category: engineering
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: read_file, web_search
- description:
  Write detailed technical specifications for proposed features or changes.
- methodology:
  1. Understand the product requirement from the brief or task.
  2. Research existing architecture — what systems are affected?
  3. Define the proposed solution with component diagram.
  4. List API changes, DB schema changes, and migration steps.
  5. Identify risks, dependencies, and rollback strategy.
  6. Estimate effort in person-days and complexity.
  7. Output a structured spec document.

#### budget-monitoring
- id: 0ca5aa61-10a3-4004-8965-d36de54d93ce
- name: Budget Monitoring
- category: finance
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: query_costs, file_decision, save_memory
- description:
  Track spending against budgets and alert on anomalies.
- methodology:
  1. Load current month spend from query_costs grouped by category.
  2. Compare vs allocated budget per category.
  3. Calculate burn rate and project month-end spend.
  4. If projected overspend > 15%, create an alert via file_decision.
  5. Identify top 3 cost drivers and suggest optimizations.
  6. Save cost pattern as memory for trend analysis.

#### financial-reporting
- id: 8d37a37f-9e57-4540-853f-86efc76279f1
- name: Financial Reporting
- category: finance
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: query_financials, query_costs, file_decision
- description:
  Produce structured financial reports covering MRR, costs, margins, and runway.
- methodology:
  1. Pull latest revenue data from Stripe via query_financials.
  2. Pull infrastructure costs via query_costs.
  3. Calculate unit economics (CAC, LTV, LTV:CAC ratio).
  4. Compare vs prior period — flag deltas > 10%.
  5. Produce a report with sections: Revenue, Costs, Margins, Runway, Recommendations.
  6. If any metric breaches a threshold, file_decision with tier yellow or red.

#### revenue-analysis
- id: 7050557d-b7c5-4c3c-a93a-8b4d0688a2de
- name: Revenue Analysis
- category: finance
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: query_financials, query_customers
- description:
  Analyze revenue streams, cohort behavior, and pricing impact.
- methodology:
  1. Pull MRR, ARR, and churn data via query_financials.
  2. Segment by plan tier and customer cohort.
  3. Calculate net revenue retention (NRR) and expansion revenue.
  4. Identify top-growing and declining segments.
  5. Model pricing sensitivity if data allows.
  6. Produce insights with actionable recommendations.

#### cross-team-coordination
- id: 452e9410-efc6-4e37-a837-9780c2ab5356
- name: Cross-Team Coordination
- category: leadership
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: send_agent_message, file_decision, save_memory
- description:
  Coordinate work across departments, resolve conflicts, and align priorities.
- methodology:
  1. Identify the cross-team initiative or conflict from the task.
  2. Gather context from all involved teams via messages or data.
  3. Map dependencies and potential blockers.
  4. Draft a coordination plan with clear owners and timelines.
  5. Send alignment messages to relevant agents.
  6. Schedule follow-ups and track completion.

#### decision-routing
- id: 9e2d52e1-6d9b-46b6-821a-7d90c8865b8f
- name: Decision Routing
- category: leadership
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: file_decision, send_agent_message, save_memory
- description:
  Classify decisions by impact tier and route for appropriate approval.
- methodology:
  1. Analyze the decision: scope, reversibility, cost, strategic impact.
  2. Classify into tier: green (auto-approve), yellow (founder review), red (both founders).
  3. If yellow/red, prepare a decision brief with: context, options, recommendation, risks.
  4. File the decision via file_decision with appropriate tier.
  5. Track decision status and follow up on pending items.
  6. Log the decision outcome for pattern analysis.

#### content-creation
- id: f285a40b-9434-47fd-81a6-b443804481ed
- name: Content Creation
- category: marketing
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: web_search, save_memory
- description:
  Create blog posts, social content, and marketing copy aligned with brand voice.
- methodology:
  1. Review the content brief or topic from the task.
  2. Research the topic — gather data points, quotes, examples.
  3. Outline the piece with a hook, body sections, and CTA.
  4. Write the first draft emphasizing Glyphor's autonomous positioning.
  5. Self-edit for clarity, tone, and brand alignment.
  6. Add SEO metadata (title, description, keywords).
  7. Output the final piece in markdown format.

#### seo-optimization
- id: 28ee6bfb-959f-4f9b-ad28-be44fd677030
- name: SEO Optimization
- category: marketing
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: web_search
- description:
  Optimize content and site structure for search engine visibility.
- methodology:
  1. Identify target keywords via web_search and competitor analysis.
  2. Analyze current ranking positions if available.
  3. Review on-page factors: title tags, meta descriptions, headings, internal links.
  4. Check content quality signals: word count, readability, keyword density.
  5. Identify content gaps and opportunities.
  6. Produce a prioritized list of SEO improvements.

#### social-media-management
- id: c3a8d75d-29c0-488c-8ddf-91321db0f23a
- name: Social Media Management
- category: marketing
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: web_search, save_memory
- description:
  Plan, create, and analyze social media content across platforms.
- methodology:
  1. Review content calendar and upcoming company milestones.
  2. Draft posts tailored to each platform (Twitter/X, LinkedIn, etc.).
  3. Ensure brand voice consistency — autonomous, not assisted.
  4. Schedule posts with optimal timing based on engagement data.
  5. Analyze recent post performance metrics.
  6. Suggest content adjustments based on engagement trends.

#### system-monitoring
- id: 30431268-55e5-4130-8113-8f955ff92b45
- name: System Monitoring
- category: operations
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: check_system_health, query_logs, save_memory
- description:
  Monitor agent health, data freshness, and system-wide performance.
- methodology:
  1. Check all agent statuses: last run time, success rate, error patterns.
  2. Verify data freshness: when were key tables last updated?
  3. Monitor cost trends: daily spend vs budget.
  4. Check for stuck or unresponsive agents.
  5. Produce a system health report with red/yellow/green status.
  6. If any agent is unhealthy, diagnose and recommend action.

#### competitive-analysis
- id: c7ce1369-6421-4432-8a1d-cd543012f2c2
- name: Competitive Analysis
- category: product
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: web_search, save_memory
- description:
  Track competitors, analyze positioning, and identify market opportunities.
- methodology:
  1. Identify the competitive set relevant to the task.
  2. Research each competitor: features, pricing, positioning, recent moves.
  3. Build a comparison matrix on key dimensions.
  4. Identify Glyphor's differentiation and gaps.
  5. Analyze market trends affecting the competitive landscape.
  6. Produce strategic recommendations with evidence.

#### roadmap-management
- id: 59f820f9-2a8a-4de7-8988-47476619351e
- name: Roadmap Management
- category: product
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: query_customers, file_decision
- description:
  Maintain and prioritize the product roadmap using RICE scoring.
- methodology:
  1. Load current roadmap items and their RICE scores.
  2. Gather new inputs: user feedback, competitive moves, strategic objectives.
  3. Score new items using RICE (Reach × Impact × Confidence / Effort).
  4. Re-rank the backlog based on updated scores.
  5. Identify dependencies and sequencing constraints.
  6. Produce an updated roadmap summary with rationale for changes.

#### user-research
- id: 07fd2bc5-1aaf-40a0-88ed-77afc224ac2e
- name: User Research
- category: product
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: query_customers, query_financials
- description:
  Gather and synthesize user insights to inform product decisions.
- methodology:
  1. Define the research question from the task brief.
  2. Gather quantitative data: usage metrics, activation rates, feature adoption.
  3. Identify behavioral patterns and user segments.
  4. Synthesize findings into actionable insights.
  5. Map insights to product opportunities.
  6. Prioritize opportunities by impact and feasibility.

#### account-research
- id: 98c6e7e9-b5f6-43bc-bef4-1056d4ce52cd
- name: Account Research
- category: sales
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: web_search, save_memory
- description:
  Research enterprise prospects with depth to enable consultative selling.
- methodology:
  1. Identify the target account from the task brief.
  2. Research company: size, industry, tech stack, recent news, leadership.
  3. Identify 5+ specific pain points relevant to Glyphor's value prop.
  4. Find the right contacts and their roles in buying decisions.
  5. Build a tailored value proposition for this specific account.
  6. Produce a structured account brief with next steps.

#### proposal-generation
- id: 799a9ff3-263d-4398-985d-fdd6a7f162bf
- name: Proposal Generation
- category: sales
- version: 1
- created_at: 2026-03-02T00:38:35.410Z
- updated_at: 2026-03-02T00:38:35.410Z
- tools_granted: web_search, query_financials
- description:
  Create customized ROI models and sales proposals for enterprise prospects.
- methodology:
  1. Load the account research brief for the target prospect.
  2. Calculate ROI model: time saved, cost reduced, revenue enabled.
  3. Build pricing recommendation based on usage estimates.
  4. Draft executive summary connecting their pain points to our solution.
  5. Create feature-benefit mapping specific to their use case.
  6. Produce a polished proposal document with clear next steps.

## Sources
- Live DB tables: company_agents, skills, tool_registry
- Static runtime registry: packages/agent-runtime/src/toolRegistry.ts
- Agent365 server catalog: packages/agents/src/shared/agent365Tools.ts
- Glyphor MCP server catalog: packages/agents/src/shared/glyphorMcpTools.ts

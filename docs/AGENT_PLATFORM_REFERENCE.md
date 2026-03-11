# Glyphor AI Company — Agent Platform Reference

> Generated: March 11, 2026 | Source of truth for all agents, tools, schedules, and tool-access mappings.

---

## PART 1: All Agent Identities (44 roles)

### Executive Team

| # | Role ID | Display Name | Team | Scheduled Tasks | Summary |
|---|---------|-------------|------|-----------------|---------|
| 1 | `chief-of-staff` | Sarah Chen | Executive | `morning_briefing` (daily 7:00/7:30 AM CT), `eod_summary` (daily 6 PM CT), `orchestrate` (hourly), `strategic_planning` (Sun 10 PM UTC & Mon 8 AM CT) | Orchestrates the entire company — briefings, directive decomposition, assignment dispatch, and strategic planning. |
| 2 | `cto` | Marcus Reeves | Executive | `platform_health_check` (every 6h) | Monitors platform health, deploys infrastructure, manages engineering team, reviews code & CI/CD. |
| 3 | `cpo` | Elena Vasquez | Executive | `weekly_usage_analysis` (daily 10 AM CT) | Analyzes product usage, competitive landscape, and product strategy. |
| 4 | `cmo` | Maya Brooks | Executive | `weekly_content_planning` (daily 9 AM CT), `generate_content` (daily 2 PM CT) | Plans and executes content strategy, brand management, SEO, and social media. |
| 5 | `cfo` | Nadia Okafor | Executive | `daily_cost_check` (daily 9 AM CT & 3 PM CT) | Monitors costs, analyzes finances, tracks revenue, and manages budgets. |
| 6 | `clo` | Victoria Chase | Legal | *(no static cron — event-driven)* | Legal analysis, regulatory monitoring, contract review, and compliance assessments. |
| 7 | `vp-customer-success` | James Turner | Customer Success | `daily_health_scoring` (daily 8 AM CT) | Customer health scoring, churn detection, and customer success strategy. |
| 8 | `vp-sales` | Rachel Kim | Sales | `pipeline_review` (daily 9 AM CT) | Pipeline reviews, market sizing, and sales strategy. |
| 9 | `vp-design` | Mia Tanaka | Design | *(no static cron — event-driven)* | Design quality audits, design system governance, and frontend output quality. |

### VP & Director-Level

| # | Role ID | Display Name | Team | Scheduled Tasks | Summary |
|---|---------|-------------|------|-----------------|---------|
| 10 | `vp-research` | Sophia Lin | Research | *(event-driven — dispatched by CoS deep dive)* | Manages research team, decomposes research requests, QCs and packages research output. |
| 11 | `ops` | Atlas Vega | Operations | `health_check` (every 2h), `freshness_check` (every 6h), `cost_check` (every 4h), `morning_status` (6 AM CT), `evening_status` (5 PM CT) | Monitors system health, retries failures, manages incidents, produces status reports. |
| 12 | `head-of-hr` | Jasmine Rivera | People & Culture | *(event-driven — wakes on agent.spawned)* | Agent onboarding, workforce audits, profile management, and agent lifecycle. |
| 13 | `global-admin` | Morgan Blake | IT/Operations | *(no static cron — event-driven)* | Cross-project IAM, GCP/Entra ID user management, secret rotation, and onboarding. |
| 14 | `m365-admin` | Riley Morgan | IT/Engineering | `channel_audit` (Mon 7 AM CT), `user_audit` (Mon 8 AM CT) | Manages Microsoft 365 tenant — Teams channels, users, SharePoint, email, calendar. |

### Engineering Sub-Team (reports to CTO)

| # | Role ID | Display Name | Scheduled Tasks | Summary |
|---|---------|-------------|-----------------|---------|
| 15 | `platform-engineer` | Alex Park | `health_check` (every 2h) | Monitors platform services — Cloud Run, DB, Gemini latency, Vercel, uptime. |
| 16 | `quality-engineer` | Sam DeLuca | `qa_report` (daily 7 AM CT) | QA analysis — build logs, error patterns, bug reports, test results. |
| 17 | `devops-engineer` | Jordan Hayes | `pipeline_report` (daily 6 AM CT) | CI/CD pipeline performance, infrastructure optimization, cache metrics. |

### Product Sub-Team (reports to CPO)

| # | Role ID | Display Name | Scheduled Tasks | Summary |
|---|---------|-------------|-----------------|---------|
| 18 | `user-researcher` | Priya Sharma | `cohort_analysis` (daily 10:30 AM CT) | Cohort analysis, churn signals, user behavior analytics. |
| 19 | `competitive-intel` | Daniel Ortiz | `landscape_scan` (daily 8 AM CT) | Competitive landscape scanning — GitHub, HN, Product Hunt, pricing, tech stacks. |

### Finance Sub-Team (reports to CFO)

| # | Role ID | Display Name | Scheduled Tasks | Summary |
|---|---------|-------------|-----------------|---------|
| 20 | `revenue-analyst` | Anna Park | `revenue_report` (daily 9:30 AM CT) | Revenue tracking — Stripe MRR/ARR, LTV/CAC, cohort revenue, forecasting. |
| 21 | `cost-analyst` | Omar Hassan | `cost_report` (daily 9:30 AM CT) | Infrastructure cost tracking — GCP billing, DB usage, Gemini costs, waste scanning. |

### Marketing Sub-Team (reports to CMO)

| # | Role ID | Display Name | Scheduled Tasks | Summary |
|---|---------|-------------|-----------------|---------|
| 22 | `content-creator` | Tyler Reed | `blog_draft` (daily 10 AM CT) | Content drafting — blog posts, social media, case studies, email campaigns. |
| 23 | `seo-analyst` | Lisa Chen | `ranking_report` (daily 8:30 AM CT) | SEO performance — keyword rankings, Search Console, backlink analysis. |
| 24 | `social-media-manager` | Kai Johnson | `schedule_batch` (daily 9 AM CT), `engagement_report` (daily 4 PM CT) | Social media scheduling, engagement analytics, mention scanning. |

### Customer Success Sub-Team (reports to VP-CS)

| # | Role ID | Display Name | Scheduled Tasks | Summary |
|---|---------|-------------|-----------------|---------|
| 25 | `onboarding-specialist` | Emma Wright | `funnel_report` (daily 8:30 AM CT) | New user onboarding funnel analysis, activation rate tracking, drop-off analysis. |
| 26 | `support-triage` | David Santos | `triage_queue` (every 2h) | Support ticket triage, classification, response drafting, escalation. |

### Sales Sub-Team (reports to VP-Sales)

| # | Role ID | Display Name | Scheduled Tasks | Summary |
|---|---------|-------------|-----------------|---------|
| 27 | `account-research` | Nathan Cole | `prospect_research` (daily 9:30 AM CT) | Prospect research — company info, funding, tech stack, key contacts, dossiers. |

### Design Sub-Team (reports to VP-Design)

| # | Role ID | Display Name | Scheduled Tasks | Summary |
|---|---------|-------------|-----------------|---------|
| 28 | `ui-ux-designer` | Leo Vargas | *(DB-driven schedules)* | Component specs, design tokens, Figma integration, design system work. |
| 29 | `frontend-engineer` | Ava Chen | *(DB-driven schedules)* | Tailwind component implementation, accessibility audits, Storybook. |
| 30 | `design-critic` | Sofia Marchetti | *(DB-driven schedules)* | Quality grading, anti-pattern detection, build quality reports. |
| 31 | `template-architect` | Ryan Park | *(DB-driven schedules)* | Template structures, variant management, quality ceilings. |

### Research & Intelligence Team (reports to VP-Research)

| # | Role ID | Display Name | Scheduled Tasks | Summary |
|---|---------|-------------|-----------------|---------|
| 32 | `competitive-research-analyst` | Lena Park | *(dispatched by VP-Research)* | Competitive intelligence research — market positioning, product launches. |
| 33 | `market-research-analyst` | Daniel Okafor | *(dispatched by VP-Research)* | Market data, financial research, TAM/SAM analysis. |
| 34 | `technical-research-analyst` | Kai Nakamura | *(dispatched by VP-Research)* | Technical landscape research — frameworks, infrastructure, OSS trends. |
| 35 | `industry-research-analyst` | Amara Diallo | *(dispatched by VP-Research)* | Industry trends, PESTLE analysis, macro-environment research. |
| 36 | `ai-impact-analyst` | Riya Mehta | *(dispatched by VP-Research)* | AI impact research — model benchmarks, AI adoption, capability analysis. |
| 37 | `org-analyst` | Marcus Chen | *(dispatched by VP-Research)* | Organizational & talent research — org structures, hiring patterns. |

### Additional Specialists (types defined, not yet implemented as run.ts)

| # | Role ID | Display Name | Team | Summary |
|---|---------|-------------|------|---------|
| 38 | `enterprise-account-researcher` | Ethan Morse | Sales | Enterprise-tier account research (reports to VP-Sales). |
| 39 | `bob-the-tax-pro` | Robert "Bob" Finley | Legal/Finance | CPA & Tax Strategist (reports to CLO). |
| 40 | `data-integrity-auditor` | Grace Hwang | Legal | Data integrity auditing (reports to CLO). |
| 41 | `tax-strategy-specialist` | Mariana Solis | Legal | Tax strategy analysis (reports to CLO). |
| 42 | `lead-gen-specialist` | Derek Owens | Executive | Lead generation (reports to CoS). |
| 43 | `marketing-intelligence-analyst` | Zara Petrov | Marketing | Marketing intelligence (reports to CMO). |
| 44 | `adi-rose` | Adi Rose | Executive | Executive Assistant (reports to CoS). |

---

## PART 2: All Tool Factories

### Core Tools (`coreTools.ts`) — Every agent gets these

**Factory:** `createCoreTools(deps)`

| Tool Name | Source Factory | Description |
|-----------|--------------|-------------|
| `read_my_assignments` | assignmentTools | Read assignments assigned to this agent |
| `submit_assignment_output` | assignmentTools | Submit completed work for an assignment |
| `flag_assignment_blocker` | assignmentTools | Flag an assignment as blocked |
| `send_agent_message` | communicationTools | Send a message to another agent |
| `check_messages` | communicationTools | Check inbox for messages from other agents |
| `save_memory` | memoryTools | Save a memory/insight to persistent store |
| `recall_memories` | memoryTools | Recall previous memories by query |
| `request_tool_access` | toolRequestTools | Request temporary access to a tool |
| `request_new_tool` | toolRequestTools | Request creation of a new tool |
| `emit_insight` | eventTools | Emit an organizational insight event |
| `emit_alert` | eventTools | Emit an alert event |
| `send_teams_dm` | dmTools | Send a DM via Microsoft Teams |
| `read_teams_dm` | dmTools | Read DMs from Teams |
| `publish_deliverable` | deliverableTools | Publish a shared deliverable artifact |
| `get_deliverables` | deliverableTools | Retrieve published deliverables |

### Agent365 MCP Tools (`agent365Tools.ts`) — Microsoft 365 integration

**Factory:** `createAgent365McpTools(agentRole?, serverFilter?)`

**STANDARD_M365_SERVERS:**
- `mcp_MailTools` — Email send/read/reply
- `mcp_CalendarTools` — Calendar events
- `mcp_ODSPRemoteServer` — OneDrive/SharePoint files
- `mcp_TeamsServer` — Teams channels & messages
- `mcp_M365Copilot` — M365 Copilot AI
- `mcp_WordServer` — Word document operations

**ALL_M365_SERVERS** (adds):
- `mcp_UserProfile` — User profile queries
- `mcp_SharePointLists` — SharePoint list operations

### Glyphor MCP Tools (`glyphorMcpTools.ts`) — Internal MCP servers

**Factory:** `createGlyphorMcpTools(agentRole?, serverFilter?)`

| MCP Server | Env Var | Description |
|------------|---------|-------------|
| `mcp_GlyphorData` | `GLYPHOR_MCP_DATA_URL` | Company data queries |
| `mcp_GlyphorMarketing` | `GLYPHOR_MCP_MARKETING_URL` | Marketing operations (social posts, analytics, search console) |
| `mcp_GlyphorEngineering` | `GLYPHOR_MCP_ENGINEERING_URL` | Engineering operations |
| `mcp_GlyphorDesign` | `GLYPHOR_MCP_DESIGN_URL` | Design operations |
| `mcp_GlyphorFinance` | `GLYPHOR_MCP_FINANCE_URL` | Finance data |
| `mcp_GlyphorLegal` | `GLYPHOR_MCP_LEGAL_URL` | Legal data |
| `mcp_GlyphorHR` | `GLYPHOR_MCP_HR_URL` | HR operations |
| `mcp_GlyphorEmailMarketing` | `GLYPHOR_MCP_EMAIL_MARKETING_URL` | Email marketing (Mailchimp/Mandrill) |

### Shared Tool Factories (54 factory files)

#### Organization & Orchestration

| Factory File | Function | Tools |
|-------------|----------|-------|
| `collectiveIntelligenceTools.ts` | `createCollectiveIntelligenceTools` | `get_company_pulse`, `update_company_pulse`, `update_pulse_highlights`, `promote_to_org_knowledge`, `get_org_knowledge`, `read_company_doctrine`, `create_knowledge_route`, `get_knowledge_routes`, `detect_contradictions`, `record_process_pattern`, `get_process_patterns`, `propose_authority_change`, `get_authority_proposals` |
| `teamOrchestrationTools.ts` | `createTeamOrchestrationTools` | `assign_team_task`, `review_team_output`, `check_team_status`, `escalate_to_sarah` |
| `peerCoordinationTools.ts` | `createPeerCoordinationTools` | `request_peer_work`, `create_handoff`, `peer_data_request` |
| `initiativeTools.ts` | `createInitiativeTools` | `propose_initiative` |
| `executiveOrchestrationTools.ts` | `createExecutiveOrchestrationTools` | `create_team_assignments`, `evaluate_team_output`, `check_team_status`, `synthesize_team_deliverable` |
| `agentCreationTools.ts` | `createAgentCreationTools` | `create_specialist_agent`, `list_my_created_agents`, `retire_created_agent` |
| `agentDirectoryTools.ts` | `createAgentDirectoryTools` | `get_agent_directory`, `who_handles` |
| `assignmentTools.ts` | `createAssignmentTools` | `read_my_assignments`, `submit_assignment_output`, `flag_assignment_blocker` |
| `communicationTools.ts` | `createCommunicationTools` | `send_agent_message`, `check_messages`, `call_meeting`, `create_peer_work_request` |
| `deliverableTools.ts` | `createDeliverableTools` | `publish_deliverable`, `get_deliverables` |
| `dmTools.ts` | `createDmTools` | `send_teams_dm`, `read_teams_dm` |
| `eventTools.ts` | `createEventTools` | `emit_insight`, `emit_alert` |
| `toolGrantTools.ts` | `createToolGrantTools` | `grant_tool_access`, `revoke_tool_access` |
| `toolRegistryTools.ts` | `createToolRegistryTools` | `list_tool_requests`, `review_tool_request`, `register_tool`, `deactivate_tool`, `list_registered_tools` |
| `toolRequestTools.ts` | `createToolRequestTools` | `request_new_tool`, `check_tool_request_status`, `request_tool_access` |
| `accessAuditTools.ts` | `createAccessAuditTools` | `view_access_matrix`, `view_pending_grant_requests` |

#### Knowledge & Memory

| Factory File | Function | Tools |
|-------------|----------|-------|
| `graphTools.ts` | `createGraphTools` | `trace_causes`, `trace_impact`, `query_knowledge_graph`, `add_knowledge` |
| `memoryTools.ts` | `createMemoryTools` | `save_memory`, `recall_memories` |
| `sharepointTools.ts` | `createSharePointTools` | `upload_to_sharepoint` |

#### Design & Frontend

| Factory File | Function | Tools |
|-------------|----------|-------|
| `frontendCodeTools.ts` | `createFrontendCodeTools` | `read_frontend_file`, `search_frontend_code`, `list_frontend_files`, `write_frontend_file`, `create_design_branch`, `create_frontend_pr`, `check_pr_status` |
| `screenshotTools.ts` | `createScreenshotTools` | `screenshot_page`, `screenshot_component`, `compare_screenshots`, `check_responsive` |
| `designSystemTools.ts` | `createDesignSystemTools` | `get_design_tokens`, `update_design_token`, `validate_tokens_vs_implementation`, `get_color_palette`, `get_typography_scale`, `list_components`, `get_component_usage` |
| `auditTools.ts` | `createAuditTools` | `run_lighthouse_audit`, `run_accessibility_audit`, `check_ai_smell`, `validate_brand_compliance`, `check_bundle_size`, `check_build_errors` |
| `assetTools.ts` | `createAssetTools` | `generate_image`, `generate_and_publish_asset`, `publish_asset_deliverable`, `upload_asset`, `list_assets`, `optimize_image`, `generate_favicon_set` |
| `scaffoldTools.ts` | `createScaffoldTools` | `scaffold_component`, `scaffold_page`, `list_templates`, `clone_and_modify` |
| `deployPreviewTools.ts` | `createDeployPreviewTools` | `deploy_preview`, `get_deployment_status`, `list_deployments` |
| `figmaTools.ts` | `createFigmaTools` | `get_figma_file`, `export_figma_images`, `get_figma_image_fills`, `get_figma_components`, `get_figma_team_components`, `get_figma_styles`, `get_figma_team_styles`, `get_figma_comments`, `post_figma_comment`, `resolve_figma_comment`, `get_figma_file_metadata`, `get_figma_version_history`, `get_figma_team_projects`, `get_figma_project_files`, `get_figma_dev_resources`, `create_figma_dev_resource`, `manage_figma_webhooks` |
| `storybookTools.ts` | `createStorybookTools` | `storybook_list_stories`, `storybook_screenshot`, `storybook_screenshot_all`, `storybook_visual_diff`, `storybook_save_baseline`, `storybook_check_coverage`, `storybook_get_story_source` |
| `canvaTools.ts` | `createCanvaTools` | `create_canva_design`, `get_canva_design`, `search_canva_designs`, `list_canva_brand_templates`, `get_canva_template_fields`, `generate_canva_design`, `export_canva_design`, `upload_canva_asset` |
| `logoTools.ts` | `createLogoTools` | `create_logo_variation`, `restyle_logo`, `create_social_avatar` |

#### Marketing & Content

| Factory File | Function | Tools |
|-------------|----------|-------|
| `contentTools.ts` | `createContentTools` | `create_content_draft`, `update_content_draft`, `get_content_drafts`, `submit_content_for_review`, `approve_content_draft`, `reject_content_draft`, `publish_content`, `get_content_metrics`, `get_content_calendar`, `generate_content_image` |
| `seoTools.ts` | `createSeoTools` | `get_search_performance`, `track_keyword_rankings`, `analyze_page_seo`, `get_indexing_status`, `submit_sitemap`, `update_seo_data`, `get_backlink_profile` |
| `socialMediaTools.ts` | `createSocialMediaTools` | `schedule_social_post`, `get_scheduled_posts`, `get_social_metrics`, `get_post_performance`, `get_social_audience`, `reply_to_social`, `get_trending_topics` |
| `marketingIntelTools.ts` | `createMarketingIntelTools` | `create_experiment`, `get_experiment_results`, `monitor_competitor_marketing`, `analyze_market_trends`, `get_attribution_data`, `capture_lead`, `get_lead_pipeline`, `score_lead`, `get_marketing_dashboard` |
| `emailMarketingTools.ts` | `createEmailMarketingTools` | `get_mailchimp_lists`, `get_mailchimp_members`, `get_mailchimp_segments`, `create_mailchimp_campaign`, `set_campaign_content`, `send_test_campaign`, `send_campaign`, `get_campaign_report`, `get_campaign_list`, `manage_mailchimp_tags`, `send_transactional_email`, `get_mandrill_stats`, `search_mandrill_messages`, `get_mandrill_templates`, `render_mandrill_template` |
| `emailTools.ts` | `createEmailTools` | `send_email`, `read_inbox`, `reply_to_email` |
| `competitiveIntelTools.ts` | `createCompetitiveIntelTools` | `track_competitor`, `get_competitor_profile`, `update_competitor_profile`, `compare_features`, `track_competitor_pricing`, `monitor_competitor_launches`, `get_market_landscape` |

#### Finance

| Factory File | Function | Tools |
|-------------|----------|-------|
| `revenueTools.ts` | `createRevenueTools` | `get_mrr_breakdown`, `get_subscription_details`, `get_churn_analysis`, `get_revenue_forecast`, `get_stripe_invoices`, `get_customer_ltv` |
| `costManagementTools.ts` | `createCostManagementTools` | `get_vendor_costs`, `get_cost_anomalies`, `get_burn_rate`, `create_budget`, `check_budget_status` |
| `cashFlowTools.ts` | `createCashFlowTools` | `get_cash_balance`, `get_cash_flow`, `get_pending_transactions`, `generate_financial_report`, `get_margin_analysis` |

#### Engineering & DevOps

| Factory File | Function | Tools |
|-------------|----------|-------|
| `diagnosticTools.ts` | `createDiagnosticTools` | `check_table_schema`, `diagnose_column_error`, `list_tables`, `check_tool_health` |
| `engineeringGapTools.ts` | `createEngineeringGapTools` | `run_test_suite`, `get_code_coverage`, `get_quality_metrics`, `create_test_plan`, `get_container_logs`, `scale_service`, `get_build_queue`, `get_deployment_history`, `get_infrastructure_inventory`, `get_service_dependencies` |
| `opsExtensionTools.ts` | `createOpsExtensionTools` | `get_agent_health_dashboard`, `get_event_bus_health`, `get_data_freshness`, `get_system_costs_realtime`, `create_status_report`, `predict_capacity`, `get_access_matrix`, `provision_access`, `revoke_access`, `audit_access`, `rotate_secrets`, `get_platform_audit_log` |

#### Research

| Factory File | Function | Tools |
|-------------|----------|-------|
| `researchTools.ts` | `createResearchTools` | `web_search`, `web_fetch`, `search_news`, `submit_research_packet` |
| `researchRepoTools.ts` | `createResearchRepoTools` | `save_research`, `search_research`, `get_research_timeline`, `create_research_brief` |
| `researchMonitoringTools.ts` | `createResearchMonitoringTools` | `create_monitor`, `check_monitors`, `get_monitor_history`, `track_competitor_product`, `search_academic_papers`, `track_open_source`, `track_industry_events`, `track_regulatory_changes`, `analyze_ai_adoption`, `track_ai_benchmarks`, `analyze_org_structure`, `compile_research_digest`, `identify_research_gaps`, `cross_reference_findings` |

#### Product Analytics

| Factory File | Function | Tools |
|-------------|----------|-------|
| `productAnalyticsTools.ts` | `createProductAnalyticsTools` | `get_usage_metrics`, `get_funnel_analysis`, `get_cohort_retention`, `get_feature_usage`, `segment_users` |
| `userResearchTools.ts` | `createUserResearchTools` | `create_survey`, `get_survey_results`, `analyze_support_tickets`, `get_user_feedback`, `create_user_persona` |
| `roadmapTools.ts` | `createRoadmapTools` | `create_roadmap_item`, `score_feature_rice`, `get_roadmap`, `update_roadmap_item`, `get_feature_requests`, `manage_feature_flags` |

#### Legal & HR

| Factory File | Function | Tools |
|-------------|----------|-------|
| `docusignTools.ts` | `createDocuSignTools` | `create_signing_envelope`, `send_template_envelope`, `check_envelope_status`, `list_envelopes`, `void_envelope`, `resend_envelope` |
| `entraHRTools.ts` | `createEntraHRTools` | `entra_get_user_profile`, `entra_update_user_profile`, `entra_upload_user_photo`, `entra_set_manager`, `entra_hr_assign_license`, `entra_audit_profiles` |
| `hrTools.ts` | `createHRTools` | Deprecated local factory; HR tools now live on the MCP HR server |
| `legalTools.ts` | `createLegalTools` | Deprecated local factory; legal tools now live on the MCP legal server |

#### Pulse (Video/Media Product)

| Factory File | Function | Tools |
|-------------|----------|-------|
| `pulseTools.ts` | `createAllPulseTools` | `pulse_list_storyboards`, `pulse_get_storyboard`, `pulse_create_storyboard`, `pulse_generate_scene_images`, `pulse_suggest_scenes`, `pulse_storyboard_chat`, `pulse_generate_storyboard_script`, `pulse_generate_promo_scenes`, `pulse_create_hero_promo`, `pulse_create_multi_angle`, `pulse_create_product_showcase`, `pulse_create_narrative_storyboard`, `pulse_create_ad_storyboard`, `pulse_generate_voiceover_script`, `pulse_generate_video`, `pulse_poll_video_status`, `pulse_list_videos`, `pulse_delete_video`, `pulse_remix_video`, `pulse_batch_generate_videos`, `pulse_enhance_prompt`, `pulse_enhance_video_prompt`, `pulse_polish_scene_prompt`, `pulse_generate_concept_image`, `pulse_edit_image`, `pulse_upscale_image`, `pulse_expand_image`, `pulse_remove_background`, `pulse_extract_image_text`, `pulse_replace_image_text`, `pulse_transform_viral_image`, `pulse_product_recontext`, `pulse_doodle_to_image`, `pulse_upload_source_image`, `pulse_text_to_speech`, `pulse_generate_sound_effect`, `pulse_generate_music`, `pulse_generate_avatar`, `pulse_poll_avatar_status`, `pulse_generate_lipsync`, `pulse_poll_lipsync_status`, `pulse_kling_multi_shot`, `pulse_poll_multi_shot`, `pulse_analyze_brand_website`, `pulse_analyze_image_for_video`, `pulse_check_subscription`, `pulse_list_concept_images`, `pulse_list_brand_kits`, `pulse_create_share_link` |

---

## PART 3: Agent-to-Tool Mapping

### Legend
- **Core** = `createCoreTools` (15 tools — every agent)
- **Graph** = `createGraphTools` (4 tools — knowledge graph)
- **SP** = `createSharePointTools` (1 tool — SharePoint upload)
- **A365** = `createAgent365McpTools` (M365 MCP — dynamic tool count)
- **GMCP** = `createGlyphorMcpTools` (Glyphor MCP — dynamic tool count)
- **TeamOrch** = `createTeamOrchestrationTools` (4 tools)
- **PeerCoord** = `createPeerCoordinationTools` (3 tools)
- **Initiative** = `createInitiativeTools` (1 tool)
- **AgentCreate** = `createAgentCreationTools` (3 tools)
- **AgentDir** = `createAgentDirectoryTools` (2 tools)
- **ToolGrant** = `createToolGrantTools` (2 tools)
- **CI** = `createCollectiveIntelligenceTools` (13 tools)

### Executive Team

#### 1. `chief-of-staff` — Sarah Chen
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Orchestration | CI, AgentCreate, ToolGrant, AgentDir |
| Role-Specific | `createChiefOfStaffTools` (25 tools), `createOrchestrationTools` |
| A365 Filter | Full (ALL_M365_SERVERS) |
| GMCP Filter | Full (all servers) |

#### 2. `cto` — Marcus Reeves
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Orchestration | CI, TeamOrch, PeerCoord, Initiative, AgentCreate, ToolGrant, ToolRegistry, AgentDir |
| Role-Specific | `createCTOTools` (43 tools), `createDiagnosticTools` (4 tools) |
| Conditional | `createExecutiveOrchestrationTools` (when DB config enables canary decomposition) |
| A365 Filter | Full |
| GMCP Filter | Full |

#### 3. `cpo` — Elena Vasquez
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Orchestration | CI, ToolGrant, TeamOrch, PeerCoord, Initiative, AgentCreate, AgentDir |
| Role-Specific | `createCPOTools` (7 tools), `createProductAnalyticsTools` (5), `createCompetitiveIntelTools` (7), `createRoadmapTools` (6) |
| A365 Filter | Full |
| GMCP Filter | Full |

#### 4. `cmo` — Maya Brooks
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Orchestration | CI, ToolGrant, TeamOrch, PeerCoord, Initiative, AgentCreate, AgentDir |
| Role-Specific | `createCMOTools` (7), `createContentTools` (10), `createSeoTools` (7), `createSocialMediaTools` (7), `createMarketingIntelTools` (9), `createCanvaTools` (8), `createLogoTools` (3) |
| A365 Filter | Full |
| GMCP Filter | Full |

#### 5. `cfo` — Nadia Okafor
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Orchestration | CI, ToolGrant, TeamOrch, PeerCoord, Initiative, AgentCreate, AgentDir |
| Role-Specific | `createCFOTools` (10), `createRevenueTools` (6), `createCostManagementTools` (5), `createCashFlowTools` (5) |
| A365 Filter | Full |
| GMCP Filter | Full |

#### 6. `clo` — Victoria Chase
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Orchestration | ToolGrant, AgentCreate, AgentDir, CI |
| Role-Specific | `createDocuSignTools` (6) |
| A365 Filter | Full |
| GMCP Filter | Full |

#### 7. `vp-customer-success` — James Turner
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Orchestration | CI, ToolGrant, TeamOrch, PeerCoord, Initiative, AgentCreate, AgentDir |
| Role-Specific | `createVPCSTools` (8) |
| A365 Filter | Full |
| GMCP Filter | Full |

#### 8. `vp-sales` — Rachel Kim
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Orchestration | CI, ToolGrant, TeamOrch, PeerCoord, Initiative, AgentCreate, AgentDir |
| Role-Specific | `createVPSalesTools` (8) |
| A365 Filter | Full |
| GMCP Filter | Full |

#### 9. `vp-design` — Mia Tanaka
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Orchestration | CI, ToolGrant, TeamOrch, PeerCoord, Initiative, AgentCreate, AgentDir |
| Role-Specific | `createVPDesignTools` (16), `createFrontendCodeTools` (7), `createScreenshotTools` (4), `createDesignSystemTools` (7), `createAuditTools` (6), `createAssetTools` (7), `createScaffoldTools` (4), `createDeployPreviewTools` (3), `createFigmaTools` (17), `createStorybookTools` (7), `createCanvaTools` (8), `createLogoTools` (3) |
| A365 Filter | Full |
| GMCP Filter | Full |

#### 10. `vp-research` — Sophia Lin
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Orchestration | ToolGrant, TeamOrch, PeerCoord, Initiative |
| Role-Specific | `createResearchTools` (4, via createVPResearchTools), `createResearchRepoTools` (4), `createResearchMonitoringTools` (14) |
| A365 Filter | Full |
| GMCP Filter | Full |

#### 11. `ops` — Atlas Vega
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Orchestration | CI, ToolGrant |
| Role-Specific | `createOpsTools` (18), `createDiagnosticTools` (4), `createOpsExtensionTools` (12) |
| A365 Filter | Full |
| GMCP Filter | Full |

#### 12. `head-of-hr` — Jasmine Rivera
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Orchestration | ToolGrant, AgentCreate, AgentDir |
| Role-Specific | `createHeadOfHRTools` (12), `createAccessAuditTools` (2), `createEntraHRTools` (6) |
| A365 Filter | Full |
| GMCP Filter | Full |

#### 13. `global-admin` — Morgan Blake
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Orchestration | ToolGrant |
| Role-Specific | `createGlobalAdminTools` (30), `createOpsExtensionTools` (12) |
| A365 Filter | Full |
| GMCP Filter | Full |

#### 14. `m365-admin` — Riley Morgan
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Orchestration | ToolGrant |
| Role-Specific | `createM365AdminTools` (23) |
| A365 Filter | Full |
| GMCP Filter | Full |

### Engineering Sub-Team

#### 15. `platform-engineer` — Alex Park
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Role-Specific | `createPlatformEngineerTools` (11), `createDiagnosticTools` (4), `createEngineeringGapTools` (10) |

#### 16. `quality-engineer` — Sam DeLuca
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Role-Specific | `createQualityEngineerTools` (12), `createEngineeringGapTools` (10) |

#### 17. `devops-engineer` — Jordan Hayes
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Role-Specific | `createDevOpsEngineerTools` (20), `createDiagnosticTools` (4), `createEngineeringGapTools` (10) |

### Product Sub-Team

#### 18. `user-researcher` — Priya Sharma
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Role-Specific | `createUserResearcherTools` (7), `createProductAnalyticsTools` (5), `createUserResearchTools` (5) |

#### 19. `competitive-intel` — Daniel Ortiz
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Role-Specific | `createCompetitiveIntelTools` (role, 8), `createCompetitiveIntelTools` (shared, 7) |

### Finance Sub-Team

#### 20. `revenue-analyst` — Anna Park
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Role-Specific | `createRevenueAnalystTools` (8), `createRevenueTools` (6), `createCashFlowTools` (5) |

#### 21. `cost-analyst` — Omar Hassan
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Role-Specific | `createCostAnalystTools` (10), `createCostManagementTools` (5), `createCashFlowTools` (5) |

### Marketing Sub-Team

#### 22. `content-creator` — Tyler Reed
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Role-Specific | `createContentCreatorTools` (7), `createContentTools` (10) |

#### 23. `seo-analyst` — Lisa Chen
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Role-Specific | `createSeoAnalystTools` (7), `createSeoTools` (7) |

#### 24. `social-media-manager` — Kai Johnson
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Role-Specific | `createSocialMediaManagerTools` (7), `createSocialMediaTools` (7) |

### Customer Success Sub-Team

#### 25. `onboarding-specialist` — Emma Wright
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Role-Specific | `createOnboardingSpecialistTools` (8) |

#### 26. `support-triage` — David Santos
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Role-Specific | `createSupportTriageTools` (7) |

### Sales Sub-Team

#### 27. `account-research` — Nathan Cole
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Role-Specific | `createAccountResearchTools` (8), `createResearchRepoTools` (4), `createResearchMonitoringTools` (14) |

### Design Sub-Team

#### 28. `ui-ux-designer` — Leo Vargas
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Role-Specific | `createUiUxDesignerTools` (4), `createFrontendCodeTools` (7), `createScreenshotTools` (4), `createDesignSystemTools` (7), `createAssetTools` (7), `createFigmaTools` (17), `createLogoTools` (3) |

#### 29. `frontend-engineer` — Ava Chen
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, A365, GMCP |
| Role-Specific | `createFrontendEngineerTools` (9), `createFrontendCodeTools` (7), `createScreenshotTools` (4), `createAuditTools` (6), `createScaffoldTools` (4), `createDeployPreviewTools` (3), `createStorybookTools` (7), `createSharePointTools` (1) |

#### 30. `design-critic` — Sofia Marchetti
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, A365, GMCP |
| Role-Specific | `createDesignCriticTools` (4), `createFrontendCodeTools` (7), `createScreenshotTools` (4), `createDesignSystemTools` (7), `createAuditTools` (6), `createFigmaTools` (17), `createStorybookTools` (7), `createSharePointTools` (1) |

#### 31. `template-architect` — Ryan Park
| Category | Factories |
|----------|-----------|
| Core | Core, Graph, A365, GMCP |
| Role-Specific | `createTemplateArchitectTools` (5), `createFrontendCodeTools` (7), `createDesignSystemTools` (7), `createAssetTools` (7), `createScaffoldTools` (4), `createFigmaTools` (17), `createStorybookTools` (7), `createSharePointTools` (1), `createLogoTools` (3) |

### Research Team (all use same pattern)

#### 32-37. Research Analysts (Lena Park, Daniel Okafor, Kai Nakamura, Amara Diallo, Riya Mehta, Marcus Chen)

All 6 research analysts + VP-Research share the same tool pattern:

| Category | Factories |
|----------|-----------|
| Core | Core, Graph, SP, A365, GMCP |
| Role-Specific | `createResearchTools` (4: `web_search`, `web_fetch`, `search_news`, `submit_research_packet`), `createResearchRepoTools` (4), `createResearchMonitoringTools` (14) |

---

## PART 4: Tool Subsets (Scheduled Task Restrictions)

When an agent runs a **scheduled task** (not on-demand), its tools are restricted to a subset. `null` = no restriction (full access). Every restricted subset automatically includes the **WORK_COMPLETION_TOOLS** base set:

**WORK_COMPLETION_TOOLS (8 tools):**
`save_memory`, `recall_memories`, `read_my_assignments`, `submit_assignment_output`, `flag_assignment_blocker`, `send_agent_message`, `check_messages`, `request_tool_access`

### Defined Subsets

#### `chief-of-staff`
| Task | Allowed Tools (+ WORK_COMPLETION_TOOLS) |
|------|----------------------------------------|
| `orchestrate` | `read_founder_directives`, `create_work_assignments`, `dispatch_assignment`, `check_assignment_status`, `update_directive_progress`, `read_company_doctrine`, `get_company_pulse` |
| `morning_briefing` | `get_company_pulse`, `get_recent_activity`, `get_pending_decisions`, `get_financials`, `read_company_memory`, `send_briefing` |
| `eod_summary` | `get_recent_activity`, `get_pending_decisions`, `get_financials`, `read_company_memory`, `send_briefing` |
| `proactive` | `null` (unrestricted) |

#### `cto`
| Task | Allowed Tools (+ WORK_COMPLETION_TOOLS) |
|------|----------------------------------------|
| `platform_health_check` | `get_platform_health`, `get_cloud_run_metrics`, `get_infrastructure_costs`, `get_ci_health`, `get_repo_stats`, `query_vercel_health`, `write_health_report` |
| `proactive` | `null` (unrestricted) |

#### `cfo`
| Task | Allowed Tools (+ WORK_COMPLETION_TOOLS) |
|------|----------------------------------------|
| `daily_cost_check` | `get_financials`, `calculate_unit_economics`, `query_stripe_mrr`, `query_stripe_subscriptions`, `write_financial_report` |
| `proactive` | `null` (unrestricted) |

#### `cpo`
| Task | Allowed Tools (+ WORK_COMPLETION_TOOLS) |
|------|----------------------------------------|
| `weekly_usage_analysis` | `get_company_pulse`, `get_org_knowledge`, `query_knowledge_graph`, `web_search`, `web_fetch` |
| `proactive` | `null` (unrestricted) |

#### `cmo`
| Task | Allowed Tools (+ WORK_COMPLETION_TOOLS) |
|------|----------------------------------------|
| `weekly_content_planning` | `web_search`, `web_fetch`, `mcp:marketing:schedule_social_post`, `mcp:marketing:get_analytics` |
| `generate_content` | `web_search`, `web_fetch`, `mcp:marketing:schedule_social_post`, `mcp:marketing:get_analytics`, `mcp:marketing:get_search_console_data` |
| `proactive` | `null` (unrestricted) |

#### `ops`
| Task | Allowed Tools (+ WORK_COMPLETION_TOOLS) |
|------|----------------------------------------|
| `health_check` | `get_platform_health`, `get_cloud_run_metrics`, `get_infrastructure_costs`, `query_vercel_health`, `write_health_report` |
| `freshness_check` | `get_recent_activity`, `get_org_knowledge`, `read_company_memory` |
| `cost_check` | `get_infrastructure_costs`, `get_financials`, `write_health_report` |
| `proactive` | `null` (unrestricted) |

#### `vp-customer-success`
| Task | Allowed Tools (+ WORK_COMPLETION_TOOLS) |
|------|----------------------------------------|
| `daily_health_scoring` | `get_company_pulse`, `get_org_knowledge`, `query_knowledge_graph` |
| `proactive` | `null` (unrestricted) |

#### `vp-sales`
| Task | Allowed Tools (+ WORK_COMPLETION_TOOLS) |
|------|----------------------------------------|
| `pipeline_review` | `get_company_pulse`, `get_org_knowledge`, `web_search`, `web_fetch` |
| `proactive` | `null` (unrestricted) |

### Agents Without Subset Restrictions

All other agents (sub-team members, design team, research team, HR, IT admins, CLO) have **no tool subset restrictions** — their scheduled tasks run with full access to all tools loaded in their `run.ts`.

---

## Appendix: Wake Rules (Event-Driven Triggers)

| Event | Wakes | Task | Priority |
|-------|-------|------|----------|
| `teams_bot_dm` (founder) | Target agent | `founder_request` | Immediate |
| `dashboard_on_demand` | Target agent | `on_demand` | Immediate |
| `customer.subscription.created` | VP-CS, VP-Sales | `new_customer_welcome` | Immediate |
| `customer.subscription.deleted` | VP-CS, CFO | `churn_response` | Immediate |
| `invoice.payment_failed` | CFO, VP-CS | `payment_failure_response` | Immediate |
| `agent_message` (urgent) | Target agent | `urgent_message_response` | Immediate |
| `alert.triggered` (critical) | CTO, Ops, CoS | `incident_response` | Immediate |
| `alert.triggered` (cost warning) | CFO | `cost_alert_response` | Next heartbeat |
| `decision.resolved` | Proposer | `decision_follow_up` | Immediate |
| `health_check_failure` | CTO, Ops | `incident_response` | Immediate |
| `meeting.completed` | Action item owners | `meeting_follow_up` | Next heartbeat |
| `agent.spawned` | Head of HR | `onboard_agent` | Immediate |
| `assignment.submitted` | Assigner | `orchestrate` | Immediate |
| `assignment.blocked` | Assigner | `orchestrate` | Immediate |
| `assignment.revised` | Target agent | `work_loop` | Immediate |
| `message.sent` | Recipient | `work_loop` | Next heartbeat |
| `escalation.created` | CoS | `orchestrate` | Immediate |
| `directive.delegated` | Delegatee | `orchestrate` | Immediate |
| `initiative.directive_completed` | CoS | `orchestrate` | Immediate |
| `deliverable.published` | CoS | `orchestrate` | Immediate |

## Appendix: Data Sync Jobs

| Job | Schedule | Endpoint |
|-----|----------|----------|
| Stripe Sync | 12:00 AM CT daily | `/sync/stripe` |
| GCP Billing | 1:00 AM CT daily | `/sync/gcp-billing` |
| Mercury Bank | 2:00 AM CT daily | `/sync/mercury` |
| OpenAI Billing | 3:00 AM CT daily | `/sync/openai-billing` |
| Anthropic Billing | 3:00 AM CT daily | `/sync/anthropic-billing` |
| Kling Billing | 3:00 AM CT daily | `/sync/kling-billing` |
| SharePoint Knowledge | 4:00 AM CT daily | `/sync/sharepoint-knowledge` |
| Heartbeat | Every 10 min | `/heartbeat` |
| Memory Consolidation | 3:00 UTC daily | `/memory/consolidate` |
| Batch Outcome Eval | 2:00 AM & 2:00 PM UTC | `/batch-eval/run` |
| Policy Proposal Collection | 3:00 AM & 3:00 PM UTC | `/policy/collect` |
| Policy Replay Eval | 5:00 UTC daily | `/policy/evaluate` |
| Policy Canary Check | Every 4 hours | `/policy/canary-check` |
| Canary Evaluation | Mon 8:00 AM UTC weekly | `/canary/evaluate` |
| Memory Archival | Sun 4:00 UTC weekly | `/memory/archive` |
| Tool Expiration Check | 6:00 UTC daily | `/tools/expire` |

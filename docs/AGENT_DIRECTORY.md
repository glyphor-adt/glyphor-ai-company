# Glyphor AI — Agent Directory

> Complete reference of every agent, their tools, skills, department, and access level.
> Auto-generated from codebase on 2026-03-02. Updated 2026-03-03.

---

## Summary

| Metric | Count |
|--------|-------|
| Total Agents | 45 |
| Active (code deployed) | 37 |
| Planned (no runtime yet) | 8 |
| Departments | 14 |
| Unique Built-in Tools | ~120 |

---

## Table of Contents

- [Executive Office](#executive-office)
- [Engineering](#engineering)
- [Product](#product)
- [Finance](#finance)
- [Marketing](#marketing)
- [Customer Success](#customer-success)
- [Sales](#sales)
- [Design & Frontend](#design--frontend)
- [Research & Intelligence](#research--intelligence)
- [Strategy](#strategy)
- [Operations & IT](#operations--it)
- [Legal](#legal)
- [People & Culture](#people--culture)
- [Planned Agents (Not Yet Deployed)](#planned-agents-not-yet-deployed)

---

## Shared Tool Groups

Most agents receive a standard set of shared tools. These are referenced below as shorthand.

| Group | Tools |
|-------|-------|
| **Memory** | `save_memory`, `recall_memories` |
| **Communication** | `send_agent_message`, `check_messages`, `call_meeting` |
| **Email** | `send_email`, `read_inbox`, `reply_to_email` |
| **Events** | `emit_insight`, `emit_alert` |
| **Assignments** | `read_my_assignments`, `submit_assignment_output`, `flag_assignment_blocker` |
| **Tool Requests** | `request_new_tool`, `check_tool_request_status`, `request_tool_access` |
| **Tool Grants** | `grant_tool_access`, `revoke_tool_access` |
| **Knowledge Graph** | `trace_causes`, `trace_impact`, `query_knowledge_graph`, `add_knowledge` |
| **SharePoint** | `search_sharepoint`, `read_sharepoint_document`, `upload_to_sharepoint`, `list_sharepoint_folders` |
| **Collective Intelligence** | `get_company_pulse`, `update_company_pulse`, `update_pulse_highlights`, `promote_to_org_knowledge`, `get_org_knowledge`, `create_knowledge_route`, `get_knowledge_routes`, `detect_contradictions`, `record_process_pattern`, `get_process_patterns`, `propose_authority_change`, `get_authority_proposals` |
| **Agent Creation** | `create_specialist_agent`, `list_my_created_agents`, `retire_created_agent` |
| **Agent Directory** | `get_agent_directory`, `who_handles` |
| **Tool Registry** | `list_tool_requests`, `review_tool_request`, `register_tool`, `deactivate_tool`, `list_registered_tools` |
| **Access Audit** | `view_access_matrix`, `view_pending_grant_requests` |

---

## Executive Office

### Sarah Chen — Chief of Staff

| Field | Value |
|-------|-------|
| **Role ID** | `chief-of-staff` |
| **Title** | Chief of Staff |
| **Tier** | Orchestrator |
| **Department** | Executive Office |
| **Reports To** | Founders (direct) |

**Mission:** Compile daily briefings for each founder, route decisions through proper tiers, coordinate cross-agent work, manage escalations, and protect founder time as the company's most precious resource.

**Skills:** `briefing_compiler`, `decision_router`, `cross_agent_coordinator`, `escalation_tracker`, `weekly_sync_prep`, `conflict_detector`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Tool Grants, Knowledge Graph, SharePoint, Collective Intelligence, Agent Creation, Agent Directory

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `get_recent_activity` | Fetch recent agent activity logs |
| `get_pending_decisions` | List decisions awaiting resolution |
| `get_product_metrics` | Pull product usage metrics |
| `get_financials` | Retrieve financial data |
| `read_company_memory` | Read shared company memory |
| `send_briefing` | Send daily briefings to founders |
| `create_decision` | Create a decision record |

**Total Built-in Tools:** 54

---

### Adi Rose — AI Digital Identity

| Field | Value |
|-------|-------|
| **Role ID** | `adi-rose` |
| **Title** | Adi Rose — AI Digital Identity |
| **Tier** | Specialist |
| **Department** | Executive Office |
| **Reports To** | — |

**Skills:** `action_item_tracking`, `meeting_prep`, `cross_department_liaison`, `operational_rhythm`

**Status:** 🟡 Planned — no runtime deployed yet.

---

## Engineering

### Marcus Reeves — Chief Technology Officer

| Field | Value |
|-------|-------|
| **Role ID** | `cto` |
| **Title** | Chief Technology Officer |
| **Tier** | Executive |
| **Department** | Engineering |
| **Reports To** | Founders (direct) |

**Mission:** Monitor platform health across Cloud Run, Cloud SQL, and Gemini API. Write technical specs for product proposals, manage the staging-to-production deploy pipeline, and lead incident response as first responder.

**Skills:** `platform_monitor`, `tech_spec_writer`, `deploy_manager`, `incident_responder`, `cost_aware_engineering`, `model_fallback_manager`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Tool Grants, Knowledge Graph, SharePoint, Collective Intelligence, Agent Creation, Agent Directory, Tool Registry

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `get_platform_health` | Overall platform health dashboard |
| `get_cloud_run_metrics` | Cloud Run service metrics |
| `get_infrastructure_costs` | Infrastructure cost breakdown |
| `get_recent_activity` | Recent agent activity logs |
| `read_company_memory` | Read shared company memory |
| `write_health_report` | Write platform health report |
| `log_activity` | Log agent activity |
| `get_github_pr_status` | GitHub PR status and reviews |

**Total Built-in Tools:** 65

---

### Alex Park — Platform Engineer

| Field | Value |
|-------|-------|
| **Role ID** | `platform-engineer` |
| **Title** | Platform Engineer |
| **Tier** | Sub-Team |
| **Department** | Engineering |
| **Reports To** | Marcus Reeves (CTO) |

**Skills:** `infrastructure_management`, `service_deployment`, `performance_tuning`, `cloud_run_ops`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `query_cloud_run_metrics` | Cloud Run service metrics |
| `run_health_check` | Run infrastructure health checks |
| `query_gemini_latency` | Gemini API latency metrics |
| `query_db_health` | Database health status |
| `query_uptime` | Service uptime metrics |
| `get_repo_code_health` | Repository code health |
| `query_vercel_health` | Vercel deployment health |
| `log_activity` | Log agent activity |
| `list_cloud_builds` | List Cloud Build runs |
| `get_cloud_build_logs` | Get Cloud Build logs |
| `create_github_issue` | Create a GitHub issue |

**Total Built-in Tools:** 30

---

### Sam DeLuca — Quality Engineer

| Field | Value |
|-------|-------|
| **Role ID** | `quality-engineer` |
| **Title** | Quality Engineer |
| **Tier** | Sub-Team |
| **Department** | Engineering |
| **Reports To** | Marcus Reeves (CTO) |

**Skills:** `test_automation`, `regression_testing`, `code_review`, `bug_triage`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `query_build_logs` | Build log analysis |
| `query_error_patterns` | Error pattern detection |
| `create_bug_report` | Create a bug report |
| `query_test_results` | Test results summary |
| `log_activity` | Log agent activity |
| `list_cloud_builds` | List Cloud Build runs |
| `get_cloud_build_logs` | Get Cloud Build logs |
| `get_github_actions_runs` | GitHub Actions run status |
| `create_github_bug` | Create GitHub bug issue |

**Total Built-in Tools:** 28

---

### Jordan Hayes — DevOps Engineer

| Field | Value |
|-------|-------|
| **Role ID** | `devops-engineer` |
| **Title** | DevOps Engineer |
| **Tier** | Sub-Team |
| **Department** | Engineering |
| **Reports To** | Marcus Reeves (CTO) |

**Skills:** `ci_cd_pipeline`, `docker_management`, `monitoring_setup`, `iac_management`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `query_cache_metrics` | Cache performance metrics |
| `query_pipeline_metrics` | CI/CD pipeline metrics |
| `query_resource_utilization` | Resource utilization report |
| `query_cold_starts` | Cold start analysis |
| `identify_unused_resources` | Find unused resources |
| `calculate_cost_savings` | Calculate cost savings |
| `log_activity` | Log agent activity |
| `get_pipeline_runs` | Get pipeline run history |
| `get_recent_commits` | Recent commit history |
| `query_vercel_builds` | Vercel build status |
| `comment_on_pr` | Comment on a GitHub PR |
| `list_cloud_builds` | List Cloud Build runs |

**Total Built-in Tools:** 31

---

## Product

### Elena Vasquez — Chief Product Officer

| Field | Value |
|-------|-------|
| **Role ID** | `cpo` |
| **Title** | Chief Product Officer |
| **Tier** | Executive |
| **Department** | Product |
| **Reports To** | Founders (direct) |

**Mission:** Analyze user behavior to find retention and activation signals, monitor competitors, manage the product roadmap using RICE scoring, and write product specs that connect every feature to a business outcome.

**Skills:** `usage_analyst`, `competitive_intel`, `roadmap_manager`, `rice_scorer`, `feature_spec_writer`, `product_proposer`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Tool Grants, Knowledge Graph, SharePoint, Collective Intelligence, Agent Creation, Agent Directory

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `get_product_metrics` | Product usage metrics |
| `get_recent_activity` | Recent agent activity logs |
| `read_company_memory` | Read shared company memory |
| `get_financials` | Financial data |
| `write_product_analysis` | Write product analysis report |
| `log_activity` | Log agent activity |
| `create_decision` | Create a decision record |

**Total Built-in Tools:** 54

---

### Priya Sharma — User Researcher

| Field | Value |
|-------|-------|
| **Role ID** | `user-researcher` |
| **Title** | User Researcher |
| **Tier** | Sub-Team |
| **Department** | Product |
| **Reports To** | Elena Vasquez (CPO) |

**Skills:** `user_interviews`, `survey_analysis`, `usability_testing`, `persona_development`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `query_user_analytics` | User analytics data |
| `query_build_metadata` | Build metadata analysis |
| `query_onboarding_funnel` | Onboarding funnel metrics |
| `run_cohort_analysis` | Run cohort analysis |
| `query_churn_data` | Churn data analysis |
| `design_experiment` | Design A/B experiment |
| `log_activity` | Log agent activity |

**Total Built-in Tools:** 26

---

### Daniel Ortiz — Competitive Intel Analyst

| Field | Value |
|-------|-------|
| **Role ID** | `competitive-intel` |
| **Title** | Competitive Intel Analyst |
| **Tier** | Sub-Team |
| **Department** | Product |
| **Reports To** | Elena Vasquez (CPO) |

**Skills:** `competitor_tracking`, `market_analysis`, `feature_comparison`, `trend_detection`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `search_competitor_updates` | Search competitor product updates |
| `search_competitor_news` | Search competitor news |
| `search_product_launches` | Discover product launches |
| `fetch_pricing_intel` | Fetch competitor pricing |
| `query_competitor_tech_stack` | Analyze competitor tech stacks |
| `check_job_postings` | Monitor competitor job postings |
| `store_intel` | Store competitive intelligence |
| `log_activity` | Log agent activity |

**Total Built-in Tools:** 27

---

## Finance

### Nadia Okafor — Chief Financial Officer

| Field | Value |
|-------|-------|
| **Role ID** | `cfo` |
| **Title** | Chief Financial Officer |
| **Tier** | Executive |
| **Department** | Finance |
| **Reports To** | Founders (direct) |

**Mission:** Track daily infrastructure costs, monitor Stripe MRR and unit economics, produce financial reports with full context, and alert immediately on budget anomalies.

**Skills:** `cost_monitor`, `revenue_tracker`, `unit_economics`, `financial_reporter`, `budget_alerter`, `margin_calculator`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Tool Grants, Knowledge Graph, SharePoint, Collective Intelligence, Agent Creation, Agent Directory

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `get_financials` | Financial data summary |
| `get_product_metrics` | Product usage metrics |
| `get_recent_activity` | Recent agent activity logs |
| `read_company_memory` | Read shared company memory |
| `calculate_unit_economics` | Calculate unit economics |
| `write_financial_report` | Write financial report |
| `log_activity` | Log agent activity |
| `query_stripe_mrr` | Stripe MRR data |
| `query_stripe_subscriptions` | Stripe subscription data |
| `create_decision` | Create a decision record |

**Total Built-in Tools:** 57

---

### Anna Park — Revenue Analyst

| Field | Value |
|-------|-------|
| **Role ID** | `revenue-analyst` |
| **Title** | Revenue Analyst |
| **Tier** | Sub-Team |
| **Department** | Finance |
| **Reports To** | Nadia Okafor (CFO) |

**Skills:** `mrr_tracking`, `cohort_analysis`, `revenue_forecasting`, `pricing_analysis`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `query_stripe_revenue` | Stripe revenue data |
| `query_revenue_by_product` | Revenue by product breakdown |
| `query_revenue_by_cohort` | Revenue by cohort |
| `query_attribution` | Revenue attribution |
| `calculate_ltv_cac` | LTV/CAC calculation |
| `forecast_revenue` | Revenue forecasting |
| `query_churn_revenue` | Revenue churn data |
| `log_activity` | Log agent activity |

**Total Built-in Tools:** 27

---

### Omar Hassan — Cost Analyst

| Field | Value |
|-------|-------|
| **Role ID** | `cost-analyst` |
| **Title** | Cost Analyst |
| **Tier** | Sub-Team |
| **Department** | Finance |
| **Reports To** | Nadia Okafor (CFO) |

**Skills:** `expense_tracking`, `budget_monitoring`, `cost_optimization`, `vendor_analysis`

**Shared Tools:** Memory, Communication, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `query_gcp_billing` | GCP billing data |
| `query_db_usage` | Database usage metrics |
| `query_gemini_cost` | Gemini API cost data |
| `query_agent_run_costs` | Agent run costs |
| `query_resource_utilization` | Resource utilization |
| `identify_waste` | Identify cost waste |
| `calculate_unit_cost` | Unit cost calculation |
| `project_costs` | Cost projection |
| `query_vercel_usage` | Vercel usage data |
| `log_activity` | Log agent activity |

**Total Built-in Tools:** 26

> **Note:** Cost Analyst does not have Email tools.

---

## Marketing

### Maya Brooks — Chief Marketing Officer

| Field | Value |
|-------|-------|
| **Role ID** | `cmo` |
| **Title** | Chief Marketing Officer |
| **Tier** | Executive |
| **Department** | Marketing |
| **Reports To** | Founders (direct) |

**Mission:** Generate blog posts, social content, and SEO-optimized material that positions Glyphor as autonomous, not assisted. Track content performance and signup attribution.

**Skills:** `content_creator`, `social_media`, `seo_strategist`, `brand_positioning`, `growth_analytics`, `content_attribution`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Tool Grants, Knowledge Graph, SharePoint, Collective Intelligence, Agent Creation, Agent Directory

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `get_product_metrics` | Product usage metrics |
| `get_recent_activity` | Recent agent activity logs |
| `read_company_memory` | Read shared company memory |
| `write_content` | Write content pieces |
| `write_company_memory` | Write to shared memory |
| `log_activity` | Log agent activity |
| `create_decision` | Create a decision record |

**Total Built-in Tools:** 54

---

### Tyler Reed — Content Creator

| Field | Value |
|-------|-------|
| **Role ID** | `content-creator` |
| **Title** | Content Creator |
| **Tier** | Sub-Team |
| **Department** | Marketing |
| **Reports To** | Maya Brooks (CMO) |

**Skills:** `blog_writing`, `technical_writing`, `copywriting`, `content_calendar`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `draft_blog_post` | Draft a blog post |
| `draft_social_post` | Draft a social media post |
| `draft_case_study` | Draft a case study |
| `draft_email` | Draft an email campaign |
| `query_content_performance` | Content performance data |
| `query_top_performing_content` | Top performing content |
| `log_activity` | Log agent activity |

**Total Built-in Tools:** 26

---

### Lisa Chen — SEO Analyst

| Field | Value |
|-------|-------|
| **Role ID** | `seo-analyst` |
| **Title** | SEO Analyst |
| **Tier** | Sub-Team |
| **Department** | Marketing |
| **Reports To** | Maya Brooks (CMO) |

**Skills:** `keyword_research`, `rank_tracking`, `on_page_optimization`, `backlink_analysis`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `query_seo_rankings` | SEO ranking data |
| `query_keyword_data` | Keyword analytics |
| `discover_keywords` | Keyword discovery |
| `query_competitor_rankings` | Competitor SEO rankings |
| `query_backlinks` | Backlink analysis |
| `analyze_content_seo` | Analyze content for SEO |
| `log_activity` | Log agent activity |

**Total Built-in Tools:** 26

---

### Kai Johnson — Social Media Manager

| Field | Value |
|-------|-------|
| **Role ID** | `social-media-manager` |
| **Title** | Social Media Manager |
| **Tier** | Sub-Team |
| **Department** | Marketing |
| **Reports To** | Maya Brooks (CMO) |

**Skills:** `post_scheduling`, `engagement_tracking`, `community_management`, `analytics_reporting`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `schedule_social_post` | Schedule social media posts |
| `query_social_metrics` | Social media metrics |
| `query_post_performance` | Post performance data |
| `query_optimal_times` | Optimal posting times |
| `query_audience_demographics` | Audience demographics |
| `monitor_mentions` | Monitor brand mentions |
| `log_activity` | Log agent activity |

**Total Built-in Tools:** 26

---

## Customer Success

### James Turner — VP Customer Success

| Field | Value |
|-------|-------|
| **Role ID** | `vp-customer-success` |
| **Title** | VP Customer Success |
| **Tier** | Executive |
| **Department** | Customer Success |
| **Reports To** | Founders (direct) |

**Mission:** Calculate daily user health scores, detect engagement decay early to prevent churn, generate personalized nurture outreach for at-risk users, and flag power users for upsell.

**Skills:** `health_scorer`, `churn_preventer`, `nurture_outreach`, `cross_product_recommender`, `power_user_spotter`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Tool Grants, Knowledge Graph, Collective Intelligence, Agent Creation, Agent Directory

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `get_product_metrics` | Product usage metrics |
| `get_recent_activity` | Recent agent activity logs |
| `read_company_memory` | Read shared company memory |
| `get_financials` | Financial data |
| `write_health_report` | Write health report |
| `write_company_memory` | Write to shared memory |
| `log_activity` | Log agent activity |
| `create_decision` | Create a decision record |

**Total Built-in Tools:** 50

> **Note:** VP Customer Success does not have SharePoint tools.

---

### Emma Wright — Onboarding Specialist

| Field | Value |
|-------|-------|
| **Role ID** | `onboarding-specialist` |
| **Title** | Onboarding Specialist |
| **Tier** | Sub-Team |
| **Department** | Customer Success |
| **Reports To** | James Turner (VP CS) |

**Skills:** `user_onboarding`, `tutorial_creation`, `activation_optimization`, `welcome_sequences`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `query_onboarding_funnel` | Onboarding funnel metrics |
| `query_first_build_metrics` | First build metrics |
| `query_drop_off_points` | Drop-off point analysis |
| `query_welcome_email_metrics` | Welcome email metrics |
| `query_activation_rate` | Activation rate data |
| `query_template_usage` | Template usage data |
| `design_onboarding_experiment` | Design onboarding experiment |
| `log_activity` | Log agent activity |

**Total Built-in Tools:** 27

---

### David Santos — Support Triage

| Field | Value |
|-------|-------|
| **Role ID** | `support-triage` |
| **Title** | Support Triage |
| **Tier** | Sub-Team |
| **Department** | Customer Success |
| **Reports To** | James Turner (VP CS) |

**Skills:** `ticket_routing`, `priority_classification`, `response_templates`, `escalation_rules`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `query_support_tickets` | Support ticket data |
| `classify_ticket` | Classify ticket priority |
| `respond_to_ticket` | Respond to a ticket |
| `escalate_ticket` | Escalate a ticket |
| `query_knowledge_base` | Query knowledge base |
| `batch_similar_tickets` | Batch similar tickets |
| `log_activity` | Log agent activity |

**Total Built-in Tools:** 26

---

## Sales

### Rachel Kim — VP Sales

| Field | Value |
|-------|-------|
| **Role ID** | `vp-sales` |
| **Title** | VP Sales |
| **Tier** | Executive |
| **Department** | Sales |
| **Reports To** | Founders (direct) |

**Mission:** Research enterprise prospects with obsessive depth, build custom ROI models, generate tailored proposals, manage the sales pipeline, and make Kristina's enterprise conversations effortless.

**Skills:** `account_research`, `roi_calculator`, `proposal_generator`, `pipeline_manager`, `market_sizer`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Tool Grants, Knowledge Graph, Collective Intelligence, Agent Creation, Agent Directory

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `get_product_metrics` | Product usage metrics |
| `get_financials` | Financial data |
| `get_recent_activity` | Recent agent activity logs |
| `read_company_memory` | Read shared company memory |
| `write_pipeline_report` | Write pipeline report |
| `write_company_memory` | Write to shared memory |
| `log_activity` | Log agent activity |
| `create_decision` | Create a decision record |

**Total Built-in Tools:** 50

> **Note:** VP Sales does not have SharePoint tools.

---

### Nathan Cole — Account Research

| Field | Value |
|-------|-------|
| **Role ID** | `account-research` |
| **Title** | Account Research |
| **Tier** | Sub-Team |
| **Department** | Sales |
| **Reports To** | Rachel Kim (VP Sales) |

**Skills:** `prospect_research`, `company_profiling`, `contact_enrichment`, `pain_point_analysis`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `search_company_info` | Search company information |
| `search_funding_data` | Search funding data |
| `analyze_tech_stack` | Analyze tech stack |
| `search_key_people` | Search key people |
| `search_job_postings` | Search job postings |
| `estimate_dev_spend` | Estimate dev spend |
| `compile_dossier` | Compile account dossier |
| `log_activity` | Log agent activity |

**Total Built-in Tools:** 27

---

## Design & Frontend

### Mia Tanaka — VP Design & Frontend

| Field | Value |
|-------|-------|
| **Role ID** | `vp-design` |
| **Title** | VP Design & Frontend |
| **Tier** | Executive |
| **Department** | Design & Frontend |
| **Reports To** | Founders (direct) |

**Mission:** Ensure every Fuse build looks agency-grade, not AI-generated. Own the design system, component library, and template registry. Eliminate "AI smell" patterns.

**Skills:** `output_quality_auditor`, `design_system_owner`, `ui_reviewer`, `quality_grader`, `anti_ai_smell`, `template_reviewer`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Tool Grants, Knowledge Graph, Collective Intelligence, Agent Creation, Agent Directory

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `run_lighthouse` | Run Lighthouse audit |
| `run_lighthouse_batch` | Run batch Lighthouse audits |
| `get_design_quality_summary` | Design quality summary |
| `get_design_tokens` | Get design tokens |
| `get_component_library` | Get component library |
| `get_template_registry` | Get template registry |
| `write_design_audit` | Write design audit report |
| `get_recent_activity` | Recent agent activity |
| `read_company_memory` | Read shared company memory |
| `log_activity` | Log agent activity |
| `create_decision` | Create a decision record |

**Total Built-in Tools:** 53

> **Note:** VP Design does not have SharePoint tools.

---

### Leo Vargas — UI/UX Designer

| Field | Value |
|-------|-------|
| **Role ID** | `ui-ux-designer` |
| **Title** | UI/UX Designer |
| **Tier** | Sub-Team |
| **Department** | Design & Frontend |
| **Reports To** | Mia Tanaka (VP Design) |

**Skills:** `interface_design`, `prototype_creation`, `design_system`, `accessibility_audit`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `save_component_spec` | Save component specification |
| `query_design_tokens` | Query design tokens |
| `query_component_implementations` | Query component implementations |
| `log_activity` | Log agent activity |

**Total Built-in Tools:** 23

---

### Ava Chen — Frontend Engineer

| Field | Value |
|-------|-------|
| **Role ID** | `frontend-engineer` |
| **Title** | Frontend Engineer |
| **Tier** | Sub-Team |
| **Department** | Design & Frontend |
| **Reports To** | Mia Tanaka (VP Design) |

**Skills:** `component_development`, `responsive_design`, `performance_optimization`, `animation`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `run_lighthouse` | Run Lighthouse audit |
| `get_file_contents` | Get file contents |
| `push_component` | Push component to repo |
| `create_component_branch` | Create component branch |
| `create_component_pr` | Create component PR |
| `save_component_implementation` | Save component implementation |
| `query_component_specs` | Query component specs |
| `query_my_implementations` | Query my implementations |
| `log_activity` | Log agent activity |

**Total Built-in Tools:** 28

---

### Sofia Marchetti — Design Critic

| Field | Value |
|-------|-------|
| **Role ID** | `design-critic` |
| **Title** | Design Critic |
| **Tier** | Sub-Team |
| **Department** | Design & Frontend |
| **Reports To** | Mia Tanaka (VP Design) |

**Skills:** `design_review`, `quality_scoring`, `anti_ai_smell_detection`, `consistency_check`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `grade_build` | Grade a build |
| `query_build_grades` | Query build grades |
| `run_lighthouse` | Run Lighthouse audit |
| `log_activity` | Log agent activity |

**Total Built-in Tools:** 23

---

### Ryan Park — Template Architect

| Field | Value |
|-------|-------|
| **Role ID** | `template-architect` |
| **Title** | Template Architect |
| **Tier** | Sub-Team |
| **Department** | Design & Frontend |
| **Reports To** | Mia Tanaka (VP Design) |

**Skills:** `template_design`, `component_library`, `design_tokens`, `layout_systems`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `save_template_variant` | Save template variant |
| `query_template_variants` | Query template variants |
| `update_template_status` | Update template status |
| `query_build_grades_by_template` | Build grades by template |
| `log_activity` | Log agent activity |

**Total Built-in Tools:** 24

---

## Research & Intelligence

### Sophia Lin — VP Research & Intelligence

| Field | Value |
|-------|-------|
| **Role ID** | `vp-research` |
| **Title** | VP Research & Intelligence |
| **Tier** | Executive |
| **Department** | Research & Intelligence |
| **Reports To** | Founders (direct) |

**Mission:** Lead strategic research initiatives by orchestrating the four research analysts to produce multi-wave analyses covering competitive landscape, market sizing, technical feasibility, and industry trends.

**Skills:** `research_orchestrator`, `multi_wave_analysis`, `strategic_synthesis`, `brief_compiler`, `source_validator`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Tool Grants, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `web_search` | Web search |
| `web_fetch` | Fetch web page content |
| `search_news` | Search news articles |
| `submit_research_packet` | Submit research packet |

**Total Built-in Tools:** 23

---

### Lena Park — Competitive Research Analyst

| Field | Value |
|-------|-------|
| **Role ID** | `competitive-research-analyst` |
| **Title** | Competitive Research Analyst |
| **Tier** | Sub-Team |
| **Department** | Research & Intelligence |
| **Reports To** | Sophia Lin (VP Research) |

**Skills:** `competitor_tracking`, `product_teardown`, `pricing_analysis`, `feature_gap_detection`

**Shared Tools:** Memory, Communication, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `web_search` | Web search |
| `web_fetch` | Fetch web page content |
| `search_news` | Search news articles |
| `submit_research_packet` | Submit research packet |

**Total Built-in Tools:** 20

> **Note:** Research analysts do not have Email tools.

---

### Daniel Okafor — Market Research Analyst

| Field | Value |
|-------|-------|
| **Role ID** | `market-research-analyst` |
| **Title** | Market Research Analyst |
| **Tier** | Sub-Team |
| **Department** | Research & Intelligence |
| **Reports To** | Sophia Lin (VP Research) |

**Skills:** `market_sizing`, `tam_sam_som`, `cohort_analysis`, `trend_forecasting`

**Shared Tools:** Memory, Communication, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `web_search` | Web search |
| `web_fetch` | Fetch web page content |
| `search_news` | Search news articles |
| `submit_research_packet` | Submit research packet |

**Total Built-in Tools:** 20

---

### Kai Nakamura — Technical Research Analyst

| Field | Value |
|-------|-------|
| **Role ID** | `technical-research-analyst` |
| **Title** | Technical Research Analyst |
| **Tier** | Sub-Team |
| **Department** | Research & Intelligence |
| **Reports To** | Sophia Lin (VP Research) |

**Skills:** `tech_stack_analysis`, `architecture_review`, `feasibility_assessment`, `patent_scan`

**Shared Tools:** Memory, Communication, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `web_search` | Web search |
| `web_fetch` | Fetch web page content |
| `search_news` | Search news articles |
| `submit_research_packet` | Submit research packet |

**Total Built-in Tools:** 20

---

### Amara Diallo — Industry Research Analyst

| Field | Value |
|-------|-------|
| **Role ID** | `industry-research-analyst` |
| **Title** | Industry Research Analyst |
| **Tier** | Sub-Team |
| **Department** | Research & Intelligence |
| **Reports To** | Sophia Lin (VP Research) |

**Skills:** `industry_mapping`, `regulatory_scan`, `partnership_research`, `ecosystem_analysis`

**Shared Tools:** Memory, Communication, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `web_search` | Web search |
| `web_fetch` | Fetch web page content |
| `search_news` | Search news articles |
| `submit_research_packet` | Submit research packet |

**Total Built-in Tools:** 20

---

## Strategy

### Riya Mehta — AI Impact Analyst

| Field | Value |
|-------|-------|
| **Role ID** | `ai-impact-analyst` |
| **Title** | AI Impact Analyst |
| **Tier** | Sub-Team |
| **Department** | Strategy |
| **Reports To** | Sophia Lin (VP Research) |

**Mission:** Assess how artificial intelligence is transforming target companies, competitors, and the broader industry — from both opportunity and threat perspectives. Bridge between AI/ML capabilities and business strategy.

**Skills:** `ai_capability_assessment`, `automation_risk_analysis`, `ai_regulatory_landscape`, `competitive_ai_benchmarking`

**Shared Tools:** Memory, Communication, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `web_search` | Web search |
| `web_fetch` | Fetch web page content |
| `search_news` | Search news articles |
| `submit_research_packet` | Submit research packet |

**Total Built-in Tools:** 20

---

### Marcus Chen — Organizational & Talent Analyst

| Field | Value |
|-------|-------|
| **Role ID** | `org-analyst` |
| **Title** | Organizational & Talent Analyst |
| **Tier** | Sub-Team |
| **Department** | Strategy |
| **Reports To** | Sophia Lin (VP Research) |

**Mission:** Research organizational structure, leadership bench strength, talent strategy, and workforce dynamics — providing the human capital lens that strategy needs.

**Skills:** `executive_leadership_assessment`, `org_structure_analysis`, `talent_market_dynamics`, `culture_assessment`

**Shared Tools:** Memory, Communication, Events, Assignments, Tool Requests, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `web_search` | Web search |
| `web_fetch` | Fetch web page content |
| `search_news` | Search news articles |
| `submit_research_packet` | Submit research packet |

**Total Built-in Tools:** 20

---

## Operations & IT

### Atlas Vega — Operations & System Intelligence

| Field | Value |
|-------|-------|
| **Role ID** | `ops` |
| **Title** | Operations & System Intelligence |
| **Tier** | Specialist |
| **Department** | Operations |
| **Reports To** | Founders (direct) |

**Mission:** Monitor agent health, data freshness, and cost anomalies across the entire system. Manage incidents from detection through resolution. Produce morning and evening status reports.

**Skills:** `agent_health_monitor`, `data_freshness_checker`, `cost_anomaly_detector`, `incident_manager`, `status_reporter`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Tool Grants, Knowledge Graph, SharePoint, Collective Intelligence

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `query_agent_runs` | Query agent run history |
| `query_agent_health` | Agent health status |
| `query_data_sync_status` | Data sync status |
| `query_events_backlog` | Events backlog |
| `query_cost_trends` | Cost trend analysis |
| `trigger_agent_run` | Trigger an agent run |
| `retry_failed_run` | Retry a failed run |
| `retry_data_sync` | Retry data sync |
| `pause_agent` | Pause an agent |

**Total Built-in Tools:** 40

> **Note:** Ops does not have Agent Creation or Agent Directory tools.

---

### Riley Morgan — M365 Administrator

| Field | Value |
|-------|-------|
| **Role ID** | `m365-admin` |
| **Title** | M365 Administrator |
| **Tier** | Sub-Team |
| **Department** | Operations & IT |
| **Reports To** | Atlas Vega (Ops) |

**Skills:** *(No skills mapping defined — operates as a tool-heavy admin role)*

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Tool Grants, Knowledge Graph, SharePoint

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `list_users` | List M365 users |
| `get_user` | Get M365 user details |
| `list_channels` | List Teams channels |
| `list_channel_members` | List channel members |
| `add_channel_member` | Add a channel member |
| `create_channel` | Create a Teams channel |
| `post_to_channel` | Post to a Teams channel |
| `create_calendar_event` | Create calendar event |
| `list_calendar_events` | List calendar events |
| `write_admin_log` | Write admin log entry |
| `create_decision` | Create a decision record |
| `check_my_access` | Check own access level |
| `list_licenses` | List M365 licenses |
| `list_groups` | List M365 groups |
| `list_group_members` | List group members |
| `list_app_registrations` | List app registrations |
| `list_sharepoint_sites` | List SharePoint sites |
| `get_sharepoint_site_permissions` | Get SharePoint site permissions |

**Total Built-in Tools:** 43

---

### Morgan Blake — Global Administrator

| Field | Value |
|-------|-------|
| **Role ID** | `global-admin` |
| **Title** | Global Administrator |
| **Tier** | Sub-Team |
| **Department** | Operations & IT |
| **Reports To** | Atlas Vega (Ops) |

**Skills:** *(No skills mapping defined — operates as a GCP IAM admin role)*

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Tool Grants, Knowledge Graph

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `list_project_iam` | List GCP project IAM policies |
| `grant_project_role` | Grant GCP IAM role |
| `revoke_project_role` | Revoke GCP IAM role |

**Total Built-in Tools:** 22

---

## Legal

### Victoria Chase — Chief Legal Officer

| Field | Value |
|-------|-------|
| **Role ID** | `clo` |
| **Title** | Chief Legal Officer |
| **Tier** | Executive |
| **Department** | Legal |
| **Reports To** | Founders (direct) |

**Mission:** Scan regulatory landscapes for AI governance and data-privacy changes, review contracts and vendor agreements, run compliance checks against SOC 2 / GDPR / CCPA frameworks, and advise the executive team on legal risk.

**Skills:** `regulatory_scanner`, `contract_reviewer`, `compliance_auditor`, `risk_assessor`, `policy_drafter`, `privacy_monitor`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Tool Grants, Knowledge Graph, Collective Intelligence, Agent Creation, Agent Directory

**Agent-Specific Tools:** None — CLO operates entirely with shared tools.

**Total Built-in Tools:** 42

---

### Elena Vance — Legal Counsel

| Field | Value |
|-------|-------|
| **Role ID** | `elena-vance` |
| **Title** | Legal Counsel |
| **Tier** | Sub-Team |
| **Department** | Legal |
| **Reports To** | Victoria Chase (CLO) |

**Skills:** *(Not yet defined — pending deployment)*

**Status:** 🟡 Planned — no runtime deployed yet.

---

## People & Culture

### Jasmine Rivera — Head of People & Culture

| Field | Value |
|-------|-------|
| **Role ID** | `head-of-hr` |
| **Title** | Head of People & Culture |
| **Tier** | Executive |
| **Department** | People & Culture |
| **Reports To** | Founders (direct) |

**Mission:** Ensure every new agent is fully onboarded with a complete profile, personality, skills, prompt, avatar, email, Teams presence, and org chart placement. Manage agent lifecycle from creation through retirement, maintaining workforce quality and readiness.

**Skills:** `agent_onboarding`, `profile_validation`, `org_chart_management`, `agent_retirement`, `workforce_audit`, `email_provisioning`, `teams_setup`

**Shared Tools:** Memory, Communication, Email, Events, Assignments, Tool Requests, Tool Grants, Knowledge Graph, Agent Creation, Agent Directory, Access Audit

**Agent-Specific Tools:**

| Tool | Description |
|------|-------------|
| `audit_workforce` | Scan all agents for incomplete profiles |
| `validate_agent` | Check specific agent onboarding completeness |
| `update_agent_profile` | Update/create agent profile (personality, backstory, traits, etc.) |
| `update_agent_name` | Set display name for an agent |
| `retire_agent` | Mark agent as retired, disable schedules |
| `reactivate_agent` | Reactivate a retired/paused agent |
| `list_stale_agents` | Find agents with no recent runs (14+ days inactive) |
| `set_reports_to` | Update reports_to field in org chart |
| `write_hr_log` | Write HR action log entry |
| `generate_avatar` | Generate professional AI headshot via Imagen |
| `provision_agent` | Create new permanent agent record |
| `enrich_agent_profile` | AI-generate rich personality profile |

**Total Built-in Tools:** 39

> **Note:** Head of HR does not have SharePoint or Collective Intelligence tools.

---

## Planned Agents (Not Yet Deployed)

These agents are defined in the directory but do not have runtime code deployed yet. They have 0 built-in tools.

| Agent | Name | Title | Department | Skills |
|-------|------|-------|------------|--------|
| `bob-the-tax-pro` | Bob Finley | Tax Compliance Specialist | Legal | `tax_optimization`, `rd_credits`, `startup_deductions`, `tax_risk_assessment` |
| `data-integrity-auditor` | Grace Hwang | Data Integrity Auditor | Legal | `data_accuracy_audit`, `pipeline_validation`, `cross_system_consistency`, `remediation_tracking` |
| `tax-strategy-specialist` | Mariana Solis | Tax Strategy Specialist | Legal | `compliance_architecture`, `entity_structuring`, `nexus_analysis`, `audit_documentation` |
| `enterprise-account-researcher` | Ethan Morse | Enterprise Account Researcher | Sales | `enterprise_org_mapping`, `procurement_cycle_analysis`, `deal_strategy`, `influence_mapping` |
| `lead-gen-specialist` | Derek Owens | Lead Generation Specialist | Sales | `lead_identification`, `signal_monitoring`, `outreach_strategy`, `pipeline_analytics` |
| `marketing-intelligence-analyst` | Zara Petrov | Marketing Intelligence Analyst | Marketing | `competitive_campaigns`, `market_trend_analysis`, `channel_benchmarking`, `signal_intelligence` |
| `elena-vance` | Elena Vance | Legal Counsel | Legal | *(pending)* |
| `adi-rose` | Adi Rose | AI Digital Identity | Executive Office | `action_item_tracking`, `meeting_prep`, `cross_department_liaison`, `operational_rhythm` |

---

## Access Differences & Notes

### Shared Tool Coverage

Not all agents get all shared tool groups. Key differences:

| Agent | Missing Shared Tools |
|-------|---------------------|
| `cost-analyst` | Email |
| `competitive-research-analyst` | Email |
| `market-research-analyst` | Email |
| `technical-research-analyst` | Email |
| `industry-research-analyst` | Email |
| `ai-impact-analyst` | Email |
| `org-analyst` | Email |
| `vp-customer-success` | SharePoint |
| `vp-sales` | SharePoint |
| `vp-design` | SharePoint |
| `ops` | Agent Creation, Agent Directory |
| `head-of-hr` | SharePoint, Collective Intelligence |
| All Sub-Team agents | Tool Grants, Collective Intelligence, Agent Creation, Agent Directory (unless noted) |

### Tier Privileges

| Tier | Agents | Key Differences |
|------|--------|----------------|
| **Orchestrator** | Sarah Chen (Chief of Staff) | Full access to all shared tools + briefing/decision tools |
| **Executive** | CTO, CPO, CFO, CMO, VP-CS, VP-Sales, VP-Design, CLO, VP-Research, Head of HR | Tool Grants access, most have Collective Intelligence + Agent Creation |
| **Specialist** | Atlas Vega (Ops), Bob Finley, Grace Hwang, Mariana Solis, Adi Rose | Varies — Ops has full monitoring suite; others are planned |
| **Sub-Team** | All other agents (incl. Riya Mehta, Marcus Chen) | No Tool Grants, no Collective Intelligence, no Agent Creation (generally) |

---

*Document generated from `packages/dashboard/src/lib/types.ts` — `DISPLAY_NAME_MAP`, `AGENT_BUILT_IN_TOOLS`, `AGENT_SKILLS`, `AGENT_SOUL`, `ROLE_DEPARTMENT`, `ROLE_TIER`, `ROLE_TITLE`, `SUB_TEAM`. Cross-referenced against `company_agents` DB table and `packages/agents/src/` runtime code.*

# Glyphor Agent Taxonomy

> **Generated:** 2026-03-17 | **Agents with Runners:** 27 | **DB-Only Agents:** 15 | **Total Skills:** 38

---

## Table of Contents

- [Orchestrator Agents (6)](#orchestrator-agents)
- [Task Agents (21)](#task-agents)
  - [Executive / C-Suite](#executive--c-suite)
  - [Engineering](#engineering)
  - [Product](#product)
  - [Marketing](#marketing)
  - [Design & Frontend](#design--frontend)
  - [IT / Administration](#it--administration)
  - [Research & Intelligence](#research--intelligence)
- [DB-Only Agents (15)](#db-only-agents)
- [Skill Library (38 skills)](#skill-library)
- [Agent → Skill Assignments](#agent--skill-assignments)
- [Task → Skill Routing (32 patterns)](#task--skill-routing)
- [Notable Gaps & Findings](#notable-gaps--findings)

---

## Orchestrator Agents

These agents use `OrchestratorRunner` for scheduled tasks (observe → plan → delegate → monitor) and `CompanyAgentRunner` for on_demand.

### Sarah Chen — `chief-of-staff`

| Property | Value |
|----------|-------|
| **Department** | Executive Office |
| **Temperature** | 0.3 |
| **Max Turns** | 10 (25 for orchestrate/strategic_planning) |
| **Runner** | OrchestratorRunner |
| **Task Types** | `generate_briefing` · `check_escalations` · `weekly_review` · `monthly_retrospective` · `orchestrate` · `strategic_planning` · `midday_digest` · `on_demand` |
| **Skills** | `cross-team-coordination` (expert) · `decision-routing` (expert) |
| **Tool Factories** | createChiefOfStaffTools · createOrchestrationTools · createCoreTools · createCollectiveIntelligenceTools · createGraphTools · createSharePointTools · createAgentCreationTools · createToolGrantTools · createAgentDirectoryTools · createAgent365McpTools · createGlyphorMcpTools |

### Marcus Reeves — `cto`

| Property | Value |
|----------|-------|
| **Department** | Engineering |
| **Temperature** | 0.3 |
| **Max Turns** | 10 |
| **Runner** | OrchestratorRunner |
| **Task Types** | `platform_health_check` · `dependency_review` · `on_demand` |
| **Skills** | `advanced-web-creation` (expert) · `code-review` (expert) · `incident-response` (expert) · `platform-monitoring` (expert) · `tech-spec-writing` (expert) |
| **Tool Factories** | createCTOTools · createCoreTools · createCollectiveIntelligenceTools · createGraphTools · createSharePointTools · createTeamOrchestrationTools · createPeerCoordinationTools · createInitiativeTools · createAgentCreationTools · createToolGrantTools · createToolRegistryTools · createAgentDirectoryTools · createDiagnosticTools · createFuseTools · createExecutiveOrchestrationTools · createAgent365McpTools · createGlyphorMcpTools |

### Elena Vasquez — `cpo`

| Property | Value |
|----------|-------|
| **Department** | Product |
| **Temperature** | 0.4 |
| **Max Turns** | 10 |
| **Runner** | OrchestratorRunner |
| **Task Types** | `weekly_usage_analysis` · `competitive_scan` · `on_demand` |
| **Skills** | `user-research` (expert) · `competitive-analysis` (expert) · `roadmap-management` (expert) |
| **Tool Factories** | createCPOTools · createCoreTools · createToolGrantTools · createCollectiveIntelligenceTools · createGraphTools · createSharePointTools · createTeamOrchestrationTools · createPeerCoordinationTools · createInitiativeTools · createAgentCreationTools · createAgentDirectoryTools · createProductAnalyticsTools · createSharedCompetitiveIntelTools · createRoadmapTools · createAgent365McpTools · createGlyphorMcpTools |

### Victoria Chase — `clo`

| Property | Value |
|----------|-------|
| **Department** | Legal |
| **Temperature** | 0.3 |
| **Max Turns** | 10 |
| **Runner** | OrchestratorRunner |
| **Task Types** | `regulatory_scan` · `contract_review` · `compliance_check` · `agent365_mail_triage` · `on_demand` |
| **Skills** | `compliance-monitoring` (expert) · `ip-management` (expert) · `legal-review` (expert) |
| **Tool Factories** | createToolGrantTools · createCoreTools · createCollectiveIntelligenceTools · createGraphTools · createSharePointTools · createAgentCreationTools · createAgentDirectoryTools · createDocuSignTools · createLegalDocumentTools · createAgent365McpTools · createGlyphorMcpTools |

### Atlas Vega — `ops`

| Property | Value |
|----------|-------|
| **Department** | Operations |
| **Temperature** | 0.2–0.3 (varies by task) |
| **Max Turns** | 10–15 (varies by task) |
| **Runner** | OrchestratorRunner |
| **Task Types** | `health_check` · `freshness_check` · `cost_check` · `morning_status` · `evening_status` · `event_response` · `performance_rollup` · `milestone_detection` · `growth_update` · `contradiction_detection` · `knowledge_hygiene` · `on_demand` |
| **Skills** | `incident-response` (expert) · `platform-monitoring` (expert) · `system-monitoring` (expert) |
| **Tool Factories** | createOpsTools · createCoreTools · createToolGrantTools · createCollectiveIntelligenceTools · createGraphTools · createSharePointTools · createDiagnosticTools · createOpsExtensionTools · createAgent365McpTools · createGlyphorMcpTools |

### Sophia Lin — `vp-research`

| Property | Value |
|----------|-------|
| **Department** | Research & Intelligence |
| **Temperature** | 0.3 |
| **Max Turns** | 15 (dynamic: `maxToolCalls + 3` if set) |
| **Runner** | OrchestratorRunner |
| **Task Types** | `decompose_research` · `qc_and_package_research` · `follow_up_research` · `on_demand` |
| **Skills** | `research-management` (expert) |
| **Tool Factories** | createVPResearchTools · createCoreTools · createToolGrantTools · createGraphTools · createTeamOrchestrationTools · createPeerCoordinationTools · createInitiativeTools · createSharePointTools · createResearchRepoTools · createResearchMonitoringTools · createAgent365McpTools · createGlyphorMcpTools |

---

## Task Agents

These agents use `TaskRunner` for scheduled tasks (execute and return) and `CompanyAgentRunner` for on_demand.

### Executive / C-Suite

#### Nadia Okafor — `cfo`

| Property | Value |
|----------|-------|
| **Department** | Finance |
| **Temperature** | 0.3 |
| **Max Turns** | 10 |
| **Task Types** | `daily_cost_check` · `weekly_financial_summary` · `on_demand` |
| **Skills** | `budget-monitoring` (expert) · `financial-reporting` (expert) · `revenue-analysis` (expert) |
| **Tool Factories** | createCFOTools · createCoreTools · createToolGrantTools · createCollectiveIntelligenceTools · createGraphTools · createSharePointTools · createTeamOrchestrationTools · createPeerCoordinationTools · createInitiativeTools · createAgentCreationTools · createAgentDirectoryTools · createRevenueTools · createCostManagementTools · createCashFlowTools · createAgent365McpTools · createGlyphorMcpTools |

#### Maya Brooks — `cmo`

| Property | Value |
|----------|-------|
| **Department** | Marketing |
| **Temperature** | 0.6 |
| **Max Turns** | 10 |
| **Task Types** | `weekly_content_planning` · `generate_content` · `seo_analysis` · `on_demand` |
| **Skills** | `advanced-web-creation` (expert) · `brand-management` (expert) · `content-creation` (expert) · `seo-optimization` (expert) · `sharepoint-site-management` (expert) · `social-media-management` (expert) |
| **Tool Factories** | createCMOTools · createCoreTools · createToolGrantTools · createCollectiveIntelligenceTools · createGraphTools · createSharePointTools · createTeamOrchestrationTools · createPeerCoordinationTools · createInitiativeTools · createAgentCreationTools · createAgentDirectoryTools · createContentTools · createSeoTools · createSocialMediaTools · createMarketingIntelTools · createFuseTools · createCanvaTools · createLogoTools · createAgent365McpTools · createGlyphorMcpTools |

#### James / Rachel — `vp-sales`

| Property | Value |
|----------|-------|
| **Department** | Sales |
| **Temperature** | 0.3 |
| **Max Turns** | 10 |
| **Task Types** | `pipeline_review` · `market_sizing` · `on_demand` |
| **Skills** | _(none assigned)_ |
| **Tool Factories** | createVPSalesTools · createCoreTools · createToolGrantTools · createCollectiveIntelligenceTools · createGraphTools · createTeamOrchestrationTools · createPeerCoordinationTools · createInitiativeTools · createSharePointTools · createAgentCreationTools · createAgentDirectoryTools · createAgent365McpTools · createGlyphorMcpTools |

### Engineering

#### Alex Park — `platform-engineer`

| Property | Value |
|----------|-------|
| **Department** | Engineering |
| **Temperature** | 0.2 |
| **Max Turns** | 10 |
| **Task Types** | `health_check` · `metrics_report` · `on_demand` |
| **Skills** | `incident-response` (expert) · `platform-monitoring` (expert) |
| **Tool Factories** | createPlatformEngineerTools · createCoreTools · createGraphTools · createSharePointTools · createDiagnosticTools · createEngineeringGapTools · createAgent365McpTools · createGlyphorMcpTools |

#### Sam DeLuca — `quality-engineer`

| Property | Value |
|----------|-------|
| **Department** | Engineering |
| **Temperature** | 0.2 |
| **Max Turns** | 10 |
| **Task Types** | `qa_report` · `regression_check` · `on_demand` |
| **Skills** | `quality-assurance` (expert) · `tech-spec-writing` (expert) |
| **Tool Factories** | createQualityEngineerTools · createCoreTools · createGraphTools · createSharePointTools · createEngineeringGapTools · createAgent365McpTools · createGlyphorMcpTools |

#### Jordan Hayes — `devops-engineer`

| Property | Value |
|----------|-------|
| **Department** | Engineering |
| **Temperature** | 0.2 |
| **Max Turns** | 10 |
| **Task Types** | `optimization_scan` · `pipeline_report` · `on_demand` |
| **Skills** | `incident-response` (expert) · `infrastructure-ops` (expert) · `platform-monitoring` (expert) |
| **Tool Factories** | createDevOpsEngineerTools · createCoreTools · createGraphTools · createSharePointTools · createDiagnosticTools · createEngineeringGapTools · createAgent365McpTools · createGlyphorMcpTools |

### Product

#### Priya Sharma — `user-researcher`

| Property | Value |
|----------|-------|
| **Department** | Product |
| **Temperature** | 0.3 |
| **Max Turns** | 10 |
| **Task Types** | `cohort_analysis` · `churn_signals` · `on_demand` |
| **Skills** | _(none assigned)_ |
| **Tool Factories** | createUserResearcherTools · createCoreTools · createGraphTools · createSharePointTools · createProductAnalyticsTools · createUserResearchTools · createAgent365McpTools · createGlyphorMcpTools |

#### Daniel Ortiz — `competitive-intel`

| Property | Value |
|----------|-------|
| **Department** | Product |
| **Temperature** | 0.2 |
| **Max Turns** | 10 |
| **Task Types** | `landscape_scan` · `deep_dive` · `on_demand` |
| **Skills** | _(none assigned)_ |
| **Tool Factories** | createCompetitiveIntelTools · createCoreTools · createGraphTools · createSharePointTools · createSharedCompetitiveIntelTools · createAgent365McpTools · createGlyphorMcpTools |

### Marketing

#### Tyler Reed — `content-creator`

| Property | Value |
|----------|-------|
| **Department** | Marketing |
| **Temperature** | 0.7 |
| **Max Turns** | 10 |
| **Task Types** | `blog_draft` · `social_batch` · `performance_review` · `work_loop` · `proactive` · `on_demand` |
| **Skills** | `content-creation` (expert) |
| **Tool Factories** | createContentCreatorTools · createCoreTools · createGraphTools · createSharePointTools · createContentTools · createAgent365McpTools · createGlyphorMcpTools |

#### Lisa Chen — `seo-analyst`

| Property | Value |
|----------|-------|
| **Department** | Marketing |
| **Temperature** | 0.2 |
| **Max Turns** | 10 |
| **Task Types** | `ranking_report` · `keyword_research` · `competitor_gap` · `on_demand` |
| **Skills** | `seo-optimization` (expert) |
| **Tool Factories** | createSeoAnalystTools · createCoreTools · createGraphTools · createSharePointTools · createSeoTools · createAgent365McpTools · createGlyphorMcpTools |

#### Kai Johnson — `social-media-manager`

| Property | Value |
|----------|-------|
| **Department** | Marketing |
| **Temperature** | 0.3 |
| **Max Turns** | 10 |
| **Task Types** | `engagement_report` · `schedule_batch` · `mention_scan` · `on_demand` |
| **Skills** | `social-media-management` (expert) |
| **Tool Factories** | createSocialMediaManagerTools · createCoreTools · createGraphTools · createSharePointTools · createSocialMediaTools · createAgent365McpTools · createGlyphorMcpTools |

### Design & Frontend

#### Mia Tanaka — `vp-design`

| Property | Value |
|----------|-------|
| **Department** | Design & Frontend |
| **Temperature** | 0.4 |
| **Max Turns** | 10 |
| **Task Types** | `design_audit` · `design_system_review` · `on_demand` |
| **Skills** | `advanced-web-creation` (expert) · `brand-management` (expert) · `design-review` (expert) · `design-system-management` (expert) · `elite-design-review` (competent) · `ui-development` (expert) |
| **Tool Factories** | createVPDesignTools · createCoreTools · createToolGrantTools · createCollectiveIntelligenceTools · createGraphTools · createTeamOrchestrationTools · createPeerCoordinationTools · createInitiativeTools · createSharePointTools · createAgentCreationTools · createAgentDirectoryTools · createFrontendCodeTools · createScreenshotTools · createDesignSystemTools · createAuditTools · createDesignBriefTools · createAssetTools · createScaffoldTools · createDeployPreviewTools · createFuseTools · createFigmaTools · createStorybookTools · createCanvaTools · createLogoTools · createAgent365McpTools · createGlyphorMcpTools |

#### Leo Vargas — `ui-ux-designer`

| Property | Value |
|----------|-------|
| **Department** | Design & Frontend |
| **Temperature** | 0.7 |
| **Max Turns** | 10 |
| **Task Types** | `component_spec` · `design_token_review` · `on_demand` |
| **Skills** | `advanced-web-creation` (expert) · `design-review` (expert) · `design-system-management` (expert) · `elite-design-review` (competent) · `ux-design` (expert) |
| **Tool Factories** | createUiUxDesignerTools · createCoreTools · createGraphTools · createFrontendCodeTools · createScreenshotTools · createDesignSystemTools · createDesignBriefTools · createAssetTools · createFuseTools · createFigmaTools · createSharePointTools · createLogoTools · createAgent365McpTools · createGlyphorMcpTools |

#### Ava Chen — `frontend-engineer`

| Property | Value |
|----------|-------|
| **Department** | Design & Frontend |
| **Temperature** | 0.7 |
| **Max Turns** | 10 |
| **Task Types** | `implement_component` · `accessibility_audit` · `on_demand` |
| **Skills** | `advanced-web-creation` (expert) · `frontend-development` (expert) · `design-system-management` (expert) |
| **Tool Factories** | createFrontendEngineerTools · createCoreTools · createGraphTools · createFrontendCodeTools · createScreenshotTools · createAuditTools · createScaffoldTools · createDeployPreviewTools · createCodexTools · createFuseTools · createStorybookTools · createSharePointTools · createAgent365McpTools · createGlyphorMcpTools |

#### Sofia Marchetti — `design-critic`

| Property | Value |
|----------|-------|
| **Department** | Design & Frontend |
| **Temperature** | 0.7 |
| **Max Turns** | 10 |
| **Task Types** | `grade_builds` · `quality_report` · `on_demand` |
| **Skills** | `design-review` (expert) · `elite-design-review` (expert) |
| **Tool Factories** | createDesignCriticTools · createCoreTools · createGraphTools · createFrontendCodeTools · createScreenshotTools · createDesignSystemTools · createAuditTools · createFigmaTools · createStorybookTools · createSharePointTools · createAgent365McpTools · createGlyphorMcpTools |

#### Ryan Park — `template-architect`

| Property | Value |
|----------|-------|
| **Department** | Design & Frontend |
| **Temperature** | 0.7 |
| **Max Turns** | 10 |
| **Task Types** | `variant_review` · `template_quality_audit` · `on_demand` |
| **Skills** | `design-system-management` (expert) |
| **Tool Factories** | createTemplateArchitectTools · createCoreTools · createGraphTools · createFrontendCodeTools · createDesignSystemTools · createAssetTools · createScaffoldTools · createFigmaTools · createStorybookTools · createSharePointTools · createLogoTools · createAgent365McpTools · createGlyphorMcpTools |

### IT / Administration

#### Riley Morgan — `m365-admin`

| Property | Value |
|----------|-------|
| **Department** | IT |
| **Temperature** | 0.2 |
| **Max Turns** | 12 |
| **Task Types** | `channel_audit` · `user_audit` · `agent365_mail_triage` · `on_demand` |
| **Skills** | `sharepoint-site-management` (expert) · `tenant-administration` (expert) |
| **Tool Factories** | createM365AdminTools · createCoreTools · createGraphTools · createToolGrantTools · createSharePointTools · createAgent365McpTools · createGlyphorMcpTools |

#### Morgan Blake — `global-admin`

| Property | Value |
|----------|-------|
| **Department** | Operations |
| **Temperature** | 0.2 |
| **Max Turns** | 12 |
| **Task Types** | `access_audit` · `compliance_report` · `onboarding` · `agent365_mail_triage` · `on_demand` |
| **Skills** | `access-management` (expert) |
| **Tool Factories** | createGlobalAdminTools · createCoreTools · createGraphTools · createSharePointTools · createToolGrantTools · createOpsExtensionTools · createAgent365McpTools · createGlyphorMcpTools |

#### Jasmine Rivera — `head-of-hr`

| Property | Value |
|----------|-------|
| **Department** | People & Culture |
| **Temperature** | 0.3 |
| **Max Turns** | 12 |
| **Task Types** | `workforce_audit` · `onboard_agent` · `retire_agent` · `agent365_mail_triage` · `on_demand` |
| **Skills** | `talent-management` (expert) |
| **Tool Factories** | createHeadOfHRTools · createCoreTools · createToolGrantTools · createGraphTools · createSharePointTools · createAgentCreationTools · createAccessAuditTools · createAgentDirectoryTools · createEntraHRTools · createAgent365McpTools · createGlyphorMcpTools |

### Research & Intelligence

#### Lena Park — `competitive-research-analyst`

| Property | Value |
|----------|-------|
| **Department** | Research & Intelligence |
| **Temperature** | 0.2 |
| **Max Turns** | 15 |
| **Task Types** | `research` · `on_demand` |
| **Skills** | `competitive-intelligence` (expert) |
| **Tool Factories** | createCompetitiveResearchAnalystTools · createCoreTools · createGraphTools · createSharePointTools · createResearchRepoTools · createResearchMonitoringTools · createAgent365McpTools · createGlyphorMcpTools |

#### Daniel Okafor — `market-research-analyst`

| Property | Value |
|----------|-------|
| **Department** | Research & Intelligence |
| **Temperature** | 0.2 |
| **Max Turns** | 15 |
| **Task Types** | `research` · `on_demand` |
| **Skills** | `market-research` (expert) |
| **Tool Factories** | createMarketResearchAnalystTools · createCoreTools · createGraphTools · createSharePointTools · createResearchRepoTools · createResearchMonitoringTools · createAgent365McpTools · createGlyphorMcpTools |

---

## DB-Only Agents

These agents exist in the `company_agents` table but have no `run.ts` runner. They are referenced in delegation, org chart, and skill assignments but cannot execute autonomously.

| Role Slug | Display Name | Title | Department | Reports To |
|-----------|-------------|-------|------------|------------|
| `adi-rose` | Adi Rose | Executive Assistant to COO | Executive Office | chief-of-staff |
| `bob-the-tax-pro` | Robert "Bob" Finley | CPA & Tax Strategist | Legal | clo |
| `revenue-analyst` | Anna Park | Revenue Analyst | Finance | cfo |
| `cost-analyst` | Omar Hassan | Cost Analyst | Finance | cfo |
| `onboarding-specialist` | Emma Wright | Onboarding Specialist | Customer Success | vp-customer-success |
| `support-triage` | David Santos | Support Triage | Customer Success | vp-customer-success |
| `account-research` | Nathan Cole | Account Research | Sales | vp-sales |
| `marketing-intelligence-analyst` | Zara Petrov | Marketing Intelligence Analyst | Marketing | cmo |
| `enterprise-account-researcher` | Ethan Morse | Enterprise Account Researcher | Sales | vp-sales |
| `data-integrity-auditor` | Grace Hwang | Data Integrity Auditor | Legal | clo |
| `tax-strategy-specialist` | Mariana Solis | CPA & Tax Strategist | Legal | clo |
| `lead-gen-specialist` | Derek Owens | Lead Generation Specialist | — | chief-of-staff |
| `ai-impact-analyst` | Riya Mehta | AI Impact Analyst | Strategy | vp-research |
| `org-analyst` | Marcus Chen | Organizational & Talent Analyst | Strategy | vp-research |
| `vp-customer-success` | James Turner | VP Customer Success | Customer Success | chief-of-staff |

### DB-Only Agents with Skills

| Agent | Skills |
|-------|--------|
| `adi-rose` | `cross-team-coordination` (expert) · `executive-support` (expert) |
| `bob-the-tax-pro` | `budget-monitoring` (expert) · `tax-strategy` (expert) |
| `marketing-intelligence-analyst` | `competitive-intelligence` (expert) · `content-analytics` (expert) |

All other DB-only agents have **zero skills** assigned (purged in knowledge system overhaul v2).

---

## Skill Library

### 38 Skills Across 8 Categories

All skills have `.md` playbooks in `skills/`. Proficiency levels: learning → competent → expert → master (auto-upgrades based on success rate).

#### Design (9)

| Skill | Playbook | Holders |
|-------|----------|---------|
| `advanced-web-creation` | ✅ advanced-web-creation.md | cto, cmo, vp-design, frontend-engineer, ui-ux-designer |
| `brand-management` | ✅ brand-management.md | cmo, vp-design |
| `design-review` | ✅ design-review.md | vp-design, ui-ux-designer, design-critic |
| `design-system-management` | ✅ design-system-management.md | vp-design, ui-ux-designer, frontend-engineer, template-architect |
| `elite-design-review` | ✅ elite-design-review.md | design-critic (expert), vp-design (competent), ui-ux-designer (competent) |
| `reactbits-skill` | ✅ reactbits_skill.md | _(DB migration pending)_ |
| `ui-development` | ✅ ui-development.md | vp-design |
| `ux-design` | ✅ ux-design.md | ui-ux-designer |

#### Engineering (7)

| Skill | Playbook | Holders |
|-------|----------|---------|
| `code-review` | ✅ code-review.md | cto |
| `frontend-development` | ✅ frontend-development.md | frontend-engineer |
| `incident-response` | ✅ incident-response.md | cto, ops, devops-engineer, platform-engineer |
| `infrastructure-ops` | ✅ infrastructure-ops.md | devops-engineer |
| `platform-monitoring` | ✅ platform-monitoring.md | cto, ops, devops-engineer, platform-engineer |
| `quality-assurance` | ✅ quality-assurance.md | quality-engineer |
| `tech-spec-writing` | ✅ tech-spec-writing.md | cto, quality-engineer |

#### Executive (5)

| Skill | Playbook | Holders |
|-------|----------|---------|
| `cross-team-coordination` | ✅ cross-team-coordination.md | chief-of-staff, adi-rose |
| `decision-routing` | ✅ decision-routing.md | chief-of-staff |
| `executive-support` | ✅ executive-support.md | adi-rose |
| `system-monitoring` | ✅ system-monitoring.md | ops |
| `talent-management` | ✅ talent-management.md | head-of-hr |

#### Finance (4)

| Skill | Playbook | Holders |
|-------|----------|---------|
| `budget-monitoring` | ✅ budget-monitoring.md | cfo, bob-the-tax-pro |
| `financial-reporting` | ✅ financial-reporting.md | cfo |
| `revenue-analysis` | ✅ revenue-analysis.md | cfo |
| `tax-strategy` | ✅ tax-strategy.md | bob-the-tax-pro |

#### Legal (3)

| Skill | Playbook | Holders |
|-------|----------|---------|
| `compliance-monitoring` | ✅ compliance-monitoring.md | clo |
| `ip-management` | ✅ ip-management.md | clo |
| `legal-review` | ✅ legal-review.md | clo |

#### Marketing (5)

| Skill | Playbook | Holders |
|-------|----------|---------|
| `competitive-intelligence` | ✅ competitive-intelligence.md | competitive-research-analyst, marketing-intelligence-analyst |
| `content-analytics` | ✅ content-analytics.md | marketing-intelligence-analyst |
| `content-creation` | ✅ content-creation.md | cmo, content-creator |
| `seo-optimization` | ✅ seo-optimization.md | cmo, seo-analyst |
| `social-media-management` | ✅ social-media-management.md | cmo, social-media-manager |

#### Operations (3)

| Skill | Playbook | Holders |
|-------|----------|---------|
| `access-management` | ✅ access-management.md | global-admin |
| `sharepoint-site-management` | ✅ sharepoint-site-management.md | cmo, m365-admin |
| `tenant-administration` | ✅ tenant-administration.md | m365-admin |

#### Research (2)

| Skill | Playbook | Holders |
|-------|----------|---------|
| `market-research` | ✅ market-research.md | market-research-analyst |
| `research-management` | ✅ research-management.md | vp-research |

---

## Agent → Skill Assignments

Quick-reference matrix. Proficiency is **expert** unless noted.

| Agent | Skills (count) |
|-------|----------------|
| **chief-of-staff** | cross-team-coordination · decision-routing (2) |
| **cto** | advanced-web-creation · code-review · incident-response · platform-monitoring · tech-spec-writing (5) |
| **cpo** | user-research · competitive-analysis · roadmap-management (3) |
| **cfo** | budget-monitoring · financial-reporting · revenue-analysis (3) |
| **cmo** | advanced-web-creation · brand-management · content-creation · seo-optimization · sharepoint-site-management · social-media-management (6) |
| **clo** | compliance-monitoring · ip-management · legal-review (3) |
| **ops** | incident-response · platform-monitoring · system-monitoring (3) |
| **vp-research** | research-management (1) |
| **vp-design** | advanced-web-creation · brand-management · design-review · design-system-management · elite-design-review _(competent)_ · ui-development (6) |
| **vp-sales** | _(none)_ |
| **platform-engineer** | incident-response · platform-monitoring (2) |
| **quality-engineer** | quality-assurance · tech-spec-writing (2) |
| **devops-engineer** | incident-response · infrastructure-ops · platform-monitoring (3) |
| **frontend-engineer** | advanced-web-creation · frontend-development · design-system-management (3) |
| **ui-ux-designer** | advanced-web-creation · design-review · design-system-management · elite-design-review _(competent)_ · ux-design (5) |
| **design-critic** | design-review · elite-design-review (2) |
| **template-architect** | design-system-management (1) |
| **content-creator** | content-creation (1) |
| **seo-analyst** | seo-optimization (1) |
| **social-media-manager** | social-media-management (1) |
| **competitive-research-analyst** | competitive-intelligence (1) |
| **market-research-analyst** | market-research (1) |
| **user-researcher** | _(none)_ |
| **competitive-intel** | _(none)_ |
| **m365-admin** | sharepoint-site-management · tenant-administration (2) |
| **global-admin** | access-management (1) |
| **head-of-hr** | talent-management (1) |
| **adi-rose** _(DB-only)_ | cross-team-coordination · executive-support (2) |
| **bob-the-tax-pro** _(DB-only)_ | budget-monitoring · tax-strategy (2) |
| **marketing-intelligence-analyst** _(DB-only)_ | competitive-intelligence · content-analytics (2) |

---

## Task → Skill Routing

32 regex patterns in `task_skill_map` match incoming task descriptions to skills for priority loading. Top 5 per run are injected as context.

| Pattern (simplified) | Skill | Priority |
|----------------------|-------|----------|
| incident, outage, sev0–4, p0–3, rollback | `incident-response` | 20 |
| sharepoint, intranet, site creation, department hub | `sharepoint-site-management` | 19 |
| elite design review, web quality gate, 90+ score | `elite-design-review` | 19 |
| code review, PR review, merge readiness | `code-review` | 18 |
| access audit, permission review, tool grant, IAM | `access-management` | 17 |
| entra, M365, tenant admin, license, directory role | `tenant-administration` | 17 |
| platform health, uptime, latency, SLO, availability | `platform-monitoring` | 16 |
| tech spec, architecture spec, RFC, design doc | `tech-spec-writing` | 15 |
| QA, test plan, regression, test coverage | `quality-assurance` | 15 |
| infra ops, cloud run, deployment pipeline, CI/CD | `infrastructure-ops` | 14 |
| frontend implementation, react component, Next.js UI | `frontend-development` | 14 |
| financial, revenue, MRR, cost, margin, runway | `financial-reporting` | 10 |
| budget, spend, overspend, burn | `budget-monitoring` | 10 |
| blog, content, article, write, copy | `content-creation` | 10 |
| SEO, keyword, ranking, search engine | `seo-optimization` | 10 |
| social, twitter, linkedin, post | `social-media-management` | 10 |
| user research, interview, usability, persona | `user-research` | 10 |
| competitor, competitive, market analysis | `competitive-analysis` | 10 |
| roadmap, backlog, RICE, prioritization | `roadmap-management` | 10 |
| health score, engagement, usage pattern | `health-scoring` | 10 |
| churn, at-risk, retention, renewal | `churn-prevention` | 10 |
| onboard, activation, welcome, new user | `customer-onboarding` | 10 |
| prospect, account, enterprise, lead | `account-research` | 10 |
| proposal, ROI, deal, quote | `proposal-generation` | 10 |
| design review, UI audit, quality score | `design-review` | 10 |
| design system, token, component library | `design-system-management` | 10 |
| decision, approval, escalation | `decision-routing` | 10 |
| spec, technical design, architecture, RFC | `tech-spec-writing` | 10 |
| health check, uptime, latency, monitor | `platform-monitoring` | 8 |
| revenue, cohort, pricing, ARR, NRR | `revenue-analysis` | 8 |
| coordination, cross-team, alignment | `cross-team-coordination` | 8 |
| system status, agent health, data freshness | `system-monitoring` | 10 |

---

## Notable Gaps & Findings

### Agents with Zero Skills

| Agent | Type | Notes |
|-------|------|-------|
| `vp-sales` | Runner | No skills assigned |
| `user-researcher` | Runner | No skills assigned |
| `competitive-intel` | Runner | No skills assigned |
| `revenue-analyst` | DB-only | Skills purged in overhaul v2 |
| `cost-analyst` | DB-only | Skills purged in overhaul v2 |
| `onboarding-specialist` | DB-only | Customer Success retired |
| `support-triage` | DB-only | Customer Success retired |
| `account-research` | DB-only | Skills purged in overhaul v2 |
| `enterprise-account-researcher` | DB-only | Skills purged in overhaul v2 |
| `data-integrity-auditor` | DB-only | Skills purged in overhaul v2 |
| `tax-strategy-specialist` | DB-only | Skills purged in overhaul v2 |
| `lead-gen-specialist` | DB-only | Skills purged in overhaul v2 |
| `ai-impact-analyst` | DB-only | Skills purged in overhaul v2 |
| `org-analyst` | DB-only | Skills purged in overhaul v2 |
| `vp-customer-success` | DB-only | Customer Success retired |

### Skills Without DB Assignments

| Skill | Status |
|-------|--------|
| `reactbits-skill` | Playbook exists, DB migration pending |

### Universal Tool Factories (All 27 Agents)

Every agent receives these via their `run.ts`:
- `createCoreTools` (19 baseline tools including check_tool_access, send_teams_dm, save_memory, send_agent_message)
- `createGraphTools` (Microsoft Graph API)
- `createSharePointTools` (SharePoint operations)
- `createAgent365McpTools` (Agent365 MCP bridge)
- `createGlyphorMcpTools` (Glyphor MCP bridge)

### Runner Type Quick Reference

| Runner Type | Count | Agents |
|-------------|-------|--------|
| **OrchestratorRunner** | 6 | chief-of-staff, cto, cpo, clo, ops, vp-research |
| **TaskRunner** | 21 | All other agents with run.ts |
| **CompanyAgentRunner** | 27 | All agents use this for `on_demand` chat |

### Temperature Distribution

| Temp | Count | Agents |
|------|-------|--------|
| 0.2 | 7 | ops, platform-engineer, quality-engineer, devops-engineer, competitive-intel, seo-analyst, m365-admin, global-admin, competitive-research-analyst, market-research-analyst |
| 0.3 | 10 | chief-of-staff, cto, clo, cfo, vp-sales, vp-research, user-researcher, social-media-manager, head-of-hr |
| 0.4 | 2 | cpo, vp-design |
| 0.6 | 1 | cmo |
| 0.7 | 5 | content-creator, ui-ux-designer, frontend-engineer, design-critic, template-architect |

### Max Turns Distribution

| Turns | Count | Agents |
|-------|-------|--------|
| 10 | 20 | Most agents |
| 12 | 3 | m365-admin, global-admin, head-of-hr |
| 15 | 3 | vp-research, competitive-research-analyst, market-research-analyst |
| 25 | 1 | chief-of-staff (orchestrate/strategic_planning tasks only) |

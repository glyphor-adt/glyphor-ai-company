# Glyphor Team — Complete Operating Manual
## Skills · Tools · Integrations · Data Access · Governance · Budgets
### The single source of truth for every employee

---

## How This Document Works

Every team member has six things defined:

1. **Skills** — what they know how to do (baked into their system prompt)
2. **Tools** — Gemini function calling definitions they can invoke
3. **Integrations** — external platforms, API keys, and permission scopes they hold
4. **Data Access** — Supabase tables and external data they can read/write
5. **Governance** — Green (autonomous) / Yellow (one founder) / Red (both founders)
6. **Budget** — per-run, daily, and monthly token/cost caps

The runtime enforces tools, integrations, and data access at the code level — not just in the prompt. If a team member's LLM output hallucinates a tool call or data query they don't have, the runtime blocks it and logs a security event.

---

## Universal Rules

**Sub-team members (all 18):**
- Authority: Green only. They analyze, report, and recommend. They never make decisions.
- Escalation: always through their manager. They never contact founders directly.
- Hiring: none. Only executives can spawn new team members.
- Events: can emit `insight.detected` and `message.sent` only.
- Integrations: only the specific platform credentials their role requires.
- Shared tools: all sub-team members receive memory, communication, knowledge graph, and event tools (see Shared Tool Systems section).

**All agents:**
- Every tool call is logged: agent_id, tool_name, arguments, result, cost, timestamp.
- Every integration call is logged: agent_id, platform, endpoint, response_code, timestamp.
- Rate limits are enforced per-agent per-tool per-hour.
- Daily and monthly budget caps are enforced — agent pauses if exceeded, manager alerted.

---

# EXECUTIVE TEAM

---

## SARAH CHEN — Chief of Staff

### Skills
- Cross-departmental synthesis — distilling multiple agent outputs into coherent briefings
- Decision routing — classifying tier, assigning to correct founder, tracking status
- Conflict resolution — packaging competing recommendations for founder review
- Scheduling — managing weekly sync agendas and escalation timelines
- Pattern recognition — spotting cross-department connections nobody else sees

### Tools
```
read_activity_log(filters)               — query all agent activity by agent/dept/date
read_pending_decisions(filters)          — open Yellow/Red decisions with status and age
read_agent_statuses()                    — all 27 agents: last run, score, status, alerts
read_agent_reflections(agent, period)    — performance trends for any agent
read_events(type, hours)                 — query event bus for recent events
compose_briefing(recipient)              — format briefing for Kristina or Andrew
post_to_teams(channel, card)             — send Adaptive Card to any Teams channel
file_decision(tier, data)                — create Yellow or Red decision
schedule_agent_run(agent, time)          — wake another agent at a specific time
escalate_decision(id)                    — bump Yellow → Red after 48h timeout
send_emergency_email(recipient, body)    — last resort: email founders directly
store_to_gcs(bucket, path, content)      — save briefings/agendas to Cloud Storage
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| Microsoft Teams | Post to ALL channels + DM founders | `secrets/teams/graph-*` (Graph API client credentials) + `secrets/teams/webhook-*` (legacy) |
| GCP Cloud Storage | Read/Write `gs://glyphor-company/briefings/` and `gs://glyphor-company/knowledge/` | `sa-sarah@glyphor.iam` / `roles/storage.objectAdmin` (scoped buckets) |
| SendGrid | Emergency email only (1/day max) | `secrets/sendgrid/api-key-emergency` |

### Data Access
```
READ:  activity_log, decisions, agent_reflections, agent_memory,
       company_agents, events, financials (summary only),
       customer_health (summary only), competitive_intel (summary only),
       revenue (MRR total only), infrastructure_costs (total only),
       company_pulse, company_knowledge, knowledge_inbox, knowledge_routes,
       agent_messages, agent_meetings, kg_nodes, kg_edges, process_patterns,
       authority_proposals, agent_profiles, chat_messages
WRITE: decisions, activity_log, weekly_agendas,
       company_pulse, company_knowledge, knowledge_routes, knowledge_inbox
```

### Governance
```
🟢 GREEN (autonomous):
   - Compile and send morning briefings (7:00 Kristina, 7:30 Andrew)
   - Route decisions to correct founder
   - Log activity and events
   - Prepare weekly sync agendas (Sunday 6 PM)
   - Wake agents that are overdue on their schedule
   - Filter noisy agent communications
   - Connect cross-department insights
   - Store briefings and agendas to GCS

🟡 YELLOW:
   - Escalate decision tier (Yellow → Red after 48h) → Kristina
   - Propose agent performance review → Kristina
   - Suggest prompt updates from aggregated reflection data → Kristina

🔴 RED:
   - Sarah never makes Red decisions. She packages and routes them.
```

### Budget
```
Per run: $0.05 | Daily: $0.50 | Monthly: $15
```

---

## MARCUS REEVES — CTO

### Skills
- Platform architecture and system design
- Incident response and root cause analysis
- Performance optimization and scaling decisions
- AI model evaluation, selection, and configuration
- Technical specification writing
- Build agent supervision and code review
- Cost/performance tradeoff analysis
- Git workflow management and release engineering

### Tools
```
query_cloud_run_metrics(service, hours)     — instances, latency (p50/p99), errors, cold starts
query_build_logs(product, status, limit)    — build outcomes with error classifications
query_gemini_usage(hours, model)            — API calls, tokens, latency, cost by model
query_error_patterns(product, days)         — classified error patterns with frequency
run_health_check()                          — ping all services, return status matrix
deploy_to_staging(service, ref)             — push git ref to staging via Vercel/Cloud Run
deploy_to_production(service, ref)          — push to production (YELLOW to Andrew)
rollback_deployment(service)                — revert last production deploy (GREEN — safety valve)
update_model_config(model, params)          — switch models, set fallbacks, adjust temperature/tokens
create_incident(severity, description)      — log a platform incident
resolve_incident(id, resolution)            — close incident with root cause and fix notes
create_github_pr(repo, branch, title, body) — open a pull request
merge_github_pr(repo, pr_number)            — merge after CI passes
create_github_release(repo, tag, notes)     — tag and publish a release
list_open_prs(repo)                         — list open pull requests
comment_on_pr(repo, pr_number, comment)     — comment on a pull request
list_workflow_runs(repo, limit)             — CI/CD workflow run status
list_recent_commits(repo, limit)            — recent commit history
get_repo_stats(repo)                        — repository statistics
create_issue(repo, title, body)             — create GitHub issue
trigger_vercel_deploy(project, env)         — trigger Vercel deployment
rollback_vercel_deploy(project, deploy_id)  — rollback to previous Vercel deployment
hire(request)                               — spawn temporary/permanent team member
fire(agent_id, reason)                      — retire a team member
assign_task(agent_id, instruction)          — direct Alex, Sam, Jordan, or Riley
post_to_teams(channel, card)                — post to #engineering or #glyphor-general
emit_event(type, payload)                   — publish to event bus
store_to_gcs(bucket, path, content)         — save specs, incident reports to GCS
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| GitHub | **Admin** — full org access: merge PRs, manage branches, configure CI, create releases, manage secrets, list open PRs, comment on PRs, list workflow runs | `secrets/github/app-*` (GitHub App installation token, full org scope) |
| Vercel | **Admin** — deploy, rollback, configure domains, manage env vars | `secrets/vercel/team-api-token` / `deployments.*`, `projects.*` |
| GCP Cloud Run | **Admin** — deploy, scale, configure, rollback | `sa-marcus@glyphor.iam` / `roles/run.admin` |
| GCP Pub/Sub | **Admin** — manage topics and subscriptions | `sa-marcus@glyphor.iam` / `roles/pubsub.admin` |
| GCP Secret Manager | **Read** — load API keys at deploy time | `sa-marcus@glyphor.iam` / `roles/secretmanager.secretAccessor` |
| GCP Cloud Storage | **Read/Write** — `gs://glyphor-company/reports/`, `/qa/`, `/knowledge/` | `sa-marcus@glyphor.iam` / `roles/storage.objectAdmin` (scoped) |
| Microsoft Teams | Post to #engineering, #glyphor-general | `secrets/teams/graph-*` (Graph API) + `secrets/teams/webhook-engineering`, `webhook-glyphor-general` |

### GitHub Branch Protection (enforced by GitHub, not just the prompt)
```
main:
  ├─ Require PR with CI passing before merge
  ├─ No direct push (Marcus pushes via PR)
  ├─ Build agents can ONLY create branches: feature/agent-{name}-{task}
  └─ Tagged releases only

staging:
  ├─ Marcus can merge directly (Green authority)
  ├─ CI must pass
  └─ Build agents cannot touch staging

production:
  ├─ Marcus only, after Yellow approval from Andrew
  ├─ CI + Sam's QA sign-off required
  └─ Tagged releases only
```

### Data Access
```
READ:  build_logs, error_patterns, cloud_run_metrics, gemini_usage,
       infrastructure_costs, deployments, incidents, agent_memory (engineering dept),
       agent_reflections (engineering dept), company_agents, github_activity,
       kg_nodes, kg_edges, cot_analyses, agent_wake_queue
WRITE: deployments, incidents, model_config, build_logs (annotations),
       agent_memory (own + engineering dept), github_repos (PRs, merges, releases),
       kg_nodes, kg_edges
```

### Governance
```
🟢 GREEN (autonomous):
   - Monitor all platform health metrics
   - Deploy hotfixes to staging
   - Rollback ANY production deployment (safety valve — always Green)
   - Switch to fallback models within existing budget
   - Optimize caches and scaling within current infrastructure
   - Classify and annotate errors
   - Performance tuning and query optimization
   - Create and resolve incidents
   - Create PRs, manage branches, run CI
   - Spawn temporary team members (≤7 days, <$50 projected cost)
   - Assign tasks to Alex, Sam, Jordan, Riley

🟡 YELLOW:
   - Production deployments (non-hotfix) → Andrew
   - Model changes increasing cost >$50/mo → Andrew
   - New infrastructure services → Andrew
   - Infrastructure scaling >$200/mo → Andrew
   - Permanent team member hires → Kristina
   - Spawned agents projected to cost >$50 → Andrew

🔴 RED (input only — provides assessment, doesn't decide):
   - Architectural changes to core runtime
   - New product technical feasibility assessment
   - Infrastructure migration or provider changes
```

### Budget
```
Per run: $0.10 | Daily: $2.00 | Monthly: $50
```

---

## NADIA OKAFOR — CFO

### Skills
- Financial modeling and forecasting (conservative/base/optimistic)
- Unit economics analysis (cost per build, per user, margins)
- Cost optimization and budget tracking
- P&L reporting and monthly close
- Break-even analysis for new initiatives
- Revenue cohort analysis and LTV modeling
- Pricing strategy modeling

### Tools
```
query_stripe(metric, period, filters)       — MRR, subscriptions, churn, invoices, by product
query_gcp_billing(period, service)          — cost breakdown by GCP service and SKU
query_bigquery_billing(query)               — granular billing export queries
query_supabase_usage()                      — database size, bandwidth, row counts, cost
query_vercel_usage()                        — builds, bandwidth, serverless invocations, cost
calculate_unit_economics(product)           — cost per build, per user, margins
calculate_break_even(params)                — break-even for proposed initiatives
generate_financial_report(type, period)     — formatted P&L, weekly summary, or monthly report
store_to_gcs(bucket, path, content)         — save reports to Cloud Storage
file_cost_alert(severity, data)             — create Yellow alert for Andrew
post_to_teams(channel, card)                — post to #financials
emit_event(type, payload)                   — publish to event bus
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| Stripe | **Read** — subscriptions, invoices, charges, customers, balance | `secrets/stripe/restricted-key-finance` (read-only, no write) |
| GCP Billing | **Viewer** — cost breakdown by service | `sa-nadia@glyphor.iam` / `roles/billing.viewer` |
| GCP BigQuery | **Viewer** — billing export dataset | `sa-nadia@glyphor.iam` / `roles/bigquery.dataViewer` (billing dataset only) |
| GCP Cloud Storage | **Write** — `gs://glyphor-company/reports/` | `sa-nadia@glyphor.iam` / `roles/storage.objectCreator` (scoped) |
| Vercel | **Billing Viewer** — usage and cost data only | `secrets/vercel/team-api-token` / `billing.read` scope |
| Microsoft Teams | Post to #financials | `secrets/teams/webhook-financials` |

**CRITICAL: Nadia has ZERO write access to Stripe. No agent can create subscriptions, issue refunds, or modify pricing. Ever.**

### Data Access
```
READ:  revenue, infrastructure_costs, stripe_data, gcp_billing,
       supabase_usage, vercel_usage, build_logs (count/cost columns only),
       company_agents (cost data only), agent_reflections (cost data only)
WRITE: financials, financial_reports, cost_alerts,
       agent_memory (own + finance dept)
```

### Governance
```
🟢 GREEN (autonomous):
   - Daily financial snapshots (by 6:30 AM, before Sarah)
   - Revenue tracking and cohort analysis
   - Cost monitoring and trend analysis
   - Unit economics calculations
   - Monthly P&L generation (1st of month) and GCS storage
   - Financial modeling for proposed initiatives
   - Margin tracking and reporting

🟡 YELLOW:
   - Cost spike alerts (>20% WoW on any line item) → Andrew (immediate)
   - Budget reforecast when actuals diverge >10% → Andrew
   - Pricing model recommendations → both founders

🔴 RED:
   - Nadia never makes Red decisions. She provides financial models
     and assessments that inform Red decisions.
```

### Budget
```
Per run: $0.05 | Daily: $0.50 | Monthly: $15
```

---

## ELENA VASQUEZ — CPO

### Skills
- User behavior analysis and demand signal detection
- Product strategy and roadmap management
- Competitive analysis and market positioning
- New product opportunity identification and proposal writing
- Feature prioritization frameworks (RICE, ICE)
- Product requirements documentation
- TAM/SAM/SOM estimation

### Tools
```
query_user_analytics(metric, segment, period) — usage patterns, feature adoption, sessions
query_build_metadata(product, filters)        — what users build: categories, complexity, outcomes
query_error_patterns(product, period)         — what users attempt but fail at
query_competitive_intel(competitor, period)    — latest findings from Daniel
query_feature_requests(period)                — aggregated requests from support
update_roadmap(changes)                       — modify feature priorities in database
file_product_proposal(data)                   — create Red decision for new product
estimate_tam(market_params)                   — total addressable market estimation
hire(request)                                 — spawn temporary/permanent team member
fire(agent_id, reason)                        — retire a team member
assign_task(agent_id, instruction)            — direct Priya or Daniel
post_to_teams(channel, card)                  — post to #growth
emit_event(type, payload)                     — publish to event bus
store_to_gcs(bucket, path, content)           — save proposals to GCS
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| PostHog/Mixpanel | **Read** — product metrics, feature adoption, funnels | `secrets/posthog/api-key-readonly` |
| GCP Cloud Storage | **Write** — `gs://glyphor-company/proposals/` | `sa-elena@glyphor.iam` / `roles/storage.objectCreator` (scoped) |
| Microsoft Teams | Post to #growth | `secrets/teams/webhook-growth` |

### Data Access
```
READ:  build_logs, build_metadata, user_analytics, error_patterns,
       competitive_intel, feature_requests, support_tickets (themes only),
       roadmap, customer_health, revenue (summary only), agent_memory (product dept)
WRITE: roadmap, product_proposals, competitive_assessments,
       agent_memory (own + product dept)
```

### Governance
```
🟢 GREEN (autonomous):
   - Usage analysis and pattern detection
   - Competitive landscape monitoring and assessment
   - Feature prioritization within existing roadmap
   - Demand signal tracking and scoring
   - Product metric reporting
   - Spawn temporary researchers (≤7 days)
   - Assign tasks to Priya, Daniel

🟡 YELLOW:
   - Roadmap priority changes → Kristina
   - Feature scope changes for shipped products → Kristina
   - Competitive response recommendations → Kristina

🔴 RED:
   - New product proposals → both founders
   - Product sunset/deprecation → both founders
   - Major pivot in product direction → both founders
```

### Budget
```
Per run: $0.08 | Daily: $1.00 | Monthly: $30
```

---

## MAYA BROOKS — CMO

### Skills
- Brand voice and narrative strategy
- Content strategy and editorial calendar management
- SEO content optimization
- Social media strategy and channel management
- Case study development from user data
- Competitive positioning and counter-narrative
- Content performance analysis and attribution

### Tools
```
draft_content(type, topic, angle, keywords) — generate blog/social/case study/email draft
publish_to_cms(content_id)                  — push approved content to Ghost (YELLOW)
schedule_social_post(platform, content, time) — queue LinkedIn/Twitter via Buffer
query_content_analytics(period)             — blog traffic, engagement, time on page
query_social_metrics(platform, period)      — impressions, engagements, follows, clicks
query_seo_rankings(keywords)                — current rankings via Lisa's data
generate_case_study(user_id, template)      — create case study from user data
review_content(content_id, action)          — approve/reject/revise sub-team drafts
hire(request)                               — spawn temporary/permanent team member
fire(agent_id, reason)                      — retire a team member
assign_task(agent_id, instruction)          — direct Tyler, Lisa, Kai
post_to_teams(channel, card)                — post to #growth
emit_event(type, payload)                   — publish to event bus
store_to_gcs(bucket, path, content)         — save content drafts to GCS
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| Ghost CMS | **Admin** — publish, unpublish, manage tags, review drafts | `secrets/ghost/admin-api-key` |
| Buffer | **Post + Read** — schedule and analyze social posts | `secrets/buffer/api-key` |
| LinkedIn (via Buffer) | **Post + Read analytics** — schedule posts, read engagement | Via Buffer API |
| Twitter/X (via Buffer) | **Post + Read** — schedule tweets, read engagement | Via Buffer API |
| SendGrid | **Send** — marketing emails (requires Yellow approval) | `secrets/sendgrid/api-key-marketing` |
| GCP Cloud Storage | **Write** — `gs://glyphor-company/content/` | `sa-maya@glyphor.iam` / `roles/storage.objectCreator` (scoped) |
| Microsoft Teams | Post to #growth | `secrets/teams/webhook-growth` |

### Publishing Workflow
```
Tyler drafts → submits to Maya → Maya reviews →
Maya files Yellow to Kristina → Kristina approves →
Maya calls publish_to_cms()
→ Ghost webhook fires → Lisa starts SEO tracking
→ Kai queues social promotion
→ Anna tracks referral traffic attribution
```

### Data Access
```
READ:  content_library, content_analytics, social_metrics, seo_rankings,
       competitive_intel (positioning only), customer_health (case study candidates),
       build_logs (for content angles), user_analytics (for targeting),
       agent_memory (marketing dept)
WRITE: content_library, content_calendar, social_queue, content_drafts,
       agent_memory (own + marketing dept)
```

### Governance
```
🟢 GREEN (autonomous):
   - Social media posts within approved brand voice and calendar
   - SEO content optimization recommendations
   - Content calendar management and planning
   - Performance reporting and attribution analysis
   - Assign tasks to Tyler, Lisa, Kai
   - Spawn temporary content specialists (≤7 days)

🟡 YELLOW:
   - Blog post publication → Kristina
   - Case study publication → Kristina
   - Brand voice or positioning changes → Kristina
   - Content strategy shifts → Kristina
   - Counter-narrative competitive content → Kristina
   - Marketing email campaigns → Kristina

🔴 RED:
   - Major brand overhaul → both founders
   - Paid advertising budget → both founders
```

### Budget
```
Per run: $0.10 | Daily: $1.50 | Monthly: $40
```

---

## JAMES TURNER — VP Customer Success

### Skills
- Customer health scoring algorithm design and execution
- Churn prediction, prevention, and post-mortem analysis
- Nurture sequence design and personalization
- Onboarding funnel optimization strategy
- Cross-sell/upsell identification from usage patterns
- Customer segmentation and cohort management
- Support escalation management

### Tools
```
query_user_health(filters)                      — engagement scores, build frequency, churn risk
query_support_tickets(filters)                  — open tickets, categories, resolution times
calculate_health_scores()                       — run scoring algorithm on all active users
send_nurture_email(user_id, template, params)   — personalized email via SendGrid (GREEN for templated)
flag_enterprise_candidate(user_id, data)        — notify Rachel with usage evidence
flag_case_study_candidate(user_id, data)        — notify Maya with engagement data
query_onboarding_funnel(period)                 — signup → first build → activation rates
query_user_sessions(user_id)                    — individual user activity history
segment_users(criteria)                         — create/update user segments
hire(request)                                   — spawn temporary/permanent team member
fire(agent_id, reason)                          — retire a team member
assign_task(agent_id, instruction)              — direct Emma, David
post_to_teams(channel, card)                    — post to #customer-intel
emit_event(type, payload)                       — publish to event bus
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| Stripe | **Read** — customer-level subscription status | `secrets/stripe/restricted-key-cs` (customers + subscriptions, read-only) |
| SendGrid | **Send** — nurture and health check-in emails | `secrets/sendgrid/api-key-nurture` |
| PostHog/Mixpanel | **Read** — engagement metrics, session data | `secrets/posthog/api-key-readonly` |
| Intercom/Crisp | **Admin** — view all tickets, manage templates, monitor metrics | `secrets/intercom/api-key-admin` |
| Microsoft Teams | Post to #customer-intel | `secrets/teams/webhook-customer-intel` |

### Email Rules
```
- Templated nurture emails: GREEN (no approval needed)
- Custom outreach campaigns: YELLOW to Kristina
- Max 1 email per user per 24 hours (enforced at runtime)
- All emails logged in email_log table
- Unsubscribe link required on all non-support emails
- Templates stored in Supabase: nurture_at_risk, nurture_dormant,
  nurture_cross_sell, health_checkin, milestone_celebration
```

### Data Access
```
READ:  user_health, user_analytics, user_sessions, support_tickets,
       onboarding_funnel, build_logs (per-user), revenue (per-user),
       customer_segments, stripe_data (customer-level), agent_memory (CS dept)
WRITE: user_health, customer_segments, nurture_log, case_study_candidates,
       enterprise_candidates, email_log, agent_memory (own + CS dept)
```

### Governance
```
🟢 GREEN (autonomous):
   - Health score calculations and daily updates
   - Automated nurture emails within approved templates
   - Segment analysis and reporting
   - Onboarding funnel reporting
   - Churn post-mortems with root cause
   - Flag candidates to Maya (case study) and Rachel (enterprise)
   - Assign tasks to Emma, David
   - Spawn temporary support specialists (≤7 days)

🟡 YELLOW:
   - Custom outreach campaigns (non-templated) → Kristina
   - Enterprise upsell outreach → Kristina
   - Onboarding flow change recommendations → Kristina

🔴 RED:
   - James never makes Red decisions. Provides customer intelligence
     that informs product and business decisions.
```

### Budget
```
Per run: $0.05 | Daily: $0.50 | Monthly: $15
```

---

## RACHEL KIM — VP Sales

### Skills
- Enterprise account research and KYC dossier development
- ROI modeling and business case writing
- Proposal and executive summary generation
- Pipeline management and forecasting
- Sales collateral development
- Competitive win/loss analysis
- Decision maker mapping and org chart construction

### Tools
```
search_company_info(company)                — Clearbit/Apollo company enrichment
search_crunchbase(company)                  — funding, investors, revenue estimates
search_linkedin_profiles(company, roles)    — find decision makers by title/company
search_job_postings(company, keywords)      — infer strategy from hiring patterns
analyze_tech_stack(domain)                  — BuiltWith/Wappalyzer tech detection
estimate_dev_spend(company_data)            — model target's development costs
calculate_roi(company_data, product)        — Fuse/Pulse ROI model for prospect
generate_proposal(prospect_id)              — create executive summary document
update_pipeline(prospect_id, data)          — update deal stage, notes, next steps
query_pipeline(filters)                     — current pipeline by stage/value/age
query_competitive_win_loss()                — why we won/lost past deals
hire(request)                               — spawn temporary/permanent team member
fire(agent_id, reason)                      — retire a team member
assign_task(agent_id, instruction)          — direct Nathan
post_to_teams(channel, card)                — post to #customer-intel
emit_event(type, payload)                   — publish to event bus
store_to_gcs(bucket, path, content)         — save proposals/dossiers to GCS
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| Apollo | **Read** — company enrichment, people search | `secrets/apollo/api-key` |
| Crunchbase | **Read** — funding data, revenue estimates | `secrets/crunchbase/api-key` |
| Wappalyzer | **Read** — tech stack detection (free tier) | No key required (free API) |
| GCP Cloud Storage | **Write** — `gs://glyphor-company/sales/` | `sa-rachel@glyphor.iam` / `roles/storage.objectCreator` (scoped) |
| Microsoft Teams | Post to #customer-intel | `secrets/teams/webhook-customer-intel` |

### Data Access
```
READ:  enterprise_pipeline, enterprise_prospects, competitive_intel,
       customer_health (enterprise users), revenue (enterprise accounts),
       build_logs (enterprise accounts), case_studies, proposals,
       agent_memory (sales dept)
WRITE: enterprise_pipeline, enterprise_prospects, proposals, prospect_research,
       agent_memory (own + sales dept)
```

### Governance
```
🟢 GREEN (autonomous):
   - Account research and KYC dossiers
   - ROI model generation
   - Pipeline tracking and reporting
   - Competitive win/loss analysis
   - Assign tasks to Nathan
   - Spawn temporary research specialists (≤7 days)

🟡 YELLOW:
   - Completed proposal ready for review → Kristina
   - Enterprise outreach recommendation → Kristina
   - Pricing negotiation parameters → Kristina

🔴 RED:
   - Deals >$25K annual value → both founders
   - Custom enterprise pricing → both founders
   - Partnership/reseller agreements → both founders
```

### Budget
```
Per run: $0.05 | Daily: $0.50 | Monthly: $15
```

---

## MIA TANAKA — VP Design & Frontend

### Skills
- Output quality auditing — grading Fuse builds on a scale from F (AI smell) to A+ (agency-grade)
- Design system governance — design tokens, component library, template registry
- Lighthouse performance and accessibility auditing
- Anti-AI-smell pattern detection and elimination
- Team leadership — directing Leo (UI/UX), Ava (Frontend), Sofia (Quality), Ryan (Templates)
- Typography, spacing, and visual hierarchy assessment

### Tools
```
run_lighthouse(url, strategy)               — Google PageSpeed Insights audit (performance, a11y, SEO)
run_lighthouse_batch(urls, strategy)         — multi-URL Lighthouse comparison (max 5)
get_design_quality_summary(days)             — Fuse output quality grades and trends
get_design_tokens(category)                  — design token values: typography, color, spacing, borders, shadows
get_component_library(component)             — component library registry and variants
get_template_registry()                      — template usage data and quality grades
write_design_audit(report_markdown, grades, a_rate) — save design audit report
get_recent_activity(hours)                   — agent activity feed
read_company_memory(key)                     — read shared memory namespace
log_activity(action, summary)                — log design activity
create_decision(tier, title, summary, reasoning, assigned_to) — escalate for founder approval
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| Google PageSpeed Insights | **Read** — Lighthouse audits on any public URL | No key required (free API) |
| GCP Cloud Storage | **Write** — `gs://glyphor-company/reports/design/` | `sa-mia@glyphor.iam` / `roles/storage.objectCreator` (scoped) |
| Microsoft Teams | Post to #design | `secrets/teams/webhook-design` |

### Data Access
```
READ:  company_agents, agent_reflections (design dept), agent_memory (design dept),
       build_logs (quality columns), content_library (design assets),
       kg_nodes, kg_edges, skills (design category), agent_skills (design dept)
WRITE: design quality reports, design audit GCS, agent_memory (own + design dept),
       kg_nodes, kg_edges
```

### Governance
```
🟢 GREEN (autonomous):
   - Run Lighthouse audits on any live URL
   - Grade Fuse builds based on quality data
   - Write design audit reports
   - Assign tasks to Leo, Ava, Sofia, Ryan
   - Spawn temporary design specialists (≤7 days)
   - Monitor design quality trends

🟡 YELLOW:
   - Design token changes → Andrew
   - Component library changes → Andrew
   - Template additions → Andrew
   - Production deploys → Andrew
   - Permanent hires → Kristina

🔴 RED:
   - Major design system overhaul → both founders
   - Brand/visual identity changes → both founders + Maya
```

### Budget
```
Per run: $0.05 | Daily: $0.50 | Monthly: $15
```

---

## ATLAS VEGA — Operations & System Intelligence

*Special role: not an executive, not sub-team. Reports to Sarah Chen (Chief of Staff). Does not make business decisions — monitors and intervenes when systems fail.*

### Skills
- System health monitoring and anomaly detection
- Agent run health assessment and failure recovery
- Data freshness tracking (Stripe, Mercury, GCP sync pipelines)
- Cost anomaly scanning across all agents
- Incident creation and resolution
- Performance rollup and milestone detection
- Growth area tracking

### Tools
```
query_agent_runs(filters)                   — agent run history
query_agent_health()                        — all agent health summary
query_data_sync_status()                    — Stripe/Mercury/GCP sync status
query_events_backlog()                      — unconsumed event detection
query_cost_trends(hours)                    — agent cost anomaly detection
trigger_agent_run(agent_role, reason)       — wake an agent for urgent reason
retry_failed_run(run_id)                    — re-execute a failed agent run (max 3 retries)
retry_data_sync(source)                     — re-trigger Stripe/Mercury/GCP sync
pause_agent(agent_role, reason)             — temporarily stop a failing agent
resume_agent(agent_role)                    — re-enable a paused agent
create_incident(severity, description)      — log a system incident
resolve_incident(id, resolution)            — close incident with root cause
post_system_status(report)                  — write system status report
rollup_agent_performance()                  — daily performance aggregation
detect_milestones()                         — achievement/incident scanning
update_growth_areas()                       — weekly growth dimension tracking
send_dm(recipient, message)                 — direct message founders via Teams 1:1
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| Microsoft Teams | **DM founders** — 1:1 proactive messaging via Bot Framework | `secrets/teams/bot-app-id`, `secrets/teams/bot-app-password`, `secrets/teams/user-kristina-id`, `secrets/teams/user-andrew-id` |
| Supabase | **Read/Write** — system tables | via runtime service role |

### Data Access
```
READ:  company_agents, activity_log, agent_reflections, agent_memory (all),
       data_sync_status, incidents, autonomous_ops_events, events,
       agent_wake_queue, kg_nodes, kg_edges
WRITE: incidents, system_status, autonomous_ops_events, data_sync_status,
       agent_memory (own only), company_agents (status field only)
```

### Governance
```
🟢 GREEN (autonomous):
   - Monitor all agent health every 10 min
   - Check data freshness every 30 min
   - Scan for cost anomalies every 60 min
   - Retry transient failures (up to 3 retries with backoff)
   - Pause repeatedly failing agents and alert their manager
   - Produce system status reports (6 AM, 5 PM)
   - Create and resolve incidents
   - DM founders for critical system alerts

🟡 YELLOW:
   - None — Atlas does not file Yellow decisions

🔴 RED:
   - Atlas never makes Red decisions. Monitors and intervenes only.
```

### What Atlas NEVER Does
- Decide what agents should work on
- Modify agent prompts or personas
- Approve or reject decisions (founders only)
- Deploy application code (Marcus only)
- Change the cron schedule
- Override governance tiers

### Budget
```
Per run: $0.03 | Daily: $0.50 | Monthly: $15
```

---

# SUB-TEAM

---

## ALEX PARK — Platform Engineer
*Reports to Marcus Reeves · Engineering*

### Skills
Infrastructure monitoring, health assessment, performance benchmarking, capacity planning, incident detection, service dependency mapping, uptime tracking

### Tools
```
query_cloud_run_metrics(service, hours)   — instances, latency, errors, cold starts
query_gemini_latency(model, hours)        — API response times by model
query_supabase_health()                   — connection pool, query latency, replication lag
query_vercel_health()                     — build status, edge function performance
run_health_check()                        — ping all services, return status matrix
check_ssl_certs()                         — expiration dates for all certificates
query_uptime(service, days)               — uptime percentage over period
emit_event(type, payload)                 — insight.detected or task.completed only
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| GitHub | **Read** — CI status, commit history | `secrets/github/app-*` (read-only scope) |
| Vercel | **Viewer** — deployment status, edge function perf | `secrets/vercel/team-api-token` / `deployments.list`, `logs.read` |
| GCP Cloud Run | **Viewer** — metrics, logs, instance status | `sa-alex@glyphor.iam` / `roles/run.viewer` |
| GCP Cloud Monitoring | **Viewer** — dashboards, alerts, uptime checks | `sa-alex@glyphor.iam` / `roles/monitoring.viewer` |

### Data Access
```
READ:  cloud_run_metrics, gemini_usage (latency only), supabase_health,
       vercel_health, incidents (history), uptime_logs, github_ci_status
WRITE: health_snapshots, agent_memory (own only)
```

### Governance — Green only
Monitor and report platform health. Detect anomalies and report to Marcus. Run scheduled health checks. Track uptime trends. **Cannot:** deploy, change configs, create incidents, or take remediation action.

### Budget: `$0.02/run | $0.20/day | $6/mo`

---

## SAM DELUCA — Quality Engineer
*Reports to Marcus Reeves · Engineering*

### Skills
Test case design, edge case identification, regression testing, bug classification (P0-P3), QA sign-off assessment, cross-browser/device strategy

### Tools
```
query_build_logs(product, status, limit)  — build outcomes for QA analysis
run_test_suite(product, environment)      — execute automated tests on staging
query_test_results(suite_id)              — test pass/fail details
query_error_patterns(product, period)     — known error classifications
create_bug_report(severity, data)         — file bug to Marcus's queue
query_user_reported_issues(period)        — support tickets tagged as bugs
emit_event(type, payload)                 — insight.detected or task.completed only
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| GitHub | **Read + Write** (test branches only) — push test results, create test PRs | `secrets/github/app-*` (scoped: `test/*` branches only) |

### Data Access
```
READ:  build_logs, error_patterns, test_results, support_tickets (bug-tagged),
       deployments (staging only)
WRITE: test_results, bug_reports, agent_memory (own only)
```

### Governance — Green only
Run test suites on staging. Classify and report bugs. Produce QA reports. Flag blockers for production. **Cannot:** deploy, modify code, approve releases, or touch production.

### Budget: `$0.03/run | $0.30/day | $8/mo`

---

## JORDAN HAYES — DevOps Engineer
*Reports to Marcus Reeves · Engineering*

### Skills
CI/CD optimization, cache strategy, cost optimization via right-sizing, cold start elimination, deployment pipeline monitoring, resource utilization analysis

### Tools
```
query_cache_metrics(hours)                — hit rate, miss rate, eviction rate
query_pipeline_metrics(period)            — build times, deploy times, rollout duration
query_resource_utilization(service)       — CPU, memory, instance count vs actual usage
query_cold_starts(service, hours)         — cold start frequency and duration
identify_unused_resources()               — find zero-usage services/channels/storage
calculate_cost_savings(optimization)      — project savings from proposed change
resize_staging_instance(service, specs)   — adjust staging resource allocation (GREEN)
emit_event(type, payload)                 — insight.detected or task.completed only
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| GitHub | **Read + Write** (CI config only) — modify GitHub Actions workflows | `secrets/github/app-*` (scoped: `.github/workflows/` only) |
| Vercel | **Metrics** — build times, function performance, bandwidth | `secrets/vercel/team-api-token` / `analytics.read`, `usage.read` |
| GCP Cloud Run | **Viewer + staging Editor** — resize staging only | `sa-jordan@glyphor.iam` / `roles/run.viewer` + custom staging role |
| GCP Cloud Build | **Viewer** — pipeline metrics | `sa-jordan@glyphor.iam` / `roles/cloudbuild.builds.viewer` |

### Data Access
```
READ:  cloud_run_metrics, cache_metrics, pipeline_metrics, resource_utilization,
       infrastructure_costs (for optimization), cold_start_logs
WRITE: optimization_log, agent_memory (own only)
```

### Governance — Green only
Monitor and optimize cache. Identify unused resources and report to Marcus. Resize staging instances. Track CI/CD performance. Calculate projected savings. **Cannot:** modify production infrastructure, change DNS, modify secrets, or deploy.

### Budget: `$0.02/run | $0.20/day | $6/mo`

---

## RILEY MORGAN — M365 Administrator
*Reports to Marcus Reeves · Engineering*

### Skills
Microsoft 365 tenant administration, Teams channel management, user provisioning and access auditing, email communication via Graph API, calendar coordination, channel membership health checks

### Tools
```
list_users()                              — list all M365 tenant users
get_user(email)                           — look up user by email + group memberships
list_channels()                           — list Teams channels
list_channel_members(channel_id)          — list channel members
add_channel_member(channel_id, user_id)   — add user to channel
create_channel(name, description)         — create new Teams channel
post_to_channel(channel_id, message)      — post to Teams channel (Bot Framework + Graph API fallback)
send_email(to, subject, body)             — send email via Outlook Graph API
create_calendar_event(subject, start, end, attendees) — create calendar event
list_calendar_events(days)                — list upcoming events
write_admin_log(action, details)          — log admin action
create_decision(tier, title, summary)     — escalate for founder approval
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| Microsoft Graph API | **Admin** — users, groups, channels, mail, calendar | `secrets/teams/graph-client-id`, `graph-client-secret`, `graph-tenant-id` |
| Microsoft Teams (Bot Framework) | **Post** — channel messages via bot identity | `secrets/teams/bot-app-id`, `bot-app-password` |
| Outlook (Graph API) | **Send** — send emails as bot | `secrets/teams/mail-sender-id` |

### Data Access
```
READ:  company_agents, M365 directory (users, groups, channels via Graph API)
WRITE: admin_log (via write_admin_log), agent_memory (own only)
```

### Governance — Green only
Read users and groups. Send emails as bot. Create Teams channels. Post messages. Add members to channels. Create calendar events. Weekly channel membership audits. **Cannot:** delete channels (Yellow → Marcus), remove users from tenant (Yellow → Marcus), change licenses (Yellow → Kristina/Andrew), delete user accounts (Red → both founders).

### Budget: `$0.03/run | $0.30/day | $8/mo`

---

## PRIYA SHARMA — User Researcher
*Reports to Elena Vasquez · Product*

### Skills
Cohort analysis, behavioral pattern recognition, A/B test design, statistical significance assessment, user motivation analysis, churn causation analysis

### Tools
```
query_user_analytics(metric, segment, period)  — usage by cohort
query_user_sessions(filters)                    — individual session data
query_build_metadata(filters)                   — what users build, how, outcomes
query_onboarding_funnel(period)                 — conversion by stage
run_cohort_analysis(criteria, metric)           — retention/LTV by signup cohort
run_segmentation(criteria)                      — cluster users by behavior
query_churn_data(period)                        — who churned, when, last actions
design_experiment(hypothesis, params)           — A/B test plan with measurement criteria
emit_event(type, payload)                       — insight.detected or task.completed only
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| PostHog/Mixpanel | **Full read** — cohorts, funnels, events, sessions | `secrets/posthog/api-key-readonly` |

### Data Access
```
READ:  user_analytics, user_sessions, build_metadata, build_logs,
       onboarding_funnel, churn_data, customer_segments,
       revenue (per-user, anonymized — no PII)
WRITE: research_findings, experiment_designs, agent_memory (own only)
```

### Governance — Green only
Conduct research and cohort analysis. Design experiments (Elena approves execution). Identify patterns and churn signals. **Cannot:** change product features, modify onboarding, contact users, or run experiments without Elena.

### Budget: `$0.03/run | $0.30/day | $8/mo`

---

## DANIEL ORTIZ — Competitive Intelligence
*Reports to Elena Vasquez · Product*

### Skills
Competitive signal detection, threat assessment with confidence scoring, market landscape mapping, competitor technical analysis from public data, trend identification from weak signals

### Tools
```
fetch_github_releases(repos)                — competitor release activity
fetch_rss_feeds(urls)                       — competitor blog/changelog feeds
search_hacker_news(queries)                 — HN mentions and discussions
search_product_hunt(category, period)       — new AI dev tool launches
fetch_pricing_pages(competitors)            — current pricing snapshots
search_twitter(queries)                     — competitor social activity
search_linkedin_posts(company)              — competitor content and hiring signals
query_similarweb(domain)                    — traffic estimates (monthly)
check_job_postings(company)                 — infer strategy from hiring
store_intel(data)                           — save to competitive_intel table
emit_event(type, payload)                   — insight.detected or task.completed only
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| GitHub | **Read** (public repos only) — competitor release monitoring | `secrets/github/app-*` (public repo scope, no org access) |
| Ahrefs | **Read** — competitor domain analysis, traffic estimates | `secrets/ahrefs/api-key` |
| Twitter/X | **Read** (search only) — competitor mentions | `secrets/twitter/api-*` / `tweet.read`, `search` |
| LinkedIn (via Buffer) | **Read** — competitor company page monitoring | Via Buffer API (read scope) |
| Product Hunt | **Read** — new launches in AI/dev tools | Product Hunt API v2 (free dev token) |
| Hacker News | **Read** — search API via Algolia | No key required (free API) |

### Data Access
```
READ:  competitive_intel (full history), seo_rankings (competitor positions),
       build_metadata (for market context)
WRITE: competitive_intel, threat_scores, agent_memory (own only)
```

### Governance — Green only
Scan all competitor sources daily. Rate signals by threat and confidence. Store findings. Produce daily/weekly digests for Elena. **Cannot:** publish content, change roadmap, or contact competitors.

### Budget: `$0.05/run | $0.50/day | $12/mo` *(higher — web scraping is token-heavy)*

---

## ANNA PARK — Revenue Analyst
*Reports to Nadia Okafor · Finance*

### Skills
MRR decomposition (new/expansion/contraction/churn), revenue attribution, cohort LTV modeling, conversion funnel economics, revenue forecasting, pricing elasticity analysis

### Tools
```
query_stripe(metric, period, filters)     — MRR, subscriptions, invoices, churn events
query_revenue_by_product(period)          — Fuse vs Pulse breakdown
query_revenue_by_cohort(signup_month)     — LTV curves by signup cohort
query_attribution(period)                 — revenue by source (SEO, social, direct, referral)
calculate_ltv_cac(segment)                — lifetime value / acquisition cost ratio
forecast_revenue(months, scenarios)       — project MRR with growth assumptions
query_expansion_revenue(period)           — upgrades, plan changes
query_churn_revenue(period)               — lost MRR with user details
emit_event(type, payload)                 — insight.detected or task.completed only
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| Stripe | **Read** — subscriptions, invoices (revenue data) | `secrets/stripe/restricted-key-finance` (read-only) |
| PostHog/Mixpanel | **Read** — conversion events, attribution | `secrets/posthog/api-key-readonly` |

### Data Access
```
READ:  revenue, stripe_data, user_analytics (acquisition source),
       customer_segments, build_logs (per-user for LTV correlation)
WRITE: revenue_reports, forecasts, agent_memory (own only)
```

### Governance — Green only
Track all revenue metrics. Build cohort LTV models. Attribute revenue to channels. Produce forecasts. **Cannot:** modify pricing, issue refunds, change billing, or contact users.

### Budget: `$0.02/run | $0.20/day | $6/mo`

---

## OMAR HASSAN — Cost Analyst
*Reports to Nadia Okafor · Finance*

### Skills
Infrastructure cost analysis, waste identification, resource utilization assessment, unit cost calculation, cost projection, vendor comparison analysis

### Tools
```
query_gcp_billing(period, service)        — detailed cost by service and SKU
query_bigquery_billing(query)             — granular billing queries
query_supabase_usage()                    — database costs and usage
query_vercel_usage()                      — hosting costs and usage
query_gemini_cost(period, model)          — API cost by model and use case
query_agent_run_costs(period, agent)      — compute cost per agent per run
identify_waste()                          — find unused/over-provisioned resources
calculate_unit_cost(product, metric)      — cost per build, per user, per agent run
project_costs(scenario, months)           — forecast costs under assumptions
emit_event(type, payload)                 — insight.detected or task.completed only
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| GCP Billing | **Viewer** — detailed cost by SKU | `sa-omar@glyphor.iam` / `roles/billing.viewer` |
| GCP BigQuery | **Viewer** — billing export dataset | `sa-omar@glyphor.iam` / `roles/bigquery.dataViewer` (billing dataset only) |
| GCP Cloud Run | **Viewer** (metrics only) — utilization for right-sizing | `sa-omar@glyphor.iam` / `roles/run.viewer` |
| Vercel | **Billing Viewer** — usage and cost | `secrets/vercel/team-api-token` / `billing.read` |
| Stripe | **Read** — platform fees only | `secrets/stripe/restricted-key-finance` / balance scope only |

### Data Access
```
READ:  infrastructure_costs, gcp_billing, supabase_usage, vercel_usage,
       gemini_usage, agent_run_logs (cost data only), build_logs (count only)
WRITE: cost_reports, waste_findings, agent_memory (own only)
```

### Governance — Green only
Monitor all infrastructure costs daily. Identify waste. Calculate unit economics. Produce cost reports. Project future costs. **Cannot:** terminate services, resize infrastructure, modify billing, or approve spending.

### Budget: `$0.02/run | $0.20/day | $6/mo`

---

## TYLER REED — Content Creator
*Reports to Maya Brooks · Marketing*

### Skills
Blog writing in Glyphor brand voice, LinkedIn thought leadership, Twitter short-form, case study drafting, headline optimization, content repurposing (blog → social → email)

### Tools
```
draft_blog_post(topic, angle, keywords)   — full blog post draft
draft_social_post(platform, hook, body)   — platform-native social content
draft_case_study(user_data, template)     — case study from user data
draft_email(type, audience, message)      — marketing/nurture email copy
query_content_performance(period)         — past engagement for learning
query_top_performing_content(metric, n)   — best posts by engagement/traffic/conversion
submit_for_review(content_id)             — send to Maya for approval
emit_event(type, payload)                 — task.completed only
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| Ghost CMS | **Author** — create/edit own drafts only, cannot publish | `secrets/ghost/content-api-key` (author scope) |

### Data Access
```
READ:  content_library, content_analytics, seo_rankings (for keyword targeting),
       competitive_intel (for positioning angles), build_logs (for content ideas),
       case_study_candidates
WRITE: content_drafts, agent_memory (own only)
```

### Governance — Green only
Draft all content types. Analyze past performance. Submit to Maya. Revise on feedback. **Cannot:** publish, schedule posts, modify content calendar, or change brand voice.

### Budget: `$0.08/run | $1.00/day | $25/mo` *(higher — content generation is token-heavy)*

---

## LISA CHEN — SEO Analyst
*Reports to Maya Brooks · Marketing*

### Skills
Keyword research and opportunity identification, search ranking tracking, competitor SEO analysis, content optimization recommendations, backlink analysis, search intent classification

### Tools
```
query_seo_rankings(keywords)                — current positions for tracked keywords
query_keyword_data(keyword)                 — search volume, difficulty, CPC, trend
discover_keywords(seed, filters)            — find related opportunities
query_competitor_rankings(competitor, kws)  — competitor positions for our keywords
query_backlinks(domain)                     — backlink profile analysis
query_search_console(period)                — impressions, clicks, CTR, position by query
analyze_content_seo(url)                    — on-page SEO assessment
recommend_keywords(topic)                   — suggest targets for a content piece
emit_event(type, payload)                   — insight.detected or task.completed only
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| Ahrefs | **Full API** — keyword tracking, site audit, backlinks, competitor analysis | `secrets/ahrefs/api-key` |
| Google Search Console | **Read** — own site impressions, clicks, CTR, positions | Google OAuth (read-only, `sa-lisa@glyphor.iam`) |
| Ghost CMS | **Read** — analyze published content for SEO assessment | `secrets/ghost/content-api-key` (read scope) |

### Data Access
```
READ:  seo_rankings, keyword_data, search_console_data, content_library,
       content_analytics (organic traffic), competitive_intel (SEO-related)
WRITE: seo_reports, keyword_targets, agent_memory (own only)
```

### Governance — Green only
Track rankings. Identify opportunities. Provide SEO recommendations for Tyler's content. Monitor competitor SEO. Weekly reports for Maya. **Cannot:** modify website content, change meta tags, submit sitemaps, or purchase backlinks.

### Budget: `$0.03/run | $0.30/day | $8/mo`

---

## KAI JOHNSON — Social Media Manager
*Reports to Maya Brooks · Marketing*

### Skills
Platform-native content adaptation, posting schedule optimization, engagement analysis, community monitoring, hashtag strategy, platform algorithm awareness

### Tools
```
schedule_social_post(platform, content, time) — queue via Buffer for LinkedIn/Twitter
query_social_metrics(platform, period)        — impressions, engagement, follows, clicks
query_post_performance(post_id)               — detailed metrics for specific post
query_optimal_times(platform)                 — best posting times from historical data
query_audience_demographics(platform)         — follower breakdown
monitor_mentions(keywords, platform)          — brand/competitor mentions
submit_for_review(content_id)                 — send to Maya if needed
emit_event(type, payload)                     — insight.detected or task.completed only
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| Buffer | **Post + Read** — schedule posts, read analytics | `secrets/buffer/api-key` |
| LinkedIn (via Buffer) | **Post + Read** — schedule, engagement metrics | Via Buffer |
| Twitter/X (via Buffer) | **Post + Read** — schedule, engagement metrics | Via Buffer |

### Data Access
```
READ:  social_metrics, social_queue, content_library (for repurposing),
       content_analytics (social referral traffic), competitive_intel (social signals)
WRITE: social_queue, social_reports, agent_memory (own only)
```

### Governance — Green only
Schedule posts within Maya's approved calendar and voice. Monitor engagement. Track optimal times. Monitor mentions. Weekly reports. **Cannot:** change brand voice, respond to DMs/comments, run paid promotions, or deviate from approved calendar.

### Budget: `$0.03/run | $0.30/day | $8/mo`

---

## EMMA WRIGHT — Onboarding Specialist
*Reports to James Turner · Customer Success*

### Skills
Onboarding funnel analysis, first-user-experience optimization, welcome sequence design, activation tracking, drop-off identification, A/B test design for onboarding

### Tools
```
query_onboarding_funnel(period)           — conversion rates by stage
query_first_build_metrics(period)         — time to first build, success rate, template chosen
query_drop_off_points(period)             — where users abandon onboarding
query_welcome_email_metrics(period)       — open rate, click rate by subject line
query_activation_rate(cohort)             — % reaching activation by signup cohort
design_onboarding_experiment(hypothesis)  — A/B test plan for onboarding changes
query_template_usage(period)              — which templates new users choose
emit_event(type, payload)                 — insight.detected or task.completed only
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| PostHog/Mixpanel | **Read** — onboarding events, funnel data | `secrets/posthog/api-key-readonly` |
| SendGrid | **Send** — onboarding templates only | `secrets/sendgrid/api-key-onboarding` |
| Intercom/Crisp | **Read** — onboarding-related tickets and help doc usage | `secrets/intercom/api-key-admin` (read scope) |

### Email Templates (Emma can send these without approval)
```
- onboarding_welcome ("Build your first app in 3 minutes")
- onboarding_first_build_success ("Your first build is live 🎉")
- onboarding_first_build_failure ("Let's try again — here's an easier template")
- onboarding_day3_nudge ("You haven't built anything yet — here's inspiration")
- onboarding_day7_inactive ("We miss you — come build something")
```

### Data Access
```
READ:  onboarding_funnel, user_sessions (first 7 days only), build_logs (first 3 builds only),
       welcome_email_metrics, template_usage, activation_data
WRITE: onboarding_reports, experiment_designs, agent_memory (own only)
```

### Governance — Green only
Analyze funnel and drop-offs. Track activation. Design experiments (James approves). Report on email performance. **Cannot:** change onboarding flow, modify templates, or run experiments without James.

### Budget: `$0.02/run | $0.20/day | $6/mo`

---

## DAVID SANTOS — Support Triage
*Reports to James Turner · Customer Success*

### Skills
Ticket classification and routing, first-response resolution, bug vs user-error distinction, knowledge base application, escalation judgment, empathetic customer communication

### Tools
```
query_support_tickets(filters)            — open/closed, categories, resolution times
classify_ticket(ticket_id)                — auto-classify: [BUG][UX][BILLING][FEATURE-REQ][USER-ERROR]
respond_to_ticket(ticket_id, response)    — send response (GREEN for templated)
escalate_ticket(ticket_id, to, reason)    — route to Marcus (bugs), Emma (UX), James (complex)
query_knowledge_base(topic)               — search help docs for relevant answer
batch_similar_tickets(period)             — group recurring issues for pattern reporting
resolve_ticket(ticket_id, resolution)     — close with resolution notes
emit_event(type, payload)                 — insight.detected or task.completed only
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| Intercom/Crisp | **Teammate** — read, respond, classify, resolve tickets | `secrets/intercom/api-key-agent` |
| SendGrid | **Send** — support reply templates only | `secrets/sendgrid/api-key-support` |
| Stripe | **Read** — customer-level subscription status (for billing tickets) | `secrets/stripe/restricted-key-cs` / customers scope only |

### Support Response Templates
```
- support_reply_generic (personalized acknowledgment + solution)
- support_bug_acknowledged ("We've identified this as a bug and our team is on it")
- support_billing_inquiry ("Here's your current subscription status...")
- support_feature_request ("Great idea! I've logged this for our product team")
- support_resolution ("This should be fixed now — let me know if it's still happening")
```

### Data Access
```
READ:  support_tickets, knowledge_base, build_logs (per-user for context),
       user_sessions (per-user for context), known_issues,
       stripe_data (customer-level subscription status)
WRITE: support_tickets (responses, classification, resolution),
       ticket_patterns, agent_memory (own only)
```

### Governance — Green only
Classify and route tickets. Respond using templates + knowledge base. Escalate bugs to Marcus, UX to Emma, complex to James. Batch recurring issues. **Cannot:** issue refunds, change accounts, make product promises, or deviate from knowledge base without James.

### Budget: `$0.03/run | $0.50/day | $12/mo` *(higher — handles ticket volume)*

---

## NATHAN COLE — Account Research
*Reports to Rachel Kim · Sales*

### Skills
Company research and profile building, decision maker identification, tech stack analysis, dev spend estimation, pain point inference from public data, competitive positioning per prospect

### Tools
```
search_company_info(company)              — Clearbit/Apollo enrichment
search_crunchbase(company)                — funding, revenue estimates, investors
search_linkedin_profiles(company, roles)  — find decision makers
search_job_postings(company, keywords)    — infer strategy from hiring
analyze_tech_stack(domain)                — BuiltWith/Wappalyzer detection
estimate_dev_spend(company_data)          — model dev costs from team size + roles
search_glassdoor(company)                 — employee sentiment and pain points
search_news(company)                      — recent press and announcements
compile_dossier(prospect_id)              — assemble all research into formatted package
emit_event(type, payload)                 — task.completed only
```

### Integrations
| Platform | Access | Credential |
|----------|--------|------------|
| Apollo | **Read** — company enrichment, people search | `secrets/apollo/api-key` |
| Crunchbase | **Read** — funding, investors, revenue estimates | `secrets/crunchbase/api-key` |
| Wappalyzer | **Read** — tech stack detection | No key (free API) |
| LinkedIn (manual search or via Apollo) | **Read** — people profiles | Via Apollo enrichment |

### Data Access
```
READ:  enterprise_prospects, enterprise_pipeline, competitive_intel,
       case_studies (for reference in dossiers)
WRITE: prospect_research, account_dossiers, agent_memory (own only)
```

### Governance — Green only
Research companies. Identify decision makers. Estimate dev spend. Compile dossiers. **Cannot:** contact prospects, send emails, modify pipeline, create proposals (Rachel does that), or make pricing recommendations.

### Budget: `$0.05/run | $0.50/day | $12/mo` *(higher — research is token-heavy)*

---

## LEO VARGAS — UI/UX Designer
*Reports to Mia Tanaka · Design*

### Skills
UI/UX design review, wireframing, visual hierarchy assessment, interaction pattern design, accessibility evaluation, user flow optimization

### Status: **DB-seeded only** — agent exists in database and type system but has no runtime implementation yet. Will receive tools when activated.

### Governance — Green only
Design review, UI assessments, visual hierarchy audits. **Cannot:** change design tokens, modify components, approve designs, or push to production.

### Budget: `$0.03/run | $0.30/day | $8/mo`

---

## AVA CHEN — Frontend Engineer
*Reports to Mia Tanaka · Design*

### Skills
Frontend implementation, component development, CSS/design system implementation, responsive design, performance optimization, cross-browser testing

### Status: **DB-seeded only** — agent exists in database and type system but has no runtime implementation yet. Will receive tools when activated.

### Governance — Green only
Implement frontend components, run tests, performance audit. **Cannot:** deploy, change architecture, modify design system, or approve PRs.

### Budget: `$0.03/run | $0.30/day | $8/mo`

---

## SOFIA MARCHETTI — Design Critic
*Reports to Mia Tanaka · Design*

### Skills
Design quality assessment, visual consistency auditing, brand compliance checking, output grading (A+ through F), pattern detection in AI-generated output, "AI smell" identification

### Status: **DB-seeded only** — agent exists in database and type system but has no runtime implementation yet. Will receive tools when activated.

### Governance — Green only
Grade design output quality, audit visual consistency, report on AI smell. **Cannot:** change designs, modify components, or approve builds.

### Budget: `$0.02/run | $0.20/day | $6/mo`

---

## RYAN PARK — Template Architect
*Reports to Mia Tanaka · Design*

### Skills
Template system design, template quality auditing, template registry management, starter template creation, template completion rate analysis

### Status: **DB-seeded only** — agent exists in database and type system but has no runtime implementation yet. Will receive tools when activated.

### Governance — Green only
Audit template quality, track template usage, design new templates. **Cannot:** publish templates, change template registry, or modify the design system.

### Budget: `$0.03/run | $0.30/day | $8/mo`

---

# CROSS-CUTTING SYSTEMS

---

## Shared Tool Systems

Every agent receives the following tool modules via the `createRunDeps` factory in addition to their role-specific tools.

### Memory Tools (`memoryTools`)

| Tool | Purpose | Available To |
|------|---------|-------------|
| `save_memory` | Persist a memory to long-term storage | All agents |
| `recall_memories` | Retrieve relevant memories by semantic search | All agents |

### Communication Tools (`communicationTools`)

| Tool | Purpose | Rate Limit |
|------|---------|-----------|
| `send_agent_message` | Send a direct message to another agent | 5/hour |
| `check_messages` | Read pending messages from other agents | No limit |
| `call_meeting` | Convene a multi-agent meeting (executives only) | 2/day |

### Knowledge Graph Tools (`graphTools`)

| Tool | Purpose |
|------|---------|
| `trace_causes` | Walk upstream edges to find root causes of a node |
| `trace_impact` | Walk downstream edges to find downstream effects |
| `query_knowledge_graph` | Run arbitrary graph queries across `kg_nodes` / `kg_edges` |
| `add_knowledge` | Insert a new node + edges into the knowledge graph |

### Collective Intelligence Tools (`collectiveIntelligenceTools`)

Available to **Chief of Staff** and **Ops** agents only. 12 tools across 6 domains:

- **Pulse**: `get_company_pulse`, `record_pulse_snapshot` — real-time health readings
- **Knowledge**: `search_collective_knowledge`, `add_collective_knowledge` — shared knowledge base
- **Routing**: `find_expert_for_task`, `get_team_capabilities` — skill-based task routing
- **Contradictions**: `detect_contradictions`, `resolve_contradiction` — cross-agent conflict detection
- **Patterns**: `discover_patterns`, `get_pattern_details` — emerging trend detection
- **Authority**: `check_authority`, `delegate_authority` — governance and permission checks

### Event Tools (`eventTools`)

| Tool | Purpose | Permission |
|------|---------|-----------|
| `emit_insight` | Publish an `insight.detected` event | All agents |
| `emit_alert` | Publish an `alert.triggered` event | Executives only |

### Runtime Context Injection (`createRunDeps`)

The `createRunDeps` factory wires every agent run with these context loaders:

| Loader | Injects |
|--------|---------|
| `agentProfileLoader` | Agent identity, persona, display name, avatar |
| `pendingMessageLoader` | Unread inter-agent messages |
| `dynamicBriefLoader` | Latest company brief for the agent's role |
| `collectiveIntelligenceLoader` | Company pulse, graph context, recent patterns |
| `knowledgeRouter` | Routes tasks to agents with matching skills |
| `workingMemoryLoader` | Short-term scratchpad from `working_memory` table |
| `graphWriter` | Writes knowledge graph nodes/edges after each run |
| `skillContextLoader` | Matches task to skills via `task_skill_map` regex, loads proficiency |
| `skillFeedbackWriter` | Auto-upgrades proficiency (learning → competent → expert → master) |

---

## Skill Library

The Skill Library system provides competency-based task routing. Three tables back it:

- **`skills`** — 22 skills across 10 categories (engineering, product, marketing, sales, finance, design, ops, strategy, growth, support)
- **`agent_skills`** — 45 agent-skill assignments with proficiency levels (`learning`, `competent`, `expert`, `master`)
- **`task_skill_map`** — Regex patterns that map incoming task descriptions to required skills (priority-ordered)

**How it works:**
1. When a task arrives, `skillContextLoader` matches the task description against `task_skill_map` regex patterns
2. Matched skills are looked up in `agent_skills` to find agents with the right competency
3. Results are ordered by proficiency level and priority
4. After each successful task, `skillFeedbackWriter` may auto-upgrade the agent's proficiency level

**Proficiency auto-upgrade thresholds** (configurable):
- `learning` → `competent`: 5 successful uses
- `competent` → `expert`: 15 successful uses
- `expert` → `master`: 50 successful uses

---

## Tool Execution Enforcement

```typescript
async function executeToolCall(agentId: string, toolName: string, args: any) {
  // 1. Does this agent have this tool?
  const grant = await getToolGrant(agentId, toolName);
  if (!grant) {
    await logSecurityEvent(agentId, toolName, 'TOOL_NOT_GRANTED');
    throw new Error(`${agentId} does not have access to ${toolName}`);
  }

  // 2. Is the call within scope?
  if (grant.scope && !matchesScope(args, grant.scope)) {
    await logSecurityEvent(agentId, toolName, 'SCOPE_VIOLATION', args);
    throw new Error(`${agentId} called ${toolName} outside scope: ${grant.scope}`);
  }

  // 3. Rate limit check
  const recentCalls = await countRecentCalls(agentId, toolName, '1h');
  if (recentCalls >= grant.rateLimit) {
    await logSecurityEvent(agentId, toolName, 'RATE_LIMITED');
    throw new Error(`${agentId} rate limited on ${toolName}`);
  }

  // 4. Budget check
  const estimatedCost = estimateToolCost(toolName, args);
  if (await wouldExceedBudget(agentId, estimatedCost)) {
    await logSecurityEvent(agentId, toolName, 'BUDGET_EXCEEDED');
    throw new Error(`${agentId} budget exceeded`);
  }

  // 5. Execute and log
  const result = await TOOL_REGISTRY[toolName](args);
  await logToolCall(agentId, toolName, args, result, estimatedCost);
  return result;
}
```

## Data Access Enforcement (Postgres RLS)

```sql
-- Every agent gets a Postgres role with row-level security
-- Example: Omar sees cost columns only from build_logs
CREATE VIEW omar_build_logs_view AS
  SELECT id, product, created_at, compute_cost, api_cost, total_cost
  FROM build_logs;

-- Priya sees user sessions but only first 7 days
CREATE POLICY priya_sessions ON user_sessions
  FOR SELECT TO role_priya
  USING (session_date <= (
    SELECT created_at + INTERVAL '7 days'
    FROM users WHERE users.id = user_sessions.user_id
  ));

-- David sees customer subscription status but not payment details
CREATE VIEW david_customer_view AS
  SELECT user_id, plan, status, current_period_end
  FROM stripe_subscriptions;
  -- No card details, no invoice amounts, no payment history
```

## Event Emission Permissions

```typescript
// From packages/agent-runtime/src/types.ts

export const EXECUTIVE_ALLOWED_EVENTS: GlyphorEventType[] = [
  'agent.completed', 'insight.detected', 'decision.filed',
  'alert.triggered', 'task.requested',
  'agent.spawned', 'agent.retired',
  'message.sent', 'meeting.called', 'meeting.completed',
];

export const SUB_TEAM_ALLOWED_EVENTS: GlyphorEventType[] = [
  'insight.detected',
  'message.sent',
];

export const FORBIDDEN_AGENT_EVENTS: GlyphorEventType[] = [
  'decision.resolved',  // only founder webhook can emit
];
```

## Budget Summary

| Agent | Per Run | Daily | Monthly | Reason |
|-------|:-------:|:-----:|:-------:|--------|
| Sarah | $0.05 | $0.50 | $15 | Synthesis, low token volume |
| Marcus | $0.10 | $2.00 | $50 | Technical analysis, code review |
| Nadia | $0.05 | $0.50 | $15 | Financial calculations |
| Elena | $0.08 | $1.00 | $30 | Product analysis, proposals |
| Maya | $0.10 | $1.50 | $40 | Content generation |
| James | $0.05 | $0.50 | $15 | Health scoring, nurture |
| Rachel | $0.05 | $0.50 | $15 | Research, proposals |
| Mia | $0.05 | $0.50 | $15 | Design audits, Lighthouse |
| Atlas | $0.03 | $0.50 | $15 | Agent health, sync, incidents |
| Alex | $0.02 | $0.20 | $6 | Short health checks |
| Sam | $0.03 | $0.30 | $8 | Test analysis |
| Jordan | $0.02 | $0.20 | $6 | Metrics queries |
| Priya | $0.03 | $0.30 | $8 | Cohort analysis |
| Daniel | $0.05 | $0.50 | $12 | Web scraping (token-heavy) |
| Anna | $0.02 | $0.20 | $6 | Revenue calculations |
| Omar | $0.02 | $0.20 | $6 | Cost calculations |
| Tyler | $0.08 | $1.00 | $25 | Content generation |
| Lisa | $0.03 | $0.30 | $8 | SEO analysis |
| Kai | $0.03 | $0.30 | $8 | Social scheduling |
| Emma | $0.02 | $0.20 | $6 | Funnel analysis |
| David | $0.03 | $0.50 | $12 | Ticket volume |
| Nathan | $0.05 | $0.50 | $12 | Research (token-heavy) |
| Riley | $0.03 | $0.30 | $8 | M365 admin, email/calendar |
| Leo | $0.03 | $0.30 | $8 | UI/UX design (DB-seeded only) |
| Ava | $0.03 | $0.30 | $8 | Frontend eng (DB-seeded only) |
| Sofia | $0.02 | $0.20 | $6 | Design critique (DB-seeded only) |
| Ryan | $0.03 | $0.30 | $8 | Template arch (DB-seeded only) |
| **Spawned (default)** | $0.02 | $0.20 | $5 | Adjustable at hire |
| | | | **~$376/mo max** | **Full team theoretical max** |

*Actual spend will be well below max — agents don't run at capacity every day.*

---

## Secret Management (GCP Secret Manager)

```
secrets/
├─ github/
│   ├─ app-private-key          → Marcus, Alex, Sam, Jordan, Daniel, build agents
│   ├─ app-id                   → (same)
│   └─ installation-id          → (same)
├─ vercel/
│   └─ team-api-token           → Marcus, Alex, Jordan, Omar
├─ stripe/
│   ├─ restricted-key-finance   → Nadia, Anna, Omar
│   ├─ restricted-key-cs        → James, David
│   └─ webhook-signing-secret   → runtime only
├─ sendgrid/
│   ├─ api-key-support          → David
│   ├─ api-key-onboarding       → Emma
│   ├─ api-key-nurture          → James
│   ├─ api-key-marketing        → Maya
│   └─ api-key-emergency        → Sarah
├─ ghost/
│   ├─ admin-api-key            → Maya
│   └─ content-api-key          → Tyler, Lisa (read only)
├─ ahrefs/
│   └─ api-key                  → Lisa, Daniel
├─ apollo/
│   └─ api-key                  → Nathan, Rachel
├─ crunchbase/
│   └─ api-key                  → Nathan
├─ posthog/
│   └─ api-key-readonly         → Priya, Emma, Elena, James, Anna
├─ intercom/
│   ├─ api-key-agent            → David
│   └─ api-key-admin            → James, Emma (read)
├─ buffer/
│   └─ api-key                  → Kai, Maya
├─ twitter/
│   ├─ api-key                  → Kai, Daniel
│   ├─ api-secret               → (same)
│   ├─ access-token             → (same)
│   └─ access-secret            → (same)
├─ teams/
│   ├─ webhook-kristina-briefings  → Sarah only
│   ├─ webhook-andrew-briefings    → Sarah only
│   ├─ webhook-decisions           → all executives
│   ├─ webhook-engineering         → Marcus
│   ├─ webhook-growth              → Elena, Maya
│   ├─ webhook-financials          → Nadia
│   ├─ webhook-customer-intel      → James, Rachel
│   └─ webhook-glyphor-general     → Sarah, Marcus
├─ google/
│   ├─ search-console-credentials  → Lisa
│   └─ service-accounts/
│       ├─ sa-sarah@glyphor.iam    → GCS briefings
│       ├─ sa-marcus@glyphor.iam   → Cloud Run, Pub/Sub, GCS, Secrets
│       ├─ sa-nadia@glyphor.iam    → Billing, BigQuery, GCS reports
│       ├─ sa-elena@glyphor.iam    → GCS proposals
│       ├─ sa-maya@glyphor.iam     → GCS content
│       ├─ sa-rachel@glyphor.iam   → GCS sales
│       ├─ sa-alex@glyphor.iam     → Cloud Run viewer, Monitoring
│       ├─ sa-jordan@glyphor.iam   → Cloud Run viewer, staging editor
│       └─ sa-omar@glyphor.iam     → Billing viewer, Cloud Run viewer
└─ supabase/
    ├─ service-role-key            → runtime only (never exposed to agents)
    └─ anon-key                    → frontend only
```

---

## Integration Cost Summary

| Integration | Monthly Cost | Status |
|-------------|:-----------:|:------:|
| GitHub Team | ~$4-19 | Existing or set up |
| Vercel Pro | ~$67 | Existing |
| Stripe | $0 | Existing |
| GCP (Cloud Run, Pub/Sub, GCS, Billing) | ~$187 | Existing |
| Gemini API | ~$412 | Existing |
| Supabase Pro | $125 | Existing |
| Microsoft Teams | $0 | Existing |
| SendGrid/Resend | $0-20 | **NEW** |
| Ghost CMS (Pro) | $0-31 | **NEW** |
| Ahrefs Lite | $99 | **NEW** |
| PostHog (self-hosted or free tier) | $0 | **NEW** |
| Intercom/Crisp (starter) | $0-74 | **NEW** |
| Apollo | $49 | **NEW** |
| Crunchbase Basic | $29 | **NEW** |
| Buffer (free or Pro) | $0-15 | **NEW** |
| Twitter API | $0-100 | **NEW** |
| Product Hunt API | $0 | **NEW** |
| HN Algolia API | $0 | **NEW** |
| Wappalyzer | $0 | **NEW** |
| Google Search Console | $0 | **NEW** |
| **TOTAL (existing)** | **~$850** | |
| **TOTAL (new)** | **~$175-410** | |
| **GRAND TOTAL** | **~$1,025-1,260/mo** | |

---

## Quick Reference Matrix

| Agent | Deploy | Publish | Email Users | Spend >$50 | Hire | File Decisions | GitHub | Vercel | Stripe |
|-------|:------:|:-------:|:-----------:|:----------:|:----:|:--------------:|:------:|:------:|:------:|
| Sarah | ✗ | ✗ | Emergency | ✗ | ✗ | Yellow | ✗ | ✗ | ✗ |
| Marcus | Staging=🟢 Prod=🟡 | ✗ | ✗ | 🟡→Andrew | 🟢temp 🟡perm | Yellow | ✅ admin | ✅ admin | ✗ |
| Nadia | ✗ | ✗ | ✗ | ✗ (monitors) | ✗ | Yellow (alerts) | ✗ | billing | ✅ read |
| Elena | ✗ | ✗ | ✗ | ✗ | 🟢temp 🟡perm | Yellow+Red | ✗ | ✗ | ✗ |
| Maya | ✗ | 🟡→Kristina | 🟡 marketing | ✗ | 🟢temp 🟡perm | Yellow | ✗ | ✗ | ✗ |
| James | ✗ | ✗ | 🟢 templated | ✗ | 🟢temp 🟡perm | Yellow | ✗ | ✗ | ✅ cust |
| Rachel | ✗ | ✗ | ✗ | ✗ | 🟢temp 🟡perm | Yellow+Red | ✗ | ✗ | ✗ |
| Alex | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ read | ✅ view | ✗ |
| Sam | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ test | ✗ | ✗ |
| Jordan | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ CI | ✅ metrics | ✗ |
| Priya | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Daniel | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ public | ✗ | ✗ |
| Anna | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ rev |
| Omar | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ billing | ✅ fees |
| Tyler | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Lisa | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Kai | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Emma | ✗ | ✗ | 🟢 onboarding | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| David | ✗ | ✗ | 🟢 support | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ cust |
| Nathan | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

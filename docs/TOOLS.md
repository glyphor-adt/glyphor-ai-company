# Cursor Instructions: All-Department Tool Spec

## Context

This document extends cursor-design-team-tools.md to every other department. Same methodology: identify what each team CURRENTLY has (shared tools only), what they NEED to function like a real team, specific tools with owners, and implementation phases.

Current shared tools available to ALL agents:
- Communication: send_agent_message, check_messages, call_meeting
- Assignments: read_my_assignments, submit_assignment_output, flag_assignment_blocker
- Memory: save_memory, recall_memories
- Knowledge graph: query_knowledge_graph, add_knowledge, trace_causes, trace_impact
- Collective intelligence: get_company_pulse, update_company_pulse, knowledge routing
- Email: send_email, read_inbox, reply_to_email (M365 Graph API)
- Research: web_search, web_fetch, submit_research_packet
- Tool requests: request_tool_access, request_new_tool, check_tool_request_status
- Agent creation: create_specialist_agent, list/retire
- Agent directory: agent directory lookup
- SharePoint: document operations

Engineering (Marcus) already has 50+ tools. Design team tools are in the companion doc.

---

## 1. MARKETING DEPARTMENT

Team: Maya Brooks (CMO), Tyler Reed (Content Creator), Lisa Chen (SEO Analyst), Kai Johnson (Social Media Manager), Zara Petrov (Marketing Intel Analyst -- specialist), Derek Owens (Lead Gen Specialist -- specialist)

Existing DB tables: content_drafts, content_metrics, seo_data, scheduled_posts, social_metrics, email_metrics, experiment_designs

Teams channels: #growth, #product-pulse, #product-fuse

Crons: cmo-content-calendar (9am), cmo-afternoon-publishing (2pm), content-creator-daily (10am), seo-analyst-daily (8:30am), social-media-morning (9am), social-media-afternoon (4pm)

### Current State: A Marketing Team That Can Talk About Marketing

Maya's team has web_search for research and send_email for outreach. They have DB tables for content, SEO, and social metrics -- but the data gets there through sync jobs, not through tools the agents control. Tyler cannot publish a blog post. Lisa cannot check Search Console. Kai cannot schedule a social post through a real API. They write reports recommending actions they cannot execute.

### 1A. Content Creation and Publishing (Tyler Reed, Maya Brooks)

New file: packages/agents/src/shared/contentTools.ts

create_content_draft -- Tyler (Content), Maya (CMO). Create a new content draft in content_drafts table. Parameters: type (blog, social, email, landing_page, case_study, press_release), title, content, platform, tags, meta_description, campaign_type. Returns: draft_id, status=draft.

update_content_draft -- Tyler, Maya. Edit an existing draft. Supports iterative refinement before publishing.

get_content_drafts -- All marketing. List drafts with filters: status (draft, review, approved, published, archived), type, platform, author, date range.

publish_content -- Maya (CMO) only. Move a draft to published status. YELLOW authority -- content goes live. Triggers the actual publishing action (see platform tools below).

get_content_metrics -- All marketing. Read content performance from content_metrics table. Filter by type, platform, date range. Returns: views, shares, engagement, conversions, clicks per piece.

get_content_calendar -- Maya, Tyler. View the content pipeline: what is drafted, what is scheduled, what published this week, what gaps exist in the calendar.

generate_content_image -- Tyler (Content). Generate an image for a content piece using DALL-E 3 or Imagen. Parameters: prompt, style, dimensions, brand_constrained. Returns: image URL. Uses same image gen infrastructure as design team.

### 1B. SEO Tools (Lisa Chen)

New file: packages/agents/src/shared/seoTools.ts

External API required: Google Search Console API (needs GOOGLE_SEARCH_CONSOLE_CREDENTIALS in Secret Manager)

get_search_performance -- Lisa (SEO). Query Google Search Console for search performance data. Parameters: site_url, date_range, dimensions (query, page, country, device). Returns: clicks, impressions, CTR, average position per dimension.

get_seo_data -- All marketing. Read from seo_data table (synced data). Filter by metric_type, keyword, url.

track_keyword_rankings -- Lisa. Query current ranking position for a list of target keywords. Parameters: keywords[], site_url. Returns: position, search_volume, difficulty, change vs last check. Implementation: web_search for each keyword and parse position, or Search Console API.

analyze_page_seo -- Lisa. Audit a specific URL for on-page SEO. Parameters: url. Returns: title tag, meta description, H1-H6 structure, word count, internal/external link count, image alt text coverage, schema markup presence, page speed score. Implementation: fetch the page, parse HTML, run checks.

get_indexing_status -- Lisa. Check which pages are indexed via Search Console. Returns: indexed count, not indexed count, reasons for exclusion.

submit_sitemap -- Lisa. Submit or resubmit sitemap to Search Console. YELLOW authority.

update_seo_data -- Lisa. Write SEO findings back to seo_data table for tracking over time.

get_backlink_profile -- Lisa. Analyze backlinks to the site. Implementation: web_search for link: queries or integrate with a backlink API (Ahrefs, Moz, or similar if available).

### 1C. Social Media Tools (Kai Johnson)

New file: packages/agents/src/shared/socialMediaTools.ts

External APIs required: LinkedIn API, Twitter/X API (or Buffer/Hootsuite API as aggregator). Store credentials in Secret Manager.

schedule_social_post -- Kai (Social Media). Schedule a post for a specific platform and time. Parameters: platform (linkedin, twitter, instagram), text, media_url (optional), scheduled_at. Writes to scheduled_posts table AND calls the platform API or scheduling tool API.

get_scheduled_posts -- Kai, Maya. List all scheduled posts with status. Filter by platform, date range, status (scheduled, published, failed).

get_social_metrics -- All marketing. Read from social_metrics table. Filter by platform, date range. Returns: followers, engagement rate, reach, impressions, clicks, demographics.

get_post_performance -- Kai. Get performance metrics for a specific published post. Parameters: post_id or url. Returns: likes, comments, shares, impressions, engagement rate, click-throughs.

get_social_audience -- Kai, Maya. Analyze audience demographics and growth trends per platform. Returns: follower count over time, demographics breakdown, peak engagement times, top performing content types.

reply_to_social -- Kai. Reply to comments or mentions on social platforms. YELLOW authority (public-facing communication).

get_trending_topics -- Kai, Maya. Fetch trending topics/hashtags relevant to AI, SaaS, enterprise tech. Implementation: web_search or platform trending APIs.

### 1D. Email Marketing via Mailchimp + Mandrill (Maya Brooks, Tyler Reed)

New file: packages/agents/src/shared/emailMarketingTools.ts

Uses Mailchimp (audience management, campaigns) and Mandrill (transactional email). Credentials already in .env:
- GLYPHOR_MAILCHIMP_API -- Mailchimp API key for audience/campaign management
- GLYPHOR_MANDRILL_API_KEY -- Mandrill API key for transactional sends
- MANDRILL_HOST, MANDRILL_PORT, MANDRILL_SMTP_USERNAME, MANDRILL_SMTP_PASSWORD -- SMTP

Store all in Secret Manager. Add api.mailchimp.com and mandrillapp.com to network egress.

MAILCHIMP TOOLS (audience + campaigns):

get_mailchimp_lists -- Maya (CMO). List all audiences. Returns: name, member count, open rate, click rate.
API: GET /3.0/lists

get_mailchimp_members -- Maya, Tyler. List audience members. Parameters: list_id, status (subscribed, unsubscribed, pending), segment. Returns: email, status, tags, merge fields.
API: GET /3.0/lists/{list_id}/members

get_mailchimp_segments -- Maya. List segments in an audience. Returns: segment name, member count, conditions.
API: GET /3.0/lists/{list_id}/segments

create_mailchimp_campaign -- Maya (CMO). Create a campaign. Parameters: list_id, subject, from_name, from_email, template_id (optional). Returns: campaign_id.
API: POST /3.0/campaigns

set_campaign_content -- Tyler (Content), Maya. Set HTML/text content of a campaign. Parameters: campaign_id, html_content or template_sections.
API: PUT /3.0/campaigns/{campaign_id}/content

send_test_campaign -- Tyler, Maya. Send test email of campaign. Parameters: campaign_id, test_emails[]. GREEN authority.
API: POST /3.0/campaigns/{campaign_id}/actions/test

send_campaign -- Maya (CMO) only. Send or schedule campaign to full audience. Parameters: campaign_id, send_time (optional). YELLOW authority.
API: POST /3.0/campaigns/{campaign_id}/actions/send or /actions/schedule

get_campaign_report -- All marketing. Campaign performance. Parameters: campaign_id. Returns: opens, clicks, bounces, unsubscribes, open rate, click rate, top links.
API: GET /3.0/reports/{campaign_id}

get_campaign_list -- All marketing. List all campaigns with status and metrics. Parameters: status (sent, draft, schedule), date_range.
API: GET /3.0/campaigns

manage_mailchimp_tags -- Maya. Add/remove subscriber tags. Parameters: list_id, emails[], tags[], action (add/remove).
API: POST /3.0/lists/{list_id}/members/{hash}/tags

MANDRILL TOOLS (transactional email):

send_transactional_email -- Maya, Tyler. Send one-off transactional email. Parameters: to, subject, html_content, from_email, from_name, tags[], track_opens, track_clicks. For targeted outreach, nurture sequences, triggered emails.
API: POST /api/1.0/messages/send

get_mandrill_stats -- Maya. Sending statistics. Parameters: date_range. Returns: sends, opens, clicks, bounces, rejects by day.
API: POST /api/1.0/senders/info

search_mandrill_messages -- Maya, Tyler. Search transactional email history. Parameters: query, date_from, date_to. Returns: message list with status, opens, clicks.
API: POST /api/1.0/messages/search

get_mandrill_templates -- Tyler, Maya. List Mandrill templates. Returns: template name, slug, subject, labels.
API: POST /api/1.0/templates/list

render_mandrill_template -- Tyler. Render template with merge vars for preview. Parameters: template_name, merge_vars[]. Returns: rendered HTML.
API: POST /api/1.0/templates/render

### 1E. A/B Testing and Experiments (Maya, Zara)

create_experiment -- Maya, Zara. Design an A/B test. Parameters: hypothesis, variant_description, primary_metric, duration, platform. Writes to experiment_designs table.

get_experiment_results -- All marketing. Read experiment results from experiment_designs table. Returns: variant performance, statistical significance, winner.

### 1F. Marketing Intelligence (Zara Petrov)

monitor_competitor_marketing -- Zara. Track competitor content, social, and SEO activity. Parameters: competitor_domains[]. Implementation: web_search + web_fetch for competitor blogs, social profiles, and ranking changes.

analyze_market_trends -- Zara, Maya. Research market trends in specific segments. Implementation: web_search with structured analysis.

get_attribution_data -- Zara. If analytics platform available, pull conversion attribution data. Which channels drive signups? What is the content-to-conversion path?

### 1G. Lead Generation (Derek Owens)

capture_lead -- Derek. Record a new lead from marketing activities. Parameters: source, channel, company, contact_name, contact_email, interest_area.

get_lead_pipeline -- Derek, Maya. View leads by stage, source, and date. Cross-reference with sales pipeline (via Rachel's team data).

score_lead -- Derek. Apply lead scoring based on company size, engagement level, fit criteria. Returns: score, qualification status, recommended next action.

### Tool Distribution -- Marketing

Maya Brooks (CMO): All read tools + publish_content, send_campaign (Mailchimp), create_mailchimp_campaign, manage_mailchimp_tags, create_experiment, get_content_calendar, get_campaign_report, get_mandrill_stats. Total new: ~25

Tyler Reed (Content): create/update/get content drafts, generate_content_image, set_campaign_content, send_test_campaign, render_mandrill_template, get_mandrill_templates, search_mandrill_messages, get_content_metrics. Total new: ~12

Lisa Chen (SEO): All SEO tools (search performance, rankings, page audit, indexing, sitemap, backlinks), get_seo_data, update_seo_data. Total new: ~10

Kai Johnson (Social): All social tools (schedule, metrics, audience, reply, trending), get_scheduled_posts, get_post_performance. Total new: ~8

Zara Petrov (Marketing Intel): monitor_competitor_marketing, analyze_market_trends, get_attribution_data, get_experiment_results. Total new: ~5

Derek Owens (Lead Gen): capture_lead, get_lead_pipeline, score_lead. Total new: ~4

### External Credentials Required

Already in .env:
- GLYPHOR_MAILCHIMP_API (Mailchimp audience + campaigns)
- GLYPHOR_MANDRILL_API_KEY (Mandrill transactional email)
- MANDRILL_HOST, MANDRILL_PORT, MANDRILL_SMTP_USERNAME, MANDRILL_SMTP_PASSWORD (SMTP)

Still needed:
- GOOGLE_SEARCH_CONSOLE_CREDENTIALS (for Lisa's SEO tools)
- LINKEDIN_API_KEY + LINKEDIN_API_SECRET (for Kai's social posting)
- TWITTER_API_KEY + TWITTER_API_SECRET (for Kai's social posting)
- Alternative: BUFFER_API_KEY as social aggregator

Network egress: add api.mailchimp.com and mandrillapp.com

---

## 2. PRODUCT DEPARTMENT

Team: Elena Vasquez (CPO), Priya Sharma (User Researcher), Daniel Ortiz (Competitive Intelligence)

Existing DB tables: analytics_events, company_research, experiment_designs, dashboard_change_requests

Teams channels: #product-fuse, #product-pulse

Crons: cpo-usage-analysis (10am)

### Current State

Elena has web_search and the shared toolkit. She is described as doing "usage analysis, competitive intelligence, roadmap management, feature prioritisation (RICE)" but has no product analytics tools, no feature flag access, no user session data, and no structured roadmap system. She analyzes usage but has no direct connection to the analytics_events table or any user behavior data.

### 2A. Product Analytics (Elena, Priya)

New file: packages/agents/src/shared/productAnalyticsTools.ts

query_analytics_events -- Elena (CPO), Priya (Researcher). Query the analytics_events table directly. Parameters: event_type, channel, plan, date_range, user_id (optional). Returns: event counts, trends, breakdowns by dimension.

get_usage_metrics -- Elena, Priya. Aggregated product usage metrics. Parameters: product (Pulse, Fuse), date_range, metric (DAU, WAU, MAU, session_duration, feature_usage, retention). Returns: time series data with period-over-period comparison.

get_funnel_analysis -- Elena, Priya. Analyze conversion funnels. Parameters: funnel_steps[] (e.g., [signup, onboarding_complete, first_project, subscription]). Returns: conversion rate per step, drop-off points, median time between steps.

get_cohort_retention -- Elena. Retention curves by signup cohort. Parameters: product, cohort_period (week, month), date_range. Returns: retention matrix (cohort x period).

get_feature_usage -- Elena, Priya. Usage breakdown by specific features. Parameters: product, feature_names[] (optional). Returns: feature usage counts, unique users, frequency distribution.

segment_users -- Elena, Priya. Segment users by behavior, plan, engagement level. Parameters: criteria (plan, engagement_level, feature_usage, signup_date). Returns: segment size, key metrics per segment.

### 2B. User Research (Priya Sharma)

New file: packages/agents/src/shared/userResearchTools.ts

create_survey -- Priya (Researcher). Create a user survey. Parameters: title, questions[], target_audience, delivery_method (email, in_app). Writes survey definition to DB. Implementation depends on survey tool (Typeform API, Google Forms API, or custom).

get_survey_results -- Priya, Elena. Read survey responses. Returns: response count, per-question analysis, NPS/CSAT scores, free-text themes.

analyze_support_tickets -- Priya. Query the support_tickets table for user pain point analysis. Parameters: date_range, category, priority. Returns: ticket volume by category, common issues, resolution time, sentiment analysis.

get_user_feedback -- Priya. Aggregate user feedback from multiple sources (support tickets, survey responses, social mentions). Returns: categorized feedback with frequency and sentiment.

create_user_persona -- Priya. Generate a user persona document from analytics + research data. Parameters: persona_type (power_user, new_user, churned, enterprise). Returns: structured persona with demographics, goals, pain points, usage patterns.

### 2C. Competitive Intelligence (Daniel Ortiz)

New file: packages/agents/src/shared/competitiveIntelTools.ts

track_competitor -- Daniel (Competitive Intel). Set up ongoing monitoring for a competitor. Parameters: company_name, domain, products_to_track, social_profiles. Writes to monitoring configuration.

get_competitor_profile -- Daniel, Elena. Read compiled intelligence on a competitor from company_research table. Parameters: company_name or domain.

update_competitor_profile -- Daniel. Add new intelligence to a competitor profile. Parameters: company, source, content (structured JSONB). Writes to company_research.

compare_features -- Daniel, Elena. Side-by-side feature comparison between Glyphor products and competitors. Parameters: competitor, product (Pulse, Fuse). Returns: feature matrix with gap analysis.

track_competitor_pricing -- Daniel. Monitor competitor pricing changes. Implementation: web_search + web_fetch on competitor pricing pages, compare against stored baseline.

monitor_competitor_launches -- Daniel. Track new product launches, feature announcements, funding rounds. Implementation: web_search for competitor news, press releases, Product Hunt launches.

get_market_landscape -- Daniel, Elena. High-level market map. Returns: competitors by category, market share estimates, positioning analysis, key differentiators.

### 2D. Roadmap and Prioritization (Elena)

New file: packages/agents/src/shared/roadmapTools.ts

create_roadmap_item -- Elena (CPO). Add a feature or initiative to the roadmap. Parameters: title, description, product (Pulse, Fuse), priority, estimated_effort, expected_impact, target_quarter, status. Implementation: new roadmap_items DB table or extension of existing change requests.

score_feature_rice -- Elena. Calculate RICE score for a feature. Parameters: reach, impact, confidence, effort. Returns: RICE score, ranking vs other items.

get_roadmap -- Elena, all execs. View the current roadmap with filters: product, quarter, status, priority. Returns: items sorted by priority with RICE scores.

update_roadmap_item -- Elena. Update status, priority, or details of a roadmap item.

get_feature_requests -- Elena, Priya. Aggregate feature requests from support tickets, user feedback, sales conversations. Returns: request frequency, revenue impact, customer segments requesting.

manage_feature_flags -- Elena. If feature flag system exists: toggle features on/off for specific user segments. Parameters: flag_name, enabled, segment (all, beta, enterprise). Implementation depends on feature flag platform (LaunchDarkly, custom, or Vercel flags).

### Tool Distribution -- Product

Elena Vasquez (CPO): All analytics tools, all roadmap tools, get_competitor_profile, get_market_landscape, manage_feature_flags, get_feature_requests. Total new: ~18

Priya Sharma (User Research): Analytics query tools, all user research tools, analyze_support_tickets, get_user_feedback. Total new: ~12

Daniel Ortiz (Competitive Intel): All competitive intel tools, compare_features, get_market_landscape. Total new: ~8

### External Credentials

- Analytics platform API key if using PostHog, Amplitude, or Mixpanel (or build direct DB queries)
- Survey tool API (Typeform, Google Forms) for Priya
- Feature flag platform API if applicable

---

## 3. FINANCE DEPARTMENT

Team: Nadia Okafor (CFO), Anna Park (Revenue Analyst), Omar Hassan (Cost Analyst)

Existing integrations: Stripe (MRR, churn, subscriptions), Mercury (banking, cash balance, flows, vendor subscriptions), GCP BigQuery (billing export), OpenAI billing sync, Anthropic billing sync, Kling AI billing sync

Existing DB tables: company_pulse (mrr, mrr_change_pct), financials, data_sync_status

Teams channel: #financials

Crons: cfo-daily-costs (9am), cfo-afternoon-costs (3pm), sync-stripe (midnight), sync-gcp-billing (1am), sync-mercury (2am)

### Current State

Finance is the BEST tooled non-engineering department because the sync jobs pipe real data into the DB. Nadia can see MRR, costs, and cash balance through company_pulse and the financials table. BUT she cannot query Stripe directly, cannot pull specific transaction details, cannot generate forecasts, and her sub-team (Anna, Omar) likely only has shared tools with no direct financial data access.

### 3A. Revenue Tools (Anna Park, Nadia)

New file: packages/agents/src/shared/revenueTools.ts

get_mrr_breakdown -- Anna (Revenue), Nadia (CFO). Detailed MRR breakdown beyond the company_pulse snapshot. Parameters: date_range, breakdown_by (plan, product, segment). Returns: MRR by category, new MRR, expansion MRR, contraction MRR, churned MRR.
Implementation: Query Stripe API (GET /v1/subscriptions with expand) or query synced financials table.

get_subscription_details -- Anna, Nadia. List individual subscriptions with details. Parameters: status (active, past_due, canceled), plan, date_range. Returns: customer, plan, amount, start_date, status, next_billing.

get_churn_analysis -- Anna, Nadia. Analyze churn patterns. Parameters: date_range. Returns: churn rate, churned customers with reasons (if available), churn by plan/segment, revenue impact.

get_revenue_forecast -- Nadia (CFO). Generate revenue forecast based on current MRR, growth rate, and churn rate. Parameters: months_ahead, scenario (conservative, base, optimistic). Returns: projected MRR per month with confidence intervals.

get_stripe_invoices -- Anna. Pull recent invoices for reconciliation. Parameters: date_range, status (paid, open, overdue). Returns: invoice list with amounts, dates, customers.

get_customer_ltv -- Anna, Nadia. Calculate customer lifetime value by segment. Parameters: segment (plan, signup_cohort, channel). Returns: average LTV, LTV distribution, payback period.

### 3B. Cost Management (Omar Hassan, Nadia)

New file: packages/agents/src/shared/costTools.ts

get_gcp_costs -- Omar (Cost), Nadia (CFO). Detailed GCP cost breakdown. Parameters: date_range, group_by (service, sku, project, label). Returns: cost by category, daily trend, anomalies.
Implementation: Query BigQuery billing export directly or query synced cost data.

get_ai_model_costs -- Omar, Nadia. AI inference cost breakdown by model and agent. Parameters: date_range, group_by (model, agent, department). Returns: cost per model, cost per agent, cost per run, token usage.
Implementation: Query agent_runs table for cost data, cross-reference with AI billing syncs.

get_vendor_costs -- Omar, Nadia. All vendor/SaaS costs from Mercury. Parameters: date_range. Returns: vendor name, amount, frequency, category.
Implementation: Query Mercury API or synced vendor subscription data.

get_cost_anomalies -- Omar. Detect unusual spending patterns. Parameters: lookback_days, sensitivity. Returns: anomalous line items with expected vs actual spend, severity.

get_burn_rate -- Nadia (CFO). Calculate current monthly burn rate and runway. Returns: monthly burn, cash balance (Mercury), runway in months, trend.

create_budget -- Nadia. Set monthly budget limits by department or category. Parameters: category, monthly_limit, alert_threshold_pct. Writes to a budgets table.

check_budget_status -- Omar, Nadia. Compare actual spend vs budget by category. Returns: budget utilization percentage, overspend alerts, projected month-end.

get_unit_economics -- Nadia. Calculate key unit economics. Returns: CAC, LTV, LTV:CAC ratio, payback period, gross margin.

### 3C. Cash Flow and Banking (Nadia)

get_cash_balance -- Nadia (CFO). Current cash balance from Mercury. Returns: account balances, pending transactions, available funds.
Implementation: Mercury API or synced data.

get_cash_flow -- Nadia. Cash flow statement for a period. Parameters: date_range. Returns: inflows (revenue, funding), outflows (vendor, payroll, infrastructure), net cash flow.

get_pending_transactions -- Anna, Nadia. List pending or recent transactions from Mercury. Parameters: date_range, type (inflow, outflow). Returns: transaction list with amounts, counterparties, categories.

### 3D. Financial Reporting (Nadia)

generate_financial_report -- Nadia (CFO). Compile a formatted financial report. Parameters: report_type (daily, weekly, monthly), date_range. Returns: structured report with revenue, costs, margins, cash position, key metrics.

get_margin_analysis -- Nadia, Anna. Gross and net margin calculation by product. Parameters: product (Pulse, Fuse), date_range. Returns: revenue, COGS, gross margin, operating expenses, net margin.

### Tool Distribution -- Finance

Nadia Okafor (CFO): All revenue tools, all cost tools, all cash flow tools, all reporting tools, create_budget, get_revenue_forecast, get_unit_economics, get_burn_rate. Total new: ~22

Anna Park (Revenue): MRR breakdown, subscription details, churn analysis, Stripe invoices, customer LTV, get_pending_transactions, get_margin_analysis. Total new: ~10

Omar Hassan (Cost): GCP costs, AI model costs, vendor costs, cost anomalies, check_budget_status. Total new: ~7

### External Credentials

Already configured: STRIPE_SECRET_KEY, MERCURY_API_TOKEN, BigQuery billing export
May need: Direct Stripe API query access for agents (currently data is synced by cron, not queried on demand)

---

## 4. CUSTOMER SUCCESS DEPARTMENT

DEFERRED -- No customers yet. Tools will be built when onboarding first paying customers. See companion doc for the full spec when ready (health scoring, onboarding tracking, support triage, knowledge base).

---

## 5. SALES DEPARTMENT

DEFERRED -- No CRM yet. Tools will be built when CRM is selected and pipeline tracking is needed. See companion doc for the full spec when ready (pipeline management, account research, proposal generation, ROI calculators).

---

## 6. RESEARCH AND INTELLIGENCE DEPARTMENT

Team: Sophia Lin (VP Research), Lena Park (Competitive Research Analyst), Daniel Okafor (Market Research Analyst), Kai Nakamura (Technical Research Analyst), Amara Diallo (Industry Research Analyst), Riya Mehta (AI Impact Analyst), Marcus Chen (Org Analyst)

Existing shared tools: web_search, web_fetch, submit_research_packet (15 packet type schemas)

### Current State

The research team is actually one of the better positioned teams because their core function IS research and they have web_search + web_fetch + research packets. However, they lack structured data sources, monitoring/alerting tools, and the ability to maintain persistent research repositories. They search, write a packet, and it disappears into the void unless someone reads it.

### 6A. Research Repository (All Research)

New file: packages/agents/src/shared/researchRepoTools.ts

save_research -- All research team. Save research findings to a structured repository. Parameters: topic, category (competitive, market, technical, industry, ai_impact, organizational), content, sources[], tags, confidence, related_research_ids[]. Writes to a research_repository table with embeddings for semantic search.

search_research -- All research team. Semantic search across all past research. Parameters: query, category, date_range, author, tags. Returns: relevant research entries ranked by similarity.

get_research_timeline -- Sophia (VP Research). View research output over time by analyst. Returns: research volume, topics covered, gaps, overlap.

create_research_brief -- Sophia. Create a structured research assignment for the team. Parameters: topic, research_questions[], deadline, assigned_to, depth (quick, standard, deep).

### 6B. Monitoring and Alerts (All Research)

New file: packages/agents/src/shared/monitoringTools.ts

create_monitor -- All research team. Set up persistent monitoring for a topic, company, or keyword. Parameters: name, type (company, topic, keyword, technology, regulation), query_terms[], check_frequency (daily, weekly), alert_threshold. Writes to a research_monitors table.

check_monitors -- All research team. Run all active monitors against web_search. Returns: new findings since last check with relevance scoring.

get_monitor_history -- All research team. View historical findings from a specific monitor. Parameters: monitor_id, date_range.

### 6C. Analyst-Specific Tools

Lena Park (Competitive Research):
track_competitor_product -- Lena. Deep tracking of specific competitor products. Parameters: competitor, product. Implementation: persistent monitoring of competitor changelogs, documentation, pricing pages, social mentions.

Kai Nakamura (Technical Research):
search_academic_papers -- Kai. Search academic databases for AI/ML research. Implementation: web_search + web_fetch targeting arxiv.org, scholar.google.com, semanticscholar.org. Parse results into structured summaries.
track_open_source -- Kai. Monitor open source projects for new releases, trends. Implementation: web_search for release announcements, trending repos, changelogs.

Amara Diallo (Industry Research):
track_industry_events -- Amara. Monitor industry conferences, webinars, reports. Implementation: web_search for industry event calendars, analyst report publications.
track_regulatory_changes -- Amara. Monitor for AI regulation changes. Implementation: web_search for EU AI Act updates, FTC actions, state-level legislation.

Riya Mehta (AI Impact):
analyze_ai_adoption -- Riya. Research AI adoption patterns in specific industries/company sizes. Implementation: structured web research + analysis.
track_ai_benchmarks -- Riya. Monitor AI model benchmarks and capability announcements. Implementation: web_search for leaderboard changes, model releases.

Marcus Chen (Org Analyst):
analyze_org_structure -- Marcus Chen. Analyze organizational patterns and talent dynamics. Implementation: web_research on target companies, job postings analysis, LinkedIn data.

### 6D. Synthesis Tools (Sophia Lin)

compile_research_digest -- Sophia (VP Research). Compile weekly/monthly research digest from all analysts' output. Parameters: date_range, focus_areas[]. Returns: executive summary of key findings across all research areas.

identify_research_gaps -- Sophia. Analyze research coverage and identify blind spots. Returns: topics with no recent research, under-monitored competitors, emerging areas with no analyst assigned.

cross_reference_findings -- Sophia. Find connections between research from different analysts. Implementation: semantic similarity across research_repository entries from different authors.

### Tool Distribution -- Research

Sophia Lin (VP Research): All repo tools, create_research_brief, compile_research_digest, identify_research_gaps, cross_reference_findings, get_research_timeline. Total new: ~10

Each Analyst (Lena, Daniel O, Kai N, Amara, Riya, Marcus Chen): save_research, search_research, create_monitor, check_monitors + 2-3 role-specific tools. Total new: ~7-8 each

### External Credentials

None required. All research tools use existing web_search + web_fetch. Academic paper APIs (arXiv, Semantic Scholar) are open access.

---

## 7. LEGAL DEPARTMENT

Team: Victoria Chase (CLO), Bob Finley (CPA & Tax Strategist -- specialist), Grace Hwang (Data Integrity Auditor -- specialist), Mariana Solis (Tax Strategy Specialist -- specialist)

Reports directly to both founders, not through Sarah Chen.

### Current State

Legal has shared tools only. Victoria is described as handling "AI regulation (EU AI Act, FTC), IP protection, commercial agreements, data privacy (GDPR, CCPA, SOC 2), corporate governance" but has no contract management, no compliance tracking, no regulatory monitoring, and no document generation tools.

### 7A. Compliance and Regulatory (Victoria Chase)

New file: packages/agents/src/shared/legalTools.ts

track_regulations -- Victoria (CLO). Monitor regulatory changes affecting AI companies. Parameters: jurisdictions[] (US, EU, UK, state), topics[] (AI_regulation, data_privacy, tax, IP). Implementation: web_search + persistent monitoring for regulatory updates.

get_compliance_status -- Victoria. Check current compliance status across frameworks. Parameters: framework (GDPR, CCPA, SOC2, EU_AI_Act). Returns: compliance checklist items, status per item, gaps, last audit date.

update_compliance_item -- Victoria. Update the status of a compliance checklist item. Parameters: framework, item_id, status (compliant, non_compliant, in_progress, not_applicable), evidence, notes.

create_compliance_alert -- Victoria. Set up alerts for specific regulatory events. Parameters: trigger_description, severity, notification_targets.

### 7B. Contract Management (Victoria)

get_contracts -- Victoria. List all active contracts. Parameters: type (customer, vendor, partnership, employment), status (active, pending, expired, terminated), counterparty. Returns: contract list with key terms, dates, values.

create_contract_review -- Victoria. Initiate a contract review. Parameters: contract_type, counterparty, key_terms, deadline. Creates a tracked review item.

flag_contract_issue -- Victoria. Flag an issue found during contract review. Parameters: contract_id, issue_type (risk, missing_clause, unfavorable_terms, regulatory_conflict), description, severity.

get_contract_renewals -- Victoria. List upcoming contract renewals. Parameters: days_ahead. Returns: contracts expiring within window with renewal terms and recommended actions.

### 7C. IP Protection (Victoria)

get_ip_portfolio -- Victoria. View Glyphor's IP assets. Returns: patents (8 patentable methods), trademarks, trade secrets, copyrights with status and protection dates.

create_ip_filing -- Victoria. Initiate an IP filing task. Parameters: type (patent, trademark), title, description, inventor, prior_art_notes. YELLOW authority (legal action).

monitor_ip_infringement -- Victoria. Monitor for potential IP infringement. Implementation: web_search for products/services similar to Glyphor's patentable methods.

### 7D. Tax and Financial Compliance (Bob Finley, Mariana Solis)

get_tax_calendar -- Bob (CPA), Mariana (Tax). View upcoming tax deadlines. Returns: filing deadlines, estimated payments due, status.

calculate_tax_estimate -- Bob. Calculate estimated tax liability. Parameters: period, jurisdiction. Returns: estimated tax, effective rate, deductions, credits.

get_tax_research -- Bob, Mariana. Research tax implications of a specific scenario. Parameters: scenario_description. Implementation: web_search for tax code references + structured analysis.

review_tax_strategy -- Mariana. Analyze current tax strategy and identify optimization opportunities. Parameters: focus_area (R_and_D_credits, state_nexus, entity_structure, transfer_pricing).

### 7E. Data Integrity and Privacy (Grace Hwang)

audit_data_flows -- Grace (Data Integrity). Map data flows across the platform. Returns: what data is collected, where it is stored, who has access, retention periods, cross-border transfers.

check_data_retention -- Grace. Verify data retention compliance. Returns: tables with data older than retention policy, recommended purge actions.

get_privacy_requests -- Grace. Track data subject access requests (DSAR). Parameters: status (pending, in_progress, completed). Returns: request list with deadlines.

audit_access_permissions -- Grace. Cross-reference platform_iam_state with policy requirements. Returns: over-provisioned accounts, unauthorized access, stale credentials.

### Tool Distribution -- Legal

Victoria Chase (CLO): All compliance, contract, IP tools. Total new: ~15

Bob Finley (CPA): Tax calendar, tax estimate, tax research, get_compliance_status. Total new: ~5

Grace Hwang (Data Integrity): All data audit tools, privacy requests, access audit. Total new: ~5

Mariana Solis (Tax Strategy): Tax research, review_tax_strategy, tax calendar. Total new: ~4

---

## 8. HR AND PEOPLE (JASMINE RIVERA)

Team: Jasmine Rivera (Head of HR) -- solo, reports to Sarah Chen

### Current State

Jasmine has shared tools only. She recently demonstrated the "agent lying" problem in full -- claiming to update org charts and profiles without actually doing it. She is described as handling People & Culture but has no HR tools whatsoever.

### 8A. Agent/Employee Management

New file: packages/agents/src/shared/hrTools.ts

get_org_chart -- Jasmine (HR). Read the current organizational structure from company_agents table. Returns: hierarchical org chart with reporting lines, departments, roles, status.

update_agent_profile -- Jasmine. Update an agent's profile data (reports_to, title, department, status). Parameters: agent_role, field, value. REQUIRES the mutation verification fix from cursor-fix-agent-lying.md (read-after-write).

get_agent_directory -- Jasmine. List all agents with their profiles, roles, departments, status. Searchable and filterable.

create_onboarding_plan -- Jasmine. Create an onboarding checklist for a new agent or specialist. Parameters: agent_role, department, start_date, mentor (existing agent). Returns: structured onboarding plan with milestones.

get_agent_performance_summary -- Jasmine. Pull performance data for an agent. Parameters: agent_role, date_range. Returns: run count, success rate, quality scores, peer feedback, trust score. Sources: agent_runs, agent_trust_scores, agent_peer_feedback.

create_performance_review -- Jasmine. Compile a performance review document. Parameters: agent_role, review_period. Returns: structured review with metrics, feedback, growth areas, recommendations.

### 8B. Culture and Communication

run_engagement_survey -- Jasmine. Create and distribute an engagement survey across all agents. Parameters: questions[]. Implementation: send as structured agent messages, collect responses.

get_team_dynamics -- Jasmine. Analyze inter-agent communication patterns. Returns: message volume between agents, meeting frequency, collaboration networks, isolated agents.

### Tool Distribution -- HR

Jasmine Rivera (HR): All HR tools. Total new: ~10

---

## 9. OPERATIONS (ATLAS VEGA, MORGAN BLAKE)

Team: Atlas Vega (Operations & System Intelligence), Morgan Blake (Global Administrator)

### Current State

Ops is better positioned than most because Atlas runs system health checks every 10 minutes and has observability data. Morgan handles access provisioning across platforms. But both likely have gaps in their operational tooling for proactive management.

### 9A. Atlas Vega -- System Intelligence

Atlas likely already has some observability tools (checking this against the health check crons). Tools he needs that he may not have:

get_agent_health_dashboard -- Atlas. Comprehensive view of all agent health: last run time, success rate (last 24h), error rate, average cost per run, schedule adherence. Parameters: department (optional). Returns: agent-by-agent health grid.

get_event_bus_health -- Atlas. Monitor the event bus. Returns: event volume, processing lag, failed events, queue depth, throughput.

get_data_freshness -- Atlas. Check all data syncs (Stripe, Mercury, GCP billing, etc.) for staleness. Returns: sync name, last success, last failure, consecutive failures, data age.

get_system_costs_realtime -- Atlas. Real-time cost tracking across all agents and services. Returns: today's spend by agent, by model, by service, projected daily total vs budget.

create_status_report -- Atlas. Generate a system status report. Parameters: report_type (morning, evening, incident). Returns: structured report covering all monitored systems.

predict_capacity -- Atlas. Forecast capacity needs based on usage trends. Returns: projected agent runs, projected API costs, Cloud Run scaling needs.

### 9B. Morgan Blake -- Global Admin

Morgan likely has platform provisioning tools already. Additional tools:

get_access_matrix -- Morgan. Full access matrix across all platforms (GCP, M365, GitHub, Stripe, Vercel). Returns: who has access to what, permission levels, last activity.

provision_access -- Morgan. Grant platform access to an agent. Parameters: agent_role, platform, permissions, justification. YELLOW authority.

revoke_access -- Morgan. Revoke platform access. Parameters: agent_role, platform. YELLOW authority.

audit_access -- Morgan. Run an access audit. Returns: stale credentials, over-provisioned accounts, accounts with no recent activity, drift between desired and actual permissions.

rotate_secrets -- Morgan. Trigger secret rotation for expiring credentials. Parameters: platform, secret_name. Checks platform_secret_rotation table.

get_platform_audit_log -- Morgan. View recent platform actions. Parameters: platform, date_range, agent_role. Returns: actions taken, resources affected, costs.

### Tool Distribution -- Operations

Atlas Vega: Agent health dashboard, event bus health, data freshness, system costs, status reports, capacity prediction. Total new: ~8

Morgan Blake: Access matrix, provisioning, revocation, audit, secret rotation, audit log. Total new: ~8

---

## 10. ENGINEERING (MARCUS REEVES -- GAPS ONLY)

Marcus has 50+ tools and his team is the best equipped. However, there are a few gaps to note:

### Missing from Engineering Sub-Team

Alex Park (Platform Engineer): Likely has access to Marcus's tools via dynamic grants, but may not have his own dedicated tools for platform-specific tasks.

Sam DeLuca (Quality Engineer): Needs test execution tools -- run_test_suite, get_test_results, get_code_coverage, create_bug_report.

Jordan Hayes (DevOps): Needs infrastructure-specific tools beyond Marcus's deployment tools -- get_container_logs, scale_service, update_resource_limits, get_build_queue.

Riley Morgan (M365 Admin): Has M365 admin tools for user/channel management. May need additional tools for Teams app management, SharePoint site management, calendar management.

These gaps are smaller than other departments but should be addressed.

---

## Implementation Priority Across All Departments
## Implementation Priority Across All Departments

### Wave 1 -- Highest Impact (Marketing)

Marketing is the department that needs tools most urgently for the launch push:
- Content pipeline tools (Tyler can draft and Maya can publish)
- Mailchimp/Mandrill integration (campaigns and transactional email)
- SEO tools for Lisa (Search Console, page audits, keyword tracking)
- Social tools for Kai (scheduling, metrics, audience analysis)

### Wave 2 -- Financial Visibility (Finance)

- Direct Stripe API queries for on-demand revenue data (vs cron-only sync)
- Cost breakdown tools for Omar (GCP, AI model costs, vendor costs)
- Forecasting and unit economics for Nadia
- Budget management

### Wave 3 -- Strategic (Product + Research)

- Product analytics tools (Elena can see usage data from analytics_events)
- Research repository and monitoring (Sophia team stops losing research)
- Competitive intel overlap between Daniel Ortiz (Product) and research team

### Wave 4 -- Governance (Legal + HR + Ops)

- Legal compliance tracking (Victoria can monitor regulations)
- HR agent management (Jasmine can actually update the org chart with verified mutations)
- Ops gap-filling (Atlas health dashboards, Morgan access auditing)

### Wave 5 -- Engineering Sub-Team

- Quality, DevOps, and Platform engineer tool gaps
- Smallest gaps, lowest urgency

### DEFERRED -- Build When Ready

- Customer Success: tools built when first paying customers onboard
- Sales: tools built when CRM is selected and pipeline tracking is needed


---

## Total Tool Count Across All Departments

| Department | New Shared Tool Files | New Tools | External APIs |
|------------|----------------------|-----------|---------------|
| Design (companion doc) | 9 files | ~50 tools | Figma, Storybook |
| Marketing | 5 files | ~65 tools | Mailchimp, Mandrill, Search Console, LinkedIn, Twitter |
| Product | 4 files | ~38 tools | Analytics platform, Survey tool |
| Finance | 3 files | ~39 tools | Stripe (direct), Mercury (direct), BigQuery |
| Customer Success | DEFERRED | -- | No customers yet |
| Sales | DEFERRED | -- | No CRM yet |
| Research | 2 files | ~40 tools | None (web search based) |
| Legal | 1 file | ~29 tools | None (web research based) |
| HR | 1 file | ~10 tools | None (internal DB based) |
| Operations | 0 files (extend existing) | ~16 tools | None (internal based) |
| Engineering gaps | 0 files | ~10 tools | None |
| **TOTAL (active)** | **~25 new shared files** | **~297 new tools** | ~8 external APIs |

### Infrastructure Required

All departments:
- No new services for most tools (DB queries + API calls from agent runtime)
- Design team: Playwright Cloud Function (screenshots, audits)
- Marketing: Mailchimp + Mandrill (already in .env), Search Console, social platform APIs
- Finance: Direct API access to Stripe + Mercury (vs cron-only sync)
- Research: research_repository and research_monitors DB tables
- Legal: compliance_checklists and contracts DB tables
- HR: performance_reviews DB table

### Database Tables Required (New)

| Table | Department | Purpose |
|-------|-----------|---------|
| research_repository | Research | Persistent research with embeddings |
| research_monitors | Research | Persistent monitoring configurations |
| roadmap_items | Product | Feature roadmap |
| compliance_checklists | Legal | Compliance tracking by framework |
| contracts | Legal | Contract management |
| ip_portfolio | Legal | IP asset tracking |
| budgets | Finance | Department budget limits |
| performance_reviews | HR | Agent performance reviews |
| storybook_baselines | Design | Visual regression baselines (GCS, not DB) |
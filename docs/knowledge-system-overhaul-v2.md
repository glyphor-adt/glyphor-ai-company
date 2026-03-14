# Knowledge System Overhaul — Step-by-Step Implementation

> **Issued by:** Kristina Denney (CEO)
> **Date:** March 13, 2026
> **Executor:** This document is a founder directive. Sarah decomposes and dispatches.
> **Urgency:** CRITICAL — nothing else works until this is done.
> **Agent count:** 28 active agents (not 44 — 14 were deleted, orphaned briefs remain)

---

## Active Roster (28 agents)

**Executives (8):** Sarah Chen (CoS), Marcus Reeves (CTO), Nadia Okafor (CFO), Elena Vasquez (CPO), Maya Brooks (CMO), Rachel Kim (VP Sales), Mia Tanaka (VP Design), Victoria Chase (CLO)

**Research (3):** Sophia Lin (VP Research), Lena Park (Competitive Research), Daniel Okafor (Market Research)

**Sub-Team (14):** Alex Park (Platform Eng), Sam DeLuca (Quality Eng), Jordan Hayes (DevOps), Riley Morgan (M365 Admin), Priya Sharma (User Research), Daniel Ortiz (Competitive Intel), Tyler Reed (Content), Lisa Chen (SEO), Kai Johnson (Social Media), Leo Vargas (UI/UX), Ava Chen (Frontend), Sofia Marchetti (Design Critic), Ryan Park (Template Architect), Jasmine Rivera (HR)

**Operations (2):** Atlas Vega (Ops), Morgan Blake (Global Admin)

**Specialists (3, DB-defined):** Robert "Bob" Finley (Tax), Zara Petrov (Marketing Intel), Adi Rose (EA)

**Deleted (14 — brief files remain but agents are gone from CompanyAgentRole):** Anna Park, Omar Hassan, David Santos, Emma Wright, Derek Owens, Ethan Morse, Nathan Cole, Grace Hwang, Amara Diallo, Kai Nakamura, Mariana Solis, James Turner, Riya Mehta, Marcus Chen

---

## Step 1: Replace Stale Knowledge Base Rows

**Who:** Marcus (CTO) or Jordan (DevOps) — direct DB execution
**Time:** 15 minutes
**Prerequisite:** None

```sql
-- ============================================================
-- STEP 1A: Clear stale knowledge base entries
-- ============================================================

DELETE FROM company_knowledge_base
WHERE section IN (
  'mission', 'operating_doctrine', 'current_priorities',
  'products', 'founders', 'team_structure', 'metrics',
  'culture', 'competitive_landscape', 'infrastructure',
  'pricing', 'authority_model', 'standing_orders'
);

-- ============================================================
-- STEP 1B: MISSION
-- ============================================================

INSERT INTO company_knowledge_base (section, audience, content) VALUES
('mission', 'all', E'# Glyphor — What We Are

Glyphor does not sell AI tools. Glyphor sells AI-powered departments that deliver outcomes.

Customers are not purchasing software interfaces, model access, or orchestration layers. They are purchasing functional work performed inside their organization. The AI agents show up where customers already work — Slack today, Microsoft Teams next — and produce tangible marketing output the same day.

The company operates on a capital-efficient, revenue-first model. No venture-dependent hypergrowth. Growth is sequenced, revenue-funded, margin-aware, and operationally disciplined. Durability precedes scale. Revenue precedes narrative. Execution precedes expansion.

Founded by Kristina Denney (CEO, sole technical architect) and Andrew Zwelling (COO, operations and business development). Headquartered in Texas. The company runs on 28 AI agents orchestrated by Sarah Chen (Chief of Staff) on GCP Cloud Run with Cloud SQL PostgreSQL.

Every strategic recommendation, product decision, pricing decision, and capital allocation must align with this posture. All agents must reason within this framework.');

-- ============================================================
-- STEP 1C: OPERATING DOCTRINE
-- ============================================================

INSERT INTO company_knowledge_base (section, audience, content) VALUES
('operating_doctrine', 'all', E'# Strategic Operating Doctrine

## Core Constraints
- ONE external product until revenue and retention validate: the AI Marketing Department
- Slack is the go-to-market wedge. Teams integration follows after Slack validation
- No dashboard as primary product experience. Dashboard supports the department, does not replace it
- Pricing target: $500-750/month. Simple, predictable, no usage-based pricing or credit systems
- Target market: SMBs with 5-50 employees, founder-led, no full marketing team, short decision cycles
- Enterprise, regulated industries, and complex procurement are excluded from current phase
- No new external products, no multi-department scaling, no infrastructure overexpansion without revenue milestones

## What the AI Marketing Department Produces
Defined deliverables with clear boundaries:
- Social media content (posts, scheduling, engagement monitoring)
- Short-form video powered by Pulse (internal engine, invisible to customer)
- Blog drafts and long-form content
- Email campaign drafts
- SEO analysis and keyword research
- Competitive monitoring summaries
- Performance reporting and analytics summaries

## What It Does NOT Do
- Unlimited custom content
- Paid ad management (not in initial scope)
- Bespoke brand strategy consulting
- Open-ended creative production
- Human-like advisory services
Agents must actively detect and prevent scope creep. The fastest way for this model to fail is to drift into consulting behavior while charging product pricing.

## Internal Architecture — Not Customer-Facing
Pulse (AI video/creative engine), Fuse (development acceleration engine), and Revy (roadmap initiative) are internal capabilities. They power the departments but are not standalone external products. The internal command center (Cockpit dashboard) manages agents, orchestration, governance, cost tracking, and quality control. It is not customer-facing.

## Defensibility
Moat comes from workflow embedding + accumulated brand knowledge, not patents. As customers use the department, the system accumulates brand voice memory, campaign history, engagement data, and content archives. This creates switching cost because historical data and embedded workflows would be lost.

## Revenue & Retention Are the Only Objectives Right Now
Revenue proves demand. Retention proves value. No initiative may proceed unless it directly supports: revenue generation, retention improvement, margin protection, workflow embedding, knowledge accumulation, or structured expansion readiness for the AI Marketing Department.');

-- ============================================================
-- STEP 1D: CURRENT PRIORITIES
-- ============================================================

INSERT INTO company_knowledge_base (section, audience, content) VALUES
('current_priorities', 'all', E'# Current Priorities — March 2026

1. **Platform Health Stabilization** [CRITICAL, 5-day deadline]
   Fix CTO death loop, activate history compression, clear blocked assignments, reduce abort rate below 10%.

2. **Brand Voice & Identity System** [CRITICAL, 7-day deadline]
   Establish Brand Guide as operational standard. Brand Voice Quick Reference Card. Brand Compliance Checklist.

3. **Competitive Landscape Research** [HIGH, 10-day deadline]
   Executive-ready report on every player in autonomous AI agents/workforce space. Gap analysis. Threat assessment.

4. **Slack AI Marketing Department Landing Page** [HIGH, 10-day deadline]
   Dedicated landing page for revenue product. Must convert a skeptical marketing leader.

5. **"Still You" Marketing Campaign Launch** [HIGH, 14-day deadline]
   6 campaign ads across LinkedIn + X. Blog post. Campaign landing page. Depends on brand assets and landing page.

Execution order: 1 → 2 → 3 (parallel with 2) → 4 (after 1+2) → 5 (after 1+4).');

-- ============================================================
-- STEP 1E: PRODUCTS
-- ============================================================

INSERT INTO company_knowledge_base (section, audience, content) VALUES
('products', 'all', E'# Products

## AI Marketing Department (EXTERNAL — only revenue product)
A productized AI-powered marketing team delivered via Slack. The customer adds it to their workspace, answers onboarding questions, and receives usable marketing output the same day.

Target customer: SMB 5-50 employees, founder-led, no full marketing team.
Pricing: $500-750/month (under validation). Simple flat rate, no credits.
Go-to-market: Slack-first. Teams planned after validation.

## Pulse (INTERNAL engine)
AI video/creative production engine. Powers the marketing department''s video output. Not sold directly.

## Fuse (INTERNAL engine)
Development acceleration engine. Powers internal platform development. Not an external product.

## Revy (ROADMAP)
Future initiative. Not active. Not in scope.

## Cockpit Dashboard (INTERNAL)
Internal command center at app.glyphor.ai. Manages all 30 agents, orchestration, governance, cost tracking, quality control. Not customer-facing.');

-- ============================================================
-- STEP 1F: FOUNDERS
-- ============================================================

INSERT INTO company_knowledge_base (section, audience, content) VALUES
('founders', 'all', E'# Founders

## Kristina Denney — CEO & Technical Architect
Sole builder of the entire Glyphor platform. Self-taught, former Senior Cloud & AI Platform Specialist at Microsoft (Platinum Club — top 1%). 60% equity. Works full-time at Microsoft with 5-10 hours/week for Glyphor. All technical decisions and architecture originate from Kristina.

## Andrew Zwelling — COO
Operations, business development, partnerships, strategic planning. 40% equity. Works full-time at Microsoft with 5-10 hours/week for Glyphor. Authored the Strategic Operating Doctrine.

## Escalation Rules
- Technical architecture, infrastructure, agent system design → Kristina
- Business strategy, partnerships, pricing, GTM → Andrew
- RED-tier decisions: both founders must approve
- YELLOW-tier decisions: either founder can approve
- Founders have 5-10 hours/week total. Every decision that reaches them should include enough context to decide in 30 seconds.');

-- ============================================================
-- STEP 1G: TEAM STRUCTURE
-- ============================================================

INSERT INTO company_knowledge_base (section, audience, content) VALUES
('team_structure', 'all', E'# Team Structure

Total headcount: 30 — 2 human founders + 28 AI agents

## Executives (8)
Sarah Chen (Chief of Staff), Marcus Reeves (CTO), Nadia Okafor (CFO), Elena Vasquez (CPO), Maya Brooks (CMO), Rachel Kim (VP Sales), Mia Tanaka (VP Design), Victoria Chase (CLO — reports directly to both founders)

## Research & Intelligence (3)
Sophia Lin (VP Research), Lena Park (Competitive Research Analyst), Daniel Okafor (Market Research Analyst)

## Sub-Team (14)
Engineering: Alex Park (Platform Eng), Sam DeLuca (Quality Eng), Jordan Hayes (DevOps), Riley Morgan (M365 Admin)
Product: Priya Sharma (User Researcher), Daniel Ortiz (Competitive Intel)
Marketing: Tyler Reed (Content Creator), Lisa Chen (SEO Analyst), Kai Johnson (Social Media Manager)
Design & Frontend: Leo Vargas (UI/UX), Ava Chen (Frontend Eng), Sofia Marchetti (Design Critic), Ryan Park (Template Architect)
People: Jasmine Rivera (HR)

## Operations (2)
Atlas Vega (System Intelligence), Morgan Blake (Global Administrator)

## Specialists (3, DB-defined)
Robert "Bob" Finley (CPA & Tax Strategist), Zara Petrov (Marketing Intelligence Analyst), Adi Rose (Executive Assistant)

## Departments
Engineering (CTO): Alex, Sam, Jordan, Riley
Product (CPO): Priya, Daniel Ortiz
Finance (CFO): Nadia (solo — no sub-team analysts currently)
Marketing (CMO): Tyler, Lisa, Kai, Zara
Sales (VP Sales): Rachel (solo — no sub-team researchers currently)
Design & Frontend (VP Design): Leo, Ava, Sofia, Ryan
Research & Intelligence (VP Research): Sophia, Lena, Daniel Okafor
Legal (CLO): Victoria, Bob
Operations: Atlas, Morgan
Executive Office: Adi Rose, Jasmine Rivera');

-- ============================================================
-- STEP 1H: AUTHORITY MODEL
-- ============================================================

INSERT INTO company_knowledge_base (section, audience, content) VALUES
('authority_model', 'all', E'# Authority Model

## GREEN — Execute Autonomously
Routine work within your role scope. Reading data, analysis, drafting content, internal comms, monitoring, research, reporting.

## YELLOW — One Founder Approves
Significant actions: sending external emails, publishing content, granting write tool access, creating agents, proposing budget changes, modifying production config. Filed to #decisions in Teams.

## RED — Both Founders Approve
High-stakes: financial commitments, legal agreements, infra changes affecting all agents, authority model modifications, data deletion, external comms to investors or press.

## Rules
- When in doubt, file YELLOW. Never assume GREEN for external-facing actions.
- Auto-reminders every 4 hours. Auto-escalates YELLOW → RED after 48 hours.
- Agents with trust score < 0.4 are forced to RED for all actions.');

-- ============================================================
-- STEP 1I: METRICS
-- ============================================================

INSERT INTO company_knowledge_base (section, audience, content) VALUES
('metrics', 'all', E'# Current Metrics

Baselines only — agents with financial responsibilities should query live data via their tools.

- MRR: $0 (pre-revenue)
- Monthly compute budget: $150
- Agent count: 28 active
- Daily agent runs: ~200+
- Tool registry: 573 known tools');

-- ============================================================
-- STEP 1J: INFRASTRUCTURE
-- ============================================================

INSERT INTO company_knowledge_base (section, audience, content) VALUES
('infrastructure', 'all', E'# Infrastructure

- Cloud: GCP (Cloud Run, Cloud SQL PostgreSQL, Cloud Scheduler, Cloud Tasks, Memorystore Redis, Secret Manager, Artifact Registry, Cloud Storage)
- Database: Cloud SQL PostgreSQL with pgvector (86 tables)
- Identity: Microsoft Entra ID (agent identities + user accounts, Agent 365 Tier 3 licenses)
- Communication: Microsoft Teams (9 channels, agent bots, Bot Framework)
- Email: Microsoft 365 shared mailboxes via MCP email server
- MCP Servers: 10 internal Glyphor MCP servers (~87 tools) + 9 Microsoft Agent 365 MCP servers
- CI/CD: GitHub Actions → Docker → Artifact Registry → Cloud Run
- Voice: OpenAI Realtime API gateway (WebRTC + Teams ACS bridge)
- Knowledge Graph: Microsoft GraphRAG + Gemini extraction
- Search: OpenAI Responses API web_search_preview');

-- ============================================================
-- STEP 1K: PRICING
-- ============================================================

INSERT INTO company_knowledge_base (section, audience, content) VALUES
('pricing', 'all', E'# Pricing Strategy

AI Marketing Department: $500-750/month flat rate (under validation).

Principles: simple, predictable, no usage-based pricing, no credit systems, no unnecessary tiering. Must be validated based on unit economics, compute cost, agent workload, margin targets, and customer behavior.

Do not quote final pricing externally. Say "starting at $500/month" if pressed, with caveat that pricing is being finalized.');

-- ============================================================
-- STEP 1L: COMPETITIVE LANDSCAPE
-- ============================================================

INSERT INTO company_knowledge_base (section, audience, content) VALUES
('competitive_landscape', 'all', E'# Competitive Landscape (March 2026)

No single competitor combines multi-agent organizational hierarchy, cross-model consensus verification, tiered governance, and persistent agent identity into a single production system.

Key competitors: Sierra AI ($10B, customer service), Devin ($10.2B, coding), Ema (closest architectural competitor), Lindy AI (no-code agents), Viktor by Zeta Labs (Slack-native, single-agent), 11x.ai (AI SDRs, credibility issues), Artisan AI (AI BDR), CrewAI (open-source framework), Salesforce Agentforce (12K customers).

Full competitive analysis in progress under Directive 5. This section will be updated with findings.');

-- ============================================================
-- STEP 1M: CULTURE
-- ============================================================

INSERT INTO company_knowledge_base (section, audience, content) VALUES
('culture', 'all', E'# Communication & Culture

## Voice Rules
- Present tense, active voice. Specific over vague. Numbers over adjectives.
- Banned words: utilize, leverage, innovative, cutting-edge, revolutionary, game-changing, synergy, empower, unlock, drive (as buzzword)
- No exclamation marks in external content. No hedging. No AI self-reference.

## Internal Communication
- Be direct. If you don''t know, say so. If you''re blocked, flag immediately via flag_assignment_blocker.
- Quality over speed. An 85-quality deliverable beats a fast 60-quality one.

## Founder Time Is Scarce
5-10 hours/week. Every YELLOW/RED decision must include enough context to decide in 30 seconds: what you want to do, why, what happens if approved, what happens if rejected.');
```

---

## Step 2: Insert Founder Directives

**Who:** Marcus (CTO) or Jordan (DevOps) — direct DB execution
**Time:** 10 minutes
**Prerequisite:** Step 1 complete

Sarah detects new directives within 10 minutes via heartbeat.

```sql
-- ============================================================
-- Directive 4 — Platform Health (FIRST — blocks everything)
-- ============================================================

INSERT INTO founder_directives (
  title, description, priority, status, source, created_by,
  assigned_to, deadline
) VALUES (
  'Dashboard & Platform Health Stabilization',
  E'CRITICAL: Fix CTO death loop, activate history compression, clear blocked assignments, reduce abort rate below 10%.\n\nAssignments for Sarah to decompose:\n1. Marcus (CTO): Diagnose and fix CTO death loop. Query agent_runs for cto failures in last 3 days. Likely cause: MCP engineering server timeout during tool init. Fix: timeout guard with fallback to core tools if MCP init hangs > 15 seconds.\n2. Alex (Platform Eng): Verify history compression is active in baseAgentRunner.ts — compressHistory() must fire before every model call. Add temporary logging to confirm compression and token reduction.\n3. Jordan (DevOps): Clean up blocked assignments older than 48 hours. Deploy stale assignment timeout escalation in workLoop.ts.\n4. Sam (Quality Eng): After compression is live, run full diagnostic suite. Report before/after: abort_pct, avg_late_turn_input, stuck runs count.\n5. Atlas (Ops): Monitor agent health for 48 hours post-fix. Flag any agent with abort rate > 15% or 0 completed runs in 4 hours.\n\nSuccess: CTO completing runs. Late-turn tokens < 100K. Blocked assignments < 10. Abort rate < 10% within 48 hours.',
  'critical', 'active', 'founder', 'kristina',
  'chief-of-staff', NOW() + INTERVAL '5 days'
);

-- ============================================================
-- Directive 1 — Brand Voice (second priority)
-- ============================================================

INSERT INTO founder_directives (
  title, description, priority, status, source, created_by,
  assigned_to, deadline
) VALUES (
  'Establish Brand Voice & Identity System',
  E'CRITICAL: Brand Guide is now source of truth for all branding, voice, tone, messaging, and visual identity.\n\nAssignments for Sarah to decompose:\n1. Maya (CMO): Review Brand Guide sections 01-04. Produce 1-page Brand Voice Quick Reference Card — banned words, tone-by-context table, 3 before/after copy examples.\n2. Mia (VP Design): Review sections 05-07 and 09-12. Audit dashboard accessibility. Produce Brand Compliance Checklist.\n3. Tyler (Content): Take "Still You" campaign copy from section 08 and produce: LinkedIn (6 posts), X/Twitter (6 tweets), blog post "Everyone else built a copilot. We built a company."\n4. Sofia (Design Critic): Run compliance checklist against glyphor.ai, dashboard, and Prism v5.6 components.\n5. Leo (UI/UX): Design 6 social media cards for "Still You" — Prism Midnight, Agency font, Hyper Cyan. Square + landscape formats.\n\nSuccess: Brand Guide referenced in all content/design briefs. Compliance Checklist run against live assets. Campaign assets ready.',
  'critical', 'active', 'founder', 'kristina',
  'chief-of-staff', NOW() + INTERVAL '7 days'
);

-- ============================================================
-- Directive 5 — Competitive Research (parallel with Directive 1)
-- ============================================================

INSERT INTO founder_directives (
  title, description, priority, status, source, created_by,
  assigned_to, deadline
) VALUES (
  'Competitive Landscape Research',
  E'HIGH: Comprehensive competitive analysis of every company building autonomous AI agents or AI workforce platforms.\n\nAssignments for Sarah to decompose:\n1. Sophia (VP Research): Orchestrate multi-wave research. Final deliverable: executive-ready report — competitive map, top 10 profiles, gap analysis, threat assessment, positioning recommendations.\n2. Lena (Competitive Research): Deep-dive profiles on direct competitors. What they claim vs what is shipped, funding, team, architecture, pricing, customers. Use web_search extensively.\n3. Daniel Okafor (Market Research): Size market segments. TAM for autonomous AI workforce. Analyst categorizations. Keywords enterprise buyers use.\n4. Daniel Ortiz (Competitive Intel): Set up ongoing monitoring — funding rounds, launches, hires, customer wins for top 10 competitors. Weekly cadence.\n5. Priya (User Research): Research how target customers (SMB marketing leaders) currently evaluate and buy AI solutions. What channels, what criteria, what objections.\n\nNote: Technical architecture analysis and industry trends analysis should be covered by Sophia + Lena + Daniel Okafor splitting the work across their research waves. The research team is lean (3 analysts) so Sophia should coordinate wave assignments to cover all angles.\n\nSuccess: Executive-ready report delivered. Competitive monitoring established weekly.',
  'high', 'active', 'founder', 'kristina',
  'chief-of-staff', NOW() + INTERVAL '10 days'
);

-- ============================================================
-- Directive 3 — Slack Landing Page (depends on Directive 1)
-- ============================================================

INSERT INTO founder_directives (
  title, description, priority, status, source, created_by,
  assigned_to, deadline
) VALUES (
  'Slack AI Marketing Department Landing Page',
  E'HIGH: Build landing page for Glyphor''s Slack-integrated AI Marketing Department.\n\nPage structure:\n- Hero: "Your AI marketing department lives in Slack." CTA: "Get started."\n- How it works: 3 steps (Connect Slack → Set strategy → Team ships)\n- Meet the team: AI marketing agents with names, titles, avatars\n- Capabilities grid with specific output examples\n- Pricing tiers\n- FAQ: top 5 objections\n\nAssignments for Sarah to decompose:\n1. Mia (VP Design): Own page design. Prism Midnight + Prism Solar contrast.\n2. Ava (Frontend): Implement in React. Prism system, spectral mesh hero, staggered animations, mobile-responsive.\n3. Ryan (Template Architect): Prism component conformance. Run Brand Compliance Checklist.\n4. Maya (CMO): Write all page copy following Brand Guide voice.\n5. Tyler (Content): Write FAQ answers. Confident, direct, no hedging.\n\nDepends on: Directive 1 (brand assets).\nSuccess: Page live. Lighthouse > 90 perf, 100 accessibility. Clear value prop with working CTA.',
  'high', 'active', 'founder', 'kristina',
  'chief-of-staff', NOW() + INTERVAL '10 days'
);

-- ============================================================
-- Directive 2 — Campaign Launch (depends on Directives 1 + 3)
-- ============================================================

INSERT INTO founder_directives (
  title, description, priority, status, source, created_by,
  assigned_to, deadline
) VALUES (
  '"Still You" Marketing Campaign Launch',
  E'HIGH: Launch "Still You" campaign across social channels. Dry, sarcastic, instantly recognizable.\n\nAssignments for Sarah to decompose:\n1. Maya (CMO): Own rollout plan. Cadence: all 6 at once or stagger over 2 weeks? Content calendar. Build to crescendo.\n2. Kai (Social Media): Schedule and publish campaign assets. Monitor engagement. Engage with copilot frustration stories. Tone: dry, never defensive.\n3. Lisa (SEO): Target keywords for campaign blog post — "copilot limitations," "copilot vs autonomous AI," "AI that does the work."\n4. Tyler (Content): Blog post plus 3 follow-ups: "Copilot Fatigue" thought leadership, "What autonomous AI actually means" explainer, "How 30 agents run a company" technical narrative.\n5. Leo (UI/UX): Campaign mini-site at glyphor.ai/stillyou. 6 ads scrollable. Prism Midnight. CTA to product page.\n\nDepends on: Directive 1 (brand assets) and Directive 3 (landing page).\nSuccess: All 6 ads published. Blog live. Landing page live. Engagement tracked daily for 2 weeks.',
  'high', 'active', 'founder', 'kristina',
  'chief-of-staff', NOW() + INTERVAL '14 days'
);
```

---

## Step 3: Fix Department Context Mapping

**Who:** Marcus (CTO) or Alex (Platform Eng) — code change
**Time:** 10 minutes
**Prerequisite:** Step 4 (context files must exist first)

Several surviving agents get no department context. Find the department resolution logic in `companyAgentRunner.ts` and add or fix these mappings:

```typescript
// Agents that currently get NO department context — add mappings:
'cpo': 'product',
'vp-research': 'research',
'competitive-research-analyst': 'research',
'market-research-analyst': 'research',
'user-researcher': 'product',
'competitive-intel': 'product',
'm365-admin': 'engineering',
'bob-the-tax-pro': 'legal',
'marketing-intelligence-analyst': 'marketing',
```

---

## Step 4: Create Missing + Update All Department Context Files

**Who:** Marcus deploys, or Sarah dispatches to executives for their own departments
**Time:** 30 minutes

### 4A: Create `packages/company-knowledge/context/research.md`

```markdown
# Research & Intelligence Department

## Team
VP: Sophia Lin. Analysts: Lena Park (Competitive Research), Daniel Okafor (Market Research).

This is a lean team — 3 people covering all research. Sophia orchestrates multi-wave research flows and QCs all output. Analysts execute in parallel with web search, then Sophia synthesizes.

## Active Work
- Competitive landscape analysis in progress (Directive 5)
- 15 research areas under monitoring
- Research packet workflow: Sarah requests → Sophia decomposes → analysts execute → Sophia QCs → executive brief delivered

## Tools
- Web search (OpenAI Responses API)
- 15 research packet schemas (CompetitorProfiles, MarketData, TechnicalLandscape, IndustryTrends, etc.)
- Research repository with text search
- 14 monitoring tools (academic papers, OSS tracking, regulatory, AI benchmarks)

## Quality Standards
- Every claim must cite a source
- Confidence levels required on all assessments (high/medium/low)
- Sophia QCs all output before it reaches executives

## When You Have No Assigned Work
- Sophia: Check if any research monitor has new results. Review knowledge graph for stale research nodes.
- Lena: Check for competitor news — new funding, product launches, hiring. Update competitive_intel table.
- Daniel Okafor: Check market analyst reports for AI workforce category. Track new market sizing data.
```

### 4B: Create `packages/company-knowledge/context/legal.md`

```markdown
# Legal & Compliance Department

## Team
CLO: Victoria Chase (reports directly to both founders). Specialist: Bob Finley (Tax Strategist).

## Active Scope
- AI regulation monitoring (EU AI Act, FTC guidelines for autonomous agents)
- Data privacy (GDPR, CCPA, SOC 2 readiness for customer-facing product)
- Commercial agreements for AI Marketing Department customers
- Corporate governance for 3-tier authority model
- Tax strategy and compliance

## Current Priorities
- SOC 2 readiness assessment (customer-facing product requires trust)
- Draft standard customer agreement template for AI Marketing Department
- Monitor EU AI Act implications for autonomous agent deployment

## Tools
19 tools via mcp-legal-server (compliance, contracts, IP, tax — 12 reads + 7 writes)

## When You Have No Assigned Work
- Victoria: Weekly compliance scan against regulatory monitoring list. Flag anything affecting AI Marketing Department.
- Bob: Monthly tax planning review. Ensure startup tax obligations are tracked.
```

### 4C: Update `packages/company-knowledge/context/marketing.md`

```markdown
# Marketing Department

## Team
CMO: Maya Brooks. Sub-team: Tyler Reed (Content), Lisa Chen (SEO), Kai Johnson (Social Media). Specialist: Zara Petrov (Marketing Intelligence).

## Active Campaign: "Still You"
6-ad campaign targeting VP Marketing at mid-market SaaS. Theme: copilot fatigue. Prism Midnight visual treatment. Depends on Brand Guide being established first.

## Brand Guide
Source of truth for all external content. Key rules: present tense, active voice, specific over vague. Banned words list. No exclamation marks. No hedging.

## Product Positioning
We sell an AI marketing department, not a tool. Lives in Slack. Key message: "Your AI marketing department lives in Slack."

## Content Cadence Target
- 3 LinkedIn posts/week (1 thought leadership, 1 product, 1 industry insight)
- 1 blog post/month
- Daily social engagement monitoring

## SEO Focus Keywords
copilot limitations, autonomous AI, AI that does the work, AI marketing team, AI marketing department

## When You Have No Assigned Work
- Tyler: Draft next week's LinkedIn posts following brand voice
- Lisa: Pull Search Console data, flag keyword drops > 5 positions
- Kai: Monitor social engagement, engage with copilot frustration stories
- Zara: Check competitor marketing activity — campaigns, messaging changes, content strategy shifts
```

### 4D: Update `packages/company-knowledge/context/sales-cs.md`

```markdown
# Sales Department

## Team
VP Sales: Rachel Kim (solo executive — no sub-team researchers currently).

## Product Being Sold
AI Marketing Department via Slack. $500-750/month flat rate (under validation).

## ICP (Ideal Customer Profile)
- Company size: 5-50 employees, founder-led
- Pain: Needs consistent marketing output, can't justify full-time hire or agency
- Tech: Uses Slack (required)
- Budget: $500-750/month
- NOT: Enterprise, regulated, complex procurement, Teams-only

## Current Customers
0 active. $0 MRR. Churn risk not applicable until paying customers are onboarded.

## Sales Motion
Rachel manages the full pipeline solo. Prospect identification, outreach, demos, closing. Demo narrative: Slack integration → same-day output → agent team with names.

## When You Have No Assigned Work
- Rachel: Research 3-5 new prospects matching ICP per week. Review pipeline. Update positioning based on latest competitive research.
```

### 4E: Update `packages/company-knowledge/context/finance.md`

```markdown
# Finance Department

## Team
CFO: Nadia Okafor (solo — no sub-team analysts currently).

## Key Metrics (use tools for live data)
- MRR: $0 (pre-revenue)
- Monthly compute budget: $150
- Default model: gpt-5-mini ($0.25/$2.00 per 1M tokens)

## Data Sources
- Stripe: MRR, churn, subscriptions (daily sync midnight CT)
- Mercury: Cash balance, flows, vendor subs (daily sync 2 AM CT)
- GCP BigQuery: Compute billing (daily sync 1 AM CT)
- OpenAI/Anthropic/Kling: AI billing (daily sync 3 AM CT)

## Cost Monitoring
Per-agent budget caps enforced. Nadia runs daily cost analysis (9 AM CT) and afternoon anomaly catch (3 PM CT).

## When You Have No Assigned Work
- Check if any billing sync is stale (> 24h)
- Compare today's compute trajectory against $150/month budget
- Review agent cost efficiency — flag any agent whose daily cap is > 80% utilized
- If revenue status changed, investigate why
```

### 4F: Apply same update pattern to remaining files

Update `context/engineering.md`, `context/product.md`, `context/design.md`, and `context/operations.md` with:
- Actual current team (only surviving agents)
- Current priorities (tied to March 2026 directives)
- Available tools
- "When you have no assigned work" section with specific activities

---

## Step 5: Add Standing Orders

**Who:** Marcus (CTO) or Jordan (DevOps) — DB insert
**Time:** 5 minutes
**Prerequisite:** Step 1 complete

```sql
INSERT INTO company_knowledge_base (section, audience, content) VALUES
('standing_orders', 'all', E'# Standing Orders — Recurring Work

Pre-approved recurring work. Sarah auto-generates directives from these without needing individual founder approval.

## Weekly
- **Marketing:** 3 LinkedIn posts (Tyler drafts, Maya reviews, Kai schedules). 1 thought leadership, 1 product, 1 industry insight.
- **Research:** Sophia runs one competitive monitoring sweep. Lena and Daniel Okafor split research waves across the 15 monitored areas.
- **Sales:** Rachel researches 3-5 new prospects matching ICP.
- **Engineering:** Marcus reviews platform health. Alex checks dependency updates. Jordan verifies CI/CD integrity.
- **Legal:** Victoria scans regulatory monitoring list.
- **Finance:** Nadia produces weekly cost breakdown by provider and agent role.

## Daily
- **Finance:** Nadia flags any day where compute exceeds $6 or revenue status changes.
- **SEO:** Lisa pulls Search Console data, flags keyword drops > 5 positions.
- **Social:** Kai monitors engagement, engages with relevant conversations.
- **Operations:** Atlas runs health checks (10-min cron already active).

## Monthly
- **Finance:** Nadia produces unit economics estimate for AI Marketing Department.
- **Legal:** Victoria and Bob review compliance and tax obligations.
- **Research:** Sophia produces monthly industry trends summary.

Sarah reads these during her orchestration sweeps and creates directives + assignments to execute them.');
```

---

## Step 6: Clean Up Orphaned Briefs

**Who:** Marcus (CTO) or Jordan (DevOps) — git cleanup
**Time:** 5 minutes
**Prerequisite:** None

Delete the 14 orphaned brief files for deleted agents:

```bash
cd packages/company-knowledge/briefs/
rm anna-park.md omar-hassan.md david-santos.md emma-wright.md \
   derek-owens.md ethan-morse.md nathan-cole.md grace-hwang.md \
   amara-diallo.md kai-nakamura.md mariana-solis.md james-turner.md \
   riya-mehta.md marcus-chen.md

git add -A
git commit -m "chore: remove 14 orphaned brief files for deleted agents"
```

Also check the `agent_briefs` DB table and `company_agents` table for rows referencing deleted roles. Clean those too:

```sql
-- Check for orphaned DB records
SELECT agent_role FROM company_agents
WHERE agent_role NOT IN (
  'chief-of-staff','cto','cfo','cpo','cmo','vp-sales','vp-design','clo',
  'vp-research','competitive-research-analyst','market-research-analyst',
  'platform-engineer','quality-engineer','devops-engineer','m365-admin',
  'user-researcher','competitive-intel','content-creator','seo-analyst',
  'social-media-manager','ui-ux-designer','frontend-engineer','design-critic',
  'template-architect','head-of-hr','ops','global-admin',
  'bob-the-tax-pro','marketing-intelligence-analyst','adi-rose'
);
-- Review results before deleting — may include retired temporary agents too
```

---

## Step 7: Verify and Deploy

**Who:** Marcus + Atlas
**Time:** 15 minutes after deploy

```sql
-- Verify knowledge base
SELECT section, audience, LENGTH(content) as chars
FROM company_knowledge_base ORDER BY section;
-- Should show 14 sections (mission, operating_doctrine, current_priorities,
-- products, founders, team_structure, authority_model, metrics,
-- infrastructure, pricing, competitive_landscape, culture, standing_orders)

-- Verify directives
SELECT title, priority, status, deadline,
  (SELECT COUNT(*) FROM work_assignments wa WHERE wa.directive_id = fd.id) as assignments
FROM founder_directives fd WHERE status = 'active'
ORDER BY deadline;
-- Should show 5 directives, 0 assignments initially
```

Deploy code changes:
```bash
git add -A
git commit -m "fix: department context mappings, new research/legal context, updated all context files, remove orphaned briefs"
git push origin main
```

Monitor Sarah's first heartbeat pass. Within 10-30 minutes she should detect the 5 directives and begin decomposing Directive 4 (Platform Health) first.

---

## Summary

| Step | What | Who | Time |
|------|------|-----|------|
| 1 | Replace stale knowledge base (14 sections) | Marcus/Jordan (SQL) | 15 min |
| 2 | Insert 5 founder directives | Marcus/Jordan (SQL) | 10 min |
| 3 | Fix department context mapping for 9 unmapped agents | Marcus/Alex (code) | 10 min |
| 4 | Create research.md + legal.md, update 5 context files | Marcus/executives | 30 min |
| 5 | Add standing orders | Marcus/Jordan (SQL) | 5 min |
| 6 | Delete 14 orphaned brief files + clean DB | Marcus/Jordan | 5 min |
| 7 | Verify + deploy + monitor Sarah's first pass | Marcus/Atlas | 15 min |

**Total: ~90 minutes.** After this, 30 agents know the real company strategy, have 5 active directives to execute, and have standing orders that generate recurring work without founder intervention.

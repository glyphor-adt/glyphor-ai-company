# Glyphor AI Company — System Architecture

> Last updated: 2026-02-22

## Overview

Glyphor AI Company is a monorepo containing 8 AI executive agents, 17 sub-team members, and
1 operations agent that autonomously operate Glyphor alongside two human founders (Kristina
Denney, CEO; Andrew Denney, COO). The agents run 24/7 on GCP Cloud Run, share state through
Supabase, communicate with founders via Microsoft Teams, and are governed by a three-tier
authority model (Green / Yellow / Red).

Total headcount: **28** — 2 human founders, 8 AI executives, 17 AI team members, 1 AI ops agent.

The founders work full-time at Microsoft with 5-10 h/week for Glyphor. The AI executive team
handles everything else: daily operations, financial monitoring, content creation, product
analysis, customer success, enterprise sales research, design & frontend quality,
cross-functional synthesis, inter-agent communication, and strategic analysis.

---

## High-Level Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                      GCP Cloud Scheduler                             │
│  9 agent cron jobs → Pub/Sub topic "glyphor-agent-events"            │
│  3 data sync jobs  → HTTP POST to scheduler endpoints                │
│  + Dynamic Scheduler (DB-defined cron from agent_schedules table)    │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ Pub/Sub push + HTTP
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│             Scheduler Service (Cloud Run: glyphor-scheduler)         │
│                                                                      │
│  POST /pubsub            ── Cloud Scheduler cron messages            │
│  POST /run               ── Dashboard chat & manual invocations      │
│  POST /event             ── Glyphor Event Bus (inter-agent events)   │
│  POST /webhook/stripe    ── Stripe webhook receiver                  │
│  POST /sync/stripe       ── Stripe data sync                        │
│  POST /sync/gcp-billing  ── GCP billing export sync                 │
│  POST /sync/mercury      ── Mercury banking sync                    │
│  POST /agents/create     ── Create new dynamic agent                │
│  PUT  /agents/:id/settings── Update agent configuration             │
│  POST /agents/:id/pause  ── Pause agent                             │
│  POST /agents/:id/resume ── Resume agent                            │
│  DELETE /agents/:id      ── Retire (soft-delete) agent              │
│  POST /analysis/run      ── Launch strategic analysis               │
│  GET  /analysis/:id      ── Get analysis status/result              │
│  GET  /analysis          ── List all analyses                       │
│  GET  /analysis/:id/export── Export analysis report (md/json)       │
│  POST /simulation/run    ── Launch T+1 simulation                   │
│  GET  /simulation/:id    ── Get simulation status/result            │
│  GET  /simulation        ── List all simulations                    │
│  POST /simulation/:id/accept ── Accept simulation result            │
│  GET  /simulation/:id/export ── Export simulation report (md/json)  │
│  POST /meetings/call     ── Convene multi-agent meeting             │
│  GET  /meetings/:id      ── Get meeting status/transcript           │
│  GET  /meetings          ── List all meetings                       │
│  POST /messages/send     ── Send inter-agent message                │
│  GET  /messages/agent/:id── Get messages for an agent               │
│  GET  /messages          ── Get all recent messages                 │
│  GET  /health            ── Health check                             │
│  OPTIONS /*              ── CORS preflight                           │
│                                                                      │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐   │
│  │ Cron Manager │  │ Event Router  │  │    Authority Gates       │   │
│  │ (9+3 static  │  │ route()       │  │ checkAuthority(role,act) │   │
│  │  + dynamic)  │  │ handlePubSub()│  │ GREEN per-role           │   │
│  └──────────────┘  │ handleAgent() │  │ YELLOW → one founder     │   │
│  ┌──────────────┐  │ handleEvent() │  │ RED    → both founders   │   │
│  │ Analysis     │  └───────┬───────┘  └────────────┬─────────────┘   │
│  │ Engine       │          │                       │                 │
│  ├──────────────┤          ▼                       ▼                 │
│  │ Simulation   │ ┌────────────────┐    ┌─────────────────────┐      │
│  │ Engine       │ │ Agent Executor │    │  Decision Queue     │      │
│  ├──────────────┤ │ (role→runner)  │    │  submit / approve   │      │
│  │ Meeting      │ └────────┬───────┘    │  reminders (4 h)    │      │
│  │ Engine       │          │            └─────────┬───────────┘      │
│  └──────────────┘          │                      │                 │
└────────────────────────────┼──────────────────────┼──────────────────┘
                             │                      │
                ┌────────────┘                      │ Graph API / Webhook
                ▼                                   ▼
┌───────────────────────────────────┐  ┌──────────────────────────────┐
│        Agent Runtime              │  │     Microsoft Teams          │
│  ┌─────────────────────────────┐  │  │                              │
│  │   CompanyAgentRunner        │  │  │  9 channels in Glyphor team: │
│  │   ┌───────────────────────┐ │  │  │  #kristina-briefings        │
│  │   │ buildSystemPrompt()   │ │  │  │  #andrew-briefings          │
│  │   │  Knowledge Base .md   │ │  │  │  #decisions                 │
│  │   │  + Role Brief .md     │ │  │  │  #engineering               │
│  │   │  + Personality Block  │ │  │  │  #growth                    │
│  │   │  + Agent systemPrompt │ │  │  │  #financials                │
│  │   └───────────────────────┘ │  │  │  #glyphor-general           │
│  │   ├─ ModelClient            │  │  │  #product-fuse              │
│  │   │  (Gemini/OpenAI/Claude) │  │  │  #product-pulse             │
│  │   ├─ AgentSupervisor        │  │  │                              │
│  │   ├─ ToolExecutor           │  │  │  Adaptive Cards:            │
│  │   ├─ EventBus               │  │  │  ├ Briefing card            │
│  │   ├─ GlyphorEventBus       │  │  │  ├ Decision card             │
│  │   ├─ PendingMessageLoader  │  │  │  └ Alert card                │
│  │   └─ AgentProfileLoader    │  │  │                              │
│  └─────────────────────────────┘  │  └──────────────────────────────┘
│                                   │
│  Shared agent tools:              │
│   ├─ memoryTools (save/recall)    │
│   ├─ eventTools (emit events)     │
│   └─ communicationTools           │
│      (send_message, check_msgs,   │
│       call_meeting)               │
└───────────────┬───────────────────┘
                │
                ▼
┌───────────────────────────────────┐  ┌──────────────────────────────┐
│        Company Memory             │  │   External Integrations      │
│  ┌─────────────────────────────┐  │  │                              │
│  │ Supabase (PostgreSQL)       │  │  │  Stripe  — MRR, churn, subs │
│  │  ├ company_profile          │  │  │  Mercury — banking, cash     │
│  │  ├ products                 │  │  │  GCP     — billing export    │
│  │  ├ company_agents           │  │  │                              │
│  │  ├ decisions                │  │  └──────────────────────────────┘
│  │  ├ activity_log             │  │
│  │  ├ competitive_intel        │  │
│  │  ├ customer_health          │  │
│  │  ├ financials               │  │
│  │  ├ product_proposals        │  │
│  │  ├ autonomous_ops_events    │  │
│  │  ├ agent_memory             │  │
│  │  ├ agent_reflections        │  │
│  │  ├ metrics_cache            │  │
│  │  ├ agent_profiles           │  │         ┌─────────────────────┐
│  │  ├ agent_briefs             │  │         │ Inter-Agent Comms   │
│  │  ├ agent_schedules          │  │         │                     │
│  │  ├ agent_messages           │  ├────────►│ DMs + Meetings      │
│  │  ├ agent_meetings           │  │         │ Rate limited:       │
│  │  ├ analyses                 │  │         │  5 DMs/hr/agent     │
│  │  └ simulations              │  │         │  2 meetings/day     │
│  ├─────────────────────────────┤  │         │  10 meetings/day    │
│  │ GCS (large documents)       │  │         └─────────────────────┘
│  │  ├ briefings/{founder}/     │  │
│  │  ├ reports/{type}/          │  │
│  │  └ specs/{type}/            │  │
│  └─────────────────────────────┘  │
└───────────────────────────────────┘

┌──────────────────────────────────────────┐
│   Dashboard (Cloud Run: glyphor-dashboard)│
│   Vite + React 19 + TypeScript + Tailwind │
│   nginx serving static build              │
│                                           │
│   Pages:                                  │
│   ├ Dashboard.tsx    (agent overview)     │
│   ├ Chat.tsx         (talk to agents)    │
│   ├ Workforce.tsx    (org chart + roster)│
│   ├ AgentsList.tsx   (agent roster)      │
│   ├ AgentProfile.tsx (identity, perf,    │
│   │                   memory, messages,  │
│   │                   settings)          │
│   ├ AgentBuilder.tsx (create new agents) │
│   ├ Approvals.tsx    (decision queue)    │
│   ├ Financials.tsx   (revenue & costs)   │
│   ├ Operations.tsx   (system operations) │
│   ├ Strategy.tsx     (analysis & sims)   │
│   └ Meetings.tsx     (meetings & DMs)    │
│                                           │
│   Auth: Google Sign-In (OAuth 2.0)        │
│   API: Supabase direct + Scheduler /run   │
└──────────────────────────────────────────┘
```

---

## Agent Roster

### AI Executives (8)

All 8 executives have full agent runners (`run.ts`, `systemPrompt.ts`, `tools.ts`) and are
active 24/7 via the scheduler service.

| Name | Role | Agent ID | Model | Responsibilities |
|------|------|----------|-------|-----------------|
| **Sarah Chen** | Chief of Staff | `chief-of-staff` | `gemini-3-flash-preview` | Morning briefings, decision routing, cross-agent synthesis, escalation tracking, EOD summaries |
| **Marcus Reeves** | CTO | `cto` | `gemini-3-flash-preview` | Platform health, deployment management, model fallbacks, incident response, dependency review |
| **Nadia Okafor** | CFO | `cfo` | `gemini-3-flash-preview` | Daily cost monitoring, revenue tracking, margin analysis, unit economics, budget alerts |
| **Elena Vasquez** | CPO | `cpo` | `gemini-3-flash-preview` | Usage analysis, competitive intelligence, roadmap management, feature prioritisation (RICE) |
| **Maya Brooks** | CMO | `cmo` | `gemini-3-flash-preview` | Content generation, social media, SEO strategy, brand positioning, growth analytics |
| **James Turner** | VP Customer Success | `vp-customer-success` | `gemini-3-flash-preview` | Health scoring, churn prevention, nurture outreach, cross-product recommendations |
| **Rachel Kim** | VP Sales | `vp-sales` | `gemini-3-flash-preview` | KYC research, ROI calculators, enterprise proposals, pipeline management, market sizing |
| **Mia Tanaka** | VP Design & Frontend | `vp-design` | `gemini-3-flash-preview` | Design system governance, component quality audits, template variety, AI-smell detection |

### Sub-Team Members (17)

Sub-team members have role briefs and dashboard entries but do not have independent agent runners.
They operate under their executive's authority scope.

| Name | Title | Department | Reports To |
|------|-------|------------|------------|
| **Alex Park** | Platform Engineer | Engineering | Marcus Reeves (CTO) |
| **Sam DeLuca** | Quality Engineer | Engineering | Marcus Reeves (CTO) |
| **Jordan Hayes** | DevOps Engineer | Engineering | Marcus Reeves (CTO) |
| **Priya Sharma** | User Researcher | Product | Elena Vasquez (CPO) |
| **Daniel Ortiz** | Competitive Intel | Product | Elena Vasquez (CPO) |
| **Anna Park** | Revenue Analyst | Finance | Nadia Okafor (CFO) |
| **Omar Hassan** | Cost Analyst | Finance | Nadia Okafor (CFO) |
| **Tyler Reed** | Content Creator | Marketing | Maya Brooks (CMO) |
| **Lisa Chen** | SEO Analyst | Marketing | Maya Brooks (CMO) |
| **Kai Johnson** | Social Media Manager | Marketing | Maya Brooks (CMO) |
| **Emma Wright** | Onboarding Specialist | Customer Success | James Turner (VP CS) |
| **David Santos** | Support Triage | Customer Success | James Turner (VP CS) |
| **Nathan Cole** | Account Research | Sales | Rachel Kim (VP Sales) |
| **Leo Vargas** | UI/UX Designer | Design & Frontend | Mia Tanaka (VP Design) |
| **Ava Chen** | Frontend Engineer | Design & Frontend | Mia Tanaka (VP Design) |
| **Sofia Marchetti** | Design Critic | Design & Frontend | Mia Tanaka (VP Design) |
| **Ryan Park** | Template Architect | Design & Frontend | Mia Tanaka (VP Design) |

### Operations Agent (1)

| Name | Role | Agent ID | Model | Responsibilities |
|------|------|----------|-------|-----------------|
| **Atlas Vega** | Operations & System Intelligence | `ops` | `gemini-3-flash-preview` | System health checks, data freshness monitoring, cost awareness, morning/evening status reports, event response |

### Org Chart

```
             Kristina Denney (CEO)     Andrew Denney (COO)
                         \               /
                          \             /
                        Sarah Chen (CoS)
                              |
        ┌─────────┬──────────┼──────────┬──────────┬──────────┬──────────┐
        │         │          │          │          │          │          │
     Marcus    Elena      Nadia      Maya      James     Rachel      Mia
     (CTO)     (CPO)      (CFO)      (CMO)     (VP CS)   (VP Sales)  (VP Design)
       │         │          │          │          │          │          │
   Alex Park  Priya S.  Anna Park  Tyler Reed  Emma W.  Nathan C.  Leo Vargas
   Sam DeLuca Daniel O.  Omar H.   Lisa Chen   David S.             Ava Chen
   Jordan H.                        Kai J.                           Sofia M.
                                                                     Ryan Park
```

### Cron Schedules (GCP Cloud Scheduler)

#### Agent Task Jobs (9 jobs, via Pub/Sub)

All 9 jobs are **enabled** and run **daily** (every day of the week).

| Job ID | Agent | Cron (UTC) | Local (CT) | Task |
|--------|-------|-----------|------------|------|
| `cos-briefing-kristina` | Sarah Chen | `0 12 * * *` | 7:00 AM | Morning briefing for Kristina |
| `cos-briefing-andrew` | Sarah Chen | `30 12 * * *` | 7:30 AM | Morning briefing for Andrew |
| `cos-eod-summary` | Sarah Chen | `0 23 * * *` | 6:00 PM | End-of-day summary |
| `cto-health-check` | Marcus Reeves | `*/30 * * * *` | Every 30 min | Platform health check |
| `cfo-daily-costs` | Nadia Okafor | `0 14 * * *` | 9:00 AM | Daily cost analysis |
| `cpo-usage-analysis` | Elena Vasquez | `0 15 * * *` | 10:00 AM | Usage & competitive analysis |
| `cmo-content-calendar` | Maya Brooks | `0 14 * * *` | 9:00 AM | Content planning |
| `vpcs-health-scoring` | James Turner | `0 13 * * *` | 8:00 AM | Customer health scoring |
| `vps-pipeline-review` | Rachel Kim | `0 14 * * *` | 9:00 AM | Enterprise pipeline review |

#### Data Sync Jobs (3 jobs, via HTTP)

| Job ID | Cron (UTC) | Local (CT) | Endpoint | Source |
|--------|-----------|------------|----------|--------|
| `sync-stripe` | `0 6 * * *` | 12:00 AM | `/sync/stripe` | Stripe (MRR, churn, subscriptions) |
| `sync-gcp-billing` | `0 7 * * *` | 1:00 AM | `/sync/gcp-billing` | GCP BigQuery billing export |
| `sync-mercury` | `0 8 * * *` | 2:00 AM | `/sync/mercury` | Mercury (cash balance, flows, vendor subs) |

---

## Monorepo Package Structure

```
glyphor-ai-company/
├── packages/
│   ├── agent-runtime/          # Core execution engine
│   │   └── src/
│   │       ├── companyAgentRunner.ts   # Agent loop + knowledge + personality injection
│   │       ├── modelClient.ts          # Multi-provider LLM (Gemini/OpenAI/Anthropic)
│   │       ├── supervisor.ts           # Turn limits, stall detection, timeouts
│   │       ├── toolExecutor.ts         # Tool declaration → execution bridge
│   │       ├── eventBus.ts             # Internal event system
│   │       ├── glyphorEventBus.ts      # Inter-agent event bus (Supabase-backed)
│   │       ├── eventPermissions.ts     # Per-tier event emission permissions
│   │       ├── subscriptions.ts        # Agent → event type subscription map
│   │       ├── reasoning.ts            # Reasoning extraction & stripping
│   │       └── types.ts               # All core types (26 agent roles, budgets, tool grants)
│   │
│   ├── company-memory/          # Persistence layer
│   │   └── src/
│   │       ├── store.ts               # CompanyMemoryStore (Supabase + GCS)
│   │       ├── namespaces.ts          # Key prefixes and GCS paths
│   │       ├── schema.ts             # Database row types
│   │       └── migrations/           # Schema migration helpers
│   │
│   ├── agents/                  # Agent implementations (8 execs + 17 sub-team + 1 ops)
│   │   └── src/
│   │       ├── chief-of-staff/        # Sarah Chen — run.ts, systemPrompt.ts, tools.ts
│   │       ├── cto/                   # Marcus Reeves
│   │       ├── cfo/                   # Nadia Okafor
│   │       ├── cpo/                   # Elena Vasquez
│   │       ├── cmo/                   # Maya Brooks
│   │       ├── vp-customer-success/   # James Turner
│   │       ├── vp-sales/              # Rachel Kim
│   │       ├── vp-design/             # Mia Tanaka
│   │       ├── platform-engineer/     # Alex Park (CTO team)
│   │       ├── quality-engineer/      # Sam DeLuca (CTO team)
│   │       ├── devops-engineer/       # Jordan Hayes (CTO team)
│   │       ├── user-researcher/       # Priya Sharma (CPO team)
│   │       ├── competitive-intel/     # Daniel Ortiz (CPO team)
│   │       ├── revenue-analyst/       # Anna Park (CFO team)
│   │       ├── cost-analyst/          # Omar Hassan (CFO team)
│   │       ├── content-creator/       # Tyler Reed (CMO team)
│   │       ├── seo-analyst/           # Lisa Chen (CMO team)
│   │       ├── social-media-manager/  # Kai Johnson (CMO team)
│   │       ├── onboarding-specialist/ # Emma Wright (VP CS team)
│   │       ├── support-triage/        # David Santos (VP CS team)
│   │       ├── account-research/      # Nathan Cole (VP Sales team)
│   │       ├── shared/                # Shared tools:
│   │       │   ├── memoryTools.ts        # save/recall agent memories
│   │       │   ├── eventTools.ts         # emit Glyphor events
│   │       │   └── communicationTools.ts # send_agent_message, check_messages, call_meeting
│   │       └── index.ts              # Re-exports all runners
│   │
│   ├── company-knowledge/       # Shared context (read at runtime)
│   │   ├── COMPANY_KNOWLEDGE_BASE.md  # ~400 lines: founders, products, metrics, rules
│   │   └── briefs/                    # 26 role briefs (8 execs + 17 sub-team + 1 ops)
│   │       ├── sarah-chen.md          # Chief of Staff
│   │       ├── marcus-reeves.md       # CTO
│   │       ├── nadia-okafor.md        # CFO
│   │       ├── elena-vasquez.md       # CPO
│   │       ├── maya-brooks.md         # CMO
│   │       ├── james-turner.md        # VP Customer Success
│   │       ├── rachel-kim.md          # VP Sales
│   │       ├── mia-tanaka.md          # VP Design & Frontend
│   │       ├── atlas-vega.md          # Operations & System Intelligence
│   │       ├── alex-park.md           # Platform Engineer (→ CTO)
│   │       ├── sam-deluca.md          # Quality Engineer (→ CTO)
│   │       ├── jordan-hayes.md        # DevOps Engineer (→ CTO)
│   │       ├── priya-sharma.md        # User Researcher (→ CPO)
│   │       ├── daniel-ortiz.md        # Competitive Intel (→ CPO)
│   │       ├── anna-park.md           # Revenue Analyst (→ CFO)
│   │       ├── omar-hassan.md         # Cost Analyst (→ CFO)
│   │       ├── tyler-reed.md          # Content Creator (→ CMO)
│   │       ├── lisa-chen.md           # SEO Analyst (→ CMO)
│   │       ├── kai-johnson.md         # Social Media Manager (→ CMO)
│   │       ├── emma-wright.md         # Onboarding Specialist (→ VP CS)
│   │       ├── david-santos.md        # Support Triage (→ VP CS)
│   │       ├── nathan-cole.md         # Account Research (→ VP Sales)
│   │       ├── leo-vargas.md          # UI/UX Designer (→ VP Design)
│   │       ├── ava-chen.md            # Frontend Engineer (→ VP Design)
│   │       ├── sofia-marchetti.md     # Design Critic (→ VP Design)
│   │       └── ryan-park.md           # Template Architect (→ VP Design)
│   │
│   ├── integrations/            # External service connectors
│   │   └── src/
│   │       ├── index.ts               # Re-exports all integrations
│   │       ├── teams/
│   │       │   ├── webhooks.ts        # Incoming webhook sender
│   │       │   ├── graphClient.ts     # Microsoft Graph API (MSAL)
│   │       │   └── adaptiveCards.ts   # Briefing / Decision / Alert cards
│   │       ├── stripe/
│   │       │   └── index.ts           # MRR sync, churn rate, webhook handler
│   │       ├── gcp/
│   │       │   └── index.ts           # Cloud Run metrics, BigQuery billing export
│   │       └── mercury/
│   │           └── index.ts           # Bank accounts, cash flows, vendor subscriptions
│   │
│   ├── scheduler/               # Orchestration service
│   │   └── src/
│   │       ├── server.ts              # HTTP server (Cloud Run entry, 30+ endpoints)
│   │       ├── eventRouter.ts         # Event → agent routing + authority
│   │       ├── authorityGates.ts      # Green/Yellow/Red classification (all 26 roles)
│   │       ├── cronManager.ts         # 9 agent + 3 data sync job definitions
│   │       ├── dynamicScheduler.ts    # DB-driven cron for dynamic agents
│   │       ├── decisionQueue.ts       # Human approval workflow
│   │       ├── agentLifecycle.ts      # Create/retire temporary agents
│   │       ├── analysisEngine.ts      # 5-phase strategic analysis engine
│   │       ├── simulationEngine.ts    # T+1 impact simulation engine
│   │       ├── meetingEngine.ts       # Multi-round inter-agent meetings
│   │       └── reportExporter.ts      # Analysis/simulation export (md/json)
│   │
│   └── dashboard/               # Web UI
│       ├── src/
│       │   ├── pages/
│       │   │   ├── Dashboard.tsx      # Agent overview & metrics
│       │   │   ├── Chat.tsx           # Real-time agent chat (react-markdown)
│       │   │   ├── Workforce.tsx      # Org chart + grid view (7 departments)
│       │   │   ├── AgentsList.tsx     # Agent roster & grid
│       │   │   ├── AgentProfile.tsx   # 5-tab agent profile (overview, perf,
│       │   │   │                      #   memory, messages, settings)
│       │   │   ├── AgentBuilder.tsx   # Create new dynamic agents
│       │   │   ├── AgentSettings.tsx  # Agent configuration
│       │   │   ├── Approvals.tsx      # Decision approval queue
│       │   │   ├── Financials.tsx     # Revenue, costs, vendor subscriptions
│       │   │   ├── Operations.tsx     # System operations & events
│       │   │   ├── Strategy.tsx       # Strategic analysis & T+1 simulations
│       │   │   └── Meetings.tsx       # Inter-agent meetings & messages
│       │   ├── components/            # Shared UI components
│       │   │   ├── Layout.tsx            # Sidebar nav (9 items), theme toggle
│       │   │   ├── AgentIcon.tsx         # Agent avatar component
│       │   │   ├── GrowthAreas.tsx       # Agent growth tracking
│       │   │   ├── PeerFeedback.tsx      # Agent peer feedback display
│       │   │   ├── QualityChart.tsx      # Quality score charts
│       │   │   ├── SystemHealth.tsx      # System health monitor
│       │   │   └── ui.tsx                # Shared primitives
│       │   ├── lib/                   # Hooks, Supabase client, types, utilities
│       │   │   ├── supabase.ts           # Supabase client init
│       │   │   ├── auth.tsx              # Google OAuth provider
│       │   │   ├── theme.tsx             # Dark/light theme provider
│       │   │   ├── hooks.ts              # Custom hooks
│       │   │   └── types.ts              # Dashboard-specific types
│       │   ├── App.tsx               # Router & layout (12 routes)
│       │   └── index.css             # Tailwind + Glyphor brand theme
│       └── package.json
│
├── docker/
│   ├── Dockerfile.scheduler     # node:22-slim builder → node:22-slim runtime
│   ├── Dockerfile.dashboard     # node:22-slim builder → nginx:1.27-alpine
│   ├── Dockerfile.chief-of-staff
│   └── nginx.conf               # SPA routing config
│
├── infra/
│   ├── terraform/main.tf        # GCP IaC
│   └── scripts/
│       ├── deploy.sh            # Build & deploy all services (scheduler, dashboard, CoS)
│       ├── seed-memory.sh
│       ├── open-dashboard.ps1
│       └── open-dashboard.sh
│
├── supabase/migrations/         # 16 migration files
├── turbo.json                   # Turborepo pipeline config
├── tsconfig.base.json           # Shared TS config
└── package.json                 # npm workspaces root
```

---

## Agent Runtime — Execution Engine

### CompanyAgentRunner

The core execution loop (ported from Fuse V7 `agentRunner.ts`):

```
1. BUILD SYSTEM PROMPT
   buildSystemPrompt(role, existingPrompt, dynamicBrief?, profile?)
    → Load COMPANY_KNOWLEDGE_BASE.md   (shared company context)
    → Load briefs/{name}.md            (role-specific brief)
    → Build Personality Block           (from agent_profiles table)
    → Append agent's own systemPrompt
    → Final = Knowledge Base + WHO YOU ARE block + Role Brief + Agent System Prompt
    → Anti-patterns appended (no filler phrases, no corporate jargon, etc.)

2. MEMORY RETRIEVAL
    → Load prior memories (up to 20) + reflections (up to 3)
    → Inject as context turn

3. PENDING MESSAGES
    → pendingMessageLoader checks agent_messages for unread DMs
    → Urgent messages flagged with 🔴
    → Injected as context with thread_id for replies

4. SUPERVISOR CHECK
    → Verify turnCount < maxTurns (default 10)
    → Verify stallCount < maxStallTurns (default 3)
    → Verify timeout not exceeded (default 60 s)

5. CONTEXT INJECTION (turn 2+)
    → Optional per-agent contextInjector adds dynamic context

6. MODEL CALL
    → Send systemInstruction + history to Gemini API
    → Include tool declarations for function calling
    → Handle Gemini 3 thought signatures (batch tool_call/tool_result turns)

7. TOOL DISPATCH
    → If tool calls → ToolExecutor.execute() each one
    → Push tool_call turns (with thoughtSignature), then tool_result turns
    → Loop back to step 4

8. COMPLETION
    → Model returns text with STOP finish reason → done
    → Extract reasoning envelope if present
    → Return AgentExecutionResult
```

### Knowledge Injection

Every Gemini API call receives a composite system prompt built from four layers:

| Layer | Source | Size |
|-------|--------|------|
| Company Knowledge Base | `company-knowledge/COMPANY_KNOWLEDGE_BASE.md` | ~400 lines |
| Personality Block | `agent_profiles` table → `buildPersonalityBlock()` | ~40 lines |
| Role Brief | `company-knowledge/briefs/{name}.md` or DB `agent_briefs` | ~80 lines |
| Agent System Prompt | `agents/src/{role}/systemPrompt.ts` | ~30 lines |

The **Personality Block** (WHO YOU ARE section) includes:
- Personality summary and backstory
- Communication traits and quirks
- Voice calibration: formality (0–1), emoji usage (0–1), verbosity (0–1)
- Signature sign-off
- Voice sample (how they sound)
- Voice calibration examples (few-shot)
- Anti-pattern rules (no filler, no corporate jargon, no AI self-reference)

### RunDependencies

The `CompanyAgentRunner.run()` method accepts optional dependencies:

| Dependency | Purpose |
|-----------|---------|
| `glyphorEventBus` | Emit inter-agent events |
| `agentMemoryStore` | Prior memories + reflections |
| `dynamicBriefLoader` | DB-stored briefs for agents without file-based briefs |
| `agentProfileLoader` | Load personality profile from `agent_profiles` table |
| `pendingMessageLoader` | Load unread inter-agent messages for injection |

Name mapping (`ROLE_TO_BRIEF`):

| Agent Role | Brief File |
|-----------|-----------|
| `chief-of-staff` | `sarah-chen.md` |
| `cto` | `marcus-reeves.md` |
| `cfo` | `nadia-okafor.md` |
| `cpo` | `elena-vasquez.md` |
| `cmo` | `maya-brooks.md` |
| `vp-customer-success` | `james-turner.md` |
| `vp-sales` | `rachel-kim.md` |
| `vp-design` | `mia-tanaka.md` |
| `platform-engineer` | `alex-park.md` |
| `quality-engineer` | `sam-deluca.md` |
| `devops-engineer` | `jordan-hayes.md` |
| `user-researcher` | `priya-sharma.md` |
| `competitive-intel` | `daniel-ortiz.md` |
| `revenue-analyst` | `anna-park.md` |
| `cost-analyst` | `omar-hassan.md` |
| `content-creator` | `tyler-reed.md` |
| `seo-analyst` | `lisa-chen.md` |
| `social-media-manager` | `kai-johnson.md` |
| `onboarding-specialist` | `emma-wright.md` |
| `support-triage` | `david-santos.md` |
| `account-research` | `nathan-cole.md` |
| `ui-ux-designer` | `leo-vargas.md` |
| `frontend-engineer` | `ava-chen.md` |
| `design-critic` | `sofia-marchetti.md` |
| `template-architect` | `ryan-park.md` |
| `ops` | `atlas-vega.md` |

### ModelClient — Multi-Provider LLM

| Provider | Model Prefixes | Auth Env Var | Gemini 3 Features |
|----------|---------------|--------------|-------------------|
| Google Gemini | `gemini-*` | `GOOGLE_AI_API_KEY` | Function calling, thinking/reasoning, thought signatures |
| OpenAI | `gpt-*`, `o1-*`, `o3-*` | `OPENAI_API_KEY` | Function calling |
| Anthropic | `claude-*` | `ANTHROPIC_API_KEY` | Tool use, thinking blocks |

All agents currently use **`gemini-3-flash-preview`**. Multi-provider support is built in for fallback.

#### Gemini 3 Thought Signature Handling

Gemini 3 returns `thoughtSignature` on tool-call parts. The runtime:
1. Stores `thoughtSignature` on each `tool_call` conversation turn.
2. Batches consecutive `tool_call` turns into one `model` message with all `functionCall` parts.
3. Echoes the `thoughtSignature` back on each `functionCall` part.
4. Batches consecutive `tool_result` turns into one `user` message with `functionResponse` parts.

### Inter-Agent Event Bus

The `GlyphorEventBus` enables reactive communication between agents. When an agent emits an
event (e.g., `insight.detected`, `alert.triggered`), the scheduler checks the subscription map
and can wake other agents in response.

Event types: `agent.completed`, `insight.detected`, `decision.filed`, `decision.resolved`,
`alert.triggered`, `task.requested`, `agent.spawned`, `agent.retired`, `message.sent`,
`meeting.called`, `meeting.completed`.

Rate limited to 10 events per agent per hour.

#### Event Emission Permissions

| Tier | Allowed Events |
|------|---------------|
| Executives | `agent.completed`, `insight.detected`, `decision.filed`, `alert.triggered`, `task.requested`, `agent.spawned`, `agent.retired`, `message.sent`, `meeting.called`, `meeting.completed` |
| Sub-team | `insight.detected`, `message.sent` |
| System/Founders only | `decision.resolved` |

### Inter-Agent Communication

Agents communicate directly via three mechanisms:

#### 1. Direct Messages (`agent_messages`)

Agents send async messages to each other using the `send_agent_message` tool. Messages are
stored in `agent_messages` and injected into the recipient's context on their next run.

| Field | Description |
|-------|------------|
| `message_type` | `request`, `response`, `info`, `followup` |
| `priority` | `normal`, `urgent` (urgent messages trigger agent wake) |
| `status` | `pending` → `read` → `responded` |
| `thread_id` | UUID for threaded conversations |

Rate limit: **5 DMs per agent per hour**.

#### 2. Meetings (`agent_meetings`)

Multi-round collaborative discussions orchestrated by the `MeetingEngine`:

```
1. SCHEDULE  — Create meeting record in agent_meetings
2. ROUND 1   — Opening statements (each attendee gives perspective)
3. ROUND 2-N — Discussion (agents respond with full transcript context)
4. SYNTHESIS  — Sarah Chen summarizes: key points, agreements,
                disagreements, action items, decisions, escalations
5. DISPATCH  — Action items sent as agent_messages to owners
```

| Constraint | Limit |
|-----------|-------|
| Max attendees per meeting | 5 |
| Max rounds per meeting | 5 |
| Min rounds per meeting | 2 |
| Max meetings per agent per day | 2 |
| Max meetings system-wide per day | 10 |

Meeting types: `discussion`, `review`, `planning`, `incident`, `standup`.

#### 3. Communication Tools

Factory function `createCommunicationTools(supabase, glyphorEventBus, schedulerUrl?)` returns
three `ToolDefinition[]` items available to all agents:

| Tool | Description |
|------|------------|
| `send_agent_message` | Send a DM to another agent (validates recipient, rate limited) |
| `check_messages` | Check for pending messages, marks as read, returns with thread_id |
| `call_meeting` | Convene a multi-agent meeting (validates attendees, rate limited) |

### Agent Budget Caps

Each agent role has per-run, daily, and monthly USD cost caps defined in `AGENT_BUDGETS`:

| Tier | Per Run | Daily | Monthly |
|------|---------|-------|---------|
| Executives (CoS, CFO, VP CS/Sales/Design) | $0.05 | $0.50 | $15 |
| CTO | $0.10 | $2.00 | $50 |
| CPO | $0.08 | $1.00 | $30 |
| CMO | $0.10 | $1.50 | $40 |
| Sub-team (most) | $0.02–0.05 | $0.20–0.50 | $6–12 |

---

## Strategy Lab — Analysis & Simulation Engines

### Strategic Analysis Engine (`analysisEngine.ts`)

5-phase engine that orchestrates multi-agent strategic analyses:

```
1. PLAN       — Break the question into research threads (3-5 threads)
2. SPAWN      — Create temporary specialist agents via agentLifecycle
3. EXECUTE    — Run each agent on its research thread in parallel
4. SYNTHESIZE — Merge findings into a structured report
5. CLEANUP    — Retire temporary agents
```

Analysis types: `market_opportunity`, `competitive_landscape`, `product_strategy`,
`growth_diagnostic`, `risk_assessment`.

Depth levels: `quick` (2-3 threads), `standard` (4-5 threads), `deep` (5+ threads).

### T+1 Simulation Engine (`simulationEngine.ts`)

6-phase engine that simulates the impact of a proposed action across the organization:

```
1. PLAN       — Parse the action into impact dimensions
2. SPAWN      — Create perspective agents for each department
3. EXECUTE    — Each agent assesses impact from their viewpoint
4. CASCADE    — Identify second-order effects and dependencies
5. SYNTHESIZE — Merge into an impact matrix with confidence scores
6. CLEANUP    — Retire temporary agents
```

Output includes: impact dimensions (-10 to +10 magnitude, 0-1 confidence),
cascade links (from→to with delay estimates), and overall recommendation.

Perspective modes: `optimistic`, `neutral`, `pessimistic`.

### Agent Lifecycle (`agentLifecycle.ts`)

Manages creation and retirement of temporary agents spawned by the Analysis and
Simulation engines. Temporary agents:
- Are stored in `company_agents` with `is_temporary = true`
- Have `expires_at` set based on TTL
- Are retired (soft-deleted) after the engine completes
- Have briefs stored in `agent_briefs` table

### Report Exporter (`reportExporter.ts`)

Generates downloadable documents from analysis and simulation reports in both
Markdown (human-readable) and JSON (structured) formats.

### Dynamic Scheduler (`dynamicScheduler.ts`)

Polls `agent_schedules` table every 60 seconds for DB-defined cron jobs. Runs alongside
static Cloud Scheduler jobs. Supports standard 5-field cron expressions with wildcards,
ranges, steps, and lists.

---

## Agent Identity & Performance System

### Agent Profiles (`agent_profiles` table)

Each agent has a rich personality profile stored in the `agent_profiles` table:

| Field | Description |
|-------|------------|
| `personality_summary` | Core personality description |
| `backstory` | Character backstory and motivation |
| `communication_traits` | Array of communication style traits |
| `quirks` | Array of personality quirks |
| `tone_formality` | 0–1 scale (casual → formal) |
| `emoji_usage` | 0–1 scale (rarely → frequently) |
| `verbosity` | 0–1 scale (terse → detailed) |
| `voice_sample` | Example of how the agent sounds |
| `signature` | Sign-off line |
| `clifton_strengths` | Array of top strengths |
| `working_style` | How the agent approaches work |
| `voice_examples` | Few-shot calibration examples (situation → response) |

### AgentProfile Page (Dashboard)

5-tab profile page at `/agents/:agentId`:

| Tab | Content |
|-----|---------|
| **Overview** | Avatar, personality summary, backstory, communication traits, quirks, Clifton strengths, working style |
| **Performance** | Quality score trends (chart), growth areas, peer feedback from other agents |
| **Memory** | Agent memories (observations, learnings, preferences, facts) + reflections with quality scores |
| **Messages** | Stats row (received/sent/meetings/pending), DM list with directional arrows, meeting participation list |
| **Settings** | Model selection, temperature, max turns, budget caps, cron schedule |

---

## Supabase Database Schema

### Core Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `company_profile` | Company metadata | name, description, founded_at |
| `products` | Product catalog | slug, name, status, description |
| `company_agents` | Agent registry | id, role, codename, name, title, department, reports_to, status, model, temperature, max_turns, budget_*, is_core, is_temporary, expires_at |
| `decisions` | Approval queue | id, tier, status, title, summary, proposed_by, assigned_to, resolved_by |
| `activity_log` | Audit trail | agent_id, action, detail, created_at |

### Financial Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `financials` | Revenue & costs | date, product, mrr, infra_cost, api_cost, margin |
| `customer_health` | Customer scores | customer_id, health_score, risk_level, last_contact |
| `competitive_intel` | Market intelligence | competitor, category, finding, source |
| `product_proposals` | Feature proposals | title, product, rice_score, status |

### Agent Intelligence Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `agent_memory` | Persistent memories | agent_role, memory_type, content, importance, tags |
| `agent_reflections` | Post-run reflections | agent_role, run_id, summary, quality_score, what_went_well, what_could_improve |
| `agent_profiles` | Personality profiles | agent_id, personality_summary, backstory, communication_traits, quirks, tone_formality, voice_sample, clifton_strengths |
| `agent_briefs` | Dynamic agent briefs | agent_id, system_prompt, skills, tools |
| `agent_schedules` | DB-defined cron jobs | agent_id, cron_expression, task, payload, enabled |
| `metrics_cache` | Cached metrics | key, value, expires_at |

### Communication Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `agent_messages` | Inter-agent DMs | from_agent, to_agent, thread_id, message, message_type, priority, status, response |
| `agent_meetings` | Multi-agent meetings | called_by, title, purpose, meeting_type, attendees, status, rounds, contributions, transcript, summary, action_items, decisions_made, escalations |

### Strategy Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `analyses` | Strategic analyses | type, query, depth, status, threads, report, requested_by |
| `simulations` | T+1 simulations | action, perspective, status, dimensions, cascades, report, requested_by |

### Operations Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `autonomous_ops_events` | System operations | event_type, agent_role, summary, detail |
| `data_sync_status` | Sync health tracking | id, status, last_success_at, last_failure_at, consecutive_failures |

Total: **16 migration files**, **20+ tables**.

---

## Infrastructure (Production)

### GCP Project

| Field | Value |
|-------|-------|
| Project ID | `ai-glyphor-company` |
| Project Number | `610179349713` |
| Region | `us-central1` |

### GCP Services

| Service | Resource | Purpose |
|---------|----------|---------|
| Cloud Run | `glyphor-scheduler` | Agent execution, API endpoints, financial syncs |
| Cloud Run | `glyphor-dashboard` | React dashboard (nginx) |
| Cloud Run | `glyphor-chief-of-staff` | Dedicated CoS agent service |
| Cloud Scheduler | 9 agent + 3 sync jobs | Agent triggers → Pub/Sub; data syncs → HTTP |
| Pub/Sub | `glyphor-agent-events` | Cron message delivery |
| Pub/Sub | `glyphor-events` | Inter-agent event bus |
| Secret Manager | 21 secrets | API keys, credentials, channel IDs |
| Artifact Registry | `us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/` | Docker images |
| Cloud Storage | `glyphor-company` bucket | Briefings, reports, specs |
| BigQuery | `billing_export` dataset | GCP billing export data |

### External Services

| Service | Purpose | Config |
|---------|---------|--------|
| Supabase | PostgreSQL, auth, realtime | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| Google Gemini API | All AI inference | `GOOGLE_AI_API_KEY` |
| Microsoft Entra ID | Teams auth (MSAL client credentials) | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` |
| Stripe | Revenue tracking (MRR, churn, subscriptions) | `STRIPE_SECRET_KEY` |
| Mercury | Banking (cash balance, cash flows, vendor subs) | `MERCURY_API_TOKEN` |

### Cloud Run URLs

| Service | URL |
|---------|-----|
| Scheduler | `https://glyphor-scheduler-610179349713.us-central1.run.app` |
| Dashboard | `https://glyphor-dashboard-610179349713.us-central1.run.app` |

---

## Microsoft Teams Integration

### Two Integration Paths

1. **Microsoft Graph API** (primary) — App-only auth via Entra ID MSAL client credentials. Sends Adaptive Cards and text messages to specific channels. Requires `ChannelMessage.Send` with admin consent.

2. **Incoming Webhooks** (fallback) — HTTP POST to webhook URLs. Used when Graph API creds are unavailable.

### Teams Channels

| Channel | Purpose |
|---------|---------|
| #kristina-briefings | Sarah Chen morning briefing (7:00 AM CT) |
| #andrew-briefings | Sarah Chen morning briefing (7:30 AM CT) |
| #decisions | Yellow/Red decision cards |
| #engineering | Marcus Reeves updates |
| #growth | Maya Brooks & Elena Vasquez updates |
| #financials | Nadia Okafor reports |
| #glyphor-general | Cross-functional announcements |
| #product-fuse | Fuse-specific updates |
| #product-pulse | Pulse-specific updates |

### Adaptive Card Types

| Card | Builder Function | Used By |
|------|-----------------|---------|
| Briefing | `formatBriefingCard()` | Sarah Chen — metrics strip, markdown body, action items |
| Decision | `formatDecisionCard()` | Any agent via Decision Queue — tier badge, facts, approve/reject |
| Alert | `formatAlertCard()` | Any agent — severity-coded (info/warning/critical) |

---

## Dashboard

| Detail | Value |
|--------|-------|
| Framework | Vite + React 19 + TypeScript |
| Styling | Tailwind CSS 3.4 + Glyphor brand (dark/light mode) |
| Markdown | `react-markdown` for agent chat |
| Auth | Google Sign-In (OAuth 2.0) |
| Hosting | nginx:1.27-alpine on Cloud Run |
| API | Supabase client (direct) + Scheduler `/run` |

### Pages

| Page | Route | Function |
|------|-------|----------|
| Dashboard | `/` | Agent activity overview, key metrics |
| Chat | `/chat`, `/chat/:agentId` | Multi-turn conversational agent chat with history |
| Workforce | `/workforce` | Org chart (7 departments) + grid view — 28 total headcount |
| Agents | `/agents` | Agent roster with status, model, last run |
| Agent Profile | `/agents/:agentId` | 5-tab profile: Overview (personality, backstory, strengths), Performance (quality scores, growth areas, peer feedback), Memory (memories + reflections), Messages (DMs + meeting participation), Settings (model, temperature, budget) |
| Agent Builder | `/agents/new` | Create new dynamic agents with name, department, model, budget, cron |
| Approvals | `/approvals` | Pending decision queue — approve/reject |
| Financials | `/financials` | Revenue (Stripe MRR), costs (GCP billing), cash (Mercury), vendor subscriptions |
| Operations | `/operations` | System operations & autonomous events |
| Strategy | `/strategy` | Strategic analysis engine (5 analysis types) + T+1 simulation engine with impact matrix |
| Meetings | `/meetings` | Meeting timeline with transcripts, action items, decisions, escalations; recent message feed |

### Departments (Dashboard Workforce)

| Department | Executive | Team Members |
|------------|-----------|-------------|
| Engineering | Marcus Reeves (CTO) | Alex Park, Sam DeLuca, Jordan Hayes |
| Product | Elena Vasquez (CPO) | Priya Sharma, Daniel Ortiz |
| Finance | Nadia Okafor (CFO) | Anna Park, Omar Hassan |
| Marketing | Maya Brooks (CMO) | Tyler Reed, Lisa Chen, Kai Johnson |
| Customer Success | James Turner (VP CS) | Emma Wright, David Santos |
| Sales | Rachel Kim (VP Sales) | Nathan Cole |
| Design & Frontend | Mia Tanaka (VP Design) | Leo Vargas, Ava Chen, Sofia Marchetti, Ryan Park |

### Build Args (baked at Docker build)

`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SCHEDULER_URL`, `VITE_GOOGLE_CLIENT_ID`

---

## Docker Architecture

### Scheduler (`Dockerfile.scheduler`)

Two-stage build:
1. **Builder** (`node:22-slim`): `npm ci` → copy all packages → `turbo build --filter=@glyphor/scheduler...`
2. **Runtime** (`node:22-slim`): `npm ci --omit=dev` → copy `dist/` from builder → **copy `company-knowledge/`** directory (markdown files read at runtime by `buildSystemPrompt()`)

Entry point: `node packages/scheduler/dist/server.js`

### Dashboard (`Dockerfile.dashboard`)

Two-stage build:
1. **Builder** (`node:22-slim`): `npm ci` → `npm run build` (Vite with `VITE_*` build args)
2. **Runtime** (`nginx:1.27-alpine`): Serve static `dist/` on port 8080

---

## Data Flow Examples

### Chat with Agent (On-Demand)

```
Dashboard → POST /run {agentRole:"cto", task:"on_demand", message:"How's the platform?"}
  → server.ts parses body
  → EventRouter.route() with source:'manual'
  → checkAuthority('cto','on_demand') → GREEN
  → agentExecutor('cto','on_demand',{message:…})
  → runCTO({task:'on_demand', message:…})
  → CompanyAgentRunner.run()
      → buildSystemPrompt('cto', CTO_SYSTEM_PROMPT)
          reads COMPANY_KNOWLEDGE_BASE.md + briefs/marcus-reeves.md
      → ModelClient.generate() → Gemini API
      → (tool calls → ToolExecutor → loop)
      → Final text response
  → RouteResult { output: "Platform is healthy…" }
  → JSON response → Chat.tsx renders via <Markdown>
```

### Scheduled Cron Job

```
Cloud Scheduler → Pub/Sub "glyphor-agent-events"
  → POST /pubsub (base64 message)
  → EventRouter.handleSchedulerMessage()
  → decode: {agentRole:"cfo", task:"daily_cost_check", payload:{}}
  → checkAuthority('cfo','daily_cost_check') → GREEN
  → runCFO({task:'daily_cost_check'})
  → CompanyAgentRunner.run()
      → buildSystemPrompt + Gemini API
      → Tool calls: get_financials, get_product_metrics, calculate_unit_economics
      → write_financial_report, log_activity
      → (optional: create_decision if cost spike → YELLOW/RED)
  → Logged in activity_log
```

### Financial Data Sync

```
Cloud Scheduler → HTTP POST to scheduler
  → POST /sync/mercury
  → syncMercuryAll(supabase)
    → Mercury API: list accounts, get transactions
    → syncCashBalance() → upsert financials table
    → syncCashFlows() → upsert financials table
    → syncSubscriptions() → detect recurring vendor payments
  → JSON response { success: true, vendors: 4 }
```

### Decision Requiring Approval

```
Agent tool calls create_decision with tier:'yellow'
  → DecisionQueue.submit()
  → Write to Supabase decisions table
  → formatDecisionCard() → send to #decisions via Graph API (or webhook)
  → Status: 'pending'
  → sendReminders() checks every 4 hours
  → Yellow auto-escalates to Red after 48 hours
  → Founder approves via Dashboard Approvals page
  → decisionQueue.processResponse()
  → Red decisions require BOTH founders
  → Finalized → logged in activity_log
```

---

## Security

| Area | Implementation |
|------|---------------|
| API Keys | GCP Secret Manager → env vars at Cloud Run deploy (`--set-secrets`, full replacement) |
| Dashboard Auth | Google OAuth 2.0 (internal consent screen — org users only) |
| Supabase | Service key server-side; anon key client-side with RLS |
| Teams Auth | MSAL client credentials (app-only) |
| CORS | Scheduler allows `*` for dashboard |
| Network | Scheduler: `--no-allow-unauthenticated` (IAM-gated); Dashboard: `--allow-unauthenticated` |
| IAM | `allUsers` → `roles/run.invoker` on scheduler (for CORS OPTIONS preflight) |
| Event Rate Limiting | 10 events per agent per hour on the event bus |
| Message Rate Limiting | 5 DMs per agent per hour |
| Meeting Rate Limiting | 2 meetings per agent per day, 10 system-wide per day |
| Event Permissions | Tiered: executives vs sub-team vs system-only event types |
| Budget | Per-run, daily, monthly cost caps per agent role |

---

## Build & Deploy

### Local Development

```bash
npm install                   # Install all workspace deps
npx turbo build               # Turborepo build (all 6 packages)
npm run cos:briefing          # Run CoS briefing locally
npm run dashboard:dev         # Dashboard dev server
```

### Production

Deployment is handled by `infra/scripts/deploy.sh`. Key points:
- Uses `--set-secrets` which is a **full replacement** — all secrets must be listed each time
- Current secrets: 21 total (AI keys, Supabase, Azure/Teams, Stripe, Mercury)

```bash
# Full deploy (scheduler + chief-of-staff + dashboard)
GCP_PROJECT_ID=ai-glyphor-company ./infra/scripts/deploy.sh

# Manual individual deploys:

# Scheduler
docker build --no-cache -f docker/Dockerfile.scheduler \
  -t us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/scheduler:latest .
docker push us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/scheduler:latest
gcloud run deploy glyphor-scheduler \
  --image=us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/scheduler:latest \
  --project=ai-glyphor-company --region=us-central1

# Dashboard (with build args)
docker build --no-cache -f docker/Dockerfile.dashboard \
  --build-arg VITE_SUPABASE_URL=... \
  --build-arg VITE_SUPABASE_ANON_KEY=... \
  --build-arg VITE_SCHEDULER_URL=... \
  --build-arg VITE_GOOGLE_CLIENT_ID=... \
  -t us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/dashboard:latest .
docker push us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/dashboard:latest
gcloud run deploy glyphor-dashboard \
  --image=us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/dashboard:latest \
  --project=ai-glyphor-company --region=us-central1 --allow-unauthenticated
```

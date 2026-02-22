# Glyphor AI Company — System Architecture

> Last updated: 2025-02-22

## Overview

Glyphor AI Company is a monorepo containing 7 AI executive agents that autonomously operate
Glyphor alongside two human founders (Kristina Denney, CEO; Andrew Zwelling, COO). The agents
run 24/7 on GCP Cloud Run, share state through Supabase, communicate with founders via Microsoft
Teams, and are governed by a three-tier authority model (Green / Yellow / Red).

The founders work full-time at Microsoft with 5-10 h/week for Glyphor. The AI executive team
handles everything else: daily operations, financial monitoring, content creation, product
analysis, customer success, enterprise sales research, and cross-functional synthesis.

---

## High-Level Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                      GCP Cloud Scheduler                             │
│  9 cron jobs → Pub/Sub topic "glyphor-agent-events"                  │
│  (briefings, health checks, cost reviews, content, pipelines, etc.)  │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ Pub/Sub push
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│             Scheduler Service (Cloud Run: glyphor-scheduler)         │
│                                                                      │
│  POST /pubsub ── Cloud Scheduler cron messages                       │
│  POST /run    ── Dashboard chat & manual invocations                 │
│  GET  /health ── Health check                                        │
│  OPTIONS /*   ── CORS preflight                                      │
│                                                                      │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐   │
│  │ Cron Manager │  │ Event Router  │  │    Authority Gates       │   │
│  │ (9 jobs)     │  │ route()       │  │ checkAuthority(role,act) │   │
│  └──────────────┘  │ handlePubSub()│  │ GREEN per-role           │   │
│                    │ handleAgent() │  │ YELLOW → one founder     │   │
│                    └───────┬───────┘  │ RED    → both founders   │   │
│                            │          └────────────┬─────────────┘   │
│                            ▼                       │                 │
│                   ┌────────────────┐    ┌──────────▼──────────┐      │
│                   │ Agent Executor │    │  Decision Queue     │      │
│                   │ (role→runner)  │    │  submit / approve   │      │
│                   └────────┬───────┘    │  reminders (4 h)    │      │
│                            │            └─────────┬──────────┘      │
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
│  │   │  + Agent systemPrompt │ │  │  │  #growth                    │
│  │   └───────────────────────┘ │  │  │  #financials                │
│  │   ├─ ModelClient            │  │  │  #glyphor-general           │
│  │   │  (Gemini/OpenAI/Claude) │  │  │  #product-fuse              │
│  │   ├─ AgentSupervisor        │  │  │  #product-pulse             │
│  │   ├─ ToolExecutor           │  │  │                              │
│  │   └─ EventBus               │  │  │  Adaptive Cards:            │
│  └─────────────────────────────┘  │  │  ├ Briefing card            │
│                                   │  │  ├ Decision card             │
└───────────────┬───────────────────┘  │  └ Alert card                │
                │                      └──────────────────────────────┘
                ▼
┌───────────────────────────────────┐
│        Company Memory             │
│  ┌─────────────────────────────┐  │
│  │ Supabase (9 tables)         │  │
│  │  ├ company_profile          │  │
│  │  ├ products                 │  │
│  │  ├ company_agents           │  │
│  │  ├ decisions                │  │
│  │  ├ activity_log             │  │
│  │  ├ competitive_intel        │  │
│  │  ├ customer_health          │  │
│  │  ├ financials               │  │
│  │  └ product_proposals        │  │
│  ├─────────────────────────────┤  │
│  │ GCS (large documents)       │  │
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
│   ├ Dashboard.tsx  (agent overview)       │
│   ├ Chat.tsx       (talk to agents)       │
│   ├ Workforce.tsx  (agent roster)         │
│   └ Approvals.tsx  (decision queue)       │
│                                           │
│   Auth: Google Sign-In (OAuth 2.0)        │
│   API: Supabase direct + Scheduler /run   │
└──────────────────────────────────────────┘
```

---

## Agent Roster

All 7 agents are active and run 24/7 via the scheduler service.

| Codename | Role | Agent ID | Model | Responsibilities |
|----------|------|----------|-------|-----------------|
| **Atlas** | Chief of Staff | `chief-of-staff` | `gemini-3-flash-preview` | Morning briefings, decision routing, cross-agent synthesis, escalation tracking, EOD summaries |
| **Forge** | CTO | `cto` | `gemini-3-flash-preview` | Platform health, deployment management, model fallbacks, incident response, dependency review |
| **Ledger** | CFO | `cfo` | `gemini-3-flash-preview` | Daily cost monitoring, revenue tracking, margin analysis, unit economics, budget alerts |
| **Compass** | CPO | `cpo` | `gemini-3-flash-preview` | Usage analysis, competitive intelligence, roadmap management, feature prioritisation (RICE) |
| **Beacon** | CMO | `cmo` | `gemini-3-flash-preview` | Content generation, social media, SEO strategy, brand positioning, growth analytics |
| **Harbor** | VP Customer Success | `vp-customer-success` | `gemini-3-flash-preview` | Health scoring, churn prevention, nurture outreach, cross-product recommendations |
| **Closer** | VP Sales | `vp-sales` | `gemini-3-flash-preview` | KYC research, ROI calculators, enterprise proposals, pipeline management, market sizing |

### Cron Schedules (GCP Cloud Scheduler)

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

---

## Monorepo Package Structure

```
glyphor-ai-company/
├── packages/
│   ├── agent-runtime/          # Core execution engine
│   │   └── src/
│   │       ├── companyAgentRunner.ts   # Agent loop + knowledge injection
│   │       ├── modelClient.ts          # Multi-provider LLM (Gemini/OpenAI/Anthropic)
│   │       ├── supervisor.ts           # Turn limits, stall detection, timeouts
│   │       ├── toolExecutor.ts         # Tool declaration → execution bridge
│   │       ├── eventBus.ts             # Internal event system
│   │       ├── reasoning.ts            # Reasoning extraction & stripping
│   │       └── types.ts               # All core types
│   │
│   ├── company-memory/          # Persistence layer
│   │   └── src/
│   │       ├── store.ts               # CompanyMemoryStore (Supabase + GCS)
│   │       ├── namespaces.ts          # Key prefixes and GCS paths
│   │       └── schema.ts             # Database row types
│   │
│   ├── agents/                  # 7 agent implementations
│   │   └── src/
│   │       ├── chief-of-staff/        # Sarah Chen — run.ts, systemPrompt.ts, tools.ts
│   │       ├── cto/                   # Marcus Reeves
│   │       ├── cfo/                   # Nadia Okafor
│   │       ├── cpo/                   # Elena Vasquez
│   │       ├── cmo/                   # Maya Brooks
│   │       ├── vp-customer-success/   # James Turner
│   │       ├── vp-sales/              # Rachel Kim
│   │       └── index.ts              # Re-exports all runners
│   │
│   ├── company-knowledge/       # Shared context (read at runtime)
│   │   ├── COMPANY_KNOWLEDGE_BASE.md  # ~400 lines: founders, products, metrics, rules
│   │   └── briefs/
│   │       ├── sarah-chen.md          # Chief of Staff brief
│   │       ├── marcus-reeves.md       # CTO brief
│   │       ├── nadia-okafor.md        # CFO brief
│   │       ├── elena-vasquez.md       # CPO brief
│   │       ├── maya-brooks.md         # CMO brief
│   │       ├── james-turner.md        # VP CS brief
│   │       └── rachel-kim.md          # VP Sales brief
│   │
│   ├── integrations/            # External service connectors
│   │   └── src/teams/
│   │       ├── webhooks.ts            # Incoming webhook sender
│   │       ├── graphClient.ts         # Microsoft Graph API (MSAL)
│   │       └── adaptiveCards.ts       # Briefing / Decision / Alert cards
│   │
│   ├── scheduler/               # Orchestration service
│   │   └── src/
│   │       ├── server.ts              # HTTP server (Cloud Run entry)
│   │       ├── eventRouter.ts         # Event → agent routing + authority
│   │       ├── authorityGates.ts      # Green/Yellow/Red classification
│   │       ├── cronManager.ts         # 9 cron job definitions
│   │       └── decisionQueue.ts       # Human approval workflow
│   │
│   └── dashboard/               # Web UI
│       ├── src/
│       │   ├── pages/
│       │   │   ├── Dashboard.tsx      # Agent overview & metrics
│       │   │   ├── Chat.tsx           # Real-time agent chat (react-markdown)
│       │   │   ├── Workforce.tsx      # Agent roster table
│       │   │   └── Approvals.tsx      # Decision approval queue
│       │   ├── components/            # Shared UI components
│       │   ├── lib/                   # Hooks, Supabase client, utilities
│       │   ├── App.tsx               # Router & layout
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
│       ├── deploy.sh
│       ├── seed-memory.sh
│       └── open-dashboard.ps1
│
├── supabase/migrations/         # 3 migration files
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
   buildSystemPrompt(role, existingPrompt)
    → Load COMPANY_KNOWLEDGE_BASE.md   (shared company context)
    → Load briefs/{codename}.md        (role-specific brief)
    → Append agent's own systemPrompt
    → Final = Knowledge Base + Role Brief + Agent System Prompt

2. SUPERVISOR CHECK
    → Verify turnCount < maxTurns (default 10)
    → Verify stallCount < maxStallTurns (default 3)
    → Verify timeout not exceeded (default 60 s)

3. CONTEXT INJECTION (turn 2+)
    → Optional per-agent contextInjector adds dynamic context

4. MODEL CALL
    → Send systemInstruction + history to Gemini API
    → Include tool declarations for function calling
    → Handle Gemini 3 thought signatures (batch tool_call/tool_result turns)

5. TOOL DISPATCH
    → If tool calls → ToolExecutor.execute() each one
    → Push tool_call turns (with thoughtSignature), then tool_result turns
    → Loop back to step 2

6. COMPLETION
    → Model returns text with STOP finish reason → done
    → Extract reasoning envelope if present
    → Return AgentExecutionResult
```

### Knowledge Injection

Every Gemini API call receives a composite system prompt built from three layers:

| Layer | Source | Size |
|-------|--------|------|
| Company Knowledge Base | `company-knowledge/COMPANY_KNOWLEDGE_BASE.md` | ~400 lines |
| Role Brief | `company-knowledge/briefs/{codename}.md` | ~80 lines |
| Agent System Prompt | `agents/src/{role}/systemPrompt.ts` | ~30 lines |

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
| Cloud Run | `glyphor-scheduler` | Agent execution, API endpoints |
| Cloud Run | `glyphor-dashboard` | React dashboard (nginx) |
| Cloud Scheduler | 9 cron jobs | Agent triggers → Pub/Sub |
| Pub/Sub | `glyphor-agent-events` | Cron message delivery |
| Secret Manager | 20+ secrets | API keys, credentials, channel IDs |
| Artifact Registry | `us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/` | Docker images |
| Cloud Storage | `glyphor-company` bucket | Briefings, reports, specs |

### External Services

| Service | Purpose | Config |
|---------|---------|--------|
| Supabase | PostgreSQL (9 tables), auth, realtime | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| Google Gemini API | All AI inference | `GOOGLE_AI_API_KEY` |
| Microsoft Entra ID | Teams auth (MSAL client credentials) | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` |

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
| Styling | Tailwind CSS 3.4 + Glyphor brand (dark mode) |
| Markdown | `react-markdown` for agent chat |
| Auth | Google Sign-In (OAuth 2.0) |
| Hosting | nginx:1.27-alpine on Cloud Run |
| API | Supabase client (direct) + Scheduler `/run` |

### Pages

| Page | Route | Function |
|------|-------|----------|
| Dashboard | `/` | Agent activity overview, key metrics |
| Chat | `/chat` | Select agent in sidebar, send messages, formatted responses |
| Workforce | `/workforce` | Agent roster — name, role, model, status, last run |
| Approvals | `/approvals` | Pending decision queue — approve/reject |

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
| API Keys | GCP Secret Manager → env vars at Cloud Run deploy |
| Dashboard Auth | Google OAuth 2.0 (internal consent screen — org users only) |
| Supabase | Service key server-side; anon key client-side with RLS |
| Teams Auth | MSAL client credentials (app-only) |
| CORS | Scheduler allows `*` for dashboard |
| Network | Both Cloud Run services: `--allow-unauthenticated` |

---

## Build & Deploy

### Local Development

```bash
npm install                   # Install all workspace deps
npm run build                 # Turborepo build
npm run cos:briefing          # Run CoS briefing locally
npm run dashboard:dev         # Dashboard dev server
```

### Production

```bash
# Scheduler
docker build --no-cache -f docker/Dockerfile.scheduler \
  -t us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/scheduler:latest .
docker push us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/scheduler:latest
gcloud run deploy glyphor-scheduler \
  --image=us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/scheduler:latest \
  --project=ai-glyphor-company --region=us-central1 --allow-unauthenticated

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

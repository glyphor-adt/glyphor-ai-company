# Glyphor AI Company — System Architecture

> Last updated: 2026-02-23

## Overview

Glyphor AI Company is a monorepo containing 8 AI executive agents, 18 sub-team members, and
1 operations agent that autonomously operate Glyphor alongside two human founders (Kristina
Denney, CEO; Andrew Denney, COO). The agents run 24/7 on GCP Cloud Run, share state through
Supabase, communicate with founders via Microsoft Teams, and are governed by a three-tier
authority model (Green / Yellow / Red).

Total headcount: **29** — 2 human founders, 8 AI executives, 18 AI team members, 1 AI ops agent.

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
│  4 data sync jobs  → HTTP POST to scheduler endpoints                │
│  + Dynamic Scheduler (DB-defined cron from agent_schedules table)    │
│  + Data Sync Scheduler (internal cron for sync jobs when GCP CS      │
│    hasn't been provisioned)                                          │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ Pub/Sub push + HTTP
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│             Scheduler Service (Cloud Run: glyphor-scheduler)         │
│                                                                      │
│  POST /pubsub            ── Cloud Scheduler cron messages            │
│  POST /run               ── Dashboard chat & manual invocations      │
│  POST /event             ── Glyphor Event Bus (inter-agent events)   │
│  POST /api/teams/messages── Teams Bot Framework webhook (JWT)         │
│  POST /webhook/stripe    ── Stripe webhook receiver                  │
│  POST /sync/stripe       ── Stripe data sync                        │
│  POST /sync/gcp-billing  ── GCP billing export sync                 │
│  POST /sync/mercury      ── Mercury banking sync                    │
│  POST /heartbeat         ── Lightweight agent check-in cycle         │
│  POST /agents/create     ── Create new dynamic agent                │
│  PUT  /agents/:id/settings── Update agent configuration             │
│  POST /agents/:id/pause  ── Pause agent                             │
│  POST /agents/:id/resume ── Resume agent                            │
│  DELETE /agents/:id      ── Retire (soft-delete) agent              │
│  POST /analysis/run      ── Launch strategic analysis               │
│  GET  /analysis/:id      ── Get analysis status/result              │
│  GET  /analysis          ── List all analyses                       │
│  GET  /analysis/:id/export── Export analysis report (md/json)       │
│  GET  /analysis/:id/visual── Get saved AI-generated infographic     │
│  POST /analysis/:id/visual── Generate & save AI infographic         │
│  POST /simulation/run    ── Launch T+1 simulation                   │
│  GET  /simulation/:id    ── Get simulation status/result            │
│  GET  /simulation        ── List all simulations                    │
│  POST /simulation/:id/accept ── Accept simulation result            │
│  GET  /simulation/:id/export ── Export simulation report (md/json)  │
│  GET  /deep-dive/:id/visual── Get saved deep dive infographic       │
│  POST /deep-dive/:id/visual── Generate & save deep dive infographic │
│  POST /cache/invalidate  ── Invalidate prompt cache (by prefix)     │
│  POST /cot/run           ── Launch chain-of-thought analysis         │
│  GET  /cot               ── List all CoT analyses                   │
│  GET  /cot/:id           ── Get CoT analysis status/result          │
│  GET  /cot/:id/export    ── Export CoT report (md/json)             │
│  POST /meetings/call     ── Convene multi-agent meeting             │
│  GET  /meetings/:id      ── Get meeting status/transcript           │
│  GET  /meetings          ── List all meetings                       │
│  POST /messages/send     ── Send inter-agent message                │
│  GET  /messages/agent/:id── Get messages for an agent               │
│  GET  /messages          ── Get all recent messages                 │
│  GET  /pulse             ── Company pulse snapshot                   │
│  GET  /knowledge/company ── Company knowledge base                   │
│  GET  /knowledge/routes  ── Knowledge routing rules                  │
│  POST /knowledge/routes  ── Update knowledge routing rules           │
│  GET  /knowledge/patterns── Process patterns                         │
│  GET  /knowledge/contradictions ── Contradiction detection           │
│  GET  /authority/proposals── Authority tier proposals                │
│  GET  /health            ── Health check                             │
│  OPTIONS /*              ── CORS preflight                           │
│                                                                      │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐   │
│  │ Cron Manager │  │ Event Router  │  │    Authority Gates       │   │
│  │ (9+4 static  │  │ route()       │  │ checkAuthority(role,act) │   │
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
│  ├──────────────┤          │                      │                 │
│  │ CoT Engine   │          │                      │                 │
│  ├──────────────┤          │                      │                 │
│  │ Wake Router  │          │                      │                 │
│  │ + Heartbeat  │          │                      │                 │
│  ├──────────────┤          │                      │                 │
│  │ DataSync     │          │                      │                 │
│  │ Scheduler    │          │                      │                 │
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
│  │   ├─ PendingAssignmentLoader│ │  │                              │
│  │   ├─ WorkingMemoryLoader   │  │  │                              │
│  │   ├─ PromptCache (5 min)   │  │  │                              │
│  │   └─ AgentProfileLoader    │  │  │                              │
│  └─────────────────────────────┘  │  └──────────────────────────────┘
│                                   │
│  Shared agent tools:              │
│   ├─ memoryTools (save/recall)    │
│   ├─ eventTools (emit events)     │
│   ├─ communicationTools           │
│   │  (send_message, check_msgs,   │
│   │   call_meeting)               │
│   ├─ assignmentTools              │
│   │  (read_my_assignments,        │
│   │   submit_assignment_output,   │
│   │   flag_assignment_blocker)    │
│   ├─ graphTools                   │
│   │  (query_knowledge_graph,      │
│   │   add_knowledge, trace_*)     │
│   └─ collectiveIntelligenceTools  │
│      (pulse, knowledge routing,   │
│       patterns, contradictions)   │
└───────────────┬───────────────────┘
                │
                ▼
┌───────────────────────────────────┐  ┌──────────────────────────────┐
│        Company Memory             │  │   External Integrations      │
│  ┌─────────────────────────────┐  │  │                              │
│  │ Supabase (PostgreSQL)       │  │  │  Stripe  — MRR, churn, subs │
│  │  ├ company_profile          │  │  │  Mercury — banking, cash     │
│  │  ├ products                 │  │  │  GCP     — billing export    │
│  │  ├ company_agents (28 cols) │  │  │                              │
│  │  ├ decisions                │  │  └──────────────────────────────┘
│  │  ├ activity_log             │  │
│  │  ├ competitive_intel        │  │
│  │  ├ customer_health          │  │
│  │  ├ financials               │  │
│  │  ├ product_proposals        │  │
│  │  ├ events                   │  │
│  │  ├ agent_memory (pgvector)  │  │
│  │  ├ agent_reflections        │  │
│  │  ├ agent_profiles           │  │
│  │  ├ agent_performance        │  │         ┌─────────────────────┐
│  │  ├ agent_runs               │  │         │ Inter-Agent Comms   │
│  │  ├ agent_briefs             │  │         │                     │
│  │  ├ agent_schedules          │  │         ┌─────────────────────┐
│  │  ├ agent_messages           │  │         │ Inter-Agent Comms   │
│  │  ├ agent_meetings           │  │         │                     │
│  │  ├ analyses                 │  │         │ DMs + Meetings      │
│  │  ├ simulations              │  ├────────►│ Rate limited:       │
│  │  ├ cot_analyses             │  │         │  5 DMs/hr/agent     │
│  │  ├ deep_dives               │  │         │  2 meetings/day     │
│  │  ├ company_pulse            │  │         │  10 meetings/day    │
│  │  ├ company_knowledge        │  │         └─────────────────────┘
│  │  ├ kg_nodes (pgvector)      │  │
│  │  ├ kg_edges                 │  │
│  │  ├ skills + agent_skills    │  │
│  │  ├ founder_directives       │  │
│  │  ├ work_assignments         │  │
│  │  ├ chat_messages            │  │
│  │  ├ agent_wake_queue         │  │
│  │  ├ platform_iam_state       │  │
│  │  ├ platform_audit_log       │  │
│  │  └ ... (69 tables total)    │  │
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
│   ├ Dashboard.tsx    (agent overview)     │
│   ├ Chat.tsx         (talk to agents)    │
│   ├ GroupChat.tsx    (multi-agent chat)   │
│   ├ Workforce.tsx    (org chart + roster)│
│   ├ WorkforceBuilder.tsx (org builder)   │
│   ├ AgentsList.tsx   (agent roster)      │
│   ├ AgentProfile.tsx (identity, perf,    │
│   │                   memory, messages,  │
│   │                   settings)          │
│   ├ AgentBuilder.tsx (create new agents) │
│   ├ AgentSettings.tsx(agent config)      │
│   ├ Approvals.tsx    (decision queue)    │
│   ├ Directives.tsx   (founder tasks)     │
│   ├ Financials.tsx   (revenue & costs)   │
│   ├ Governance.tsx   (IAM & secrets)     │
│   ├ Knowledge.tsx    (knowledge base)    │
│   ├ Operations.tsx   (system operations) │
│   ├ Activity.tsx     (run history +      │
│   │                   live running)      │
│   ├ Strategy.tsx     (analysis & sims)   │
│   ├ Graph.tsx        (knowledge graph)   │
│   ├ Skills.tsx       (skill library)     │
│   ├ SkillDetail.tsx  (skill detail)      │
│   ├ Meetings.tsx     (meetings & DMs)    │
│   └ TeamsConfig.tsx  (Teams bot setup)   │
│                                           │
│   Auth: Teams SSO (Entra ID) or Google   │
│         Sign-In (OAuth 2.0)               │
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

### Sub-Team Members (18)

Sub-team members have full agent runners (`run.ts`, `systemPrompt.ts`, `tools.ts`), role briefs,
and dashboard entries. They operate under their executive's authority scope and report to them.

| Name | Title | Department | Reports To |
|------|-------|------------|------------|
| **Alex Park** | Platform Engineer | Engineering | Marcus Reeves (CTO) |
| **Sam DeLuca** | Quality Engineer | Engineering | Marcus Reeves (CTO) |
| **Jordan Hayes** | DevOps Engineer | Engineering | Marcus Reeves (CTO) |
| **Riley Morgan** | M365 Administrator | Engineering | Marcus Reeves (CTO) |
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
   Riley M.                                                          Ryan Park
```

### Cron Schedules (GCP Cloud Scheduler)

#### Agent Task Jobs (9 jobs, via Pub/Sub)

All 9 jobs are **enabled** and run **daily** (every day of the week).

| Job ID | Agent | Cron (UTC) | Local (CT) | Task |
|--------|-------|-----------|------------|------|
| `cos-briefing-kristina` | Sarah Chen | `0 12 * * *` | 7:00 AM | Morning briefing for Kristina |
| `cos-briefing-andrew` | Sarah Chen | `30 12 * * *` | 7:30 AM | Morning briefing for Andrew |
| `cos-eod-summary` | Sarah Chen | `0 23 * * *` | 6:00 PM | End-of-day summary |
| `cto-health-check` | Marcus Reeves | `0 */2 * * *` | Every 2 hours | Platform health check |
| `cfo-daily-costs` | Nadia Okafor | `0 14 * * *` | 9:00 AM | Daily cost analysis |
| `cpo-usage-analysis` | Elena Vasquez | `0 15 * * *` | 10:00 AM | Usage & competitive analysis |
| `cmo-content-calendar` | Maya Brooks | `0 14 * * *` | 9:00 AM | Content planning |
| `vpcs-health-scoring` | James Turner | `0 13 * * *` | 8:00 AM | Customer health scoring |
| `vps-pipeline-review` | Rachel Kim | `0 14 * * *` | 9:00 AM | Enterprise pipeline review |

#### Data Sync Jobs (3 jobs, via HTTP + internal DataSyncScheduler)

| Job ID | Cron (UTC) | Local (CT) | Endpoint | Source |
|--------|-----------|------------|----------|--------|
| `sync-stripe` | `0 6 * * *` | 12:00 AM | `/sync/stripe` | Stripe (MRR, churn, subscriptions) |
| `sync-gcp-billing` | `0 7 * * *` | 1:00 AM | `/sync/gcp-billing` | GCP BigQuery billing export |
| `sync-mercury` | `0 8 * * *` | 2:00 AM | `/sync/mercury` | Mercury (cash balance, flows, vendor subs) |
| `heartbeat` | `*/10 * * * *` | Every 10 min | `/heartbeat` | Lightweight agent check-ins (DB only, no LLM) |

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
│   │       ├── embeddingClient.ts     # Gemini embedding-001 vector embeddings (768-dim)
│   │       ├── collectiveIntelligence.ts # Collective intelligence store (company pulse, knowledge)
│   │       ├── graphReader.ts         # KnowledgeGraphReader — semantic search, N-hop, causal chains
│   │       ├── graphWriter.ts         # KnowledgeGraphWriter — node/edge upsert, deduplication
│   │       ├── namespaces.ts          # Key prefixes and GCS paths
│   │       ├── schema.ts             # Database row types
│   │       └── migrations/           # Schema migration helpers
│   │
│   ├── agents/                  # Agent implementations (8 execs + 18 sub-team + 1 ops)
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
│   │       ├── m365-admin/            # Riley Morgan (CTO team) — M365 user/channel/calendar mgmt
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
│   │       │   ├── communicationTools.ts # send_agent_message, check_messages, call_meeting
│   │       │   ├── graphTools.ts         # query_knowledge_graph, add_knowledge, trace_causes/impact
│   │       │   ├── collectiveIntelligenceTools.ts # pulse, knowledge routes, patterns, contradictions
│   │       │   └── createRunDeps.ts      # Wire up all run dependencies for any agent
│   │       └── index.ts              # Re-exports all runners
│   │
│   ├── company-knowledge/       # Shared context (read at runtime)
│   │   ├── COMPANY_KNOWLEDGE_BASE.md  # ~400 lines: founders, products, metrics, rules
│   │   ├── CORE.md                    # Core company identity & values
│   │   ├── context/                   # Department-specific context (7 files)
│   │   │   ├── design.md              # Design department context
│   │   │   ├── engineering.md         # Engineering department context
│   │   │   ├── finance.md             # Finance department context
│   │   │   ├── marketing.md           # Marketing department context
│   │   │   ├── operations.md          # Operations department context
│   │   │   ├── product.md             # Product department context
│   │   │   └── sales-cs.md            # Sales & CS department context
│   │   └── briefs/                    # 27 role briefs (8 execs + 18 sub-team + 1 ops)
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
│   │       │   ├── bot.ts             # Bot Framework handler (multi-bot, JWT validation)
│   │       │   ├── webhooks.ts        # Incoming webhook sender
│   │       │   ├── graphClient.ts     # Microsoft Graph API (MSAL)
│   │       │   ├── adaptiveCards.ts   # Briefing / Decision / Alert cards
│   │       │   ├── directMessages.ts  # Graph API DM sender
│   │       │   ├── email.ts           # Graph API email sender
│   │       │   └── calendar.ts        # Graph API calendar manager
│   │       ├── stripe/
│   │       │   └── index.ts           # MRR sync, churn rate, webhook handler
│   │       ├── gcp/
│   │       │   └── index.ts           # Cloud Run metrics, BigQuery billing export
│   │       ├── mercury/
│   │       │   └── index.ts           # Bank accounts, cash flows, vendor subscriptions
│   │       ├── github/
│   │       │   └── index.ts           # Repos, PRs, CI/CD runs, commits, issues
│   │       ├── posthog/
│   │       │   └── index.ts           # Product analytics, events, funnels
│   │       ├── intercom/
│   │       │   └── index.ts           # Support tickets, conversations
│   │       ├── ghost/
│   │       │   └── index.ts           # CMS publishing (blog posts)
│   │       ├── buffer/
│   │       │   └── index.ts           # Social media scheduling
│   │       ├── sendgrid/
│   │       │   └── index.ts           # Transactional email sending
│   │       ├── apollo/
│   │       │   └── index.ts           # Company/people enrichment
│   │       ├── crunchbase/
│   │       │   └── index.ts           # Funding & company data
│   │       ├── ahrefs/
│   │       │   └── index.ts           # SEO analysis & keyword tracking
│   │       ├── wappalyzer/
│   │       │   └── index.ts           # Tech stack detection
│   │       └── search-console/
│   │           └── index.ts           # Google Search Console data
│   │
│   ├── scheduler/               # Orchestration service
│   │   └── src/
│   │       ├── server.ts              # HTTP server (Cloud Run entry, 40+ endpoints)
│   │       ├── eventRouter.ts         # Event → agent routing + authority
│   │       ├── authorityGates.ts      # Green/Yellow/Red classification (all 27 roles)
│   │       ├── cronManager.ts         # 9 agent + 4 data sync job definitions
│   │       ├── dynamicScheduler.ts    # DB-driven cron for dynamic agents
│   │       ├── dataSyncScheduler.ts   # Internal cron for data sync jobs (fires HTTP to self)
│   │       ├── decisionQueue.ts       # Human approval workflow
│   │       ├── agentLifecycle.ts      # Create/retire temporary agents
│   │       ├── analysisEngine.ts      # 5-phase strategic analysis engine
│   │       ├── simulationEngine.ts    # T+1 impact simulation engine
│   │       ├── cotEngine.ts           # 4-phase chain-of-thought planning engine
│   │       ├── meetingEngine.ts       # Multi-round inter-agent meetings
│   │       ├── reportExporter.ts      # Analysis/simulation/CoT export (md/json) + visual prompt builder
│   │       ├── wakeRouter.ts          # Event-driven agent wake dispatcher
│   │       ├── wakeRules.ts           # Declarative event-to-agent wake mappings
│   │       └── heartbeat.ts           # Lightweight periodic agent check-ins (DB only)
│   │
│   └── dashboard/               # Web UI
│       ├── src/
│       │   ├── pages/
│       │   │   ├── Dashboard.tsx      # Agent overview & metrics
│       │   │   ├── Chat.tsx           # Real-time agent chat (react-markdown)
│       │   │   ├── GroupChat.tsx      # Multi-agent group chat
│       │   │   ├── Workforce.tsx      # Org chart + grid view (7 departments)
│       │   │   ├── WorkforceBuilder.tsx # Drag-and-drop org chart builder
│       │   │   ├── AgentsList.tsx     # Agent roster & grid
│       │   │   ├── AgentProfile.tsx   # 5-tab agent profile (overview, perf,
│       │   │   │                      #   memory, messages, settings)
│       │   │   ├── AgentBuilder.tsx   # Create new dynamic agents
│       │   │   ├── AgentSettings.tsx  # Agent configuration & system prompts
│       │   │   ├── Approvals.tsx      # Decision approval queue
│       │   │   ├── Directives.tsx     # Founder directives management
│       │   │   ├── Financials.tsx     # Revenue, costs, GCP billing, vendor subscriptions
│       │   │   ├── Governance.tsx     # Platform governance, IAM state, secret rotation
│       │   │   ├── Knowledge.tsx      # Knowledge base management & founder bulletins
│       │   │   ├── Operations.tsx     # System operations & events
│       │   │   ├── Activity.tsx       # Live running-now banner, filterable run history, real-time subscriptions
│       │   │   ├── Strategy.tsx       # Strategic analysis & T+1 simulations & CoT planning & AI infographics
│       │   │   ├── Graph.tsx          # Interactive force-directed knowledge graph (canvas)
│       │   │   ├── Skills.tsx         # Skill library browser (10 categories)
│       │   │   ├── SkillDetail.tsx    # Skill detail + agent assignments
│       │   │   ├── Meetings.tsx       # Inter-agent meetings & messages
│       │   │   └── TeamsConfig.tsx    # Teams bot setup & configuration
│       │   ├── components/            # Shared UI components
│       │   │   ├── Layout.tsx            # Sidebar nav (14 items), theme toggle
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
│       │   ├── App.tsx               # Router & layout (22 routes)
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
├── teams/                       # Microsoft Teams app packages
│   ├── manifest.json            # Main Glyphor AI team tab + bot (v1.1.0)
│   └── agents/                  # 9 individual agent bot manifests + zip packages
│       ├── sarah-chen/          # Chief of Staff bot
│       ├── atlas-vega/          # Operations bot
│       ├── marcus-reeves/       # CTO bot
│       ├── elena-vasquez/       # CPO bot
│       ├── nadia-okafor/        # CFO bot
│       ├── maya-brooks/         # CMO bot
│       ├── james-turner/        # VP CS bot
│       ├── rachel-kim/          # VP Sales bot
│       └── riley-morgan/        # M365 Admin bot
│
├── supabase/migrations/         # 33 migration files
├── .github/workflows/deploy.yml # CI/CD (GitHub Actions → Cloud Run)
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
   buildSystemPrompt(role, existingPrompt, dynamicBrief?, profile?, skillContext?, dbKnowledgeBase?, bulletinContext?)
    → Personality Block (WHO YOU ARE)    (from agent_profiles table)
    → Conversation Mode Detection        (casual vs task routing)
    → Reasoning Protocol                 (Orient → Plan → Execute → Reflect)
    → Work Assignments Protocol           (check → work → submit/flag)
    → Skill Block (if skills active)      (methodology, proficiency, refinements)
    → Role Brief from briefs/{name}.md   (or DB agent_briefs)
    → Agent's own systemPrompt
    → Company Knowledge Base              (DB-driven via knowledgeBaseLoader, or static CORE.md fallback)
    → Department context files            (context/{department}.md)
    → Founder Bulletins                   (from bulletinLoader, priority-coded)
    → Anti-patterns appended (no filler phrases, no corporate jargon, etc.)

2. TIERED CONTEXT LOADING
    → **light** (on_demand/chat): profile + pending messages + working memory only
    → **standard** (most scheduled tasks): adds KB + brief + memories + bulletins
    → **full** (briefing, orchestrate, deep analysis): everything including CI, graph, skills
    → On-demand auto-upgrades light → standard if message matches task keywords

3. PARALLEL PRE-RUN DATA LOADING
    All loaders run in parallel via Promise.all:
    → Memory retrieval (up to 20 memories + 3 reflections + 5 semantic matches)
    → Pending inter-agent messages (marked as read)
    → Pending work assignments (with directive context)
    → Collective intelligence (pulse + org knowledge + inbox) — full tier only
    → Agent personality profile — cached (5 min TTL)
    → Working memory (last-run summary for continuity)
    → Skill context (matched skills for task) — full tier only
    → Knowledge base — cached (5 min TTL)
    → Founder bulletins — cached (5 min TTL)

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

9. REFLECTION (post-run)
    → Model self-assesses: summary, quality score, what went well/could improve
    → Extracts memories (observations, learnings, facts) — saved with embeddings
    → Extracts graph operations (nodes + edges) — persisted via graphWriter
    → Extracts peer feedback — saved to agent_peer_feedback
    → Extracts skill feedback — updates proficiency via skillFeedbackWriter
    → Routes new knowledge to relevant agents via CI knowledge router
    → Saves working memory (last-run summary) for next run's context
    → Fire-and-forget for on_demand (non-blocking); awaited for scheduled runs
```

### Knowledge Injection

Every Gemini API call receives a composite system prompt built from four layers:

| Layer | Source | Size |
|-------|--------|------|
| Personality Block | `agent_profiles` table → `buildPersonalityBlock()` | ~40 lines |
| Conversation Mode | Hardcoded — casual vs task detection | ~15 lines |
| Reasoning Protocol | Hardcoded — Orient → Plan → Execute → Reflect | ~10 lines |
| Work Assignments Protocol | Hardcoded — read → work → submit/flag lifecycle | ~15 lines |
| Skill Block | `skills` + `agent_skills` tables → `buildSkillBlock()` | ~20–50 lines |
| Role Brief | `company-knowledge/briefs/{name}.md` or DB `agent_briefs` | ~80 lines |
| Agent System Prompt | `agents/src/{role}/systemPrompt.ts` | ~30 lines |
| Company Knowledge Base | DB `company_knowledge_base` (or static `CORE.md` fallback) | ~400 lines |
| Founder Bulletins | DB `founder_bulletins` (priority-coded, expiration-filtered) | variable |

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
| `skillContextLoader` | Load assigned skills and proficiency for context |
| `graphContextLoader` | Load knowledge graph neighborhood for context |

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
| `m365-admin` | `riley-morgan.md` |
| `ui-ux-designer` | `leo-vargas.md` |
| `frontend-engineer` | `ava-chen.md` |
| `design-critic` | `sofia-marchetti.md` |
| `template-architect` | `ryan-park.md` |
| `ops` | `atlas-vega.md` |

### ModelClient — Multi-Provider LLM

| Provider | Model Prefixes | Auth Env Var | Features |
|----------|---------------|--------------|----------|
| Google Gemini | `gemini-*` | `GOOGLE_AI_API_KEY` | Function calling, thinking/reasoning, thought signatures |
| OpenAI | `gpt-*`, `o1-*`, `o3-*` | `OPENAI_API_KEY` | Function calling |
| Anthropic | `claude-*` | `ANTHROPIC_API_KEY` | Tool use, thinking blocks |

All agents currently use **`gemini-3-flash-preview`**. Multi-provider support is built in for fallback.

#### Image Generation

| Provider | Model | Method | Purpose |
|----------|-------|--------|---------|
| Google Imagen | `imagen-4.0-ultra-generate-001` | `generateImage()` | High-quality infographics |
| OpenAI | `gpt-image-1` | `generateImageOpenAI()` | Text-rich infographics |

Generated images are watermarked with the Glyphor logo (bottom-right, 60% opacity) using `sharp`
before being saved to the database (`visual_image` column on `analyses` and `deep_dives` tables).

#### Gemini 3 Thought Signature Handling

Gemini 3 returns `thoughtSignature` on tool-call parts. The runtime:
1. Stores `thoughtSignature` on each `tool_call` conversation turn.
2. Batches consecutive `tool_call` turns into one `model` message with all `functionCall` parts.
3. Echoes the `thoughtSignature` back on each `functionCall` part.
4. Batches consecutive `tool_result` turns into one `user` message with `functionResponse` parts.

### Prompt Cache

In-memory TTL cache (`PromptCache` class) shared across agent runs. Avoids re-fetching
knowledge base, agent profiles, and founder bulletins on every run. 5-minute TTL; can be
manually invalidated via `POST /cache/invalidate` with optional `prefix` parameter.

Cached keys: `profile:{role}`, `kb:{department}`, `bulletin:{department}`.

### Inter-Agent Event Bus

The `GlyphorEventBus` enables reactive communication between agents. When an agent emits an
event (e.g., `insight.detected`, `alert.triggered`), the scheduler checks the subscription map
and can wake other agents in response.

Event types: `agent.completed`, `insight.detected`, `decision.filed`, `decision.resolved`,
`alert.triggered`, `task.requested`, `agent.spawned`, `agent.retired`, `message.sent`,
`meeting.called`, `meeting.completed`, `assignment.submitted`, `assignment.blocked`.

Rate limited to 10 events per agent per hour.

#### Event Emission Permissions

| Tier | Allowed Events |
|------|---------------|
| Executives | `agent.completed`, `insight.detected`, `decision.filed`, `alert.triggered`, `task.requested`, `agent.spawned`, `agent.retired`, `message.sent`, `meeting.called`, `meeting.completed`, `assignment.submitted`, `assignment.blocked` |
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

### Assignment Tools

Factory function `createAssignmentTools(supabase, glyphorEventBus)` returns three `ToolDefinition[]`
items available to all agents, closing the Sarah → agent → Sarah orchestration loop:

| Tool | Description |
|------|------------|
| `read_my_assignments` | Read pending work assignments from Sarah. Joins `work_assignments` with `founder_directives` for context. Filters by status (default: actionable). Returns instructions, expected output, priority, directive context, and feedback for revisions. |
| `submit_assignment_output` | Submit completed work for a specific assignment. Verifies ownership, updates `work_assignments`, sends notification to chief-of-staff, emits `assignment.submitted` event, logs to `activity_log`. Supports `completed` and `in_progress` statuses. |
| `flag_assignment_blocker` | Flag an assignment as blocked. Verifies ownership, sets status to `blocked`, sends urgent message to chief-of-staff with need type (tool_access, data_access, peer_help, founder_input, external_dependency, unclear_instructions, other), emits `alert.triggered` event. |

### Agent Budget Caps

Each agent role has per-run, daily, and monthly USD cost caps defined in `AGENT_BUDGETS`:

| Tier | Per Run | Daily | Monthly |
|------|---------|-------|---------|
| Executives (CoS, CFO, VP CS/Sales/Design) | $0.05 | $0.50 | $15 |
| CTO | $0.10 | $2.00 | $50 |
| CPO | $0.08 | $1.00 | $30 |
| CMO | $0.10 | $1.50 | $40 |
| Sub-team (most) | $0.02–0.05 | $0.20–0.50 | $6–12 |

### Semantic Memory & Collective Intelligence

#### EmbeddingClient (`embeddingClient.ts`)

Generates 768-dimensional vector embeddings via Google **`gemini-embedding-001`** (migrated from
deprecated `text-embedding-004`). Used by `CompanyMemoryStore.saveMemoryWithEmbedding()` and
`CollectiveIntelligenceStore` for semantic search.

| Method | Description |
|--------|------------|
| `embed(text)` | Single text → 768-dim float array |
| `embedBatch(texts)` | Parallel batch embed |

Vectors are stored in pgvector columns and searched via the `match_memories()` Postgres RPC
(cosine similarity, configurable threshold + count).

#### CollectiveIntelligenceStore (`collectiveIntelligence.ts`)

Three-layer organizational cognition system:

| Layer | Capability | Tables |
|-------|-----------|--------|
| **1 — Shared Awareness** | Company Pulse (MRR, users, platform status, mood, highlights) | `company_pulse` |
| **2 — Knowledge Circulation** | Org knowledge, knowledge inbox, knowledge routes, contradiction detection | `company_knowledge`, `knowledge_inbox`, `knowledge_routes` |
| **3 — Organizational Learning** | Process patterns, authority proposals | `process_patterns`, `authority_proposals` |

Key methods:
- `formatPulseContext()` — inject live company metrics into agent prompts
- `formatOrgKnowledgeContext(agentId)` — relevant knowledge for a specific agent
- `formatKnowledgeInboxContext(agentId)` — unread knowledge from colleagues (auto-consumed)
- `routeKnowledge(...)` — route new knowledge through matching routes (tag/type match → inbox or DM)
- `detectContradictions()` — cross-agent semantic similarity to surface conflicting facts

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

Generates downloadable documents from analysis, simulation, and CoT reports in both
Markdown (human-readable) and JSON (structured) formats.

### Chain of Thought Engine (`cotEngine.ts`)

4-phase structured reasoning engine for complex problem decomposition:

```
1. DECOMPOSE  — Break the problem into root causes and sub-problems
2. MAP        — Map solution space: approaches, constraints, trade-offs
3. ANALYZE    — Evaluate strategic options with pros/cons/feasibility
4. VALIDATE   — Logical validation: assumptions, risks, edge cases
```

Statuses: `planning`, `decomposing`, `mapping`, `analyzing`, `validating`, `completed`, `failed`.

Output: A `CotReport` containing root causes, solutions, strategic options with scores,
and validation results. Stored in `cot_analyses` table.

### Dynamic Scheduler (`dynamicScheduler.ts`)

Polls `agent_schedules` table every 60 seconds for DB-defined cron jobs. Runs alongside
static Cloud Scheduler jobs. Supports standard 5-field cron expressions with wildcards,
ranges, steps, and lists.

### Data Sync Scheduler (`dataSyncScheduler.ts`)

Internal scheduler that fires `DATA_SYNC_JOBS` on their cron schedules by POSTing to
`localhost:PORT` endpoints. Acts as a fallback when GCP Cloud Scheduler jobs haven't
been provisioned. Runs all sync jobs once on startup so data populates immediately,
then checks cron expressions every 60 seconds.

### Reactive Wake System

The wake system enables event-driven agent activation beyond scheduled cron jobs:

#### WakeRouter (`wakeRouter.ts`)

Matches incoming events against `WAKE_RULES` to determine which agents should wake.
Two dispatch modes:
- **Immediate** — Agent is executed right away (e.g., Teams bot DMs, Stripe events)
- **Next heartbeat** — Queued in `agent_wake_queue` for the next heartbeat cycle

Cooldown tracking prevents duplicate wakes within a configurable window.

#### Wake Rules (`wakeRules.ts`)

Declarative event-to-agent mappings. Examples:
- `teams_bot_dm` → wake target agent immediately
- `customer.subscription.created` → wake VP Customer Success + VP Sales (5 min cooldown)
- `dashboard_on_demand` → wake target agent immediately

Supports `$target_agent` dynamic token resolution from event data.

#### Heartbeat Manager (`heartbeat.ts`)

Lightweight periodic check-in cycle (every 10 min via `POST /heartbeat`). No LLM calls —
DB queries only. Three priority tiers:
- **High** (10 min): chief-of-staff, cto, ops
- **Medium** (20 min): other executives
- **Low** (30 min): sub-team members

Each cycle: dequeue pending `agent_wake_queue` items → dispatch agents with staggered
2-second delays → respect 5-minute minimum gap between runs.

---

## Knowledge Graph

### KnowledgeGraphWriter (`graphWriter.ts`)

Agents contribute knowledge nodes and edges during their runs via `graphTools`. The writer:
- Deduplicates nodes via semantic similarity (threshold: 0.92)
- Supports flexible node references: `this_run_node`, `find_by` (entity/title search), `node_id`
- Creates typed edges between nodes with strength and evidence

### KnowledgeGraphReader (`graphReader.ts`)

Provides graph context to agents during their runs:
- Semantic search over node embeddings
- N-hop neighborhood expansion
- Causal chain tracing (forward: "what does X impact?", backward: "what caused X?")
- Tiered context loading: light (3 nodes), standard (6 nodes), full (10 nodes)

### Node & Edge Types

11 node types: `event`, `fact`, `observation`, `pattern`, `decision`, `metric`, `entity`,
`goal`, `risk`, `action`, `hypothesis`.

10 edge types: `causes`, `precedes`, `relates_to`, `part_of`, `depends_on`, `created_by`,
`assigned_to`, `measured_by`, `mitigates`, `enables`.

### Dashboard Visualization (`Graph.tsx`)

Interactive force-directed graph on HTML5 Canvas with:
- Color-coded nodes by type, search filtering, type filtering
- Click-to-select with neighborhood highlighting
- Detail panel showing summary, metadata, tags, incoming/outgoing edges
- Theme-aware labels (reads CSS `--color-txt-primary` variable)

---

## Skill Library

### Database Tables

- `skills` — Shared skill definitions: slug, name, category, description, methodology, tools_granted, version
- `agent_skills` — Per-agent assignments: proficiency (learning → competent → expert → master), usage stats, learned refinements, failure modes
- `task_skill_map` — Task regex → skill slug routing

### 10 Skill Categories

`finance`, `engineering`, `marketing`, `product`, `customer-success`, `sales`, `design`,
`leadership`, `operations`, `analytics`.

### Dashboard Pages

- **Skills** (`/skills`) — Browse all skills, see agent assignments per skill, category badges
- **Skill Detail** (`/skills/:slug`) — Full methodology, tools granted, per-agent proficiency and usage stats

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
| `company_profile` | Company metadata (key-value) | key (unique), value (JSONB), updated_by, version |
| `products` | Product catalog | slug (unique), name, status, roadmap (JSONB), metrics (JSONB) |
| `company_agents` | Agent registry (28 columns) | role (unique), display_name, name, title, reports_to, model, temperature, max_turns, budget_per_run, budget_daily, budget_monthly, is_core, is_temporary, expires_at, thinking_enabled, last_run_summary, performance_score, total_runs, total_cost_usd |
| `decisions` | Approval queue | tier, status, title, summary, proposed_by, reasoning, assigned_to (TEXT[]), resolved_by |
| `activity_log` | Audit trail | agent_role, action, product, summary, details (JSONB), tier |

### Financial & Revenue Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `financials` | Revenue & costs time series | date, product, metric, value, details (JSONB) |
| `customer_health` | Customer scoring | user_id + product (composite PK), health_score, churn_risk, segment, builds_last_7d |
| `competitive_intel` | Market intelligence | competitor, category, summary, source_url, relevance, action_recommended |
| `product_proposals` | Feature proposals | codename, proposed_by, description, target_market, tam_estimate, financial_model, decision_id → decisions |
| `stripe_data` | Stripe records | record_type, customer_id, product, plan, amount_usd, status, cohort_month, channel |

### Infrastructure & Cost Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `gcp_billing` | GCP cost tracking | service, cost_usd, usage (JSONB), recorded_at |
| `infrastructure_metrics` | Infra health metrics | provider, service, metric_type, value, unit, recorded_at |
| `cost_metrics` | Unit economics | unit_type, cost_usd, volume, period, recorded_at |

### Agent Identity & Performance Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `agent_profiles` | Personality profiles | agent_id → company_agents, personality_summary, backstory, communication_traits, quirks, tone_formality, emoji_usage, verbosity, voice_sample, signature, voice_examples (JSONB), clifton_strengths, working_style |
| `agent_performance` | Daily performance stats | agent_id + date (unique), total_runs, successful_runs, failed_runs, avg_duration_ms, avg_quality_score, total_cost, total_input_tokens, total_output_tokens, decisions_filed/approved/rejected |
| `agent_milestones` | Achievement tracking | agent_id, type, title, description, quality_score |
| `agent_growth` | Growth dimensions | agent_id + dimension (unique), direction, current_value, previous_value, period, evidence |
| `agent_peer_feedback` | Peer evaluations | from_agent, to_agent, feedback, context, sentiment |
| `agent_runs` | Individual run log | agent_id, task, status, duration_ms, cost, input_tokens, output_tokens, tool_calls, turns, error |
| `agent_activities` | Activity stream | agent_role, activity_type, summary, details |

### Agent Intelligence Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `agent_memory` | Persistent memories (with pgvector) | agent_role, memory_type, content, importance, tags, embedding (vector 768-dim), graph_node_id → kg_nodes |
| `agent_reflections` | Post-run reflections | agent_role, run_id, summary, quality_score, what_went_well, what_could_improve, prompt_suggestions, knowledge_gaps |
| `agent_briefs` | Dynamic agent briefs | agent_id (PK), system_prompt, skills, tools |
| `agent_schedules` | DB-defined cron jobs | agent_id, cron_expression, task, payload (JSONB), enabled |
| `metrics_cache` | Cached metrics | service, metric, value, labels (JSONB), timestamp |
| `cot_analyses` | Chain-of-thought analyses | id, query, status, requested_by, report (JSONB), completed_at, error |

### Communication Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `agent_messages` | Inter-agent DMs | from_agent, to_agent, thread_id, message, message_type, priority, status, response, responded_at |
| `agent_meetings` | Multi-agent meetings | called_by, title, purpose, meeting_type, attendees, status, rounds, contributions, transcript, summary, action_items, decisions_made, escalations, total_cost |
| `chat_messages` | Founder ↔ agent chat | agent_role, role (user/agent), content, created_at |

### Strategy Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `analyses` | Strategic analyses | type (5 types), query, depth, status (6 phases), threads (JSONB), report (JSONB), requested_by, visual_image (TEXT — base64 PNG infographic) |
| `simulations` | T+1 simulations | action, perspective (optimistic/neutral/pessimistic), status (9 states), dimensions, report, accepted_at, accepted_by |
| `deep_dives` | Deep dive research | target, context, status (6 phases), research_areas, sources, report, requested_by, visual_image (TEXT — base64 PNG infographic) |

### Collective Intelligence Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `company_pulse` | Live company metrics snapshot (singleton) | mrr, mrr_change_pct, active_users, new_users_today, churn_events_today, platform_status, uptime_streak_days, active_incidents, decisions_pending, meetings_today, messages_today, highlights (JSONB), company_mood |
| `company_knowledge` | Org-wide knowledge base (semantic) | knowledge_type (7 types), content, confidence, embedding (vector 768-dim), discovered_by, contributing_agents, departments_affected, agents_who_need_this, times_validated, times_contradicted, status, superseded_by |
| `knowledge_inbox` | Pending knowledge deliveries | target_agent, knowledge_id, source_agent, content, status |
| `knowledge_routes` | Auto-routing rules | source_agent, source_tags, source_type, target_agents, target_departments, delivery_method (inject/message/alert) |
| `process_patterns` | Discovered organizational patterns | pattern_type (6 types), description, evidence, frequency, impact_type, impact_magnitude, suggested_action, action_type, implemented, agents_involved, departments_involved |
| `authority_proposals` | Tier elevation proposals | agent_id, current_tier, proposed_tier, action, evidence, success_count, total_count, approval_rate, avg_wait_hours, negative_outcomes, status |

### Founder Orchestration Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `founder_directives` | Founder work directives | created_by, title, description, priority (critical/high/medium/low), category (8 categories), target_agents, department, status, due_date, progress_notes, completion_summary |
| `work_assignments` | Directive task assignments | directive_id → founder_directives, assigned_to, task_description, task_type, expected_output, priority, depends_on (UUID[]), sequence_order, status (6 states), agent_output, evaluation, quality_score |

### Operations Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `events` | System event bus | type, source, timestamp, payload (JSONB), priority, processed_by (TEXT[]), correlation_id |
| `data_sync_status` | Sync health tracking | id (text PK), status, last_success_at, last_failure_at, last_error, consecutive_failures |
| `incidents` | Incident management | severity, title, description, affected_agents, status, root_cause, resolution, created_by |
| `system_status` | System health snapshots | status, summary, details, agent_health (JSONB), data_freshness (JSONB), cost_anomalies (JSONB) |
| `agent_wake_queue` | Reactive wake queue | agent_role, task, reason, context (JSONB), status (pending/dispatched/completed), dispatched_at |

### Knowledge Graph Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `kg_nodes` | Graph nodes (with pgvector) | node_type, title, content, created_by, confidence, department, importance, embedding (vector 768-dim), tags, status, occurred_at, valid_from, valid_until, source_run_id, metadata (JSONB) |
| `kg_edges` | Graph edges | source_id → kg_nodes, target_id → kg_nodes, edge_type, strength, confidence, evidence, valid_from, valid_until, UNIQUE(source_id, target_id, edge_type) |

RPCs: `match_kg_nodes`, `kg_trace_causes`, `kg_trace_impact`, `kg_neighborhood`, `kg_semantic_search_with_context`, `find_unconnected_similar_nodes`.

### Skill Library Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `skills` | Shared skill definitions | slug (unique), name, category, description, methodology, tools_granted, version |
| `agent_skills` | Per-agent assignments | agent_role → company_agents, skill_id → skills, proficiency (learning/competent/expert/master), times_used, successes, failures, learned_refinements, failure_modes |
| `task_skill_map` | Task → skill routing | task_regex, skill_slug → skills, priority |

### Marketing & Content Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `content_drafts` | Content pipeline | type, title, content, platform, tags, meta_description, media_url, campaign_type, status, author |
| `content_metrics` | Content performance | content_type, title, url, platform, views, shares, engagement, conversions, clicks |
| `seo_data` | SEO intelligence | metric_type, keyword, url, position, search_volume, difficulty, clicks, impressions, ctr |
| `scheduled_posts` | Social media queue | profile_id, text, platform, scheduled_at, media_url, status, buffer_id, agent |
| `social_metrics` | Social performance | metric_type, platform, followers, engagement, reach, impressions, clicks, demographics (JSONB) |
| `email_metrics` | Email campaign tracking | campaign_type, template_name, subject, sends, opens, clicks, unsubscribes, bounces, open_rate, click_rate |
| `experiment_designs` | A/B test designs | agent, hypothesis, variant_description, primary_metric, duration, status, results (JSONB) |

### Sales & Research Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `company_research` | Target company intel | name, domain, source, content (JSONB) |
| `contact_research` | Contact enrichment | company, name, title, email, linkedin, source |
| `account_dossiers` | Account summaries | company, domain, summary, opportunity_estimate, buying_signals, compiled_by |
| `analytics_events` | Product analytics events | user_id, event_type, channel, plan, template_id, properties (JSONB) |

### Support Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `support_tickets` | Support ticket tracking | external_id (unique), subject, body, status, priority, category, customer_email, classified_by, escalated_to |
| `support_responses` | Ticket responses | ticket_id → support_tickets, message, kb_articles, status, author |
| `knowledge_base` | Support KB articles | title, content, category, tags, views, helpful |

### Platform Governance Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `platform_iam_state` | IAM state tracking | platform (gcp/m365/github/stripe/vercel) + credential_id (unique), agent_role, permissions (JSONB), desired_permissions, in_sync, drift_details |
| `platform_audit_log` | Platform action audit | agent_role, platform, action, resource, request_payload, response_code, response_summary, cost_estimate |
| `platform_secret_rotation` | Secret lifecycle | platform + secret_name (unique), expires_at, rotated_at, status (active/expiring/expired/rotated) |

### Knowledge Management Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `company_knowledge_base` | Editable knowledge sections | section (unique), title, content, audience (10 roles), last_edited_by, version, is_active |
| `founder_bulletins` | Founder announcements | created_by, content, audience, priority (fyi/normal/important/urgent), active_from, expires_at, is_active |

### Working Memory

Working memory (last-run summary) is stored in the `company_agents` table via the
`last_run_summary` and `last_run_at` columns — not a separate table. This enables
continuity between runs without additional migration.

Total: **35+ migration files**, **70+ tables**, **9 RPC functions**, **1 extension (pgvector)**.

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
| Secret Manager | 25+ secrets | API keys, credentials, channel IDs, bot configs |
| Artifact Registry | `us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/` | Docker images |
| Cloud Storage | `glyphor-company` bucket | Briefings, reports, specs |
| BigQuery | `billing_export` dataset | GCP billing export data |
| Azure | Resource group `glyphor-resources` (centralus) | Bot registrations, Entra apps |

### External Services

| Service | Purpose | Config |
|---------|---------|--------|
| Supabase | PostgreSQL, auth, realtime | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| Google Gemini API | All AI inference | `GOOGLE_AI_API_KEY` |
| Microsoft Entra ID | Teams auth (MSAL client credentials) | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` |
| Azure Bot Service | Bot Framework (main + 8 agent bots) | `BOT_APP_ID`, `BOT_APP_SECRET`, `BOT_TENANT_ID`, `AGENT_BOTS` |
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
| Auth | Teams SSO (`@microsoft/teams-js`) in Teams tab; Google Sign-In (OAuth 2.0) in browser |
| Hosting | nginx:1.27-alpine on Cloud Run |
| API | Supabase client (direct) + Scheduler `/run` |

### Pages

| Page | Route | Function |
|------|-------|----------|
| Dashboard | `/` | Agent activity overview, key metrics |
| Chat | `/chat`, `/chat/:agentId` | Multi-turn conversational agent chat with history |
| Group Chat | `/group-chat` | Multi-agent group chat |
| Workforce | `/workforce` | Org chart (7 departments) + grid view — 28 total headcount |
| Workforce Builder | `/workforce/builder` | Drag-and-drop org chart builder with templates |
| Agents | `/agents` | Agent roster with status, model, last run |
| Agent Profile | `/agents/:agentId` | 5-tab profile: Overview (personality, backstory, strengths), Performance (quality scores, growth areas, peer feedback), Memory (memories + reflections), Messages (DMs + meeting participation), Settings (model, temperature, budget, system prompt) |
| Agent Builder | `/agents/new` | Create new dynamic agents with name, department, model, budget, cron |
| Agent Settings | `/agents/:agentId/settings` | Agent configuration & system prompt editing |
| Approvals | `/approvals` | Pending decision queue — approve/reject |
| Directives | `/directives` | Founder directives management — create, assign, track work assignments |
| Financials | `/financials` | Revenue (Stripe MRR), costs (GCP billing), cash (Mercury), vendor subscriptions |
| Governance | `/governance` | Platform IAM state, secret rotation status, audit log |
| Knowledge | `/knowledge` | Company knowledge base sections, founder bulletins |
| Operations | `/operations` | System operations & autonomous events |
| Activity | `/activity` | Live running-now banner, filterable run history table, real-time Supabase subscriptions |
| Strategy | `/strategy` | Strategic analysis engine (5 analysis types) + T+1 simulation engine with impact matrix + AI-generated infographics |
| Graph | `/graph` | Interactive force-directed knowledge graph (HTML5 Canvas) with search, type filtering, neighborhood highlighting |
| Skills | `/skills` | Skill library browser (10 categories), create new skills |
| Skill Detail | `/skills/:slug` | Skill detail + agent assignments + proficiency stats |
| Meetings | `/meetings` | Meeting timeline with transcripts, action items, decisions, escalations; recent message feed |
| Teams Config | `/teams-config` | Teams bot setup and configuration |

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

Runtime also includes `sharp` (native image processing) for watermarking AI-generated infographics
with the Glyphor logo, and copies `glyphor-logo.png` into the container for compositing.

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

### Inter-Agent Direct Message

```
Agent A (during run) calls send_agent_message("cfo", "Need Q3 cost data")
  → communicationTools validates rate limit (5/hr per agent)
  → INSERT into agent_messages (status: 'pending', priority: 'normal')
  → Agent A continues its run (fire-and-forget)

  ... next CFO run ...
  → pendingMessageLoader queries agent_messages WHERE to_agent='cfo' AND status='pending'
  → Messages injected into system prompt: "📨 Pending Messages: ..."
  → CFO processes and responds via send_agent_message()
  → Original message status → 'read'
```

### Multi-Agent Meeting

```
Agent calls call_meeting({title:"Sprint Planning", attendees:["cto","cpo","vp-design"]})
  → communicationTools validates rate limit (2/day per agent, 10/day system-wide)
  → POST /meetings/start → MeetingEngine.startMeeting()
  → INSERT agent_meetings (status: 'in_progress', rounds: [])

  For each round (1..max_rounds):
    → For each attendee:
      → Run agent with meeting context + previous contributions
      → Append contribution to rounds array
    → Check convergence (did agents agree? new action items?)

  After final round:
    → Sarah (chief-of-staff) synthesizes all contributions
    → Extract: summary, action_items, decisions_made, escalations
    → UPDATE agent_meetings SET status='completed', summary=..., action_items=...
    → Dispatch action items as pending messages to responsible agents
```

### Strategic Analysis

```
Dashboard → POST /analysis/run {type:"competitive_landscape", query:"AI market position", depth:"standard"}
  → AnalysisEngine.runAnalysis()
  → Phase 1 PLAN: Break into 4 research threads
  → Phase 2 SPAWN: agentLifecycle creates 4 temporary agents
      → INSERT company_agents (is_temporary=true, expires_at=now+1h)
      → INSERT agent_briefs with specialized prompts
  → Phase 3 EXECUTE: Run each temp agent on its thread in parallel
      → Each agent produces findings + evidence + confidence
  → Phase 4 SYNTHESIZE: Sarah merges findings into structured report
      → Executive summary, key findings, recommendations, risk factors
  → Phase 5 CLEANUP: agentLifecycle retires temp agents
      → UPDATE company_agents SET status='retired'
  → reportExporter generates Markdown + JSON
  → Response: { report, threads, metadata }
  → Strategy.tsx renders interactive report with collapsible threads
```

---

## Security

| Area | Implementation |
|------|---------------|
| API Keys | GCP Secret Manager → env vars at Cloud Run deploy (`--update-secrets`, merge mode) |
| Dashboard Auth | Teams SSO (`@microsoft/teams-js` + Entra ID) in Teams tab; Google OAuth 2.0 in browser |
| Bot Auth | JWT validation via `jose` — JWKS from Bot Framework and Entra ID OpenID endpoints, multi-audience support |
| Supabase | Service key server-side; anon key client-side with RLS |
| Teams Auth | MSAL client credentials (app-only) for Graph API; Bot Framework tokens for bot replies |
| Azure Entra ID | SingleTenant app registrations — 1 main + 8 agent bots, all with client secrets in GCP Secret Manager |
| CORS | Scheduler allows `*` for dashboard |
| Network | Scheduler: `--allow-unauthenticated` (for Bot Framework callbacks); Dashboard: `--allow-unauthenticated` |
| IAM | `allUsers` → `roles/run.invoker` on scheduler |
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

Deployment is handled by GitHub Actions CI/CD (`.github/workflows/deploy.yml`) on push to `main`. Key points:
- Uses `--update-secrets` (merge mode) — only listed secrets are updated, existing ones preserved
- Uses `--update-env-vars` (merge mode) — same merge behavior for env vars
- Current secrets: 25+ total (AI keys, Supabase, Azure/Teams, Bot Framework, Stripe, Mercury)
- Dashboard build args baked at Docker build time (`VITE_*` vars)

#### CI/CD Pipeline

```
push to main
  → build job: npm ci → turbo build (6 packages)
  → deploy-scheduler job:
      → Auth via Workload Identity Federation
      → Docker build + push to Artifact Registry
      → gcloud run deploy with --update-secrets (23 secrets)
  → deploy-dashboard job:
      → Docker build with VITE_* build args + push
      → gcloud run deploy --allow-unauthenticated
```

#### GCP Secrets (Scheduler)

| Secret | Purpose |
|--------|---------|
| `google-ai-api-key` | Gemini API |
| `openai-api-key` | OpenAI fallback |
| `anthropic-api-key` | Anthropic fallback |
| `supabase-url`, `supabase-service-key` | Database |
| `gcs-bucket` | Cloud Storage |
| `azure-tenant-id`, `azure-client-id`, `azure-client-secret` | Graph API (MSAL) |
| `teams-team-id` | Teams team |
| `teams-channel-*-id` (9 secrets) | Teams channels |
| `bot-app-id`, `bot-app-secret`, `bot-tenant-id` | Main bot |
| `agent-bots` | JSON array of 8 agent bot configs |

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

# Glyphor AI Company — System Architecture

> Last updated: 2026-03-14 (World model self-assessment, default-ON thinking for chat, SharePoint search/upload fixes, model tiering documentation)

## Overview

Glyphor AI Company is a monorepo containing 44 AI agents (9 executives, 7 research,
19 sub-team, 2 operations, 7 specialists) that autonomously operate Glyphor alongside two human founders
(Kristina Denney, CEO; Andrew Zwelling, COO). The agents run 24/7 on GCP Cloud Run, share
state through Cloud SQL (with multi-tenant row-level security), communicate with founders via
Microsoft Teams, and are governed by a three-tier authority model (Green / Yellow / Red).

Total headcount: **46** — 2 human founders, 9 AI executives (8 reporting to CoS + 1 CLO
reporting directly to founders), 1 VP, 6 research analysts, 19 AI team members, 2 AI ops agents,
7 AI specialist agents (DB-defined, no file-based runners).

The founders work full-time at Microsoft with 5-10 h/week for Glyphor. The AI executive team
handles everything else: daily operations, financial monitoring, content creation, product
analysis, customer success, enterprise sales research, design & frontend quality,
cross-functional synthesis, inter-agent communication, strategic analysis, legal & compliance,
market research & intelligence, global platform administration, tax strategy, data integrity
auditing, lead generation, and executive assistantship.

---

## High-Level Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                      GCP Cloud Scheduler                             │
│  37 agent cron jobs → Pub/Sub topic "glyphor-agent-tasks"            │
│  9 data sync + utility jobs → HTTP POST to scheduler endpoints       │
│  + Dynamic Scheduler (DB-defined cron from agent_schedules table)    │
│  + Data Sync Scheduler (internal cron for sync jobs when GCP CS      │
│    hasn't been provisioned)                                          │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ Pub/Sub push + HTTP
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│             Scheduler Service (Cloud Run: glyphor-scheduler)         │
│                                                                      │
│  POST /api/*           ── Dashboard CRUD via dashboardApi.ts         │
│  POST /pubsub            ── Cloud Scheduler cron messages            │
│  POST /run               ── Dashboard chat & manual invocations      │
│  POST /event             ── Glyphor Event Bus (inter-agent events)   │
│  POST /api/teams/messages── Teams Bot Framework webhook (JWT)         │
│  POST /webhook/stripe    ── Stripe webhook receiver                  │
│  POST /sync/stripe       ── Stripe data sync                        │
│  POST /sync/gcp-billing  ── GCP billing export sync                 │
│  POST /sync/mercury      ── Mercury banking sync                    │
│  POST /sync/openai-billing ── OpenAI billing sync                    │
│  POST /sync/anthropic-billing ── Anthropic billing sync              │
│  POST /sync/kling-billing ── Kling AI billing sync                   │
│  POST /sync/sharepoint-knowledge ── SharePoint knowledge ingest sync │
│  POST /sync/governance   ── Governance platform sync                 │
│  POST /sync/graphrag-index ── GraphRAG index trigger                 │
│  POST /sync/graphrag-tune ── GraphRAG tuning trigger                 │
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
│  POST /analysis/:id/cancel── Cancel in-progress analysis            │
│  POST /analysis/:id/enhance── Executive-grade analysis enhancement   │
│  GET  /analysis/:id/visual── Get saved AI-generated infographic     │
│  POST /analysis/:id/visual── Generate & save AI infographic         │
│  POST /simulation/run    ── Launch T+1 simulation                   │
│  GET  /simulation/:id    ── Get simulation status/result            │
│  GET  /simulation        ── List all simulations                    │
│  POST /simulation/:id/accept ── Accept simulation result            │
│  GET  /simulation/:id/export ── Export simulation report (md/json)  │
│  POST /deep-dive/run     ── Launch strategic deep dive          │
│  GET  /deep-dive         ── List all deep dives                     │
│  GET  /deep-dive/:id     ── Get deep dive status/result             │
│  POST /deep-dive/:id/cancel── Cancel in-progress deep dive          │
│  GET  /deep-dive/:id/export── Export deep dive report (md/json)     │
│  GET  /deep-dive/:id/visual── Get saved deep dive infographic       │
│  POST /deep-dive/:id/visual── Generate & save deep dive infographic │
│  POST /strategy-lab/run  ── Launch Strategy Lab v2 analysis          │
│  GET  /strategy-lab      ── List all strategy lab analyses           │
│  GET  /strategy-lab/:id  ── Get strategy lab status/result           │
│  POST /strategy-lab/:id/cancel── Cancel strategy lab analysis        │
│  GET  /strategy-lab/:id/export── Export strategy lab report          │
│  GET  /strategy-lab/:id/visual── Get strategy lab infographic        │
│  POST /strategy-lab/:id/visual── Generate strategy lab infographic   │
│  GET  /agents/:id/system-prompt ── Get agent system prompt           │
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
│  GET  /directives        ── List founder directives                  │
│  POST /directives        ── Create founder directive                 │
│  PATCH /directives/:id   ── Update directive                         │
│  DELETE /directives/:id  ── Delete directive                         │
│  GET  /authority/proposals── Authority tier proposals                │
│  POST /authority/proposals/:id/resolve── Resolve authority proposal  │
│  GET  /health            ── Health check                             │
│  OPTIONS /*              ── CORS preflight                           │
│                                                                      │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐   │
│  │ Cron Manager │  │ Event Router  │  │    Authority Gates       │   │
│  │ (35+9 static │  │ route()       │  │ checkAuthority(role,act) │   │
│  │  + dynamic)  │  │ handlePubSub()│  │ GREEN per-role           │   │
│  └──────────────┘  │ handleAgent() │  │ YELLOW → one founder     │   │
│  ┌──────────────┐  │ handleEvent() │  │ RED    → both founders   │   │
│  │ Analysis     │  └───────┬───────┘  └────────────┬─────────────┘   │
│  │ Engine       │          │                       │                 │
│  ├──────────────┤          ▼                       ▼                 │
│  │ Simulation   │ ┌────────────────┐    ┌─────────────────────┐      │
│  │ Engine       │ │ Agent Executor │    │  Decision Queue     │      │
│  ├──────────────┤ │ (role→runner)  │    │  submit / approve   │      │
│  │ Meeting      │ │ (44 agent      │    │  reminders (4 h)    │      │
│  │ Engine       │ │  roles routed) │    └─────────┬───────────┘      │
│  ├──────────────┤ └────────┬───────┘              │                 │
│  │ CoT Engine   │          │                      │                 │
│  ├──────────────┤          │                      │                 │
│  │ Deep Dive    │          │                      │                 │
│  │ Engine       │          │                      │                 │
│  ├──────────────┤          │                      │                 │
│  │ Strategy Lab │          │                      │                 │
│  │ v2 Engine    │          │                      │                 │
│  ├──────────────┤          │                      │                 │
│  │ Wake Router  │          │                      │                 │
│  │ + Heartbeat  │          │                      │                 │
│  │ + Parallel   │          │                      │                 │
│  │   Dispatch   │          │                      │                 │
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
│  │   createRunner() Factory    │  │  │  9 channels in Glyphor team: │
│  │   ┌───────────────────────┐ │  │  │  #kristina-briefings        │
│  │   │ OrchestratorRunner    │ │  │  │  #andrew-briefings          │
│  │   │  (5 exec roles:       │ │  │  │  #decisions                 │
│  │   │   cos,cto,clo,vp-r,   │ │  │  │  #engineering               │
│  │   │   ops)                │ │  │  │  #growth                    │
│  │   ├───────────────────────┤ │  │  │  #financials                │
│  │   │ TaskRunner            │ │  │  │  #glyphor-general           │
│  │   │  (29 task roles)      │ │  │  │  #product-fuse              │
│  │   ├───────────────────────┤ │  │  │  #product-pulse             │
│  │   │ CompanyAgentRunner    │ │  │  │                              │
│  │   │  (on_demand chat)     │ │  │  │  Adaptive Cards:            │
│  │   └───────────────────────┘ │  │  │  ├ Briefing card            │
│  │   ├─ ModelClient            │  │  │  ├ Decision card             │
│  │   │  (Gemini/OpenAI/Claude) │  │  │  └ Alert card                │
│  │   ├─ AgentSupervisor        │  │  │                              │
│  │   ├─ ToolExecutor           │  │  │                              │
│  │   ├─ EventBus               │  │  │                              │
│  │   ├─ GlyphorEventBus       │  │  │                              │
│  │   ├─ PendingMessageLoader  │  │  │                              │
│  │   ├─ PendingAssignmentLoader│ │  │                              │
│  │   ├─ WorkingMemoryLoader   │  │  │                              │
│  │   ├─ PromptCache (5 min)   │  │  │                              │
│  │   ├─ SharedMemoryLoader    │  │  │                              │
│  │   ├─ WorldModelUpdater     │  │  │                              │
│  │   └─ AgentProfileLoader    │  │  │                              │
│  └─────────────────────────────┘  │  └──────────────────────────────┘
│                                   │
│  Shared agent tools:              │
│   ├─ coreTools (11 always-loaded  │
│   │  tools: assignments, comms,   │
│   │  memory, tool-requests, events│
│   │  — extracted via coreTools.ts)│
│   ├─ glyphorMcpTools (bridge to   │
│   │  9 Glyphor MCP servers via    │
│   │  JSON-RPC 2.0 — ~81 tools)   │
│   ├─ dynamicToolExecutor (runtime │
│   │  executor for DB-registered   │
│   │  tools via tool_registry)     │
│   ├─ memoryTools (save/recall)    │
│   ├─ eventTools (emit events)     │
│   ├─ communicationTools           │
│   │  (send_message, check_msgs,   │
│   │   call_meeting)               │
│   ├─ assignmentTools              │
│   │  (read_my_assignments,        │
│   │   submit_assignment_output +  │
│   │   dependency resolution,      │
│   │   flag_assignment_blocker)    │
│   ├─ graphTools                   │
│   │  (query_knowledge_graph,      │
│   │   add_knowledge, trace_*)     │
│   ├─ collectiveIntelligenceTools  │
│   │  (pulse, knowledge routing,   │
│   │   patterns, contradictions)   │
│   ├─ emailTools (via MCP:         │
│   │  send_email, read_inbox,      │
│   │   reply_to_email —            │
│   │   plain-text enforced)        │
│   ├─ agentCreationTools           │
│   │  (create_specialist_agent,    │
│   │   list/retire created agents) │
│   ├─ toolRequestTools             │
│   │  (request_tool_access,        │
│   │   request_new_tool,           │
│   │   check_tool_request_status)  │
│   └─ researchTools                │
│      (web_search, web_fetch,      │
│       submit_research_packet)     │
│                                   │
│  documentExtractor.ts             │
│   (Office doc text extraction)    │
│  config/agentEmails.ts            │
│   (44 agent email registry)      │
└───────────────┬───────────────────┘
                │
                ▼
┌───────────────────────────────────┐  ┌──────────────────────────────┐
│        Company Memory             │  │   External Integrations      │
│  ┌─────────────────────────────┐  │  │                              │
│  │ Cloud SQL (PostgreSQL)      │  │  │  Stripe     — MRR, churn    │
│  │  ├ company_profile          │  │  │  Mercury    — banking, cash  │
│  │  ├ products                 │  │  │  GCP        — billing export │
│  │  ├ company_agents (28 cols) │  │  │  Anthropic  — billing/usage  │
│  │  ├ decisions                │  │  │  OpenAI     — billing/usage  │
│  │  ├ activity_log             │  │  │  Kling AI   — video billing  │
│  │  ├ competitive_intel        │  │  │  Vercel     — deployments    │
│  │  ├ customer_health          │  │  │  Web Search — OpenAI API     │
│  │  ├ financials               │  │  │  Credentials— GitHub/M365   │
│  │  ├ product_proposals        │  │  │  Governance — IAM sync      │
│  │  ├ events                   │  │  │  Pulse      — company pulse │
│  │  ├ agent_memory (pgvector)  │  │  │  Audit      — platform logs │
│  │  ├ agent_reflections        │  │  │                              │
│  │  ├ agent_profiles           │  │  └──────────────────────────────┘
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
│  │  ├ agent_world_model        │  │
│  │  ├ role_rubrics             │  │
│  │  ├ shared_episodes          │  │
│  │  ├ shared_procedures        │  │
│  │  ├ platform_iam_state       │  │
│  │  ├ platform_audit_log       │  │
│  │  └ ... (86 tables total)    │  │
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
│   ├ Chat.tsx         (1:1 agent chat)    │
│   ├ GroupChat.tsx    (multi-agent chat)   │
│   ├ Comms.tsx        (Chat+Meetings hub) │
│   ├ Workforce.tsx    (org chart + roster)│
│   ├ WorkforceBuilder.tsx (org builder)   │
│   ├ AgentsList.tsx   (agent roster)      │
│   ├ AgentProfile.tsx (identity, perf,    │
│   │                   memory, messages,  │
│   │                   skills, world      │
│   │                   model, settings,   │
│   │                   avatar upload)     │
│   ├ AgentBuilder.tsx (create new agents) │
│   ├ Approvals.tsx    (decision queue)    │
│   ├ ChangeRequests.tsx (change requests) │
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
│   ├ Capabilities.tsx (skills+self-models)│
│   ├ Meetings.tsx     (meetings & DMs)    │
│   ├ Settings.tsx     (user management)   │
│   ├ TeamsConfig.tsx  (Teams bot setup)   │
│   └ WorldModel.tsx   (agent self-models) │
│                                           │
│   Auth: Teams SSO (Entra ID) or Google   │
│         Sign-In (OAuth 2.0)               │
│   API: dashboardApi.ts CRUD + Scheduler   │
│         /run (PostgREST-compatible, 70+   │
│         whitelisted tables)               │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  Voice Gateway (Cloud Run: voice-gateway) │
│  TypeScript — OpenAI Realtime API         │
│                                           │
│  Endpoints:                               │
│  POST /voice/dashboard      — WebRTC      │
│  POST /voice/dashboard/end  — End session │
│  POST /voice/teams/join     — Join call   │
│  POST /voice/teams/leave    — Leave call  │
│  POST /voice/teams/callback — Graph CB    │
│  GET  /voice/sessions       — Active list │
│  GET  /voice/usage          — Usage stats │
│  GET  /health               — Health      │
│                                           │
│  10 OpenAI voices: alloy, ash, ballad,    │
│  coral, echo, sage, shimmer, verse,       │
│  marin, cedar                             │
│                                           │
│  Teams Meeting Integration:               │
│  ├ acsMediaClient.ts — ACS REST API for   │
│  │  bidirectional media streaming (HMAC)  │
│  ├ audioResampler.ts — PCM16 sample rate  │
│  │  conversion: 16kHz⇄24kHz              │
│  ├ calendarWatcher.ts — Auto-joins Teams  │
│  │  meetings (polling + Graph webhooks)   │
│  └ teamsAudioBridge.ts — Bidirectional    │
│     audio: ACS WS ⇄ OpenAI Realtime WS   │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  GraphRAG Indexer (Python)                │
│  Microsoft GraphRAG + Gemini extraction   │
│                                           │
│  Modules:                                 │
│  ├ collector.py  — gather source docs     │
│  ├ extractor.py  — entity extraction      │
│  ├ bridge.py     — sync to Cloud SQL      │
│  ├ tune.py       — auto-tune prompts      │
│  ├ index.py      — run indexing pipeline  │
│  ├ server.py     — HTTP API               │
│  └ config.py     — configuration          │
│                                           │
│  CLI: python -m graphrag_indexer.index    │
│       python -m graphrag_indexer.tune     │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  Worker Service (Cloud Run: glyphor-      │
│  worker) — GCP Cloud Tasks Processor      │
│                                           │
│  Endpoints:                               │
│  POST /run      — Execute agent (tenant + │
│                   role + task + metadata)  │
│  POST /deliver  — Deliver agent output to │
│                   platform/channel         │
│  POST /health   — DB health check         │
│                                           │
│  Queues:                                  │
│  agent-runs          — Standard agent runs │
│  agent-runs-priority — Priority agent runs │
│  delivery            — Output delivery     │
│                                           │
│  Uses OIDC auth + base64 JSON payloads.   │
│  Runs with jitter (0-30s) for load spread.│
└──────────────────────────────────────────┘
```

---

## Agent Roster

### AI Executives (9)

All 9 executives have full agent runners (`run.ts`, `systemPrompt.ts`, `tools.ts`) and are
active 24/7 via the scheduler service. Models are assigned by `optimizeModel()` — see
[ModelClient](#modelclient--multi-provider-llm) for the full tiered model system.

| Name | Role | Agent ID | Model (Tier) | Responsibilities |
|------|------|----------|-------|-----------------|
| **Sarah Chen** | Chief of Staff | `chief-of-staff` | `gemini-3-flash-preview` (Pro) | Morning briefings, decision routing, cross-agent synthesis, escalation tracking, EOD summaries, pre-dispatch validation |
| **Marcus Reeves** | CTO | `cto` | `gemini-3-flash-preview` (Pro) | Platform health, deployment management, model fallbacks, incident response, dependency review |
| **Nadia Okafor** | CFO | `cfo` | `gemini-3-flash-preview` (Pro) | Daily cost monitoring, revenue tracking, margin analysis, unit economics, budget alerts |
| **Elena Vasquez** | CPO | `cpo` | `gemini-3-flash-preview` (Pro) | Usage analysis, competitive intelligence, roadmap management, feature prioritisation (RICE) |
| **Maya Brooks** | CMO | `cmo` | `gemini-3-flash-preview` (Pro) | Content generation, social media, SEO strategy, brand positioning, growth analytics |
| **James Turner** | VP Customer Success | `vp-customer-success` | `gemini-2.5-flash` (Standard) | Health scoring, churn prevention, nurture outreach, cross-product recommendations |
| **Rachel Kim** | VP Sales | `vp-sales` | `gemini-2.5-flash` (Standard) | KYC research, ROI calculators, enterprise proposals, pipeline management, market sizing |
| **Mia Tanaka** | VP Design & Frontend | `vp-design` | `gemini-2.5-flash` (Standard) | Design system governance, component quality audits, template variety, AI-smell detection |
| **Victoria Chase** | Chief Legal Officer | `clo` | `gemini-3-flash-preview` (Pro) | AI regulation (EU AI Act, FTC), IP protection, commercial agreements, data privacy (GDPR, CCPA, SOC 2), corporate governance |

> **Note:** Victoria Chase (CLO) reports directly to both founders, not through Sarah Chen.

### VP & Research Team (7)

| Name | Title | Agent ID | Department | Reports To |
|------|-------|----------|------------|------------|
| **Sophia Lin** | VP Research & Intelligence | `vp-research` | Research & Intelligence | Sarah Chen (CoS) |
| **Lena Park** | Competitive Research Analyst | `competitive-research-analyst` | Research & Intelligence | Sophia Lin |
| **Daniel Okafor** | Market Research Analyst | `market-research-analyst` | Research & Intelligence | Sophia Lin |
| **Kai Nakamura** | Technical Research Analyst | `technical-research-analyst` | Research & Intelligence | Sophia Lin |
| **Amara Diallo** | Industry Research Analyst | `industry-research-analyst` | Research & Intelligence | Sophia Lin |
| **Riya Mehta** | AI Impact Analyst | `ai-impact-analyst` | Research & Intelligence | Sophia Lin |
| **Marcus Chen** | Organizational & Talent Analyst | `org-analyst` | Research & Intelligence | Sophia Lin |

The Research & Intelligence department uses a multi-wave workflow: Sarah Chen requests research →
Sophia decomposes into analyst briefs → analysts execute in parallel with web search → Sophia QCs
and synthesizes → executive-ready brief delivered. Supported by the `merge_research_packet` RPC.

Research packet types (15 schemas in `packetSchemas.ts`): CompetitorProfiles, MarketData,
TechnicalLandscape, IndustryTrends, CompanyProfile, StrategicDirection, and more.

### Sub-Team Members (19)

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
| **Jasmine Rivera** | Head of HR | People & Culture | Sarah Chen (CoS) |

### Operations Agents (2)

| Name | Role | Agent ID | Model (Tier) | Responsibilities |
|------|------|----------|-------|-----------------|
| **Atlas Vega** | Operations & System Intelligence | `ops` | `gemini-3-flash-preview` (Pro) | System health checks, data freshness monitoring, cost awareness, morning/evening status reports, event response |
| **Morgan Blake** | Global Administrator | `global-admin` | `gemini-2.5-flash-lite` (Economy) | Cross-platform access provisioning (GCP, Entra ID, M365, GitHub, Vercel, Stripe), onboarding/offboarding, access audits, compliance reporting |

> **Note:** Morgan Blake has **Founder Protection** — cannot modify Kristina/Andrew/devops@glyphor.ai access.

### Specialist Agents (7 — DB-defined, no file-based runners)

Specialist agents are defined in `CompanyAgentRole` and the database but use `runDynamicAgent.ts`
instead of dedicated file-based runners. They have role briefs, Teams bots, profiles, and budgets,
but no `run.ts`/`systemPrompt.ts`/`tools.ts` folders under `packages/agents/src/`.

| Name | Title | Agent ID | Department | Reports To |
|------|-------|----------|------------|------------|
| **Ethan Morse** | Enterprise Account Researcher | `enterprise-account-researcher` | Sales | Rachel Kim (VP Sales) |
| **Robert "Bob" Finley** | CPA & Tax Strategist | `bob-the-tax-pro` | Legal | Victoria Chase (CLO) |
| **Grace Hwang** | Data Integrity Auditor | `data-integrity-auditor` | Legal | Victoria Chase (CLO) |
| **Mariana Solis** | Tax Strategy Specialist | `tax-strategy-specialist` | Legal | Victoria Chase (CLO) |
| **Derek Owens** | Lead Gen Specialist | `lead-gen-specialist` | Operations | Sarah Chen (CoS) |
| **Zara Petrov** | Marketing Intelligence Analyst | `marketing-intelligence-analyst` | Marketing | Maya Brooks (CMO) |
| **Adi Rose** | Executive Assistant | `adi-rose` | Executive Office | Sarah Chen (CoS) |

Budget: all specialist agents use `$0.08 / $2.00 / $60` (per run / daily / monthly).

### Org Chart

```
             Kristina Denney (CEO)     Andrew Zwelling (COO)
                         \               /       \
                          \             /         Victoria Chase (CLO)
                        Sarah Chen (CoS)             │
                              |                   Bob Finley
   ┌─────────┬──────────┬────┴────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
   │         │          │         │          │          │          │          │          │          │          │
Marcus    Elena      Nadia      Maya      James     Rachel      Mia      Sophia    Morgan    Jasmine   Adi Rose
(CTO)     (CPO)      (CFO)      (CMO)     (VP CS)   (VP Sales)  (VP Des) (VP Res)  (Glob.Ad) (HR)     (Exec.Asst)
  │         │          │          │          │          │          │          │
Alex P.  Priya S.  Anna Park  Tyler R.   Emma W.  Nathan C.  Leo V.    Lena Park
Sam D.   Daniel O.  Omar H.   Lisa C.    David S.  Ethan M.   Ava C.    Daniel Okafor
Jordan H.                      Kai J.                          Sofia M.  Kai Nakamura
Riley M.                       Zara P.                         Ryan P.   Amara Diallo
                               Derek O.                                  Riya Mehta
                                                                         Marcus Chen
```

### Cron Schedules (GCP Cloud Scheduler)

#### Agent Task Jobs (35 jobs, via Pub/Sub)

All 35 jobs are **enabled** and delivered via Cloud Scheduler → Pub/Sub → POST /pubsub.
Design sub-team agents (ui-ux-designer, frontend-engineer, design-critic, template-architect)
use DB-driven schedules via `agent_schedules` table rather than static crons.

**Executive & CoS Jobs (12)**

| Job ID | Agent | Cron (UTC) | Local (CT) | Task |
|--------|-------|-----------|------------|------|
| `cos-briefing-kristina` | Sarah Chen | `0 12 * * *` | 7:00 AM | Morning briefing for Kristina |
| `cos-briefing-andrew` | Sarah Chen | `30 12 * * *` | 7:30 AM | Morning briefing for Andrew |
| `cos-eod-summary` | Sarah Chen | `0 23 * * *` | 6:00 PM | End-of-day summary |
| `cos-orchestrate` | Sarah Chen | `0 * * * *` | Every hour | Hourly directive sweep (backup — heartbeat handles real-time) |
| `cto-health-check` | Marcus Reeves | `0 */2 * * *` | Every 2 hours | Platform health check |
| `cfo-daily-costs` | Nadia Okafor | `0 14 * * *` | 9:00 AM | Daily cost analysis |
| `cfo-afternoon-costs` | Nadia Okafor | `0 20 * * *` | 3:00 PM | Afternoon anomaly catch |
| `cpo-usage-analysis` | Elena Vasquez | `0 15 * * *` | 10:00 AM | Usage & competitive analysis |
| `cmo-content-calendar` | Maya Brooks | `0 14 * * *` | 9:00 AM | Content planning |
| `cmo-afternoon-publishing` | Maya Brooks | `0 19 * * *` | 2:00 PM | Afternoon publishing/scheduling |
| `vpcs-health-scoring` | James Turner | `0 13 * * *` | 8:00 AM | Customer health scoring |
| `vps-pipeline-review` | Rachel Kim | `0 14 * * *` | 9:00 AM | Enterprise pipeline review |

**Operations Jobs — Atlas Vega (5)**

| Job ID | Agent | Cron (UTC) | Local (CT) | Task |
|--------|-------|-----------|------------|------|
| `ops-health-check` | Atlas Vega | `*/10 * * * *` | Every 10 min | System health check |
| `ops-freshness-check` | Atlas Vega | `*/30 * * * *` | Every 30 min | Data freshness monitoring |
| `ops-cost-check` | Atlas Vega | `0 * * * *` | Every hour | Cost awareness check |
| `ops-morning-status` | Atlas Vega | `0 11 * * *` | 6:00 AM | Morning status report |
| `ops-evening-status` | Atlas Vega | `0 22 * * *` | 5:00 PM | Evening status report |

**Sub-Team Jobs (16)**

| Job ID | Agent | Cron (UTC) | Local (CT) | Task |
|--------|-------|-----------|------------|------|
| `platform-eng-daily` | Alex Park (Platform Eng) | `30 12 * * *` | 6:30 AM | Infrastructure review |
| `quality-eng-daily` | Sam DeLuca (Quality Eng) | `0 13 * * *` | 7:00 AM | Quality metrics |
| `devops-eng-daily` | Jordan Hayes (DevOps) | `0 12 * * *` | 6:00 AM | Deployment health, CI/CD |
| `user-researcher-daily` | Priya Sharma (User Research) | `30 16 * * *` | 10:30 AM | Usage patterns, cohort analysis |
| `competitive-intel-daily` | Daniel Ortiz (Competitive Intel) | `0 14 * * *` | 8:00 AM | Competitor monitoring |
| `revenue-analyst-daily` | Anna Park (Revenue) | `30 15 * * *` | 9:30 AM | Revenue breakdown |
| `cost-analyst-daily` | Omar Hassan (Cost) | `30 15 * * *` | 9:30 AM | Cost breakdown |
| `content-creator-daily` | Tyler Reed (Content) | `0 16 * * *` | 10:00 AM | Content drafting |
| `seo-analyst-daily` | Lisa Chen (SEO) | `30 14 * * *` | 8:30 AM | SEO performance |
| `social-media-morning` | Kai Johnson (Social) | `0 15 * * *` | 9:00 AM | Morning plan & scheduling |
| `social-media-afternoon` | Kai Johnson (Social) | `0 22 * * *` | 4:00 PM | Afternoon engagement |
| `onboarding-daily` | Emma Wright (Onboarding) | `30 14 * * *` | 8:30 AM | New user check |
| `support-triage-recurring` | David Santos (Support) | `0 */2 * * *` | Every 2 hours | Triage queue |
| `account-research-daily` | Nathan Cole (Account Research) | `30 15 * * *` | 9:30 AM | Account intelligence |
| `m365-admin-weekly-audit` | Riley Morgan (M365) | `0 12 * * 1` | Mon 7:00 AM | Weekly channel audit |
| `m365-admin-user-audit` | Riley Morgan (M365) | `0 13 * * 1` | Mon 8:00 AM | User access audit |

#### Data Sync & Utility Jobs (10 jobs, via HTTP + internal DataSyncScheduler)

| Job ID | Cron (UTC) | Local (CT) | Endpoint | Source |
|--------|-----------|------------|----------|--------|
| `sync-stripe` | `0 6 * * *` | 12:00 AM | `/sync/stripe` | Stripe (MRR, churn, subscriptions) |
| `sync-gcp-billing` | `0 7 * * *` | 1:00 AM | `/sync/gcp-billing` | GCP BigQuery billing export |
| `sync-mercury` | `0 8 * * *` | 2:00 AM | `/sync/mercury` | Mercury (cash balance, flows, vendor subs) |
| `sync-openai-billing` | `0 9 * * *` | 3:00 AM | `/sync/openai-billing` | OpenAI API billing/usage |
| `sync-anthropic-billing` | `0 9 * * *` | 3:00 AM | `/sync/anthropic-billing` | Anthropic (Claude) billing/usage |
| `sync-kling-billing` | `0 9 * * *` | 3:00 AM | `/sync/kling-billing` | Kling AI video generation billing |
| `sync-sharepoint-knowledge` | `0 10 * * *` | 4:00 AM | `/sync/sharepoint-knowledge` | SharePoint doc library to company knowledge ingestion |
| `heartbeat` | `*/10 * * * *` | Every 10 min | `/heartbeat` | Agent check-ins + real-time directive detection |
| `sync-graphrag-index` | `0 4 * * 0` | Sat 10:00 PM | `/sync/graphrag-index` | Weekly full GraphRAG re-index |
| `sync-graphrag-tune` | `0 3 1 * *` | 1st of month | `/sync/graphrag-tune` | Monthly GraphRAG prompt auto-tune |

---

## Monorepo Package Structure

```
glyphor-ai-company/
├── packages/
│   ├── agent-runtime/          # Core execution engine
│   │   └── src/
│   │       ├── companyAgentRunner.ts   # Agent loop + knowledge + personality injection (on-demand chat)
│   │       ├── baseAgentRunner.ts      # Base class: shared context loading, model calling, tool dispatch
│   │       ├── orchestratorRunner.ts   # Orchestrator archetype: OBSERVE→PLAN→DELEGATE→MONITOR→EVALUATE
│   │       ├── taskRunner.ts           # Task archetype: RECEIVE→REASON→EXECUTE→REPORT
│   │       ├── modelClient.ts          # Multi-provider LLM facade (delegates to providers/)
│   │       ├── documentExtractor.ts    # Office doc text extraction (officeparser: .docx/.pptx/.xlsx)
│   │       ├── reasoningEngine.ts      # Multi-pass verification & cross-model consensus
│   │       ├── jitContextRetriever.ts  # Just-In-Time context retrieval (task-aware semantic search)
│   │       ├── contextDistiller.ts     # Compresses JIT context into task-focused briefings (~$0.001/call)
│   │       ├── runtimeToolFactory.ts   # Mid-run tool synthesis (HTTP, SQL query, sandboxed JS)
│   │       ├── redisCache.ts           # Redis cache layer for GCP Memorystore (ioredis)
│   │       ├── toolRegistry.ts         # Central tool lookup (static + dynamic DB table)
│   │       ├── dynamicToolExecutor.ts  # Dynamic tool executor — runs tools from tool_registry DB at runtime (API call support)
│   │       ├── constitutionalGovernor.ts # Constitutional governance framework
│   │       ├── constitutionDefaults.ts   # Default constitutional rules
│   │       ├── decisionChainTracker.ts   # Decision chain tracking & audit trail
│   │       ├── driftDetector.ts          # Agent behavioral drift detection
│   │       ├── episodicReplay.ts         # Episodic memory replay for learning
│   │       ├── formalVerifier.ts         # Formal verification of agent outputs
│   │       ├── trustScorer.ts            # Agent trust scoring system
│   │       ├── verifierRunner.ts         # Verification pipeline runner
│   │       ├── config/
│   │       │   └── agentEmails.ts         # Agent email registry (44 agents → M365 shared mailboxes)
│   │       ├── providers/              # Per-provider LLM adapters (each has normalizeFinishReason)
│   │       │   ├── types.ts               # Unified provider contract (ProviderAdapter interface)
│   │       │   ├── gemini.ts              # GeminiAdapter (thinkingLevel/thinkingBudget, Imagen)
│   │       │   ├── openai.ts              # OpenAIAdapter (o-series reasoning_effort, GPT-5, gpt-image-1)
│   │       │   ├── anthropic.ts           # AnthropicAdapter (Vertex AI on GCP, adaptive thinking, unique tool_use IDs)
│   │       │   └── index.ts               # ProviderFactory (lazy singleton per provider)
│   │       ├── supervisor.ts           # Per-turn stall detection, turn limits, timeouts
│   │       ├── toolExecutor.ts         # Tool declaration → execution bridge (auto-grant known tools, auto-sync grants on startup)
│   │       ├── eventBus.ts             # Internal event system
│   │       ├── glyphorEventBus.ts      # Inter-agent event bus (Cloud SQL-backed)
│   │       ├── eventPermissions.ts     # Per-tier event emission permissions
│   │       ├── subscriptions.ts        # Agent → event type subscription map
│   │       ├── reasoning.ts            # Reasoning extraction & stripping
│   │       ├── workLoop.ts            # Universal always-on work loop (P1-P6 priority stack)
│   │       ├── types.ts               # All core types (27 agent roles, budgets, tool grants)
│   │       └── __tests__/             # Unit tests (reasoningEngine, jitContext, redisCache)
│   │
│   ├── company-memory/          # Persistence layer
│   │   └── src/
│   │       ├── store.ts               # CompanyMemoryStore (Cloud SQL + GCS)
│   │       ├── embeddingClient.ts     # Gemini embedding-001 vector embeddings (768-dim)
│   │       ├── collectiveIntelligence.ts # Collective intelligence store (company pulse, knowledge)
│   │       ├── graphReader.ts         # KnowledgeGraphReader — semantic search, N-hop, causal chains
│   │       ├── graphWriter.ts         # KnowledgeGraphWriter — node/edge upsert, deduplication
│   │       ├── sharedMemoryLoader.ts  # 5-layer shared memory (L1-L5) cross-agent memory access
│   │       ├── worldModelUpdater.ts   # REFLECT→LEARN→IMPROVE loop — evolves agent self-models
│   │       ├── namespaces.ts          # Key prefixes and GCS paths
│   │       ├── schema.ts             # Database row types
│   │       └── migrations/           # Schema migration helpers
│   │
│   ├── agents/                  # Agent implementations (9 execs + 7 research + 18 sub-team + 2 ops + 1 HR)
│   │   └── src/
│   │       ├── chief-of-staff/        # Sarah Chen — run.ts, systemPrompt.ts, tools.ts
│   │       ├── cto/                   # Marcus Reeves
│   │       ├── cfo/                   # Nadia Okafor
│   │       ├── cpo/                   # Elena Vasquez
│   │       ├── cmo/                   # Maya Brooks
│   │       ├── vp-customer-success/   # James Turner
│   │       ├── vp-sales/              # Rachel Kim
│   │       ├── vp-design/             # Mia Tanaka
│   │       ├── clo/                   # Victoria Chase (Chief Legal Officer)
│   │       ├── vp-research/           # Sophia Lin (VP Research & Intelligence)
│   │       ├── competitive-research-analyst/ # Lena Park (→ Sophia)
│   │       ├── market-research-analyst/     # Daniel Okafor (→ Sophia)
│   │       ├── technical-research-analyst/  # Kai Nakamura (→ Sophia)
│   │       ├── industry-research-analyst/   # Amara Diallo (→ Sophia)
│   │       ├── ai-impact-analyst/          # Riya Mehta (→ Sophia) — AI transformation assessment
│   │       ├── org-analyst/                # Marcus Chen (→ Sophia) — Organizational & talent analysis
│   │       ├── global-admin/          # Morgan Blake (Global Administrator)
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
│   │       ├── head-of-hr/            # Head of HR (People & Culture)
│   │       ├── shared/                # Shared tools:
│   │       │   ├── memoryTools.ts        # save/recall agent memories
│   │       │   ├── eventTools.ts         # emit Glyphor events
│   │       │   ├── communicationTools.ts # send_agent_message, check_messages, call_meeting
│   │       │   ├── assignmentTools.ts    # read/submit/flag assignments + dependency resolution
│   │       │   ├── graphTools.ts         # query_knowledge_graph, add_knowledge, trace_causes/impact
│   │       │   ├── collectiveIntelligenceTools.ts # pulse, knowledge routes, patterns, contradictions
│   │       │   ├── emailTools.ts         # **Deprecated** — email tools now served via mcp-email-server (send_email, read_inbox, reply_to_email)
│   │       │   ├── sharepointTools.ts    # SharePoint document operations + list_sharepoint_files
│   │       │   ├── agentCreationTools.ts # create_specialist_agent, list/retire (max 3, 7d TTL)
│   │       │   ├── agentDirectoryTools.ts # Agent directory lookup
│   │       │   ├── accessAuditTools.ts    # view_access_matrix, view_pending_grant_requests
│   │       │   ├── packetSchemas.ts       # 15 research packet type interfaces
│   │       │   ├── toolGrantTools.ts     # Dynamic tool grant/revoke management
│   │       │   ├── toolRegistryTools.ts  # Tool registry lookup and validation
│   │       │   ├── toolRequestTools.ts   # Tool access request workflow
│   │       │   ├── researchTools.ts      # web_search, web_fetch, submit_research_packet
│   │       │   ├── frontendCodeTools.ts  # read/write/search frontend code (path-scoped)
│   │       │   ├── screenshotTools.ts    # screenshot_page, compare, check_responsive
│   │       │   ├── designSystemTools.ts  # design tokens, components, validation
│   │       │   ├── auditTools.ts         # Lighthouse, accessibility, AI-smell, brand
│   │       │   ├── assetTools.ts         # DALL-E image gen, upload, optimize
│   │       │   ├── scaffoldTools.ts      # component/page scaffolding from templates
│   │       │   ├── deployPreviewTools.ts # Vercel preview deployments
│   │       │   ├── figmaAuth.ts          # Figma OAuth token manager (auto-refreshing via FIGMA_REFRESH_TOKEN)
│   │       │   ├── figmaTools.ts         # 17 Figma REST API tools (file-level; team-level requires paid plan)
│   │       │   ├── storybookTools.ts     # Storybook visual testing & coverage
│   │       │   ├── agent365Tools.ts      # Agent 365 MCP tool factory — createAgent365McpTools(serverFilter?)
│   │       │   │                         #   Gate-checked: returns [] if AGENT365_ENABLED != 'true'
│   │       │   ├── coreTools.ts          # 11 always-loaded core tools (assignments, comms, memory, events, tool-requests)
│   │       │   │                         #   createCoreTools(deps) — extracts from existing factories, exports CORE_TOOL_NAMES
│   │       │   ├── glyphorMcpTools.ts    # Bridge to 9 Glyphor MCP servers (data, marketing, engineering, design, finance, email, legal, HR, email-marketing)
│   │       │   │                         #   createGlyphorMcpTools(agentRole?, serverFilter?) — JSON-RPC 2.0, gate: GLYPHOR_MCP_ENABLED
│   │       │   ├── runDynamicAgent.ts    # Runner for DB-defined agents (no file-based runner)
│   │       │   ├── createRunDeps.ts      # Wire up all run dependencies for any agent
│   │       │   └── createRunner.ts       # Runner factory: role + task → Orchestrator/Task/CompanyAgent
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
│   │   └── briefs/                    # 42 role briefs (9 execs + 7 research + 19 sub-team + 2 ops + 5 specialists)
│   │       ├── sarah-chen.md          # Chief of Staff
│   │       ├── marcus-reeves.md       # CTO
│   │       ├── nadia-okafor.md        # CFO
│   │       ├── elena-vasquez.md       # CPO
│   │       ├── maya-brooks.md         # CMO
│   │       ├── james-turner.md        # VP Customer Success
│   │       ├── rachel-kim.md          # VP Sales
│   │       ├── mia-tanaka.md          # VP Design & Frontend
│   │       ├── victoria-chase.md      # Chief Legal Officer
│   │       ├── sophia-lin.md          # VP Research & Intelligence
│   │       ├── atlas-vega.md          # Operations & System Intelligence
│   │       ├── morgan-blake.md        # Global Administrator
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
│   │       ├── ryan-park.md           # Template Architect (→ VP Design)
│   │       ├── lena-park.md           # Competitive Research Analyst (→ VP Research)
│   │       ├── daniel-okafor.md       # Market Research Analyst (→ VP Research)
│   │       ├── kai-nakamura.md        # Technical Research Analyst (→ VP Research)
│   │       ├── amara-diallo.md        # Industry Research Analyst (→ VP Research)
│   │       ├── riya-mehta.md          # AI Impact Analyst (→ VP Research)
│   │       └── marcus-chen.md         # Org & Talent Analyst (→ VP Research)
│   │
│   ├── integrations/            # External service connectors
│   │   └── src/
│   │       ├── index.ts               # Re-exports all integrations
│   │       ├── audit.ts               # Platform audit logger (structured logging to platform_audit_log)
│   │       ├── webSearch.ts           # Web search via OpenAI Responses API (web_search_preview)
│   │       ├── teams/
│   │       │   ├── bot.ts             # Bot Framework handler (multi-bot, JWT validation)
│   │       │   ├── webhooks.ts        # Incoming webhook sender
│   │       │   ├── graphClient.ts     # Microsoft Graph API (MSAL)
│   │       │   ├── adaptiveCards.ts   # Briefing / Decision / Alert cards
│   │       │   ├── directMessages.ts  # Graph API DM sender
│   │       │   ├── email.ts           # Graph API email sender
│   │       │   └── calendar.ts        # Graph API calendar manager
│   │       │   └── calendarWebhook.ts # Graph Change Notification subscriptions for agent calendars
│   │       ├── stripe/
│   │       │   ├── index.ts           # MRR sync, churn rate
│   │       │   ├── client.ts          # Stripe SDK singleton initialization
│   │       │   ├── queries.ts         # MRR calculation, subscription sync
│   │       │   └── webhookHandler.ts  # HMAC-verified webhook, 15 event types
│   │       ├── gcp/
│   │       │   ├── index.ts           # Cloud Run metrics, billing export
│   │       │   ├── billing.ts         # BigQuery billing export → gcp_billing + financials
│   │       │   ├── cloudBuild.ts      # List builds, retrieve build logs
│   │       │   ├── healthCheck.ts     # Ping Cloud Run services, latency measurement
│   │       │   └── monitoring.ts      # Cloud Run metrics (request count, latency, errors)
│   │       ├── mercury/
│   │       │   ├── index.ts           # Bank accounts, cash flows, vendor subscriptions
│   │       │   ├── client.ts          # Mercury REST API client (Bearer auth)
│   │       │   └── queries.ts         # Cash balance, cash flows, vendor subscriptions sync
│   │       ├── sharepoint/
│   │       │   └── index.ts           # SharePoint doc library sync (recursive folder traversal, etag dedup)
│   │       │                        #   extractTextFromDocx: proper ZIP parser (inflateRawSync) for .docx binary extraction
│   │       │                        #   listSharePointFiles: browse SharePoint document libraries via Graph API
│   │       ├── github/
│   │       │   └── index.ts           # Repos, PRs, CI/CD runs, commits, issues
│   │       ├── sendgrid/
│   │       │   └── index.ts           # Transactional email sending
│   │       ├── search-console/
│   │       │   └── index.ts           # Google Search Console data
│   │       ├── anthropic/
│   │       │   ├── billing.ts         # Anthropic (Claude) billing/usage tracking
│   │       │   └── index.ts
│   │       ├── openai/
│   │       │   ├── billing.ts         # OpenAI billing/usage tracking
│   │       │   └── index.ts
│   │       ├── kling/
│   │       │   ├── billing.ts         # Kling AI video generation billing
│   │       │   └── index.ts
│   │       ├── vercel/
│   │       │   └── index.ts           # Vercel deployment platform
│   │       ├── credentials/
│   │       │   ├── githubScoping.ts   # GitHub scope management
│   │       │   └── m365Router.ts      # M365 credential routing
│   │       ├── governance/
│   │       │   └── iamSync.ts         # IAM state synchronization
│   │       ├── agent365/
│   │       │   └── index.ts           # Agent 365 MCP bridge — converts Microsoft MCP tool schemas
│   │       │                        #   to Glyphor ToolDefinition format via @microsoft/agents-a365-tooling
│   │       │                        #   MSAL client credentials auth, persistent MCP client connections
│   │       └── pulse/
│   │           └── index.ts           # Company Pulse data
│   │
│   ├── scheduler/               # Orchestration service
│   │   └── src/
│   │       ├── server.ts              # HTTP server (Cloud Run entry, 60+ endpoints, 44 agent routes)
│   │       ├── eventRouter.ts         # Event → agent routing + authority
│   │       ├── authorityGates.ts      # Green/Yellow/Red classification (all 44 roles)
│   │       ├── cronManager.ts         # 33 agent + 9 data sync job definitions
│   │       ├── dynamicScheduler.ts    # DB-driven cron for dynamic agents
│   │       ├── dataSyncScheduler.ts   # Internal cron for data sync jobs (fires HTTP to self)
│   │       ├── decisionQueue.ts       # Human approval workflow
│   │       ├── agentLifecycle.ts      # Create/retire temporary agents
│   │       ├── analysisEngine.ts      # 5-phase strategic analysis engine
│   │       ├── strategyLabEngine.ts   # Strategy Lab v2: multi-wave analysis (Research→Analysis→Synthesis)
│   │       ├── deepDiveEngine.ts      # Strategic deep dive engine with cross-model verified evidence
│   │       ├── simulationEngine.ts    # T+1 impact simulation engine
│   │       ├── cotEngine.ts           # 4-phase chain-of-thought planning engine
│   │       ├── meetingEngine.ts       # Multi-round inter-agent meetings
│   │       ├── reportExporter.ts      # Analysis/simulation/CoT export (md/json/pptx/docx) + visual prompt builder
│   │       ├── inboxCheck.ts          # M365 mailbox polling for agent email (12 email-enabled agents)
│   │       ├── dashboardApi.ts        # PostgREST-compatible CRUD API for dashboard (70+ whitelisted tables)
│   │       ├── frameworkTypes.ts      # Output schemas for 6 strategic frameworks (Ansoff, BCG, Blue Ocean, Porter, PESTLE, SWOT)
│   │       ├── parallelDispatch.ts    # Wave builder, parallel dispatcher, dependency resolver, concurrency guard
│   │       ├── wakeRouter.ts          # Event-driven agent wake dispatcher
│   │       ├── wakeRules.ts           # Declarative event-to-agent wake mappings
│   │       ├── heartbeat.ts           # Lightweight periodic agent check-ins (DB only)
│   │       ├── changeRequestHandler.ts # Dashboard change request → GitHub issue pipeline
│   │       ├── brandTheme.ts          # Centralized design-system constants for PPTX/DOCX/images
│   │       ├── logoAsset.ts           # Logo PNG asset loading for branded exports
│   │       └── index.ts              # Package public API exports
│   │
│   ├── dashboard/               # Web UI
│       ├── src/
│       │   ├── pages/
│       │   │   ├── Dashboard.tsx      # Agent overview & metrics
│       │   │   ├── Chat.tsx           # Real-time agent chat (react-markdown)
│       │   │   ├── GroupChat.tsx      # Multi-agent group chat (conversation_id-based)
│       │   │   ├── Comms.tsx          # Composite: Chat + Meetings tabs
│       │   │   ├── Capabilities.tsx   # Composite: Skills + Self-Models (WorldModel) tabs
│       │   │   ├── Workforce.tsx      # Org chart + grid view (11 departments)
│       │   │   ├── WorkforceBuilder.tsx # Drag-and-drop org chart builder
│       │   │   ├── AgentProfile.tsx   # 7-tab agent profile (overview, perf,
│       │   │   │                      #   memory, messages, skills, world model,
│       │   │   │                      #   settings)
│       │   │   ├── AgentBuilder.tsx   # Create new dynamic agents
│       │   │   ├── AgentSettings.tsx  # Agent configuration & system prompts
│       │   │   ├── Approvals.tsx      # Decision approval queue
│       │   │   ├── Directives.tsx     # Founder directives management
│       │   │   ├── Financials.tsx     # Revenue, costs, GCP billing, vendor subscriptions
│       │   │   ├── Governance.tsx     # Platform governance, IAM state, secret rotation
│       │   │   ├── Knowledge.tsx      # Knowledge base management, bulletins & knowledge graph
│       │   │   ├── Operations.tsx     # System operations, events & activity log
│       │   │   ├── Strategy.tsx       # Strategic analysis & T+1 simulations & CoT planning & AI infographics
│       │   │   ├── Graph.tsx          # Force-directed knowledge graph (canvas, ref-based animation)
│       │   │   ├── Skills.tsx         # Skill library browser (10 categories)
│       │   │   ├── SkillDetail.tsx    # Skill detail + agent assignments
│       │   │   ├── WorldModel.tsx     # Agent self-model radar charts
│       │   │   ├── Meetings.tsx       # Inter-agent meetings & messages
│       │   │   ├── Settings.tsx       # User management
│       │   │   └── TeamsConfig.tsx    # Teams bot setup & configuration
│       │   ├── components/            # Shared UI components
│       │   │   ├── Layout.tsx            # Sidebar nav, theme toggle
│       │   │   ├── AgentIcon.tsx         # Agent avatar component
│       │   │   ├── GrowthAreas.tsx       # Agent growth tracking
│       │   │   ├── PeerFeedback.tsx      # Agent peer feedback display
│       │   │   ├── QualityChart.tsx      # Quality score charts
│       │   │   ├── SystemHealth.tsx      # System health monitor
│       │   │   ├── VoiceOverlay.tsx      # Live voice session UI with transcript
│       │   │   ├── FounderBriefing.tsx   # Executive summary panel (pulse, incidents, decisions)
│       │   │   ├── OrgChartPicker.tsx    # Org chart agent picker (WorkforceBuilder)
│       │   │   └── ui.tsx                # Shared primitives
│       │   ├── lib/                   # Hooks, API client, types, utilities
│       │   │   ├── firebase.ts            # Firebase client init & auth
│       │   │   ├── supabase.ts            # Supabase client (realtime subscriptions)
│       │   │   ├── auth.tsx              # Google OAuth provider
│       │   │   ├── theme.tsx             # Dark/light theme provider
│       │   │   ├── hooks.ts              # Custom hooks
│       │   │   ├── models.ts             # LLM model definitions & pricing
│       │   │   ├── useVoiceChat.ts        # Voice chat React hook
│       │   │   └── types.ts              # Dashboard-specific types
│       │   ├── App.tsx               # Router & layout (21 routes + 8 legacy redirects)
│       │   └── index.css             # Tailwind + Glyphor brand theme
│       └── package.json
│
│   ├── voice-gateway/           # Voice agent gateway (Cloud Run service)
│   │   └── src/
│   │       ├── server.ts              # HTTP server (dashboard + Teams voice endpoints)
│   │       ├── sessionManager.ts      # Voice session lifecycle management
│   │       ├── realtimeClient.ts      # OpenAI Realtime API WebSocket client
│   │       ├── dashboardHandler.ts    # Dashboard WebRTC voice sessions
│   │       ├── teamsHandler.ts        # Teams meeting voice (Graph Communications API)
│   │       ├── acsMediaClient.ts      # ACS REST API (HMAC auth, bidirectional media WS)
│   │       ├── audioResampler.ts      # PCM16 sample rate conversion (16kHz⇄24kHz)
│   │       ├── calendarWatcher.ts     # Auto-join Teams meetings (polling + Graph webhooks)
│   │       ├── teamsAudioBridge.ts    # Bidirectional audio: ACS WS ⇄ OpenAI Realtime WS
│   │       ├── voiceMap.ts            # Agent → voice mapping (10 OpenAI voices)
│   │       ├── voicePrompt.ts         # Voice-optimized system prompts
│   │       ├── toolBridge.ts          # Bridge agent tools into voice sessions
│   │       └── types.ts              # VoiceSession, AgentVoiceConfig, RealtimeVoice
│   │
│   ├── mcp-data-server/         # Glyphor MCP Data Server (Cloud Run service)
│   │   └── src/
│   │       ├── index.ts               # HTTP server (:8080), POST /mcp (JSON-RPC 2.0), GET /health
│   │       ├── tools.ts               # 12 parameterized read-only SQL query tools (content, SEO, finance,
│   │       │                          #   analytics, support, research, agents, operations)
│   │       └── scopes.ts              # SCOPE_TABLE_MAP — Entra scopes → allowed database tables
│   │   ├── Dockerfile                 # Multi-stage node:22-slim build
│   │   ├── package.json               # @modelcontextprotocol/sdk + pg deps
│   │   └── tsconfig.json              # Extends tsconfig.base.json
│   │
│   ├── mcp-marketing-server/    # Glyphor MCP Marketing Server — 7 tools (social, Search Console, analytics)
│   ├── mcp-engineering-server/  # Glyphor MCP Engineering Server — 5 tools (GitHub, Vercel, Cloud Run)
│   ├── mcp-design-server/       # Glyphor MCP Design Server — 5 tools (Playwright, Figma, Storybook)
│   ├── mcp-finance-server/      # Glyphor MCP Finance Server — 7 tools (Stripe, Mercury, BigQuery)
│   ├── mcp-email-server/        # Glyphor MCP Email Server — 3 tools (send_email, read_inbox, reply_to_email)
│   │                            #   Plain-text enforced: stripMarkdown() safety net in formatEmailHtml()
│   ├── mcp-legal-server/        # Glyphor MCP Legal Server — 19 tools (12 reads + 7 writes: compliance, contracts, IP, tax)
│   ├── mcp-hr-server/           # Glyphor MCP HR Server — 8 tools (5 reads + 3 writes: profiles, onboarding, engagement)
│   ├── mcp-email-marketing-server/ # Glyphor MCP Email Marketing Server — 15 tools (Mailchimp 10 + Mandrill 5)
│   │
│   └── graphrag-indexer/        # Knowledge graph indexer (Python)
│       └── graphrag_indexer/
│           ├── config.py              # Configuration (Gemini, embeddings, Cloud SQL)
│           ├── collector.py           # Gather source docs (knowledge base + agent outputs)
│           ├── extractor.py           # Entity extraction (Microsoft GraphRAG + Gemini)
│           ├── bridge.py              # Sync extracted graph to Cloud SQL kg_nodes/kg_edges
│           ├── tune.py                # Auto-tune extraction prompts to Glyphor domain
│           ├── index.py               # Run full indexing pipeline
│           └── server.py              # HTTP API for on-demand indexing
│
│   ├── worker/                  # GCP Cloud Tasks queue processor
│   │   └── src/
│   │       ├── index.ts               # HTTP server (Express): /run, /deliver, /health
│   │       └── queue.ts               # Cloud Tasks client: agent-runs, agent-runs-priority, delivery queues
│   │
│   └── smoketest/               # 14-layer health verification suite
│       └── src/
│           ├── main.ts                # CLI runner (--layer N, --interactive)
│           ├── index.ts               # Re-exports
│           ├── types.ts               # Test result types
│           └── layers/                # Test layers (L00-L10)
│               ├── layer00-infra.ts          # DB, Redis, GCS connectivity
│               ├── layer01-data-syncs.ts     # GCP Billing, Stripe, Mercury, SharePoint
│               ├── layer02-model-clients.ts  # Gemini, OpenAI, Claude, Kling
│               ├── layer03-heartbeat.ts      # Agent pulse monitoring
│               ├── layer04-orchestration.ts  # Agent dispatch, task queue
│               ├── layer05-communication.ts  # Email, Slack, Teams, Call Automation
│               ├── layer06-authority.ts      # Policies, RBAC, decision engine
│               ├── layer07-intelligence.ts   # Web search, Tavily, GraphRAG
│               ├── layer08-knowledge.ts      # Company knowledge base, SharePoint
│               ├── layer09-strategy.ts       # Analysis engine, deep dives
│               └── layer10-specialists.ts    # All agent runners
│
├── docker/
│   ├── Dockerfile.scheduler     # node:22-slim builder → node:22-slim runtime
│   ├── Dockerfile.dashboard     # node:22-slim builder → nginx:1.27-alpine
│   ├── Dockerfile.chief-of-staff
│   ├── Dockerfile.worker        # node:22-slim builder → node:22-slim runtime (Cloud Tasks processor)
│   ├── Dockerfile.voice-gateway # Voice gateway service
│   ├── Dockerfile.graphrag-indexer # Python GraphRAG indexer
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
│   ├── manifest.json            # Main Glyphor AI team tab + bot (v1.2.0, manifest v1.17)
│   └── agents/                  # 42 individual agent bot manifests + zip packages
│       ├── sarah-chen/          # Chief of Staff bot
│       ├── atlas-vega/          # Operations bot
│       ├── marcus-reeves/       # CTO bot
│       ├── elena-vasquez/       # CPO bot
│       ├── nadia-okafor/        # CFO bot
│       ├── maya-brooks/         # CMO bot
│       ├── james-turner/        # VP CS bot
│       ├── rachel-kim/          # VP Sales bot
│       ├── riley-morgan/        # M365 Admin bot
│       ├── morgan-blake/        # Global Admin bot
│       ├── jasmine-rivera/      # Head of HR bot
│       ├── ethan-morse/         # Enterprise Account Researcher bot
│       ├── bob-finley/          # Tax Strategist bot
│       ├── grace-hwang/         # Data Integrity Auditor bot
│       ├── mariana-solis/       # Tax Strategy Specialist bot
│       ├── derek-owens/         # Lead Gen Specialist bot
│       ├── zara-petrov/         # Marketing Intelligence bot
│       ├── adi-rose/            # Executive Assistant bot
│       └── ... (24 more)        # All other agents
│
├── db/migrations/               # 92 SQL migration files (historical, pre-GCP + 6 new tool tables)
├── .github/workflows/deploy.yml # CI/CD (GitHub Actions → Cloud Run)
├── scripts/
│   ├── create-agent-blueprint.ps1    # Creates Entra AgentIdentityBlueprint + BlueprintPrincipal
│   ├── create-agent-identities.ps1   # Creates 44 AgentIdentity SPs under blueprint
│   ├── create-agent-users-phase2.ps1 # Creates agent user accounts (mailboxes)
│   ├── assign-agent-permissions.ps1  # Assigns M365 MCP oauth2 grants + Glyphor app roles
│   ├── recover-agent-users.ps1       # Recreates deleted agent user accounts
│   ├── fix-licenses.ps1              # Sets usageLocation + assigns Agent 365 license
│   ├── agent-identity-real-ids.json  # Maps agent role → Agent Identity SP ID (44 agents)
│   ├── figma-oauth.cjs               # One-time Figma OAuth flow (local callback on :3847)
│   └── run-seed.mjs                  # Database seeding script
├── a365.config.json             # Agent 365 tenant/subscription/app IDs
├── a365.generated.config.json   # Agent 365 generated blueprint state
├── ToolingManifest.json         # MCP server registry (5 Microsoft + 9 Glyphor = 14 servers)
├── turbo.json                   # Turborepo pipeline config
├── tsconfig.base.json           # Shared TS config
└── package.json                 # npm workspaces root
```

---

## Agent Framework — Execution Engine, Workflows & Loops

This section documents the complete agent framework: every loop, workflow, and decision
path that powers 24/7 autonomous operations.

### Master Flow Diagram

```
                              ┌─────────────────────────────────────────┐
                              │            ENTRY POINTS                 │
                              │                                         │
                              │  ① Cloud Scheduler cron → Pub/Sub      │
                              │  ② Dashboard chat → POST /run           │
                              │  ③ Teams bot DM → POST /api/teams/msg   │
                              │  ④ Heartbeat timer → POST /heartbeat    │
                              │  ⑤ Event bus → POST /event              │
                              │  ⑥ Stripe/webhook → POST /webhook/*     │
                              └──────────────┬──────────────────────────┘
                                             │
                                             ▼
                              ┌──────────────────────────────┐
                              │     trackedAgentExecutor      │
                              │  (INSERT agent_runs,          │
                              │   call agentExecutor,         │
                              │   UPDATE agent_runs w/ stats) │
                              └──────────────┬───────────────┘
                                             │
                           ┌─────────────────┼──────────────────┐
                           │                 │                  │
           task=work_loop  │   task=on_demand │   task=scheduled │
           task=proactive  │                 │   (briefing,     │
                           │                 │    orchestrate,  │
                           ▼                 │    health_check) │
                   ┌───────────────┐         │                  │
                   │ Re-route as   │         │                  │
                   │ on_demand +   │         │                  │
                   │ work message  │─────────┤                  │
                   └───────────────┘         │                  │
                                             ▼                  ▼
                              ┌──────────────────────────────────┐
                              │   Role Dispatch (37 branches)    │
                              │                                  │
                              │   chief-of-staff → runCoS()      │
                              │   cto → runCTO()                 │
                              │   cfo → runCFO()                 │
                              │   cpo → runCPO()                 │
                              │   ... (all 37 agent runners)     │
                              └──────────────┬───────────────────┘
                                             │
                                             ▼
                              ┌──────────────────────────────────┐
                              │    createRunner(role, task)       │
                              │    (Runner Factory)               │
                              │                                  │
                              │  on_demand → CompanyAgentRunner   │
                              │  orchestrator → OrchestratorRunner│
                              │  task agent → TaskRunner          │
                              └──────────────────────────────────┘
```

### Agent Execution Loop

Three runner archetypes handle all agent execution. The `createRunner()` factory
selects the correct runner based on role and task type:

- **OrchestratorRunner** — 5 executive roles (chief-of-staff, cto, clo, vp-research, ops): OBSERVE→PLAN→DELEGATE→MONITOR→EVALUATE
- **TaskRunner** — 31 task roles: RECEIVE→REASON→EXECUTE→REPORT
- **CompanyAgentRunner** — on-demand chat: knowledge + personality injection

The core execution loop (ported from Fuse V7 `agentRunner.ts`). Every single agent run —
whether triggered by cron, chat, heartbeat, or event — flows through this exact loop.

**Directive Detection (Real-Time):** The heartbeat cycle (`/heartbeat`, every 10 min) includes a
CoS-specific check: query `founder_directives` for active directives with zero `work_assignments`.
When a new directive is detected, the heartbeat immediately wakes Sarah with an `orchestrate` task.
This means new directives are picked up within ~10 minutes of creation, not waiting for the hourly
cron backup sweep.

Execution loop:

```
┌─────────────────────────────────────────────────────────────────┐
│                    CompanyAgentRunner.run()                       │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 1. CONTEXT TIER RESOLUTION                                 │  │
│  │    resolveContextTier(task, message) →                      │  │
│  │      on_demand     → light (auto-upgrade to standard       │  │
│  │                       if message matches task keywords)     │  │
│  │      work_loop     → task  (narrow executor, ~150 lines)   │  │
│  │      briefing/orch → full  (everything: CI, graph, skills) │  │
│  │      other         → standard (KB + brief + memories)      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 2. PARALLEL PRE-RUN DATA LOADING (Promise.all)             │  │
│  │    All 10 loaders fire simultaneously:                      │  │
│  │                                                             │  │
│  │    ┌─────────────┐ ┌──────────────┐ ┌───────────────────┐  │  │
│  │    │ Memory      │ │ Profile      │ │ Pending Messages  │  │  │
│  │    │ 20 memories │ │ (cached 5m)  │ │ (inter-agent DMs) │  │  │
│  │    │ 3 reflects  │ │              │ │                   │  │  │
│  │    │ 5 semantic  │ │              │ │                   │  │  │
│  │    └─────────────┘ └──────────────┘ └───────────────────┘  │  │
│  │    ┌─────────────┐ ┌──────────────┐ ┌───────────────────┐  │  │
│  │    │ Dynamic     │ │ Working Mem  │ │ Knowledge Base    │  │  │
│  │    │ Brief (DB)  │ │ (last-run    │ │ (DB, cached 5m)   │  │  │
│  │    │             │ │  summary)    │ │                   │  │  │
│  │    └─────────────┘ └──────────────┘ └───────────────────┘  │  │
│  │    ┌─────────────┐ ┌──────────────┐ ┌───────────────────┐  │  │
│  │    │ CI Context  │ │ Skill Ctx    │ │ Founder Bulletins │  │  │
│  │    │ (full only) │ │ (full only)  │ │ (cached 5m)       │  │  │
│  │    └─────────────┘ └──────────────┘ └───────────────────┘  │  │
│  │    ┌─────────────────────────────────────────────────────┐  │  │
│  │    │ Pending Work Assignments (with directive context)    │  │  │
│  │    └─────────────────────────────────────────────────────┘  │  │
│  │                                                             │  │
│  │    Light: profile + messages + working memory only          │  │
│  │    Task:  profile + messages + assignments only             │  │
│  │    Standard: + KB + brief + memories + bulletins            │  │
│  │    Full: + CI + graph + skills                              │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 3. BUILD SYSTEM PROMPT                                     │  │
│  │                                                             │  │
│  │    Standard/Full tier (personality-first ordering):          │  │
│  │    ┌──────────────────────────────────────────────────────┐ │  │
│  │    │ ① WHO YOU ARE — personality, voice, quirks, examples │ │  │
│  │    │ ② CONVERSATION MODE — casual vs task routing         │ │  │
│  │    │ ③ REASONING PROTOCOL — Orient→Plan→Execute→Reflect   │ │  │
│  │    │ ④ ACTION HONESTY PROTOCOL — verify-before-claim      │ │  │
│  │    │ ⑤ WORK ASSIGNMENTS PROTOCOL — read→work→submit/flag  │ │  │
│  │    │ ⑥ ALWAYS-ON PROTOCOL — P1-P5 priority stack          │ │  │
│  │    │ ⑦ SKILLS — methodology, proficiency, refinements     │ │  │
│  │    │ ⑧ ROLE BRIEF — from briefs/{name}.md or DB           │ │  │
│  │    │ ⑨ AGENT SYSTEM PROMPT — role-specific instructions   │ │  │
│  │    │ ⑩ COMPANY KNOWLEDGE BASE — DB or static CORE.md      │ │  │
│  │    │ ⑪ DEPARTMENT CONTEXT — context/{department}.md        │ │  │
│  │    │ ⑫ FOUNDER BULLETINS — priority-coded, expiring       │ │  │
│  │    └──────────────────────────────────────────────────────┘ │  │
│  │                                                             │  │
│  │    Task tier (~150 lines only):                             │  │
│  │    ┌──────────────────────────────────────────────────────┐ │  │
│  │    │ ① WHO YOU ARE — personality, voice, quirks           │ │  │
│  │    │ ② ASSIGNMENT PROTOCOL — execute → submit/flag        │ │  │
│  │    │ ③ COST AWARENESS — budget constraints                │ │  │
│  │    └──────────────────────────────────────────────────────┘ │  │
│  │                                                             │  │
│  │    Chat (on_demand) uses: chat reasoning protocol, chat   │  │
│  │    data honesty, action honesty protocol, instruction     │  │
│  │    echo protocol. Skips: full reasoning, work assignments,│  │
│  │    always-on protocol                                     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
│  │        MAIN AGENTIC LOOP (repeats until STOP)              │  │
│  │                                                             │  │
│  │   ┌─────────────────────────────────────────────────────┐  │  │
│  │   │ 4. SUPERVISOR CHECK (per-turn stall detection)      │  │  │
│  │   │    ✓ turnCount ≤ maxTurns (12 chat, 20 task)          │  │  │
│  │   │    ✓ stallCount < 3 (turns with zero progress)       │  │  │
│  │   │      Stall evaluation: checkBeforeModelCall() at     │  │  │
│  │   │      start of each new turn — if previous turn had   │  │  │
│  │   │      no progress (turnHadProgress=false), stallCount │  │  │
│  │   │      increments. Multiple failed tool calls in one   │  │  │
│  │   │      turn count as ONE stall, not per-call.          │  │  │
│  │   │    ✓ elapsed < timeout (150s chat, 180s task)        │  │  │
│  │   │    ✗ Any fail → abort (task tier: savePartialProgress)│ │  │
│  │   └─────────────────────────────┬───────────────────────┘  │  │
│  │                                 │                           │  │
│  │                                 ▼                           │  │
│  │   ┌─────────────────────────────────────────────────────┐  │  │
│  │   │ 5. CONTEXT INJECTION (turn 2+, optional)            │  │  │
│  │   │    Per-agent contextInjector adds dynamic context    │  │  │
│  │   └─────────────────────────────┬───────────────────────┘  │  │
│  │                                 │                           │  │
│  │                                 ▼                           │  │
│  │   ┌─────────────────────────────────────────────────────┐  │  │
│  │   │ 6. MODEL CALL                                       │  │  │
│  │   │    ModelClient → ProviderFactory → ProviderAdapter   │  │  │
│  │   │    Provider auto-detected: gemini-* / gpt-* / claude-│ │  │
│  │   │    Thinking overrides per task:                       │  │  │
│  │   │      on_demand: thinking DEFAULT-ON (disabled only   │  │  │
│  │   │        for trivial messages <10 chars or greetings)  │  │  │
│  │   │      work_loop: thinking DISABLED (cost)             │  │  │
│  │   │      briefing/orchestrate: thinking ENABLED (quality)│  │  │
│  │   │    Gemini 3: forces temperature 1.0+                 │  │  │
│  │   │    Penultimate turn: inject warning "ONE turn left"  │  │  │
│  │   │    Last turn (chat/task): tools STRIPPED → force text │  │  │
│  │   │      + inject "FINAL TURN" honesty constraint:       │  │  │
│  │   │        only describe already-executed actions         │  │  │
│  │   └─────────────────────────────┬───────────────────────┘  │  │
│  │                                 │                           │  │
│  │                    ┌────────────┴────────────┐              │  │
│  │                    │                         │              │  │
│  │              Has tool calls?           Text response?       │  │
│  │                    │                         │              │  │
│  │                    ▼                         ▼              │  │
│  │   ┌────────────────────────────┐  ┌──────────────────────┐ │  │
│  │   │ 7. TOOL DISPATCH          │  │ 8. COMPLETION        │ │  │
│  │   │                           │  │                      │ │  │
│  │   │ Push tool_call turns      │  │ finishReason='stop'  │ │  │
│  │   │ (batch for thought sigs)  │  │ (normalized)         │ │  │
│  │   │                           │  │                      │ │  │
│  │   │ For each tool call:       │  │ No text yet? Nudge   │ │  │
│  │   │   ToolExecutor.execute()  │  │ "provide final       │ │  │
│  │   │    ├─ grant check (DB)    │  │  response" → re-loop │ │  │
│  │   │    ├─ scope check         │  │                      │ │  │
│  │   │    ├─ rate limit check    │  │ Still no text?       │ │  │
│  │   │    ├─ budget check        │  │ Reconstruct from     │ │  │
│  │   │    ├─ execute + timeout   │  │ last 3 tool results  │ │  │
│  │   │    └─ auto-verify (if     │  │                      │ │  │
│  │   │       mutation tool)      │  │ Claim detection:     │ │  │
│  │   │                           │  │ flag unsubstantiated  │ │  │
│  │   │ Collect action receipts   │  │ action claims (chat)  │ │  │
│  │   │ Push tool_result turns    │  └──────────────────────┘ │  │
│  │   │ Supervisor.recordResult() │                            │  │
│  │   │ → loop back to step 4    │                            │  │
│  │   └────────────────────────────┘                           │  │
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 9. POST-RUN: REFLECTION  (skipped for task tier)           │  │
│  │                                                             │  │
│  │  Separate model call → structured JSON:                     │  │
│  │   ┌──────────────────────────────────────────────────────┐  │  │
│  │   │ summary, qualityScore (0-100)                        │  │  │
│  │   │ whatWentWell[], whatCouldImprove[]                    │  │  │
│  │   │ promptSuggestions[], knowledgeGaps[]                  │  │  │
│  │   │ memories[] → saved with vector embeddings (768-dim)   │  │  │
│  │   │ peerFeedback[] → saved to agent_peer_feedback         │  │  │
│  │   │ skill_feedback[] → updates proficiency                │  │  │
│  │   │ graph_operations{nodes[], edges[]} → KG writer        │  │  │
│  │   └──────────────────────────────────────────────────────┘  │  │
│  │                                                             │  │
│  │  Post-reflection actions:                                   │  │
│  │   → Save reflection to agent_reflections                    │  │
│  │   → Save memories with embeddings to agent_memory           │  │
│  │   → Process graph ops (nodes + edges → kg_nodes, kg_edges)  │  │
│  │   → Save working memory (last_run_summary) for next run     │  │
│  │   → Update growth metrics for dashboard                     │  │
│  │   → Route new knowledge to relevant agents (CI system)      │  │
│  │   → Save peer feedback to agent_peer_feedback               │  │
│  │   → Update skill proficiency via skillFeedbackWriter        │  │
│  │                                                             │  │
│  │  Timing:                                                    │  │
│  │   on_demand → fire-and-forget (don't block user response)   │  │
│  │   scheduled → awaited (ensure data persists before exit)    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 10. POST-RUN: EVENT EMISSION                               │  │
│  │    → Emit agent.completed event to GlyphorEventBus          │  │
│  │    → On error: emit alert.triggered event for Atlas          │  │
│  │    → Return AgentExecutionResult to caller                   │  │
│  │      (includes actions: ActionReceipt[] for tool call        │  │
│  │       transparency — tool name, params, result, output)      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 11. POST-RUN: WORLD MODEL SELF-ASSESSMENT                 │  │
│  │    (orchestrator + task runs only, not on_demand)           │  │
│  │                                                             │  │
│  │  Auto-updates agent_world_model without waiting for CoS     │  │
│  │  grading. Calculates self-score from run outcome:           │  │
│  │    → Baseline: 4.0 for completed runs                       │  │
│  │    → Penalty: −0.5 if >10 turns used (inefficient)          │  │
│  │    → Bonus: +0.5 if ≤3 turns with no errors (efficient)    │  │
│  │    → Clamped to [1.0, 5.0]                                  │  │
│  │  Records: turnCount, hadErrors, efficiency metrics           │  │
│  │  Calls worldModelUpdater.updateFromGrade()                  │  │
│  │  Ensures world model data populates continuously in the     │  │
│  │  dashboard (Capabilities > Self-Models tab)                 │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Partial Progress Recovery (Task Tier)

When a task-tier run is aborted (supervisor limit, timeout, tool stall, or uncaught error),
the runner calls `savePartialProgress()`:

```
Abort detected (task tier only)
  → Extract assignment_id from initial message regex
  → Collect last output + last 5 tool results
  → partialProgressSaver(assignmentId, partialOutput, role, reason)
    → UPDATE work_assignments SET status='dispatched', agent_output=partial
    → Send abort notification to chief-of-staff
  → Prevents complete work loss on timeouts
```

---

### Heartbeat & Work Loop — The Always-On Engine

The heartbeat is the backbone of 24/7 autonomous operations. Every 10 minutes,
the system cycles through agents and checks for pending work — all via DB queries,
no LLM calls until actual work is found.

```
┌────────────────────────────────────────────────────────────────────────┐
│                     HEARTBEAT CYCLE (every 10 min)                     │
│                     POST /heartbeat → HeartbeatManager                 │
│                     3-Phase Parallel Wave Dispatch                      │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ PHASE 1: SCAN — Select & check agents for this cycle (no LLM)    │  │
│  │                                                                  │  │
│  │    Tier selection (same as before):                                │  │
│  │      High   (every cycle / 10 min): chief-of-staff, cto, ops     │  │
│  │      Medium (every 2nd / 20 min):   other executives              │  │
│  │      Low    (every 3rd / 30 min):   all 23 sub-team/research      │  │
│  │                                                                  │  │
│  │    For each agent in tier:                                        │  │
│  │      ✓ Skip if ran < 5 min ago (MIN_RUN_GAP)                     │  │
│  │      Check A: WakeRouter.drainQueue(agent) — queued reactive      │  │
│  │      Check B: executeWorkLoop(agent) — P1-P5 priority stack       │  │
│  │      Check C: Knowledge inbox ≥ 5 items pending                  │  │
│  │      → Build WaveAgent with assignmentId + dependsOn from DB      │  │
│  │      → Collect into wakeList[]                                    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              │                                         │
│                              ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ PHASE 2: RESOLVE — Build dependency-ordered waves                │  │
│  │                                                                  │  │
│  │    buildWaves(wakeList) → topological sort into WaveAgent[][]     │  │
│  │      → Agents with no dependencies → Wave 0                      │  │
│  │      → Agents depending on Wave N agents → Wave N+1              │  │
│  │      → Circular dependencies broken automatically                │  │
│  │                                                                  │  │
│  │    Example: W1=[sarah, marcus, elena] → W2=[nadia]               │  │
│  │    (nadia depends on an assignment owned by marcus)               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              │                                         │
│                              ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ PHASE 3: DISPATCH — Parallel wave execution                      │  │
│  │                                                                  │  │
│  │    dispatchWaves(waves, executor, db)                              │  │
│  │      For each wave (sequential):                                  │  │
│  │        For each agent in wave (parallel, max 10 concurrent):      │  │
│  │          ✓ Concurrency guard: skip if agent already running       │  │
│  │            (checks agent_runs for status='running')               │  │
│  │          → trackedAgentExecutor(role, task, payload)               │  │
│  │          → Timeout: 120s per dispatch                             │  │
│  │        await Promise.allSettled(wave)                             │  │
│  │      Next wave starts after previous wave completes               │  │
│  │                                                                  │  │
│  │    Returns: { dispatched[], skipped[], failed[] }                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

#### Work Loop Priority Stack (executeWorkLoop)

Pure DB queries, no LLM call (~$0.005 per check). Only dispatches an agent when
real work exists:

```
executeWorkLoop(agentRole, db)
  │
  ├─ ABORT COOLDOWN CHECK
  │    Last run aborted < 30 min ago? → return shouldRun:false
  │
  ├─ P1: URGENT — needs_revision assignments OR urgent messages
  │    ├─ Query: work_assignments WHERE status='needs_revision'
  │    ├─ Join: founder_directives(title, priority, description)
  │    ├─ Mark assignment in_progress immediately
  │    ├─ Build rich exec message: instructions + revision feedback
  │    │   + submit/flag tool hints
  │    └─ Return: contextTier='task', task='work_loop'
  │    
  │    ├─ Query: agent_messages WHERE priority='urgent' AND status='pending'
  │    └─ Return: contextTier='standard', task='work_loop'
  │
  ├─ P2: ACTIVE WORK — pending/dispatched/in_progress assignments
  │    ├─ Query: work_assignments WHERE status IN ('pending','dispatched','in_progress')
  │    ├─ Sort by directive priority (critical > high > medium > low)
  │    ├─ Mark top assignment in_progress
  │    ├─ Build exec message: instructions + directive context + tool hints
  │    └─ Return: contextTier='task', task='work_loop'
  │
  ├─ P3: MESSAGES — unread DMs from colleagues
  │    ├─ Query: agent_messages WHERE status='pending' (count only)
  │    └─ Return: contextTier='standard', task='work_loop'
  │
  ├─ P4: SCHEDULED — (skipped here, handled by Cloud Scheduler crons)
  │
  ├─ P5: PROACTIVE — self-directed work
  │    ├─ Check proactive cooldown:
  │    │    chief-of-staff, ops:     1 hour
  │    │    cto, cfo:                2 hours
  │    │    cpo, cmo, VPs:           4 hours
  │    │    sub-team (default):      6 hours
  │    ├─ Query last meaningful run (status=completed, turns>0)
  │    ├─ If cooldown expired → build role-specific proactive prompt
  │    └─ Return: contextTier='standard', task='proactive'
  │
  └─ P6: NOTHING — no actionable work
       └─ Return: shouldRun:false (fast exit, no dispatch)
```

---

### Reactive Wake System

Beyond the heartbeat's regular polling, the wake system enables event-driven agent
activation with immediate or deferred dispatch:

```
┌──────────────────────────────────────────────────────────────────┐
│                    EVENT → WAKE FLOW                              │
│                                                                  │
│  Event arrives (webhook, inter-agent, Stripe, etc.)              │
│       │                                                          │
│       ▼                                                          │
│  WakeRouter.processEvent(event)                                  │
│       │                                                          │
│       ├─ Match event.type against WAKE_RULES[]                   │
│       │    Filter by optional condition (is_founder, etc.)        │
│       │                                                          │
│       ├─ For each matching rule:                                 │
│       │    ├─ Resolve dynamic agent tokens:                      │
│       │    │    $target_agent → event.data.target_agent           │
│       │    │    $to_agent     → event.data.to_agent              │
│       │    │    $proposed_by  → event.data.proposed_by            │
│       │    │    $action_item_owners → event.data.action_item_owners│
│       │    │                                                      │
│       │    ├─ Check cooldown (per agent+event, configurable min)  │
│       │    │                                                      │
│       │    ├─ IMMEDIATE priority:                                 │
│       │    │    → wakeAgent() → trackedAgentExecutor → full run   │
│       │    │                                                      │
│       │    └─ NEXT_HEARTBEAT priority:                            │
│       │         → INSERT agent_wake_queue (status=pending)        │
│       │         → Picked up by HeartbeatManager.checkAgentNeeds() │
│       │                                                          │
│       └─ Return: { matched, woken[], queued[], skipped[] }       │
└──────────────────────────────────────────────────────────────────┘

Wake Rules Summary:
┌──────────────────────────────────┬──────────────────────────┬───────────┬──────────┐
│ Event                            │ Agents Woken              │ Priority  │ Cooldown │
├──────────────────────────────────┼──────────────────────────┼───────────┼──────────┤
│ teams_bot_dm (founder)           │ $target_agent             │ immediate │ —        │
│ dashboard_on_demand              │ $target_agent             │ immediate │ —        │
│ customer.subscription.created    │ vp-cs, vp-sales          │ immediate │ 5 min    │
│ customer.subscription.deleted    │ vp-cs, cfo               │ immediate │ 5 min    │
│ invoice.payment_failed           │ cfo, vp-cs               │ immediate │ 15 min   │
│ agent_message (urgent)           │ $to_agent                │ immediate │ 5 min    │
│ alert.triggered (critical)       │ cto, ops, chief-of-staff │ immediate │ —        │
│ alert.triggered (warning/cost)   │ cfo                      │ heartbeat │ 30 min   │
│ decision.resolved                │ $proposed_by             │ immediate │ 5 min    │
│ health_check_failure             │ cto, ops                 │ immediate │ —        │
│ assignment.submitted             │ chief-of-staff           │ immediate │ 5 min    │
│ assignment.blocked               │ chief-of-staff           │ immediate │ 2 min    │
│ assignment.revised               │ $target_agent            │ immediate │ 2 min    │
│ message.sent                     │ $to_agent                │ heartbeat │ 5 min    │
│ meeting.completed                │ $action_item_owners      │ heartbeat │ —        │
└──────────────────────────────────┴──────────────────────────┴───────────┴──────────┘
```

---

### Orchestration Loop — Sarah → Agents → Sarah

The orchestration loop is the core autonomous work cycle. Sarah (Chief of Staff) acts as
the central dispatcher, breaking founder directives into agent assignments, evaluating
results, and synthesizing deliverables:

```
┌─────────────────────────────────────────────────────────────────────────┐
│              FOUNDER DIRECTIVE → DELIVERABLE LIFECYCLE                   │
│                                                                         │
│  ① DIRECTIVE CREATED (by founder via Dashboard or proposed by Sarah)    │
│     │  INSERT founder_directives (status='active')                      │
│     │                                                                   │
│     ▼                                                                   │
│  ② SARAH READS DIRECTIVES                                               │
│     │  read_founder_directives → get active directives + assignment      │
│     │  status summary (total/completed/pending/in_progress)             │
│     │                                                                   │
│     ▼                                                                   │
│  ③ PRE-DISPATCH VALIDATION (4 mandatory checks)                         │
│     │  ┌─────────────────────────────────────────────────────────────┐  │
│     │  │ CHECK 1 — TOOL CHECK                                       │  │
│     │  │   Does the target agent have every tool needed?             │  │
│     │  │   If not → grant_tool_access first, or reassign to         │  │
│     │  │   an agent who has the tools.                               │  │
│     │  │                                                             │  │
│     │  │ CHECK 2 — DATA DEPENDENCY CHECK                            │  │
│     │  │   Does the task require data the agent can't access?        │  │
│     │  │   If cross-domain → fetch data first, embed in instructions.│  │
│     │  │                                                             │  │
│     │  │ CHECK 3 — SPECIFICITY CHECK                                │  │
│     │  │   Is the task atomic with a clear deliverable?              │  │
│     │  │   Bad: "Do marketing." Good: "Draft 3 LinkedIn posts…"     │  │
│     │  │                                                             │  │
│     │  │ CHECK 4 — CONTEXT EMBEDDING                                │  │
│     │  │   Work-loop agents run with ~150-line task-tier prompt.     │  │
│     │  │   ALL context must be in the assignment instructions.        │  │
│     │  └─────────────────────────────────────────────────────────────┘  │
│     │                                                                   │
│     ▼                                                                   │
│  ④ SARAH CREATES & DISPATCHES ASSIGNMENTS                               │
│     │  create_work_assignments → INSERT work_assignments[]               │
│     │  dispatch_assignment → for each assignment:                        │
│     │    ├─ INSERT agent_messages (DM to target agent)                  │
│     │    ├─ POST /run → wake target agent immediately                   │
│     │    └─ UPDATE work_assignments SET status='dispatched'              │
│     │                                                                   │
│     ▼                                                                   │
│  ⑤ AGENT EXECUTES ASSIGNMENT (work loop / task tier)                    │
│     │  Heartbeat wakes agent → executeWorkLoop → P2 active work         │
│     │  Agent runs with task-tier context (~150-line prompt)              │
│     │  Agent uses submit_assignment_output OR flag_assignment_blocker    │
│     │                                                                   │
│     │  ┌─ submit_assignment_output ─┐  ┌─ flag_assignment_blocker ───┐  │
│     │  │ UPDATE work_assignments    │  │ UPDATE status='blocked'     │  │
│     │  │   status='completed'       │  │ Send urgent msg to Sarah    │  │
│     │  │   agent_output=result      │  │ Emit alert.triggered event  │  │
│     │  │ Emit assignment.submitted  │  │ Sarah wakes to handle       │  │
│     │  └────────────────────────────┘  └─────────────────────────────┘  │
│     │                                                                   │
│     ▼                                                                   │
│  ⑥ SARAH EVALUATES (woken by assignment.submitted event)                │
│     │  check_assignment_status → review agent_output                     │
│     │  evaluate_assignment →                                            │
│     │    ├─ ACCEPT (quality_score ≥ threshold)                          │
│     │    │    → status='completed', check if all assignments done       │
│     │    │                                                              │
│     │    ├─ ITERATE (needs improvement)                                 │
│     │    │    → status='needs_revision' + evaluation feedback           │
│     │    │    → Emit assignment.revised → wake target agent (P1)        │
│     │    │    → Agent re-executes with revision feedback (loop to ⑤)    │
│     │    │                                                              │
│     │    ├─ REASSIGN (wrong agent)                                      │
│     │    │    → Create new assignment for different agent               │
│     │    │                                                              │
│     │    └─ ESCALATE (founder needed)                                   │
│     │         → status='blocked', flag for founder attention            │
│     │                                                                   │
│     ▼                                                                   │
│  ⑦ POST-DIRECTIVE SYNTHESIS (all assignments completed)                 │
│     │  Sarah compiles all agent_output values into a coherent           │
│     │  deliverable for the founders.                                    │
│     │  update_directive_progress → status='completed',                  │
│     │  completion_summary=synthesized report                            │
│     │                                                                   │
│     ▼                                                                   │
│  ⑧ FOLLOW-UP PROPOSALS                                                 │
│     │  If agent outputs contain recommendations for follow-up work,     │
│     │  Sarah may propose_directive with source_directive_id linking      │
│     │  to the completed directive → founders approve/reject/edit.       │
│     │                                                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Orchestration Concurrency Model

```
Directive: "Analyze competitive landscape for Pulse"
  │
  Sarah creates 3 parallel assignments (sequence_order=0):
  ├── competitive-intel: "Research top 5 competitors' features"
  ├── seo-analyst: "Pull ranking data for competitor domains"
  └── user-researcher: "Analyze churn reasons mentioning competitors"
  
  + 1 sequential assignment (sequence_order=1):
  └── cpo: "Synthesize competitor findings into recommendations"
       depends_on: [first 3 assignments]
  
  Sarah dispatches all 3 parallel assignments immediately.
  Each agent runs via work_loop → task tier → submits output.
  Sarah evaluates each output as it comes in.
  Once all 3 parallel are accepted, Sarah dispatches the sequential one.

  EVENT-DRIVEN DEPENDENCY RESOLUTION:
  When an agent calls submit_assignment_output(status='completed'),
  dispatchDependentAssignments() fires immediately (no heartbeat wait):
    → Queries work_assignments WHERE depends_on @> [completed_id]
    → Checks if ALL dependencies are now completed
    → If so: dispatches dependent agents via POST /run (fire-and-forget)
    → CPO starts within seconds of the last parallel assignment completing
```

---

### Event Router & Authority Gates

Every agent action passes through the EventRouter, which enforces the authority model
before execution:

```
┌──────────────────────────────────────────────────────────────────┐
│                    EVENT ROUTING FLOW                             │
│                                                                  │
│  IncomingEvent { source, agentRole, task, payload }              │
│       │                                                          │
│       ▼                                                          │
│  checkAuthority(agentRole, task)                                 │
│       │                                                          │
│       ├─ GREEN (allowed=true)                                    │
│       │    → Execute immediately via agentExecutor               │
│       │    → Return output + action receipts to caller           │
│       │                                                          │
│       ├─ YELLOW (requiresApproval=true, tier='yellow')           │
│       │    → DecisionQueue.submit()                              │
│       │    → INSERT decisions (status='pending')                 │
│       │    → formatDecisionCard() → send to #decisions (Teams)   │
│       │    → ONE founder must approve                            │
│       │    → Auto-reminds every 4 hours                          │
│       │    → Auto-escalates to RED after 48 hours                │
│       │                                                          │
│       └─ RED (requiresApproval=true, tier='red')                │
│            → DecisionQueue.submit()                              │
│            → BOTH founders must approve                          │
│            → Only then does the action execute                   │
│                                                                  │
│  Source routing:                                                  │
│  ├─ scheduler  → handleSchedulerMessage (Cloud Scheduler cron)   │
│  ├─ manual     → route (Dashboard chat POST /run)                │
│  ├─ agent      → handleAgentEvent (inter-agent trigger)          │
│  ├─ event      → handleGlyphorEvent (event bus → subscribers)    │
│  └─ webhook    → route (external webhooks → agent wake)          │
└──────────────────────────────────────────────────────────────────┘
```

---

### Run Tracking & Observability

Every agent execution is wrapped by `trackedAgentExecutor`, which provides full
observability in the Activity dashboard:

```
trackedAgentExecutor(agentRole, task, payload)
  │
  ├─ INSERT agent_runs (status='running', input=message)
  │    → Row ID becomes runId
  │    → Activity dashboard shows "Running Now" banner
  │
  ├─ Call agentExecutor(agentRole, task, payload)
  │    → Full agent execution (may take 5s–120s)
  │
  └─ UPDATE agent_runs with:
       status: completed | failed | aborted
       duration_ms, turns, tool_calls
       input_tokens, output_tokens, cost
       output (text), error (if any)
       actions (ActionReceipt[] — tool call transparency)
       → Activity dashboard shows in run history
```

### Knowledge Injection

Every model call receives a composite system prompt built from multiple layers (full/standard/light
tiers). Task-tier runs use a minimal ~150-line prompt instead — see "Used in Task Tier?" column:

| Layer | Source | Size | Used in Task Tier? |
|-------|--------|------|--------------------|
| Personality Block | `agent_profiles` table → `buildPersonalityBlock()` | ~20 lines | Yes |
| Conversation Mode | Hardcoded — casual vs task detection | ~15 lines | No |
| Reasoning Protocol | Hardcoded — Orient → Plan → Execute → Reflect | ~10 lines | No |
| Action Honesty Protocol | Hardcoded — verify-before-claim, report tool results, never claim untaken actions | ~20 lines | No |
| Instruction Echo Protocol | Hardcoded — echo founder instructions back before acting, never substitute values (chat only) | ~10 lines | No |
| Work Assignments Protocol | Hardcoded — read → work → submit/flag lifecycle | ~15 lines | Yes |
| Cost Awareness Block | Hardcoded — budget constraints + efficiency rules | ~10 lines | Yes (task only) |
| Always-On Protocol | Hardcoded — P1-P5 priority stack + proactive work guidelines | ~20 lines | No |
| Skill Block | `skills` + `agent_skills` tables → `buildSkillBlock()` | ~20–50 lines | No |
| Role Brief | `company-knowledge/briefs/{name}.md` or DB `agent_briefs` | ~80 lines | No |
| Agent System Prompt | `agents/src/{role}/systemPrompt.ts` | ~30 lines | No |
| Company Knowledge Base | DB `company_knowledge_base` (or static `CORE.md` fallback) | ~400 lines | No |
| Founder Bulletins | DB `founder_bulletins` (priority-coded, expiration-filtered) | variable | No |

The **Personality Block** (WHO YOU ARE section) includes:
- Personality summary (voice monologue — the primary personality driver)
- Voice calibration examples (few-shot situation/response pairs)
- Role-specific anti-patterns ("never say X, say Y")
- Generic anti-pattern rules (no filler, no corporate jargon, no AI self-reference)
- Signature sign-off

> **Note:** Fields like `backstory`, `communication_traits`, `quirks`, `tone_formality`,
> `verbosity`, and `voice_sample` are stored in the DB and displayed on the dashboard
> but are **not injected into agent prompts**. The prompt personality block is intentionally
> slim to save tokens (~20 lines vs the old ~40-line version).

### RunDependencies

The `BaseAgentRunner.run()` method accepts optional dependencies (via `ClassifiedRunDependencies`):

| Dependency | Purpose |
|-----------|---------|
| `glyphorEventBus` | Emit inter-agent events |
| `agentMemoryStore` | Prior memories + reflections |
| `dynamicBriefLoader` | DB-stored briefs for agents without file-based briefs |
| `agentProfileLoader` | Load personality profile from `agent_profiles` table |
| `pendingMessageLoader` | Load unread inter-agent messages for injection |
| `skillContextLoader` | Load assigned skills and proficiency for context |
| `graphContextLoader` | Load knowledge graph neighborhood for context |
| `partialProgressSaver` | Save partial output when a task-tier run is aborted (updates `work_assignments`, notifies chief-of-staff) |
| `sharedMemoryLoader` | 5-layer shared memory (Working, Episodic, Semantic, Procedural, WorldModel) — cross-agent context via `shared_episodes` and `shared_procedures` tables |
| `worldModelUpdater` | REFLECT→LEARN→IMPROVE loop — evolves per-agent self-models in `agent_world_model` after graded evaluations. **Also auto-updates after every orchestrator/task run** via self-assessment (baseline 4.0, ±0.5 for efficiency/errors, clamped [1.0, 5.0]) to ensure continuous world model population without waiting for CoS grading. |

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
| `clo` | `victoria-chase.md` |
| `vp-research` | `sophia-lin.md` |
| `competitive-research-analyst` | `lena-park.md` |
| `market-research-analyst` | `daniel-okafor.md` |
| `technical-research-analyst` | `kai-nakamura.md` |
| `industry-research-analyst` | `amara-diallo.md` |
| `global-admin` | `morgan-blake.md` |
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
| `head-of-hr` | `jasmine-rivera.md` |
| `enterprise-account-researcher` | `ethan-morse.md` |
| `bob-the-tax-pro` | `robert-finley.md` |
| `data-integrity-auditor` | `grace-hwang.md` |
| `tax-strategy-specialist` | `mariana-solis.md` |
| `lead-gen-specialist` | `derek-owens.md` |
| `marketing-intelligence-analyst` | `zara-petrov.md` |
| `adi-rose` | `adi-rose.md` |
| `ai-impact-analyst` | `riya-mehta.md` |
| `org-analyst` | `marcus-chen.md` |

### ModelClient — Multi-Provider LLM

The `ModelClient` is a thin facade that delegates to per-provider adapters in `providers/`.
Each adapter implements the `ProviderAdapter` interface (`generate()` + `generateImage()`) and
handles provider-specific conversation mapping, response parsing, and feature negotiation.
`ProviderFactory` lazily creates and caches a singleton adapter per provider.

```
ModelClient.generate(request)
  → detectProvider(model)           // gemini-* | gpt-*/o[134]* | claude-*
  → ProviderFactory.get(provider)   // lazy singleton
  → adapter.generate(request)       // provider-specific API call
  → raceAbort(promise, signal)      // shared timeout/abort racing
  → UnifiedModelResponse            // common response shape
```

| Provider | Model Prefixes | Auth | Adapter | Features |
|----------|---------------|------|---------|----------|
| Google Gemini | `gemini-*` | `GOOGLE_AI_API_KEY` env var | `GeminiAdapter` | Function calling, thinkingLevel (3.x) / thinkingBudget (2.5), thought signatures, Imagen image gen, normalizeFinishReason (STOP→stop) |
| OpenAI | `gpt-*`, `/^o[134](-\|$)/` | `OPENAI_API_KEY` env var | `OpenAIAdapter` | Function calling, reasoning_effort (o-series/GPT-5), max_completion_tokens, gpt-image-1, normalizeFinishReason (stop→stop) |
| Anthropic | `claude-*` | **Vertex AI on GCP** — IAM auth via `AnthropicVertex` SDK (`@anthropic-ai/vertex-sdk`). Uses GCP project ID + region (default `us-east5`). No API key needed — authenticates via service account IAM (`roles/aiplatform.user`). | `AnthropicAdapter` | Tool use, extended thinking (adaptive for claude-opus-4, no `effort` field), max_tokens 16384 default, unique tool_use IDs with per-call index, normalizeFinishReason (end_turn→stop) |

All providers normalize `finishReason` to a lowercase `'stop'` | `'length'` | `'tool_calls'` | `'error'`
contract via `normalizeFinishReason()` so runners can check `=== 'stop'` uniformly.

Agents use a **tiered model system** managed by `optimizeModel(role, task, dbModel?)` in
`@glyphor/shared/models.ts`. Default model: `gpt-5-mini-2025-08-07`. Cost tiers:

| Tier | Model | $/1K Input / $/1K Output | Roles |
|------|-------|--------------------------|-------|
| **Economy** | `gemini-2.5-flash-lite` | $0.10 / $0.40 | support-triage, onboarding-specialist, m365-admin, global-admin, seo-analyst, cost-analyst |
| **Standard** | `gemini-2.5-flash` | $0.30 / $2.50 | content-creator, ui-ux-designer, frontend-engineer, user-researcher, vp-customer-success, vp-sales, vp-design |
| **Pro** | `gemini-3-flash-preview` | $0.50 / $3.00 | chief-of-staff, cto, cfo, cpo, cmo, clo, vp-research, ops |
| **Exec Chat** | `gemini-3-flash-preview` | $0.50 / $3.00 | All pro roles during on-demand chat |

Agents can be switched to any supported model via the dashboard Settings tab.
Multi-provider support is built in for fallback.

**Supported models (dashboard dropdowns):**
- **Gemini:** gemini-3.1-pro-preview, gemini-3-flash-preview, gemini-3-pro-preview, gemini-2.5-flash, gemini-2.5-flash-lite, gemini-2.5-pro
- **OpenAI:** gpt-5.2, gpt-5.2-pro, gpt-5.1, gpt-5, gpt-5-mini, gpt-5-nano, gpt-4.1, gpt-4.1-mini, o3, o4-mini
- **Anthropic (via Vertex AI):** claude-opus-4-6, claude-sonnet-4-6, claude-sonnet-4-5, claude-haiku-4-5

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

### Reasoning Engine Layer

Added 2026-02-28. Three new modules provide advanced reasoning, targeted context retrieval,
and Redis-backed caching. All are optional layers on top of the existing execution loop.

#### ReasoningEngine (`reasoningEngine.ts`)

Multi-pass verification and cross-model consensus engine. Wraps the model call loop with
structured verification passes to improve output quality for high-stakes decisions.

Pass types: `self_critique`, `consistency_check`, `factual_verification`, `goal_alignment`,
`cross_model`, `value_analysis`.

Returns a `ReasoningResult` with `overallConfidence`, `passes[]`, and `suggestions`.
Supports value gating — outputs below a confidence threshold can be blocked or flagged.

Verification models:
- `gpt-5.2-2025-12-11` (OpenAI)
- `claude-opus-4-6` (Anthropic — via Vertex AI)
- `gemini-3-flash-preview` (Google — same as primary)

#### JitContextRetriever (`jitContextRetriever.ts`)

Just-In-Time context retrieval replaces the tier-based "load everything" approach with
targeted semantic retrieval. Given a task description, it:
1. Embeds the task for semantic search
2. Queries all stores in parallel (memories, graph nodes, episodes, procedures, knowledge)
3. Scores results by relevance
4. Trims to a token budget

Returns: `relevantMemories`, `relevantGraphNodes`, `relevantEpisodes`, `relevantProcedures`,
`relevantKnowledge` — with Redis cache support for repeated queries.

#### RedisCache (`redisCache.ts`)

Redis cache layer for GCP Memorystore via `ioredis`. Provides typed `get`/`set`/`getOrSet`
with TTL management. Graceful degradation — all operations return `null` when Redis is
unavailable. Singleton pattern for shared access across the process.

Key patterns: `jit:{hash}`, `directive:{id}`, `profile:{role}`, `reasoning:{hash}`,
`wave:{id}`, `kb:{section}`, `bulletin:{dept}`.

#### ToolRegistry (`toolRegistry.ts`)

Central tool lookup that maps tool names to an availability flag. Two sources:
static `KNOWN_TOOLS` set (compiled in) and dynamic `tool_registry` DB table. Lets the
skill system and dynamic grant system verify tool availability without importing every
tool module. Grant requests for unknown tools are rejected with a message to ask the CTO
to build it first.

**Auto-grant pipeline**: When an agent calls any tool in the `KNOWN_TOOLS` set that it hasn't
been granted, `toolExecutor.ts` auto-grants and retries — the model never sees "Not granted"
for known tools. At agent startup, `companyAgentRunner.ts` bulk-inserts all static tools into
`agent_tool_grants` (fire-and-forget `INSERT ON CONFLICT DO NOTHING`). Startup also logs a
tool inventory (static count, DB count, total) and warns on declared-vs-static mismatches.

#### Dynamic Tool Executor (`dynamicToolExecutor.ts`)

Enables tools registered via `request_new_tool` → CTO approval → `register_tool` to be
**actually executable at runtime** without code deploys. Closes the self-service tool creation
loop: agents can request new tools, the CTO can register them in the `tool_registry` DB table
with API configuration, and the dynamic executor runs them on demand.

**Tool execution pipeline** (`toolExecutor.ts`):

```
ToolExecutor.execute(toolName, params)
  │
  ├─ 1. Static tool map (code-defined tools from run.ts + core + MCP)
  │     → Found? Execute directly
  │
  ├─ 2. runtime_ prefix tools (runtimeToolFactory.ts)
  │     → Match? Execute synthesized tool
  │
  ├─ 3. Dynamic registry fallback (dynamicToolExecutor.ts)
  │     → isKnownToolAsync(toolName)? Load from tool_registry DB
  │     → type='api' → executeApiTool (templated HTTP call)
  │     → type!='api' → return metadata-only error (no executor for type)
  │
  └─ 4. "Unknown tool" error
```

**API tool execution** (`executeApiTool`):
- URL template interpolation with URL-encoding: `https://api.example.com/v1/{resource_id}`
- Header templates with auth modes: `bearer_env` (env var → `Authorization: Bearer`),
  `header_env` (env var → custom header), `none`
- Body template interpolation (string or nested object)
- Response extraction via dot-path: `data.results` → navigates nested JSON
- Timeout: 30 seconds per call

**LLM tool declarations** (`loadDynamicToolDeclarations`):
- On turn 1, `companyAgentRunner.ts` calls `loadDynamicToolDeclarations(staticToolNames)`
- Loads all active entries from `tool_registry` DB as `GeminiToolDeclaration[]`
- Excludes tools already in the static set (prevents duplicates)
- Merges into `effectiveTools` sent to the LLM so it can discover and call dynamic tools
- 60-second cache to avoid per-run DB queries

**Database**: `tool_registry` table with columns `name`, `description`, `type` (api/sql/custom),
`config` (JSONB — url_template, method, headers, body_template, auth, response_path),
`parameters` (JSONB — tool parameter schema), `is_active`.

### Intelligence Engine Enhancements

Added 2026-02-28. Eight cross-cutting modules that strengthen agent governance,
trust calibration, decision traceability, formal safety, causal reasoning,
output verification, organizational learning, and behavioral stability.
All are opt-in via `ClassifiedRunDependencies` and degrade gracefully when
their backing tables haven't been migrated.

#### 1. Constitutional Agent Governance (`constitutionalGovernor.ts`, `constitutionDefaults.ts`)

Every agent runs under a **constitution** — a versioned set of principles organized by
category (`safety`, `accuracy`, `transparency`, `efficiency`, `collaboration`, `ethics`).
Constitutions are stored in `agent_constitutions` and seeded on first access from
`constitutionDefaults.ts` (role-specific defaults for each executive + analyst fallback set).

After each run, the governor evaluates the agent's output against its constitution via a
distiller-model LLM call and records a `ConstitutionalEvaluation` (per-principle pass/fail,
overall compliance score 0–1, suggested revisions). Evaluations are persisted in
`constitutional_evaluations` and feed the trust scorer.

Agents can propose constitutional amendments (via `proposed_constitutional_amendments`);
the Episodic Replay process reviews and escalates them.

**Integration points:**
- `baseAgentRunner.ts` — pre-loads constitution before prompt build; evaluates output after
  reasoning verification; records evaluation and applies trust delta.
- `orchestratorRunner.ts` / `taskRunner.ts` — inject active constitutional principles into
  the system prompt so the LLM is aware of its governing rules.

Tables: `agent_constitutions`, `constitutional_evaluations`, `proposed_constitutional_amendments`.

#### 2. Dynamic Trust Scoring (`trustScorer.ts`)

Each agent carries a continuous trust score (0–1, default 0.7) that modulates its effective
authority tier. Trust decays or grows based on nine signal sources:

| Source | Weight | Direction |
|--------|--------|-----------|
| `reasoning_confidence` | 1.0 | ± |
| `reasoning_verification` | 0.8 | ± |
| `constitutional_adherence` | 1.2 | ± |
| `constitutional_eval` | 1.0 | ± |
| `peer_feedback` | 0.6 | ± |
| `human_override` | 2.0 | − (penalty) |
| `formal_failure` | 1.5 | − (penalty) |
| `reflection_quality` | 0.4 | ± |
| `drift_detection` | 1.0 | − (penalty) |

Trust is clamped to `[0.1, 1.0]` and cached in Redis (`trust:{role}`, 5 min TTL).
`getEffectiveAuthority()` maps the trust score to a `DecisionTier`:
- `≥ 0.7` → agent's own tier
- `0.4–0.7` → demoted one tier (yellow → red, green → yellow)
- `< 0.4` → forced to `red` (human approval required for all actions)

Table: `agent_trust_scores` (with DB-side `update_trust_score()` function for atomic updates).

#### 3. Provenance Decision Chains (`decisionChainTracker.ts`)

Every orchestration or multi-step reasoning flow is tracked as a **decision chain** — an
ordered list of links recording who did what, when, and why.

Each `ChainLink` captures: `agent_role`, `action`, `input_summary`, `output_summary`,
`confidence`, `reasoning_passes`, `timestamp`, and optional `metadata`.

Links are batched (10 links or 5 s flush timer) and written to `decision_chains` via the
`append_chain_links()` Postgres function. Chains also record `computeContributions()` —
per-agent link count and average confidence — for post-hoc accountability audits.

Table: `decision_chains` (JSONB `links` array, `contributions` JSON, `status` enum).

#### 4. Formal Verification Gates (`formalVerifier.ts`)

Pure deterministic verification checks that run **before** high-impact tool calls
(budget writes, financial mutations). No LLM involved — all checks are algorithmic.

| Verifier | What it checks |
|----------|---------------|
| `verifyArithmetic(expr, claimed)` | Safe recursive-descent parser evaluates the expression and compares to the agent's claimed result (tolerance: 0.001). No `eval()`. |
| `verifyDependencyGraph(nodes, edges)` | DFS cycle detection on task/dependency graphs. |
| `verifyBudgetConstraint(proposed, limit, current)` | `current + proposed ≤ limit`. |
| `verifySchedule(items)` | Detects time-range overlaps and resource double-booking. |
| `verifyInvariant(name, value, constraint)` | Generic min/max/equals/not_equals constraint check. |

Each returns a `VerificationResult` (`{ passed, details }`). In `toolExecutor.ts`, a budget
verification gate fires before every write tool when enforcement is active — failures block
the tool call.

#### 5. Counterfactual Causal Reasoning (`graphWriter.ts`, `graphReader.ts` extensions)

Extends the Knowledge Graph with typed causal edges (`CAUSAL_INFLUENCES`) carrying:
- `causal_confidence` (0–1) — strength of the causal link
- `causal_lag` (interval) — estimated delay between cause and effect
- `causal_mechanism` (text) — human-readable explanation of the causal pathway

New KG methods:
- `upsertCausalEdge(source, target, confidence, lag?, mechanism?)` — idempotent
  create/update of causal edges between KG nodes.
- `updateCausalConfidence(edgeId, newConfidence)` — refine confidence as evidence accrues.
- `traceCausalImpact(nodeTitle, maxDepth?)` — multi-hop BFS traversal returning upstream
  causes and downstream effects with confidence and mechanism at each hop.

Migration: `ALTER TABLE kg_edges ADD COLUMN causal_confidence, causal_lag, causal_mechanism`,
`ALTER TABLE shared_episodes ADD COLUMN significance_score`.

#### 6. Verifier Agents — Dual-Track Verification (`verifierRunner.ts`)

Cross-model verification layer on top of the Reasoning Engine. When an agent produces a
high-stakes output, the verifier re-evaluates it using a **different LLM provider**:

| Primary model family | Verifier model |
|---------------------|---------------|
| Gemini | Claude |
| OpenAI | Gemini |
| Claude | Gemini |

The verifier receives the original task + agent output + formal check results and returns
a `VerificationReport` with:
- `verdict`: `APPROVE` / `WARN` / `ESCALATE` / `BLOCK`
- Per-dimension scores: `factual_accuracy`, `logical_consistency`, `authority_compliance`,
  `risk_assessment` (each 0–1)
- `issues[]` with severity and descriptions
- `suggestions[]` for improvement

Designed for extension — currently invokable manually; can be wired into the run loop for
automatic dual-track verification on red-tier decisions.

#### 7. Episodic Replay (`episodicReplay.ts`)

Scheduled process (runs every **2 hours**) that performs organizational learning:

1. Fetches recent agent episodes + high-significance past episodes from `shared_episodes`.
2. Groups episodes and sends them to an LLM for pattern analysis.
3. Updates `significance_score` on episodes to surface important ones in future replays.
4. Reviews pending constitutional amendment proposals and escalates approved ones.
5. Updates `company_pulse.highlights` with newly discovered cross-agent patterns.

Requires an `EmbeddingClient`-compatible object for semantic similarity during
deduplication. Uses Redis locking (`episodic-replay-lock`, 30 min TTL) to prevent
overlapping runs.

#### 8. Semantic Drift Detection (`driftDetector.ts`)

Scheduled process (runs every **6 hours**) that monitors behavioral stability per agent:

1. Computes a **30-day baseline** (mean + stddev) for each metric per agent.
2. Computes a **7-day recent window** for the same metrics.
3. Flags any metric deviating **> 2σ** from baseline as a drift alert.
4. For severe drift (> 2.5σ degradation in confidence or compliance), automatically
   applies a negative trust delta.
5. Persists alerts to `drift_alerts` with `severity` (`low` / `medium` / `high` / `critical`).

Tracked metrics: `reasoning_confidence`, `cost_per_run`, `reasoning_passes`,
`tokens_used`, `constitutional_compliance`.

Table: `drift_alerts` (agent_id, metric, baseline_mean, baseline_stddev, recent_mean,
deviation_sigma, severity, acknowledged).

#### New Database Tables Summary

| Table | Enhancement | Key Columns |
|-------|------------|-------------|
| `agent_constitutions` | Constitutional Governance | `agent_role`, `principles` (JSONB), `version` |
| `constitutional_evaluations` | Constitutional Governance | `run_id`, `agent_role`, `compliance_score`, `evaluation` (JSONB) |
| `proposed_constitutional_amendments` | Constitutional Governance | `proposing_agent`, `principle_id`, `rationale`, `status` |
| `agent_trust_scores` | Trust Scoring | `agent_role` (unique), `trust_score`, `total_positive/negative_signals` |
| `decision_chains` | Decision Chains | `chain_id`, `links` (JSONB), `status`, `contributions` (JSONB) |
| `drift_alerts` | Drift Detection | `agent_id`, `metric`, `deviation_sigma`, `severity` |

Altered tables: `kg_edges` (+`causal_confidence`, `causal_lag`, `causal_mechanism`),
`shared_episodes` (+`significance_score`).

---

### Inter-Agent Event Bus

The `GlyphorEventBus` enables reactive communication between agents. When an agent emits an
event (e.g., `insight.detected`, `alert.triggered`), the scheduler checks the subscription map
and can wake other agents in response.

Event types: `agent.completed`, `insight.detected`, `decision.filed`, `decision.resolved`,
`alert.triggered`, `task.requested`, `agent.spawned`, `agent.retired`, `message.sent`,
`meeting.called`, `meeting.completed`, `assignment.submitted`, `assignment.blocked`,
`assignment.revised`.

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

Factory function `createCommunicationTools(db, glyphorEventBus, schedulerUrl?)` returns
three `ToolDefinition[]` items available to all agents:

| Tool | Description |
|------|------------|
| `send_agent_message` | Send a DM to another agent (validates recipient, rate limited) |
| `check_messages` | Check for pending messages, marks as read, returns with thread_id |
| `call_meeting` | Convene a multi-agent meeting (validates attendees, rate limited) |

### Assignment Tools

Factory function `createAssignmentTools(db, glyphorEventBus)` returns three `ToolDefinition[]`
items available to all agents, closing the Sarah → agent → Sarah orchestration loop:

| Tool | Description |
|------|------------|
| `read_my_assignments` | Read pending work assignments from Sarah. Joins `work_assignments` with `founder_directives` for context. Filters by status (default: actionable). Returns instructions, expected output, priority, directive context, and feedback for revisions. |
| `submit_assignment_output` | Submit completed work for a specific assignment. Verifies ownership, updates `work_assignments`, sends notification to chief-of-staff, emits `assignment.submitted` event, **triggers dependency resolution** (dispatches agents whose `depends_on` are now all met), logs to `activity_log`. Supports `completed` and `in_progress` statuses. |
| `flag_assignment_blocker` | Flag an assignment as blocked. Verifies ownership, sets status to `blocked`, sends urgent message to chief-of-staff with need type (tool_access, data_access, peer_help, founder_input, external_dependency, unclear_instructions, other), emits `alert.triggered` event. |

### Agent Budget Caps

Each agent role has per-run, daily, and monthly USD cost caps defined in `AGENT_BUDGETS`.
Budget caps are set for 24/7 autonomous operations where agents run multiple times per day
via the work loop:

| Tier | Per Run | Daily | Monthly |
|------|---------|-------|---------|
| Chief of Staff | $0.10 | $5.00 | $150 |
| CTO | $0.10 | $4.00 | $120 |
| Ops (Atlas) | $0.08 | $3.00 | $90 |
| CFO | $0.08 | $2.00 | $60 |
| CPO | $0.08 | $2.00 | $60 |
| CMO | $0.08 | $2.00 | $60 |
| VP Customer Success / VP Sales / VP Design | $0.05 | $1.50 | $45 |
| Sub-team (all) | $0.05 | $1.00 | $30 |

### Dynamic Tool Grants

Sarah (Chief of Staff) can dynamically grant or revoke existing tools to any agent at runtime
via the `agent_tool_grants` database table. This enables just-in-time capability expansion
without code changes.

**Runtime enforcement** (`toolExecutor.ts`): Before executing any tool call, `ToolExecutor`
checks `isToolGranted(agentRole, toolName, db)`. Grants are cached per-role for 60 seconds
to avoid per-call DB queries. Cache is invalidated immediately on grant/revoke. **Auto-grant:**
When any tool in the `KNOWN_TOOLS` set is called but not granted, `toolExecutor` auto-grants
it and retries — the model never sees "Not granted" for known tools (was previously read-only
only, now covers all known tools).

**Static tool bypass**: Tools defined in an agent's code (`this.tools` Map) always execute
regardless of DB grant state. Missing DB grants are auto-synced on first use (fire-and-forget
INSERT). Non-static tools that fail the grant check return an actionable error message directing
the agent to use `request_tool_access`.

**Agent self-recovery**: Agents are instructed (via `ALWAYS_ON_PROTOCOL` and `REASONING_PROTOCOL`
in `companyAgentRunner.ts`) to never tell the user "I don't have access." Instead:

1. On tool access denial → immediately call `request_tool_access` (self-grants)
2. Retry the original operation
3. If tool doesn't exist → call `request_new_tool` (files Yellow decision for CTO)
4. Only use `flag_assignment_blocker` for non-tool blockers (credentials, external systems)

**Chief of Staff tools** (`chief-of-staff/tools.ts`):

| Tool | Description |
|------|-------------|
| `grant_tool_access` | Grant an existing tool to an agent. Read-only tools (`get_*`, `read_*`, `query_*`, `check_*`, `fetch_*`) are granted autonomously; write tools auto-file a Yellow decision for founder approval. Supports optional `expires_in_hours` for time-boxed grants. |
| `revoke_tool_access` | Revoke a dynamically granted tool. Only affects DB-granted tools — an agent's baseline (code-defined) tools cannot be revoked. |

**Self-service tools** (`toolRequestTools.ts` — available to all agents):

| Tool | Description |
|------|-------------|
| `request_tool_access` | Self-grant access to an existing tool. Read-only tools auto-approved immediately; write tools auto-approved but logged for founder awareness. |
| `request_new_tool` | Request a tool that doesn't exist yet. Validates name format, checks for duplicates, auto-files a Yellow decision for CTO review. |
| `check_tool_request_status` | Query pending/approved tool requests by ID or list all for the agent. |

**Tool Registry** (`toolRegistry.ts`): Central registry of all known tools via `isKnownTool(name)`.
Grant requests for tools not in the registry are rejected with a message to ask Marcus (CTO) to build it first.

**Database**: `agent_tool_grants` table with columns `agent_role`, `tool_name`, `granted_by`,
`reason`, `directive_id`, `scope`, `is_active`, `expires_at`. Unique constraint on
`(agent_role, tool_name)`. Seeded with baseline grants for all 37 agents.

### Action Honesty System

Multi-layered defense against agents claiming actions they didn't take or that failed
silently. Addresses the trust problem where agents narrate intentions as completed actions.

**Layer 1 — Prompt-level protocols** (`companyAgentRunner.ts`):

| Protocol | Tier | Purpose |
|----------|------|---------|
| `ACTION_HONESTY_PROTOCOL` | All | 5 rules: call-before-claim, report tool result not hopes, verify mutations, never claim untaken actions, fix without excuses |
| `INSTRUCTION_ECHO_PROTOCOL` | Chat only | Echo founder instructions back before acting, ask if ambiguous, never substitute different values |

**Layer 2 — Last-turn fabrication prevention** (`companyAgentRunner.ts`):

On-demand and task-tier runs inject honesty constraint messages when approaching turn limits:
- **Penultimate turn**: Warning injected: "You have ONE turn remaining. Do NOT claim actions you haven't completed."
- **Last turn**: Tools stripped + constraint injected: "FINAL TURN — only describe actions that ALREADY executed successfully."

**Layer 3 — Structured action receipts** (`companyAgentRunner.ts` → `eventRouter.ts` → `Chat.tsx`):

Every tool call during a run produces an `ActionReceipt` recording the tool name, parameters,
success/error status, and output summary. Receipts flow through the full stack:

```
ToolExecutor.execute() → actionReceipts[] → AgentExecutionResult.actions
  → RouteResult.actions → POST /run response → Chat UI (collapsible tool log)
```

Chat UI renders receipts as a collapsible "Actions (N tool calls)" section below agent text,
showing ✓/✗ status per tool call with output summaries.

**Layer 4 — Automatic mutation verification** (`toolExecutor.ts`):

After a mutation tool (`update_*`, `create_*`, `delete_*`, etc.) executes successfully,
ToolExecutor automatically calls the corresponding read tool to verify the write:

| Mutation Tool | Verification Tool | Param Key |
|--------------|-------------------|-----------|
| `update_agent_profile` | `get_agent_profile` | `agent_role` |
| `update_company_knowledge` | `get_company_knowledge` | `id` |

Verification results are appended as `_verification` to the tool output data. Costs one extra
tool call per mutation but prevents the entire class of wrong-value writes.

**Layer 5 — Parameter echo** (mutation tool implementations):

Mutation tools return a `written` field echoing what was actually written, exposing parameter
mismatches immediately. Example: `{ success: true, data: {...}, written: { member, role, action: 'grant_role' } }`.

**Layer 6 — Unsubstantiated claim detection** (`companyAgentRunner.ts`):

Post-loop safety net for chat (on_demand) runs. Regex patterns match action claims in agent
text ("I've updated", "I've corrected", etc.) and compare against actual tool receipts. If
claims exist but no successful mutation tools were executed, a disclaimer is appended:
"⚠️ Some actions mentioned above may not have completed."

### Design Team Tooling

Mia's design team (Leo, Ava, Sofia, Ryan) has specialized tools for frontend code access,
visual inspection, design system governance, quality auditing, and external integrations.

**Shared tool files** (`packages/agents/src/shared/`):

| File | Tools | Purpose |
|------|-------|---------|
| `frontendCodeTools.ts` | 7 | Path-scoped read/write/search to frontend dirs only. Write restricted to `feature/design-*` branches. Blocks `agent-runtime/`, `scheduler/`, `infra/`, `.github/`. |
| `screenshotTools.ts` | 4 | Visual capture via Playwright service (`SCREENSHOT_SERVICE_URL`). Page screenshots, component isolation, visual diff, responsive check at 5 breakpoints. |
| `designSystemTools.ts` | 7 | Design token management, component inventory, token-vs-implementation validation, color palette with WCAG contrast ratios, typography scale extraction. |
| `auditTools.ts` | 6 | Lighthouse via PageSpeed Insights, accessibility via axe-core, AI-smell detection, brand compliance, bundle size analysis, CI build error checks. |
| `assetTools.ts` | 5 | DALL-E 3 image generation (with brand-constrained mode), asset upload to GCS, listing, optimization (WebP/AVIF), favicon set generation. |
| `scaffoldTools.ts` | 4 | Component/page scaffolding from 7 templates (card, page, layout, widget, form, modal, table) with optional test + Storybook story files. |
| `deployPreviewTools.ts` | 3 | Vercel preview deployments from design branches, deployment status, listing. |
| `figmaAuth.ts` | — | OAuth token manager: exchange, cache, auto-refresh. Uses `FIGMA_CLIENT_ID`/`FIGMA_CLIENT_SECRET`. |
| `figmaTools.ts` | 17 | Full Figma REST API: file content, components, styles, comments, metadata, version history, projects, dev resources, webhooks. |
| `storybookTools.ts` | 7 | Story listing from `index.json`, individual/batch screenshots, visual regression diffing, baseline management, component coverage analysis. |

**Tool distribution by agent:**

| Agent | Code | Screenshots | Design System | Audits | Assets | Scaffold | Deploy | Figma | Storybook | Total New |
|-------|------|-------------|---------------|--------|--------|----------|--------|-------|-----------|-----------|
| Mia (VP Design) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~60 |
| Leo (UI/UX) | ✓ | ✓ | ✓ | — | ✓ | — | — | ✓ | — | ~36 |
| Ava (Frontend) | ✓ | ✓ | — | ✓ | — | ✓ | ✓ | — | ✓ | ~31 |
| Sofia (Critic) | ✓ | ✓ | ✓ | ✓ | — | — | — | ✓ | ✓ | ~48 |
| Ryan (Template) | ✓ | — | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | ~40 |

**Authority levels:**

| Action | Level | Who |
|--------|-------|-----|
| Read code, screenshots, tokens, audits | GREEN | All design team |
| Write code on `feature/design-*` branches | GREEN | Ava, Ryan |
| Create design branches | GREEN | Mia |
| Generate images, upload assets | GREEN | Leo, Ryan |
| Create PRs, deploy previews, update design tokens | YELLOW | Mia |

**Infrastructure dependencies:**

- `SCREENSHOT_SERVICE_URL` — Playwright Cloud Function/Cloud Run (screenshots + audits)
- `STORYBOOK_URL` — Deployed Storybook static site
- `FIGMA_CLIENT_ID` + `FIGMA_CLIENT_SECRET` — Figma OAuth credentials (Secret Manager)
- `ASSET_SERVICE_URL` — Asset storage API (optional, falls back to GCS path)
- `OPENAI_API_KEY` — Already configured, used for DALL-E 3 image generation

### Agent 365 — Microsoft M365 MCP Integration

Agent 365 provides MCP (Model Context Protocol) servers that give Glyphor agents native access
to Microsoft 365 services. A two-tier bridge converts Microsoft's MCP tool schemas into Glyphor's
`ToolDefinition` format.

**Architecture:**

```
Agent run.ts → createAgent365McpTools(serverFilter?)
  → agent365Tools.ts (gate check: AGENT365_ENABLED='true')
  → integrations/agent365/index.ts (MCP bridge)
  → @microsoft/agents-a365-tooling SDK
  → MSAL client credentials auth (Azure Entra)
  → Microsoft MCP servers (agent365.svc.cloud.microsoft)
```

**MCP Servers (6 active):**

| Server | Scope | Capabilities |
|--------|-------|-------------|
| `mcp_MailTools` | `McpServers.Mail.All` | Send, schedule, search Outlook email |
| `mcp_CalendarTools` | `McpServers.Calendar.All` | Events, availability, scheduling |
| `mcp_ODSPRemoteServer` | `McpServers.OneDriveSharepoint.All` | OneDrive/SharePoint file access |
| `mcp_TeamsServer` | `McpServers.Teams.All` | Teams messaging, channels |
| `mcp_M365Copilot` | `McpServers.CopilotMCP.All` | M365 Copilot API |
| `mcp_WordServer` | `McpServers.Word.All` | Word document create/read, comments |

**Agents using Agent 365 tools (~25):**
- **C-Suite:** chief-of-staff, cto, cfo, cmo, cpo, clo
- **Ops/Admin:** ops, global-admin, m365-admin
- **Research:** vp-research, all 5 research analysts, competitive-intel, account-research, cost-analyst, org-analyst
- **Design:** ui-ux-designer, design-critic, vp-design, template-architect
- **Other:** vp-sales, content-creator, devops-engineer
- **Dynamic agents:** All DB-defined agents (via `runDynamicAgent.ts`)

Most agents filter to `['mcp_CalendarTools', 'mcp_TeamsServer', 'mcp_M365Copilot']`.

**Configuration files (repo root):**

| File | Purpose |
|------|---------|
| `a365.config.json` | Static tenant/subscription/app IDs, Azure resource group (`glyphor-agent365`) |
| `a365.generated.config.json` | Generated blueprint state (blueprint app ID, service principal) |
| `ToolingManifest.json` | Registry of 14 MCP server URLs + scopes (5 Microsoft + 9 Glyphor) |

**Entra ID apps:**
- **Client app:** `06c728b6-0111-4cb1-a708-d57c51128649` (Glyphor AI Bot)
- **True Agent Identity Blueprint:** `b47da287-6b05-4be3-9807-3f49047fbbb8` (AgentIdentityBlueprint, SP: `525e859f-29d9-4fa2-80a9-debc2a2576bb`)
- **Glyphor app (MCP auth):** `5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a` (MSAL client credentials for MCP SSE, SP: `28079457-37d9-483c-b7bb-fe6920083b8e`)

**Dependencies:** `@microsoft/agents-a365-runtime`, `@microsoft/agents-a365-tooling` (`^0.1.0-preview.115`), `@azure/msal-node`

### Entra Agent Identity Architecture

Every Glyphor agent has a first-class **Microsoft Entra Agent Identity** — not a regular
service principal or user account, but a purpose-built identity type
(`@odata.type: #microsoft.graph.agentIdentity`, `servicePrincipalType: ServiceIdentity`).
This gives agents their own M365 presence (mailbox, calendar, Teams) backed by proper
identity governance.

**Three-layer identity model:**

```
┌────────────────────────────────────────────────────┐
│  Agent Identity Blueprint (App Registration)       │
│  @odata.type: AgentIdentityBlueprint               │
│  App ID: b47da287-6b05-4be3-9807-3f49047fbbb8      │
│  SP: 525e859f-29d9-4fa2-80a9-debc2a2576bb          │
│  Sponsor: kristina@glyphor.ai                      │
├────────────────────────────────────────────────────┤
│  44 Agent Identity SPs (ServiceIdentity)           │
│  @odata.type: #microsoft.graph.agentIdentity       │
│  Created via POST /beta/servicePrincipals/         │
│    Microsoft.Graph.AgentIdentity                   │
│  Each points to blueprint via                      │
│    agentIdentityBlueprintId                        │
│  IDs: scripts/agent-identity-real-ids.json         │
├────────────────────────────────────────────────────┤
│  37+ Agent User Accounts (Member users)            │
│  e.g. sarah@glyphor.ai, marcus@glyphor.ai          │
│  Licensed: MICROSOFT_AGENT_365_TIER_3              │
│  Mailbox type: SharedMailbox (most) or             │
│    UserMailbox (7 agents with full license)         │
└────────────────────────────────────────────────────┘
```

**Permission model:**

| Target | Method | Details |
|--------|--------|---------|
| M365 MCP servers (Calendar, Teams, Copilot) | `oauth2PermissionGrants` (admin consent) | Delegated permissions on M365 Agent Tools API (`ea9ffc3e-...`). `consentType: AllPrincipals`, requires `expiryTime`. |
| Glyphor app roles (per-agent scopes) | `appRoleAssignments` | 22 app roles on Glyphor app SP (`5604df3b-...`). 80 assignments across 44 agents. |

**Key distinction:** Agent Identity SPs hold the permissions (oauth2 grants + app roles).
User accounts hold the mailbox and license. Deleting a user account does NOT affect the
agent identity SP or its permissions.

**M365 MCP scopes assigned to all agents:**
- `McpServers.Calendar.All` — Calendar access
- `McpServers.Teams.All` — Teams messaging
- `McpServers.CopilotMCP.All` — M365 Copilot API

**Critical lessons learned:**
- Regular SPs (`servicePrincipalType: Application`) are NOT valid agent identities
- `agentIdentityBlueprintId` on user objects is **read-only** — cannot be set via Graph API
- Agent APIs reject tokens with `Directory.AccessAsUser.All` (Azure CLI tokens) — must use `Connect-MgGraph` or MSAL with specific scopes
- Blueprint creation requires authenticating AS the blueprint app (client credentials); delegated auth gives 403

**Provisioning scripts (`scripts/`):**

| Script | Purpose |
|--------|---------|
| `create-agent-blueprint.ps1` | Creates the true `AgentIdentityBlueprint` app, adds credentials, creates `BlueprintPrincipal` SP |
| `create-agent-identities.ps1` | Authenticates as Blueprint, creates 44 `AgentIdentity` SPs via `/beta/servicePrincipals/Microsoft.Graph.AgentIdentity` |
| `create-agent-users-phase2.ps1` | Creates agent user accounts with proper job titles/departments |
| `assign-agent-permissions.ps1` | Assigns M365 oauth2 grants + Glyphor app roles to all agent identity SPs |
| `assign-permissions-to-linked-sps.ps1` | Assigns permissions to linked service principals |
| `recover-agent-users.ps1` | Recreates deleted agent user accounts (without blueprint — read-only field) |
| `fix-licenses.ps1` | Sets `usageLocation=US` and assigns Agent 365 Tier 3 license to agent users |

**Config/data files:**

| File | Purpose |
|------|---------|
| `scripts/agent-identity-real-ids.json` | Maps agent role → Agent Identity SP ID (44 entries) |
| `.agent-identities-created.json` | Full creation results (name + ID per agent) |
| `.agent-id-blueprint-secret.json` | Blueprint app credential (keyId, secretText) — **gitignored** |

### Glyphor MCP Architecture — Internal MCP Servers

Glyphor is migrating its tool architecture toward a multi-server MCP model (see `docs/MCP.md`).
Internal MCP servers replace direct DB queries and external API calls with a standardized
JSON-RPC 2.0 protocol, enabling per-agent scoping via Entra app roles.

**Architecture:**

```
Agent run.ts → createGlyphorMcpTools(agentRole?, serverFilter?)
  → glyphorMcpTools.ts (gate check: GLYPHOR_MCP_ENABLED='true')
  → JSON-RPC 2.0 POST to Glyphor MCP server(s)
  → MCP server (e.g., mcp-data-server) validates scope + executes
```

**Glyphor MCP Servers (9 built):**

| Server | Cloud Run Service | Status | Tools | Purpose |
|--------|------------------|--------|-------|---------|
| `glyphor_data` | `mcp-data-server` | ✅ Built | 12 | Read-only SQL queries (content, SEO, finance, analytics, support, research, agents, ops) |
| `glyphor_marketing` | `mcp-marketing-server` | ✅ Built | 7 | Social media, Search Console, web analytics |
| `glyphor_engineering` | `mcp-engineering-server` | ✅ Built | 5 | GitHub, Vercel, Cloud Run, CI/CD |
| `glyphor_design` | `mcp-design-server` | ✅ Built | 5 | Playwright screenshots, Figma, Storybook |
| `glyphor_finance` | `mcp-finance-server` | ✅ Built | 7 | Stripe, Mercury, BigQuery billing |
| `glyphor_email` | `mcp-email-server` | ✅ Built | 3 | send_email, read_inbox, reply_to_email (M365 Graph API, plain-text enforced) |
| `glyphor_legal` | `mcp-legal-server` | ✅ Built | 19 | Compliance, contracts, IP portfolio, tax, data privacy/retention (12 reads + 7 writes) |
| `glyphor_hr` | `mcp-hr-server` | ✅ Built | 8 | Org chart, agent profiles, onboarding, performance reviews, engagement (5 reads + 3 writes) |
| `glyphor_email_marketing` | `mcp-email-marketing-server` | ✅ Built | 15 | Mailchimp campaigns (10) + Mandrill transactional email (5) |

**Total: ~81 MCP tools across 9 servers.**

**MCP Data Server (`packages/mcp-data-server/`):**
- HTTP server on `:8080`, handles `POST /mcp` (JSON-RPC 2.0) and `GET /health`
- 12 parameterized read-only SQL query tools across 8 domains
- Scope-based table access control via `SCOPE_TABLE_MAP` (Entra scopes → allowed tables)
- PostgreSQL connection via `pg` Pool
- Multi-stage Docker build (`node:22-slim`)

**Core Tools (`packages/agents/src/shared/coreTools.ts`):**
- 11 always-loaded tools extracted from existing factories: `read_my_assignments`,
  `submit_assignment_output`, `flag_assignment_blocker`, `send_agent_message`,
  `check_my_messages`, `call_meeting`, `save_memory`, `recall_memories`,
  `emit_event`, `request_tool_access`, `request_new_tool`
- `createCoreTools(deps)` returns filtered output from 5 existing factory functions
- `CORE_TOOL_NAMES` Set exported for validation

**Bridge (`packages/agents/src/shared/glyphorMcpTools.ts`):**
- Discovers available tools via JSON-RPC `tools/list` on each MCP server
- Converts MCP tool schemas → Glyphor `ToolDefinition` format
- Routes `execute()` calls via JSON-RPC `tools/call`
- Server URLs from env: `GLYPHOR_MCP_DATA_URL`, `GLYPHOR_MCP_MARKETING_URL`, etc.
- Gracefully skips unreachable servers (logs warning, continues)

**Migration status:** Complete — all 9 MCP servers built, bridge wired, HR/Legal/Email/Email-Marketing
tools fully migrated from inline to MCP. Inline stubs (`hrTools.ts`, `legalTools.ts`) return empty
arrays. Email tools served exclusively via `mcp-email-server` with plain-text enforcement
(no markdown in external communications).

**All-Department Shared Tools** (Waves 1-5):

| File | Tools | Agents | Purpose |
|------|-------|--------|---------|
| `contentTools.ts` | 7 | CMO, Content Creator | Draft lifecycle, publish, content calendar, DALL-E image generation |
| `seoTools.ts` | 8 | SEO Analyst | Google Search Console, keyword tracking, page audits, indexing, backlinks |
| `socialMediaTools.ts` | 7 | Social Media Manager | Schedule posts, metrics, audience analytics, trending topics |
| `emailMarketingTools.ts` | 0 | — | **Deprecated** — all 15 tools migrated to `mcp-email-marketing-server` |
| `marketingIntelTools.ts` | 9 | CMO | A/B experiments, competitor monitoring, lead pipeline, marketing dashboard |
| `revenueTools.ts` | 6 | CFO, Revenue Analyst | MRR breakdown, Stripe subscriptions/invoices, churn, forecasts, LTV |
| `costManagementTools.ts` | 8 | CFO, Cost Analyst | GCP/AI/vendor costs, anomaly detection, burn rate, budgets, unit economics |
| `cashFlowTools.ts` | 5 | CFO, Revenue Analyst, Cost Analyst | Mercury balance, cash flow, transactions, financial reports, margins |
| `productAnalyticsTools.ts` | 6 | CPO, User Researcher | Analytics events, usage metrics, funnels, cohorts, feature usage, segmentation |
| `userResearchTools.ts` | 5 | User Researcher | Surveys, support tickets, user feedback, personas |
| `competitiveIntelTools.ts` | 7 | CPO, Competitive Intel | Competitor tracking/profiles, feature comparison, pricing, market landscape |
| `roadmapTools.ts` | 6 | CPO | Roadmap CRUD, RICE scoring, feature flags, feature requests |
| `researchRepoTools.ts` | 4 | VP Research, all analysts | Persistent research repository with text search, research briefs |
| `researchMonitoringTools.ts` | 14 | VP Research, all analysts | Monitors, academic papers, OSS tracking, regulatory, AI benchmarks, synthesis |
| `legalTools.ts` | 0 | — | **Deprecated stub** — returns []. All 19 tools migrated to `mcp-legal-server` |
| `hrTools.ts` | 0 | — | **Deprecated stub** — returns []. All 8 tools migrated to `mcp-hr-server` |
| `opsExtensionTools.ts` | 12 | Ops, Global Admin | Agent health dashboard, event bus, data freshness, access management |
| `engineeringGapTools.ts` | 10 | Quality/DevOps/Platform | Test suites, code coverage, container logs, scaling, infrastructure inventory |

**Total: 114 remaining inline shared tools across 18 files (42 tools migrated to MCP servers), wired into 25+ agents.**

### Pre-Dispatch Validation (Chief of Staff)

Sarah's `ORCHESTRATION_PROMPT` includes 4 mandatory checks before dispatching any work assignment
to a sub-agent. This prevents the ~40% timeout rate caused by agents looping on tasks they
can't complete:

| Check | Description |
|-------|-------------|
| **CHECK 1 — TOOL CHECK** | Does the assigned agent have every tool needed? If not, grant the tool first or reassign to an agent who has it. |
| **CHECK 2 — DATA DEPENDENCY CHECK** | Does the task require data the agent can't access? If the data lives in another agent's domain, fetch it first and embed it in the instructions. |
| **CHECK 3 — SPECIFICITY CHECK** | Is the task atomic with a clear deliverable? Bad: "Do marketing." Good: "Draft 3 LinkedIn posts about feature X with CTA to landing page." |
| **CHECK 4 — CONTEXT EMBEDDING** | Work-loop agents run with minimal ~150-line system prompts (task tier). All context must be embedded in the assignment instructions — agents won't have KB, briefs, or memories. |

After a directive's assignments complete, Sarah also runs **Post-Directive Synthesis** — compiling
all agent outputs into a coherent deliverable for the founders.

### Code Authoring Tools (CTO)

Marcus (CTO) has GitHub code authoring tools for agent self-extension — agents can read
and write code in the repo through the CTO, enabling the system to evolve its own capabilities.

**Tools** (`cto/tools.ts`):

| Tool | Description |
|------|-------------|
| `get_file_contents` | Read a file from the GitHub repo. Used to inspect existing tool code before modifying it. Supports branch selection. |
| `create_or_update_file` | Create or update a file on a feature branch. Enforces `feature/agent-*` branch naming. Blocks writes to RED-tier protected files (`companyAgentRunner.ts`, `authorityGates.ts`, `infra/`, `.github/workflows/`, `docker/`) and `AGENT_BUDGETS` modifications. |
| `create_branch` | Create a new `feature/agent-*` branch from main for tool/agent development. |

**Safety guardrails**:
- Branch names must start with `feature/agent-` — direct writes to main/staging/production are forbidden
- Path blocklist prevents agents from modifying core runtime, infrastructure, CI/CD, or Docker files
- Content analysis blocks budget-cap manipulation in `types.ts`
- All file writes are logged to `activity_log` with commit SHA

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

Generates downloadable documents from analysis, simulation, CoT, deep-dive, and strategy lab
reports in Markdown, JSON, PPTX, and DOCX formats. All PPTX/DOCX exports are watermarked with
the Glyphor logo using Sharp image processing.

### Strategy Lab v2 Engine (`strategyLabEngine.ts`)

Multi-wave strategic analysis pipeline (upgrades v1 `analysisEngine.ts`). Three-layer
architecture:

```
1. RESEARCH   — Spawn research agents for data gathering
2. ANALYSIS   — Run analysis agents on research findings
3. SYNTHESIS  — Merge into executive-ready strategic report
```

The `/analysis/run` endpoint now redirects to Strategy Lab v2 automatically.

### Deep Dive Engine (`deepDiveEngine.ts`)

Strategic deep dive engine with cross-model verified evidence. Four-phase pipeline:

```
1. SCOPE      — Define research scope and boundaries
2. RESEARCH   — Gather evidence from multiple sources
3. ANALYZE    — Synthesize findings with cited evidence
4. SYNTHESIZE — Generate structured report with recommendations
```

Stored in `deep_dives` table. Supports visual infographic generation (base64 PNG).

### Framework Analysis (`frameworkTypes.ts`)

Strategic analyses and deep dives can now run 6 strategic framework analyses in parallel,
producing a convergence narrative that synthesizes insights across all frameworks:

| Framework | Output |
|-----------|--------|
| **Ansoff Growth Matrix** | Market penetration, development, product dev, diversification strategies |
| **BCG Growth-Share Matrix** | Portfolio classification (star/cash cow/question mark/dog), capital allocation |
| **Blue Ocean Strategy** | Value innovation analysis, uncontested market space |
| **Porter's Five Forces** | Competitive intensity assessment across 5 dimensions |
| **PESTLE Analysis** | Political, Economic, Social, Technological, Legal, Environmental factors |
| **Enhanced SWOT** | Strengths, Weaknesses, Opportunities, Threats with action items |

Each framework returns a `confidenceScore` and `duration`. The **Framework Convergence Narrative**
synthesizes highest-value insights across all 6 frameworks into executive-ready recommendations.

Stored in `deep_dive_frameworks` table; convergence narratives in `deep_dives.framework_convergence`
and `strategy_analyses.framework_convergence`. Includes a **Watchlist** system (`deep_dive_watchlist`,
`strategy_analysis_watchlist`) monitoring risk, catalyst, transaction, leadership, and regulatory items.

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

### Context Distiller (`contextDistiller.ts`)

JIT context compression layer that runs before each agent turn. Takes raw context data
(memories, knowledge graph nodes, past episodes, procedures, organizational knowledge)
and compresses it into a focused briefing via `gemini-3-flash-preview`.

```
Raw context (memories + graph + episodes + procedures)
  → ContextDistiller.distill(role, task, jitContext)
  → gemini-3-flash-preview (compression)
  → DistilledContext { briefing, keyFacts, relevantHistory, costUsd, durationMs }
```

| Constant | Value |
|----------|-------|
| Model | `gemini-3-flash-preview` |
| Cache TTL | 300s (5 min) via Redis |
| Typical cost | ~$0.001 per call |
| Cache key | `distilled:{role}:{md5(context)}` |

### Runtime Tool Factory (`runtimeToolFactory.ts`)

Enables agents to synthesize new tools mid-run when no existing tool covers their need.
Supports three implementation types: HTTP fetch, Cloud SQL query, and sandboxed JavaScript.

```
Agent requests new tool → RuntimeToolFactory.register(definition)
  → validate (blocked patterns, code length, table access)
  → register as runtime_{name} tool
  → optionally persist to runtime_tools table
```

| Constraint | Value |
|------------|-------|
| Max tools per run | 3 |
| Max persisted tools | 20 |
| Max code length | 2,000 chars |
| Max response length | 4,000 chars |
| Blocked patterns | `eval`, `require`, `import`, `process`, `child_process`, `Function()` |
| Blocked tables | `company_agents`, `agent_budgets`, `platform_iam_state`, `platform_audit_log` |

### Change Request Pipeline (`changeRequestHandler.ts`)

Dashboard-to-GitHub workflow for feature/bug requests. Users submit change requests
via the `/change-requests` dashboard page, which are stored in `dashboard_change_requests`.
The scheduler heartbeat processes pending requests every 10 minutes.

```
ChangeRequests.tsx (dashboard)
  → dashboard_change_requests table (status: pending)
  → heartbeat → processNewChangeRequests()
  → GitHub issue (labeled: copilot, change-request, {type})
  → GitHub Copilot auto-implementation
  → syncChangeRequestProgress() updates status from PR state
```

Statuses: `pending` → `submitted` → `in_progress` → `review` → `merged` / `closed`.

### Reactive Wake, Heartbeat, Work Loop & Task Tier

> Full details with flow diagrams in the **Agent Framework** section above:
> - [Heartbeat & Work Loop — The Always-On Engine](#heartbeat--work-loop--the-always-on-engine)
> - [Reactive Wake System](#reactive-wake-system)
> - [Work Loop Priority Stack](#work-loop-priority-stack-executeworkloop)
> - [Orchestration Loop — Sarah → Agents → Sarah](#orchestration-loop--sarah--agents--sarah)

#### Source Files

| File | Purpose |
|------|---------|
| `packages/scheduler/src/dashboardApi.ts` | PostgREST-compatible CRUD API for dashboard (70+ whitelisted tables, POST/PATCH/DELETE, field selection, custom filters) |
| `packages/scheduler/src/frameworkTypes.ts` | Output schemas for 6 strategic frameworks (Ansoff, BCG, Blue Ocean, Porter, PESTLE, SWOT) + convergence narrative |
| `packages/scheduler/src/parallelDispatch.ts` | Wave builder (buildWaves), parallel dispatcher (dispatchWaves), dependency resolver (resolveAndDispatchDependents), concurrency guard (isAgentRunning). Max 10 concurrent agents per wave, 120s dispatch timeout. |
| `packages/scheduler/src/heartbeat.ts` | HeartbeatManager: 3-tier frequency, drain wake queue, 3-phase parallel wave dispatch (SCAN → RESOLVE → DISPATCH) |
| `packages/scheduler/src/wakeRouter.ts` | Event → WAKE_RULES matching → immediate/queued dispatch |
| `packages/scheduler/src/wakeRules.ts` | 14 declarative event-to-agent wake rules |
| `packages/scheduler/src/authorityGates.ts` | Decision tier enforcement (GREEN/YELLOW/RED) — used by EventRouter |
| `packages/scheduler/src/decisionQueue.ts` | Human approval workflow for founder decisions, Teams Bot integration |
| `packages/scheduler/src/cronManager.ts` | Cloud Scheduler configuration & local cron execution |
| `packages/scheduler/src/strategyLabEngine.ts` | Strategy Lab v2: multi-wave strategic analysis pipeline (Research → Analysis → Synthesis) |
| `packages/scheduler/src/deepDiveEngine.ts` | Strategic deep dive engine with cross-model verified evidence (Scope → Research → Analyze → Synthesize) |
| `packages/scheduler/src/inboxCheck.ts` | M365 mailbox polling for agent email (12 email-enabled agents, MEDIUM tier cadence) |
| `packages/agent-runtime/src/workLoop.ts` | P1-P6 priority stack, proactive cooldowns, abort cooldowns |
| `packages/scheduler/src/eventRouter.ts` | Event source routing (scheduler/manual/agent/event/webhook) |
| `packages/agent-runtime/src/supervisor.ts` | Per-turn stall detection, turn/timeout enforcement, abort controller |
| `packages/agent-runtime/src/toolExecutor.ts` | 5-layer enforcement: grants (auto-grant known tools), scope, rate limit, budget, timeout |
| `packages/agent-runtime/src/companyAgentRunner.ts` | On-demand chat runner: context → model → tools → reflect. Tool inventory logging + auto-sync grants on startup |
| `packages/agent-runtime/src/orchestratorRunner.ts` | Orchestrator archetype: OBSERVE→PLAN→DELEGATE→MONITOR→EVALUATE |
| `packages/agent-runtime/src/taskRunner.ts` | Task archetype: RECEIVE→REASON→EXECUTE→REPORT |
| `packages/agent-runtime/src/reasoningEngine.ts` | Multi-pass verification & cross-model consensus engine |
| `packages/agent-runtime/src/jitContextRetriever.ts` | Just-In-Time context retrieval (task-aware semantic retrieval) |
| `packages/agent-runtime/src/redisCache.ts` | Redis cache layer for GCP Memorystore (TTL management, graceful degradation) |
| `packages/agent-runtime/src/toolRegistry.ts` | Central tool lookup via static KNOWN_TOOLS + dynamic `tool_registry` DB table |
| `packages/agent-runtime/src/dynamicToolExecutor.ts` | Dynamic tool executor — runs DB-registered tools at runtime (API call support, 60s declaration cache) |
| `packages/agent-runtime/src/contextDistiller.ts` | JIT context compression via gemini-3-flash-preview (~$0.001/call), 5-min Redis cache |
| `packages/agent-runtime/src/runtimeToolFactory.ts` | Mid-run tool synthesis (HTTP/Cloud SQL/sandboxed JS), max 3 per run, 20 persisted |
| `packages/scheduler/src/changeRequestHandler.ts` | Dashboard change request → GitHub issue pipeline, heartbeat-driven (every 10 min) |
| `packages/scheduler/src/brandTheme.ts` | Centralized design-system constants for PPTX/DOCX/image exports |
| `packages/scheduler/src/logoAsset.ts` | Logo PNG asset loading for branded report exports |
| `packages/agents/src/shared/createRunner.ts` | Runner factory: role + task → Orchestrator/Task/CompanyAgent |

#### Quick Reference Tables

**Heartbeat Tiers:**

| Tier | Frequency | Agents |
|------|-----------|--------|
| High | Every 10 min | chief-of-staff, cto, ops |
| Medium | Every 20 min | other executives |
| Low | Every 30 min | sub-team members |

**Task Context Tier Constraints:**

| Constraint | Value |
|-----------|-------|
| Max turns | 20 |
| Timeout | 180 s |
| Per-call timeout | 60 s |
| System prompt | ~150 lines (personality + assignment protocol + cost awareness) |
| Thinking | Disabled |
| Reflection | Skipped |
| Tool gating | Tools stripped on last turn |
| On abort | `savePartialProgress()` — saves partial output, notifies chief-of-staff |

**Proactive Cooldowns:**

| Tier | Agents | Cooldown |
|------|--------|----------|
| Always Hot | chief-of-staff, ops | 1 hour |
| High Frequency | cto, cfo | 2 hours |
| Medium | cpo, cmo, VPs | 4 hours |
| Standard (default) | All sub-team members | 6 hours |

Proactive prompts are role-specific (e.g., CTO reviews platform health trends;
CFO monitors cost trends; CMO drafts content ideas).

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

Interactive force-directed graph on HTML5 Canvas with unified rAF loop:
- Color-coded nodes by type, search filtering, type filtering
- Click-to-select with neighborhood highlighting
- Detail panel showing summary, metadata, tags, incoming/outgoing edges
- Theme-aware labels (reads CSS `--color-txt-primary` variable)
- Performance: zero React state updates during simulation (all via refs), distance cutoff
  (400px) for O(n²) repulsion, 3-5 batched sim steps per frame, `drawFnRef` for immediate
  redraws on pan/zoom/selection changes

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
| `personality_summary` | Core personality description (injected into prompts) |
| `backstory` | Character backstory and motivation (dashboard display only) |
| `communication_traits` | Array of communication style traits (dashboard display only) |
| `quirks` | Array of personality quirks (dashboard display only) |
| `tone_formality` | 0-1 scale (casual to formal) (dashboard display only) |
| `emoji_usage` | 0-1 scale (deprecated, set to 0 for all agents) |
| `verbosity` | 0-1 scale (terse to detailed) (dashboard display only) |
| `voice_sample` | Example of how the agent sounds (dashboard display only) |
| `signature` | Sign-off line (injected into prompts) |
| `clifton_strengths` | Array of top strengths (dashboard display only) |
| `working_style` | How the agent approaches work (dashboard display only) |
| `voice_examples` | Few-shot calibration examples (injected into prompts) |
| `anti_patterns` | Role-specific never/instead pairs (injected into prompts) |
| `working_voice` | Compact voice description for task-tier prompts |

### AgentProfile Page (Dashboard)

7-tab profile page at `/agents/:agentId`:

| Tab | Content |
|-----|---------|
| **Overview** | Avatar (click to upload — saves to GCS `avatars/{agentId}/` via `POST /agents/:id/avatar`, upserts `agent_profiles`), personality summary, backstory, communication traits, quirks, Clifton strengths, working style |
| **Performance** | Quality score trends (chart), growth areas, peer feedback from other agents |
| **Memory** | Agent memories (observations, learnings, preferences, facts) + reflections with quality scores |
| **Messages** | Stats row (received/sent/meetings/pending), DM list with directional arrows, meeting participation list |
| **Skills** | Assigned skills with proficiency bars, category badges, skill assignment management |
| **World Model** | Radar chart (rubric dimensions), strengths/weaknesses, improvement goals bar chart, failure patterns, blindspots, rubric dimension details |
| **Settings** | Model selection, temperature, max turns, budget caps, cron schedule |

---

## Cloud SQL Database Schema

### Core Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `company_profile` | Company metadata (key-value) | key (unique), value (JSONB), updated_by, version |
| `products` | Product catalog | slug (unique), name, status, roadmap (JSONB), metrics (JSONB) |
| `company_agents` | Agent registry (28 columns) | role (unique), display_name, name, title, reports_to, team, model, temperature, max_turns, budget_per_run, budget_daily, budget_monthly, is_core, is_temporary, expires_at, thinking_enabled, last_run_summary, performance_score, total_runs, total_cost_usd, tenant_id |
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
| `agent_profiles` | Personality profiles | agent_id → company_agents, personality_summary, backstory, communication_traits, quirks, tone_formality, emoji_usage, verbosity, voice_sample, signature, voice_examples (JSONB), clifton_strengths, working_style, anti_patterns (JSONB), working_voice |
| `agent_performance` | Daily performance stats | agent_id + date (unique), total_runs, successful_runs, failed_runs, avg_duration_ms, avg_quality_score, total_cost, total_input_tokens, total_output_tokens, decisions_filed/approved/rejected |
| `agent_milestones` | Achievement tracking | agent_id, type, title, description, quality_score |
| `agent_growth` | Growth dimensions | agent_id + dimension (unique), direction, current_value, previous_value, period, evidence |
| `agent_peer_feedback` | Peer evaluations | from_agent, to_agent, feedback, context, sentiment |
| `agent_runs` | Individual run log | agent_id, task, status, duration_ms, cost, input_tokens, output_tokens, tool_calls, turns, error |
| `agent_activities` | Activity stream | agent_role, activity_type, summary, details |
| `agent_trust_scores` | Dynamic trust scores | agent_role (unique), trust_score (0–1), total_positive_signals, total_negative_signals, last_updated |
| `agent_constitutions` | Per-agent constitutional principles | agent_role, principles (JSONB), version, is_active |
| `constitutional_evaluations` | Post-run constitutional compliance | run_id, agent_role, constitution_version, compliance_score, evaluation (JSONB), pre/post_revision_confidence |
| `proposed_constitutional_amendments` | Agent-proposed principle changes | proposing_agent, principle_id, amendment_type, current_text, proposed_text, rationale, status |
| `decision_chains` | Provenance chain of multi-step decisions | chain_id (PK), initiating_agent, task_description, links (JSONB), status, contributions (JSONB) |
| `drift_alerts` | Behavioral drift notifications | agent_id, metric, baseline_mean, baseline_stddev, recent_mean, deviation_sigma, severity, acknowledged |

### Agent Intelligence Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `agent_memory` | Persistent memories (with pgvector) | agent_role, memory_type, content, importance, tags, embedding (vector 768-dim), graph_node_id → kg_nodes |
| `agent_reflections` | Post-run reflections | agent_role, run_id, summary, quality_score, what_went_well, what_could_improve, prompt_suggestions, knowledge_gaps |
| `agent_briefs` | Dynamic agent briefs | agent_id (PK), system_prompt, skills, tools |
| `agent_schedules` | DB-defined cron jobs | agent_id, cron_expression, task, payload (JSONB), enabled |
| `metrics_cache` | Cached metrics | service, metric, value, labels (JSONB), timestamp |
| `cot_analyses` | Chain-of-thought analyses | id, query, status, requested_by, report (JSONB), completed_at, error |
| `agent_tool_grants` | Dynamic tool grants | agent_role + tool_name (unique), granted_by, reason, directive_id, scope, is_active, expires_at |
| `tool_registry` | Dynamic tool definitions (runtime-executable) | name (unique), description, type (api/sql/custom), config (JSONB: url_template, method, headers, body_template, auth, response_path), parameters (JSONB), is_active |

### World Model Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `agent_world_model` | Per-agent self-model (strengths, weaknesses, task scores, prediction accuracy) | agent_role (PK), strengths (JSONB), weaknesses (JSONB), failure_patterns (JSONB), task_type_scores (JSONB), prediction_accuracy, improvement_goals (JSONB), preferred_approaches (JSONB), rubric_version |
| `role_rubrics` | Evaluation rubrics per role/task type | role + task_type + version (unique), dimensions (JSONB array of 5-level rubrics), passing_score, excellence_score |
| `shared_episodes` | Cross-agent episodic memory | author_agent, episode_type, summary, detail (JSONB), outcome, confidence, domains (TEXT[]), tags (TEXT[]), related_agents (TEXT[]), embedding (vector 768-dim), significance_score (0–1, default 0.5) |
| `shared_procedures` | Discovered best practices shared across agents | author_agent, procedure_type, title, steps (JSONB), success_rate, times_used, domains (TEXT[]) |

### Communication Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `agent_messages` | Inter-agent DMs | from_agent, to_agent, thread_id, message, message_type, priority, status, response, responded_at |
| `agent_meetings` | Multi-agent meetings | called_by, title, purpose, meeting_type, attendees, status, rounds, contributions, transcript, summary, action_items, decisions_made, escalations, total_cost |
| `chat_messages` | Founder ↔ agent chat | agent_role, role (user/agent), content, user_id, created_at, attachments (JSONB), conversation_id, responding_agent; CHECK user_id = LOWER(user_id) |

### Strategy Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `analyses` | Strategic analyses | type (5 types), query, depth, status (6 phases), threads (JSONB), report (JSONB), requested_by, visual_image (TEXT — base64 PNG infographic) |
| `simulations` | T+1 simulations | action, perspective (optimistic/neutral/pessimistic), status (9 states), dimensions, report, accepted_at, accepted_by |
| `deep_dives` | Deep dive research | target, context, status (6 phases), research_areas, sources, report, requested_by, visual_image, framework_convergence, framework_outputs (JSONB) |
| `deep_dive_frameworks` | Framework analysis results | deep_dive_id, framework_id (ansoff/bcg/swot/blue_ocean/porters/pestle), analysis (JSONB), confidence_score |
| `deep_dive_watchlist` | Risk/catalyst/transaction monitors | deep_dive_id, item_type, description, trigger_signals |
| `strategy_analysis_watchlist` | Strategy analysis monitors | analysis_id, item_type, description, trigger_signals |

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
| `kg_edges` | Graph edges | source_id → kg_nodes, target_id → kg_nodes, edge_type, strength, confidence, evidence, valid_from, valid_until, causal_confidence, causal_lag (interval), causal_mechanism, UNIQUE(source_id, target_id, edge_type) |

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

### Product & Research Tables (Wave 3)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `roadmap_items` | Feature roadmap | title, product (pulse/fuse), priority, effort, impact, target_quarter, status, rice_score |
| `research_repository` | Persistent research store | topic, category, content, sources (JSONB), tags, confidence, author |
| `research_monitors` | Monitoring configs | name, type, query_terms, check_frequency, alert_threshold, last_checked, active |

### Governance Tables (Wave 4)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `compliance_checklists` | Regulatory compliance | framework (GDPR/CCPA/SOC2/EU_AI_Act), item, status, evidence, last_audit_date |
| `contracts` | Contract management | type, counterparty, status, key_terms (JSONB), value, start_date, end_date, renewal_date |
| `ip_portfolio` | IP assets | type (patent/trademark/trade_secret/copyright), title, status, filing_date, inventor |

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

### Tenant & Platform Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `tenants` | Multi-tenant registry | id (UUID PK), slug (unique), name, is_active |
| `dashboard_change_requests` | Feature/bug request tracking | type, area, priority, description, status, github_issue_url, submitted_by, approved_by |
| `runtime_tools` | Persisted runtime-synthesized tools | name, implementation_type, definition (JSONB), created_by |

### Working Memory

Working memory (last-run summary) is stored in the `company_agents` table via the
`last_run_summary` and `last_run_at` columns — not a separate table. This enables
continuity between runs without additional migration.

Total: **163 migration files**, **90+ tables**, **10 RPC functions**, **1 extension (pgvector)**.

---

## Multi-Tenant Architecture

Added 2026-03-02. The platform now supports multiple tenants with row-level security (RLS)
in PostgreSQL, enabling future SaaS onboarding.

### Tenant Model

| Field | Value |
|-------|-------|
| Tenant 0 (seed) | `00000000-0000-0000-0000-000000000000` (Glyphor, slug: `glyphor`) |
| Tenant ID type | UUID |
| Isolation | Row-Level Security (RLS) policies on all tenant-scoped tables |

### Tenant-Scoped Tables

Critical tables now carry a `tenant_id` column (NOT NULL):
`agent_runs`, `kg_nodes`, `kg_edges`, `founder_directives`, `work_assignments`, `agent_briefs`,
plus all framework and strategy tables.

All existing records were backfilled with the Glyphor tenant ID. RLS policies enforce
that queries only see rows matching the current tenant context.

### Worker Service

The worker service (`packages/worker/`) processes agent runs via GCP Cloud Tasks queues.
Each task includes a `tenant_id` for tenant isolation during execution.

| Queue | Purpose |
|-------|---------|
| `agent-runs` | Standard agent run processing |
| `agent-runs-priority` | Priority agent runs (urgent tasks) |
| `delivery` | Output delivery to platforms/channels |

Tasks use OIDC authentication and base64-encoded JSON payloads with 0-30s jitter
for load distribution.

---

## Smoketest Framework

14-layer health verification suite (`packages/smoketest/`) for validating all subsystems.

| Layer | Name | What it Tests |
|-------|------|---------------|
| L00 | Infrastructure | DB, Redis, GCS connectivity |
| L01 | Data Syncs | GCP Billing, Stripe, Mercury, SharePoint |
| L02 | Model Clients | Gemini, OpenAI, Claude, Kling |
| L03 | Heartbeat | Agent pulse monitoring |
| L04 | Orchestration | Agent dispatch, task queue |
| L05 | Communication | Email, Slack, Teams, Call Automation |
| L06 | Authority | Policies, RBAC, decision engine |
| L07 | Intelligence | Web search, Tavily, GraphRAG |
| L08 | Knowledge | Company knowledge base, SharePoint |
| L09 | Strategy | Analysis engine, deep dives |
| L10 | Specialists | All agent runners |

CLI: `--layer N` for specific layers, `--interactive` for step-by-step mode.
Requires `SCHEDULER_URL`, `DASHBOARD_URL`, `VOICE_GATEWAY_URL` env vars.

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
| Cloud Run | `voice-gateway` | Voice agent sessions (WebRTC + Teams) |
| Cloud Run | `glyphor-worker` | GCP Cloud Tasks queue processor (agent runs + delivery) |
| Cloud Run | `mcp-data-server` | Glyphor MCP Data Server — 12 read-only SQL query tools |
| Cloud Run | `mcp-marketing-server` | Glyphor MCP Marketing Server — 7 tools |
| Cloud Run | `mcp-engineering-server` | Glyphor MCP Engineering Server — 5 tools |
| Cloud Run | `mcp-design-server` | Glyphor MCP Design Server — 5 tools |
| Cloud Run | `mcp-finance-server` | Glyphor MCP Finance Server — 7 tools |
| Cloud Run | `mcp-email-server` | Glyphor MCP Email Server — 3 tools (plain-text enforced) |
| Cloud Run | `mcp-legal-server` | Glyphor MCP Legal Server — 19 tools (12 reads + 7 writes) |
| Cloud Run | `mcp-hr-server` | Glyphor MCP HR Server — 8 tools (5 reads + 3 writes) |
| Cloud Run | `mcp-email-marketing-server` | Glyphor MCP Email Marketing Server — 15 tools |
| Vertex AI | Claude models (`us-east5`) | Anthropic Claude inference via `@anthropic-ai/vertex-sdk` — IAM auth, no API key |
| Cloud Tasks | `agent-runs`, `agent-runs-priority`, `delivery` | Background agent task queues |
| Cloud Scheduler | 9 agent + 3 sync jobs | Agent triggers → Pub/Sub; data syncs → HTTP |
| Pub/Sub | `glyphor-agent-events` | Cron message delivery |
| Pub/Sub | `glyphor-events` | Inter-agent event bus |
| Secret Manager | 25+ secrets | API keys, credentials, channel IDs, bot configs |
| Artifact Registry | `us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/` | Docker images |
| Cloud Storage | `glyphor-company` bucket | Briefings, reports, specs, agent avatars |
| BigQuery | `billing_export` dataset | GCP billing export data |
| Memorystore (Redis) | `glyphor-redis` | Redis cache for JIT context, directives, profiles, reasoning |
| Azure | Resource group `glyphor-resources` (centralus) | Bot registrations, Entra apps |
| Azure Communication Services | ACS instance | Teams meeting media streaming (WebSocket, PCM16) |
| Agent 365 (Microsoft) | `agent365.svc.cloud.microsoft` | M365 MCP servers — Mail, Calendar, OneDrive/SharePoint, Teams, M365 Copilot |

### External Services

| Service | Purpose | Config |
|---------|---------|--------|
| Cloud SQL | PostgreSQL database | `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
| Google Gemini API | Primary AI inference | `GOOGLE_AI_API_KEY` |
| OpenAI API | Alternative AI inference + web search + image gen | `OPENAI_API_KEY` |
| Vertex AI (GCP) | Anthropic Claude inference via Vertex AI | GCP IAM auth (service account `glyphor-agent-runner` / `glyphor-worker` with `roles/aiplatform.user`), region `us-east5` |
| Microsoft Entra ID | Teams auth (MSAL client credentials) | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` |
| Azure Bot Service | Bot Framework (main + 10 agent bots) | `BOT_APP_ID`, `BOT_APP_SECRET`, `BOT_TENANT_ID`, `AGENT_BOTS` |
| Stripe | Revenue tracking (MRR, churn, subscriptions) | `STRIPE_SECRET_KEY` |
| Mercury | Banking (cash balance, cash flows, vendor subs) | `MERCURY_API_TOKEN` |
| Agent 365 (Microsoft) | M365 MCP servers — agents access Email, Calendar, OneDrive/SharePoint, Teams, M365 Copilot via MCP bridge | `AGENT365_CLIENT_ID`, `AGENT365_CLIENT_SECRET`, `AGENT365_TENANT_ID`, `AGENT365_ENABLED=true` |
| Figma | Design file access (file-level tools: file content, metadata, comments, variables) | `FIGMA_CLIENT_ID`, `FIGMA_CLIENT_SECRET`, `FIGMA_REFRESH_TOKEN` (OAuth 2.0, auto-refreshing access token) |

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
| Markdown | `react-markdown` for agent chat + collapsible action receipts |
| Auth | Teams SSO (`@microsoft/teams-js`) in Teams tab; Google Sign-In (OAuth 2.0) in browser |
| Hosting | nginx:1.27-alpine on Cloud Run |
| API | Scheduler `/run` + direct Cloud SQL queries |

### Pages

| Page | Route | Function |
|------|-------|----------|
| Dashboard | `/` | Agent activity overview, key metrics |
| Directives | `/directives` | Founder directives management — create, assign, track work assignments |
| Workforce | `/workforce` | Org chart (13 departments) + grid view — 46 total headcount |
| Workforce Builder | `/builder` | Drag-and-drop org chart builder with templates |
| Agent Profile | `/agents/:agentId` | 7-tab profile: Overview (with avatar upload), Performance, Memory, Messages, Skills, World Model, Settings |
| Agent Builder | `/agents/new` | Create new dynamic agents with name, department, model, budget, cron |
| Agent Settings | `/agents/:agentId/settings` | Agent configuration & system prompt editing (uses AgentProfile component) |
| Approvals | `/approvals` | Pending decision queue — approve/reject |
| Financials | `/financials` | Revenue (Stripe MRR), costs (GCP billing), cash (Mercury), vendor subscriptions |
| Governance | `/governance` | Platform IAM state, secret rotation status, audit log |
| Knowledge | `/knowledge` | Company knowledge base sections, founder bulletins, knowledge graph (absorbed from old /graph) |
| Operations | `/operations` | System operations, autonomous events, activity log (absorbed from old /activity) |
| Strategy | `/strategy` | Strategic analysis engine (5 analysis types) + T+1 simulation engine with impact matrix + AI-generated infographics |
| Capabilities | `/capabilities` | Composite page: Skills tab (skill library, 10 categories) + Self-Models tab (world model radar charts) |
| Skill Detail | `/skills/:slug` | Skill detail + agent assignments + proficiency stats |
| Comms | `/comms` | Composite page: Chat tab (multi-turn agent chat with history + collapsible action receipts) + Meetings tab (timeline, transcripts, action items) |
| Chat (direct) | `/chat/:agentId` | Direct agent chat (navigates to specific agent conversation) |
| Settings | `/settings` | User management page |
| Teams Config | `/teams-config` | Teams bot setup and configuration |
| Change Requests | `/change-requests` | Submit & track feature/bug change requests → GitHub issues → Copilot |
| Group Chat | `/group-chat` | Multi-agent group chat with @mentions, file uploads, concurrent responses, action receipts |

**Legacy redirects** (backwards compatibility):
`/agents` → `/workforce`, `/chat` → `/comms`, `/activity` → `/operations`, `/graph` → `/knowledge`,
`/skills` → `/capabilities`, `/meetings` → `/comms`, `/world-model` → `/capabilities`,
`/group-chat` → `/comms`

### Departments (Dashboard Workforce)

| Department | Executive | Team Members |
|------------|-----------|-------------|
| Engineering | Marcus Reeves (CTO) | Alex Park, Sam DeLuca, Jordan Hayes, Riley Morgan |
| Product | Elena Vasquez (CPO) | Priya Sharma, Daniel Ortiz |
| Finance | Nadia Okafor (CFO) | Anna Park, Omar Hassan |
| Marketing | Maya Brooks (CMO) | Tyler Reed, Lisa Chen, Kai Johnson |
| Customer Success | James Turner (VP CS) | Emma Wright, David Santos |
| Sales | Rachel Kim (VP Sales) | Nathan Cole, Ethan Morse |
| Design & Frontend | Mia Tanaka (VP Design) | Leo Vargas, Ava Chen, Sofia Marchetti, Ryan Park |
| Research & Intelligence | Sophia Lin (VP Research) | Lena Park, Daniel Okafor, Kai Nakamura, Amara Diallo, Riya Mehta, Marcus Chen |
| Legal | Victoria Chase (CLO) | Robert Finley, Grace Hwang, Mariana Solis |
| People & Culture | Jasmine Rivera (Head of HR) | — |
| Operations | — | Atlas Vega, Morgan Blake |
| Executive Support | Sarah Chen (CoS) | Derek Owens, Adi Rose |
| Marketing Intelligence | Maya Brooks (CMO) | Zara Petrov |

### Build Args (baked at Docker build)

`VITE_SCHEDULER_URL`, `VITE_GOOGLE_CLIENT_ID`

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
  → createRunner('cto','on_demand') → CompanyAgentRunner.run()
  → RouteResult { output: "Platform is healthy…", actions: [...] }
  → JSON response → Chat.tsx renders via <Markdown> + collapsible action receipts
```

### Chat Persistence

Both `Chat.tsx` (1:1) and `GroupChat.tsx` (multi-agent) persist messages to the `chat_messages`
table via `POST /api/chat-messages`. Key design points:

- **Retry with backoff**: `saveMessage` retries 2× with exponential backoff (500ms, 1s) before
  surfacing a red error banner (`saveFailed` state).
- **User ID normalization**: `user_id` is always lowercased before saving. A `CHECK` constraint
  enforces `user_id = LOWER(user_id)` at the DB level.
- **Multi-alias loading**: `loadHistory` uses `getEmailAliases()` to query across all known
  email addresses for the user (e.g. `andrew@glyphor.ai` + `andrew.zwelling@gmail.com`).
- **GroupChat scoping**: Messages include `conversation_id` for thread isolation. User messages
  use `agent_role='group-chat'`; agent responses use the agent's actual role.
- **@mention tracking**: When an agent responds via @mention in 1:1 chat, the `responding_agent`
  column captures which agent authored the response.

### Scheduled Cron Job

```
Cloud Scheduler → Pub/Sub "glyphor-agent-events"
  → POST /pubsub (base64 message)
  → EventRouter.handleSchedulerMessage()
  → decode: {agentRole:"cfo", task:"daily_cost_check", payload:{}}
  → checkAuthority('cfo','daily_cost_check') → GREEN
  → runCFO({task:'daily_cost_check'})
  → createRunner('cfo','daily_cost_check') → TaskRunner.run()
      → Tool calls: get_financials, get_product_metrics, calculate_unit_economics
      → write_financial_report, log_activity
      → (optional: create_decision if cost spike → YELLOW/RED)
  → Logged in activity_log
```

### Financial Data Sync

```
Cloud Scheduler → HTTP POST to scheduler
  → POST /sync/mercury
  → syncMercuryAll()
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
  → Write to Cloud SQL decisions table
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
  → Messages injected into system prompt: "Pending Messages: ..."
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
| Cloud SQL | Accessed via `pg` pool server-side with connection params |
| Teams Auth | MSAL client credentials (app-only) for Graph API; Bot Framework tokens for bot replies |
| Azure Entra ID | SingleTenant app registrations — 1 main + 10 agent bots, all with client secrets in GCP Secret Manager |
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
npx turbo build               # Turborepo build (all 8 packages)
npm run cos:briefing          # Run CoS briefing locally
npm run dashboard:dev         # Dashboard dev server
```

### Production

Deployment is handled by GitHub Actions CI/CD (`.github/workflows/deploy.yml`) on push to `main`. Key points:
- Uses `--update-secrets` (merge mode) — only listed secrets are updated, existing ones preserved
- Uses `--update-env-vars` (merge mode) — same merge behavior for env vars
- Current secrets: 25+ total (AI keys, Cloud SQL, Azure/Teams, Bot Framework, Stripe, Mercury)
- Dashboard build args baked at Docker build time (`VITE_*` vars)

#### CI/CD Pipeline

```
push to main
  → build job: npm ci → turbo build (8 packages)
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
| `db-host`, `db-name`, `db-user`, `db-password` | Cloud SQL Database |
| `gcs-bucket` | Cloud Storage |
| `azure-tenant-id`, `azure-client-id`, `azure-client-secret` | Graph API (MSAL) |
| `teams-team-id` | Teams team |
| `teams-channel-*-id` (9 secrets) | Teams channels |
| `bot-app-id`, `bot-app-secret`, `bot-tenant-id` | Main bot |
| `agent-bots` | JSON array of 10 agent bot configs |
| `agent365-client-secret` | Agent 365 blueprint app (MSAL client credentials) |
| `figma-client-id` | Figma OAuth app client ID |
| `figma-client-secret` | Figma OAuth app client secret |
| `figma-refresh-token` | Figma OAuth refresh token (stable, auto-refreshes access token) |

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
  --build-arg VITE_SCHEDULER_URL=... \
  --build-arg VITE_GOOGLE_CLIENT_ID=... \
  -t us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/dashboard:latest .
docker push us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/dashboard:latest
gcloud run deploy glyphor-dashboard \
  --image=us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/dashboard:latest \
  --project=ai-glyphor-company --region=us-central1 --allow-unauthenticated
```

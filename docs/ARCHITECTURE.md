# Glyphor AI Company Architecture

## Overview

Glyphor AI Company is a system of 7 AI executive agents that operate an AI-first company alongside 2 human founders. The agents handle daily operations, analysis, content, and decision-making while founders retain authority over strategic decisions.

## System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    GCP Cloud Scheduler                       │
│  (morning briefings, health checks, cost reviews, etc.)      │
└──────────────┬───────────────────────────────────────────────┘
               │ Pub/Sub
               ▼
┌──────────────────────────────────────────────────────────────┐
│              Scheduler / Event Router                         │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │ Cron Manager│  │ Event Router │  │ Authority Gates  │    │
│  └─────────────┘  └──────┬───────┘  └────────┬─────────┘    │
│                          │                    │              │
│                          ▼                    ▼              │
│                    ┌──────────────┐  ┌──────────────────┐    │
│                    │Agent Executor│  │ Decision Queue   │    │
│                    └──────┬───────┘  └────────┬─────────┘    │
└───────────────────────────┼───────────────────┼──────────────┘
                            │                   │
               ┌────────────┘                   │ Teams Webhook
               ▼                                ▼
┌──────────────────────────────┐  ┌──────────────────────────┐
│       Agent Runtime          │  │   Microsoft Teams        │
│  ┌────────────────────────┐  │  │  ┌────────────────────┐  │
│  │ CompanyAgentRunner     │  │  │  │ Founder Channels   │  │
│  │  ├─ ModelClient        │  │  │  │  ├─ Briefings      │  │
│  │  ├─ Supervisor         │  │  │  │  ├─ Decisions      │  │
│  │  ├─ ToolExecutor       │  │  │  │  └─ Alerts         │  │
│  │  └─ EventBus           │  │  │  └────────────────────┘  │
│  └────────────────────────┘  │  └──────────────────────────┘
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│      Company Memory          │
│  ┌────────────────────────┐  │
│  │ Supabase (structured)  │  │
│  │  ├─ company_profile    │  │
│  │  ├─ products           │  │
│  │  ├─ decisions          │  │
│  │  ├─ activity_log       │  │
│  │  └─ ...6 more tables   │  │
│  ├────────────────────────┤  │
│  │ GCS (large documents)  │  │
│  │  ├─ briefings/         │  │
│  │  ├─ reports/           │  │
│  │  └─ specs/             │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

## Agent Roster

| Agent | Role | Model | Schedule | Phase |
|-------|------|-------|----------|-------|
| Chief of Staff | Briefings, decision routing, synthesis | gemini-3.0-flash-preview | Daily 7:00/7:30 CT | 1 |
| CTO | Platform health, deploys, model management | gemini-3.0-flash-preview | Every 30min | 2 |
| CFO | Cost monitoring, revenue, margins | gemini-3.0-flash-preview | Daily 9:00 CT | 2 |
| CPO | Usage analysis, roadmap, feature priority | gemini-3.0-flash-preview | Weekly Mon 10:00 CT | 2 |
| CMO | Content, social, SEO, brand | gemini-3.0-flash-preview | Weekly Mon 9:00 CT | 2 |
| VP Customer Success | Health scoring, churn, nurture | gemini-3.0-flash-preview | Daily 8:00 CT | 3 |
| VP Sales | KYC research, proposals, pipeline | gemini-3.0-flash-preview | Mon/Thu 9:00 CT | 3 |

## Authority Model (Decision Tiers)

- **Green** — Agent acts autonomously. Logged, no approval needed.
- **Yellow** — One founder must approve. Teams notification sent, action queued.
- **Red** — Both founders must approve. Dual notification, tracked in decision queue.

Unknown actions default to Yellow for safety.

## Package Structure

```
packages/
├── agent-runtime/     # Core agent loop, supervisor, model client, tools
├── company-memory/    # Supabase + GCS persistence layer
├── agents/            # Individual agent configs, prompts, tools, runners
├── integrations/      # Teams webhooks, Adaptive Cards
└── scheduler/         # Cron config, event routing, authority gates, decisions
```

## Data Flow: Morning Briefing

1. Cloud Scheduler fires cron at 12:00 UTC (7:00 AM CT)
2. Pub/Sub delivers `{agentRole: "chief-of-staff", task: "morning_briefing", payload: {founder: "kristina"}}`
3. Event Router checks authority → Green (briefing is autonomous)
4. Chief of Staff agent starts:
   a. Reads company state from Supabase (metrics, recent decisions, activity)
   b. Calls Gemini to synthesize a personalized briefing
   c. Stores briefing in GCS
   d. Posts formatted Adaptive Card to Kristina's Teams channel
5. Event logged in activity_log

## Infrastructure

- **Compute**: GCP Cloud Run (scale-to-zero, per-agent services)
- **Scheduling**: GCP Cloud Scheduler → Pub/Sub → Cloud Run
- **Secrets**: GCP Secret Manager
- **Database**: Supabase (PostgreSQL)
- **Object Storage**: Google Cloud Storage
- **Notifications**: Microsoft Teams Incoming Webhooks (Phase 1)
- **IaC**: Terraform (see `infra/terraform/`)

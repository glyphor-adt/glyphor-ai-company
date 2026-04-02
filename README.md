# Glyphor AI Company

An autonomous AI-first company with 26 AI agents (8 executives, 17 sub-team members, 1 operations agent) operating alongside 2 human founders.

## What This Is

Glyphor AI Company replaces traditional org-chart roles with AI agents powered by Gemini. Each agent has a defined scope, tools, schedule, personality, and authority level. Human founders (Kristina as CEO, Andrew as COO) retain strategic control through a tiered decision model. Agents run 24/7 on GCP Cloud Run, share state through Cloud SQL, communicate with founders via Microsoft Teams, and collaborate with each other through DMs and multi-agent meetings.

## Agent Roster

### Executives (8)

| Agent | Name | Focus | Status |
|-------|------|-------|--------|
| **Chief of Staff** | Sarah Chen | Morning briefings, decision routing, synthesis | Active |
| **CTO** | Marcus Reeves | Platform health, deploys, model management | Active |
| **CFO** | Nadia Okafor | Cost monitoring, revenue, margin analysis | Active |
| **CPO** | Elena Vasquez | Usage analysis, roadmap, competitive intel | Active |
| **CMO** | Maya Brooks | Content generation, social, SEO, brand | Active |
| **VP Customer Success** | James Turner | Health scoring, churn prediction, nurture | Active |
| **VP Sales** | Rachel Kim | KYC research, proposals, pipeline | Active |
| **VP Design** | Mia Tanaka | Design system governance, component quality | Active |

### Sub-Team (17) & Operations (1)

| Department | Members |
|------------|---------|
| Engineering | Alex Park, Sam DeLuca, Jordan Hayes |
| Product | Priya Sharma, Daniel Ortiz |
| Finance | Anna Park, Omar Hassan |
| Marketing | Tyler Reed, Lisa Chen, Kai Johnson |
| Customer Success | Emma Wright, David Santos |
| Sales | Nathan Cole |
| Design & Frontend | Leo Vargas, Ava Chen, Sofia Marchetti, Ryan Park |
| Operations | Atlas Vega |

## Architecture

```
Cloud Scheduler → Pub/Sub → Event Router → Agent Runtime → Company Memory
                                 ↓                ↓
                           Authority Gates   Glyphor Event Bus
                                 ↓                ↓
                          Decision Queue    Inter-Agent Comms
                                                  ↓
                                          Microsoft Teams
                                     (Channels + Bot Framework)
```

**Stack**: TypeScript, Turborepo, Gemini API, Cloud SQL (PostgreSQL), GCS, GCP Cloud Run, Microsoft Teams (Bot Framework + Graph API), Azure Entra ID

## Quick Start

```bash
# Install
npm install

# Build
npx turbo build

# Dev dashboard
npm run dashboard:dev

# Run Chief of Staff briefing
node packages/agents/dist/chief-of-staff/run.js
```

## Project Structure

```
packages/
├── agent-runtime/     # Core agent loop, multi-provider LLM, event bus
├── company-memory/    # Cloud SQL + GCS persistence
├── company-knowledge/ # Shared knowledge base + 26 role briefs
├── agents/            # 26 agent configs, prompts, tools, runners
├── integrations/      # Teams bot, Graph API, Stripe, Mercury, GCP billing
├── scheduler/         # Cron, event routing, authority gates, strategy lab
└── dashboard/         # React 19 dashboard (Vite + Tailwind)

teams/                 # Teams app manifests & packages
├── manifest.json      # Main Glyphor AI team tab + bot
└── agents/            # 8 individual agent bot manifests + zip packages
docker/                # Dockerfiles for Cloud Run services
infra/                 # Terraform + deploy scripts
supabase/              # 16+ migration files
docs/                  # Architecture, schema, authority model, runbook, operating manual
```

## Microsoft Teams Integration

Agents are available in Teams through multiple channels:

- **Team Channels** — 9 channels for briefings, decisions, financials, engineering, growth
- **Main Bot** (`Glyphor AI`) — @mention or DM to route to any agent via commands (`ask [name] [question]`, `briefing`, `status`, `agents`)
- **Individual Agent Bots** — 8 executives have their own Teams apps with personal avatars, DM any of them directly as if they were real employees
- **Dashboard Tab** — Embedded dashboard with Teams SSO (+ Google OAuth for browser access)
- **Adaptive Cards** — Rich cards for briefings, decisions, and alerts

## Authority Model

Agents follow a three-tier decision model:

- **Green** — Autonomous. Agent executes, logs the action.
- **Yellow** — One founder approves via Teams.
- **Red** — Both founders must approve.

See [docs/AUTHORITY_MODEL.md](docs/AUTHORITY_MODEL.md) for full details.

## Key Features

- **Multi-turn Agent Chat** — Conversational chat with any agent (dashboard + Teams DM)
- **Inter-Agent Communication** — DMs (rate-limited 5/hr) and multi-round meetings (2/day per agent)
- **Strategy Lab** — 5-phase strategic analysis engine + T+1 impact simulations
- **Agent Personalities** — Each agent has backstory, communication traits, quirks, Clifton strengths, and voice calibration
- **Dynamic Agents** — Create temporary agents on-the-fly for research threads
- **Financial Syncs** — Automated Stripe (MRR), GCP billing, and Mercury (banking) data pipelines
- **Workforce Dashboard** — Org chart, agent profiles, performance tracking, memory viewer

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Operating Manual](docs/OPERATING_MANUAL.md)
- [Web Creation Operating System](docs/WEB_CREATION_OPERATING_SYSTEM.md)
- [Agent Runtime Hooks + Tracing Runbook](docs/AGENT_RUNTIME_HOOKS_TRACING_RUNBOOK.md)
- [Planning Gate Ops (within Runtime Runbook)](docs/AGENT_RUNTIME_HOOKS_TRACING_RUNBOOK.md#planning-gate-ops-canary--prod)
- [Web Coding Loop Playbook](docs/WEB_CODING_LOOP_PLAYBOOK.md)
- [Memory Schema](docs/MEMORY_SCHEMA.md)
- [Authority Model](docs/AUTHORITY_MODEL.md)
- [Runbook](docs/RUNBOOK.md)

## CI/CD

GitHub Actions workflow on push to `main`:
1. Build & test all packages via Turborepo
2. Build Docker images for scheduler and dashboard
3. Push to GCP Artifact Registry
4. Deploy to Cloud Run with secrets from GCP Secret Manager

## Recent Updates

- **Individual Agent Bots** — Each of the 8 executives has their own Azure Bot registration and Teams app, with personalized headshot avatars. Users can DM agents directly in Teams as if they were real team members.
- **Multi-Bot Routing** — Bot handler supports multi-audience JWT validation and per-bot token caching. Messages are routed by `recipient.id` to the correct agent identity.
- **Teams SSO** — Dashboard embedded in Teams uses `@microsoft/teams-js` SSO with Entra ID fallback, replacing Google OAuth popup (which doesn't work in iframes).
- **Agent Headshot Icons** — All 26 agents have AI-generated avatar headshots (Imagen 4). Executive bots use personalized icons in Teams.
- **Multi-Turn Chat** — Agent chat maintains conversation history for natural back-and-forth dialogue.
- **Inter-Agent Meetings** — Multi-round collaborative discussions with automatic synthesis and action item dispatch.
- **Strategy Lab** — Strategic analysis engine (5 types × 3 depth levels) and T+1 impact simulation engine with cascade analysis.
- **Microsoft Graph API** — Direct messages, email, and calendar integrations via MSAL client credentials.
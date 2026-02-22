# Glyphor AI Company

A system of 7 AI executive agents that operate an AI-first company alongside 2 human founders.

## What This Is

Glyphor AI Company replaces traditional org-chart roles with AI agents powered by Gemini. Each agent has a defined scope, tools, schedule, and authority level. Human founders (Kristina as CEO, Andrew as COO) retain strategic control through a tiered decision model.

## Agent Roster

| Agent | Focus | Status |
|-------|-------|--------|
| **Chief of Staff** | Morning briefings, decision routing, synthesis | ✅ Active |
| **CTO** | Platform health, deploys, model management | 📋 Stub |
| **CFO** | Cost monitoring, revenue, margin analysis | 📋 Stub |
| **CPO** | Usage analysis, roadmap, competitive intel | 📋 Stub |
| **CMO** | Content generation, social, SEO, brand | 📋 Stub |
| **VP Customer Success** | Health scoring, churn prediction, nurture | 📋 Stub |
| **VP Sales** | KYC research, proposals, pipeline | 📋 Stub |

## Architecture

```
Cloud Scheduler → Pub/Sub → Event Router → Agent Runtime → Company Memory
                                              ↓
                                        Teams Webhooks
```

**Stack**: TypeScript, Turborepo, Gemini API, Supabase, GCS, GCP Cloud Run, Microsoft Teams

## Quick Start

```bash
# Install
pnpm install

# Configure
cp .env.example .env
# Edit .env with your API keys

# Build
pnpm build

# Run Chief of Staff briefing
node packages/agents/dist/chief-of-staff/run.js
```

## Project Structure

```
packages/
├── agent-runtime/     # Core agent loop (ported from Fuse V7)
├── company-memory/    # Supabase + GCS persistence
├── agents/            # Agent configs, prompts, tools, runners
├── integrations/      # Teams webhooks & Adaptive Cards
└── scheduler/         # Cron, event routing, authority gates

docker/                # Dockerfiles for Cloud Run services
infra/
├── scripts/           # Deploy and seed scripts
└── terraform/         # GCP infrastructure as code
docs/                  # Architecture, schema, authority model, runbook
```

## Authority Model

Agents follow a three-tier decision model:

- **🟢 Green** — Autonomous. Agent executes, logs the action.
- **🟡 Yellow** — One founder approves via Teams.
- **🔴 Red** — Both founders must approve.

See [docs/AUTHORITY_MODEL.md](docs/AUTHORITY_MODEL.md) for full details.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Memory Schema](docs/MEMORY_SCHEMA.md)
- [Authority Model](docs/AUTHORITY_MODEL.md)
- [Runbook](docs/RUNBOOK.md)

## Phase Roadmap

1. **Foundation** (current) — Monorepo, Chief of Staff, Teams briefings, authority model
2. **Operations** — CTO + CFO agents, platform monitoring, cost tracking
3. **Growth** — CPO + CMO agents, usage analytics, content pipeline
4. **Revenue** — VP CS + VP Sales, health scoring, pipeline management
5. **Intelligence** — Cross-agent collaboration, market analysis
6. **Autonomy** — Self-improving agents, reduced human oversight
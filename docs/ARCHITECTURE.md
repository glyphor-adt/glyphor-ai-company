# Glyphor AI Company - Full Technical Architecture

Last updated: 2026-03-14

This document is the full technical architecture readout for the current monorepo.
It combines a full subsystem walkthrough with current, filesystem-verified inventory counts.

## 1. Executive Summary

Glyphor is a multi-service, multi-agent operating platform built as a TypeScript-first monorepo with additional Python components for graph indexing. The platform runs role-based and dynamic agents, orchestrates work through a scheduler control plane, persists memory and operations in PostgreSQL, and exposes operator workflows through a React dashboard.

At a high level:

- Control plane: scheduler, authority gating, work routing, decision workflow, policy and analysis engines.
- Execution plane: agent-runtime + role runners + tool execution + provider abstraction.
- Data plane: Cloud SQL-backed memory, operations, routing, and telemetry state.
- Operator plane: dashboard, settings, approvals, directives, governance, and strategy surfaces.
- Integration plane: Stripe, Mercury, GCP, Teams/Graph, OpenAI, Anthropic, Kling, SharePoint, GitHub, Vercel, Canva, DocuSign, and others.

## 2. Current State Inventory

Verified from repository state:

- Workspace packages under packages: 24
- Integration modules under packages/integrations/src: 19
- File-based agent role directories under packages/agents/src: 27
- Dashboard page modules under packages/dashboard/src/pages: 29
- SQL migrations under db/migrations: 169
- Docker build files under docker (Dockerfile.*): 15

Top-level packages currently present:

- a2a-gateway
- agent-runtime
- agent-sdk
- agents
- company-knowledge
- company-memory
- dashboard
- graphrag-indexer
- integrations
- mcp-data-server
- mcp-design-server
- mcp-email-marketing-server
- mcp-engineering-server
- mcp-finance-server
- mcp-hr-server
- mcp-legal-server
- mcp-marketing-server
- mcp-slack-server
- scheduler
- shared
- slack-app
- smoketest
- voice-gateway
- worker

## 3. Architectural Principles

- Database-first runtime truth: agent state, assignments, routing, and telemetry are persisted and queryable.
- Role-aware execution: runners are selected by role and task semantics.
- Separation of control and execution planes: scheduler orchestrates, runtime executes.
- Tool governance and safety: tools are routed and constrained through runtime definitions and policy workflows.
- Multi-provider model abstraction: provider adapters normalize behavior across model vendors.
- Operator transparency: dashboard surfaces route status, directives, approvals, profiles, and governance controls.

## 4. High-Level Topology

```text
Triggers and Inputs
  - Cloud Scheduler
  - Dashboard actions
  - Teams events and Graph callbacks
  - Webhooks (billing and platform)
  - Internal events and wake signals

        |
        v
Scheduler Service (control plane)
  - routing, orchestration, authority checks
  - analysis/simulation/strategy workflows
  - dashboard CRUD/API mediation

        |
        v
Agent Runtime (execution plane)
  - runner selection
  - provider model calls
  - tool execution and result handling
  - context/memory loading and reflection

        |
        v
Company Memory (data plane)
  - PostgreSQL operational state
  - vector-backed and graph-backed memory tables
  - persistent history and governance logs

        +---------------------------+
        |                           |
        v                           v
Dashboard UI                  External Integrations
React/Vite operator surface   Stripe, GCP, Teams, etc.
```

## 5. Core Services and Responsibilities

### 5.1 Scheduler (packages/scheduler)

Primary role:

- Cloud Run entrypoint for orchestration, route handling, policy/evaluation flows, and scheduled triggers.

Major responsibilities:

- Route trigger handling for scheduled and direct runs.
- Event routing and wake handling.
- Decision and approval lifecycle integration.
- Dynamic scheduling and heartbeat checks.
- Analysis engines (analysis, simulation, deep dive, strategy lab, CoT).
- Dashboard API facade and governance API surfaces.

Representative modules:

- server.ts
- eventRouter.ts
- authorityGates.ts
- decisionQueue.ts
- dynamicScheduler.ts
- heartbeat.ts
- wakeRouter.ts
- analysisEngine.ts
- simulationEngine.ts
- deepDiveEngine.ts
- strategyLabEngine.ts
- cotEngine.ts
- dashboardApi.ts
- governanceApi.ts

### 5.2 Agent Runtime (packages/agent-runtime)

Primary role:

- Unified runtime framework for all agent executions independent of role specialization.

Major responsibilities:

- Execution state machine and runner abstractions.
- Multi-provider model access.
- Tool registry and tool execution bridge.
- Context loading and memory injection.
- Event bus integration and telemetry emissions.
- Reasoning and verification helpers.

Key architectural primitives:

- AgentConfig and CompanyAgentRole typing in types.ts.
- ConversationTurn and attachment transport model.
- AgentExecutionResult with cost and provider metadata.
- Supervisor constraints (turn limits, stalling, timeout semantics).

### 5.3 Agent Implementations (packages/agents)

Primary role:

- Role-specific prompts, toolsets, and runners for file-based agents plus shared execution wiring.

File-based role directories currently present (27):

- chief-of-staff
- cto
- cpo
- cmo
- cfo
- clo
- vp-sales
- vp-design
- vp-research
- platform-engineer
- quality-engineer
- devops-engineer
- m365-admin
- global-admin
- user-researcher
- competitive-intel
- content-creator
- seo-analyst
- social-media-manager
- ui-ux-designer
- frontend-engineer
- design-critic
- template-architect
- head-of-hr
- ops
- competitive-research-analyst
- market-research-analyst

Runner selection is centralized in shared/createRunner.ts:

- on_demand task -> CompanyAgentRunner
- orchestrator roles -> OrchestratorRunner
- all other role/task combinations -> TaskRunner

### 5.4 Company Memory (packages/company-memory)

Primary role:

- Persistence contracts and data access layer for company state, memory, and graph knowledge.

Major responsibilities:

- Cloud SQL persistence for operational and memory entities.
- Embedding and retrieval support for semantic memory.
- Shared memory and world model update pathways.
- Graph read/write interfaces.

### 5.5 Integrations (packages/integrations)

Primary role:

- External system connectivity and domain-specific API clients.

Current integration modules (19):

- agent365
- anthropic
- canva
- credentials
- docusign
- gcp
- github
- governance
- kling
- mercury
- openai
- posthog
- pulse
- search-console
- sendgrid
- sharepoint
- stripe
- teams
- vercel

Integration entrypoint exports include capabilities for:

- Teams messaging and cards
- Graph chat and subscription management
- Email and calendar operations
- Payment and billing ingestion
- Cloud metrics and deployment telemetry
- Document and creative workflows

### 5.6 Dashboard (packages/dashboard)

Primary role:

- Operational control and observability UI for founders and operators.

Stack:

- React 19
- Vite
- TypeScript
- Tailwind CSS
- React Router

Authentication modes (lib/auth.tsx):

- Teams SSO flow when in Teams context.
- Google OAuth flow in browser context.
- Dev fallback mode when client ID is absent.

### 5.7 Worker (packages/worker)

Primary role:

- Cloud Tasks processing surface for asynchronous execution and output delivery.

### 5.8 Voice Gateway (packages/voice-gateway)

Primary role:

- Voice session lifecycle and realtime voice bridge workflows.

### 5.9 GraphRAG Indexer (packages/graphrag-indexer)

Primary role:

- Graph-oriented extraction, indexing, and bridge operations.

### 5.10 Slack Surfaces (packages/slack-app and packages/mcp-slack-server)

Primary role:

- Slack ingress workflows and Slack MCP operations.

### 5.11 A2A Gateway (packages/a2a-gateway)

Primary role:

- Agent-to-agent protocol bridge and task forwarding edge surface.

## 6. End-to-End Runtime Flows

### 6.1 Scheduled Work Flow

```text
Cloud Scheduler trigger
  -> scheduler route ingestion
  -> role/task resolution
  -> tracked execution call
  -> runtime runner selection
  -> model/tool turns
  -> result persistence
  -> post-run events and telemetry updates
```

### 6.2 On-Demand Chat Flow

```text
Dashboard chat request
  -> scheduler /run mediation
  -> on_demand task path
  -> CompanyAgentRunner
  -> conversation history + context loading
  -> provider response + tool calls
  -> persisted conversation and activity
```

### 6.3 Directive and Assignment Flow

```text
Directive created or updated
  -> scheduler/directive handling
  -> assignment dispatch and routing
  -> role agents execute work
  -> assignment output persisted
  -> approvals/escalations if required
```

### 6.4 Inter-Agent Communication Flow

```text
Agent event or message
  -> event bus route
  -> wake routing / queue checks
  -> target agent run
  -> response persisted and optionally surfaced to dashboard or Teams
```

### 6.5 Reflective Learning Flow

```text
Run completes
  -> reflection generation
  -> memory writes
  -> skill and feedback updates
  -> optional graph/world-model updates
```

## 7. Scheduler API Surface (Functional Categories)

The scheduler server hosts a broad API set. Rather than hardcoding a volatile endpoint count, routes are grouped by function:

- Core execution routes: task run dispatch, event ingestion, heartbeat.
- Agent lifecycle routes: create/update/pause/resume/delete and prompt settings.
- Dashboard data routes: table-backed reads/writes mediated by dashboard API handlers.
- Strategy routes: analysis, simulation, deep dive, strategy lab, CoT, export and visualization actions.
- Governance and policy routes: governance sync, policy collection/evaluation, canary checks.
- Tool and memory maintenance routes: tool expiration/re-enable, memory consolidation/archive.
- Integration callback routes: Teams/Graph callbacks, webhook receivers, sync triggers.
- SDK routes: external client SDK list/get/create/retire style operations.

This grouping is intentionally resilient to route growth while preserving architectural clarity.

## 8. Dashboard Route Architecture

Routes currently wired in dashboard App.tsx:

- /
- /directives
- /workforce
- /agents/new
- /builder
- /agents/:agentId
- /agents/:agentId/settings
- /approvals
- /financials
- /operations
- /strategy
- /knowledge
- /skills
- /skills/:slug
- /comms
- /chat/:agentId
- /teams-config
- /governance
- /policy (redirect)
- /ora
- /change-requests
- /settings

Legacy redirects currently preserved:

- /agents -> /workforce
- /chat -> /comms
- /activity -> /operations
- /graph -> /knowledge
- /capabilities -> /skills
- /meetings -> /comms
- /world-model -> /skills
- /group-chat -> /comms

Notable routing behavior:

- Agent settings path uses AgentProfile route with settings tab mode.

## 9. Dashboard Page Surface

Current page module inventory under src/pages (29 files):

- Activity.tsx
- AgentBuilder.tsx
- AgentProfile.tsx
- AgentSettings.tsx
- AgentsList.tsx
- Approvals.tsx
- Capabilities.tsx
- Chat.tsx
- Comms.tsx
- Dashboard.tsx
- Directives.tsx
- Financials.tsx
- Governance.tsx
- Graph.tsx
- GroupChat.tsx
- Knowledge.tsx
- Meetings.tsx
- Operations.tsx
- OraChat.tsx
- PolicyVersions.tsx
- Settings.tsx
- SkillDetail.tsx
- Skills.tsx
- Strategy.tsx
- TeamsConfig.tsx
- Workforce.tsx
- WorkforceBuilder.tsx
- WorldModel.tsx
- ChangeRequests.tsx

## 10. Data Architecture

### 10.1 Persistence Strategy

- PostgreSQL is used as the primary persistent state store.
- Migrations are managed as SQL files under db/migrations (169 files currently).
- Runtime writes are concentrated in execution, assignment, decision, memory, and telemetry domains.

### 10.2 Data Domains

Representative data domains persisted in the platform include:

- Workforce and identity
  - company_agents
  - agent_profiles
  - agent_briefs
  - agent_schedules

- Work orchestration
  - founder_directives
  - work_assignments
  - decisions
  - activity logs

- Execution telemetry
  - agent_runs
  - agent_performance
  - runtime outputs and quality traces

- Memory and knowledge
  - agent_memory
  - shared episodes/procedures style structures
  - knowledge graph nodes/edges
  - company pulse and knowledge materialization

- Communication
  - agent_messages
  - agent_meetings
  - chat message histories

- Governance and platform state
  - platform audit state/log domains
  - policy and access metadata

## 11. Tooling and Capability Architecture

Tool execution follows a shared pattern:

- Tool declaration and parameter schema definition.
- Runtime execution via context-aware tool executor.
- Result capture and conversation turn propagation.
- Optional safety/verification gates for mutative actions.
- Post-run receipt and telemetry persistence.

Tool surface sources:

- Shared role tools in packages/agents/src/shared.
- Runtime and dynamically registered tools through runtime registries.
- Domain MCP server tools exposed by mcp-* packages.

## 12. Integrations by Domain

### 12.1 Communications

- Teams (channels/cards/chat)
- Graph chat handlers and subscriptions
- Email and calendar clients

### 12.2 Finance and Costing

- Stripe
- Mercury
- OpenAI/Anthropic/Kling billing
- GCP billing exports

### 12.3 Engineering and Delivery

- GitHub
- Vercel
- GCP metrics and build metadata

### 12.4 Knowledge and Content

- SharePoint ingestion and document access
- Search Console and analytics modules
- Canva and DocuSign integrations

## 13. Deployment and Runtime Packaging

Docker build assets currently present:

- Dockerfile.a2a-gateway
- Dockerfile.chief-of-staff
- Dockerfile.dashboard
- Dockerfile.graphrag-indexer
- Dockerfile.mcp-data-server
- Dockerfile.mcp-design-server
- Dockerfile.mcp-email-marketing-server
- Dockerfile.mcp-engineering-server
- Dockerfile.mcp-finance-server
- Dockerfile.mcp-hr-server
- Dockerfile.mcp-legal-server
- Dockerfile.mcp-marketing-server
- Dockerfile.scheduler
- Dockerfile.voice-gateway
- Dockerfile.worker

Deployment shape (logical):

- Cloud Run services for scheduler/dashboard/worker/voice and selected MCP servers.
- Supporting infra via infra/ scripts and Terraform assets.

## 14. Security, Access, and Governance

### 14.1 Dashboard Access

- Teams SSO path in Teams context.
- Google OAuth path in browser context.
- Allowlist-backed gating with fallback controls in auth provider.

### 14.2 Runtime Governance

- Authority tiering and approval pathways in scheduler.
- Decision queue and human-in-the-loop escalation model.
- Governance sync and policy/canary evaluation endpoints.

### 14.3 Platform Controls

- Audit and platform state logging integrations.
- Tool and memory lifecycle maintenance routes.

## 15. Build, Test, and Operations

Root scripts include:

- build: turbo run build
- dev: turbo run dev
- lint: turbo run lint
- typecheck: turbo run typecheck
- scheduler:dev
- dashboard:dev
- smoke and validation scripts

Operationally relevant characteristics:

- Multi-service development and deployment via workspaces.
- Cross-package build graph via turbo.json.
- Domain-specific sync and maintenance scripts in scripts/.

## 16. Architecture Risks and Drift Controls

This codebase evolves quickly, so route counts and endpoint inventories can drift.

Recommended drift controls:

- Update this document whenever packages are added or removed.
- Update route map whenever App.tsx changes.
- Recompute migration count when adding migrations.
- Keep integration module inventory aligned with packages/integrations/src.
- Keep docker image list aligned with docker/Dockerfile.* files.

## 17. Maintenance Checklist

When updating architecture docs, re-verify:

- packages count and names
- dashboard route map
- integration module list
- migration count
- docker build files
- auth mode implementation
- runner selection behavior

## 18. Notes on Scope

This is a full technical architecture readout of the currently implemented platform surfaces and subsystem responsibilities. It is intentionally detailed and implementation-aligned, while avoiding brittle hardcoded per-endpoint totals that become stale as routes evolve.
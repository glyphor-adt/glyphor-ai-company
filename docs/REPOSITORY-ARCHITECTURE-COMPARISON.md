# Competitive Architecture Comparison: glyphor-ai-company vs code-main

## SECTION 1: Executive Summary

**Repository A (`glyphor-ai-company`)** is a **multi-tenant AI company operating system**: a production-oriented monorepo with a React dashboard, Cloud Run services, Cloud Tasks queues, Postgres tenancy, Redis cache, MCP-style integrations, and a large custom agent runtime. Evidence starts at `package.json`, `packages/scheduler/src/server.ts`, `packages/worker/src/index.ts`, `packages/dashboard/src/App.tsx`, `packages/agent-runtime/src/index.ts`, and `infra/terraform/main.tf`.

**Repository B (`code-main`)** is a **local-first AI coding assistant runtime**: a Bun/TypeScript CLI with React+Ink UI, a deep query/tool loop, sub-agents, MCP/LSP/plugin integrations, transcript persistence, and persistent file-based memory. Evidence starts at `src/main.tsx`, `src/query.ts`, `src/QueryEngine.ts`, `src/tools.ts`, `src/tools/AgentTool/AgentTool.tsx`, `src/utils/sessionStorage.ts`, and `src/memdir/memdir.ts`.

### Key differences

1. **Product center of gravity**: A is a cloud-hosted business platform; B is a local agent runtime.
2. **Runtime topology**: A uses multi-service GCP infrastructure (`scheduler`, `worker`, queues, Pub/Sub, Redis, Cloud SQL); B is primarily a single local process with spawned sub-agents and optional remote/bridge modes.
3. **State model**: A persists most behavior in Postgres schemas and admin tables; B persists sessions and memory as JSONL/files under local config directories.
4. **User experience**: A is a web dashboard with polling-heavy status refresh; B is a streaming terminal UI with progress events and resumable sessions.
5. **Agent orchestration**: A has ambitious org-style orchestration primitives (handoff contracts, world model, tool registry, decision traces); B has a tighter, battle-tested execution loop for actual tool-using agents.
6. **Extensibility**: A extends through packages, MCP servers, integrations, and DB-registered tools; B extends through tools, plugins, skills, MCP, agents, and feature flags.
7. **Observability**: A logs business/agent telemetry into DB tables and admin APIs; B has startup profiling, analytics, telemetry, and transcript-based auditability.
8. **Security posture**: A has stronger cloud identity and tenant isolation primitives, but also several fail-open or fallback paths; B has stronger per-tool permission mediation in the core loop.
9. **Architecture risk**: A's scheduler is drifting into a god service; B's core loop is cleaner but the leaked repo snapshot is incomplete for infra/deployment.

### Overall judgment

- **As a production application platform, Repository A is stronger**: it has real infra, tenancy, integrations, queues, deployment, admin surfaces, and persisted business state.
- **As an AI agent runtime, Repository B is stronger**: its tool loop, permission model, session persistence, streaming UX, and sub-agent architecture are materially more coherent and polished.

### Top 5 ideas Repository A should learn from Repository B

1. **Make agent execution a first-class loop**, not a scattered platform concern.
2. **Adopt transcript-grade session persistence and resume**, not just DB logs.
3. **Add explicit tool permission mediation** around every agent tool call.
4. **Shift from polling-heavy UX to streaming task/progress UX**.
5. **Separate coordinator prompts from worker prompts more rigorously**, with explicit capability context.

## SECTION 2: System Overview for Each Repository

### Repository A - glyphor-ai-company

- **Primary purpose**: Multi-tenant autonomous company platform for internal teams and SMB/customer-facing operations.
- **Main user flows**:
  1. User signs into dashboard (`packages/dashboard/src/lib/auth.tsx`, `packages/dashboard/src/lib/firebase.ts`).
  2. Dashboard calls scheduler CRUD/admin APIs (`packages/scheduler/src/dashboardApi.ts`).
  3. Scheduler routes work, issues workflows, syncs data, and enqueues executions (`packages/scheduler/src/server.ts`, `packages/scheduler/src/workerQueue.ts`).
  4. Worker executes `/run` or `/deliver` tasks, advances workflow state, and reports back (`packages/worker/src/index.ts`).
  5. Dashboard polls backend tables/APIs for progress (`packages/dashboard/src/pages/Operations.tsx`).
- **Major subsystems**:
  - Web UI: `packages/dashboard`
  - Agent runtime/core orchestration: `packages/agent-runtime`
  - Scheduler control plane: `packages/scheduler`
  - Worker execution plane: `packages/worker`
  - Shared DB/auth/utilities: `packages/shared`
  - Integrations: `packages/integrations`, `mcp-*`, `slack-app`, `voice-gateway`
- **Backend architecture**: Modular monorepo, but practically a **modular monolith + service split**.
- **Frontend architecture**: React 19 + Vite + React Router (`packages/dashboard/package.json`, `packages/dashboard/src/main.tsx`, `packages/dashboard/src/App.tsx`).
- **Data/storage architecture**: Postgres is the system of record via `packages/shared/src/db.ts`; Redis/Memorystore is provisioned in `infra/terraform/main.tf`; Cloud Tasks handles asynchronous work.
- **Auth and identity**: Firebase auth for dashboard users (`packages/shared/src/auth.ts`, `packages/dashboard/src/lib/firebase.ts`), Teams SSO support (`packages/dashboard/src/lib/auth.tsx`), service accounts and OIDC task dispatch in GCP (`packages/worker/src/queue.ts`, `infra/terraform/main.tf`).
- **Tooling / external integrations**: Slack, Teams, Stripe, Mercury, SharePoint, DocuSign, Google Cloud, Azure, GitHub, and many MCP servers.
- **Deployment/runtime model**: Cloud Run services + Cloud Build + Terraform + Pub/Sub + Cloud Tasks + Redis + Cloud SQL-like posture.
- **Observability / logging / telemetry**: DB-backed traces and admin dashboards. `packages/agent-runtime/src/toolExecutor.ts` persists `tool_call_traces` and `activity_log`.
- **Security patterns**: tenant-aware DB access in `packages/shared/src/db.ts`; row-level-security migration exists; ABAC and disclosure policies live in runtime exports; secrets live in Secret Manager.
- **Extensibility model**: package-per-capability, static + DB-backed tool registry (`packages/agent-runtime/src/toolRegistry.ts`), many dedicated MCP server packages.

### Repository B - code-main

- **Primary purpose**: Local AI software engineering assistant with terminal-native UI, tool execution, code editing, sub-agents, MCP/LSP integrations, and persistent session/memory handling.
- **Main user flows**:
  1. CLI boots and prefetches MDM/keychain/settings in parallel (`src/main.tsx`).
  2. It initializes config, telemetry, proxy/mTLS, scratchpad, and LSP managers (`src/entrypoints/init.ts`).
  3. User prompt enters `QueryEngine.submitMessage()` (`src/QueryEngine.ts`).
  4. `query.ts` runs the LLM/tool loop, including compaction, tool execution, retries, and stop hooks.
  5. Results, progress, and tool outputs stream into the Ink UI and transcripts are persisted (`src/QueryEngine.ts`, `src/utils/sessionStorage.ts`).
  6. Optional sub-agents are launched through `src/tools/AgentTool/AgentTool.tsx` / `runAgent.ts`.
- **Major subsystems**:
  - CLI/bootstrap: `src/main.tsx`, `src/entrypoints`
  - Core loop: `src/query.ts`, `src/QueryEngine.ts`
  - Tooling: `src/tools.ts`, `src/tools/*`
  - Commands: `src/commands.ts`, `src/commands/*`
  - State/session: `src/bootstrap/state.ts`, `src/utils/sessionStorage.ts`
  - Memory: `src/memdir/*`
  - Multi-agent coordination: `src/coordinator/*`, `src/tools/AgentTool/*`, `src/tasks/*`
  - Extensions: `src/services/mcp`, `src/services/lsp`, `src/plugins`, `src/skills`
- **Backend architecture**: No conventional backend in this snapshot; the runtime is **local-process, agentic, evented, and tool-driven**.
- **Frontend architecture**: React + Ink CLI UI (`src/main.tsx`, `src/components`, `src/screens`), with streaming partial output and progress messages.
- **Data/storage architecture**: file-based session persistence (`src/utils/sessionStorage.ts`) and file-based durable memory (`src/memdir/memdir.ts`).
- **Auth and identity**: OAuth/API-key hybrid logic is visible in `src/services/api/bootstrap.ts`.
- **Tooling / external integrations**: MCP, LSP, plugins, remote sessions, IDE bridge, web fetch/search, shell, files, notebooks, tasks, teams, cron, workflow scripts.
- **Deployment/runtime model**: Bun runtime + local terminal process.
- **Observability / logging / telemetry**: startup profiler, lazy telemetry initialization, analytics/feature flags, transcript history, and perf/diagnostic hooks.
- **Security patterns**: trust-gated init, tool permission checks in the execution loop, plugin-only restrictions, MCP filtering, session scoping, and explicit permission contexts.
- **Extensibility model**: tools, agents, MCP servers, plugins, skills, commands, feature flags, and multiple runtime modes all hang off explicit registries and adapters.

## SECTION 3: Side by Side Architecture Comparison

### 1. Overall architecture style
- **A**: Cloud-hosted **modular monolith with service split**.
- **B**: **Local-first agent runtime** with modular internals.
- **Winner**: **B for architectural coherence**, **A for production topology breadth**.

### 2. Frontend architecture
- **A**: Conventional web app with polling-heavy status UX.
- **B**: Terminal UI, but architecturally richer in responsiveness: streamed partial messages, task progress, inline progress events, agent notifications.
- **Winner**: **B**.

### 3. Backend architecture
- **A**: Real backend boundaries: scheduler, worker, queues, DB, webhooks, sync jobs. But `packages/scheduler/src/server.ts` is overloaded.
- **B**: Backend-like behavior exists inside the CLI process: the query loop, tool execution, task manager, agent launcher, bridge/server modules.
- **Winner**: **A** on backend scope; **B** on execution-loop cleanliness.

### 4. AI / agent architecture
- **A**: Very ambitious. It has orchestrator/task archetypes, handoff contracts, world model, tool registry, policy limits, disclosure, constitutional checks, telemetry, and evaluation tables. But some execution paths remain placeholder or partially wired.
- **B**: The strongest area. `src/QueryEngine.ts` + `src/query.ts` + `src/tools/AgentTool/AgentTool.tsx` give a clear planning/execution/tool/recovery/resume model.
- **Winner**: **B clearly**.

### 5. Data architecture
- **A**: Strongest area besides infra. Multi-tenant schemas, handoff contracts, temporal knowledge graph with embeddings, tool trace tables, memory lifecycle, memory consolidation leases.
- **B**: Deliberately lighter-weight. Filesystem transcripts + filesystem memory.
- **Winner**: **A clearly**.

### 6. Developer platform and extensibility
- **A**: Many packages and registries; adding a capability often means package + migration + scheduler route + dashboard surface.
- **B**: New capabilities slot naturally into tools, skills, plugins, commands, MCP, or agents.
- **Winner**: **B**.

### 7. Deployment and infrastructure
- **A**: Mature deployment story: Cloud Build, Terraform, Artifact Registry, Cloud Run, Secret Manager, Pub/Sub, Cloud Tasks, Redis, service accounts.
- **B**: Inference-limited in this snapshot.
- **Winner**: **A**.

### 8. Reliability and observability
- **A**: Good operational instrumentation, but runtime reliability is uneven.
- **B**: Better core-loop reliability: retries, compaction, transcript repair, progress filtering, permission tracking, startup profiling.
- **Winner**: **B for agent-runtime reliability**, **A for ops telemetry breadth**.

### 9. Security posture
- **A**: Stronger cloud identity, tenant tables, row-level-security migration, Secret Manager, OIDC task dispatch. But there are concerning fallback patterns.
- **B**: Stronger per-action mediation: permission hooks are in the core agent loop.
- **Winner**: **Tie with different strengths**.

### 10. Product differentiation through architecture
- **A**: Differentiates through breadth: autonomous departments, enterprise integrations, org memory, dashboards, governance, tenant-aware workflows.
- **B**: Differentiates through depth: a highly polished, low-latency, stateful, agentic coding runtime.
- **Future scale**: **A** supports organizational/product expansion better; **B** supports agent quality and user trust better.

## SECTION 4: File-Level Evidence

### Orchestration
- **A** - `packages/agent-runtime/src/orchestratorRunner.ts` / `OrchestratorRunner.buildRunPrompt()`
- **A** - `packages/scheduler/src/server.ts`
- **A** - `packages/worker/src/index.ts`
- **B** - `src/QueryEngine.ts` / `submitMessage()`
- **B** - `src/query.ts` / `query()` + `queryLoop()`
- **B** - `src/coordinator/coordinatorMode.ts`

### Frontend UX
- **A** - `packages/dashboard/src/App.tsx`
- **A** - `packages/dashboard/src/pages/Operations.tsx`
- **A** - `packages/dashboard/src/lib/firebase.ts`
- **B** - `src/main.tsx`
- **B** - `src/tools/AgentTool/AgentTool.tsx`
- **B** - `src/QueryEngine.ts`

### Backend services
- **A** - `packages/scheduler/src/server.ts`
- **A** - `packages/worker/src/index.ts`
- **A** - `packages/shared/src/db.ts`
- **B** - `src/services/api/bootstrap.ts`
- **B** - `src/bridge/*`, `src/server/*`, and `src/services/*`

### Tool execution
- **A** - `packages/agent-runtime/src/toolExecutor.ts`
- **A** - `packages/agent-runtime/src/toolRegistry.ts`
- **B** - `src/tools.ts`
- **B** - `src/query.ts`
- **B** - `src/tools/AgentTool/runAgent.ts`

### Persistence
- **A** - `packages/shared/src/db.ts`
- **A** - `db/migrations/20260302100001_tenants.sql`
- **A** - `db/migrations/20260330124500_agent_handoff_contracts.sql`
- **A** - `db/migrations/20260330143000_temporal_knowledge_graph.sql`
- **A** - `db/migrations/20260403140000_memory_consolidation_state.sql`
- **B** - `src/utils/sessionStorage.ts`
- **B** - `src/memdir/memdir.ts`

### Deployment
- **A** - `infra/terraform/main.tf`
- **A** - `cloudbuild-all.yaml`
- **A** - `packages/worker/src/queue.ts`
- **B** - Snapshot is source-only, so infra evidence is limited.

### Security
- **A** - `packages/shared/src/auth.ts`
- **A** - `packages/shared/src/db.ts`
- **A** - `packages/agent-runtime/src/toolExecutor.ts`
- **B** - `src/QueryEngine.ts`
- **B** - `src/query.ts`
- **B** - `src/tools/AgentTool/AgentTool.tsx`
- **B** - `src/entrypoints/init.ts`

### Observability
- **A** - `packages/agent-runtime/src/toolExecutor.ts`
- **A** - `packages/scheduler/src/server.ts`
- **B** - `src/main.tsx`
- **B** - `src/entrypoints/init.ts`
- **B** - `src/utils/sessionStorage.ts`

## SECTION 5: Hidden Design Patterns and Strategic Insights

- **A's hidden leverage**: the DB schema is not just storage; it is the product architecture.
- **A's hidden liability**: too much logic converges in `packages/scheduler/src/server.ts`.
- **A's sophisticated-looking but fragile area**: org-style orchestration is ahead of the fully wired execution plane.
- **B's hidden leverage**: transcripts, memory, compaction, permissions, and tool execution are treated as one integrated runtime problem.
- **B's hidden liability**: feature-flag and environment branching is very high.
- **Perceived intelligence/polish**:
  - **A** improves perceived intelligence through domain breadth and long-lived organizational memory.
  - **B** improves perceived intelligence through faster startup, streaming, clear progress, context compaction, and local memory continuity.
- **Evolvability**: **B is easier to evolve at the runtime layer**; **A is easier to evolve at the product-surface layer** but harder to keep internally coherent.

## SECTION 6: Competitive Advantage Analysis

### What Repository B does better architecturally
- Core agent loop design.
- User-visible execution transparency.
- Session persistence and resumption.
- Permission mediation inside the runtime.
- Extension model for tools/skills/plugins/MCP.

### What Repository A does better architecturally
- Multi-tenant product/platform design.
- Deployment and cloud runtime maturity.
- Enterprise integration depth.
- Structured organizational memory and governance schemas.
- Control-plane visibility through DB-backed operational surfaces.

### Hard to copy
- **B**: runtime polish in transcript repair, compaction, progress handling, coordinator/worker separation, and tool-loop discipline.
- **A**: accumulated data model, integrations, and cloud-operational footprint.

### Easy to copy
- **From B to A**: explicit worker capability prompts, transcript persistence patterns, streaming task UX patterns, registry cleanup, startup lazy-loading ideas.
- **From A to B**: dashboard/admin views, evaluation tables, cloud queues, organizational metadata tables.

### Missing capabilities in A that would matter most to users
1. Real-time streaming status for long-running agent work.
2. Better resume/explainability for prior agent sessions.
3. Tighter per-tool approval/permission UX.
4. Clearer separation between orchestrator control plane and execution plane.
5. Less placeholder behavior in worker execution paths.

### Highest strategic value additions to A
1. Streaming execution + transcript model.
2. Runtime-centric agent loop refactor.
3. Stronger permission/approval mediation around tool calls.
4. Explicit worker summaries, retries, and completion notifications.
5. Narrower, clearer backend boundaries.

## SECTION 7: Recommendations for Repository A

### Immediate quick wins
1. Replace polling-heavy workflow views with streamed progress events.
2. Add transcript persistence per run/assignment.
3. Standardize worker completion envelopes.
4. Make tool permission decisions explicit in the runtime.

### Medium complexity improvements
1. Refactor scheduler into narrower domain services.
2. Introduce a formal agent turn loop abstraction.
3. Move dashboard progress UX from database polling to subscription/event streams.
4. Reduce static tool registry sprawl.

### High-leverage architectural shifts
1. Make `agent-runtime` the true product kernel.
2. Adopt coordinator/worker prompt layering modeled after B.
3. Create a session-grade execution ledger.
4. Separate domain memory from execution memory.

### Patterns worth borrowing from Repository B
- `src/query.ts` style single execution loop.
- `src/QueryEngine.ts` style transcript-aware streaming model.
- `src/utils/sessionStorage.ts` chain-safe resume/replay logic.
- `src/memdir/memdir.ts` explicit memory mechanics and constraints.
- `src/coordinator/coordinatorMode.ts` coordinator-vs-worker role contract.
- `src/tools.ts` explicit tool source-of-truth + gating.

### Patterns A should avoid copying blindly
- B's heavy feature-flag branching.
- B's local-file persistence model as the primary system of record.
- B's local-runtime assumptions around terminal/desktop trust boundaries.

### Recommended implementation order
1. Execution transparency.
2. Runtime guardrails.
3. Kernel refactor.
4. Service decomposition.
5. UX upgrades.

## SECTION 8: Final Scoring Matrix

| Dimension | Repo A | Repo B | Why |
| --- | ---: | ---: | --- |
| Architecture clarity | 6 | 8 | A is powerful but sprawling; B has a clearer runtime spine. |
| Scalability | 7 | 6 | A has real cloud scaling primitives; B scales primarily as a client/runtime in this snapshot. |
| Extensibility | 8 | 9 | A is extensible through packages/integrations; B's tool/plugin/skill/MCP design is cleaner. |
| Reliability | 6 | 8 | A has ops scaffolding but some placeholder execution and fail-open behavior; B has stronger loop reliability and session recovery. |
| Security | 7 | 8 | A has better cloud/IAM/tenant controls; B has stronger per-action permission mediation in the runtime. |
| Developer experience | 6 | 9 | A's monorepo is productive but heavy; B is engineered for developer workflows end-to-end. |
| AI orchestration quality | 7 | 9 | A has ambitious concepts; B has the more coherent and battle-ready orchestration implementation. |
| User experience architecture | 6 | 9 | A's dashboard breadth is good, but polling and backend coupling hurt polish; B's streaming/progress/resume architecture is excellent. |
| Observability | 7 | 7 | A has richer ops/admin telemetry; B has better runtime/session observability. |
| Competitive defensibility | 7 | 8 | A is defensible through enterprise breadth; B is defensible through execution quality and hard-to-copy runtime polish. |

## Post-report update from deep scans

The later deep-scan agents reinforced one material finding:

- **High-priority security concern in Repository A**: `docker/nginx.conf` proxies `/api/`, `/admin/`, and eval/tool paths to the scheduler, while `packages/scheduler/src/server.ts` appears to authenticate only selected internal/SDK routes rather than the normal dashboard/control-plane surface. That likely means sensitive APIs are more exposed than intended.

- **Repository A runtime flow confirmed**:
  `packages/dashboard/src/pages/Chat.tsx` ->
  `packages/scheduler/src/server.ts` ->
  `packages/scheduler/src/eventRouter.ts` ->
  `packages/agent-runtime/src/companyAgentRunner.ts`

- **Repository B runtime spine confirmed**:
  `src/main.tsx` ->
  `src/interactiveHelpers.tsx` ->
  `src/screens/REPL.tsx` ->
  `src/query.ts` / `src/QueryEngine.ts` ->
  `src/utils/sessionStorage.ts`

## Final conclusion

If the question is **"Which architecture better runs an AI company platform?"**, Repository A wins.

If the question is **"Which architecture better runs an AI agent product?"**, Repository B wins by a meaningful margin.

The fastest way to improve Repository A is not copying Repository B's product surface; it is copying **Repository B's runtime discipline**.

# Section 9 — Coupling, Complexity, and God Tables

**Audit date:** 2026-04-27
**Scope:** Top-level packages under `packages/`, source files (`.ts/.tsx/.js/.jsx/.mjs/.cjs`, excluding `node_modules`, `dist`, `.next`, `build`, `.turbo`, `.venv`, `coverage`, `out`, `__pycache__`, `.d.ts`).
**Methodology scripts:** `scratch/s9-coupling.js`, `scratch/s9-tables.js` (committed for reproducibility).

---

## 9.1 Fan-in / Fan-out per package

**Method.** For every TS/JS source file inside `packages/<pkg>/`, regex-extract `import … from '…'`, `require('…')`, and dynamic `import('…')` specifiers. Map specifiers starting with `@glyphor/<name>` to their owning package directory (via `package.json` `name`). Self-imports excluded. Fan-in = number of *other* `@glyphor/*` packages that reference this package. Fan-out = number of *other* `@glyphor/*` packages this package references.

Sorted by fan-in descending, then fan-out.

| Package | Fan-in | Fan-out | Imports |
|---|---|---|---|
| `shared` | 11 | 0 | — |
| `agent-runtime` | 7 | 1 | shared |
| `agents` | 3 | 4 | agent-runtime, company-memory, integrations, shared |
| `company-memory` | 3 | 2 | agent-runtime, shared |
| `integrations` | 3 | 2 | agent-runtime, shared |
| `scheduler` | 1 | 5 | agent-runtime, agents, company-memory, integrations, shared |
| `smoketest` | 0 | 4 | agent-runtime, agents, company-memory, shared |
| `worker` | 0 | 4 | agent-runtime, agents, scheduler, shared |
| `voice-gateway` | 0 | 3 | agent-runtime, integrations, shared |
| `a2a-gateway` | 0 | 1 | shared |
| `dashboard` | 0 | 1 | shared |
| `slack-app` | 0 | 1 | shared |
| `agent-sdk` | 0 | 0 | — |
| `company-knowledge` | 0 | 0 | — |
| `design-system` | 0 | 0 | — |
| `graphrag-indexer` | 0 | 0 | — |
| `mcp-data-server` | 0 | 0 | — |
| `mcp-design-server` | 0 | 0 | — |
| `mcp-email-marketing-server` | 0 | 0 | — |
| `mcp-engineering-server` | 0 | 0 | — |
| `mcp-finance-server` | 0 | 0 | — |
| `mcp-hr-server` | 0 | 0 | — |
| `mcp-legal-server` | 0 | 0 | — |
| `mcp-marketing-server` | 0 | 0 | — |
| `mcp-slack-server` | 0 | 0 | — |

### Observations

- **`shared`** is the universal sink (fan-in 11, fan-out 0) — healthy "kernel" position.
- **`agent-runtime`** has the second-highest fan-in (7) and is the de-facto runtime kernel; any breaking change ripples broadly.
- **`scheduler`** has the highest fan-out (5). It is the only package importing four other internal packages — it acts as an orchestrator/composition root for backend jobs.
- All `mcp-*` packages, `agent-sdk`, `company-knowledge`, `design-system`, and `graphrag-indexer` are isolated leaves (0/0). Either they are independently published artifacts (intentional) or they're under-integrated. Worth confirming intent.
- `dashboard`, `slack-app`, `a2a-gateway`, `voice-gateway`, `worker`, `smoketest` are all sinks (fan-in 0) — they are application entry points, which is correct.

---

## 9.2 Cyclic package dependencies

**Method.** DFS over the `@glyphor/*` import graph from §9.1, detecting back-edges to in-stack nodes. Cycles deduplicated by canonical node-set + length.

**Result: ✅ No cyclic package dependencies detected.**

The graph is a DAG with `shared` at the bottom and application entry points (`worker`, `dashboard`, `voice-gateway`, `slack-app`, `a2a-gateway`, `smoketest`) at the top. Confirmed independently with the heuristic script (`scratch/s9-coupling.js`).

> Caveat: this only covers cross-package `@glyphor/*` imports. Intra-package module cycles within a single `src/` tree were *not* analyzed in this section (deferred — would require `madge` against compiled output or per-file dependency graph).

---

## 9.3 Top files by approximate cyclomatic complexity

**Method.** For each source file, count occurrences of branch tokens
`\b(if|else|for|while|case|catch)\b` and `&&`, `||`, `?`. This is a
**raw branch-keyword count** — a coarse proxy for cyclomatic complexity (it
double-counts `||` in default-value expressions and counts `?` in optional
chaining/ternary alike). LOC = total newlines. Density = branches / LOC.
External vendored content (`.venv`, `node_modules`) excluded.

### 9.3a — Top 10 by raw branch-keyword count (the "biggest hot spots")

| File | LOC | Branches | Density |
|---|---|---|---|
| `packages/scheduler/src/server.ts` | 7123 | 2249 | 0.316 |
| `packages/agent-runtime/src/companyAgentRunner.ts` | 4517 | 1377 | 0.305 |
| `packages/scheduler/src/reportExporter.ts` | 3696 | 876 | 0.237 |
| `packages/agents/src/shared/webBuildTools.ts` | 3255 | 839 | 0.258 |
| `packages/dashboard/src/components/governance/CzProtocol.tsx` | 3281 | 753 | 0.230 |
| `packages/integrations/src/sharepoint/index.ts` | 2014 | 637 | 0.316 |
| `packages/scheduler/src/dashboardApi.ts` | 2218 | 614 | 0.277 |
| `packages/scheduler/src/strategyLabEngine.ts` | 2847 | 609 | 0.214 |
| `packages/agent-runtime/src/baseAgentRunner.ts` | 2186 | 584 | 0.267 |
| `packages/dashboard/src/pages/Chat.tsx` | 1828 | 581 | 0.318 |

### 9.3b — Top 10 by branch density (LOC ≥ 50, finds *concentrated* logic)

| File | LOC | Branches | Density |
|---|---|---|---|
| `packages/dashboard/src/lib/nexusRunSummary.ts` | 153 | 98 | 0.641 |
| `packages/integrations/src/gcp/cloudBuild.ts` | 170 | 96 | 0.565 |
| `packages/agents/src/shared/resolveVpDesignWorkerMessage.ts` | 128 | 69 | 0.539 |
| `packages/agent-runtime/src/providers/bedrockDeepseek.ts` | 224 | 118 | 0.527 |
| `packages/agent-runtime/src/providers/bedrockAnthropic.ts` | 247 | 128 | 0.518 |
| `packages/agents/src/shared/externalA2aTools.ts` | 99 | 48 | 0.485 |
| `packages/dashboard/src/pages/Governance.tsx` | 1091 | 505 | 0.463 |
| `packages/scheduler/src/capacityAdminApi.ts` | 168 | 77 | 0.458 |
| `packages/integrations/src/audit.ts` | 134 | 60 | 0.448 |
| `packages/scheduler/src/departmentAdminApi.ts` | 157 | 70 | 0.446 |

### Observations

- `packages/scheduler/src/server.ts` is the single biggest complexity sink in the codebase: 7.1k LOC and 2.2k branch tokens.
- `packages/agent-runtime/src/companyAgentRunner.ts` (4.5k LOC, 1.4k branches) is second, and contains the longest function (see §9.4).
- Three Bedrock/AI provider files (`bedrockDeepseek`, `bedrockAnthropic`) and `nexusRunSummary` show very high density (>0.5) — likely tight conditional decoding/parsing logic; good candidates for table-driven refactors.

---

## 9.4 Top 10 longest functions

**Method.** Regex over each source file matches function-like signatures
(`function NAME(...) {`, `const NAME = (...) => {`, `async NAME(...) {`,
methods `NAME(...) {`), then performs a brace-counting walk that respects
string and comment scopes to find the matching `}`. Records `startLine` /
`endLine` from offsets. Functions < 20 lines excluded. Note: `describe(...)`
test blocks are picked up because they syntactically match the same shape;
they are reported as-is (the size signal is real).

| File:Lines | Function | LOC |
|---|---|---|
| `packages/agent-runtime/src/companyAgentRunner.ts:2236-3866` | `saveStructuredCheckpoint` | 1631 |
| `packages/agent-runtime/src/toolExecutor.ts:881-2038` | `execute` | 1158 |
| `packages/agent-runtime/src/__tests__/toolExecutor.test.ts:72-605` | `describe` (test suite) | 534 |
| `packages/dashboard/src/pages/Chat.tsx:885-1309` | `sendMessage` | 425 |
| `packages/dashboard/src/pages/Chat.tsx:931-1295` | `invokeAgent` | 365 |
| `packages/agent-runtime/src/__tests__/errorRetry.test.ts:323-634` | `describe` (test suite) | 312 |
| `packages/agent-runtime/src/__tests__/jitContextRetriever.test.ts:30-304` | `describe` (test suite) | 275 |
| `packages/agents/src/shared/webBuildTools.test.ts:37-307` | `describe` (test suite) | 271 |
| `packages/agent-runtime/src/modelClient.ts:91-334` | `generate` | 244 |
| `packages/agent-runtime/src/__tests__/reasoningEngine.test.ts:51-293` | `describe` (test suite) | 243 |

### Observations

- **`saveStructuredCheckpoint` at 1631 LOC is an extreme outlier** — larger than most entire files in the repo. It alone accounts for ~36% of `companyAgentRunner.ts`.
- **`toolExecutor.execute` (1158 LOC)** and **`modelClient.generate` (244 LOC)** are the two other major monoliths in the runtime hot path.
- `Chat.tsx` has two overlapping mega-functions (`sendMessage` 425 LOC, `invokeAgent` 365 LOC, with `invokeAgent` nested inside `sendMessage`).
- The four `describe()` test suites are not refactor targets per se, but the size correlates with implementation complexity (e.g., `toolExecutor.test.ts` 534-line suite ↔ `toolExecutor.execute` 1158-LOC method).

---

## 9.5 God tables

**Method (column count).** For every `.sql` file under `db/`, regex-match
`CREATE TABLE [IF NOT EXISTS] <name> ( … )` and count comma-separated
column definitions at top-level paren depth 0, filtering out
`PRIMARY KEY`, `FOREIGN KEY`, `UNIQUE`, `CHECK`, `CONSTRAINT`, `EXCLUDE`,
`LIKE` clause-only entries. Then add 1 for every
`ALTER TABLE <t> ADD [COLUMN [IF NOT EXISTS]] <name>`. Same table redefined
in multiple migrations is summed (this slightly over-counts when later
migrations re-`CREATE TABLE` an existing table; flagged as best-effort).

**Method (writer count).** Across all TS/JS under `packages/`, `services/`,
`workers/`, `scripts/`: count distinct files that contain any of
`INSERT INTO <t>`, `UPDATE <t> SET`, or
`.from('<t>').(insert|upsert|update)` (the Supabase pattern).

### 9.5a — Tables with > 20 columns (top 41)

| Table | Columns | First defined in |
|---|---|---|
| `company_agents` | 57 | `db/migrations/20260222025612_new-migration.sql` |
| `task_run_outcomes` | 54 | `db/migrations/20260307120000_task_run_outcomes.sql` |
| `agent_runs` | 39 | `db/migrations/20260225100000_agent_identity.sql` |
| `kg_edges` | 35 | `db/migrations/20260227100005_knowledge_graph.sql` |
| `agent_world_model` | 35 | `db/migrations/20260227100034_world_model_architecture.sql` |
| `workflows` | 35 | `db/migrations/20260307130000_workflow_steps.sql` |
| `strategy_analyses` | 33 | `db/migrations/20260227100027_strategy_lab_v2.sql` |
| `workflow_steps` | 32 | `db/migrations/20260307130000_workflow_steps.sql` |
| `run_sessions` | 31 | `db/migrations/20260406223500_runtime_spine_sessions_attempts_events.sql` |
| `run_events` | 31 | `db/migrations/20260406223500_runtime_spine_sessions_attempts_events.sql` |
| `sharepoint_sites` | 30 | `db/migrations/20260227100042_sharepoint_site_config.sql` |
| `tool_registry` | 30 | `db/migrations/20260228700001_tool_registry.sql` |
| `dashboard_change_requests` | 28 | `db/migrations/20260228500000_dashboard_change_requests.sql` |
| `run_attempts` | 28 | `db/migrations/20260406223500_runtime_spine_sessions_attempts_events.sql` |
| `seo_data` | 27 | `db/migrations/20260223100000_agent_tool_tables.sql` |
| `work_assignments` | 27 | `db/migrations/20260223200000_founder_orchestration.sql` |
| `decisions` | 26 | `db/migrations/20260222025612_new-migration.sql` |
| `support_tickets` | 26 | `db/migrations/20260223100000_agent_tool_tables.sql` |
| `policy_versions` | 26 | `db/migrations/20260307120100_memory_lifecycle.sql` |
| `executive_orchestration_config` | 26 | `db/migrations/20260307130100_sub_directives.sql` |
| `kg_facts` | 26 | `db/migrations/20260330143000_temporal_knowledge_graph.sql` |
| `agent_performance` | 25 | `db/migrations/20260225100000_agent_identity.sql` |
| `kg_nodes` | 25 | `db/migrations/20260227100005_knowledge_graph.sql` |
| `reasoning_passes` | 25 | `db/migrations/20260227200000_reasoning_engine.sql` |
| `memory_lifecycle` | 25 | `db/migrations/20260307120100_memory_lifecycle.sql` |
| `cz_shadow_evals` | 25 | `db/migrations/20260422081600_cz_shadow_eval.sql` |
| `product_proposals` | 24 | `db/migrations/20260222025612_new-migration.sql` |
| `roadmap_items` | 24 | `db/migrations/20260303150000_product_research_tools.sql` |
| `tool_requests` | 23 | `db/migrations/20260228700001_tool_registry.sql` |
| `agent_handoff_contracts` | 23 | `db/migrations/20260330124500_agent_handoff_contracts.sql` |
| `decision_traces` | 23 | `db/migrations/20260330150000_kg_contradictions_and_fact_provenance.sql` |
| `activity_log` | 22 | `db/migrations/20260222025612_new-migration.sql` |
| `customer_health` | 22 | `db/migrations/20260222025612_new-migration.sql` |
| `content_drafts` | 22 | `db/migrations/20260223100000_agent_tool_tables.sql` |
| `design_reviews` | 22 | `db/migrations/20260227100043_design_tables.sql` |
| `agent_reasoning_config` | 22 | `db/migrations/20260227200000_reasoning_engine.sql` |
| `agent_trust_scores` | 22 | `db/migrations/20260228700004_agent_trust_scores.sql` |
| `plan_verifications` | 22 | `db/migrations/20260307120300_plan_verifications.sql` |
| `company_pulse` | 21 | `db/migrations/20260227000000_collective_intelligence.sql` |
| `contracts` | 21 | `db/migrations/20260303160000_governance_tools.sql` |
| `tool_call_traces` | 21 | `db/migrations/20260319001100_tool_call_traces.sql` |

### 9.5b — Tables with > 10 distinct writer files

| Table | # writer files |
|---|---|
| `activity_log` | 45 |
| `company_agents` | 22 |
| `agent_messages` | 16 |
| `work_assignments` | 16 |
| `agent_prompt_versions` | 11 |

### 9.5c — Top 15 tables by writer count (informational)

| Table | # writer files |
|---|---|
| `activity_log` | 45 |
| `company_agents` | 22 |
| `agent_messages` | 16 |
| `work_assignments` | 16 |
| `agent_prompt_versions` | 11 |
| `founder_directives` | 10 |
| `agent_tool_grants` | 10 |
| `agent_schedules` | 10 |
| `agent_wake_queue` | 9 |
| `agent_activities` | 9 |
| `agent_profiles` | 9 |
| `fleet_findings` | 8 |
| `agent_briefs` | 8 |
| `financials` | 8 |
| `decisions` | 7 |

### Observations

- **Both axes converge on the same offenders:** `company_agents` (57 cols / 22 writers), `activity_log` (22 cols / 45 writers), `work_assignments` (27 cols / 16 writers), `decisions` (26 cols / 7 writers).
- `activity_log` has by far the most writer files (45). Despite being only 22 columns wide, it's an event-sink that ~6% of the repo's TS files touch directly. Strong candidate to be replaced by a typed event-emitter API rather than direct INSERT-statement scatter.
- `company_agents` (57 columns) is the single widest table in the schema and is written from 22 places. This is a classic "godfather" entity table — refactoring it requires a per-aspect split (identity / config / status / capabilities / metrics).
- `task_run_outcomes` (54 cols) and `agent_runs` (39 cols) bracket the runtime telemetry surface — also strong candidates for vertical split (hot fields vs. cold metadata).
- The cluster of 30-35 col tables (`kg_edges`, `kg_facts`, `kg_nodes`, `agent_world_model`, `workflows`/`workflow_steps`, `run_sessions`/`run_attempts`/`run_events`, `tool_registry`, `sharepoint_sites`) reflects ambitious feature surfaces created in single migrations — none individually alarming, but collectively they suggest the schema favours wide tables over normalized child tables.

---

## Reproducibility

The two analysis scripts are committed under `scratch/`:

- `scratch/s9-coupling.js` — fan-in/out, cycles, complexity, longest functions
- `scratch/s9-tables.js` — schema column counts, writer counts

Run with `node scratch/s9-coupling.js && node scratch/s9-tables.js` from
the repo root. Outputs land in `scratch/s9-coupling-out.md` and
`scratch/s9-tables-out.md` respectively. No external `npm install` or
network calls required (heuristics only — `madge` was *not* installed,
per the time-boxed instructions).

## Recommended follow-ups (deferred to remediation phase)

1. Break `companyAgentRunner.ts` (4.5k LOC) and `toolExecutor.ts` (2k LOC) — `saveStructuredCheckpoint` (1631 LOC) and `execute` (1158 LOC) should each be decomposed into a state machine.
2. Split `scheduler/src/server.ts` (7.1k LOC) along its route groups — it already has sibling files like `dashboardApi.ts`, `capacityAdminApi.ts`, `departmentAdminApi.ts`; the rest should follow.
3. Vertically split `company_agents` (57 cols) and `task_run_outcomes` (54 cols).
4. Wrap `activity_log` writes in a single typed helper to remove the 45-file scatter.
5. Run intra-package cycle detection (`madge --circular packages/<pkg>/src` per package) — not done in this section.

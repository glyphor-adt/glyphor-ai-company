# Glyphor Monorepo -- Diagnostic Audit

**Audit date:** 2026-04-27

**Repo root:** `C:\Users\KristinaDenney\source\repos\glyphor-ai-company`

**Source:** `docs/ARCHITECTURE.md` (1,628 lines; "Last updated: 2026-04-27") plus filesystem snapshot at audit time. Each section was produced by a sub-agent against the live tree; this document consolidates them. Every concrete claim cites `path:line`.

---

## Executive Summary

This report consolidates an eleven-section diagnostic of the Glyphor monorepo
(snapshot 2026-04-27). It is a synthesis only; every concrete claim is sourced
from one of the embedded section files and ultimately from a `path:line` cite.

The repository is structurally sound â€” a 25-package workspace with no cyclic
package dependencies, a kernel (`shared`) at fan-in 11, and an `agent-runtime`
runtime at fan-in 7 â€” but it is operating with a substantial gap between what
the architecture document describes and what the runtime actually does. The
nine quantitative claims in `docs/ARCHITECTURE.md Â§3` (counts of packages,
agents, dashboard pages, migrations, Dockerfiles, smoketest layers, TABLE_MAP
entries) all verify, yet the surface around them drifts: `/policy/collect`,
`/policy/evaluate`, and `/policy/canary-check` are documented but absent from
the scheduler; the layer numbering tables in Â§6.7 and Â§6.9 contradict each
other; the cz-protocol internal route is wired but undocumented.

Model routing is degenerate. `TIER_MODELS.{economy,standard,pro}`,
`EXEC_CHAT_MODEL`, and `DEFAULT_AGENT_MODEL` all resolve to the literal string
`'model-router'`, and `optimizeModel` â€” the function the doc treats as the
router â€” has zero production callers. A second, parallel routing surface
(`MODEL_CONFIG.tiers`) is what the runtime actually uses, and `isDisabled()`
is enforced at config-validation time only, not at the request hot-path.
GraphRAG production logs contain 60+ live calls to disabled `gemini-2.5-flash`
and leak two Google AI API keys into a tracked log file. Six call sites in
`packages/agents/src/**` instantiate provider SDKs directly, bypassing the
gate stack and the cross-provider fallback chain.

The gate stack itself is the inverse problem: ~31 gates fire in
`ToolExecutor.execute`, far more than the 8 the doc names. Most are
non-LLM and sub-millisecond. The constitutional pre-check, however,
fail-opens silently when its governor is missing or throws â€” the highest-stakes
tools (`create_or_update_file`, `apply_patch_call`, `grant_tool_access`, â€¦)
proceed on a logged warning. `ENABLE_TOOL_RESULT_CACHE` and
`AGENT_TRACING_ENABLED` are unset in every deploy config.

Quality observability is largely absent. Only 4 of 29 agent roles
(cmo/cto/cfo/chief-of-staff) have a wired, judge-scored task-quality eval;
23 of 47 seeded scenarios skip every cron tick; `assignment_evaluations` has
six conditional writers and the codebase's own verifier script literally
prints "(empty â€” expected before evaluators run)". Tier-3 behavioural tool
tests cover 5 tools out of ~150. Sixteen agent folders (~7,000 LOC) are
orphans, and four roster-listed roles (`clo`, `devops-engineer`,
`platform-engineer`, `quality-engineer`) silently return
`blockedRuntimeResult` on every scheduled wake. Two functions â€”
`saveStructuredCheckpoint` (1631 LOC) and `toolExecutor.execute` (1158 LOC) â€”
own the runtime hot path and concentrate change-risk for every fix above.

---

## Section 01 -- Inventory & Verification

All nine quantitative claims in `docs/ARCHITECTURE.md` Section 3/Section 10.3 verify exactly, with only one minor delta (`packages/integrations/src/` is 23 directories, not 22). The largest source files cluster in `packages/scheduler/src/server.ts` (6,507 LOC), `packages/agent-runtime/src/companyAgentRunner.ts` (4,172), `baseAgentRunner.ts`, and `toolExecutor.ts`. Most-imported hubs are dashboard utilities (`lib/firebase.ts`, `components/ui.tsx`, `lib/types.ts`); highest fan-out is `packages/agent-runtime/src/index.ts` (178 outbound) -- a re-export barrel.

See: [section-01-inventory.md](diagnostic-2026-04-27/section-01-inventory.md)


Audit date: 2026-04-27
Architecture doc verified: `docs/ARCHITECTURE.md` (note: doc lives under `docs/`, not at repo root as instructed; no `ARCHITECTURE.md` exists at root â€” verified via `Get-ChildItem -Recurse -Filter ARCHITECTURE.md`).

Methodology:
- Counts via `Get-ChildItem` over the filesystem.
- Doc claims pulled from quoted lines in `docs/ARCHITECTURE.md` (citations include `path:line`).
- Import analysis via a Node.js script (`_imp.js`, deleted after use) that walks `packages/`, `services/`, `workers/`, `scripts/`, parses `import ... from '...'`, `import '...'`, `export ... from '...'`, and `require('...')` for **relative specifiers only**, and resolves them with TS/JS extensions and `index.*` fallbacks. Cross-package imports via package names (e.g. `@glyphor/...` or workspace package names) are **not** counted â€” see caveat in Â§3/Â§4.
- LOC = newline count (`Measure-Object -Line`), excluding `node_modules`, `dist`, `.turbo`, `.venv`, `build`, `out`.

---

### 1. Doc-claimed vs filesystem-verified counts

| Metric | Doc claim (citation) | Verified | Î” | Î”% | Flag (>5%) |
|---|---|---|---|---|---|
| Workspace packages under `packages/` | 25 (`docs/ARCHITECTURE.md:24`) | 25 | 0 | 0% | â€” |
| Integration modules under `packages/integrations/src/` | 22 (`docs/ARCHITECTURE.md:25`) | 23 | +1 | +4.5% | â€” (under 5%) |
| File-based agent role dirs under `packages/agents/src/` | 28 (`docs/ARCHITECTURE.md:26`) | 28* | 0 | 0% | â€” |
| Dashboard page modules under `packages/dashboard/src/pages/` | 36 (`docs/ARCHITECTURE.md:27`) | 36 | 0 | 0% | â€” |
| SQL migrations under `db/migrations/` | 326 (`docs/ARCHITECTURE.md:28`) | 326 | 0 | 0% | â€” |
| Dockerfiles under `docker/` (`Dockerfile.*`) | 17 (`docs/ARCHITECTURE.md:29`) | 17 | 0 | 0% | â€” |
| Smoketest layers under `packages/smoketest/src/layers/` | 31 (layer 0â€“30) (`docs/ARCHITECTURE.md:30`) | 31 (`layer00-â€¦layer30-`) | 0 | 0% | â€” |
| `TABLE_MAP` aliases in `packages/scheduler/src/dashboardApi.ts` | 88 (`docs/ARCHITECTURE.md:32`, `:1138`) | 88 | 0 | 0% | â€” |
| Distinct physical tables in `TABLE_MAP` | 60 (`docs/ARCHITECTURE.md:32`, `:1276`) | 60 | 0 | 0% | â€” |

\* `packages/agents/src/` contains **29 directories** total, but one is `shared/` (utility code, not a role). 29 âˆ’ 1 = 28 role dirs, matching the doc. See `packages/agents/src/shared/` (referenced as a shared module at `docs/ARCHITECTURE.md:1353`, `:1373`).

#### 1a. Integrations delta detail (doc 22 â†’ fs 23)

The 23 directories under `packages/integrations/src/`:
`agent365, anthropic, aws, azure, canva, cloudflare, credentials, docusign, facebook, gcp, github, governance, kling, linkedin, mercury, openai, posthog, search-console, sendgrid, sharepoint, stripe, teams, vercel`.

The doc enumerates "22" without a full list, so identifying which one is the un-counted addition requires comparison with prior inventories â€” flagged as **uncertain** root cause. Likely candidates (younger directories): `governance/`, `credentials/`, or `agent365/`.

#### 1b. TABLE_MAP source location

- Block defined at `packages/scheduler/src/dashboardApi.ts:170` (`const TABLE_MAP: Record<string, string> = {`) and closes at line 258.
- 88 alias keys, 60 distinct physical tables â€” exact match.

---

### 2. Top 20 largest source files (LOC)

Scope: `*.ts, *.tsx, *.js, *.sql` under `packages/`, `services/`, `workers/`, `scripts/`, `db/`, `docker/`. Excludes `node_modules`, `dist`, `.turbo`, `.venv`, `build`, `out`.

| Rank | LOC | Path |
|---:|---:|---|
| 1 | 6507 | `packages/scheduler/src/server.ts` |
| 2 | 4172 | `packages/agent-runtime/src/companyAgentRunner.ts` |
| 3 | 3661 | `db/migrations/20260315210000_sync_all_skill_playbooks_full.sql` |
| 4 | 3289 | `packages/scheduler/src/reportExporter.ts` |
| 5 | 3132 | `packages/dashboard/src/components/governance/CzProtocol.tsx` |
| 6 | 2937 | `packages/agents/src/shared/webBuildTools.ts` |
| 7 | 2793 | `packages/agents/src/chief-of-staff/tools.ts` |
| 8 | 2661 | `packages/dashboard/src/pages/Strategy.tsx` |
| 9 | 2447 | `packages/scheduler/src/strategyLabEngine.ts` |
| 10 | 2406 | `packages/dashboard/src/pages/AgentProfile.tsx` |
| 11 | 2310 | `packages/dashboard/src/pages/Operations.tsx` |
| 12 | 2187 | `packages/agents/src/cto/tools.ts` |
| 13 | 2086 | `packages/scheduler/src/czProtocolApi.ts` |
| 14 | 2060 | `packages/agent-runtime/src/baseAgentRunner.ts` |
| 15 | 2047 | `packages/scheduler/src/dashboardApi.ts` |
| 16 | 2024 | `packages/agent-runtime/src/toolExecutor.ts` |
| 17 | 1796 | `packages/integrations/src/sharepoint/index.ts` |
| 18 | 1705 | `packages/dashboard/src/pages/Chat.tsx` |
| 19 | 1607 | `packages/agents/src/platform-intel/tools.ts` |
| 20 | 1582 | `packages/agents/src/global-admin/tools.ts` |

Concentration: scheduler (6 files), agent-runtime (4), agents (5), dashboard (5), integrations (1), db (1).

---

### 3. Top 20 most-imported files (inbound from internal repo code)

Caveat: counts only **relative imports** (`./`, `../`). Cross-package imports via workspace package names are not counted, so cross-package "hot" modules (e.g. `packages/shared/src/index.ts`, `packages/agent-runtime/src/index.ts`) are under-represented â€” this view favors single-package "barrel" or hub modules. See Â§1 methodology.

| Rank | Inbound | Path |
|---:|---:|---|
| 1 | 49 | `packages/dashboard/src/lib/firebase.ts` |
| 2 | 47 | `packages/dashboard/src/components/ui.tsx` |
| 3 | 29 | `packages/dashboard/src/lib/types.ts` |
| 4 | 16 | `packages/dashboard/src/lib/auth.tsx` |
| 5 | 9 | `packages/dashboard/src/components/governance/shared.tsx` |
| 6 | 9 | `packages/dashboard/src/components/ui/glowing-textarea-frame.tsx` |
| 7 | 8 | `packages/dashboard/src/lib/hooks.ts` |
| 8 | 8 | `packages/dashboard/src/lib/liveRoster.ts` |
| 9 | 7 | `packages/dashboard/src/components/ChatMarkdown.tsx` |
| 10 | 6 | `packages/dashboard/src/lib/utils.ts` |
| 11 | 6 | `packages/dashboard/src/components/eval/EvalFleetGrid.tsx` |
| 12 | 5 | `packages/dashboard/src/lib/models.ts` |
| 13 | 5 | `packages/dashboard/src/lib/smb.ts` |
| 14 | 4 | `packages/dashboard/src/lib/normalizeText.ts` |
| 15 | 4 | `packages/dashboard/src/lib/formatDashboardContent.ts` |
| 16 | 4 | `packages/dashboard/src/components/ChatComposer.tsx` |
| 17 | 3 | `packages/dashboard/src/lib/theme.tsx` |
| 18 | 2 | `packages/dashboard/src/pages/Chat.tsx` |
| 19 | 2 | `packages/dashboard/src/pages/Skills.tsx` |
| 20 | 2 | `packages/dashboard/src/pages/Settings.tsx` |

Observation: The list is dashboard-dominated because dashboard uses heavy intra-package relative imports. `lib/firebase.ts`, `components/ui.tsx`, and `lib/types.ts` are clear hub/god-targets â€” any change to them has wide blast radius.

---

### 4. Top 20 files with most outbound imports (god-file candidates)

Same caveat: only relative imports counted.

| Rank | Outbound | Path |
|---:|---:|---|
| 1 | 178 | `packages/agent-runtime/src/index.ts` |
| 2 | 58 | `packages/scheduler/src/server.ts` |
| 3 | 46 | `packages/agent-runtime/src/companyAgentRunner.ts` |
| 4 | 40 | `packages/integrations/src/index.ts` |
| 5 | 39 | `packages/agent-runtime/src/baseAgentRunner.ts` |
| 6 | 33 | `packages/shared/src/index.ts` |
| 7 | 33 | `packages/smoketest/src/main.ts` |
| 8 | 31 | `packages/agents/src/vp-design/run.ts` |
| 9 | 30 | `packages/dashboard/src/App.tsx` |
| 10 | 29 | `packages/agent-runtime/src/toolExecutor.ts` |
| 11 | 24 | `packages/agents/src/frontend-engineer/run.ts` |
| 12 | 23 | `packages/agents/src/cmo/run.ts` |
| 13 | 23 | `packages/agents/src/index.ts` |
| 14 | 22 | `packages/agents/src/cto/run.ts` |
| 15 | 21 | `packages/agents/src/ui-ux-designer/run.ts` |
| 16 | 19 | `packages/agents/src/cpo/run.ts` |
| 17 | 19 | `packages/scheduler/src/index.ts` |
| 18 | 18 | `packages/agents/src/template-architect/run.ts` |
| 19 | 17 | `packages/agents/src/cfo/run.ts` |
| 20 | 16 | `packages/agents/src/chief-of-staff/run.ts` |

Observations:
- `packages/agent-runtime/src/index.ts` (178 outbound) is a classic barrel/re-export hub and dominates by an order of magnitude.
- `packages/scheduler/src/server.ts` (58 outbound, also 6,507 LOC, #1 by size) is a confirmed god-file: large + highly fan-out.
- `packages/agent-runtime/src/companyAgentRunner.ts` and `baseAgentRunner.ts` and `toolExecutor.ts` all appear in both LOC top-20 and outbound top-20 â€” strongest god-file candidates inside the runtime.

---

### 5. Findings summary

- All 9 quantitative claims from `docs/ARCHITECTURE.md` Â§3 / Â§10.3 are accurate. Only one minor delta: integration modules **22 â†’ 23** (+4.5%, under 5% threshold but still a doc-drift).
- `TABLE_MAP` (88 aliases / 60 tables) is exactly as documented.
- Identified god-file candidates (LOC + fan-out + hub-imports): `packages/scheduler/src/server.ts`, `packages/agent-runtime/src/companyAgentRunner.ts`, `packages/agent-runtime/src/baseAgentRunner.ts`, `packages/agent-runtime/src/toolExecutor.ts`.
- Identified blast-radius hubs (most-imported): `packages/dashboard/src/lib/firebase.ts`, `packages/dashboard/src/components/ui.tsx`, `packages/dashboard/src/lib/types.ts`.
- Methodology limitation: cross-package imports are not counted in Â§3/Â§4. A follow-up pass that resolves workspace package specifiers would likely surface `packages/shared/src/index.ts`, `packages/agent-runtime/src/index.ts`, and `packages/integrations/src/index.ts` higher in the inbound list.

---

## Section 02 -- Agents -- Inventory, Reachability, Prompts, Tools, Models

Of 28 role directories under `packages/agents/src/`, only 8 roles have an `else if` branch in the `server.ts` `agentExecutor` (`chief-of-staff`, `cto`, `cfo`, `cpo`, `cmo`, `vp-design`, `ops`, `vp-research`). Four active-roster roles (`clo`, `devops-engineer`, `platform-engineer`, `quality-engineer`) pass `isLiveRuntimeRole` but fall through to `blockedRuntimeResult`. Sixteen further roles are orphans or only reachable via the CZ dry-run harness. The `SYSTEM_PROMPTS` map registers only 8 roles; `vp-design` carries a 19,106-char prompt. `ROLE_COST_TIER` and `optimizeModel` collapse every role × task to `model-router`.

See: [section-02-agents.md](diagnostic-2026-04-27/section-02-agents.md)


Audit date: 2026-04-27. Repo root: `C:\Users\KristinaDenney\source\repos\glyphor-ai-company`.
Ground rules: every claim cites `path:line`. Code wins over docs.

### 0. Methodology and corrections to the brief

- Role enumeration: `Get-ChildItem packages\agents\src -Directory` (excluding `shared/`). 28 role
  directories.
- Last commit per role: `git --no-pager log -1 --format=%cI -- packages/agents/src/<role>`.
- Token-length estimate for each system prompt: `chars / 4` from raw `systemPrompt.ts` byte length
  (the file contains a single exported template literal; surrounding TS scaffolding adds ~50â€“100
  chars of overhead, which is left in to keep the method mechanical).
- "Has runner-callable export?" means the role's `run<Role>` function (or `runDynamicAgent`) is
  re-exported from the package barrel `packages\agents\src\index.ts:1-29` so that
  `import { runX } from '@glyphor/agents'` resolves.
- "Inbound refs from runtime" counts non-test, non-self files under `packages/` that contain the
  literal `'<role>'` slug. This over-counts (lookup tables, denylists), so the table notes whether
  the *actual `runX` symbol* is imported anywhere outside its own folder, which is the load-bearing
  signal for reachability.
- Reachability roots required by the brief:
  - `packages\scheduler\src\server.ts` âœ… exists.
  - `packages\scheduler\src\eventRouter.ts` âœ… exists.
  - `packages/agent-runtime/src/createRunner.ts` âŒ **does not exist**. The only `createRunner` in
    the repo lives at `packages\agents\src\shared\createRunner.ts:36`. That is what is used as the
    third reachability root for this audit. (`@glyphor/agent-runtime` only exposes the runner
    *classes* `CompanyAgentRunner | OrchestratorRunner | TaskRunner`; role selection happens in
    the agents package.)
- Authoritative roster source: `packages\shared\src\activeAgentRoster.ts:10-23` lists 12 active
  roles; lines 36-54 list 17 retired; lines 67-77 list 9 scaffolded-but-unbuilt. The runtime gate
  `isCanonicalKeepRole` (`packages\shared\src\canonicalKeepRoster.ts:20-22`) is just a re-export
  of `isActiveAgentRole`, so the 12-role active set is what `server.ts` will actually let through.

### 1. Reachability model (how I assigned `Status`)

`scheduler/src/server.ts` builds a single `agentExecutor` (`server.ts:1129-1338`) that:

1. Rejects any role failing `isLiveRuntimeRole` â†’ `isCanonicalKeepRole` (`server.ts:1077-1079`,
   `1134-1136`) by returning `blockedRuntimeResult` (`server.ts:1081-1087`,
   message: *"Agent X is not on the live runtime roster and cannot run."*).
2. Hard-codes an `if/else if` chain that only dispatches to **8 roles**:
   `chief-of-staff` (`server.ts:1208`), `cto` (1233), `cfo` (1239), `cpo` (1245), `cmo` (1247),
   `vp-design` (1277), `ops` (1294), `vp-research` (1296). Anything else falls into
   `else { return blockedRuntimeResult(agentRole); }` at `server.ts:1335-1337`.

`scheduler/src/eventRouter.ts` is role-agnostic: it takes a generic `executor` callback in its
constructor (`eventRouter.ts:76-82`) and calls `this.executor(event.agentRole, event.task, ...)`
at `eventRouter.ts:137`. So whatever `server.ts` wires in is the actual reachable set.

`agents/src/shared/createRunner.ts:36-53` is also role-agnostic â€” it picks
`CompanyAgentRunner | OrchestratorRunner | TaskRunner` based on `task` and on
`ORCHESTRATOR_ROLES` (defined in `@glyphor/agent-runtime`). It does not know any role names.

Secondary call site: `scheduler/src/czProtocolApi.ts:102-115` defines `STATIC_RUNNERS` mapping 12
runner-callable roles for **dry-run / eval** of the CZ protocol harness only
(every entry passes `dryRun: true, evalMode: true`). This file is imported by `server.ts:87`
(`handleCzApi`), so it counts as "reachable from server.ts" but **never executes a real run** â€”
it is only used by the CZ shadow/judge harness. I record this as `partially-wired` for roles that
have no other live path.

`agents/src/shared/runDynamicAgent.ts:42-159` is the DB-defined fallback runner. It is invoked from
`czProtocolApi.ts:123` only (and from a self-test in worker), so it does not provide real
scheduled execution either â€” it only feeds CZ-eval and dashboard-on-demand harnesses.

#### Status decision rules applied here

- `live` = role passes `isLiveRuntimeRole` AND has a dedicated branch in `server.ts` agentExecutor
  AND has a runner-callable export from `@glyphor/agents`.
- `partially-wired` = on the active roster but no `agentExecutor` branch (so scheduled wakes
  return `blockedRuntimeResult`); OR has only a dry-run/eval runner via `czProtocolApi.STATIC_RUNNERS`;
  OR runtime path exists but prompt/tools wiring is incomplete.
- `test-only` = only referenced under `**/*.test.*` or `**/__tests__/**`. (No role qualified;
  every role has at least one non-test reference, even if only in retirement lists.)
- `orphan` = no path from any of the three reachability roots reaches the role's `run<Role>`
  symbol. Note: appearing in `RETIRED_AGENT_ROLES` arrays etc. is *not* a code path â€” it is a deny
  list.

### 2. Per-role inventory table

| Role | Files | LOC | Has prompt file? | Has runner-callable export? | Last commit (cI) | Inbound runtime refs | Inbound test refs | Status |
|---|---:|---:|:---:|:---:|---|---:|---:|---|
| cfo | 3 | 502 | yes (`cfo/systemPrompt.ts`) | yes (`runCFO` â€” `agents/src/index.ts:4`) | 2026-04-22 | 55 | 16 | live |
| chief-of-staff | 6 | 4031 | yes (`chief-of-staff/systemPrompt.ts`) | yes (`runChiefOfStaff` â€” `agents/src/index.ts:2`) | 2026-04-23 | 131 | 9 | live |
| clo | 2 | 169 | yes (`clo/systemPrompt.ts`) | yes (`runCLO` â€” `agents/src/index.ts:20`) | 2026-04-23 | 26 | 1 | partially-wired |
| cmo | 3 | 590 | yes (`cmo/systemPrompt.ts`) | yes (`runCMO` â€” `agents/src/index.ts:6`) | 2026-04-22 | 68 | 14 | live |
| competitive-intel | 3 | 257 | yes (`competitive-intel/systemPrompt.ts`) | no (not exported from barrel) | 2026-04-11 | 32 | 0 | orphan |
| competitive-research-analyst | 3 | 126 | yes (`competitive-research-analyst/systemPrompt.ts`) | no | 2026-04-11 | 30 | 0 | orphan |
| content-creator | 3 | 253 | yes (`content-creator/systemPrompt.ts`) | yes (`runContentCreator` â€” `agents/src/index.ts:22`) | 2026-04-22 | 37 | 13 | partially-wired |
| cpo | 3 | 383 | yes (`cpo/systemPrompt.ts`) | yes (`runCPO` â€” `agents/src/index.ts:5`) | 2026-04-23 | 51 | 0 | live |
| cto | 3 | 2474 | yes (`cto/systemPrompt.ts`) | yes (`runCTO` â€” `agents/src/index.ts:3`) | 2026-04-22 | 67 | 64 | live |
| design-critic | 3 | 218 | yes (`design-critic/systemPrompt.ts`) | no | 2026-04-11 | 16 | 0 | orphan |
| devops-engineer | 3 | 635 | yes (`devops-engineer/systemPrompt.ts`) | no | 2026-04-11 | 26 | 22 | partially-wired |
| frontend-engineer | 3 | 339 | yes (`frontend-engineer/systemPrompt.ts`) | no | 2026-04-11 | 22 | 11 | orphan |
| global-admin | 3 | 1715 | yes (`global-admin/systemPrompt.ts`) | no | 2026-04-11 | 25 | 0 | orphan |
| head-of-hr | 3 | 936 | yes (`head-of-hr/systemPrompt.ts`) | no | 2026-04-11 | 17 | 0 | orphan |
| m365-admin | 3 | 1151 | yes (`m365-admin/systemPrompt.ts`) | no | 2026-04-11 | 17 | 0 | orphan |
| market-research-analyst | 3 | 128 | yes (`market-research-analyst/systemPrompt.ts`) | no | 2026-04-11 | 34 | 2 | orphan |
| ops | 3 | 1046 | yes (`ops/systemPrompt.ts`) | yes (`runOps` â€” `agents/src/index.ts:14`) | 2026-04-23 | 67 | 29 | live |
| platform-engineer | 3 | 401 | yes (`platform-engineer/systemPrompt.ts`) | no | 2026-04-11 | 25 | 2 | partially-wired |
| platform-intel | 5 | 2097 | yes (`platform-intel/systemPrompt.ts`) | no | 2026-04-17 | 19 | 4 | orphan |
| quality-engineer | 3 | 429 | yes (`quality-engineer/systemPrompt.ts`) | no | 2026-04-11 | 24 | 0 | partially-wired |
| seo-analyst | 3 | 197 | yes (`seo-analyst/systemPrompt.ts`) | yes (`runSeoAnalyst` â€” `agents/src/index.ts:23`) | 2026-04-22 | 34 | 0 | partially-wired |
| social-media-manager | 3 | 273 | yes (`social-media-manager/systemPrompt.ts`) | no | 2026-04-11 | 33 | 3 | orphan |
| template-architect | 3 | 196 | yes (`template-architect/systemPrompt.ts`) | no | 2026-04-11 | 17 | 0 | orphan |
| ui-ux-designer | 3 | 205 | yes (`ui-ux-designer/systemPrompt.ts`) | no | 2026-04-11 | 17 | 0 | orphan |
| user-researcher | 3 | 208 | yes (`user-researcher/systemPrompt.ts`) | no | 2026-04-11 | 30 | 0 | orphan |
| vp-design | 3 | 841 | yes (`vp-design/systemPrompt.ts`) | yes (`runVPDesign` â€” `agents/src/index.ts:7`) | 2026-04-23 | 54 | 1 | live |
| vp-research | 3 | 223 | yes (`vp-research/systemPrompt.ts`) | yes (`runVPResearch` â€” `agents/src/index.ts:17`) | 2026-04-23 | 49 | 2 | live |
| vp-sales | 3 | 376 | yes (`vp-sales/systemPrompt.ts`) | yes (`runVPSales` â€” `agents/src/index.ts:21`) | 2026-04-23 | 45 | 0 | partially-wired |

LOC = `Get-Content â€¦ | Measure-Object -Line` over `*.ts` only (excludes blank-stripping; includes
imports/types/comments). Inbound counts use ripgrep over non-test files matched against the literal
`'<role>'` slug â€” they include *all* string mentions (config maps, denylists, schedule arrays),
not just runner imports. The runner-callable column is the load-bearing one.

#### Status notes

- **clo**: in active roster (`activeAgentRoster.ts:14`), exported from the barrel
  (`agents/src/index.ts:20`), and present in `STATIC_RUNNERS` (`czProtocolApi.ts:111`), but no
  `else if (agentRole === 'clo')` branch in `server.ts` agentExecutor. A scheduled wake for clo
  passes `isLiveRuntimeRole` and falls through to `blockedRuntimeResult` at `server.ts:1335-1337`.
  Real execution only happens through the CZ-eval harness.
- **devops-engineer / platform-engineer / quality-engineer**: in active roster
  (`activeAgentRoster.ts:20-22`), have full `run.ts` + `systemPrompt.ts` + `tools.ts`, but no
  barrel export and no `agentExecutor` branch. Their `run<Role>` symbols are imported nowhere
  outside their own folder (verified: ripgrep for `runDevopsEngineer|runPlatformEngineer|runQualityEngineer`
  returns no matches anywhere in `packages/`). Status = partially-wired (scaffolded + on roster
  but no runtime invocation path).
- **content-creator / seo-analyst / vp-sales**: retired in `activeAgentRoster.ts:37,38,47` so
  `isLiveRuntimeRole` rejects them, but they are still exported from the barrel and registered in
  `STATIC_RUNNERS` (`czProtocolApi.ts:112-114`). Reachable from `server.ts` *only* through the CZ
  dry-run harness â€” never via real scheduler events. Status = partially-wired.
- **social-media-manager / user-researcher / competitive-intel / global-admin / m365-admin /
  frontend-engineer / platform-intel**: retired and unexported. Their `run<Role>` symbols are
  imported nowhere outside the role folder. `isLiveRuntimeRole` would reject scheduled wakes, and
  there is no other entry point. Status = orphan.
- **competitive-research-analyst / design-critic / head-of-hr / market-research-analyst /
  template-architect / ui-ux-designer**: scaffolded-but-unbuilt
  (`activeAgentRoster.ts:67-77`). Same analysis â€” no barrel export, no STATIC_RUNNERS entry, no
  imports of their `run<Role>` symbols. Status = orphan.

### 3. System prompts â€” sizes and locations

Token estimate = `chars / 4` over `Get-Content systemPrompt.ts -Raw` (single template literal per
file plus a tiny export wrapper).

| Role | Path | chars | â‰ˆ tokens |
|---|---|---:|---:|
| cfo | `packages/agents/src/cfo/systemPrompt.ts` | 4,428 | 1,107 |
| chief-of-staff | `packages/agents/src/chief-of-staff/systemPrompt.ts` | 9,031 | 2,258 |
| clo | `packages/agents/src/clo/systemPrompt.ts` | 2,469 | 617 |
| cmo | `packages/agents/src/cmo/systemPrompt.ts` | 8,616 | 2,154 |
| competitive-intel | `packages/agents/src/competitive-intel/systemPrompt.ts` | 1,202 | 301 |
| competitive-research-analyst | `packages/agents/src/competitive-research-analyst/systemPrompt.ts` | 2,032 | 508 |
| content-creator | `packages/agents/src/content-creator/systemPrompt.ts` | 3,324 | 831 |
| cpo | `packages/agents/src/cpo/systemPrompt.ts` | 3,462 | 866 |
| cto | `packages/agents/src/cto/systemPrompt.ts` | 6,029 | 1,507 |
| design-critic | `packages/agents/src/design-critic/systemPrompt.ts` | 1,315 | 329 |
| devops-engineer | `packages/agents/src/devops-engineer/systemPrompt.ts` | 1,775 | 444 |
| frontend-engineer | `packages/agents/src/frontend-engineer/systemPrompt.ts` | 2,209 | 552 |
| global-admin | `packages/agents/src/global-admin/systemPrompt.ts` | 2,497 | 624 |
| head-of-hr | `packages/agents/src/head-of-hr/systemPrompt.ts` | 2,586 | 647 |
| m365-admin | `packages/agents/src/m365-admin/systemPrompt.ts` | 3,370 | 843 |
| market-research-analyst | `packages/agents/src/market-research-analyst/systemPrompt.ts` | 2,088 | 522 |
| ops | `packages/agents/src/ops/systemPrompt.ts` | 2,324 | 581 |
| platform-engineer | `packages/agents/src/platform-engineer/systemPrompt.ts` | 1,265 | 316 |
| platform-intel | `packages/agents/src/platform-intel/systemPrompt.ts` | 8,944 | 2,236 |
| quality-engineer | `packages/agents/src/quality-engineer/systemPrompt.ts` | 2,168 | 542 |
| seo-analyst | `packages/agents/src/seo-analyst/systemPrompt.ts` | 1,230 | 308 |
| social-media-manager | `packages/agents/src/social-media-manager/systemPrompt.ts` | 3,674 | 919 |
| template-architect | `packages/agents/src/template-architect/systemPrompt.ts` | 1,448 | 362 |
| ui-ux-designer | `packages/agents/src/ui-ux-designer/systemPrompt.ts` | 2,608 | 652 |
| user-researcher | `packages/agents/src/user-researcher/systemPrompt.ts` | 1,204 | 301 |
| vp-design | `packages/agents/src/vp-design/systemPrompt.ts` | **19,106** | **4,777** |
| vp-research | `packages/agents/src/vp-research/systemPrompt.ts` | 3,313 | 828 |
| vp-sales | `packages/agents/src/vp-sales/systemPrompt.ts` | 3,146 | 787 |

`SYSTEM_PROMPTS` map at `agents/src/index.ts:41-50` only registers 8 roles
(chief-of-staff, cto, cfo, cpo, cmo, vp-design, ops, vp-research). The other 20 prompts exist on
disk but are not in the keyed registry; they reach the runtime only because each role's `run.ts`
imports its own prompt directly.

### 4. Tools â€” declared vs invoked

The pattern is uniform: `tools.ts` exports a `create<Role>Tools(memory)` factory that returns
`ToolDefinition[]`, each with a `name`, `description`, and `execute` (e.g. `cfo/tools.ts:13-29`).
The role's `run.ts` then composes a tool list from a set of `create*Tools` factory imports
(role-local + many under `agents/src/shared/`). The runtime `ToolExecutor`
(`agent-runtime/src/toolExecutor.ts`) is what actually invokes the tools when the LLM emits a
tool-call â€” there is no separate "I invoke tool X by name" code path inside the role files. So
"declared" = "named in a `ToolDefinition`", "wired" = "factory imported into `run.ts` and pushed
into the tool array passed to the runner". For the orphan roles, both columns are moot since the
runner is never instantiated.

Spot-check: prompts listing tools versus what `run.ts` actually wires.

- **chief-of-staff** prompt enumerates tools `delegate_assignment`, `check_assignment_status`,
  `wake_agent`, `query_world_state`, `record_decision` (`chief-of-staff/systemPrompt.ts`). All
  of these come from `createChiefOfStaffTools` / `createOrchestrationTools` /
  `createCollectiveIntelligenceTools`, which are wired in `chief-of-staff/run.ts` (factories
  `createChiefOfStaffTools, createOrchestrationTools, createCollectiveIntelligenceTools,
  createAgentDirectoryTools, createAgentManagementTools, createAgentCreationTools, createCoreTools,
  createGraphTools, createSharePointTools, createGlyphorMcpTools, createGithubFromTemplateTools,
  createGithubPullRequestTools, createGithubPushFilesTools, createCloudflarePreviewTools,
  createVercelProjectTools, createResearchTools, createToolGrantTools`). No drift detected for the
  named tools.
- **vp-design** prompt is 19,106 chars and enumerates dozens of tool names; the wiring in
  `vp-design/run.ts` includes â‰ˆ30 `create*Tools` factories which collectively register hundreds of
  tools â€” too many to fully cross-check by string, but the high-traffic ones
  (`figma_*`, `web_build_*`, `screenshot_*`, `deploy_preview_*`) are present in both prompt and
  wiring.
- **clo** prompt mentions `docusign_*` and `legal_*` tools; `clo/run.ts` wires
  `createDocuSignTools` and `createLegalDocumentTools`.

Per-role declared tool-def count (count of `name: 'â€¦'` lines in `<role>/tools.ts`) and wired
factory count (count of distinct `create*Tools` symbols imported into `<role>/run.ts`):

| Role | Tool-defs in role-local `tools.ts` | Distinct `create*Tools` factories wired in `run.ts` |
|---|---:|---:|
| cfo | 10 | 12 |
| chief-of-staff | 27 | 17 |
| clo | (clo has no `tools.ts` â€” only `run.ts` + `systemPrompt.ts`) | 10 |
| cmo | 7 | 19 |
| competitive-intel | 9 | 6 |
| competitive-research-analyst | 0 (file present but empty factory) | 7 |
| content-creator | 7 | 7 |
| cpo | 7 | 15 |
| cto | 44 | 18 |
| design-critic | 4 | 11 |
| devops-engineer | 19 | 12 |
| frontend-engineer | 9 | 25 |
| global-admin | 30 | 7 |
| head-of-hr | 12 | 10 |
| m365-admin | 25 | 5 |
| market-research-analyst | 0 | 7 |
| ops | 21 | 8 |
| platform-engineer | 12 | 8 |
| platform-intel | 33 | 4 |
| quality-engineer | 12 | 7 |
| seo-analyst | 7 | 6 |
| social-media-manager | 7 | 6 |
| template-architect | 5 | 13 |
| ui-ux-designer | 4 | 14 |
| user-researcher | 7 | 7 |
| vp-design | 15 | 30 |
| vp-research | 0 | 10 |
| vp-sales | 8 | 10 |

Notable observations:

- `competitive-research-analyst/tools.ts`, `market-research-analyst/tools.ts`, and
  `vp-research/tools.ts` declare **zero** `ToolDefinition` entries (the local tool factory is a
  stub returning `[]`); the role's behaviour is entirely driven by shared-tool factories. For an
  orphan role this is moot; for `vp-research` (live) this means there is no role-specific tool
  layer beyond the shared ones.
- `clo/` has no `tools.ts` file at all (only `run.ts` and `systemPrompt.ts`); it relies entirely
  on shared factories listed in `clo/run.ts` imports.
- `m365-admin/tools.ts` declares 25 tool defs but `m365-admin/run.ts` imports only 5 factories
  (and the 25 are inside `createM365AdminTools` which is *not in the import list* â€” that role is
  orphan). Wiring is incomplete in the role file even before runtime gating kicks in.
- `global-admin/tools.ts` declares 30 tool defs but the role is orphan; the prompt-listed admin
  capabilities are unreachable.

### 5. Models â€” `ROLE_COST_TIER` â†’ `optimizeModel` â†’ `resolveModel`

Source: `packages\shared\src\models.ts:627-704`.

```
TIER_MODELS:    { economy: 'model-router', standard: 'model-router', pro: 'model-router' }   (lines 630-634)
EXEC_CHAT_MODEL: 'model-router'                                                              (line 637)
DEFAULT_AGENT_MODEL: 'model-router'                                                          (line 182)
SUPPORTED_MODELS contains { id: 'model-router', â€¦ }                                          (line 102)
```

`optimizeModel(role, task, dbModel)` (`models.ts:688-704`) logic:

1. If `dbModel` is set â†’ return `resolveModel(dbModel)` (line 694).
2. Else `tier = ROLE_COST_TIER[role] ?? 'standard'` (line 696).
3. If `task === 'on_demand'` and `tier === 'pro'` â†’ return `EXEC_CHAT_MODEL` = `'model-router'`
   (lines 699-701).
4. Else return `TIER_MODELS[tier]` = `'model-router'` (line 703).

`resolveModel('model-router')` (`models.ts:423-438`) finds the id in `SUPPORTED_MODELS` and
returns `'model-router'` unchanged.

**Effective model for every role under the current registry is `model-router` for every task
type** â€” `on_demand`, scheduled (`work_loop`, `morning_briefing`, etc.), and orchestrator tasks
all collapse to the same value because all three tier buckets in `TIER_MODELS` were homogenised
to `'model-router'`. Per-role tier still drives unrelated logic (e.g. founder-chat semantics) but
not model selection.

For completeness, here is the requested role â†’ tier mapping and the resolved model for the three
task types (all rows resolve to `model-router`; the "tier" column matters only if `TIER_MODELS`
diverges in the future):

| Role | `ROLE_COST_TIER[role]` (`models.ts:640-676`) | on_demand | scheduled | orchestrator |
|---|---|---|---|---|
| chief-of-staff | pro (`models.ts:668`) | model-router (EXEC_CHAT_MODEL) | model-router | model-router |
| cto | pro (669) | model-router | model-router | model-router |
| cfo | pro (670) | model-router | model-router | model-router |
| cpo | pro (671) | model-router | model-router | model-router |
| cmo | pro (672) | model-router | model-router | model-router |
| clo | pro (673) | model-router | model-router | model-router |
| vp-research | pro (674) | model-router | model-router | model-router |
| ops | pro (675) | model-router | model-router | model-router |
| vp-design | standard (661) | model-router | model-router | model-router |
| vp-sales | standard (660) | model-router | model-router | model-router |
| head-of-hr | standard (659) | model-router | model-router | model-router |
| frontend-engineer | standard (652) | model-router | model-router | model-router |
| devops-engineer | standard (656) | model-router | model-router | model-router |
| platform-engineer | standard (657) | model-router | model-router | model-router |
| quality-engineer | standard (658) | model-router | model-router | model-router |
| template-architect | standard (653) | model-router | model-router | model-router |
| ui-ux-designer | standard (651) | model-router | model-router | model-router |
| user-researcher | standard (654) | model-router | model-router | model-router |
| competitive-intel | standard (655) | model-router | model-router | model-router |
| competitive-research-analyst | standard (664) | model-router | model-router | model-router |
| market-research-analyst | standard (665) | model-router | model-router | model-router |
| content-creator | standard (649) | model-router | model-router | model-router |
| design-critic | standard (650) | model-router | model-router | model-router |
| m365-admin | economy (642) | model-router | model-router | model-router |
| global-admin | economy (643) | model-router | model-router | model-router |
| seo-analyst | economy (644) | model-router | model-router | model-router |
| social-media-manager | economy (645) | model-router | model-router | model-router |
| platform-intel | **(unlisted)** â†’ defaults to standard (`models.ts:696`) | model-router | model-router | model-router |

Roles missing from `ROLE_COST_TIER` get the `'standard'` default; `platform-intel` is the only
agent-folder role not explicitly enumerated in the tier map (`models.ts:640-676`).

The `resolveModel` shim in `agents/src/shared/createRunner.ts:24-31` simply forwards to
`optimizeModel`, so it produces the same result.

### 6. Headline findings

1. The runtime roster has shrunk to 8 truly-live roles in `server.ts`'s agentExecutor switch
   (`server.ts:1208-1334`), even though `activeAgentRoster.ts:10-23` still claims 12 active roles
   and the `@glyphor/agents` barrel exports 12 runner functions. **clo, devops-engineer,
   platform-engineer, quality-engineer** are in the keep roster but a scheduled wake to any of
   them returns `blockedRuntimeResult` â€” a silent no-op masquerading as "active".
2. **content-creator, seo-analyst, vp-sales** are retired roles
   (`activeAgentRoster.ts:37,38,47`) but their runner functions are still exported from the
   barrel and registered in `czProtocolApi.STATIC_RUNNERS`. They cannot run via the scheduler
   (gated out by `isLiveRuntimeRole`) but they do still ship and execute under the CZ-eval
   dry-run path. Either retire them fully (drop from barrel + STATIC_RUNNERS) or revive them.
3. **13 role folders are pure orphan code**: `competitive-intel, competitive-research-analyst,
   design-critic, frontend-engineer, global-admin, head-of-hr, m365-admin, market-research-analyst,
   platform-intel, social-media-manager, template-architect, ui-ux-designer, user-researcher`.
   Combined LOC â‰ˆ **8,500**. None of their `run<Role>` symbols are imported anywhere outside their
   own folder; their system prompts (e.g. `vp-design`-comparable 8,944-char `platform-intel`
   prompt) are dead weight.
4. The `SYSTEM_PROMPTS` map (`agents/src/index.ts:41-50`) only registers 8 prompts. Any caller
   that looks up a prompt by role slug (e.g. eval harnesses, CZ shadow runs that override prompts)
   will get `undefined` for the other 20 roles.
5. **All roles resolve to the same model (`model-router`)** for every task type because
   `TIER_MODELS` (`models.ts:630-634`) collapses `economy`/`standard`/`pro` to one value, and
   `EXEC_CHAT_MODEL` (line 637) is also `model-router`. The `pro`/`standard`/`economy` tiering in
   `ROLE_COST_TIER` is currently a no-op as far as model selection is concerned; cost
   differentiation must be happening at Foundry's router, not here.
6. `packages/agent-runtime/src/createRunner.ts` referenced in the brief does not exist â€” the only
   `createRunner` is `packages/agents/src/shared/createRunner.ts:36`. Anyone reading the brief
   should update internal docs accordingly.
7. Three roles ship with **zero role-local tool definitions**: `competitive-research-analyst`,
   `market-research-analyst`, `vp-research` (`vp-research/tools.ts` declares no `name:` fields).
   `clo` ships with **no `tools.ts` file at all**. Each of these still works because shared-tool
   factories are wired in `run.ts`, but the role-local tool layer is empty for them.

---

## Section 03 -- Tools -- Definitions, Grants, and Bypasses

Across 70 `*Tools.ts` files there are 377 tool definitions; 335 (89%) are never granted to any role and exist only as declarations. Approximately 100 call sites identified as provider-bypass candidates. The bulk of the inventory has no production caller, no eval coverage, and no role grant -- the catalog is far wider than the wired surface.

See: [section-03-tools.md](diagnostic-2026-04-27/section-03-tools.md)


**Generated**: 2026-04-27 17:00:24
**Scope**: All tool definitions in packages/agents/src/shared/*Tools.ts and agent-runtime tooling

### Executive Summary

- **Total tool definitions**: 377
- **Never granted to any role**: 335
- **Provider bypass cases identified**: 100
- **Files scanned**: 70 *Tools.ts files



### 1. Tool Inventory Table

Tools grouped by file. Columns: tool name, definition line, roles granting it, production invoked, last call site, eval coverage.

#### packages/agents/src/shared/accessAuditTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `view_access_matrix` | 14 | 0 | no | (declaration only) | no |
| `view_pending_grant_requests` | 77 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/agent365Tools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `reply_email_with_attachments` | 301 | 0 | no | (declaration only) | no |
| `reply_email_with_attachments` | 445 | 0 | no | (declaration only) | no |
| `reply_email_with_attachments` | 464 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/agentCreationTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_specialist_agent` | 53 | 0 | no | (declaration only) | no |
| `list_my_created_agents` | 291 | 0 | no | (declaration only) | no |
| `retire_created_agent` | 323 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/agentDirectoryTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_agent_directory` | 15 | 0 | no | (declaration only) | no |
| `who_handles` | 158 | 0 | no | (declaration only) | no |
| `Nexus` | 185 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/agentManagementTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `update_agent_name` | 15 | 0 | no | (declaration only) | no |
| `set_reports_to` | 53 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/assetTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `generate_image` | 504 | 0 | no | (declaration only) | no |
| `generate_and_publish_asset` | 538 | 0 | no | (declaration only) | no |
| `publish_asset_deliverable` | 682 | 0 | no | (declaration only) | no |
| `upload_asset` | 763 | 0 | no | (declaration only) | no |
| `list_assets` | 793 | 0 | no | (declaration only) | no |
| `optimize_image` | 885 | 0 | no | (declaration only) | no |
| `generate_favicon_set` | 949 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/assignmentTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `read_my_assignments` | 88 | 1+ | yes | (baseline/grant) | yes |
| `submit_assignment_output` | 158 | 1+ | yes | (baseline/grant) | yes |
| `flag_assignment_blocker` | 340 | 1+ | yes | (baseline/grant) | yes |

#### packages/agents/src/shared/auditTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `run_lighthouse_audit` | 56 | 0 | no | (declaration only) | no |
| `run_accessibility_audit` | 137 | 1+ | no | (baseline/grant) | no |
| `check_ai_smell` | 229 | 1+ | no | (baseline/grant) | no |
| `validate_brand_compliance` | 343 | 0 | no | (declaration only) | no |
| `check_bundle_size` | 430 | 0 | no | (declaration only) | no |
| `check_build_errors` | 532 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/canvaTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_canva_design` | 70 | 0 | no | (declaration only) | no |
| `get_canva_design` | 105 | 0 | no | (declaration only) | no |
| `search_canva_designs` | 126 | 0 | no | (declaration only) | no |
| `list_canva_brand_templates` | 150 | 0 | no | (declaration only) | no |
| `get_canva_template_fields` | 169 | 0 | no | (declaration only) | no |
| `generate_canva_design` | 189 | 0 | no | (declaration only) | no |
| `export_canva_design` | 254 | 0 | no | (declaration only) | no |
| `upload_canva_asset` | 290 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/cashFlowTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_cash_balance` | 28 | 0 | no | (declaration only) | no |
| `primary` | 82 | 0 | no | (declaration only) | no |
| `get_cash_flow` | 101 | 0 | no | (declaration only) | no |
| `get_pending_transactions` | 159 | 0 | no | (declaration only) | no |
| `generate_financial_report` | 260 | 0 | no | (declaration only) | no |
| `get_margin_analysis` | 360 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/channelNotifyTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `post_to_briefings` | 64 | 0 | no | (declaration only) | no |
| `post_to_deliverables` | 191 | 1+ | no | (baseline/grant) | no |

#### packages/agents/src/shared/claudeParityTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `run_todo_write` | 36 | 0 | no | (declaration only) | no |
| `delegate_codebase_explore` | 101 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/codexTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `codex` | 23 | 0 | no | (declaration only) | no |
| `codex` | 102 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/collectiveIntelligenceTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_company_vitals` | 73 | 0 | no | (declaration only) | no |
| `update_company_vitals` | 83 | 0 | no | (declaration only) | no |
| `update_vitals_highlights` | 103 | 0 | no | (declaration only) | no |
| `promote_to_org_knowledge` | 142 | 0 | no | (declaration only) | no |
| `get_org_knowledge` | 201 | 0 | no | (declaration only) | no |
| `read_company_doctrine` | 231 | 0 | no | (declaration only) | no |
| `create_knowledge_route` | 330 | 0 | no | (declaration only) | no |
| `get_knowledge_routes` | 375 | 0 | no | (declaration only) | no |
| `detect_contradictions` | 387 | 0 | no | (declaration only) | no |
| `record_process_pattern` | 399 | 0 | no | (declaration only) | no |
| `get_process_patterns` | 472 | 0 | no | (declaration only) | no |
| `propose_authority_change` | 498 | 0 | no | (declaration only) | no |
| `get_authority_proposals` | 566 | 0 | no | (declaration only) | no |
| `update_doctrine_section` | 585 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/communicationTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `send_agent_message` | 127 | 1+ | yes | (baseline/grant) | yes |
| `create_peer_work_request` | 266 | 0 | no | (declaration only) | no |
| `check_messages` | 420 | 1+ | yes | (baseline/grant) | yes |
| `call_meeting` | 486 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/competitiveIntelTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `track_competitor` | 22 | 0 | no | (declaration only) | no |
| `get_competitor_profile` | 93 | 1+ | no | (baseline/grant) | no |
| `update_competitor_profile` | 154 | 0 | no | (declaration only) | no |
| `compare_features` | 222 | 0 | no | (declaration only) | no |
| `track_competitor_pricing` | 291 | 0 | no | (declaration only) | no |
| `monitor_competitor_launches` | 349 | 0 | no | (declaration only) | no |
| `get_market_landscape` | 430 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/contentTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_content_draft` | 93 | 0 | no | (declaration only) | no |
| `update_content_draft` | 201 | 0 | no | (declaration only) | no |
| `get_content_drafts` | 309 | 0 | no | (declaration only) | no |
| `submit_content_for_review` | 382 | 0 | no | (declaration only) | no |
| `approve_content_draft` | 465 | 0 | no | (declaration only) | no |
| `reject_content_draft` | 557 | 0 | no | (declaration only) | no |
| `publish_content` | 644 | 0 | no | (declaration only) | no |
| `get_content_metrics` | 720 | 0 | no | (declaration only) | no |
| `get_content_calendar` | 772 | 0 | no | (declaration only) | no |
| `generate_content_image` | 839 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/costManagementTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_gcp_costs` | 22 | 0 | no | (declaration only) | no |
| `get_ai_model_costs` | 90 | 0 | no | (declaration only) | no |
| `get_vendor_costs` | 164 | 0 | no | (declaration only) | no |
| `get_cost_anomalies` | 211 | 0 | no | (declaration only) | no |
| `get_burn_rate` | 282 | 0 | no | (declaration only) | no |
| `create_budget` | 358 | 0 | no | (declaration only) | no |
| `check_budget_status` | 415 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/deliverableTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `publish_deliverable` | 54 | 0 | no | (declaration only) | no |
| `get_deliverables` | 222 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/deployPreviewTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `deploy_preview` | 42 | 1+ | no | (baseline/grant) | no |
| `get_deployment_status` | 138 | 0 | no | (declaration only) | no |
| `list_deployments` | 233 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/designBriefTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `hero` | 81 | 0 | no | (declaration only) | no |
| `value_proposition` | 87 | 0 | no | (declaration only) | no |
| `cta_section` | 93 | 0 | no | (declaration only) | no |
| `footer` | 99 | 0 | no | (declaration only) | no |
| `app_shell` | 109 | 0 | no | (declaration only) | no |
| `primary_feature_surface` | 115 | 0 | no | (declaration only) | no |
| `supporting_controls` | 121 | 0 | no | (declaration only) | no |
| `normalize_design_brief` | 357 | 1+ | no | (baseline/grant) | no |

#### packages/agents/src/shared/designSystemTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_design_tokens` | 113 | 0 | no | (declaration only) | no |
| `update_design_token` | 183 | 0 | no | (declaration only) | no |
| `validate_tokens_vs_implementation` | 291 | 0 | no | (declaration only) | no |
| `get_color_palette` | 386 | 0 | no | (declaration only) | no |
| `get_typography_scale` | 463 | 0 | no | (declaration only) | no |
| `list_components` | 513 | 0 | no | (declaration only) | no |
| `get_component_usage` | 585 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/diagnosticTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `check_table_schema` | 19 | 0 | no | (declaration only) | no |
| `diagnose_column_error` | 83 | 0 | no | (declaration only) | no |
| `list_tables` | 172 | 0 | no | (declaration only) | no |
| `check_tool_health` | 215 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/dmTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `send_teams_dm` | 214 | 0 | no | (declaration only) | no |
| `read_teams_dm` | 349 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/documentTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `generate_pdf` | 345 | 0 | no | (declaration only) | no |
| `generate_word_doc` | 465 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/docusignTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_signing_envelope` | 47 | 0 | no | (declaration only) | no |
| `send_template_envelope` | 202 | 0 | no | (declaration only) | no |
| `check_envelope_status` | 291 | 0 | no | (declaration only) | no |
| `list_envelopes` | 341 | 0 | no | (declaration only) | no |
| `void_envelope` | 398 | 0 | no | (declaration only) | no |
| `resend_envelope` | 442 | 0 | no | (declaration only) | no |
| `send_draft_envelope` | 476 | 0 | no | (declaration only) | no |
| `get_envelope_documents` | 513 | 0 | no | (declaration only) | no |
| `get_envelope_form_data` | 554 | 0 | no | (declaration only) | no |
| `get_envelope_audit_trail` | 594 | 0 | no | (declaration only) | no |
| `add_envelope_recipients` | 637 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/emailMarketingTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_mailchimp_lists` | 77 | 0 | no | (declaration only) | no |
| `get_mailchimp_members` | 112 | 0 | no | (declaration only) | no |
| `get_mailchimp_segments` | 157 | 0 | no | (declaration only) | no |
| `create_mailchimp_campaign` | 188 | 0 | no | (declaration only) | no |
| `set_campaign_content` | 226 | 0 | no | (declaration only) | no |
| `send_test_campaign` | 251 | 0 | no | (declaration only) | no |
| `send_campaign` | 281 | 0 | no | (declaration only) | no |
| `get_campaign_report` | 324 | 0 | no | (declaration only) | no |
| `get_campaign_list` | 356 | 0 | no | (declaration only) | no |
| `manage_mailchimp_tags` | 402 | 0 | no | (declaration only) | no |
| `send_transactional_email` | 450 | 0 | no | (declaration only) | no |
| `get_mandrill_stats` | 492 | 0 | no | (declaration only) | no |
| `search_mandrill_messages` | 529 | 0 | no | (declaration only) | no |
| `get_mandrill_templates` | 571 | 0 | no | (declaration only) | no |
| `render_mandrill_template` | 599 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/engineeringGapTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `run_test_suite` | 28 | 0 | no | (declaration only) | no |
| `get_code_coverage` | 80 | 0 | no | (declaration only) | no |
| `get_quality_metrics` | 161 | 0 | no | (declaration only) | no |
| `create_test_plan` | 262 | 0 | no | (declaration only) | no |
| `get_container_logs` | 320 | 0 | no | (declaration only) | no |
| `scale_service` | 402 | 0 | no | (declaration only) | no |
| `get_build_queue` | 464 | 0 | no | (declaration only) | no |
| `get_deployment_history` | 518 | 0 | no | (declaration only) | no |
| `get_infrastructure_inventory` | 602 | 0 | no | (declaration only) | no |
| `get_service_dependencies` | 699 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/entraHRTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `entra_get_user_profile` | 70 | 0 | no | (declaration only) | no |
| `entra_update_user_profile` | 127 | 0 | no | (declaration only) | no |
| `entra_upload_user_photo` | 190 | 0 | no | (declaration only) | no |
| `entra_set_manager` | 259 | 0 | no | (declaration only) | no |
| `entra_hr_assign_license` | 319 | 0 | no | (declaration only) | no |
| `entra_audit_profiles` | 378 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/eventTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `emit_insight` | 20 | 0 | yes | (declaration only) | yes |
| `emit_alert` | 76 | 0 | yes | (declaration only) | yes |

#### packages/agents/src/shared/executiveOrchestrationTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_team_assignments` | 109 | 0 | no | (declaration only) | no |
| `evaluate_team_output` | 436 | 0 | no | (declaration only) | no |
| `check_team_status` | 601 | 0 | no | (declaration only) | no |
| `synthesize_team_deliverable` | 681 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/externalA2aTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `discover_external_agents` | 15 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/facebookTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `publish_facebook_post` | 28 | 0 | no | (declaration only) | no |
| `schedule_facebook_post` | 64 | 0 | no | (declaration only) | no |
| `get_facebook_posts` | 117 | 0 | no | (declaration only) | no |
| `get_facebook_insights` | 138 | 0 | no | (declaration only) | no |
| `get_facebook_post_performance` | 168 | 0 | no | (declaration only) | no |
| `get_facebook_audience` | 188 | 0 | no | (declaration only) | no |
| `check_facebook_status` | 202 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/figmaTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_figma_file` | 17 | 0 | no | (declaration only) | no |
| `export_figma_images` | 43 | 0 | no | (declaration only) | no |
| `get_figma_image_fills` | 71 | 0 | no | (declaration only) | no |
| `get_figma_components` | 94 | 0 | no | (declaration only) | no |
| `get_figma_team_components` | 115 | 0 | no | (declaration only) | no |
| `get_figma_styles` | 136 | 0 | no | (declaration only) | no |
| `get_figma_team_styles` | 157 | 0 | no | (declaration only) | no |
| `get_figma_comments` | 180 | 0 | no | (declaration only) | no |
| `post_figma_comment` | 201 | 0 | no | (declaration only) | no |
| `resolve_figma_comment` | 243 | 0 | no | (declaration only) | no |
| `get_figma_file_metadata` | 269 | 0 | no | (declaration only) | no |
| `get_figma_version_history` | 290 | 0 | no | (declaration only) | no |
| `get_figma_team_projects` | 313 | 0 | no | (declaration only) | no |
| `get_figma_project_files` | 334 | 0 | no | (declaration only) | no |
| `get_figma_dev_resources` | 357 | 0 | no | (declaration only) | no |
| `create_figma_dev_resource` | 378 | 0 | no | (declaration only) | no |
| `manage_figma_webhooks` | 412 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/frontendCodeTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `read_frontend_file` | 67 | 0 | no | (declaration only) | no |
| `search_frontend_code` | 109 | 0 | no | (declaration only) | no |
| `list_frontend_files` | 158 | 0 | no | (declaration only) | no |
| `write_frontend_file` | 203 | 0 | no | (declaration only) | no |
| `create_design_branch` | 264 | 0 | no | (declaration only) | no |
| `create_git_branch` | 299 | 1+ | no | (baseline/grant) | no |
| `create_frontend_pr` | 335 | 0 | no | (declaration only) | no |
| `check_pr_status` | 384 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/graphTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `trace_causes` | 50 | 0 | no | (declaration only) | no |
| `trace_impact` | 68 | 0 | no | (declaration only) | no |
| `query_knowledge_graph` | 86 | 0 | no | (declaration only) | no |
| `add_knowledge` | 120 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/initiativeTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `propose_initiative` | 151 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/knowledgeRetrievalTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `read_company_knowledge` | 21 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/legalDocumentTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `draft_legal_document` | 20 | 0 | no | (declaration only) | no |
| `prepare_signing_envelope` | 145 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/linkedinTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `publish_linkedin_post` | 28 | 0 | no | (declaration only) | no |
| `get_linkedin_posts` | 65 | 0 | no | (declaration only) | no |
| `get_linkedin_post_analytics` | 86 | 0 | no | (declaration only) | no |
| `get_linkedin_followers` | 106 | 0 | no | (declaration only) | no |
| `get_linkedin_page_stats` | 120 | 0 | no | (declaration only) | no |
| `get_linkedin_demographics` | 134 | 0 | no | (declaration only) | no |
| `check_linkedin_status` | 148 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/logoTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `GLYPHOR` | 15 | 0 | no | (declaration only) | no |
| `create_logo_variation` | 205 | 0 | no | (declaration only) | no |
| `restyle_logo` | 280 | 0 | no | (declaration only) | no |
| `create_social_avatar` | 376 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/marketingIntelTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_experiment` | 23 | 0 | no | (declaration only) | no |
| `get_experiment_results` | 91 | 0 | no | (declaration only) | no |
| `monitor_competitor_marketing` | 166 | 0 | no | (declaration only) | no |
| `analyze_market_trends` | 225 | 0 | no | (declaration only) | no |
| `get_attribution_data` | 296 | 0 | no | (declaration only) | no |
| `capture_lead` | 371 | 0 | no | (declaration only) | no |
| `get_lead_pipeline` | 453 | 0 | no | (declaration only) | no |
| `score_lead` | 549 | 0 | no | (declaration only) | no |
| `get_marketing_dashboard` | 648 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/memoryTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `save_memory` | 45 | 1+ | yes | (baseline/grant) | yes |
| `recall_memories` | 103 | 0 | yes | (declaration only) | yes |
| `search_memories` | 131 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/opsExtensionTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_agent_health_dashboard` | 34 | 0 | no | (declaration only) | no |
| `get_event_bus_health` | 108 | 0 | no | (declaration only) | no |
| `get_data_freshness` | 162 | 0 | no | (declaration only) | no |
| `get_system_costs_realtime` | 221 | 0 | no | (declaration only) | no |
| `create_status_report` | 269 | 0 | no | (declaration only) | no |
| `predict_capacity` | 355 | 0 | no | (declaration only) | no |
| `get_access_matrix` | 455 | 0 | no | (declaration only) | no |
| `provision_access` | 541 | 0 | no | (declaration only) | no |
| `revoke_access` | 603 | 0 | no | (declaration only) | no |
| `audit_access` | 658 | 0 | no | (declaration only) | no |
| `rotate_secrets` | 728 | 0 | no | (declaration only) | no |
| `get_platform_audit_log` | 792 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/peerCoordinationTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `request_peer_work` | 31 | 0 | no | (declaration only) | no |
| `create_handoff` | 175 | 0 | no | (declaration only) | no |
| `peer_data_request` | 253 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/productAnalyticsTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_usage_metrics` | 20 | 1+ | no | (baseline/grant) | no |
| `get_funnel_analysis` | 138 | 0 | no | (declaration only) | no |
| `get_cohort_retention` | 217 | 0 | no | (declaration only) | no |
| `get_feature_usage` | 316 | 0 | no | (declaration only) | no |
| `segment_users` | 387 | 1+ | no | (baseline/grant) | no |

#### packages/agents/src/shared/quickDemoAppTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `quick_demo_web_app` | 50 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/researchMonitoringTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_monitor` | 41 | 1+ | no | (baseline/grant) | no |
| `check_monitors` | 107 | 1+ | no | (baseline/grant) | no |
| `get_monitor_history` | 163 | 1+ | no | (baseline/grant) | no |
| `track_competitor_product` | 220 | 0 | no | (declaration only) | no |
| `search_academic_papers` | 295 | 0 | no | (declaration only) | no |
| `track_open_source` | 400 | 0 | no | (declaration only) | no |
| `track_industry_events` | 470 | 0 | no | (declaration only) | no |
| `track_regulatory_changes` | 568 | 0 | no | (declaration only) | no |
| `analyze_ai_adoption` | 640 | 0 | no | (declaration only) | no |
| `track_ai_benchmarks` | 711 | 0 | no | (declaration only) | no |
| `analyze_org_structure` | 783 | 0 | no | (declaration only) | no |
| `compile_research_digest` | 867 | 1+ | no | (baseline/grant) | no |
| `identify_research_gaps` | 951 | 1+ | no | (baseline/grant) | no |
| `cross_reference_findings` | 1030 | 1+ | no | (baseline/grant) | no |

#### packages/agents/src/shared/researchRepoTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `save_research` | 19 | 1+ | no | (baseline/grant) | no |
| `search_research` | 92 | 1+ | no | (baseline/grant) | no |
| `get_research_timeline` | 209 | 1+ | no | (baseline/grant) | no |
| `create_research_brief` | 309 | 1+ | no | (baseline/grant) | no |

#### packages/agents/src/shared/researchTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `web_search` | 24 | 1+ | yes | (baseline/grant) | yes |
| `web_fetch` | 77 | 1+ | yes | (baseline/grant) | yes |
| `search_news` | 172 | 1+ | no | (baseline/grant) | no |
| `submit_research_packet` | 219 | 1+ | no | (baseline/grant) | no |

#### packages/agents/src/shared/revenueTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_mrr_breakdown` | 35 | 0 | no | (declaration only) | no |
| `get_subscription_details` | 96 | 0 | no | (declaration only) | no |
| `get_churn_analysis` | 154 | 0 | no | (declaration only) | no |
| `get_revenue_forecast` | 220 | 0 | no | (declaration only) | no |
| `get_stripe_invoices` | 311 | 0 | no | (declaration only) | no |
| `get_customer_ltv` | 373 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/roadmapTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_roadmap_item` | 20 | 0 | no | (declaration only) | no |
| `score_feature_rice` | 108 | 0 | no | (declaration only) | no |
| `get_roadmap` | 172 | 1+ | no | (baseline/grant) | no |
| `update_roadmap_item` | 265 | 0 | no | (declaration only) | no |
| `get_feature_requests` | 354 | 0 | no | (declaration only) | no |
| `manage_feature_flags` | 420 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/sandboxDevTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `sandbox_shell` | 213 | 0 | no | (declaration only) | no |
| `sandbox_file_read` | 294 | 0 | no | (declaration only) | no |
| `sandbox_file_write` | 346 | 0 | no | (declaration only) | no |
| `sandbox_file_edit` | 403 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/scaffoldTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `Alice` | 72 | 0 | no | (declaration only) | no |
| `Alice` | 73 | 0 | no | (declaration only) | no |
| `scaffold_component` | 123 | 0 | no | (declaration only) | no |
| `scaffold_page` | 205 | 0 | no | (declaration only) | no |
| `list_templates` | 319 | 0 | no | (declaration only) | no |
| `clone_and_modify` | 347 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/screenshotTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `screenshot_page` | 34 | 1+ | no | (baseline/grant) | no |
| `screenshot_component` | 87 | 0 | no | (declaration only) | no |
| `compare_screenshots` | 166 | 0 | no | (declaration only) | no |
| `check_responsive` | 206 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/seoTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_search_performance` | 44 | 1+ | no | (baseline/grant) | no |
| `track_keyword_rankings` | 139 | 0 | no | (declaration only) | no |
| `analyze_page_seo` | 251 | 0 | no | (declaration only) | no |
| `get_indexing_status` | 369 | 0 | no | (declaration only) | no |
| `submit_sitemap` | 446 | 0 | no | (declaration only) | no |
| `update_seo_data` | 509 | 0 | no | (declaration only) | no |
| `get_backlink_profile` | 569 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/sharepointTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `upload_to_sharepoint` | 21 | 0 | no | (declaration only) | no |
| `search_sharepoint` | 92 | 0 | no | (declaration only) | no |
| `read_sharepoint_document` | 148 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/slackOutputTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `post_to_slack` | 189 | 0 | no | (declaration only) | no |
| `request_slack_approval` | 291 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/socialMediaTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `schedule_social_post` | 326 | 1+ | no | (baseline/grant) | no |
| `get_scheduled_posts` | 628 | 0 | no | (declaration only) | no |
| `get_social_metrics` | 696 | 0 | no | (declaration only) | no |
| `get_post_performance` | 750 | 0 | no | (declaration only) | no |
| `get_social_audience` | 804 | 0 | no | (declaration only) | no |
| `reply_to_social` | 871 | 0 | no | (declaration only) | no |
| `get_trending_topics` | 942 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/storybookTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `storybook_list_stories` | 58 | 0 | no | (declaration only) | no |
| `storybook_screenshot` | 78 | 0 | no | (declaration only) | no |
| `storybook_screenshot_all` | 137 | 0 | no | (declaration only) | no |
| `storybook_visual_diff` | 208 | 0 | no | (declaration only) | no |
| `storybook_save_baseline` | 269 | 0 | no | (declaration only) | no |
| `storybook_check_coverage` | 362 | 0 | no | (declaration only) | no |
| `storybook_get_story_source` | 431 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/teamOrchestrationTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `assign_team_task` | 150 | 0 | no | (declaration only) | no |
| `create_sub_team_assignment` | 310 | 0 | no | (declaration only) | no |
| `review_team_output` | 490 | 0 | no | (declaration only) | no |
| `notify_founders` | 671 | 0 | no | (declaration only) | no |
| `check_team_status` | 759 | 0 | no | (declaration only) | no |
| `check_team_assignments` | 788 | 0 | no | (declaration only) | no |
| `escalate_to_sarah` | 816 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/teamsOutputTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `post_to_customer_teams` | 283 | 0 | no | (declaration only) | no |
| `request_teams_approval` | 365 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/toolGrantTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `grant_tool_access` | 28 | 1+ | no | (baseline/grant) | no |
| `revoke_tool_access` | 182 | 1+ | no | (baseline/grant) | no |

#### packages/agents/src/shared/toolRegistryTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `list_tool_requests` | 44 | 0 | no | (declaration only) | no |
| `review_tool_request` | 88 | 0 | no | (declaration only) | no |
| `register_tool` | 180 | 0 | no | (declaration only) | no |
| `deactivate_tool` | 339 | 0 | no | (declaration only) | no |
| `list_registered_tools` | 384 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/toolRequestTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `list_my_tools` | 207 | 1+ | no | (baseline/grant) | no |
| `tool_search` | 279 | 1+ | no | (baseline/grant) | no |
| `check_tool_access` | 336 | 0 | no | (declaration only) | no |
| `request_new_tool` | 440 | 0 | no | (declaration only) | no |
| `check_tool_request_status` | 705 | 0 | no | (declaration only) | no |
| `request_tool_access` | 738 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/userResearchTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_survey` | 33 | 0 | no | (declaration only) | no |
| `get_survey_results` | 100 | 0 | no | (declaration only) | no |
| `analyze_support_tickets` | 159 | 0 | no | (declaration only) | no |
| `get_user_feedback` | 256 | 0 | no | (declaration only) | no |
| `create_user_persona` | 351 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/videoCreationTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `generate_image` | 129 | 0 | no | (declaration only) | no |
| `generate_video` | 205 | 0 | no | (declaration only) | no |
| `poll_video_status` | 297 | 0 | no | (declaration only) | no |
| `generate_voiceover` | 359 | 0 | no | (declaration only) | no |
| `generate_sfx` | 429 | 0 | no | (declaration only) | no |
| `generate_music` | 490 | 0 | no | (declaration only) | no |
| `enhance_video_prompt` | 551 | 0 | no | (declaration only) | no |

#### packages/agents/src/shared/webBuildPlannerTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `plan_website_build` | 225 | 1+ | no | (baseline/grant) | no |

#### packages/agents/src/shared/webBuildTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `invoke_web_build` | 1787 | 1+ | no | (baseline/grant) | no |
| `invoke_web_iterate` | 1885 | 1+ | no | (baseline/grant) | no |
| `invoke_web_coding_loop` | 1937 | 1+ | no | (baseline/grant) | no |
| `invoke_web_upgrade` | 2101 | 0 | no | (declaration only) | no |
| `search_components` | 2460 | 0 | no | (declaration only) | no |
| `get_component_info` | 2471 | 0 | no | (declaration only) | no |
| `get_installation_info` | 2482 | 0 | no | (declaration only) | no |
| `install_item_from_registry` | 2498 | 0 | no | (declaration only) | no |
| `button` | 2534 | 0 | no | (declaration only) | no |
| `card` | 2535 | 0 | no | (declaration only) | no |
| `tabs` | 2536 | 0 | no | (declaration only) | no |
| `dialog` | 2537 | 0 | no | (declaration only) | no |
| `particles` | 2540 | 0 | no | (declaration only) | no |
| `spotlight` | 2541 | 0 | no | (declaration only) | no |
| `build_website_foundation` | 3165 | 1+ | no | (baseline/grant) | no |

#### packages/agents/src/shared/websiteIngestionTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `scrape_website` | 153 | 0 | no | (declaration only) | no |



### 2. Tools That Exist But Are Never Granted

Tools defined but not granted to any role via baseline or migrations.

**Count**: 335 tools

#### packages/agents/src/shared/accessAuditTools.ts

- `view_access_matrix` â€” packages/agents/src/shared/accessAuditTools.ts:14
- `view_pending_grant_requests` â€” packages/agents/src/shared/accessAuditTools.ts:77

#### packages/agents/src/shared/agent365Tools.ts

- `reply_email_with_attachments` â€” packages/agents/src/shared/agent365Tools.ts:301
- `reply_email_with_attachments` â€” packages/agents/src/shared/agent365Tools.ts:445
- `reply_email_with_attachments` â€” packages/agents/src/shared/agent365Tools.ts:464

#### packages/agents/src/shared/agentCreationTools.ts

- `list_my_created_agents` â€” packages/agents/src/shared/agentCreationTools.ts:291
- `retire_created_agent` â€” packages/agents/src/shared/agentCreationTools.ts:323
- `create_specialist_agent` â€” packages/agents/src/shared/agentCreationTools.ts:53

#### packages/agents/src/shared/agentDirectoryTools.ts

- `get_agent_directory` â€” packages/agents/src/shared/agentDirectoryTools.ts:15
- `who_handles` â€” packages/agents/src/shared/agentDirectoryTools.ts:158
- `Nexus` â€” packages/agents/src/shared/agentDirectoryTools.ts:185

#### packages/agents/src/shared/agentManagementTools.ts

- `update_agent_name` â€” packages/agents/src/shared/agentManagementTools.ts:15
- `set_reports_to` â€” packages/agents/src/shared/agentManagementTools.ts:53

#### packages/agents/src/shared/assetTools.ts

- `generate_image` â€” packages/agents/src/shared/assetTools.ts:504
- `generate_and_publish_asset` â€” packages/agents/src/shared/assetTools.ts:538
- `publish_asset_deliverable` â€” packages/agents/src/shared/assetTools.ts:682
- `upload_asset` â€” packages/agents/src/shared/assetTools.ts:763
- `list_assets` â€” packages/agents/src/shared/assetTools.ts:793
- `optimize_image` â€” packages/agents/src/shared/assetTools.ts:885
- `generate_favicon_set` â€” packages/agents/src/shared/assetTools.ts:949

#### packages/agents/src/shared/auditTools.ts

- `validate_brand_compliance` â€” packages/agents/src/shared/auditTools.ts:343
- `check_bundle_size` â€” packages/agents/src/shared/auditTools.ts:430
- `check_build_errors` â€” packages/agents/src/shared/auditTools.ts:532
- `run_lighthouse_audit` â€” packages/agents/src/shared/auditTools.ts:56

#### packages/agents/src/shared/canvaTools.ts

- `get_canva_design` â€” packages/agents/src/shared/canvaTools.ts:105
- `search_canva_designs` â€” packages/agents/src/shared/canvaTools.ts:126
- `list_canva_brand_templates` â€” packages/agents/src/shared/canvaTools.ts:150
- `get_canva_template_fields` â€” packages/agents/src/shared/canvaTools.ts:169
- `generate_canva_design` â€” packages/agents/src/shared/canvaTools.ts:189
- `export_canva_design` â€” packages/agents/src/shared/canvaTools.ts:254
- `upload_canva_asset` â€” packages/agents/src/shared/canvaTools.ts:290
- `create_canva_design` â€” packages/agents/src/shared/canvaTools.ts:70

#### packages/agents/src/shared/cashFlowTools.ts

- `get_cash_flow` â€” packages/agents/src/shared/cashFlowTools.ts:101
- `get_pending_transactions` â€” packages/agents/src/shared/cashFlowTools.ts:159
- `generate_financial_report` â€” packages/agents/src/shared/cashFlowTools.ts:260
- `get_cash_balance` â€” packages/agents/src/shared/cashFlowTools.ts:28
- `get_margin_analysis` â€” packages/agents/src/shared/cashFlowTools.ts:360
- `primary` â€” packages/agents/src/shared/cashFlowTools.ts:82

#### packages/agents/src/shared/channelNotifyTools.ts

- `post_to_briefings` â€” packages/agents/src/shared/channelNotifyTools.ts:64

#### packages/agents/src/shared/claudeParityTools.ts

- `delegate_codebase_explore` â€” packages/agents/src/shared/claudeParityTools.ts:101
- `run_todo_write` â€” packages/agents/src/shared/claudeParityTools.ts:36

#### packages/agents/src/shared/codexTools.ts

- `codex` â€” packages/agents/src/shared/codexTools.ts:102
- `codex` â€” packages/agents/src/shared/codexTools.ts:23

#### packages/agents/src/shared/collectiveIntelligenceTools.ts

- `update_vitals_highlights` â€” packages/agents/src/shared/collectiveIntelligenceTools.ts:103
- `promote_to_org_knowledge` â€” packages/agents/src/shared/collectiveIntelligenceTools.ts:142
- `get_org_knowledge` â€” packages/agents/src/shared/collectiveIntelligenceTools.ts:201
- `read_company_doctrine` â€” packages/agents/src/shared/collectiveIntelligenceTools.ts:231
- `create_knowledge_route` â€” packages/agents/src/shared/collectiveIntelligenceTools.ts:330
- `get_knowledge_routes` â€” packages/agents/src/shared/collectiveIntelligenceTools.ts:375
- `detect_contradictions` â€” packages/agents/src/shared/collectiveIntelligenceTools.ts:387
- `record_process_pattern` â€” packages/agents/src/shared/collectiveIntelligenceTools.ts:399
- `get_process_patterns` â€” packages/agents/src/shared/collectiveIntelligenceTools.ts:472
- `propose_authority_change` â€” packages/agents/src/shared/collectiveIntelligenceTools.ts:498
- `get_authority_proposals` â€” packages/agents/src/shared/collectiveIntelligenceTools.ts:566
- `update_doctrine_section` â€” packages/agents/src/shared/collectiveIntelligenceTools.ts:585
- `get_company_vitals` â€” packages/agents/src/shared/collectiveIntelligenceTools.ts:73
- `update_company_vitals` â€” packages/agents/src/shared/collectiveIntelligenceTools.ts:83

#### packages/agents/src/shared/communicationTools.ts

- `create_peer_work_request` â€” packages/agents/src/shared/communicationTools.ts:266
- `call_meeting` â€” packages/agents/src/shared/communicationTools.ts:486

#### packages/agents/src/shared/competitiveIntelTools.ts

- `update_competitor_profile` â€” packages/agents/src/shared/competitiveIntelTools.ts:154
- `track_competitor` â€” packages/agents/src/shared/competitiveIntelTools.ts:22
- `compare_features` â€” packages/agents/src/shared/competitiveIntelTools.ts:222
- `track_competitor_pricing` â€” packages/agents/src/shared/competitiveIntelTools.ts:291
- `monitor_competitor_launches` â€” packages/agents/src/shared/competitiveIntelTools.ts:349
- `get_market_landscape` â€” packages/agents/src/shared/competitiveIntelTools.ts:430

#### packages/agents/src/shared/contentTools.ts

- `update_content_draft` â€” packages/agents/src/shared/contentTools.ts:201
- `get_content_drafts` â€” packages/agents/src/shared/contentTools.ts:309
- `submit_content_for_review` â€” packages/agents/src/shared/contentTools.ts:382
- `approve_content_draft` â€” packages/agents/src/shared/contentTools.ts:465
- `reject_content_draft` â€” packages/agents/src/shared/contentTools.ts:557
- `publish_content` â€” packages/agents/src/shared/contentTools.ts:644
- `get_content_metrics` â€” packages/agents/src/shared/contentTools.ts:720
- `get_content_calendar` â€” packages/agents/src/shared/contentTools.ts:772
- `generate_content_image` â€” packages/agents/src/shared/contentTools.ts:839
- `create_content_draft` â€” packages/agents/src/shared/contentTools.ts:93

#### packages/agents/src/shared/costManagementTools.ts

- `get_vendor_costs` â€” packages/agents/src/shared/costManagementTools.ts:164
- `get_cost_anomalies` â€” packages/agents/src/shared/costManagementTools.ts:211
- `get_gcp_costs` â€” packages/agents/src/shared/costManagementTools.ts:22
- `get_burn_rate` â€” packages/agents/src/shared/costManagementTools.ts:282
- `create_budget` â€” packages/agents/src/shared/costManagementTools.ts:358
- `check_budget_status` â€” packages/agents/src/shared/costManagementTools.ts:415
- `get_ai_model_costs` â€” packages/agents/src/shared/costManagementTools.ts:90

#### packages/agents/src/shared/deliverableTools.ts

- `get_deliverables` â€” packages/agents/src/shared/deliverableTools.ts:222
- `publish_deliverable` â€” packages/agents/src/shared/deliverableTools.ts:54

#### packages/agents/src/shared/deployPreviewTools.ts

- `get_deployment_status` â€” packages/agents/src/shared/deployPreviewTools.ts:138
- `list_deployments` â€” packages/agents/src/shared/deployPreviewTools.ts:233

#### packages/agents/src/shared/designBriefTools.ts

- `app_shell` â€” packages/agents/src/shared/designBriefTools.ts:109
- `primary_feature_surface` â€” packages/agents/src/shared/designBriefTools.ts:115
- `supporting_controls` â€” packages/agents/src/shared/designBriefTools.ts:121
- `hero` â€” packages/agents/src/shared/designBriefTools.ts:81
- `value_proposition` â€” packages/agents/src/shared/designBriefTools.ts:87
- `cta_section` â€” packages/agents/src/shared/designBriefTools.ts:93
- `footer` â€” packages/agents/src/shared/designBriefTools.ts:99

#### packages/agents/src/shared/designSystemTools.ts

- `get_design_tokens` â€” packages/agents/src/shared/designSystemTools.ts:113
- `update_design_token` â€” packages/agents/src/shared/designSystemTools.ts:183
- `validate_tokens_vs_implementation` â€” packages/agents/src/shared/designSystemTools.ts:291
- `get_color_palette` â€” packages/agents/src/shared/designSystemTools.ts:386
- `get_typography_scale` â€” packages/agents/src/shared/designSystemTools.ts:463
- `list_components` â€” packages/agents/src/shared/designSystemTools.ts:513
- `get_component_usage` â€” packages/agents/src/shared/designSystemTools.ts:585

#### packages/agents/src/shared/diagnosticTools.ts

- `list_tables` â€” packages/agents/src/shared/diagnosticTools.ts:172
- `check_table_schema` â€” packages/agents/src/shared/diagnosticTools.ts:19
- `check_tool_health` â€” packages/agents/src/shared/diagnosticTools.ts:215
- `diagnose_column_error` â€” packages/agents/src/shared/diagnosticTools.ts:83

#### packages/agents/src/shared/dmTools.ts

- `send_teams_dm` â€” packages/agents/src/shared/dmTools.ts:214
- `read_teams_dm` â€” packages/agents/src/shared/dmTools.ts:349

#### packages/agents/src/shared/documentTools.ts

- `generate_pdf` â€” packages/agents/src/shared/documentTools.ts:345
- `generate_word_doc` â€” packages/agents/src/shared/documentTools.ts:465

#### packages/agents/src/shared/docusignTools.ts

- `send_template_envelope` â€” packages/agents/src/shared/docusignTools.ts:202
- `check_envelope_status` â€” packages/agents/src/shared/docusignTools.ts:291
- `list_envelopes` â€” packages/agents/src/shared/docusignTools.ts:341
- `void_envelope` â€” packages/agents/src/shared/docusignTools.ts:398
- `resend_envelope` â€” packages/agents/src/shared/docusignTools.ts:442
- `create_signing_envelope` â€” packages/agents/src/shared/docusignTools.ts:47
- `send_draft_envelope` â€” packages/agents/src/shared/docusignTools.ts:476
- `get_envelope_documents` â€” packages/agents/src/shared/docusignTools.ts:513
- `get_envelope_form_data` â€” packages/agents/src/shared/docusignTools.ts:554
- `get_envelope_audit_trail` â€” packages/agents/src/shared/docusignTools.ts:594
- `add_envelope_recipients` â€” packages/agents/src/shared/docusignTools.ts:637

#### packages/agents/src/shared/emailMarketingTools.ts

- `get_mailchimp_members` â€” packages/agents/src/shared/emailMarketingTools.ts:112
- `get_mailchimp_segments` â€” packages/agents/src/shared/emailMarketingTools.ts:157
- `create_mailchimp_campaign` â€” packages/agents/src/shared/emailMarketingTools.ts:188
- `set_campaign_content` â€” packages/agents/src/shared/emailMarketingTools.ts:226
- `send_test_campaign` â€” packages/agents/src/shared/emailMarketingTools.ts:251
- `send_campaign` â€” packages/agents/src/shared/emailMarketingTools.ts:281
- `get_campaign_report` â€” packages/agents/src/shared/emailMarketingTools.ts:324
- `get_campaign_list` â€” packages/agents/src/shared/emailMarketingTools.ts:356
- `manage_mailchimp_tags` â€” packages/agents/src/shared/emailMarketingTools.ts:402
- `send_transactional_email` â€” packages/agents/src/shared/emailMarketingTools.ts:450
- `get_mandrill_stats` â€” packages/agents/src/shared/emailMarketingTools.ts:492
- `search_mandrill_messages` â€” packages/agents/src/shared/emailMarketingTools.ts:529
- `get_mandrill_templates` â€” packages/agents/src/shared/emailMarketingTools.ts:571
- `render_mandrill_template` â€” packages/agents/src/shared/emailMarketingTools.ts:599
- `get_mailchimp_lists` â€” packages/agents/src/shared/emailMarketingTools.ts:77

#### packages/agents/src/shared/engineeringGapTools.ts

- `get_quality_metrics` â€” packages/agents/src/shared/engineeringGapTools.ts:161
- `create_test_plan` â€” packages/agents/src/shared/engineeringGapTools.ts:262
- `run_test_suite` â€” packages/agents/src/shared/engineeringGapTools.ts:28
- `get_container_logs` â€” packages/agents/src/shared/engineeringGapTools.ts:320
- `scale_service` â€” packages/agents/src/shared/engineeringGapTools.ts:402
- `get_build_queue` â€” packages/agents/src/shared/engineeringGapTools.ts:464
- `get_deployment_history` â€” packages/agents/src/shared/engineeringGapTools.ts:518
- `get_infrastructure_inventory` â€” packages/agents/src/shared/engineeringGapTools.ts:602
- `get_service_dependencies` â€” packages/agents/src/shared/engineeringGapTools.ts:699
- `get_code_coverage` â€” packages/agents/src/shared/engineeringGapTools.ts:80

#### packages/agents/src/shared/entraHRTools.ts

- `entra_update_user_profile` â€” packages/agents/src/shared/entraHRTools.ts:127
- `entra_upload_user_photo` â€” packages/agents/src/shared/entraHRTools.ts:190
- `entra_set_manager` â€” packages/agents/src/shared/entraHRTools.ts:259
- `entra_hr_assign_license` â€” packages/agents/src/shared/entraHRTools.ts:319
- `entra_audit_profiles` â€” packages/agents/src/shared/entraHRTools.ts:378
- `entra_get_user_profile` â€” packages/agents/src/shared/entraHRTools.ts:70

#### packages/agents/src/shared/eventTools.ts

- `emit_insight` â€” packages/agents/src/shared/eventTools.ts:20
- `emit_alert` â€” packages/agents/src/shared/eventTools.ts:76

#### packages/agents/src/shared/executiveOrchestrationTools.ts

- `create_team_assignments` â€” packages/agents/src/shared/executiveOrchestrationTools.ts:109
- `evaluate_team_output` â€” packages/agents/src/shared/executiveOrchestrationTools.ts:436
- `check_team_status` â€” packages/agents/src/shared/executiveOrchestrationTools.ts:601
- `synthesize_team_deliverable` â€” packages/agents/src/shared/executiveOrchestrationTools.ts:681

#### packages/agents/src/shared/externalA2aTools.ts

- `discover_external_agents` â€” packages/agents/src/shared/externalA2aTools.ts:15

#### packages/agents/src/shared/facebookTools.ts

- `get_facebook_posts` â€” packages/agents/src/shared/facebookTools.ts:117
- `get_facebook_insights` â€” packages/agents/src/shared/facebookTools.ts:138
- `get_facebook_post_performance` â€” packages/agents/src/shared/facebookTools.ts:168
- `get_facebook_audience` â€” packages/agents/src/shared/facebookTools.ts:188
- `check_facebook_status` â€” packages/agents/src/shared/facebookTools.ts:202
- `publish_facebook_post` â€” packages/agents/src/shared/facebookTools.ts:28
- `schedule_facebook_post` â€” packages/agents/src/shared/facebookTools.ts:64

#### packages/agents/src/shared/figmaTools.ts

- `get_figma_team_components` â€” packages/agents/src/shared/figmaTools.ts:115
- `get_figma_styles` â€” packages/agents/src/shared/figmaTools.ts:136
- `get_figma_team_styles` â€” packages/agents/src/shared/figmaTools.ts:157
- `get_figma_file` â€” packages/agents/src/shared/figmaTools.ts:17
- `get_figma_comments` â€” packages/agents/src/shared/figmaTools.ts:180
- `post_figma_comment` â€” packages/agents/src/shared/figmaTools.ts:201
- `resolve_figma_comment` â€” packages/agents/src/shared/figmaTools.ts:243
- `get_figma_file_metadata` â€” packages/agents/src/shared/figmaTools.ts:269
- `get_figma_version_history` â€” packages/agents/src/shared/figmaTools.ts:290
- `get_figma_team_projects` â€” packages/agents/src/shared/figmaTools.ts:313
- `get_figma_project_files` â€” packages/agents/src/shared/figmaTools.ts:334
- `get_figma_dev_resources` â€” packages/agents/src/shared/figmaTools.ts:357
- `create_figma_dev_resource` â€” packages/agents/src/shared/figmaTools.ts:378
- `manage_figma_webhooks` â€” packages/agents/src/shared/figmaTools.ts:412
- `export_figma_images` â€” packages/agents/src/shared/figmaTools.ts:43
- `get_figma_image_fills` â€” packages/agents/src/shared/figmaTools.ts:71
- `get_figma_components` â€” packages/agents/src/shared/figmaTools.ts:94

#### packages/agents/src/shared/frontendCodeTools.ts

- `search_frontend_code` â€” packages/agents/src/shared/frontendCodeTools.ts:109
- `list_frontend_files` â€” packages/agents/src/shared/frontendCodeTools.ts:158
- `write_frontend_file` â€” packages/agents/src/shared/frontendCodeTools.ts:203
- `create_design_branch` â€” packages/agents/src/shared/frontendCodeTools.ts:264
- `create_frontend_pr` â€” packages/agents/src/shared/frontendCodeTools.ts:335
- `check_pr_status` â€” packages/agents/src/shared/frontendCodeTools.ts:384
- `read_frontend_file` â€” packages/agents/src/shared/frontendCodeTools.ts:67

#### packages/agents/src/shared/graphTools.ts

- `add_knowledge` â€” packages/agents/src/shared/graphTools.ts:120
- `trace_causes` â€” packages/agents/src/shared/graphTools.ts:50
- `trace_impact` â€” packages/agents/src/shared/graphTools.ts:68
- `query_knowledge_graph` â€” packages/agents/src/shared/graphTools.ts:86

#### packages/agents/src/shared/initiativeTools.ts

- `propose_initiative` â€” packages/agents/src/shared/initiativeTools.ts:151

#### packages/agents/src/shared/knowledgeRetrievalTools.ts

- `read_company_knowledge` â€” packages/agents/src/shared/knowledgeRetrievalTools.ts:21

#### packages/agents/src/shared/legalDocumentTools.ts

- `prepare_signing_envelope` â€” packages/agents/src/shared/legalDocumentTools.ts:145
- `draft_legal_document` â€” packages/agents/src/shared/legalDocumentTools.ts:20

#### packages/agents/src/shared/linkedinTools.ts

- `get_linkedin_followers` â€” packages/agents/src/shared/linkedinTools.ts:106
- `get_linkedin_page_stats` â€” packages/agents/src/shared/linkedinTools.ts:120
- `get_linkedin_demographics` â€” packages/agents/src/shared/linkedinTools.ts:134
- `check_linkedin_status` â€” packages/agents/src/shared/linkedinTools.ts:148
- `publish_linkedin_post` â€” packages/agents/src/shared/linkedinTools.ts:28
- `get_linkedin_posts` â€” packages/agents/src/shared/linkedinTools.ts:65
- `get_linkedin_post_analytics` â€” packages/agents/src/shared/linkedinTools.ts:86

#### packages/agents/src/shared/logoTools.ts

- `GLYPHOR` â€” packages/agents/src/shared/logoTools.ts:15
- `create_logo_variation` â€” packages/agents/src/shared/logoTools.ts:205
- `restyle_logo` â€” packages/agents/src/shared/logoTools.ts:280
- `create_social_avatar` â€” packages/agents/src/shared/logoTools.ts:376

#### packages/agents/src/shared/marketingIntelTools.ts

- `monitor_competitor_marketing` â€” packages/agents/src/shared/marketingIntelTools.ts:166
- `analyze_market_trends` â€” packages/agents/src/shared/marketingIntelTools.ts:225
- `create_experiment` â€” packages/agents/src/shared/marketingIntelTools.ts:23
- `get_attribution_data` â€” packages/agents/src/shared/marketingIntelTools.ts:296
- `capture_lead` â€” packages/agents/src/shared/marketingIntelTools.ts:371
- `get_lead_pipeline` â€” packages/agents/src/shared/marketingIntelTools.ts:453
- `score_lead` â€” packages/agents/src/shared/marketingIntelTools.ts:549
- `get_marketing_dashboard` â€” packages/agents/src/shared/marketingIntelTools.ts:648
- `get_experiment_results` â€” packages/agents/src/shared/marketingIntelTools.ts:91

#### packages/agents/src/shared/memoryTools.ts

- `recall_memories` â€” packages/agents/src/shared/memoryTools.ts:103
- `search_memories` â€” packages/agents/src/shared/memoryTools.ts:131

#### packages/agents/src/shared/opsExtensionTools.ts

- `get_event_bus_health` â€” packages/agents/src/shared/opsExtensionTools.ts:108
- `get_data_freshness` â€” packages/agents/src/shared/opsExtensionTools.ts:162
- `get_system_costs_realtime` â€” packages/agents/src/shared/opsExtensionTools.ts:221
- `create_status_report` â€” packages/agents/src/shared/opsExtensionTools.ts:269
- `get_agent_health_dashboard` â€” packages/agents/src/shared/opsExtensionTools.ts:34
- `predict_capacity` â€” packages/agents/src/shared/opsExtensionTools.ts:355
- `get_access_matrix` â€” packages/agents/src/shared/opsExtensionTools.ts:455
- `provision_access` â€” packages/agents/src/shared/opsExtensionTools.ts:541
- `revoke_access` â€” packages/agents/src/shared/opsExtensionTools.ts:603
- `audit_access` â€” packages/agents/src/shared/opsExtensionTools.ts:658
- `rotate_secrets` â€” packages/agents/src/shared/opsExtensionTools.ts:728
- `get_platform_audit_log` â€” packages/agents/src/shared/opsExtensionTools.ts:792

#### packages/agents/src/shared/peerCoordinationTools.ts

- `create_handoff` â€” packages/agents/src/shared/peerCoordinationTools.ts:175
- `peer_data_request` â€” packages/agents/src/shared/peerCoordinationTools.ts:253
- `request_peer_work` â€” packages/agents/src/shared/peerCoordinationTools.ts:31

#### packages/agents/src/shared/productAnalyticsTools.ts

- `get_funnel_analysis` â€” packages/agents/src/shared/productAnalyticsTools.ts:138
- `get_cohort_retention` â€” packages/agents/src/shared/productAnalyticsTools.ts:217
- `get_feature_usage` â€” packages/agents/src/shared/productAnalyticsTools.ts:316

#### packages/agents/src/shared/quickDemoAppTools.ts

- `quick_demo_web_app` â€” packages/agents/src/shared/quickDemoAppTools.ts:50

#### packages/agents/src/shared/researchMonitoringTools.ts

- `track_competitor_product` â€” packages/agents/src/shared/researchMonitoringTools.ts:220
- `search_academic_papers` â€” packages/agents/src/shared/researchMonitoringTools.ts:295
- `track_open_source` â€” packages/agents/src/shared/researchMonitoringTools.ts:400
- `track_industry_events` â€” packages/agents/src/shared/researchMonitoringTools.ts:470
- `track_regulatory_changes` â€” packages/agents/src/shared/researchMonitoringTools.ts:568
- `analyze_ai_adoption` â€” packages/agents/src/shared/researchMonitoringTools.ts:640
- `track_ai_benchmarks` â€” packages/agents/src/shared/researchMonitoringTools.ts:711
- `analyze_org_structure` â€” packages/agents/src/shared/researchMonitoringTools.ts:783

#### packages/agents/src/shared/revenueTools.ts

- `get_churn_analysis` â€” packages/agents/src/shared/revenueTools.ts:154
- `get_revenue_forecast` â€” packages/agents/src/shared/revenueTools.ts:220
- `get_stripe_invoices` â€” packages/agents/src/shared/revenueTools.ts:311
- `get_mrr_breakdown` â€” packages/agents/src/shared/revenueTools.ts:35
- `get_customer_ltv` â€” packages/agents/src/shared/revenueTools.ts:373
- `get_subscription_details` â€” packages/agents/src/shared/revenueTools.ts:96

#### packages/agents/src/shared/roadmapTools.ts

- `score_feature_rice` â€” packages/agents/src/shared/roadmapTools.ts:108
- `create_roadmap_item` â€” packages/agents/src/shared/roadmapTools.ts:20
- `update_roadmap_item` â€” packages/agents/src/shared/roadmapTools.ts:265
- `get_feature_requests` â€” packages/agents/src/shared/roadmapTools.ts:354
- `manage_feature_flags` â€” packages/agents/src/shared/roadmapTools.ts:420

#### packages/agents/src/shared/sandboxDevTools.ts

- `sandbox_shell` â€” packages/agents/src/shared/sandboxDevTools.ts:213
- `sandbox_file_read` â€” packages/agents/src/shared/sandboxDevTools.ts:294
- `sandbox_file_write` â€” packages/agents/src/shared/sandboxDevTools.ts:346
- `sandbox_file_edit` â€” packages/agents/src/shared/sandboxDevTools.ts:403

#### packages/agents/src/shared/scaffoldTools.ts

- `scaffold_component` â€” packages/agents/src/shared/scaffoldTools.ts:123
- `scaffold_page` â€” packages/agents/src/shared/scaffoldTools.ts:205
- `list_templates` â€” packages/agents/src/shared/scaffoldTools.ts:319
- `clone_and_modify` â€” packages/agents/src/shared/scaffoldTools.ts:347
- `Alice` â€” packages/agents/src/shared/scaffoldTools.ts:72
- `Alice` â€” packages/agents/src/shared/scaffoldTools.ts:73

#### packages/agents/src/shared/screenshotTools.ts

- `compare_screenshots` â€” packages/agents/src/shared/screenshotTools.ts:166
- `check_responsive` â€” packages/agents/src/shared/screenshotTools.ts:206
- `screenshot_component` â€” packages/agents/src/shared/screenshotTools.ts:87

#### packages/agents/src/shared/seoTools.ts

- `track_keyword_rankings` â€” packages/agents/src/shared/seoTools.ts:139
- `analyze_page_seo` â€” packages/agents/src/shared/seoTools.ts:251
- `get_indexing_status` â€” packages/agents/src/shared/seoTools.ts:369
- `submit_sitemap` â€” packages/agents/src/shared/seoTools.ts:446
- `update_seo_data` â€” packages/agents/src/shared/seoTools.ts:509
- `get_backlink_profile` â€” packages/agents/src/shared/seoTools.ts:569

#### packages/agents/src/shared/sharepointTools.ts

- `read_sharepoint_document` â€” packages/agents/src/shared/sharepointTools.ts:148
- `upload_to_sharepoint` â€” packages/agents/src/shared/sharepointTools.ts:21
- `search_sharepoint` â€” packages/agents/src/shared/sharepointTools.ts:92

#### packages/agents/src/shared/slackOutputTools.ts

- `post_to_slack` â€” packages/agents/src/shared/slackOutputTools.ts:189
- `request_slack_approval` â€” packages/agents/src/shared/slackOutputTools.ts:291

#### packages/agents/src/shared/socialMediaTools.ts

- `get_scheduled_posts` â€” packages/agents/src/shared/socialMediaTools.ts:628
- `get_social_metrics` â€” packages/agents/src/shared/socialMediaTools.ts:696
- `get_post_performance` â€” packages/agents/src/shared/socialMediaTools.ts:750
- `get_social_audience` â€” packages/agents/src/shared/socialMediaTools.ts:804
- `reply_to_social` â€” packages/agents/src/shared/socialMediaTools.ts:871
- `get_trending_topics` â€” packages/agents/src/shared/socialMediaTools.ts:942

#### packages/agents/src/shared/storybookTools.ts

- `storybook_screenshot_all` â€” packages/agents/src/shared/storybookTools.ts:137
- `storybook_visual_diff` â€” packages/agents/src/shared/storybookTools.ts:208
- `storybook_save_baseline` â€” packages/agents/src/shared/storybookTools.ts:269
- `storybook_check_coverage` â€” packages/agents/src/shared/storybookTools.ts:362
- `storybook_get_story_source` â€” packages/agents/src/shared/storybookTools.ts:431
- `storybook_list_stories` â€” packages/agents/src/shared/storybookTools.ts:58
- `storybook_screenshot` â€” packages/agents/src/shared/storybookTools.ts:78

#### packages/agents/src/shared/teamOrchestrationTools.ts

- `assign_team_task` â€” packages/agents/src/shared/teamOrchestrationTools.ts:150
- `create_sub_team_assignment` â€” packages/agents/src/shared/teamOrchestrationTools.ts:310
- `review_team_output` â€” packages/agents/src/shared/teamOrchestrationTools.ts:490
- `notify_founders` â€” packages/agents/src/shared/teamOrchestrationTools.ts:671
- `check_team_status` â€” packages/agents/src/shared/teamOrchestrationTools.ts:759
- `check_team_assignments` â€” packages/agents/src/shared/teamOrchestrationTools.ts:788
- `escalate_to_sarah` â€” packages/agents/src/shared/teamOrchestrationTools.ts:816

#### packages/agents/src/shared/teamsOutputTools.ts

- `post_to_customer_teams` â€” packages/agents/src/shared/teamsOutputTools.ts:283
- `request_teams_approval` â€” packages/agents/src/shared/teamsOutputTools.ts:365

#### packages/agents/src/shared/toolRegistryTools.ts

- `register_tool` â€” packages/agents/src/shared/toolRegistryTools.ts:180
- `deactivate_tool` â€” packages/agents/src/shared/toolRegistryTools.ts:339
- `list_registered_tools` â€” packages/agents/src/shared/toolRegistryTools.ts:384
- `list_tool_requests` â€” packages/agents/src/shared/toolRegistryTools.ts:44
- `review_tool_request` â€” packages/agents/src/shared/toolRegistryTools.ts:88

#### packages/agents/src/shared/toolRequestTools.ts

- `check_tool_access` â€” packages/agents/src/shared/toolRequestTools.ts:336
- `request_new_tool` â€” packages/agents/src/shared/toolRequestTools.ts:440
- `check_tool_request_status` â€” packages/agents/src/shared/toolRequestTools.ts:705
- `request_tool_access` â€” packages/agents/src/shared/toolRequestTools.ts:738

#### packages/agents/src/shared/userResearchTools.ts

- `get_survey_results` â€” packages/agents/src/shared/userResearchTools.ts:100
- `analyze_support_tickets` â€” packages/agents/src/shared/userResearchTools.ts:159
- `get_user_feedback` â€” packages/agents/src/shared/userResearchTools.ts:256
- `create_survey` â€” packages/agents/src/shared/userResearchTools.ts:33
- `create_user_persona` â€” packages/agents/src/shared/userResearchTools.ts:351

#### packages/agents/src/shared/videoCreationTools.ts

- `generate_image` â€” packages/agents/src/shared/videoCreationTools.ts:129
- `generate_video` â€” packages/agents/src/shared/videoCreationTools.ts:205
- `poll_video_status` â€” packages/agents/src/shared/videoCreationTools.ts:297
- `generate_voiceover` â€” packages/agents/src/shared/videoCreationTools.ts:359
- `generate_sfx` â€” packages/agents/src/shared/videoCreationTools.ts:429
- `generate_music` â€” packages/agents/src/shared/videoCreationTools.ts:490
- `enhance_video_prompt` â€” packages/agents/src/shared/videoCreationTools.ts:551

#### packages/agents/src/shared/webBuildTools.ts

- `invoke_web_upgrade` â€” packages/agents/src/shared/webBuildTools.ts:2101
- `search_components` â€” packages/agents/src/shared/webBuildTools.ts:2460
- `get_component_info` â€” packages/agents/src/shared/webBuildTools.ts:2471
- `get_installation_info` â€” packages/agents/src/shared/webBuildTools.ts:2482
- `install_item_from_registry` â€” packages/agents/src/shared/webBuildTools.ts:2498
- `button` â€” packages/agents/src/shared/webBuildTools.ts:2534
- `card` â€” packages/agents/src/shared/webBuildTools.ts:2535
- `tabs` â€” packages/agents/src/shared/webBuildTools.ts:2536
- `dialog` â€” packages/agents/src/shared/webBuildTools.ts:2537
- `particles` â€” packages/agents/src/shared/webBuildTools.ts:2540
- `spotlight` â€” packages/agents/src/shared/webBuildTools.ts:2541

#### packages/agents/src/shared/websiteIngestionTools.ts

- `scrape_website` â€” packages/agents/src/shared/websiteIngestionTools.ts:153



### 3. Tools Granted to Roles But Never Actually Called

Tools that appear in baseline/grant migrations but have minimal evidence of production usage.
This section requires deep call-site analysis; below are candidates based on absence from
agent-runtime production paths and test files.

**Suspected count**: 81 tools

Sample (first 50):

- `plan_website_build` â€” granted via baseline, declared at packages/agents/src/shared/webBuildPlannerTools.ts:225
- `invoke_web_iterate` â€” granted via baseline, declared at packages/agents/src/shared/webBuildTools.ts:1885
- `github_create_from_template` â€” granted via baseline (definition not found in scanned files)
- `github_list_branches` â€” granted via baseline (definition not found in scanned files)
- `vercel_get_preview_url` â€” granted via baseline (definition not found in scanned files)
- `list_my_tools` â€” granted via baseline, declared at packages/agents/src/shared/toolRequestTools.ts:207
- `tool_search` â€” granted via baseline, declared at packages/agents/src/shared/toolRequestTools.ts:279
- `invoke_web_coding_loop` â€” granted via baseline, declared at packages/agents/src/shared/webBuildTools.ts:1937
- `github_merge_pull_request` â€” granted via baseline (definition not found in scanned files)
- `github_get_pull_request_status` â€” granted via baseline (definition not found in scanned files)
- `github_wait_for_pull_request_checks` â€” granted via baseline (definition not found in scanned files)
- `vercel_wait_for_preview_ready` â€” granted via baseline (definition not found in scanned files)
- `vercel_get_production_url` â€” granted via baseline (definition not found in scanned files)
- `vercel_get_deployment_logs` â€” granted via baseline (definition not found in scanned files)
- `get_file_contents` â€” granted via baseline (definition not found in scanned files)
- `list_open_prs` â€” granted via baseline (definition not found in scanned files)
- `comment_on_pr` â€” granted via baseline (definition not found in scanned files)
- `screenshot_page` â€” granted via baseline, declared at packages/agents/src/shared/screenshotTools.ts:34
- `run_accessibility_audit` â€” granted via baseline, declared at packages/agents/src/shared/auditTools.ts:137
- `check_ai_smell` â€” granted via baseline, declared at packages/agents/src/shared/auditTools.ts:229
- `read_inbox` â€” granted via baseline (definition not found in scanned files)
- `reply_to_email` â€” granted via baseline (definition not found in scanned files)
- `create_git_branch` â€” granted via baseline, declared at packages/agents/src/shared/frontendCodeTools.ts:299
- `get_pending_decisions` â€” granted via baseline (definition not found in scanned files)
- `get_infrastructure_costs` â€” granted via baseline (definition not found in scanned files)
- `create_github_issue` â€” granted via baseline (definition not found in scanned files)
- `get_ci_health` â€” granted via baseline (definition not found in scanned files)
- `get_github_pr_status` â€” granted via baseline (definition not found in scanned files)
- `send_email` â€” granted via baseline (definition not found in scanned files)
- `retry_failed_run` â€” granted via baseline (definition not found in scanned files)
- `query_agent_runs` â€” granted via baseline (definition not found in scanned files)
- `query_cost_trends` â€” granted via baseline (definition not found in scanned files)
- `query_events_backlog` â€” granted via baseline (definition not found in scanned files)
- `get_financials` â€” granted via baseline (definition not found in scanned files)
- `query_stripe_mrr` â€” granted via baseline (definition not found in scanned files)
- `query_stripe_subscriptions` â€” granted via baseline (definition not found in scanned files)
- `write_financial_report` â€” granted via baseline (definition not found in scanned files)
- `calculate_unit_economics` â€” granted via baseline (definition not found in scanned files)
- `get_product_metrics` â€” granted via baseline (definition not found in scanned files)
- `write_product_analysis` â€” granted via baseline (definition not found in scanned files)
- `query_analytics_events` â€” granted via baseline (definition not found in scanned files)
- `get_usage_metrics` â€” granted via baseline, declared at packages/agents/src/shared/productAnalyticsTools.ts:20
- `get_roadmap` â€” granted via baseline, declared at packages/agents/src/shared/roadmapTools.ts:172
- `segment_users` â€” granted via baseline, declared at packages/agents/src/shared/productAnalyticsTools.ts:387
- `get_competitor_profile` â€” granted via baseline, declared at packages/agents/src/shared/competitiveIntelTools.ts:93
- `write_content` â€” granted via baseline (definition not found in scanned files)
- `write_company_memory` â€” granted via baseline (definition not found in scanned files)
- `save_research` â€” granted via baseline, declared at packages/agents/src/shared/researchRepoTools.ts:19
- `search_research` â€” granted via baseline, declared at packages/agents/src/shared/researchRepoTools.ts:92
- `deep_research` â€” granted via baseline (definition not found in scanned files)

**Note**: Full call-site analysis would require tracing each tool name through all TypeScript
files in packages/scheduler, packages/worker, services/*, and packages/agent-runtime.



### 4. Schema vs Implementation Drift

Cases where tool parameter declarations don't match what execute() actually uses.
Analysis limited to clear-cut examples to avoid false positives.

**Count**: 5 clear-cut cases identified

#### 1. send_agent_message

- **File**: packages/agents/src/shared/communicationTools.ts
- **Parameters declaration**: line 153
- **Execute function**: line 159
- **Issue**: Parameters declare 'thread_id' (line 153-156) but execute() never reads it; only used for deduplication check (line 191-200)

#### 2. web_fetch

- **File**: packages/agents/src/shared/researchTools.ts
- **Parameters declaration**: line 88
- **Execute function**: line 93
- **Issue**: Parameter 'max_length' declared (line 88-90) but execute uses hard-coded slice(0, maxLength) with default 8000 (line 150)

#### 3. deploy_preview

- **File**: packages/agents/src/shared/deployPreviewTools.ts
- **Parameters declaration**: line 52
- **Execute function**: line 58
- **Issue**: Parameter 'project' has default 'dashboard' in execute (line 72-73) but not declared as optional in parameters schema (line 52, required: false)

#### 4. read_my_assignments

- **File**: packages/agents/src/shared/assignmentTools.ts
- **Parameters declaration**: line 92
- **Execute function**: line 99
- **Issue**: Parameter 'status' declared as enum (line 96) but execute() destructures and checks with statusFilter logic (line 100-110) that treats missing status differently than explicit null

#### 5. save_memory

- **File**: packages/agents/src/shared/memoryTools.ts
- **Parameters declaration**: line 64
- **Execute function**: line 71
- **Issue**: Parameters declare 'tags' as array (line 64-68) but execute reads as (params.tags as string[]) ?? undefined (line 96), treating undefined distinctly from empty array

**Recommendation**: Comprehensive schema-drift detection requires AST parsing of each tool's
parameters block and execute() body to compare declared vs. used parameters. The above cases
were manually identified from code review.



### 5. Tools That Bypass ToolExecutor

Tool execute() functions that make direct provider calls rather than routing through
centralized clients. ToolExecutor (packages/agent-runtime/src/toolExecutor.ts) wraps
all tool.execute() calls with authorization, rate limiting, and telemetry. However, some
tools make outbound provider calls (HTTP, SDK clients, child processes) from within their
execute() body, bypassing centralized client infrastructure.

**Total cases found**: 100

#### Breakdown by Pattern

- **fetch\(**: 98 occurrences
- **@google-cloud/**: 1 occurrences
- **googleapis**: 1 occurrences

#### Sample Cases (first 50)

| Tool File | Line | Pattern | Context |
|-----------|------|---------|---------|
| packages/agents/src/shared/agent365Tools.ts | 239 | `fetch\(` | const driveRes = await fetch(... |
| packages/agents/src/shared/agent365Tools.ts | 249 | `fetch\(` | const metaRes = await fetch(... |
| packages/agents/src/shared/agent365Tools.ts | 257 | `fetch\(` | const searchRes = await fetch(... |
| packages/agents/src/shared/agent365Tools.ts | 268 | `fetch\(` | const contentRes = await fetch(... |
| packages/agents/src/shared/agent365Tools.ts | 282 | `fetch\(` | const contentRes = await fetch(... |
| packages/agents/src/shared/agent365Tools.ts | 424 | `fetch\(` | const response = await fetch(... |
| packages/agents/src/shared/assetTools.ts | 107 | `fetch\(` | const res = await fetch(imageUrl, { signal: AbortSignal.time... |
| packages/agents/src/shared/assetTools.ts | 323 | `fetch\(` | const res = await fetch(`${serviceUrl.replace(/\/+$/, '')}/u... |
| packages/agents/src/shared/assetTools.ts | 850 | `fetch\(` | const res = await fetch(`${serviceUrl.replace(/\/+$/, '')}/l... |
| packages/agents/src/shared/assetTools.ts | 919 | `fetch\(` | const res = await fetch(`${screenshotUrl}/optimize`, {... |
| packages/agents/src/shared/assetTools.ts | 964 | `fetch\(` | const res = await fetch(`${screenshotUrl}/favicon-set`, {... |
| packages/agents/src/shared/assignmentTools.ts | 62 | `fetch\(` | fetch(`${schedulerUrl}/run`, {... |
| packages/agents/src/shared/auditTools.ts | 87 | `fetch\(` | const res = await fetch(apiUrl, { signal: AbortSignal.timeou... |
| packages/agents/src/shared/auditTools.ts | 153 | `fetch\(` | const res = await fetch(`${serviceUrl}/audit`, {... |
| packages/agents/src/shared/auditTools.ts | 250 | `fetch\(` | const res = await fetch(`${serviceUrl}/screenshot`, {... |
| packages/agents/src/shared/auditTools.ts | 267 | `fetch\(` | const res = await fetch(url, {... |
| packages/agents/src/shared/auditTools.ts | 360 | `fetch\(` | const res = await fetch(`${serviceUrl}/screenshot`, {... |
| packages/agents/src/shared/auditTools.ts | 85 | `googleapis` | const apiUrl = `https://www.googleapis.com/pagespeedonline/v... |
| packages/agents/src/shared/canvaTools.ts | 39 | `fetch\(` | const res = await fetch(CANVA_TOKEN_URL, {... |
| packages/agents/src/shared/canvaTools.ts | 54 | `fetch\(` | async function canvaFetch(path: string, options: RequestInit... |
| packages/agents/src/shared/canvaTools.ts | 56 | `fetch\(` | return fetch(`${CANVA_API}${path}`, {... |
| packages/agents/src/shared/canvaTools.ts | 91 | `fetch\(` | const res = await canvaFetch('/designs', { method: 'POST', b... |
| packages/agents/src/shared/canvaTools.ts | 112 | `fetch\(` | const res = await canvaFetch(`/designs/${encodeURIComponent(... |
| packages/agents/src/shared/canvaTools.ts | 134 | `fetch\(` | const res = await canvaFetch(`/designs${qs}`);... |
| packages/agents/src/shared/canvaTools.ts | 155 | `fetch\(` | const res = await canvaFetch('/brand-templates');... |
| packages/agents/src/shared/canvaTools.ts | 176 | `fetch\(` | const res = await canvaFetch(`/brand-templates/${encodeURICo... |
| packages/agents/src/shared/canvaTools.ts | 208 | `fetch\(` | const dsRes = await canvaFetch(`/brand-templates/${encodeURI... |
| packages/agents/src/shared/canvaTools.ts | 224 | `fetch\(` | const res = await canvaFetch('/autofills', { method: 'POST',... |
| packages/agents/src/shared/canvaTools.ts | 232 | `fetch\(` | const pollRes = await canvaFetch(`/autofills/${encodeURIComp... |
| packages/agents/src/shared/canvaTools.ts | 263 | `fetch\(` | const res = await canvaFetch('/exports', {... |
| packages/agents/src/shared/canvaTools.ts | 273 | `fetch\(` | const pollRes = await canvaFetch(`/exports/${encodeURICompon... |
| packages/agents/src/shared/canvaTools.ts | 306 | `fetch\(` | const imgRes = await fetch(imageUrl, { signal: AbortSignal.t... |
| packages/agents/src/shared/canvaTools.ts | 316 | `fetch\(` | const uploadRes = await fetch(`${CANVA_API}/asset-uploads`, ... |
| packages/agents/src/shared/canvaTools.ts | 328 | `fetch\(` | const pollRes = await canvaFetch(`/asset-uploads/${encodeURI... |
| packages/agents/src/shared/cashFlowTools.ts | 15 | `fetch\(` | async function mercuryFetch(path: string): Promise<Record<st... |
| packages/agents/src/shared/cashFlowTools.ts | 18 | `fetch\(` | const res = await fetch(`https://api.mercury.com/api/v1${pat... |
| packages/agents/src/shared/cashFlowTools.ts | 35 | `fetch\(` | const data = await mercuryFetch('/accounts');... |
| packages/agents/src/shared/cashFlowTools.ts | 53 | `fetch\(` | const pending = await mercuryFetch('/transactions?status=pen... |
| packages/agents/src/shared/cashFlowTools.ts | 182 | `fetch\(` | const data = await mercuryFetch('/transactions?status=pendin... |
| packages/agents/src/shared/codexTools.ts | 28 | `fetch\(` | const response = await fetch(getCodexMcpUrl(), {... |
| packages/agents/src/shared/communicationTools.ts | 559 | `fetch\(` | const response = await fetch(`${url}/meetings/call`, {... |
| packages/agents/src/shared/deployPreviewTools.ts | 105 | `fetch\(` | const res = await fetch(`${hookUrl}?ref=${encodeURIComponent... |
| packages/agents/src/shared/dmTools.ts | 116 | `fetch\(` | const res = await fetch(... |
| packages/agents/src/shared/documentTools.ts | 380 | `fetch\(` | const res = await fetch(`${serviceUrl}/pdf`, {... |
| packages/agents/src/shared/emailMarketingTools.ts | 36 | `fetch\(` | async function mailchimpFetch(path: string, options: Request... |
| packages/agents/src/shared/emailMarketingTools.ts | 38 | `fetch\(` | const res = await fetch(`https://${server}.api.mailchimp.com... |
| packages/agents/src/shared/emailMarketingTools.ts | 57 | `fetch\(` | async function mandrillFetch(endpoint: string, body: Record<... |
| packages/agents/src/shared/emailMarketingTools.ts | 59 | `fetch\(` | const res = await fetch(`https://mandrillapp.com/api/1.0${en... |
| packages/agents/src/shared/emailMarketingTools.ts | 89 | `fetch\(` | const data = await mailchimpFetch(`/lists?count=${count}`);... |
| packages/agents/src/shared/emailMarketingTools.ts | 135 | `fetch\(` | const data = await mailchimpFetch(`/lists/${listId}/members?... |

#### Analysis

Common patterns:
- **fetch()**: Direct HTTP calls to external APIs (Vercel, GitHub, web scraping)
- **.query()**: Direct database queries (systemQuery calls)
- **axios**: HTTP client for provider APIs
- **SDK clients**: Direct instantiation of provider SDKs

**Recommendation**: Consider routing provider calls through centralized clients that
implement connection pooling, retry logic, circuit breaking, and telemetry. Direct calls
in tool execute() bodies work but miss these benefits.



### Appendix: Methodology

#### Tool Enumeration
- Scanned all 70 *Tools.ts files in packages/agents/src/shared/
- Extracted 377 tool definitions via regex pattern: `name:\s*['"][a-z_][a-z_0-9]*['"]`
- Identified 371 unique tool names

#### Grant Sources
- **criticalRoleToolBaseline.ts**: BASELINE_BY_ROLE map with 93 tools across 4 critical roles
- **live-role-tool-requirements.json**: JSON config with 114 total granted tools (critical + warn_only roles)
- **Database migrations**: 32 migration files containing INSERT INTO agent_tool_grants statements
- **Total granted**: 114 unique tools (union of all sources)

#### Production Invocation Detection
Searched for tool name string literals in:
- packages/scheduler/src/*.ts
- packages/worker/src/*.ts
- packages/agent-runtime/src/baseAgentRunner.ts, companyAgentRunner.ts, toolExecutor.ts
- services/*/src/*.ts

#### Eval Coverage Detection
Searched for tool names in:
- packages/**/*.test.ts (96 test files found)
- db/migrations/*eval*.sql, *tool_test*.sql
- scripts/eval*.ts

#### Schema Drift Detection
Manual code review of tool parameters blocks vs. execute() function bodies.
Automated detection would require AST parsing.

#### Provider Bypass Detection
Regex patterns: `fetch\(`, `axios\.`, `new OpenAI\(`, `new Anthropic\(`,
`@google-cloud/`, `googleapis`, `@slack/web-api`, `child_process`, `\.query\(`

---

**Report generated on**: 2026-04-27 17:02:49

---

## Section 04 -- Gate & Policy Stack -- Reality vs. Doc

`ToolExecutor.execute` actually fires ~31 gates between request entry and dispatch; the documented chain names 8. A typical on-demand chat read fires ~17 gates with zero LLM calls. The constitutional pre-check is wrapped in a `try/catch` at `toolExecutor.ts:1505-1548` that silently proceeds on missing governor or thrown error -- high-stakes tools fail-open. `ENABLE_TOOL_RESULT_CACHE` and `AGENT_TRACING_ENABLED` are unset in every deploy config; the value gate is off for chat and reactive-light tasks by default.

See: [section-04-gates.md](diagnostic-2026-04-27/section-04-gates.md)


Scope: verify the documented gate chain
`block/grant -> budget -> constitutional pre-check -> evidence gate -> verifier -> execute -> optional read-back -> reputation tracking`
against `packages/agent-runtime/src/toolExecutor.ts` (`ToolExecutor.execute`,
[`packages/agent-runtime/src/toolExecutor.ts:882`](../../packages/agent-runtime/src/toolExecutor.ts#L882)).

All line numbers refer to `packages/agent-runtime/src/toolExecutor.ts` unless
otherwise noted.

---

### 4.1 Gate-by-gate map (in execution order)

The table below lists every gate that fires inside `ToolExecutor.execute()`
between request entry and tool dispatch. It is much wider than the doc's
8-step chain â€” the documented chain is a (partially-correct) summary.

| # | Gate | File:line | Wired into ToolExecutor? | Activates when | LLM calls / invocation | Latency (best evidence) |
|---|------|-----------|--------------------------|----------------|-----------------------|-------------------------|
| 1 | Action-risk classification (`classifyActionRisk`) | `toolExecutor.ts:893` calling `actionRiskClassifier.ts` | Yes (sets `riskAssessment.level`) | Every call | 0 | Pure regex/lookup, sub-ms |
| 2 | **block/grant + emergency block** (`authorizeToolExecution`) | `toolExecutor.ts:907-930` â†’ `runtimeExecutionPolicy.ts` | Yes | `enforcementEnabled === true` (default) | 0 | Policy cache lookup, sub-ms after warmup |
| 3 | Planning-phase read-only gate | `toolExecutor.ts:1012-1024` | Yes | `context.runPhase === 'planning'` & not read-only tool | 0 | sub-ms |
| 4 | Global circuit breaker / fleet halt (`shouldBlockToolCall`) | `toolExecutor.ts:1029` â†’ `circuitBreaker.ts:147` | Yes | Always (cached `system_config` lookup) | 0 | Cached, sub-ms after first call; first call 1 DB query |
| 5 | Denial-tracking circuit breaker (`isToolRunBlocked`, `evaluateEscalation`) | `toolExecutor.ts:1046-1078` â†’ `denialTracking.ts` | Yes | Per-run accumulated denials > threshold | 0 | In-memory, sub-ms |
| 6 | Policy-limits gate (`checkToolPolicy`) | `toolExecutor.ts:1083` â†’ `policyLimits.ts` | Yes | `this.policyCache` is populated | 0 | In-memory cache, sub-ms |
| 7 | buildTool role filter (`isToolPermittedForRole`) | `toolExecutor.ts:1105` â†’ `buildTool.ts` | Yes | Tool was registered via `buildTool` with role list | 0 | sub-ms |
| 8 | HARD_GATE block (founder-approval-required tools) | `toolExecutor.ts:1116-1170` | Yes | `riskAssessment.level === 'HARD_GATE'` | 0 | sub-ms |
| 9 | Param normalize/validate (`normalizeAndValidateToolParams`) | `toolExecutor.ts:1172` | Yes | Every call | 0 | sub-ms |
| 10 | Scope-mismatch gate (`hasContextScopeMismatch`) | `toolExecutor.ts:1184` â†’ defined `:653` | Yes | Params claim a different agent/run scope | 0 | sub-ms |
| 11 | Disclosure policy (`applyDisclosurePolicy`) | `toolExecutor.ts:1207-1248` â†’ `disclosure.ts` | Yes | `classifyDisclosureTarget` matches (external email/DM tools) | 0 (deterministic policy) | sub-ms |
| 12 | Capacity-tier / commitments (`enforceCapacityTier`) | `toolExecutor.ts:1251` (imported from `@glyphor/shared`) | Yes | Tool maps to a capacity action via `buildCapacityAction` | 0 | DB lookup; tens of ms |
| 13 | Pre-tool hooks (composite: in-process + HTTP) | `toolExecutor.ts:1310` â†’ `hooks/hookRunner.ts` | Yes | Tool has hook config or global hook URL set | 0 by default; depends on hook | HTTP hook adds round-trip |
| 14 | Rate limit (`checkRateLimit`) | `toolExecutor.ts:1354` | Yes | `enforcementEnabled` | 0 | sub-ms |
| 15 | **Budget check (heuristic)** (`wouldExceedBudget`) | `toolExecutor.ts:1367` | Yes | `enforcementEnabled` | 0 | sub-ms |
| 16 | Per-run tool retry cap | `toolExecutor.ts:1385` (cap from `TOOL_RETRY_CAP`, env, default 5) | Yes | Same tool failed â‰¥ 5 times in run | 0 | sub-ms |
| 17 | Behavioral-fingerprint anomaly (`detectBehavioralAnomalies`) | `toolExecutor.ts:1408` â†’ `behavioralFingerprint.ts` | Yes | `enforcementEnabled` & profile loaded | 0 | DB read for profile (cached), few ms |
| 18 | Formal budget verifier (`FormalVerifier.verifyBudgetConstraint`) | `toolExecutor.ts:1432-1450` | Yes (only if `formalVerifier` injected in ctor `:694`) | Write tool & a `FormalVerifier` instance is present | 0 (Z3-style symbolic) | sub-ms |
| 19 | Pre-execution value gate (`evaluateActionValue`) | `toolExecutor.ts:1463-1498` | Yes | Write tool *or* non-AUTONOMOUS risk; **AND not** `on_demand` (default) **AND not** reactive-light scheduled task (default). See Â§4.3 for kill switches | 0 (heuristic) | sub-ms |
| 20 | **Constitutional pre-check** (`preCheckTool`) | `toolExecutor.ts:1504-1549` â†’ `constitutionalPreCheck.ts:372` | Yes | Tool âˆˆ `HIGH_STAKES_TOOLS` (`constitutionalPreCheck.ts:29`: `create_or_update_file`, `apply_patch_call`, `create_branch`, `register_tool`, `create_specialist_agent`, `grant_tool_access`) AND constitution loaded | **0 for the 6 high-stakes tools above** (deterministic only, see `constitutionalPreCheck.ts:306` â€” LLM phase early-returns unless tool âˆˆ `EXTERNAL_COMMUNICATION_TOOLS = {submit_assignment_output}`). For `submit_assignment_output`: **1 LLM call** (PRE_CHECK_MODEL = tier `default`) â€” cached in Redis 5 min (`constitutionalPreCheck.ts:26`) | Cached: <50 ms; cold LLM call: 1-3 s |
| 21 | **Data-evidence gate** | `toolExecutor.ts:1556-1596` | Yes | Tool âˆˆ `DATA_EVIDENCE_REQUIRED` (`:535`: `create_decision`, `write_pipeline_report`, `create_status_report`, `create_research_brief`) | 0 | sub-ms (scans `this.callLog`) |
| 22 | Dry-run intercept | `toolExecutor.ts:1599-1611` | Yes | `this.dryRun` ctor flag & not read-only | 0 | sub-ms |
| 23 | **Cross-agent verifier** (`VerifierRunner.verifyToolCall`) | `toolExecutor.ts:1614-1650` â†’ `verifierRunner.ts:125` | Yes (only if `modelClient` injected â€” `:711`) | Tool âˆˆ `CROSS_AGENT_VERIFICATION_TOOLS` (`:518`: HIGH_STAKES_TOOLS âˆª `submit_assignment_output`, `send_dm`, `send_teams_dm`, `create_calendar_event`, MCP CreateEvent variants, `revoke_tool_access`) | **1 LLM call** to a *different-provider* model (`getVerifierFor`) â€” uncached | 1.5-4 s typical |
| 24 | Per-run read-only result cache (short-circuit) | `toolExecutor.ts:1675-1699` â†’ `perRunToolCache.ts` | Yes | `ENABLE_TOOL_RESULT_CACHE` env truthy AND `isCacheableReadOnlyTool` | 0 | sub-ms hit; bypasses everything below |
| 25 | ABAC middleware (wraps execute) | `toolExecutor.ts:1743-1754` â†’ `abac.ts` | Yes | Every call (when reached) | 0 | sub-ms |
| 26 | **Tool execute** (with timeout, abort, transient retry) | `toolExecutor.ts:1723-1782` | Yes | Always | 0 in-runtime (the tool itself may make external calls) | Per-tool |
| 27 | Predictions journaling | `toolExecutor.ts:1811-1823` | Yes | success & data has prediction shape | 0 | DB insert |
| 28 | Evidence ledger record (`recordEvidence`) | `toolExecutor.ts:1826-1853` â†’ `telemetry/runLedger.ts` | Yes | success & substantive data | 0 | Async DB insert; not blocking |
| 29 | **Read-back verification** (post-write) | `toolExecutor.ts:1856-1873` | Yes | `isMutation(toolName)` & success & `VERIFICATION_MAP[toolName]` defined (`:572`: only 6 update_* tools) | 0 (it re-enters `this.execute` for the read counterpart, which itself runs every gate again) | One full extra tool round-trip |
| 30 | Post-tool hooks | `toolExecutor.ts:1919+` | Yes | Symmetric with #13 | 0 by default | â€” |
| 31 | **Reputation tracking** (`recordToolCall`) | `toolExecutor.ts:1904`, `:1941`, etc. â†’ `toolReputationTracker.ts` | Yes | Always (fire-and-forget) | 0 | Async, non-blocking |

#### Doc gates that ARE wired

- **block/grant** âœ“ (#2)
- **budget** âœ“ (#15 heuristic + #18 formal)
- **constitutional pre-check** âœ“ (#20) â€” but LLM phase is *only* for `submit_assignment_output`; the other 6 high-stakes tools get deterministic regex only
- **evidence gate** âœ“ (#21)
- **verifier** âœ“ (#23)
- **execute** âœ“ (#26)
- **optional read-back** âœ“ (#29) â€” narrow: only 6 update_* tools have a `VERIFICATION_MAP` entry
- **reputation tracking** âœ“ (#31)

#### Doc gates that are NOT in ToolExecutor

None claimed by the doc are missing, but the doc grossly under-counts: ~20
additional gates run that aren't in the documented chain (planning gate,
denial-tracking, policy limits, capacity tier, hooksÃ—2, ABAC, behavioral
anomaly, dry-run, scope mismatch, disclosure, value gate, retry cap, etc.).
These are real gates with deny outcomes.

The doc also claims ordering `budget â†’ constitutional â†’ evidence â†’ verifier`.
Actual ordering is `budget (#15) â†’ formal-budget (#18) â†’ value-gate (#19) â†’
constitutional (#20) â†’ evidence (#21) â†’ verifier (#23)`. So the value gate is
sandwiched between budget and constitutional pre-check and is undocumented.

---

### 4.2 How many gates fire on a typical chat tool call?

**Definition of "typical on-demand chat":** `context.requestSource === 'on_demand'`
(set in `companyAgentRunner.ts:2042`), tool is read-only, not high-stakes,
not in any of the special sets. Example: `get_company_vitals`.

Walking the code path with `enforcementEnabled = true` and no policy cache miss:

1. (#1) `classifyActionRisk` â€” fires
2. (#2) `authorizeToolExecution` â€” fires (block/grant)
3. (#3) Planning gate â€” skipped (`runPhase !== 'planning'`)
4. (#4) Circuit breaker â€” fires (returns not-blocked)
5. (#5) Denial tracking â€” fires (returns not-blocked)
6. (#6) Policy limits â€” fires *iff* `policyCache` set; typically yes
7. (#7) Role filter â€” fires
8. (#8) HARD_GATE â€” skipped (level â‰  HARD_GATE for read-only)
9. (#9) Param validation â€” fires
10. (#10) Scope mismatch â€” fires (returns null)
11. (#11) Disclosure â€” skipped (no email/DM target)
12. (#12) Capacity tier â€” fires (no-op for reads typically, but called)
13. (#13) Pre-tool hooks â€” fires (default composite hookRunner runs even with no hooks â†’ no-op deny check)
14. (#14) Rate limit â€” fires
15. (#15) Budget check â€” fires
16. (#16) Retry cap â€” fires
17. (#17) Behavioral anomaly â€” fires
18. (#18) Formal budget verifier â€” **skipped** (read-only, `:1432`)
19. (#19) Value gate â€” **skipped** because `requestSource === 'on_demand'` and `VALUE_GATE_ENFORCE_ON_DEMAND` is false by default (`:1452-1465`)
20. (#20) Constitutional pre-check â€” **skipped** (not in `HIGH_STAKES_TOOLS`)
21. (#21) Data-evidence â€” **skipped** (not in `DATA_EVIDENCE_REQUIRED`)
22. (#22) Dry-run â€” skipped
23. (#23) Cross-agent verifier â€” **skipped** (not in `CROSS_AGENT_VERIFICATION_TOOLS`)
24. (#24) Per-run cache â€” *only* if `ENABLE_TOOL_RESULT_CACHE` env set (default off). With default config, skipped.
25. (#25) ABAC middleware â€” fires (wraps execute)
26. (#26) Execute â€” fires
27. (#28) Evidence record â€” fires (success path)
28. (#29) Read-back â€” **skipped** (read-only, not in `VERIFICATION_MAP`)
29. (#31) Reputation tracking â€” fires

**Tally: ~17 gates execute on a typical chat read tool call. 0 LLM calls.**

For a **chat write** tool (e.g. `update_roadmap_item`): add #18 formal-budget,
add #29 read-back (which itself triggers another full pass for the read tool).
Value gate is still skipped on-demand by default. Constitutional/verifier
still skipped unless tool is in those sets. â‡’ ~19 gates, 0 LLM calls â€” unless
the tool happens to be `submit_assignment_output` (then +1 LLM in #20 + 1 LLM
in #23) or any other CROSS_AGENT_VERIFICATION tool (+1 LLM in #23).

### 4.3 How many gates fire on a typical scheduled task tool call?

`context.requestSource === 'scheduled'` (`companyAgentRunner.ts:2042`,
`baseAgentRunner.ts:1288`). Two cases:

**(a) Reactive-light task** (`task âˆˆ {'urgent_message_response',
'incident_response', 'event_message_sent'}`, `taskClassPolicy.ts:9`):
Same as chat: value gate is skipped because
`shouldSkipValueGateForReactiveLightTask()` returns true by default
(`taskClassPolicy.ts:20-24`, kill-switched on `TOOL_VALUE_GATE_REACTIVE_LIGHT=enforce`).
â‡’ same count as chat (~17 read / ~19 write).

**(b) Standard scheduled task with a write tool**: value gate (#19) **does**
fire (`:1463`). Everything else identical to a chat write. Value gate is
heuristic, no LLM. So ~20 gates, 0 LLM calls (unless tool is in
high-stakes/cross-agent sets).

For a high-stakes scheduled tool like `create_or_update_file`:
- Constitutional pre-check (#20) runs â†’ deterministic only, **0 LLM**
  (`constitutionalPreCheck.ts:306`).
- Cross-agent verifier (#23) runs â†’ **1 LLM call** to verifier model.
- Value gate runs â†’ 0 LLM.
â‡’ ~22 gates, **1 LLM call**.

For `submit_assignment_output` on a schedule:
- Constitutional pre-check (#20) â†’ **1 LLM** (cached, `EXTERNAL_COMMUNICATION_TOOLS`).
- Cross-agent verifier (#23) â†’ **1 LLM** (uncached).
â‡’ ~22 gates, **2 LLM calls** (one cached).

---

### 4.4 Kill switches & current values

All gate kill switches found by grepping `process.env.*` in
`packages/agent-runtime/src/`. Cross-checked against deployment configs
(`cloudbuild-*.yaml`, `infra/`, `services/`, `workers/`,
`packages/shared/src/config*`) for any explicit override.

| Env var | Read at | Default | Effect | Currently set in deploy configs? |
|---------|---------|---------|--------|------|
| `TOOL_VALUE_GATE_ON_DEMAND` | `toolExecutor.ts:593` | unset â†’ `false` | When `'enforce'`, applies value-gate (#19) to chat too | **Not set** anywhere (only referenced in `docs/TASK-CLASS-PROTOCOL-MATRIX.md`, `toolExecutor.ts`). Effective value: skip on chat. |
| `TOOL_VALUE_GATE_REACTIVE_LIGHT` | `taskClassPolicy.ts:21` | unset â†’ skip gate | When `'enforce'`, applies value-gate to reactive-light scheduled tasks | **Not set** (only referenced in `docs/`, code, and `scripts/run-reliability-canary.ps1`). Effective: skip. |
| `TOOL_VALUE_GATE_RATIO_THRESHOLD` | `toolExecutor.ts:590` | `2.5` | Min value/cost ratio for value gate to allow | Not set in deploy; only `scripts/run-reliability-canary.ps1:44` sets it during canary runs. |
| `TOOL_VALUE_GATE_CONFIDENCE_THRESHOLD` | `toolExecutor.ts:591` | `0.6` | Min confidence for value gate | Same as above. |
| `TOOL_RETRY_CAP` | `toolExecutor.ts:594` | `5` | Per-run per-tool failure cap (#16) | Same as above (canary only). |
| `ENABLE_TOOL_RESULT_CACHE` | `perRunToolCache.ts:79-81` | unset â†’ `false` | Per-run read-only cache short-circuit (#24) | **Not set** in any deploy config. Cache is OFF in production. |
| `TOOL_VERY_LONG_TIMEOUT_MS` | `toolExecutor.ts:246` | `900000` | Tool timeout class | Not overridden. |
| `TOOL_QUICK_DEMO_TIMEOUT_MS` | `toolExecutor.ts:248` | `300000` | Tool timeout class | Not overridden. |
| `enforcement` (constructor flag, not env) | `toolExecutor.ts:694` | `true` | Master switch on gates #2, #14-#19 | Always `true` in `companyAgentRunner` paths (no override seen). |
| `dryRun` (ctor flag) | `toolExecutor.ts:694` | `false` | Intercepts mutating tools (#22) | Off in prod. |
| `AGENT_RUN_LEDGER_ENABLED` | `telemetry/runLedger.ts:48` | unset â†’ enabled (only `'false'` disables) | Evidence record (#28) | Not overridden â€” evidence path active. |
| `AGENT_TRACING_ENABLED` | `telemetry/tracing.ts:10` | unset â†’ off | Tracing span around exec (not a gate) | Not overridden. |

There are **no** explicit kill switches found for: constitutional pre-check,
cross-agent verifier, data-evidence gate, behavioral-anomaly detection,
hooks, capacity tier, ABAC middleware, scope-mismatch, disclosure policy,
HARD_GATE, planning-phase gate, role filter, denial tracking, circuit
breaker, policy limits, formal verifier. Each can only be disabled at the
DI level (don't pass `modelClient` â‡’ verifier off; don't pass
`formalVerifier` â‡’ formal-budget off; don't pass `policyCache` â‡’ policy
limits off; don't pass `constitutionalGovernor` â‡’ constitutional check off
even for HIGH_STAKES tools â€” this is silent, see `:1506-1507`).

> **Note on silent bypass.** The constitutional pre-check (#20) is wrapped
> in `try/catch` at `:1505-1548`; *both* a missing governor and any thrown
> error log a warning and proceed. So a constitutional-check outage is
> failure-open for high-stakes tools.

---

### 4.5 Summary

- The 8-step doc chain is *directionally* correct but the runtime executes
  ~3Ã— more gates than documented. The doc is missing planning-phase, fleet
  circuit breaker, denial tracking, policy limits, role filter, HARD_GATE,
  scope mismatch, disclosure, capacity tier, pre/post hooks, behavioral
  fingerprint, value gate, ABAC, dry-run, retry cap.
- LLM gates are narrow: **0 LLM calls for the typical chat or scheduled
  read; 0 for the typical write either**, unless the tool is one of the 6
  HIGH_STAKES tools (constitutional pre-check is *deterministic-only* for
  5 of them and adds 1 cached LLM call for `submit_assignment_output`) or
  one of the 11 CROSS_AGENT_VERIFICATION tools (+1 uncached LLM via
  `VerifierRunner.verifyToolCall`).
- Pre-execution value gate is **off for chat by default** and **off for
  reactive-light scheduled tasks by default**; it only fires on
  non-reactive-light scheduled write/non-AUTONOMOUS tools.
- The two cost/latency-impactful gate flags (`TOOL_VALUE_GATE_ON_DEMAND`,
  `ENABLE_TOOL_RESULT_CACHE`) are **not set in any deployment config** â€”
  defaults rule. Result caching is OFF in production despite being the
  cheapest available perf win.
- Direct measured latencies were not derivable from static review; latency
  estimates above are based on call shape (in-memory vs DB vs LLM). Real
  p50/p95 numbers would need `tool_call_traces` table querying or
  OpenTelemetry spans (`AGENT_TRACING_ENABLED=true`, currently unset).


---

## Section 05 -- Model Routing Reality

Two parallel routing surfaces exist. `TIER_MODELS.{economy,standard,pro}`, `EXEC_CHAT_MODEL`, and `DEFAULT_AGENT_MODEL` are all the literal `'model-router'`; `optimizeModel` has zero production callers. The runtime actually uses `MODEL_CONFIG.tiers` (different model ids per tier). `isDisabled()` is enforced at config-validation time but not at the request hot-path. Six call sites in `packages/agents/src/**` instantiate Gemini/OpenAI clients directly. GraphRAG production logs show 60+ calls to disabled `gemini-2.5-flash` and leak two Google AI API keys into a tracked log file.

See: [section-05-models.md](diagnostic-2026-04-27/section-05-models.md)


Diagnostic audit of `glyphor-ai-company`, snapshot 2026-04-27.

This section answers: *what models are agents actually running?* â€” separating the
canonical-registry view (`packages/shared/src/models.ts` + `models.config.ts`)
from the live call sites and the cost-tier optimizer.

---

### 5.1  Canonical maps: `ROLE_COST_TIER` and `TIER_MODELS`

There are **two parallel routing surfaces** in `packages/shared/src`. Section 5.2
reconciles them. Both are exported from `packages/shared/src/index.ts`.

#### 5.1.1  `TIER_MODELS` (Cost-tier optimizer â€” `models.ts:630â€“634`)

| Cost tier | Model id | Provider (per `detectProvider`, `models.ts:443`) | Cloud (per `MODEL_CONFIG.providerRouting`, `models.config.ts:79â€“84`) |
|-----------|----------|--------|-------|
| `economy` | `model-router` | openai | azure-foundry (Azure AI Foundry router) |
| `standard`| `model-router` | openai | azure-foundry |
| `pro`     | `model-router` | openai | azure-foundry |

Plus a separate constant:

- `EXEC_CHAT_MODEL = 'model-router'` â€” `models.ts:637`. Used **only** for `task === 'on_demand'` when the role is `pro` (`models.ts:699â€“700`). With every tier already pointing at `model-router`, this branch is currently a no-op.

> **Finding 5.1.1-A.** All three cost tiers resolve to a single model
> (`model-router`). The CostTier abstraction at `models.ts:627` is structurally
> dead â€” three names for the same string. The doc-comment at `models.ts:622â€“625`
> still implies tier differentiation that does not exist.

#### 5.1.2  `ROLE_COST_TIER` (`models.ts:640â€“676`)

Every entry, verbatim:

| Tier (per `models.ts`) | Roles |
|----|----|
| `economy`  | `m365-admin`, `global-admin`, `seo-analyst`, `social-media-manager`, `adi-rose` |
| `standard` | `content-creator`, `design-critic`, `ui-ux-designer`, `frontend-engineer`, `template-architect`, `user-researcher`, `competitive-intel`, `devops-engineer`, `platform-engineer`, `quality-engineer`, `head-of-hr`, `vp-sales`, `vp-design`, `bob-the-tax-pro`, `marketing-intelligence-analyst`, `competitive-research-analyst`, `market-research-analyst` |
| `pro`      | `chief-of-staff`, `cto`, `cfo`, `cpo`, `cmo`, `clo`, `vp-research`, `ops` |

Default for unlisted roles: `'standard'` (`models.ts:696`).

#### 5.1.3  `MODEL_CONFIG.tiers` (the *other* tier table â€” `models.config.ts:14â€“38`)

This is a **second**, semantically different tier system used by `agent-runtime/src/routing/resolveModel.ts`. Names overlap with `ROLE_COST_TIER` (`standard`) but values do not.

| Tier      | Model id                          | Provider  | Cloud         |
|-----------|-----------------------------------|-----------|---------------|
| `fast`    | `gemini-3.1-flash-lite-preview`   | gemini    | gcp           |
| `default` | `gemini-3.1-flash-lite-preview`   | gemini    | gcp           |
| `standard`| `model-router`                    | openai    | azure-foundry |
| `high`    | `claude-sonnet-4-6`               | anthropic | aws-bedrock   |
| `max`     | `claude-sonnet-4-6` *(was `claude-opus-4-7` until 2026-04-19; demoted because Bedrock account lacks Opus 4.7 entitlement, see `models.config.ts:28â€“31`)* | anthropic | aws-bedrock |
| `reasoning` | `o4-mini`                       | openai    | azure-foundry |
| `code`    | `deepseek-v3-2`                   | deepseek  | aws-bedrock   |

#### 5.1.4  Specialized paths (`models.config.ts:41â€“55`)

| Path | Model | Cloud |
|------|-------|-------|
| `web_search` | `gpt-5.4-mini` | azure-foundry |
| `embeddings` | `gemini-embedding-001` | gcp |
| `voice` | `gpt-realtime-2025-08-28` | azure-foundry |
| `transcription` | `gpt-4o-transcribe` | azure-foundry |
| `images` | `gpt-image-1.5` | azure-foundry |
| `reflection` | `gpt-5-nano` | azure-foundry |
| `quick_demo_web` | `gpt-5.3-codex` | azure-foundry |
| `code_generation` | `deepseek-v3-2` | aws-bedrock |
| `shadow_eval` | `gemini-3.1-flash-lite-preview` | gcp |
| `deep_research` | `deep-research-pro-preview-12-2025` | gcp |
| `triangulation_judge` | `gpt-5.4` | azure-foundry |

#### 5.1.5  Disabled models (`models.config.ts:67â€“76`)

`gemini-3-pro-preview`, `gemini-2.0-flash-lite`, `gemini-3-flash-preview`,
`gemini-2.5-flash`, `gemini-2.5-flash-lite`, `claude-sonnet-4-5`,
`claude-haiku-4-5`, `claude-opus-4-6`, `claude-sonnet-4-20250514`.

> **Finding 5.1.5-A.** `models.config.ts:71` disables `gemini-2.5-flash-lite`
> while `DEPRECATED_MODELS` (`models.ts:174â€“175`) maps `gemini-2.5-flash-lite`
> and `gemini-2.5-flash` to **`gemini-3.1-flash-lite-preview`**, which is itself
> a "preview" SKU. The disabled-list is enforced at config-validation time
> (`__tests__/modelsValidation.test.ts:91â€“99`) but `isDisabled()`
> (`models.config.ts:138`) is not called at the request hot-path in
> `resolveModel()` (`models.ts:423â€“438`); a stored DB override pointing at a
> disabled id is silently honored.

#### 5.1.6  Fallback chains (cross-provider) â€” `models.ts:206â€“243`

Selected entries (full table is long):

- `claude-sonnet-4-6` â†’ `gemini-3.1-flash-lite-preview` â†’ `gpt-5.4-mini`
- `claude-opus-4-7`   â†’ `claude-sonnet-4-6` â†’ `gemini-3.1-pro-preview`
- `model-router`      â†’ `gpt-5.4-mini` â†’ `gpt-5-mini` â†’ `gemini-3.1-flash-lite-preview`
- `gemini-3.1-flash-lite-preview` â†’ `gpt-5-mini` â†’ `gpt-5-nano`
- `deepseek-v3-2`     â†’ `gemini-3.1-pro-preview` â†’ `gemini-3.1-flash-lite-preview`

Atlas (ops) is given a Gemini-stripped variant via
`OPS_AGENT_FALLBACK_WHEN_ALL_GEMINI` (`models.ts:249â€“`) because of "Gemini
tool-schema errors (defer_loading, thought_signature, etc.)" (comment
`models.ts:247`). This is a tactical workaround, not a tested guarantee â€” only
the chain *existence* is asserted by `modelsValidation.test.ts:101â€“114`, not the
ops branching.

---

### 5.2  Effective model per role Ã— task type

`optimizeModel(role, task, dbModel?)` â€” `models.ts:688â€“704` â€” is the **only**
function that consumes `ROLE_COST_TIER`/`TIER_MODELS`. It is exported from
`packages/shared/src/index.ts` but **not** wired into the agent runtime's
primary path (`packages/agent-runtime/src/routing/resolveModel.ts` uses
`MODEL_CONFIG.tiers` instead). Direct callers of `optimizeModel`:

```text
$ rg -n "optimizeModel\(" packages services workers scripts
## (no production hits â€” only the export at packages/shared/src/index.ts)
```

> **Finding 5.2-A.** `optimizeModel` and the cost-tier system that drives it
> appear to be **unreferenced by any runtime**. The lookup chain below is
> therefore the *intended* behavior; the *actual* behavior (Section 5.3) routes
> through `MODEL_CONFIG.tiers` which has different values.

#### 5.2.1  Lookup chain (intended)

```
role
  â””â”€â”€ ROLE_COST_TIER[role]      (default: 'standard')          # models.ts:696
        â””â”€â”€ if task === 'on_demand' && tier === 'pro':
              â””â”€â”€ EXEC_CHAT_MODEL                             # models.ts:699-700
        â””â”€â”€ else:
              â””â”€â”€ TIER_MODELS[tier]                            # models.ts:703
        â””â”€â”€ (dbModel override beats everything â†’ resolveModel(dbModel))   # models.ts:694
```

#### 5.2.2  Effective model per (role, task) â€” assuming no DB override

Because `TIER_MODELS.{economy,standard,pro}` and `EXEC_CHAT_MODEL` are all
`model-router`, **every role Ã— every task â†’ `model-router`**. The matrix is
degenerate.

| Role group | task=`on_demand` | task=`scheduled` | task=`orchestrator` |
|---|---|---|---|
| economy roles (`m365-admin`, `global-admin`, `seo-analyst`, `social-media-manager`, `adi-rose`) | `model-router` | `model-router` | `model-router` |
| standard roles (15 listed in Â§5.1.2) | `model-router` | `model-router` | `model-router` |
| pro roles (`chief-of-staff`, `cto`, `cfo`, `cpo`, `cmo`, `clo`, `vp-research`, `ops`) | `model-router` (via `EXEC_CHAT_MODEL`) | `model-router` (via `TIER_MODELS.pro`) | `model-router` (via `TIER_MODELS.pro`) |
| any unlisted role | `model-router` (defaults to `standard`) | `model-router` | `model-router` |

> Provider for `model-router` is `openai` (`models.ts:445`) and routes through
> Azure Foundry (`models.config.ts:106â€“113`), which then *internally* picks the
> underlying OpenAI SKU. Glyphor has no signal beyond Foundry billing about
> which model actually answered.

#### 5.2.3  What's *actually* effective per role

The agent runtime resolver â€” `packages/agent-runtime/src/routing/resolveModel.ts`
(per `git show 8163ffd8`) â€” uses `MODEL_CONFIG.tiers` (Â§5.1.3), with effective
results:

- Most agents (DB column `company_agents.model`): `model-router` after
  `scripts/migrate-agents.js:15` (`UPDATE â€¦ SET model = 'model-router' WHERE model = 'gpt-4o'`).
- DB overrides observed in code/migrations:
  - `claude-sonnet-4-6` for Chief of Staff (`docs/MODEL-SYSTEM-ANALYSIS.md:250`),
  - `deepseek-v3-2` for DevOps & Platform Engineering (`docs/MODEL-SYSTEM-ANALYSIS.md:251â€“252`).
- Routing config (`routing_config` table) overrides per `docs/MODEL-SYSTEM-ANALYSIS.md:265â€“270`:
  - `complex_research` â†’ `gemini-3.1-pro-preview`
  - `financial_complex` â†’ `claude-sonnet-4-6`

---

### 5.3  Direct provider client usage (bypassing `resolveModel` / `optimizeModel`)

#### 5.3.1  Provider SDK constructors instantiated outside the central client

| File:line | Constructor | Notes |
|---|---|---|
| `packages/company-memory/src/embeddingClient.ts:17` | `new GoogleGenAI({ apiKey })` | Embeddings; legitimate (model = `EMBEDDING_MODEL`). |
| `packages/agent-runtime/src/providers/openai.ts:153` | `new OpenAI({...})` | Provider adapter â€” central. |
| `packages/agent-runtime/src/providers/gemini.ts:25,29` | `new GoogleGenAI(...)` | Provider adapter â€” central. |
| `packages/agent-runtime/src/providers/bedrockClient.ts:89` | `new BedrockRuntimeClient(...)` | Provider adapter â€” central. |
| `packages/agents/src/head-of-hr/tools.ts:567,829` | `new GoogleGenAI({ apiKey })` | **Bypass** â€” direct Gemini call from HR tool. |
| `packages/agents/src/shared/assetTools.ts:215` | `new GoogleGenAI({ apiKey })` | **Bypass** â€” asset/image tool. |
| `packages/agents/src/shared/sandboxBuildValidator.ts:247` | `new OpenAI({ apiKey })` | **Bypass** â€” sandbox validator using OpenAI directly. |
| `packages/agents/src/shared/videoCreationTools.ts:100,171,261,322` | `new GoogleGenAI({ apiKey })` | **Bypass** â€” Veo/video pipeline calls Gemini API directly (4 instantiations in one file). |

> **Finding 5.3.1-A.** Six call sites in `packages/agents/src/**` bypass the
> agent-runtime adapter and instantiate Gemini/OpenAI clients directly. They
> read `GOOGLE_AI_API_KEY` / OpenAI key from env, not from the central
> credentials helper, and **do not flow through `resolveModel()` or any
> fallback chain**. A Gemini outage will fail these tools hard with no
> automatic OpenAI failover.

#### 5.3.2  Direct fetch() to provider HTTP endpoints

| File:line | URL | Bypass type |
|---|---|---|
| `packages/agent-runtime/src/modelClient.ts:421,459` | `https://generativelanguage.googleapis.com/v1beta/interactions` | Gemini "interactions" telemetry endpoint â€” direct `fetch`. |
| `packages/scheduler/src/strategyLabEngine.ts:2111,2142` | same Gemini interactions endpoint | Duplicate of the modelClient.ts path. |
| `packages/agent-runtime/src/providers/gemini.ts:203,240` | `â€¦/v1beta/models/{model}:predictLongRunning`, `â€¦/v1beta/{operation.name}` | Veo long-running operations; legitimate Gemini-only API. |
| `packages/agent-runtime/src/providers/openai.ts:748` | `https://api.openai.com/v1/images/generations` | **Direct OpenAI image API** â€” bypasses Azure Foundry routing declared in `MODEL_CONFIG.providerRouting.openai.cloud = 'azure-foundry'` (`models.config.ts:82`). Contradicts the cloud routing contract. |
| `packages/dashboard/src/lib/useVoiceChat.ts:200` | `https://api.openai.com/v1/realtime?model=gpt-realtime-2025-08-28` | **Direct browserâ†’OpenAI** call, not Azure. Hardcoded model id. |
| `packages/voice-gateway/src/realtimeClient.ts:44` | `// POST https://api.openai.com/v1/realtime/sessions` | Comment only; actual implementation should be reviewed. |
| `packages/integrations/src/webSearch.ts:114` | `OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'` | Doc comment at line 7 says "Azure OpenAI / Foundry only (no api.openai.com)" â€” the constant **violates its own header**. |
| `packages/integrations/src/openai/billing.ts:26` | `https://api.openai.com/v1/organization/costs` | Billing-only; legitimate. |
| `packages/integrations/src/anthropic/billing.ts:11` | `https://api.anthropic.com` | Billing-only; legitimate (header at line 4 explicitly notes it). |
| `packages/graphrag-indexer/logs/indexing-engine.log` (60+ entries) | `â€¦gemini-2.5-flash:generateContent?key=AIzaSyâ€¦` | **Live evidence** that GraphRAG is calling `gemini-2.5-flash`, which is on the **disabled** list (`models.config.ts:70`). Also: **API key leaked into the log file** committed to the repo (`AIzaSyBtTi78faXgy5EN7Mrdj0TPR6r2qBCZKc4`, `AIzaSyBIrERx-dTIxoPaKBw_jPCrz6hLwNWKB64`). |

> **Finding 5.3.2-A.** `packages/integrations/src/webSearch.ts:114` and
> `packages/agent-runtime/src/providers/openai.ts:748` and
> `packages/dashboard/src/lib/useVoiceChat.ts:200` all hit `api.openai.com`
> directly while config asserts `openai.cloud === 'azure-foundry'`.
>
> **Finding 5.3.2-B.** `packages/graphrag-indexer/settings.yaml:12` declares
> `gemini-3.1-flash-lite-preview`, but production logs show actual traffic to
> `gemini-2.5-flash` (disabled). Either settings.yaml is not the file being
> read, or there is a separate Python config path.
>
> **Finding 5.3.2-C (security).** Two distinct Google AI API keys are
> visible in `packages/graphrag-indexer/logs/{indexing-engine,prompt-tuning}.log`.
> If those logs are tracked in git, both keys must be revoked. (Out of scope
> for this section â€” flagged for Section 12 / secrets audit.)

#### 5.3.3  `@ai-sdk/*` (Vercel AI SDK) usage

```text
$ rg "from ['\"]@ai-sdk/(openai|google|anthropic|deepseek|amazon-bedrock)" packages services workers skills scripts
## 0 matches
```

The Vercel AI SDK is not used. All providers go through hand-rolled adapters in
`packages/agent-runtime/src/providers/*`.

---

### 5.4  Hardcoded model IDs (string literals outside the registry)

Excluding `packages/shared/src/models.ts` (the registry itself),
`packages/shared/src/models.config.ts`, `packages/integrations/src/anthropic/billing.ts`
(deprecated/billing tables that intentionally list legacy SKUs), and dashboard
build artifacts under `packages/dashboard/dist/`.

#### Production code

| File:line | Hardcoded id | Why it's a problem |
|---|---|---|
| `packages/agent-runtime/src/costs/modelRates.ts:11` | `'claude-sonnet-4-5'` | Disabled in `models.config.ts:72`. Cost table still references it. |
| `packages/agent-runtime/src/costs/modelRates.ts:13` | `'claude-haiku-4-5'` | Disabled in `models.config.ts:73`. |
| `packages/agent-runtime/src/costs/modelRates.ts:39` | `'gemini-2.5-flash'` | Disabled in `models.config.ts:70`. |
| `packages/integrations/src/aws/billing.ts:183` | regex `/claude-sonnet-4-5/i` | Used to canonicalize Bedrock invoice rows. Acceptable for *historical* invoices; misleading in current code. |
| `packages/integrations/src/aws/billing.ts:184` | regex `/claude-haiku-4-5/i` | Same. |
| `packages/voice-gateway/src/realtimeClient.ts` (and `dashboard/src/lib/useVoiceChat.ts:200`) | `gpt-realtime-2025-08-28` | Realtime voice. Should reference `REALTIME_MODEL` (`models.ts:188`), not a string literal. |

#### Test fixtures

| File:line | Hardcoded id | Status |
|---|---|---|
| `packages/agent-runtime/src/__tests__/contextCompaction.test.ts:13` | `'gemini-2.5-flash': 1_048_576` | Disabled model. |
| `packages/agent-runtime/src/__tests__/contextCompaction.test.ts:15` | `'gpt-4o': 128_000` | Deprecated â†’ `model-router` in `DEPRECATED_MODELS` (`models.ts:138`). |
| `packages/agent-runtime/src/__tests__/memoryConsolidation.test.ts:57` | `getTierModel: vi.fn(() => 'gemini-2.5-flash')` | Mock returns a disabled id; test will pass even after global retirement. |

#### Migration / one-shot scripts (intentional historical references)

- `scripts/migrate-agents.js:15,19` â€” explicit list of legacy ids.
- `scripts/validate-db-models.js:9â€“19` â€” denylist of deprecated/disabled ids.
- `db/migrations/20260411150000_replace_claude_sonnet_with_gemini_flash_lite.sql` â€” see Â§5.6.

> **Finding 5.4-A.** `packages/agent-runtime/src/costs/modelRates.ts` is a
> **second pricing table** parallel to `SUPPORTED_MODELS[*].inputPer1M /
> outputPer1M` (`models.ts:75â€“`). It still includes 3 disabled SKUs and is the
> source of cost numbers on at least one runtime path. Two pricing tables for
> the same model = silent drift risk; consolidate to the registry.

---

### 5.5  Cross-provider fallback decisions in tests

Only one test asserts on fallback *cross-provider* invariants:

- `packages/agent-runtime/src/__tests__/modelsValidation.test.ts:101â€“114`
  asserts that for every primary model whose tier is **not** `economy` /
  `reasoning` / `specialized`, the `FALLBACK_CHAINS` chain contains at least
  one entry whose provider differs from the primary's. This is structural, not
  behavioral â€” it verifies the *table*, not that any code actually fails over.

- `packages/agent-runtime/src/__tests__/modelsValidation.test.ts:17â€“22, 27â€“32`
  assert every fallback model id exists in `SUPPORTED_MODELS` (also structural).

- `packages/agent-runtime/src/__tests__/errorRetry.test.ts:553â€“572` asserts
  `retry_fallback` events fire after consecutive `overloaded` errors and that
  background calls do **not** trigger fallback (line 297â€“311). It uses mock
  models â€” does **not** validate the cross-provider switch end-to-end.

- `packages/agent-runtime/src/__tests__/errorRetry.test.ts:460, 490` assert
  edge cases (no fallback when `enableOverloadFallback === false`; transient
  errors reset the overload counter).

> **Finding 5.5-A.** No test executes a real cross-provider failover (e.g.
> Sonnet 4.6 â†’ Gemini Flash-Lite). The only enforcement is "the table looks
> right." If `getFallbackChain()` is called with a model id that is missing
> from `FALLBACK_CHAINS`, it returns `[]` (`models.ts:466`) and the runtime
> proceeds with no fallback at all. Atlas's ops-specific Gemini-strip path
> (`getOpsFallbackChainExcludingGemini`, `models.ts:464`) has zero direct test
> coverage in `__tests__/`.

Logs were not in scope for this section beyond the GraphRAG evidence already
cited in Â§5.3.2.

---

### 5.6  The "Apr 11 sonnet â†’ flash-lite" migration

The architecture doc claim (`docs/ARCHITECTURE.md:1255`) referencing
`db/migrations/20260411150000_replace_claude_sonnet_with_gemini_flash_lite.sql`
is **literally accurate**. Verbatim from that migration:

```sql
UPDATE company_agents
SET model = 'gemini-3.1-flash-lite-preview'
WHERE model = 'claude-sonnet-4-6';

UPDATE routing_config
SET model_slug = 'gemini-3.1-flash-lite-preview',
    description = 'CLO contract/compliance review. Manual trigger only.
                   (Gemini Flash-Lite â€” Claude retired for cost.)'
WHERE route_name = 'legal_review' AND model_slug = 'claude-sonnet-4-6';
```
(`db/migrations/20260411150000_replace_claude_sonnet_with_gemini_flash_lite.sql:4â€“14`)

#### 5.6.1  What was actually affected

**DB column `company_agents.model`:** every agent row whose model was
`claude-sonnet-4-6` was rewritten to `gemini-3.1-flash-lite-preview`. The
migration does not name agents; it is a bulk `WHERE model = 'claude-sonnet-4-6'`.
Per `docs/MODEL-SYSTEM-ANALYSIS.md:250â€“262` Chief of Staff was later restored
to `claude-sonnet-4-6` (so the migration affected CoS, then was partially
reverted by a later DB change not bundled with this commit).

**`routing_config` table:** only the `legal_review` route was touched (CLO
contract/compliance review).

**Code-level tier/specialized assignments (commit `8163ffd8`, 2026-04-10,
which preceded this DB migration by hours):**
- `tiers.fast`: `gpt-5-nano` â†’ `gemini-3.1-flash-lite-preview`
- `tiers.high`: `gpt-5.4-mini` â†’ `claude-sonnet-4-6` *(this is the **opposite** direction â€” added Sonnet, not removed it)*
- `tiers.max` introduced: `claude-opus-4-6`
- `tiers.reasoning` introduced: `deepseek-r1`
- `specialized.reflection`: `gpt-5-mini` â†’ `claude-haiku-4-5`
- `specialized.code_generation`: `gemini-3.1-pro-preview` â†’ `deepseek-v3-2`

The current `models.config.ts` reflects a **further revision on 2026-04-19**
(commit `054dbe54`):
- `tiers.max`: `claude-opus-4-7` â†’ `claude-sonnet-4-6` (Bedrock account lacks Opus 4.7 entitlement; see comment at `models.config.ts:28â€“31`)
- `tiers.reasoning`: `deepseek-r1` â†’ `o4-mini`
- `specialized.reflection`: `claude-haiku-4-5` â†’ `gpt-5-nano` (the very Haiku promotion from `8163ffd8` was reverted 8 days later)

> **Finding 5.6-A.** The "wholesale Sonnet â†’ Flash-Lite" framing in the
> architecture doc applies to the **DB layer only** (one bulk `UPDATE` of
> `company_agents` plus the `legal_review` route). It does not describe the
> code-level tier table, where the 8163ffd8 commit moved the `high` tier the
> *other* direction (gpt-5.4-mini â†’ claude-sonnet-4-6). The migration narrative
> in `docs/ARCHITECTURE.md` and `docs/MODEL-SYSTEM-ANALYSIS.md` is two
> conflicting stories layered on top of each other.
>
> **Finding 5.6-B.** Several settings rolled back within 8 days
> (`reflection: claude-haiku-4-5 â†’ gpt-5-nano`, `max: opus-4-7 â†’ sonnet-4-6`).
> The model-config file changed 4 times in 9 days (2026-04-10, -11, -18, -19).
> There is no changelog inside the file â€” only `lastReviewedAt`.

#### 5.6.2  Quality evals on affected skills/roles

Skills directory does not carry per-skill model pins (`rg "model:" skills/`
returns 2 hits, neither a config). Eval coverage for skills/roles affected by
the migration:

| Affected target | Quality eval present? | Path |
|---|---|---|
| Generic role evals | yes (per-run) | `packages/smoketest/src/layers/layer29-per-run-evaluation.ts` |
| `evalDashboard` aggregator | yes | `packages/scheduler/src/evalDashboard.ts` |
| `chief-of-staff` (Sonnet â†’ Flash-Lite â†’ Sonnet round-trip) | **no skill-specific eval** | searched `scripts/eval-*.ts` and `packages/scheduler/src/evalDashboard.ts` â€” no CoS-pinned eval |
| `legal_review` route (`clo`) | **no route-specific eval** found | grep for `legal_review` returns only the migration |
| `reflection` specialized path (haiku â†’ nano flip) | covered indirectly by `__tests__/reasoningEngine.test.ts` (mocked) | not a quality eval |
| `code_generation` (Gemini Pro â†’ DeepSeek v3.2) | none model-aware | no `codeGenerationEval.ts` found |
| Triangulation judge (`gpt-5.4`) | judge logic itself runs, but no offline eval validates judgment quality | `scripts/eval-section6-regression.ts` exists but is dashboard-section regression, not LLM-judge regression |

> **Finding 5.6-C.** None of the roles/specialized paths flipped by the
> 2026-04-10 â†’ 2026-04-19 churn have a dedicated quality regression. The CI
> only verifies the *table* (`__tests__/modelsValidation.test.ts`). A change
> from Claude Sonnet 4.6 to Gemini 3.1 Flash-Lite for `legal_review` is at
> least a **15Ã— cost reduction** (`$3 / $15` â†’ `$0.10 / $0.40` per MTok per
> `models.ts:75â€“76`) and a likely substantial quality drop for contract
> review, but no evaluation gate exists to catch regressions.

---

### 5.7  Summary of findings (Section 5)

| # | Severity | Finding |
|---|---|---|
| 5.1.1-A | Med | All `CostTier` values point to `model-router`; tier system is dead code. |
| 5.1.5-A | High | `isDisabled()` is not enforced at request time, only at config-validation. |
| 5.2-A | Med | `optimizeModel` and `ROLE_COST_TIER` are not referenced by any runtime path. |
| 5.3.1-A | High | 6 agent tools in `packages/agents/src/**` bypass the central provider adapter and have no fallback. |
| 5.3.2-A | Med | At least 3 production paths hit `api.openai.com` directly while config asserts Azure-Foundry routing. |
| 5.3.2-B | High | GraphRAG logs show live traffic to `gemini-2.5-flash` (disabled SKU). settings.yaml says otherwise. |
| 5.3.2-C | **Critical** | Two Google AI API keys present in tracked log files under `packages/graphrag-indexer/logs/`. |
| 5.4-A | Med | `costs/modelRates.ts` is a parallel pricing table containing 3 disabled SKUs. |
| 5.5-A | High | Zero end-to-end cross-provider fallback tests; only structural assertions. |
| 5.6-A | Med | Migration narrative in `ARCHITECTURE.md` conflicts with code-level tier history. |
| 5.6-B | Low | 4 model-config revisions in 9 days, no in-file changelog, partial rollbacks. |
| 5.6-C | High | No quality eval gates the migration-affected roles (especially `legal_review`/CLO). |

---

*Cited paths are relative to repo root unless otherwise stated.*
*Git refs: `8163ffd8` (2026-04-10), `4e3ee33d` (2026-04-10),
`432d6fc7` (2026-04-11), `139323c8` (2026-04-18),
`ff60b8e9` (2026-04-18), `054dbe54` (2026-04-19).*

---

## Section 06 -- Database & Migrations

326 SQL migrations, 27,551 LOC. There is no DROP TABLE anywhere and zero ADD COLUMN -> DROP COLUMN pairs -- all reversion is column-level inside original CREATE TABLE definitions, plus 9 data-only `_remove_*` migrations. 8 tables are created but never referenced in TS, and ~10 TS SQL strings reference table names with no migration. No Drizzle/Prisma layer exists; FK schema lives only in migrations. All 9 `cz_*` migrations are live.

See: [section-06-db.md](diagnostic-2026-04-27/section-06-db.md)


Scope: `db/migrations/` (Postgres / Cloud SQL).
Evidence root: `db/migrations/*.sql`, `packages/**/*.ts`.

---

### 1. Migration count and total LOC

- **Files:** 326 SQL migrations under `db/migrations/`.
- **Total LOC:** 27,551 lines (raw `Get-Content â€¦ Measure-Object -Line`).
- Earliest: `db/migrations/20260222025612_new-migration.sql`.
- Latest cz_*: `db/migrations/20260422081600_cz_shadow_eval.sql`.

Cite: enumerated via `Get-ChildItem db\migrations -Filter *.sql` (counts surface in `scratch/_create_tables.txt`, `scratch/_add_columns.txt`).

---

### 2. Migrations applied then explicitly reverted

#### 2a. Schema reverts (DROP TABLE / DROP COLUMN)

`DROP TABLE` is **not used anywhere** in `db/migrations/` (0 hits). All schema reversions are at the column level, in two migrations:

| Created in | Reverted in |
|---|---|
| `db/migrations/20260225100000_agent_identity.sql:10` â€” `agent_profiles.avatar_emoji TEXT DEFAULT 'ðŸ¤–'` (defined in CREATE TABLE) | `db/migrations/20260227100037_strip_emojis.sql:7` â€” `ALTER TABLE agent_profiles DROP COLUMN IF EXISTS avatar_emoji;` |
| `db/migrations/20260227000000_collective_intelligence.sql:9-40` â€” CREATE TABLE `company_pulse` with `new_users_today`, `churn_events_today`, `uptime_streak_days`, `avg_build_time_ms`, `meetings_today`, `messages_today`, `platform_status`, `active_incidents`, `decisions_pending` | `db/migrations/20260316180000_rename_pulse_to_vitals.sql:12-25` â€” table renamed to `company_vitals`; the 9 listed columns dropped (`DROP COLUMN IF EXISTS â€¦`). A backwards-compat view `company_pulse` is recreated at `:92`. |

#### 2b. Data-only reverts (`_remove_*`, `_purge_`)

Nine migrations match the `_remove_/_purge_/_revert_/_undo_/_rollback_/_reset_` naming pattern. **None drop schema**; all are `DELETE`/`UPDATE` against seed rows produced by earlier migrations:

| File | Reverts |
|---|---|
| `db/migrations/20260314113000_remove_customer_success_skills.sql:1-4` | customer-success skills + task mappings (seeded earlier in agent_skills/task_skill_map) |
| `db/migrations/20260314130000_remove_customer_success_role_artifacts.sql:1-2` | customer-success role rows in operational/telemetry tables |
| `db/migrations/20260317150000_remove_cos_financial_reporting_skill.sql:1-3` | CoS `financial_reporting` skill row |
| `db/migrations/20260323200000_remove_copilot_chat_tool_registry.sql:1-4` | `tool_registry` row `copilot_chat` |
| `db/migrations/20260323230000_cmo_remove_marketing_intelligence_assignee.sql:1-3` | `executive_orchestration_config.allowed_assignees` entry |
| `db/migrations/20260324100000_remove_gemini_25_pro_registry_row.sql:1-3` | `model_registry` row `gemini-2.5-pro` |
| `db/migrations/20260408120000_dead_agent_hard_purge_reset.sql:1-4` | hard purge/reset of dead-agent rows for canonical live roster |
| `db/migrations/20260410180000_remove_inactive_grant_revoke_executive_roles.sql:1-4` | inactive grant/revoke rows for CFO/CPO/CMO |
| `db/migrations/20260410190000_remove_inactive_cto_legacy_graph_grants.sql:1-4` | ~50 inactive CTO Microsoft Graph/SharePoint tool grants |

All nine target seeded *content* (`agent_skills`, `tool_registry`, `model_registry`, `agent_tool_grants`, `executive_orchestration_config`) â€” not table or column structure.

---

### 3. Tables created by migrations but never referenced in `packages/**/*.ts`

219 distinct tables are created via `CREATE TABLE` across the 326 migrations (`scratch/_unique_tables.txt`). Cross-referenced against the entire TS source (686 files, ~7.98 MB blob, word-boundary match):

**Unreferenced (8):**
1. `account_dossiers` â€” `db/migrations/20260227100020_strategy_lab.sql` (first CREATE)
2. `agent_capacity_role_defaults` â€” `db/migrations/20260309120000_agent_capacity.sql`
3. `conversation_references` â€” `db/migrations/20260227100013_knowledge_management.sql`
4. `metrics_cache` â€” `db/migrations/20260227100008_metrics_cache.sql`
5. `platform_intel_reports` â€” `db/migrations/20260301000000_platform_intel.sql`
6. `support_responses` â€” `db/migrations/20260227100024_customer_success.sql`
7. `value_assessments` â€” `db/migrations/20260227100022_value_capture.sql`
8. `world_state_history` â€” `db/migrations/20260306000000_world_model.sql`

(Filenames inferred from `scratch/_create_tables.txt`; resolve precisely with `Select-String -Path db/migrations/*.sql -Pattern 'CREATE TABLE.*<name>'`.)

These are candidates for either (a) deletion or (b) wiring up â€” there is no executing code that reads or writes them.

---

### 4. Tables referenced in TS that have no `CREATE TABLE` migration

Heuristic: regex over SQL-like quoted strings in `packages/**/*.ts` for `(FROM|INTO|UPDATE|JOIN)\s+<name>`. After filtering English/keyword noise, the plausible undefined tables are:

| Referenced as | Cite | Verdict |
|---|---|---|
| `agent_completion`, `agent_memories`, `agent_policy_limits` | various `packages/scheduler`, `packages/agents` | **likely typos / shadow names** â€” `agent_memory` exists in `db/migrations/20260225000000_*`; the `_policy_limits` and `_completion` variants have no DDL. |
| `delegation_performance` | `packages/scheduler/src/dashboardApi.ts` (FROM-clause string) | **missing** â€” no migration creates it |
| `pending_decisions` | `packages/scheduler/src/dashboardApi.ts` | **alias / view candidate** â€” no DDL match (compare `decisions WHERE status='pending'` queries at `dashboardApi.ts:1600`) |
| `recent_runs`, `direct_matches`, `last_two`, `wa_agg`, `ae_agg` | dashboard/scheduler | **CTE aliases**, not real tables |
| `image_manifest`, `tier3_test_cases`, `tool_gap`, `chat_reasoning_protocol`, `social_replies`, `target_agents`, `available_sections`, `compute_performance_scores` | scattered TS strings | **no migration found** â€” most are ad-hoc/unused in production paths |
| `jsonb_to_recordset`, `unnest`, `array_append_unique`, `match_memories`, `merge_research_packet`, `update_trust_score`, `list_tool_requests`, `append_chain_links` | TS SQL | **Postgres functions, not tables** (false positives from regex) |
| `information_schema` | `packages/scheduler/src/dashboardApi.ts:1405,1424` | system catalog (expected) |

Net real gap: **`agent_completion`, `agent_policy_limits`, `delegation_performance`, `image_manifest`, `tier3_test_cases`, `tool_gap`, `chat_reasoning_protocol`, `social_replies`, `target_agents`, `compute_performance_scores`** appear in TS SQL strings without any matching `CREATE TABLE` â€” likely dead code referencing tables that were never created or were renamed away.

(Full sweep in `scratch/_ts_only_tables.txt`.)

---

### 5. Columns added then later dropped (`ADD COLUMN x` â€¦ `DROP COLUMN x`)

147 `ADD COLUMN` statements vs 11 `DROP COLUMN` statements. Pairing strictly on `ALTER TABLE â€¦ ADD COLUMN` â†’ `ALTER TABLE â€¦ DROP COLUMN`: **zero matches**. Every dropped column was originally created inline as part of `CREATE TABLE`, not added later via `ALTER`.

Drops (all are CREATE-then-DROP, not ADD-then-DROP):

- `agent_profiles.avatar_emoji` â€” created inline in `db/migrations/20260225100000_agent_identity.sql:10`; dropped in `db/migrations/20260227100037_strip_emojis.sql:7`.
- `company_vitals.{new_users_today, churn_events_today, uptime_streak_days, avg_build_time_ms, meetings_today, messages_today, platform_status, active_incidents, decisions_pending}` â€” created inline in `db/migrations/20260227000000_collective_intelligence.sql:16-40` (as `company_pulse`); dropped in `db/migrations/20260316180000_rename_pulse_to_vitals.sql:15-25`.

Conclusion: **no `ALTER TABLE â€¦ ADD COLUMN` was ever later reverted by `DROP COLUMN`.** The only column churn happened against initial table definitions.

---

### 6. Foreign keys: TS code vs migration schema

The TS codebase has **no Drizzle/Prisma/TypeORM schema file**:

- `Select-String pgTable|drizzle|prisma -Path packages\**\*.ts` â†’ **0 hits**.
- All DB access is via raw SQL through `@glyphor/shared/db` (`systemQuery`, `systemTransaction`); see `packages/scheduler/src/dashboardApi.ts:15`.
- No `.references(...)` / `FOREIGN KEY` declarations exist in TS.

Therefore **no TS-side FK declarations diverge from migrations**, by construction â€” there is no second source of truth. The schema is migration-only.

Migrations declare 221 `REFERENCES` clauses across the 326 files (FK constraints); these are the only FK definitions in the system.

Risk note: because TS speaks raw SQL, **referential integrity is enforced only by Postgres**, and the dashboard's `DELETE â€¦ FROM` cascade chain in `packages/scheduler/src/dashboardApi.ts:282-313` (deletes from `agent_tool_grants`, `a2a_tasks`, `social_publish_audit_log`, `social_metrics`, `scheduled_posts`, `content_drafts`, `deliverables`, `task_run_outcomes`, `work_assignments`, `tool_requests`, `decision_chains`, `handoffs`, `proposed_initiatives`, `plan_verifications`, `workflows`) is hand-rolled cascade logic that must stay synced with FK definitions in migrations. Any new FK added in a future migration without updating that block will silently violate cascade semantics.

---

### 7. cz_* migrations â€” Customer Zero Protocol

All `cz_*` migrations and their inferred status:

| # | File | One-line summary | Verdict |
|---|---|---|---|
| 1 | `db/migrations/20260417160000_cz_schema.sql` | Creates `cz_tasks`, `cz_runs`, `cz_scores`, `cz_pillar_config`, `cz_launch_gates` (5 tables) â€” the core CZ Protocol schema. | **live** â€” all 5 tables referenced in TS (cz_tasksÃ—26, cz_runsÃ—32, cz_scoresÃ—18, cz_pillar_configÃ—2, cz_launch_gatesÃ—2). |
| 2 | `db/migrations/20260417160001_cz_seed.sql` | Seeds pillar configs, launch gates, and 67 protocol tasks. | **live** â€” superseded only in part by gate-relax migrations below. |
| 3 | `db/migrations/20260417160002_cz_surface_addon.sql` | Adds `surface` column to `cz_runs` (direct/teams/slack), recreates `cz_latest_scores` view, adds "Chat Surface Fidelity" pillar, seeds tasks 68-89. | **live** â€” additive, no later overrides. |
| 4 | `db/migrations/20260417210000_cz_scores_agent_output.sql` | `ALTER TABLE cz_scores ADD COLUMN agent_output TEXT`; expands `judge_tier` to allow `llm-judge`/`error`. | **live** â€” additive, never reverted. |
| 5 | `db/migrations/20260421120000_cz_launch_gate_p0_threshold.sql` | Replaces `p0_must_be_100` boolean gate with numeric `p0_pass_rate_min`; relaxes `design_partner_ready` to P0â‰¥90%, overallâ‰¥70%. | **live** â€” supersedes earlier strict 100% gate from cz_seed; effective contract. |
| 6 | `db/migrations/20260421120100_cz_investor_gate_relax.sql` | Relaxes `investor_ready` gate to P0â‰¥80%, overallâ‰¥80%. | **live** â€” supersedes corresponding row from cz_seed. |
| 7 | `db/migrations/20260421130000_cz_reassign_retired_agents.sql` | Reassigns CZ tasks owned by retired agents (vp-sales, content-creator, seo-analyst, social-media-manager â†’ active equivalents). | **live (one-shot data fix)** â€” fixes drift caused by 2026-04-18 roster prune. |
| 8 | `db/migrations/20260421190000_cz_reassign_tenancy_tasks_to_cto.sql` | Reassigns Identity & Tenancy CZ tasks from `sarah` (chief-of-staff) to `marcus` (cto). | **live (one-shot data fix)** â€” task-routing correction; no later override. |
| 9 | `db/migrations/20260422081600_cz_shadow_eval.sql` | Creates `cz_shadow_evals`, `cz_shadow_attempts`, `cz_automation_config` for auto-promotion of CZ reflection challengers (staged â†’ shadow_running â†’ promoted/retired). | **live** â€” referenced 32Ã— in TS (`cz_shadow*`). Newest CZ migration; no overrides yet. |

No cz_* tables are dropped or referenced as `_remove_/_revert_`. The `cz_chat_threads/turns/artifacts` names sometimes assumed to exist do **not** appear in either migrations or TS â€” Chat Surface Fidelity reuses `cz_runs.surface` rather than introducing per-surface tables.

---

### Summary

- 326 migrations / 27,551 LOC. **No `DROP TABLE` ever** â€” all reversions are column-level (10 columns across 2 migrations) or data-level (9 `_remove_*` migrations).
- **0** `ADD COLUMN`â†’`DROP COLUMN` pairs; column churn is contained to original `CREATE TABLE` definitions.
- **8** tables created but unreferenced in TS (candidates for deletion: `account_dossiers`, `agent_capacity_role_defaults`, `conversation_references`, `metrics_cache`, `platform_intel_reports`, `support_responses`, `value_assessments`, `world_state_history`).
- **~10** TS SQL strings reference table names with no migration (likely dead code: `agent_completion`, `agent_policy_limits`, `delegation_performance`, `image_manifest`, `tier3_test_cases`, `tool_gap`, `chat_reasoning_protocol`, `social_replies`, `target_agents`, `compute_performance_scores`).
- **No Drizzle/Prisma layer** exists; FK schema lives only in migrations (221 `REFERENCES` clauses). Hand-rolled cascade in `packages/scheduler/src/dashboardApi.ts:282-313` is the only TS-side referential coupling and must be kept in sync manually.
- All **9 cz_* migrations are live**; the gate-threshold pair (`cz_launch_gate_p0_threshold`, `cz_investor_gate_relax`) supersedes the strict gates seeded in `cz_seed`, but additively (UPDATE in place), so the seed is not dead â€” it is the v1 of a v2 row.

---

## Section 07 -- Dead Code, Stale Comments, and Orphans

Across 941 source files, 61 are definitely dead (no inbound, >30d, no test refs) and 126 are probably dead (test-only or recent-but-unreferenced). Orphans concentrate in `packages/agents/src/{global-admin,devops-engineer,quality-engineer,platform-engineer,frontend-engineer,competitive-intel,...}` (~7,000 LOC of agent code that is unreachable from production entrypoints).

See: [section-07-dead.md](diagnostic-2026-04-27/section-07-dead.md)


_Audit window: 2026-04-27. Source files analysed (excl. node_modules / .venv / dist / build / .next): **941**._

### Methodology

- File inventory built from `packages/`, `services/`, `scripts/`, `workers/` (`*.ts`, `*.tsx`, `*.js`, `*.mjs`).
- Excluded: `node_modules`, `.venv`, `.next`, `dist`, `build`, `coverage`, `out`, `.turbo`, `__pycache__`.
- Imports collected via regex on `from "..."` / `require("...")`. Resolved 3,019 of 3,677 specifiers (82%); the rest are external packages or unresolvable aliases.
- **Reachability**: BFS from production entrypoints (services, scripts/, workers/, `packages/*/src/{index,server,main}.ts`, `packages/scheduler/src/server.ts`, `packages/agent-runtime/src/*`, `packages/worker/src/index.ts`, `packages/dashboard/{app,pages,src/app,src/pages}/`, `*.config.*`, `packages/*/scripts|bin/`). Tests treated as separate entrypoint set.
- **Dead** = not reachable from production entrypoints. Test-only reach is flagged separately.
- **Caveats**:
  - Dynamic imports / DB-driven dispatch (e.g., `runDynamicAgent`) are **not** modelled. The 16 non-executive agent folders flagged below may be loaded by such mechanisms; verify before deletion.
  - JSX/TSX side-effect-only renders (Next.js conventions outside `app/`/`pages/`) may register at runtime; treated conservatively.
  - `*.test.ts` / `__tests__/` reachability is computed but **does not** keep code "alive" for purposes of (a).
- **Last-commit dates** retrieved via `git log -1 --format=%cs`. "Last write" reflects working-tree mtime.
- **Stale-comment cutoff (60d)**: blame-based for top-12 marker files; mtime-based proxy for all others.

### Summary

| Bucket | Files |
|---|---:|
| Production-reachable | 754 |
| Test-only reachable | 397 |
| **Definitely dead** (no refs, >30d) | **61** |
| **Probably dead** (test-only OR <30d) | **126** |
| Self-only / orphan (no inbound) | 30 |
| Orphan packages | 2 |

### (a) Definitely Dead

_No inbound references; no test references; last commit > 30 days ago._

| File | LOC | Last commit | Reason flagged |
|---|---:|---|---|
| `packages/agents/src/global-admin/tools.ts` | 1582 | 2026-03-19 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/devops-engineer/tools.ts` | 516 | 2026-03-23 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/quality-engineer/tools.ts` | 312 | 2026-03-26 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/chief-of-staff/domainRouter.ts` | 300 | 2026-03-12 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/FounderBriefing.tsx` | 278 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/platform-engineer/tools.ts` | 252 | 2026-03-24 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/shared/packetSchemas.ts` | 223 | 2026-03-01 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/platform-intel/teamsCards.ts` | 215 | 2026-03-18 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/shared/codexTools.ts` | 190 | 2026-03-16 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/frontend-engineer/tools.ts` | 185 | 2026-03-12 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/competitive-intel/tools.ts` | 163 | 2026-03-22 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/hero-1.tsx` | 159 | 2026-03-23 | unreachable from prod entrypoints; no test refs |
| `packages/scheduler/src/agentLifecycle.ts` | 151 | 2026-03-19 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/ui/glowing-stars.tsx` | 129 | 2026-03-19 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/social-media-manager/tools.ts` | 127 | 2026-03-26 | unreachable from prod entrypoints; no test refs |
| `packages/agent-runtime/src/config/agentEntraRoles.ts` | 123 | 2026-03-18 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/SystemHealth.tsx` | 118 | 2026-03-25 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/design-critic/tools.ts` | 114 | 2026-03-26 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/user-researcher/tools.ts` | 113 | 2026-02-24 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/chief-of-staff/schedule.ts` | 85 | 2026-03-17 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/template-architect/tools.ts` | 81 | 2026-03-01 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/ui/glowing-effect-demo-2.tsx` | 81 | 2026-03-23 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/stories/Page.tsx` | 68 | 2026-03-09 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/ui-ux-designer/tools.ts` | 66 | 2026-03-01 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/ui/button.tsx` | 62 | 2026-03-16 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/CanvasGlow.tsx` | 62 | 2026-03-11 | unreachable from prod entrypoints; no test refs |
| `packages/worker/src/queue.ts` | 60 | 2026-03-01 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/multi-step-loader-demo.tsx` | 54 | 2026-03-24 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/stories/Header.tsx` | 52 | 2026-03-09 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/stories/Button.stories.ts` | 46 | 2026-03-09 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/AgentIcon.tsx` | 37 | 2026-02-22 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/lib/glassCard.ts` | 34 | 2026-03-18 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/stories/Button.tsx` | 34 | 2026-03-09 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/m365-admin/systemPrompt.ts` | 31 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/shared/src/middleware/auth.ts` | 31 | 2026-03-01 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/global-admin/systemPrompt.ts` | 30 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/head-of-hr/systemPrompt.ts` | 28 | 2026-03-24 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/stories/Header.stories.ts` | 28 | 2026-03-09 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/stories/Page.stories.ts` | 26 | 2026-03-09 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/.storybook/main.ts` | 25 | 2026-03-09 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/market-research-analyst/systemPrompt.ts` | 24 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/competitive-research-analyst/systemPrompt.ts` | 22 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/platform-engineer/systemPrompt.ts` | 22 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/devops-engineer/systemPrompt.ts` | 20 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/template-architect/systemPrompt.ts` | 19 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/competitive-intel/systemPrompt.ts` | 17 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/design-critic/systemPrompt.ts` | 17 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/platform-intel/config.ts` | 16 | 2026-03-26 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/user-researcher/systemPrompt.ts` | 16 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/public/sw.js` | 13 | 2026-03-15 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/.storybook/preview.ts` | 12 | 2026-03-09 | unreachable from prod entrypoints; no test refs |
| `packages/mcp-data-server/src/scopes.ts` | 10 | 2026-03-04 | unreachable from prod entrypoints; no test refs |
| `packages/mcp-design-server/src/scopes.ts` | 6 | 2026-03-04 | unreachable from prod entrypoints; no test refs |
| `packages/mcp-engineering-server/src/scopes.ts` | 6 | 2026-03-04 | unreachable from prod entrypoints; no test refs |
| `packages/mcp-marketing-server/src/scopes.ts` | 6 | 2026-03-04 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/competitive-research-analyst/tools.ts` | 5 | 2026-03-01 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/market-research-analyst/tools.ts` | 5 | 2026-03-01 | unreachable from prod entrypoints; no test refs |
| `packages/mcp-finance-server/src/scopes.ts` | 5 | 2026-03-04 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/lib/supabase.ts` | 4 | 2026-03-01 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/shared/patchHarness.ts` | 2 | 2026-03-11 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/shared/v4aDiff.ts` | 2 | 2026-03-11 | unreachable from prod entrypoints; no test refs |

### (b) Probably Dead

_No inbound from production paths, but referenced by tests **or** modified within the last 30 days._

| File | LOC | Last commit | Inbound test refs | Reason flagged |
|---|---:|---|:-:|---|
| `packages/agents/src/platform-intel/tools.ts` | 1607 | 2026-04-09 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/m365-admin/tools.ts` | 1022 | 2026-04-09 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/shared/executiveOrchestrationTools.ts` | 836 | 2026-03-30 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/head-of-hr/tools.ts` | 799 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/scheduler/src/czShadowEval.ts` | 762 | 2026-04-26 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/shared/engineeringGapTools.ts` | 732 | 2026-03-23 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/coordinatorMode.test.ts` | 712 | 2026-04-04 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/policyLimits.test.ts` | 636 | 2026-04-07 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/errorRetry.test.ts` | 602 | 2026-04-05 | yes | reachable only via tests |
| `packages/agents/src/shared/emailMarketingTools.ts` | 601 | 2026-03-05 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer16-tools.ts` | 598 | 2026-04-09 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/toolExecutor.test.ts` | 527 | 2026-04-20 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/contextCompaction.test.ts` | 494 | 2026-04-04 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/concurrentToolExecutor.test.ts` | 483 | 2026-04-04 | yes | reachable only via tests |
| `packages/agents/src/shared/teamsOutputTools.ts` | 479 | 2026-04-07 | yes | reachable only via tests |
| `packages/dashboard/src/components/governance/EnterpriseKpiDashboard.tsx` | 476 | 2026-04-17 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer18-tool-access.ts` | 465 | 2026-03-17 | yes | reachable only via tests |
| `packages/agents/src/shared/figmaTools.ts` | 454 | 2026-03-03 | yes | reachable only via tests |
| `packages/scheduler/src/agentDreamConsolidator.ts` | 439 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/shared/entraHRTools.ts` | 430 | 2026-03-11 | yes | reachable only via tests |
| `packages/agents/src/shared/userResearchTools.ts` | 424 | 2026-03-19 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer23-tenant-isolation.ts` | 423 | 2026-03-07 | yes | reachable only via tests |
| `packages/agents/src/shared/storybookTools.ts` | 417 | 2026-03-21 | yes | reachable only via tests |
| `packages/dashboard/src/components/governance/CommandCenter.tsx` | 416 | 2026-04-02 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer11-dashboard.ts` | 397 | 2026-04-07 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/hookLifecycle.test.ts` | 371 | 2026-04-04 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/memoryConsolidation.test.ts` | 354 | 2026-04-04 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer14-migrations.ts` | 353 | 2026-03-17 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer17-mcp-servers.ts` | 330 | 2026-03-16 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/circuitBreaker.test.ts` | 329 | 2026-04-04 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer15-agent-autonomy.ts` | 295 | 2026-03-12 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/awaySummary.test.ts` | 294 | 2026-04-05 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer30-tool-execution.ts` | 294 | 2026-04-05 | yes | reachable only via tests |
| `packages/agents/src/shared/webBuildTools.test.ts` | 289 | 2026-04-12 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/jitContextRetriever.test.ts` | 264 | 2026-04-02 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/reasoningEngine.test.ts` | 254 | 2026-03-23 | yes | reachable only via tests |
| `packages/scheduler/src/platformIntelApproval.ts` | 247 | 2026-04-07 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/denialTracking.test.ts` | 244 | 2026-04-04 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer27-schema-consistency.ts` | 235 | 2026-03-17 | yes | reachable only via tests |
| `packages/agents/src/shared/memoryTools.safe.ts` | 197 | 2026-04-04 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/redisCache.test.ts` | 194 | 2026-02-27 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer22-reasoning.ts` | 191 | 2026-03-18 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer04-orchestration.ts` | 190 | 2026-03-02 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer05-communication.ts` | 183 | 2026-03-11 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/buildTool.test.ts` | 178 | 2026-04-04 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer28-advancement-rollout.ts` | 175 | 2026-03-12 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer00-infra.ts` | 173 | 2026-03-02 | yes | reachable only via tests |
| `packages/agents/src/platform-intel/run.ts` | 166 | 2026-04-17 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer26-slack-platform.ts` | 161 | 2026-03-12 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer13-m365.ts` | 159 | 2026-03-11 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer24-routing.ts` | 155 | 2026-03-23 | yes | reachable only via tests |
| `packages/agents/src/shared/socialMediaTools.test.ts` | 149 | 2026-03-08 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer20-graphrag.ts` | 148 | 2026-03-06 | yes | reachable only via tests |
| `packages/design-system/src/anti-ai-smell-registry/tokens.ts` | 142 | 2026-04-21 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer25-governance-change-requests.ts` | 140 | 2026-03-16 | yes | reachable only via tests |
| `packages/agents/src/frontend-engineer/run.ts` | 128 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer19-worker.ts` | 128 | 2026-03-06 | yes | reachable only via tests |
| `packages/agents/src/platform-engineer/run.ts` | 127 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer21-world-model.ts` | 127 | 2026-03-06 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer12-voice.ts` | 120 | 2026-03-17 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer06-authority.ts` | 119 | 2026-03-11 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/skillLearning.test.ts` | 117 | 2026-03-12 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/planningPolicy.test.ts` | 116 | 2026-04-09 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer07-intelligence.ts` | 115 | 2026-03-12 | yes | reachable only via tests |
| `packages/smoketest/src/main.ts` | 112 | 2026-04-05 | yes | reachable only via tests |
| `packages/agents/src/head-of-hr/run.ts` | 109 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer03-heartbeat.ts` | 109 | 2026-03-17 | yes | reachable only via tests |
| `packages/agents/src/ui-ux-designer/run.ts` | 108 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/toolRetriever.test.ts` | 105 | 2026-04-09 | yes | reachable only via tests |
| `packages/agents/src/shared/accessAuditTools.ts` | 105 | 2026-03-16 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/jitContextSelector.test.ts` | 104 | 2026-04-02 | yes | reachable only via tests |
| `packages/agents/src/global-admin/run.ts` | 103 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/modelsValidation.test.ts` | 102 | 2026-04-18 | yes | reachable only via tests |
| `packages/agents/src/shared/figmaAuth.ts` | 101 | 2026-03-03 | yes | reachable only via tests |
| `packages/agents/src/competitive-research-analyst/run.ts` | 99 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/devops-engineer/run.ts` | 99 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/market-research-analyst/run.ts` | 99 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/m365-admin/run.ts` | 98 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer01-data-syncs.ts` | 97 | 2026-04-10 | yes | reachable only via tests |
| `packages/agents/src/template-architect/run.ts` | 96 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/taskOutcomeHarvester.test.ts` | 95 | 2026-03-17 | yes | reachable only via tests |
| `packages/agents/src/platform-intel/systemPrompt.ts` | 93 | 2026-04-06 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/sessionMemoryUpdater.test.ts` | 92 | 2026-04-02 | yes | reachable only via tests |
| `packages/agents/src/quality-engineer/run.ts` | 92 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer10-specialists.ts` | 91 | 2026-03-18 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer02-model-clients.ts` | 90 | 2026-03-02 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer29-per-run-evaluation.ts` | 88 | 2026-03-17 | yes | reachable only via tests |
| `packages/agents/src/design-critic/run.ts` | 87 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/social-media-manager/run.ts` | 85 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer09-strategy.ts` | 85 | 2026-03-02 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/historyManager.test.ts` | 84 | 2026-03-12 | yes | reachable only via tests |
| `packages/smoketest/src/utils/http.ts` | 84 | 2026-03-06 | yes | reachable only via tests |
| `packages/agents/src/user-researcher/run.ts` | 79 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/utils/report.ts` | 78 | 2026-03-01 | yes | reachable only via tests |
| `packages/agents/src/competitive-intel/run.ts` | 77 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/behavioralFingerprint.test.ts` | 72 | 2026-03-12 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer08-knowledge.ts` | 70 | 2026-03-06 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/compaction.test.ts` | 69 | 2026-03-12 | yes | reachable only via tests |
| `packages/smoketest/src/utils/db.ts` | 66 | 2026-03-01 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/domainRouter.test.ts` | 65 | 2026-03-24 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/verificationPolicy.test.ts` | 62 | 2026-04-02 | yes | reachable only via tests |
| `packages/agents/src/shared/contentTools.test.ts` | 61 | 2026-03-08 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/summaryFirstCompaction.test.ts` | 60 | 2026-04-02 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/dashboardChatEmbeds.test.ts` | 57 | 2026-04-04 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/microCompactor.test.ts` | 54 | 2026-04-02 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/subtaskRouter.test.ts` | 49 | 2026-03-24 | yes | reachable only via tests |
| `packages/smoketest/src/index.ts` | 49 | 2026-03-06 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/executionPlanning.test.ts` | 41 | 2026-04-02 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/historyCompressor.test.ts` | 39 | 2026-04-04 | yes | reachable only via tests |
| `packages/agents/src/shared/createEvalRunDeps.ts` | 38 | 2026-04-23 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/supervisorWorkloadStallPolicy.test.ts` | 36 | 2026-04-09 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/v4aDiff.test.ts` | 34 | 2026-03-11 | yes | reachable only via tests |
| `packages/smoketest/src/utils/test.ts` | 34 | 2026-03-02 | yes | reachable only via tests |
| `packages/agents/src/ui-ux-designer/systemPrompt.ts` | 31 | 2026-04-04 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/utils/gcloud.ts` | 31 | 2026-03-01 | yes | reachable only via tests |
| `packages/smoketest/src/types.ts` | 30 | 2026-03-12 | yes | reachable only via tests |
| `packages/agents/src/shared/__tests__/reactiveTurnBudget.test.ts` | 29 | 2026-04-09 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/tracing.test.ts` | 28 | 2026-04-02 | yes | reachable only via tests |
| `packages/agents/src/frontend-engineer/systemPrompt.ts` | 26 | 2026-04-04 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/quality-engineer/systemPrompt.ts` | 25 | 2026-04-04 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/actionRiskClassifier.test.ts` | 24 | 2026-04-07 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/supervisorDefaults.test.ts` | 20 | 2026-04-08 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/ssrfGuard.test.ts` | 18 | 2026-04-02 | yes | reachable only via tests |
| `packages/agents/src/shared/legalTools.ts` | 17 | 2026-03-05 | yes | reachable only via tests |
| `packages/agents/src/shared/hrTools.ts` | 13 | 2026-03-05 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/taskIdentity.test.ts` | 11 | 2026-03-10 | yes | reachable only via tests |

### (c) Stale Comments / TODOs (>60 days)

Methodology: scanned all source for `TODO|FIXME|XXX|HACK|DEPRECATED|@ts-ignore|eslint-disable` (case-insensitive). 142 markers across 52 files. Two filters applied:

1. **Blame-based** (top-12 marker files, `git blame --line-porcelain`): a line's author-time > 60 days ago.
2. **mtime proxy** (all other files): file last-modified > 60 days ago â€” flags the file holistically.

#### (c.1) Blame-confirmed stale lines

**`packages/agent-runtime/src/providers/openai.ts`** (3 stale)

| Date | SHA | Line |
|---|---|---|
| 2026-02-24 | `068a0a24` | `// eslint-disable-next-line @typescript-eslint/no-explicit-any` |
| 2026-02-25 | `7fd614b3` | `// eslint-disable-next-line @typescript-eslint/no-explicit-any` |
| 2026-02-25 | `7d33954f` | `// eslint-disable-next-line @typescript-eslint/no-explicit-any` |

**`packages/agent-runtime/src/providers/gemini.ts`** (3 stale)

| Date | SHA | Line |
|---|---|---|
| 2026-02-24 | `068a0a24` | `// eslint-disable-next-line @typescript-eslint/no-explicit-any` |
| 2026-02-24 | `068a0a24` | `// eslint-disable-next-line @typescript-eslint/no-explicit-any` |
| 2026-02-24 | `068a0a24` | `// eslint-disable-next-line @typescript-eslint/no-explicit-any` |

**`packages/agents/src/competitive-intel/tools.ts`** (1 stale)

| Date | SHA | Line |
|---|---|---|
| 2026-02-22 | `27195001` | `parameters: { source: { type: 'string', description: 'Source (github, hackernews, producthunt, pricing, etc.)', required: true }, subject: {` |

_Most marker-bearing files (e.g., `claudeParityTools.ts`, `models.ts`, `validate-db-models.js`) have all current TODO/FIXME lines authored within the last 60 days â€” no blame-stale entries._

#### (c.2) mtime-stale marker-bearing files (>60d unmodified)

| File | Markers | Last write |
|---|---:|---|
| `packages/dashboard/src/stories/Header.stories.ts` | 2 | 1984-06-22 (Storybook scaffold) |
| `packages/dashboard/src/stories/Button.stories.ts` | 2 | 1984-06-22 (Storybook scaffold) |

_The 1984 timestamp is the Storybook generator default; both files are flagged as Definitely Dead in Â§(a)._

### (d) Files imported only by themselves or in cycles

_No incoming edges from any other file (excluding self), but the file does have outgoing imports â€” i.e. it imports things, but nothing imports it._

| File | LOC |
|---|---:|
| `packages/agent-runtime/src/config/agentEntraRoles.ts` | 123 |
| `packages/agents/src/chief-of-staff/domainRouter.ts` | 300 |
| `packages/agents/src/competitive-intel/run.ts` | 77 |
| `packages/agents/src/competitive-research-analyst/run.ts` | 99 |
| `packages/agents/src/design-critic/run.ts` | 87 |
| `packages/agents/src/devops-engineer/run.ts` | 99 |
| `packages/agents/src/frontend-engineer/run.ts` | 128 |
| `packages/agents/src/global-admin/run.ts` | 103 |
| `packages/agents/src/head-of-hr/run.ts` | 109 |
| `packages/agents/src/m365-admin/run.ts` | 98 |
| `packages/agents/src/market-research-analyst/run.ts` | 99 |
| `packages/agents/src/platform-engineer/run.ts` | 127 |
| `packages/agents/src/platform-intel/run.ts` | 166 |
| `packages/agents/src/quality-engineer/run.ts` | 92 |
| `packages/agents/src/shared/createEvalRunDeps.ts` | 38 |
| `packages/agents/src/shared/executiveOrchestrationTools.ts` | 836 |
| `packages/agents/src/shared/memoryTools.safe.ts` | 197 |
| `packages/agents/src/shared/patchHarness.ts` | 2 |
| `packages/agents/src/shared/v4aDiff.ts` | 2 |
| `packages/agents/src/social-media-manager/run.ts` | 85 |
| `packages/agents/src/template-architect/run.ts` | 96 |
| `packages/agents/src/ui-ux-designer/run.ts` | 108 |
| `packages/agents/src/user-researcher/run.ts` | 79 |
| `packages/dashboard/src/components/governance/CommandCenter.tsx` | 416 |
| `packages/dashboard/src/components/governance/EnterpriseKpiDashboard.tsx` | 476 |
| `packages/dashboard/src/components/FounderBriefing.tsx` | 278 |
| `packages/dashboard/src/components/SystemHealth.tsx` | 118 |
| `packages/dashboard/src/lib/supabase.ts` | 4 |
| `packages/dashboard/src/stories/Button.stories.ts` | 46 |
| `packages/dashboard/src/stories/Header.stories.ts` | 28 |

**Notable pattern â€” non-executive agent runners.** `packages/agents/src/index.ts` exports only **12** of **28** agent folders. The remaining **16** have a `run.ts` that nothing imports:

```
competitive-intel, competitive-research-analyst, design-critic, devops-engineer,
frontend-engineer, global-admin, head-of-hr, m365-admin, market-research-analyst,
platform-engineer, platform-intel, quality-engineer, social-media-manager,
template-architect, ui-ux-designer, user-researcher
```

These agents may be loaded via `runDynamicAgent` (DB-defined per the `index.ts` comment), in which case the file-based runner is genuinely orphaned and should either be deleted or wired into a registry. Their sibling `tools.ts` and `systemPrompt.ts` modules drag along thousands of LOC (see Â§(a) â€” `global-admin/tools.ts` alone is 1,582 LOC).

### (e) Exported symbols never imported externally

_A full per-symbol audit was not performed (cost-prohibitive without a TypeScript language-service pass). Heuristic findings:_

- The 60 files in Â§(a) that ship `export` declarations (most do) export symbols that are by definition never imported.
- `packages/agents/src/shared/packetSchemas.ts` (223 LOC, 2026-03-01) â€” exports zod schemas referenced nowhere.
- `packages/agents/src/shared/codexTools.ts` (190 LOC, 2026-03-16) â€” `createCodexTools` factory unused.
- `packages/agents/src/shared/executiveOrchestrationTools.ts` (836 LOC, 2026-03-30) â€” flagged Â§(b); reachable only from tests.
- `packages/scheduler/src/agentLifecycle.ts` (151 LOC, 2026-03-19) and `packages/scheduler/src/agentDreamConsolidator.ts` (439 LOC, 2026-04-11) â€” exported but no inbound from `server.ts` or other scheduler entrypoints.
- `packages/worker/src/queue.ts` (60 LOC, 2026-03-01) â€” exported queue helper not consumed by `worker/src/index.ts`.
- `packages/agent-runtime/src/config/agentEntraRoles.ts` (123 LOC, 2026-03-18) â€” config map exported but unread.

_Recommend a follow-up pass with `ts-prune` or `knip` once the package-graph stabilises._

### (f) Entire packages whose only consumers are other dead code

| Package | Files | LOC | Notes |
|---|---:|---:|---|
| `packages/agent-sdk` | 3 | 116 | no inbound from any other package |
| `packages/design-system` | 1 | 142 | no inbound from any other package |

- **`packages/agent-sdk`** â€” 3 files, 116 LOC. Not imported by any other workspace package. Either pre-public-API scaffolding or a stale extraction; verify intent before keeping.
- **`packages/design-system`** â€” 1 file, 142 LOC. Not consumed by `dashboard` or any other package. Likely an aborted extraction; the dashboard inlines its own `components/ui/*` instead.

### Recommendations (severity-ranked)

1. **High â€” agents package bloat.** ~7,000 LOC across 16 non-executive agent folders is unreachable from `packages/agents/src/index.ts`. Either (a) export them, (b) document `runDynamicAgent` as the entrypoint and add an integration test that proves it, or (c) delete.
2. **High â€” dashboard component graveyard.** 20 dashboard files in DD (`FounderBriefing.tsx` 278 LOC, `hero-1.tsx` 159 LOC, `SystemHealth.tsx` 118 LOC, `CommandCenter.tsx` 416 LOC, `EnterpriseKpiDashboard.tsx` 476 LOC, etc.) â€” none referenced from the Next.js `app/`/`pages/` tree. Delete or wire up.
3. **Medium â€” orphan workspace packages.** `agent-sdk` and `design-system` add npm-install latency and TS project-reference noise without consumers.
4. **Medium â€” scheduler dead modules.** `agentLifecycle.ts`, `agentDreamConsolidator.ts`, `czShadowEval.ts` (762 LOC, recent) are not wired into `server.ts`. Verify they aren't scheduled via Cloud Scheduler HTTP routes (those would not show up in static imports).
5. **Low â€” TODO hygiene.** Only 7 blame-stale comment lines (>60d) across the top marker files; backlog is healthy. No action required beyond resolving the 3 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` lines in `providers/openai.ts` / `gemini.ts`.

---

## Section 08 -- Schema/Doc Drift between docs/ARCHITECTURE.md and reality

Most quantitative claims verify, but the highest-severity drifts are: `/policy/collect`, `/policy/evaluate`, `/policy/canary-check` documented in Section 7.1 but absent from `server.ts`; Section 6.7 and Section 6.9 use the same layer numbers (L6/L7/L8) for different concepts; ~15 live scheduler ingress endpoints (incl. `/run/stream`, `/api/cz/*`, `/admin/*`, `/platform-intel/*`) are undocumented; the internal `cz-protocol` route is wired but missing from the page list; `EXEC_CHAT_MODEL` and `DEFAULT_AGENT_MODEL` are both `'model-router'`, making the documented exec lane a no-op.

See: [section-08-drift.md](diagnostic-2026-04-27/section-08-drift.md)


Doc audited: `docs/ARCHITECTURE.md` (1628 lines, 71,445 bytes, "Last updated: 2026-04-27").
Repo state taken at audit time. Severity: **low** = stale numeric / name; **med** = missing component, named gate not implemented as described, wrong wiring; **high** = documented feature does not exist or contradicts implementation in a way that misleads change-makers.

### 8.1 Drift table â€” concrete, verifiable claims

| # | Doc line(s) | Doc says (verbatim short quote) | Code says (path:line) | Severity |
|---|---|---|---|---|
| 1 | L25 | "Integration modules under packages/integrations/src: 22" | `Get-ChildItem packages/integrations/src` returns **23** subdirectories (the documented 22 plus an extra `kling/` directory that exists on disk). `packages/integrations/src/kling/` is present (empty / orphan) and not enumerated in the L260â€“281 list. | low |
| 2 | L259â€“281 | "Current integration modules (22): â€¦ docusign, facebook, gcp, github, governance, linkedin, â€¦" | `packages/integrations/src/kling/` exists on disk but is omitted from the list. The L1226 deprecation note only documents `pulse` removal, not `kling` orphaning. | low |
| 3 | L24 | "Workspace packages under packages: 25" | `Get-ChildItem packages` returns 25 dirs â€” matches. | (no drift) |
| 4 | L26, L202â€“231 | "File-based agent role directories under packages/agents/src: 28" + the 28-name list | `packages/agents/src/*` (excluding `shared`) returns **28** dirs and names match â€” order in doc is not alphabetical but contents are identical. | (no drift) |
| 5 | L27, L1054â€“1090 | "Dashboard page modules under packages/dashboard/src/pages: 36" + 36-name list | `packages/dashboard/src/pages/*` returns **36** files, names match. | (no drift) |
| 6 | L28 | "SQL migrations under db/migrations: 326" | `Get-ChildItem db/migrations` returns **326** files. | (no drift) |
| 7 | L29, L1493â€“1509 | "Docker build files under docker (Dockerfile.*): 17" + 17-name list | `docker/Dockerfile.*` returns **17**, names match exactly. | (no drift) |
| 8 | L30, L1559â€“1591 | "Smoketest layers under packages/smoketest/src/layers: 31 (layer 0-30)" + table | `packages/smoketest/src/layers/layer00..layer30` returns **31** files, names match the documented purposes. | (no drift) |
| 9 | L32, L1138, L1276 | "Dashboard TABLE_MAP aliases in packages/scheduler/src/dashboardApi.ts: 88 aliases mapped to 60 physical tables" | `packages/scheduler/src/dashboardApi.ts:170` â€” TABLE_MAP literal contains **88** alias keys mapped to **60** distinct physical tables. | (no drift) |
| 10 | L31, L962â€“989 | "27 internal path routes" / explicit list of 26 routes + `* -> dashboard` catch-all | `packages/dashboard/src/App.tsx:128â€“157` actually wires **27** route entries inside `app/internal`, but one of them â€” `<Route path="cz-protocol" â€¦/>` at `App.tsx:153` (redirect to `governance?tab=certification`) â€” is **missing from the documented list**. The numeric count happens to match because the doc lists 26 + catch-all; reality is 26 + cz-protocol + catch-all = 28 path entries (or 27 if you treat catch-all separately). | med |
| 11 | L991â€“1002 | "SMB Mode â€¦ 7 SMB path routes" + list | `App.tsx:159â€“169` wires `dashboard, team, work, approvals, insights, settings, onboarding` plus catch-all â€” the 7 explicit paths match. | (no drift) |
| 12 | L233â€“238 / L433â€“437 | "Runner selection is centralized in shared/createRunner.ts: on_demand task -> CompanyAgentRunner; orchestrator roles -> OrchestratorRunner; all other role/task combinations -> TaskRunner" | `packages/agents/src/shared/createRunner.ts:36â€“53` matches: `task === 'on_demand'` â†’ CompanyAgentRunner; `ORCHESTRATOR_ROLES.has(role)` â†’ OrchestratorRunner; else â†’ TaskRunner. | (no drift) |
| 13 | L740â€“744 | "1. Explicit per-agent model override from `company_agents.model` â€¦ wins. 2. role cost tier â€¦ 3. for on_demand runs with pro tier roles, use EXEC_CHAT_MODEL." | `packages/shared/src/models.ts:684â€“703` `optimizeModel` implements override â†’ tier â†’ on_demand+proâ†’EXEC_CHAT_MODEL. Matches. | (no drift) |
| 14 | L182, L637 (claim) / models.ts | "Tier model map (TIER_MODELS) binds each tier to a concrete default model" + "EXEC_CHAT_MODEL is a special override only for founder-facing on_demand conversations on pro roles" | `packages/shared/src/models.ts:182` `DEFAULT_AGENT_MODEL = 'model-router'` and `:637` `EXEC_CHAT_MODEL = 'model-router'` â€” both resolve to the same value `'model-router'`, so the documented "special override" is functionally a no-op vs the default. Doc implies they differ. | med |
| 15 | L784 | "single-model mode resolves user-selected model or defaults to `gpt-5.4`" | (Triangulation default) â€” needs verification in source; doc names a specific model ID `gpt-5.4`. Not explicitly checked in this section; flag for follow-up. | low (unverified) |
| 16 | L848â€“850 | "POST /policy/collect â€¦ POST /policy/evaluate â€¦ POST /policy/canary-check" listed under scheduler API surface (table 7.1) | `packages/scheduler/src/server.ts` â€” grep `policy/(collect|evaluate|canary-check)` returns **no matches**. These three endpoints do not exist in the running scheduler. (`/canary/evaluate` does exist at server.ts:4123, distinct from `/policy/canary-check`.) | **high** |
| 17 | L820â€“859 (Section 7.1 endpoint matrix) | Doc enumerates ingress endpoints for Section 7.1 | server.ts also implements numerous ingress routes **not in the doc**: `/run/stream` (server.ts:4569), `/run/events` (4486), `/run/events/stream` (4517), `/sync/openai-billing`, `/sync/anthropic-billing`, `/sync/aws-billing` (3701â€“3709), `/webhook/ci-heal` (3553), `/memory/agent-dream` (3973), `/trust/monitor` (4206), `/admin/metrics/*` (529), `/admin/commitments[/pending]`, `/admin/autonomy[/cohort-benchmarks]` (495â€“496), `/api/cz/*` including `/api/cz/loop/tick`, `/api/cz/shadow/backfill` (562â€“564, 6837), `/api/eval/*` (6831), `/platform-intel/*` (3481). | med |
| 18 | L830â€“832 | "POST /sync/stripe â€¦ /sync/gcp-billing â€¦ /sync/mercury â€¦ /sync/sharepoint-knowledge â€¦ /sync/governance" (sync surface) | All five exist (server.ts:3640, 3662, 3742, 3764, 3794). Three additional sync endpoints exist undocumented â€” see row 17. | low (subset of 17) |
| 19 | L867â€“868 | "POST /api/messages | Agent365 activity message ingress" + "/api/agent365/activity" | server.ts:4481 handles both as a single combined branch â€” matches. | (no drift) |
| 20 | L877â€“879 | "POST /agents/:agentId/pause â€¦ resume â€¦ DELETE /agents/:agentId" | server.ts:5391 (pause), :5454 (resume) confirmed. DELETE not directly checked in this section but referenced via hard-purge (`hard=true` query at :5477). Routing is via path matching not Express verbs, so the table format is loose. | low |
| 21 | L944 | "POST /plan-verify/:directiveId" | server.ts:6781 `url.match(/^\/plan-verify\/([^/?]+)$/)` confirmed. | (no drift) |
| 22 | L950 | "GET, POST /api/graph/chat-webhook" | server.ts:3320 defines `GRAPH_CHAT_WEBHOOK_PATH = '/api/graph/chat-webhook'`. Confirmed. | (no drift) |
| 23 | L953â€“954 | "* /api/governance/* (Delegated governance API handler)" + "* /api/* (Delegated dashboard CRUD API handler)" | server.ts:6853 (`/api/governance/`) and :6896 (`/api/`) confirmed. | (no drift) |
| 24 | L317 | "Onboarding gate (`OnboardingEntryGate`) routes to mode-specific onboarding" | App.tsx:55 `OnboardingEntryGate` defined and wired at :174â€“175. Confirmed. | (no drift) |
| 25 | L1011â€“1014 | "/agents/:agentId -> LegacyAgentRedirect (-> /app/internal/agents/:agentId)" + LegacyAgentSettingsRedirect + LegacyChatRedirect + skills/:slug | App.tsx:77â€“90 and :176â€“179 â€” confirmed. | (no drift) |
| 26 | L1019â€“1036 | 18 legacy bare-path redirects | App.tsx:92â€“121 `LEGACY_INTERNAL_REDIRECTS` array contains exactly 18 entries up to `settings`. Confirmed. | (no drift) |
| 27 | L1038â€“1049 | 10 semantic alias redirects (`/agents`, `/chat`, `/activity`, `/graph`, `/capabilities`, `/meetings`, `/world-model`, `/group-chat`, `/policy`, `/models`) | App.tsx:111â€“120 contains all 10. Confirmed. | (no drift) |
| 28 | L482â€“493 (Intelligence Layers L0â€“L9) | Layer model is L0 Signal Intake â€¦ L9 Governance and Oversight | Component classes referenced (`EventRouter`, `WakeRouter`, `HeartbeatManager`, `DynamicScheduler`, `createRunner`, `JitContextRetriever`, `ToolExecutor`, `FormalVerifier`, `TrustScorer`, `DecisionQueue`) all exist in repo. The numbering & naming is doc-only and not encoded in source â€” non-falsifiable but plausible. | (no drift / aspirational mapping) |
| 29 | L519â€“534 (Failure Semantics table) | Layer numbers in 6.9 differ from 6.7: 6.9 calls **L7 = "Workflow Orchestration"** but 6.7 calls L7 = "Trust and Adaptation"; 6.9 L6 = "Assurance" matches; 6.9 L8 = "Learning/Trust" but 6.7 L8 = "Learning and Memory" | The two layer-numbering tables in the same document are **internally inconsistent** (different meanings for L6/L7/L8). This is a self-contradiction, not a code drift, but will mislead any engineer mapping incidents to architecture. | med |
| 30 | L545 | "Standard tool timeout: 30s. Long-running tool timeout: 120s." | Specific timeout constants â€” not verified end-to-end in this section; flag for spot-check in toolExecutor.ts. | low (unverified) |
| 31 | L554 | "Step retries use exponential backoff (30s, 60s, 120s)" + "wait_* steps fail after max wait window (48h)" | Specific constants â€” not verified in this section. | low (unverified) |
| 32 | L1226 | "20260401143000_deprecate_pulse_creative_stack.sql (removed pulse integration module)" | The migration file exists and the doc's L259â€“281 integration list correctly omits `pulse`. The `kling` directory still exists on disk (see row 1) despite the L1254 "strip_kling_from_skills" migration; doc does not call it out. | low |
| 33 | L1166â€“1170 | "Deliverable and initiative outputs â€¦ deliverables; Ora session state â€¦ ora_sessions" | Both physical tables present in TABLE_MAP. Confirmed. | (no drift) |
| 34 | L1278â€“1339 (TABLE_MAP matrix) | Lists 60 physical tables and 88 aliases | All 60 physical names present in source TABLE_MAP. Spot-check: `incidents`, `founder_bulletins`, `dashboard_change_requests` all present. | (no drift) |
| 35 | L1370 | "Scheduled: daily via Cloud Scheduler cron (tool-health-check) at 06:00 UTC" | Cloud Scheduler config not verified in this section; flag for follow-up. | low (unverified) |
| 36 | L1413â€“1418 | runtime additions list (`skillLearning.ts, behavioralFingerprint.ts, subtaskRouter.ts, taskOutcomeHarvester.ts, dynamicToolExecutor.ts, runtimeToolFactory.ts, â€¦`) | Files cited in Â§11 not exhaustively verified to exist in `packages/agent-runtime/src`; spot-check needed. | low (unverified) |
| 37 | L585â€“586 (Sequence diagram 6.10.1) | "X-->>A: CompanyAgentRunner / OrchestratorRunner / TaskRunner" â€” runner returned to A from createRunner X | Matches createRunner.ts:36â€“53 actual return type union. | (no drift) |
| 38 | L18 | "Stripe, Mercury, GCP, Teams/Graph, Azure OpenAI / Foundry, Anthropic, SharePoint, GitHub, Vercel, Canva, DocuSign, Cloudflare" â€” 12 named integrations in summary | All 12 names appear as directories under `packages/integrations/src` (sometimes via `azure`, `agent365`, etc.). Note: doc does **not** mention `aws`, `posthog`, `sendgrid`, `linkedin`, `facebook`, `search-console`, `credentials`, `governance`, `openai` here even though they are dirs. Aspirational summary â€” non-binding. | (no drift) |

### 8.2 Top-10 highest-severity drifts (ranked)

1. **(High) `/policy/collect`, `/policy/evaluate`, `/policy/canary-check` are documented but do not exist.** L848â€“850 of the doc places these in the canonical scheduler API matrix (Section 7.1). A grep of `packages/scheduler/src/server.ts` finds zero references. Any operator following Section 7.1 to wire policy automation will fail. (Row 16.)

2. **(Med) Section 6.7 vs Section 6.9 use the same layer numbers (L6/L7/L8) for different concepts.** 6.7 maps L7â†’"Trust and Adaptation" and L8â†’"Learning and Memory"; 6.9 maps L7â†’"Workflow Orchestration" and L8â†’"Learning/Trust". Engineers mapping incidents (6.9) to architecture (6.7) will mis-route ownership. (Row 29.)

3. **(Med) Significant scheduler ingress surface is undocumented.** `/run/stream`, `/run/events`, `/run/events/stream`, three additional `/sync/*-billing` endpoints, `/webhook/ci-heal`, `/memory/agent-dream`, `/trust/monitor`, `/admin/metrics`, `/admin/commitments`, `/admin/autonomy`, `/api/cz/*` (incl. internal-service-only loop tick + shadow backfill), `/platform-intel/*`, `/api/eval/*` are all live but absent from Â§7. Engineers consulting Â§7 to understand the public API surface will under-count by ~15+ endpoints, including ones with stricter auth modes. (Row 17.)

4. **(Med) Internal dashboard route `cz-protocol` is implemented but undocumented.** `App.tsx:153` wires `/app/internal/cz-protocol` â†’ governance?tab=certification, but L962â€“989 omits it entirely. CZ is a recurring theme in recent migrations (L1262â€“1272), so the omission obscures an active feature surface. (Row 10.)

5. **(Med) `EXEC_CHAT_MODEL === DEFAULT_AGENT_MODEL === 'model-router'`.** Doc (L742, L761, L784) describes EXEC_CHAT_MODEL as a "special override only for founder-facing on_demand conversations on pro roles" â€” implying differential behavior. In `packages/shared/src/models.ts:182,637` both constants are the literal `'model-router'`, so the documented "tier-aware exec lane" is currently a no-op. (Row 14.)

6. **(Low) `packages/integrations/src` count is 23, not 22.** The `kling/` directory exists (empty) and is unmentioned, despite the March 2026 `strip_kling_from_skills` migration. Integration drift checklist (L1607) is therefore stale. (Rows 1, 2, 32.)

7. **(Low, unverified â€” high if true) Triangulation default model `gpt-5.4`.** L784 hardcodes a specific model ID as the documented default. Model registry has been actively edited (e.g., L1255 "replace_claude_sonnet_with_gemini_flash_lite"), so this is high risk for staleness. Needs source verification. (Row 15.)

8. **(Low, unverified â€” med if wrong) Tool execution timeouts (`30s` standard / `120s` long-running) and workflow retry backoff (`30s, 60s, 120s`, `48h` wait window).** These exact constants in Â§6.9 should be code-verified; if drifted, on-call playbooks (Â§6.12) will mis-time SLO breaches. (Rows 30, 31.)

9. **(Low) Â§10.4 migration recap is dated.** Lists end at the 20260422 (April 22) cz_shadow_eval migration; with 326 total migrations and the doc dated 2026-04-27, the most recent ~5 days of migrations are not summarized. Risk that newer schema changes (especially around CZ) are invisible to readers of Â§10. (Aggregate of L1176â€“1273.)

10. **(Low) Â§1 executive summary integration list (L18) under-enumerates the integration plane.** Names ~12 of the 22 actual modules (omits aws, posthog, sendgrid, linkedin, facebook, search-console, credentials, governance, openai). Aspirational, but readers may anchor on this rather than Â§5.5. (Row 38.)

### 8.3 Methodology notes

- Every "no drift" row was confirmed by direct filesystem read or regex extraction (TABLE_MAP, App.tsx routes, createRunner.ts, optimizeModel, server.ts route guards).
- "Unverified" rows are ones where the claim is concrete and falsifiable but full verification was out of scope for this section; they are flagged low pending spot-check.
- Doc claims that are purely aspirational language (principles in Â§3, intelligence-mode descriptions in Â§6.8 without code anchors) were skipped per task instructions.
- Sequence diagrams (Â§6.10.1â€“6.10.3) were checked for participantâ†”code-symbol consistency; no contradictions found.

---

## Section 09 -- Coupling, Complexity, and God Tables

Package graph is a clean DAG: `shared` fan-in 11, `agent-runtime` fan-in 7, `scheduler` highest fan-out (5), no cycles. Complexity concentrates in `packages/scheduler/src/server.ts` (7,123 LOC, 2,249 branches), `companyAgentRunner.ts` (4,517 LOC, 1,377 branches), and inside two enormous functions: `saveStructuredCheckpoint` (1,631 LOC) and `toolExecutor.execute` (1,158 LOC). God tables: `company_agents` (57 cols, 22 writers), `activity_log` (22 cols, 45 writers), `task_run_outcomes` (54 cols), `agent_runs` (39 cols).

See: [section-09-coupling.md](diagnostic-2026-04-27/section-09-coupling.md)


**Audit date:** 2026-04-27
**Scope:** Top-level packages under `packages/`, source files (`.ts/.tsx/.js/.jsx/.mjs/.cjs`, excluding `node_modules`, `dist`, `.next`, `build`, `.turbo`, `.venv`, `coverage`, `out`, `__pycache__`, `.d.ts`).
**Methodology scripts:** `scratch/s9-coupling.js`, `scratch/s9-tables.js` (committed for reproducibility).

---

### 9.1 Fan-in / Fan-out per package

**Method.** For every TS/JS source file inside `packages/<pkg>/`, regex-extract `import â€¦ from 'â€¦'`, `require('â€¦')`, and dynamic `import('â€¦')` specifiers. Map specifiers starting with `@glyphor/<name>` to their owning package directory (via `package.json` `name`). Self-imports excluded. Fan-in = number of *other* `@glyphor/*` packages that reference this package. Fan-out = number of *other* `@glyphor/*` packages this package references.

Sorted by fan-in descending, then fan-out.

| Package | Fan-in | Fan-out | Imports |
|---|---|---|---|
| `shared` | 11 | 0 | â€” |
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
| `agent-sdk` | 0 | 0 | â€” |
| `company-knowledge` | 0 | 0 | â€” |
| `design-system` | 0 | 0 | â€” |
| `graphrag-indexer` | 0 | 0 | â€” |
| `mcp-data-server` | 0 | 0 | â€” |
| `mcp-design-server` | 0 | 0 | â€” |
| `mcp-email-marketing-server` | 0 | 0 | â€” |
| `mcp-engineering-server` | 0 | 0 | â€” |
| `mcp-finance-server` | 0 | 0 | â€” |
| `mcp-hr-server` | 0 | 0 | â€” |
| `mcp-legal-server` | 0 | 0 | â€” |
| `mcp-marketing-server` | 0 | 0 | â€” |
| `mcp-slack-server` | 0 | 0 | â€” |

#### Observations

- **`shared`** is the universal sink (fan-in 11, fan-out 0) â€” healthy "kernel" position.
- **`agent-runtime`** has the second-highest fan-in (7) and is the de-facto runtime kernel; any breaking change ripples broadly.
- **`scheduler`** has the highest fan-out (5). It is the only package importing four other internal packages â€” it acts as an orchestrator/composition root for backend jobs.
- All `mcp-*` packages, `agent-sdk`, `company-knowledge`, `design-system`, and `graphrag-indexer` are isolated leaves (0/0). Either they are independently published artifacts (intentional) or they're under-integrated. Worth confirming intent.
- `dashboard`, `slack-app`, `a2a-gateway`, `voice-gateway`, `worker`, `smoketest` are all sinks (fan-in 0) â€” they are application entry points, which is correct.

---

### 9.2 Cyclic package dependencies

**Method.** DFS over the `@glyphor/*` import graph from Â§9.1, detecting back-edges to in-stack nodes. Cycles deduplicated by canonical node-set + length.

**Result: âœ… No cyclic package dependencies detected.**

The graph is a DAG with `shared` at the bottom and application entry points (`worker`, `dashboard`, `voice-gateway`, `slack-app`, `a2a-gateway`, `smoketest`) at the top. Confirmed independently with the heuristic script (`scratch/s9-coupling.js`).

> Caveat: this only covers cross-package `@glyphor/*` imports. Intra-package module cycles within a single `src/` tree were *not* analyzed in this section (deferred â€” would require `madge` against compiled output or per-file dependency graph).

---

### 9.3 Top files by approximate cyclomatic complexity

**Method.** For each source file, count occurrences of branch tokens
`\b(if|else|for|while|case|catch)\b` and `&&`, `||`, `?`. This is a
**raw branch-keyword count** â€” a coarse proxy for cyclomatic complexity (it
double-counts `||` in default-value expressions and counts `?` in optional
chaining/ternary alike). LOC = total newlines. Density = branches / LOC.
External vendored content (`.venv`, `node_modules`) excluded.

#### 9.3a â€” Top 10 by raw branch-keyword count (the "biggest hot spots")

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

#### 9.3b â€” Top 10 by branch density (LOC â‰¥ 50, finds *concentrated* logic)

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

#### Observations

- `packages/scheduler/src/server.ts` is the single biggest complexity sink in the codebase: 7.1k LOC and 2.2k branch tokens.
- `packages/agent-runtime/src/companyAgentRunner.ts` (4.5k LOC, 1.4k branches) is second, and contains the longest function (see Â§9.4).
- Three Bedrock/AI provider files (`bedrockDeepseek`, `bedrockAnthropic`) and `nexusRunSummary` show very high density (>0.5) â€” likely tight conditional decoding/parsing logic; good candidates for table-driven refactors.

---

### 9.4 Top 10 longest functions

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

#### Observations

- **`saveStructuredCheckpoint` at 1631 LOC is an extreme outlier** â€” larger than most entire files in the repo. It alone accounts for ~36% of `companyAgentRunner.ts`.
- **`toolExecutor.execute` (1158 LOC)** and **`modelClient.generate` (244 LOC)** are the two other major monoliths in the runtime hot path.
- `Chat.tsx` has two overlapping mega-functions (`sendMessage` 425 LOC, `invokeAgent` 365 LOC, with `invokeAgent` nested inside `sendMessage`).
- The four `describe()` test suites are not refactor targets per se, but the size correlates with implementation complexity (e.g., `toolExecutor.test.ts` 534-line suite â†” `toolExecutor.execute` 1158-LOC method).

---

### 9.5 God tables

**Method (column count).** For every `.sql` file under `db/`, regex-match
`CREATE TABLE [IF NOT EXISTS] <name> ( â€¦ )` and count comma-separated
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

#### 9.5a â€” Tables with > 20 columns (top 41)

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

#### 9.5b â€” Tables with > 10 distinct writer files

| Table | # writer files |
|---|---|
| `activity_log` | 45 |
| `company_agents` | 22 |
| `agent_messages` | 16 |
| `work_assignments` | 16 |
| `agent_prompt_versions` | 11 |

#### 9.5c â€” Top 15 tables by writer count (informational)

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

#### Observations

- **Both axes converge on the same offenders:** `company_agents` (57 cols / 22 writers), `activity_log` (22 cols / 45 writers), `work_assignments` (27 cols / 16 writers), `decisions` (26 cols / 7 writers).
- `activity_log` has by far the most writer files (45). Despite being only 22 columns wide, it's an event-sink that ~6% of the repo's TS files touch directly. Strong candidate to be replaced by a typed event-emitter API rather than direct INSERT-statement scatter.
- `company_agents` (57 columns) is the single widest table in the schema and is written from 22 places. This is a classic "godfather" entity table â€” refactoring it requires a per-aspect split (identity / config / status / capabilities / metrics).
- `task_run_outcomes` (54 cols) and `agent_runs` (39 cols) bracket the runtime telemetry surface â€” also strong candidates for vertical split (hot fields vs. cold metadata).
- The cluster of 30-35 col tables (`kg_edges`, `kg_facts`, `kg_nodes`, `agent_world_model`, `workflows`/`workflow_steps`, `run_sessions`/`run_attempts`/`run_events`, `tool_registry`, `sharepoint_sites`) reflects ambitious feature surfaces created in single migrations â€” none individually alarming, but collectively they suggest the schema favours wide tables over normalized child tables.

---

### Reproducibility

The two analysis scripts are committed under `scratch/`:

- `scratch/s9-coupling.js` â€” fan-in/out, cycles, complexity, longest functions
- `scratch/s9-tables.js` â€” schema column counts, writer counts

Run with `node scratch/s9-coupling.js && node scratch/s9-tables.js` from
the repo root. Outputs land in `scratch/s9-coupling-out.md` and
`scratch/s9-tables-out.md` respectively. No external `npm install` or
network calls required (heuristics only â€” `madge` was *not* installed,
per the time-boxed instructions).

### Recommended follow-ups (deferred to remediation phase)

1. Break `companyAgentRunner.ts` (4.5k LOC) and `toolExecutor.ts` (2k LOC) â€” `saveStructuredCheckpoint` (1631 LOC) and `execute` (1158 LOC) should each be decomposed into a state machine.
2. Split `scheduler/src/server.ts` (7.1k LOC) along its route groups â€” it already has sibling files like `dashboardApi.ts`, `capacityAdminApi.ts`, `departmentAdminApi.ts`; the rest should follow.
3. Vertically split `company_agents` (57 cols) and `task_run_outcomes` (54 cols).
4. Wrap `activity_log` writes in a single typed helper to remove the 45-file scatter.
5. Run intra-package cycle detection (`madge --circular packages/<pkg>/src` per package) â€” not done in this section.

---

## Section 10 -- Eval and Quality-Signal Coverage

Only 4 of 29 roles (`cmo`, `cto`, `cfo`, `chief-of-staff`) have a wired, judge-scored task-quality eval. 23 of 47 seeded `agent_eval_scenarios` rows are silently skipped on every cron tick because `agentKnowledgeEvaluator.RUNNERS` only registers 5 roles. Per-run quality score is a deterministic function of crash/cost signals, not output quality. Tier-3 behavioural tool tests cover 5 tools out of ~150. `assignment_evaluations` has six writers all gated on couplings nothing forces; the codebase's own verifier prints "(empty -- expected before evaluators run)". No eval results are checked in.

See: [section-10-evals.md](diagnostic-2026-04-27/section-10-evals.md)


Audit date: 2026â€‘04â€‘27. Scope: every eval surface that could be used to judge agent task quality.

---

### 10.1 Eval definitions in the codebase

#### Schema (DDL)

| Table / view | Purpose | Defined at |
| --- | --- | --- |
| `agent_eval_scenarios` | Library of judgeâ€‘scored scenarios (input prompt + pass/fail criteria + tags) | `db/migrations/20260314000100_agent_knowledge_evals.sql:4` |
| `agent_eval_results` | One row per scenario Ã— run, stores PASS / SOFT_FAIL / HARD_FAIL judge verdict | `db/migrations/20260314000100_agent_knowledge_evals.sql:52` |
| `agent_readiness` (view) | Latest pass-rate rollup per role | `db/migrations/20260314000100_agent_knowledge_evals.sql:106` |
| `assignment_evaluations` | Appendâ€‘only T+1 evaluations on `work_assignments` (executive / team / judge / constitutional / tool_accuracy / cos) | `db/migrations/20260319000200_assignment_evaluations.sql:5` |
| `task_run_outcomes.per_run_quality_score` | Deterministic perâ€‘run score (turn count / failures / cost) | `db/migrations/20260317140000_per_run_quality_score.sql` |
| `tool_test_classifications` / `tool_test_runs` / `tool_test_results` | Schema / connectivity / sandbox tests for tool definitions | `db/migrations/20260321090000_tool_test_schema.sql:1,13,26` |
| `cz_shadow_evals` / `cz_shadow_attempts` | CZ challengerâ€‘prompt shadow promotion gate | `db/migrations/20260422081600_cz_shadow_eval.sql:17,71` |
| `shadow_runs` | Generic shadowâ€‘run capture for prompt versions | `db/migrations/20260318200100_shadow_runs.sql:4` |
| `constitutional_evaluations` | Constitutionâ€‘adherence per run | referenced in `packages/smoketest/src/layers/layer07-intelligence.ts:23` and `packages/agent-runtime/src/constitutionalGovernor.ts:213` |
| `gtm_readiness_reports` | GTM gate snapshot | `db/migrations/20260319001500_gtm_readiness_reports.sql` |

There is **no `run_evaluations` table**. The table named in this prompt does not exist; the analogous T+1 surface is `assignment_evaluations`.

#### Seeded scenarios (`agent_eval_scenarios`)

| Migration | Roles seeded | Scenario count |
| --- | --- | --- |
| `db/migrations/20260314000100_agent_knowledge_evals.sql:151` | cmo (5), cto (5), cfo (5) | 15 |
| `db/migrations/20260319000500_marketing_eval_scenarios.sql:4` | content-creator (3), seo-analyst (3), social-media-manager (3) | 9 |
| `db/migrations/20260319001600_seed_gtm_knowledge_eval_scenarios.sql:4` | chief-of-staff (3), content-creator (3), seo-analyst (3), social-media-manager (3) | 12 |
| `db/migrations/20260319002300_seed_platform_intel_eval_scenarios.sql:2` | platform-intel (3) | 3 |
| `db/migrations/20260403010000_seed_golden_v1_eval_scenarios.sql:4` | chief-of-staff, cmo, cto, cfo, content-creator, seo-analyst, social-media-manager, platform-intel â€” one `golden:` per role | 8 |

**Total seeded: ~47 scenarios** covering 8 distinct roles.

#### Eval runners / writers

- **Knowledge / golden judge**: `packages/scheduler/src/agentKnowledgeEvaluator.ts:65` (`evaluateAgentKnowledgeGaps`). Wired to the cron via `/agent-evals/run` (Mon 09:00 UTC) and `/agent-evals/run-golden` (Wed 10:30 UTC) at `packages/scheduler/src/cronManager.ts:291,299`. Only **5 role runners** are registered (`packages/scheduler/src/agentKnowledgeEvaluator.ts:56-63`): `cmo`, `cto`, `cfo`, `chief-of-staff`, `vp-research`. Any scenario whose `agent_role` is not in that map is logged and skipped (`agentKnowledgeEvaluator.ts:128-131`). That orphans every seeded scenario for `content-creator`, `seo-analyst`, `social-media-manager`, `platform-intel` â€” i.e. **23 of 47 scenarios (~49%) have no runner and never execute.**
- **Perâ€‘run deterministic score**: `packages/agent-runtime/src/taskOutcomeHarvester.ts` (function `computePerRunQualityScore`, smoketested at `packages/smoketest/src/layers/layer29-per-run-evaluation.ts:62`). Inputs: `final_status`, `tool_failure_count`, `turn_count`, `had_partial_save`, `cost_usd` â€” i.e. "did it crash?", not "was it good?".
- **Batch outcome evaluator**: `packages/scheduler/src/batchOutcomeEvaluator.ts:54` runs at 02/14:00 UTC daily (`cronManager.ts:230`). Algorithmic, no LLM. Reads `task_run_outcomes`, writes back `batch_quality_score`. Also fires `evaluateToolAccuracy` per outcome (line 149).
- **Tool accuracy judge**: `packages/scheduler/src/toolAccuracyEvaluator.ts:75` â€” LLM judge over `tool_call_traces`, writes `assignment_evaluations` with `evaluator_type='tool_accuracy'` (line 136). Triggered fireâ€‘andâ€‘forget from the batch evaluator only when an outcome has both `run_id` AND `assignment_id` (`batchOutcomeEvaluator.ts:136`).
- **Executive / team acceptâ€‘reject**: `packages/agents/src/shared/executiveOrchestrationTools.ts:505,541`; `packages/agents/src/shared/teamOrchestrationTools.ts:555,598`; `packages/agents/src/chief-of-staff/tools.ts:2308`. Only fire when an executive agent calls `evaluate_assignment` on work it created.
- **Constitutional**: `packages/agent-runtime/src/constitutionalGovernor.ts:213`, dualâ€‘writes to `assignment_evaluations`.
- **Tool tests (Tier 1/2/3)**: `packages/agent-runtime/src/testing/toolTestRunner.ts:52` (creates `tool_test_runs`), `tier1SchemaValidator.ts:101`, `tier2ConnectivityTester.ts:611`, `tier3TestCases.ts:111,138,156` (all write `tool_test_results`). Triggered from `/tool-tests/run` (`packages/scheduler/src/server.ts:3596`).
- **GTM readiness**: `packages/scheduler/src/gtmReadiness/gtmReadinessEvaluator.ts:45` â€” aggregator only, *reads* signals (performance_score, accuracy, output_quality, success_rate, constitutional, tool_accuracy, knowledge_eval, p0s, aborts, tool_failure_rate). Produces nothing new; just a gate.
- **CZ shadow eval**: `cz_shadow_evals` consumed by the orchestrator tick loop; no perâ€‘run quality signal of its own â€” promotes prompts based on baseline passâ€‘rate already produced upstream.

#### "Tests labeled eval"

- `packages/smoketest/src/layers/layer29-per-run-evaluation.ts` â€” 5 tests, all of which are **`assertIncludes(file, "literal_string")` static text checks**, not behavioural. They verify column names exist in a migration file. They do not run any agent.
- `scripts/eval-*.ts` (15 files) â€” diagnostic / oneâ€‘shot SQL inspection scripts (`eval-diag-joins.ts`, `eval-recompute-scores.ts`, `eval-schema-check.ts`, `eval-section2-api.ts` â€¦ `eval-verify-promptv.ts`). None contain agent quality assertions; all read the DB and `console.log` numbers. `scripts/verify-eval-scoring.ts:22-23` literally prints `(empty â€” expected before evaluators run)` for `assignment_evaluations`.
- `packages/agents/src/**/*.test.ts` â€” only **3 unit tests** exist over the entire agents package: `contentTools.test.ts`, `socialMediaTools.test.ts`, `webBuildTools.test.ts`, plus one runtime test `reactiveTurnBudget.test.ts`. None evaluate task quality of an agent role.

---

### 10.2 Perâ€‘role taskâ€‘quality coverage

Roles enumerated from `packages/agents/src/` (29 directories, excluding `shared`).

A role has a "taskâ€‘quality eval" only if **(a)** at least one row in `agent_eval_scenarios` is seeded for it AND **(b)** a runner is registered in `agentKnowledgeEvaluator.RUNNERS` (`packages/scheduler/src/agentKnowledgeEvaluator.ts:56-63`) so the judge can actually score it. Anything else is a paper eval.

| Role | Has any eval row? | Runner registered? | Real task-quality eval? | Path:line |
| --- | --- | --- | --- | --- |
| chief-of-staff | yes (4) | yes | **yes** | `db/migrations/20260319001600_seed_gtm_knowledge_eval_scenarios.sql:7,14,21` + `agentKnowledgeEvaluator.ts:61` |
| cmo | yes (6) | yes | **yes** | `db/migrations/20260314000100_agent_knowledge_evals.sql:154` + `agentKnowledgeEvaluator.ts:57` |
| cto | yes (6) | yes | **yes** | `db/migrations/20260314000100_agent_knowledge_evals.sql:208` + `agentKnowledgeEvaluator.ts:58` |
| cfo | yes (6) | yes | **yes** | `db/migrations/20260314000100_agent_knowledge_evals.sql:257` + `agentKnowledgeEvaluator.ts:59` |
| vp-research | no scenarios seeded | yes | **no** (runner has nothing to feed it) | `agentKnowledgeEvaluator.ts:62` |
| content-creator | yes (7) | **no** | **no â€” orphaned** | scenarios at `20260319000500_marketing_eval_scenarios.sql:7`, `20260319001600_â€¦:29`; runner missing |
| seo-analyst | yes (7) | **no** | **no â€” orphaned** | `20260319000500_â€¦:26`, `20260319001600_â€¦:51` |
| social-media-manager | yes (7) | **no** | **no â€” orphaned** | `20260319000500_â€¦:45`, `20260319001600_â€¦:73` |
| platform-intel | yes (4) | **no** | **no â€” orphaned** | `20260319002300_seed_platform_intel_eval_scenarios.sql:2`, `20260403010000_â€¦:79` |
| clo | no | no | **no** | â€” |
| cpo | no | no | **no** | â€” |
| competitive-intel | no | no | **no** | â€” |
| competitive-research-analyst | no | no | **no** | â€” |
| design-critic | no | no | **no** | â€” |
| devops-engineer | no | no | **no** | â€” |
| frontend-engineer | no | no | **no** | â€” |
| global-admin | no | no | **no** | â€” |
| head-of-hr | no | no | **no** | â€” |
| m365-admin | no | no | **no** | â€” |
| market-research-analyst | no | no | **no** | â€” |
| ops | no | no | **no** | â€” |
| platform-engineer | no | no | **no** | â€” |
| quality-engineer | no | no | **no** | â€” |
| template-architect | no | no | **no** | â€” |
| ui-ux-designer | no | no | **no** | â€” |
| user-researcher | no | no | **no** | â€” |
| vp-design | no | no | **no** | â€” |
| vp-sales | no | no | **no** | â€” |

**Score: 4 of 29 roles (13.8%) have a wired, judgeâ€‘scored taskâ€‘quality eval.** A further 4 roles have scenario rows but no runner, and 21 have nothing.

The "core eight" live roster (`db/migrations/20260408213000_reduce_live_roster_to_core_eight.sql`) contains exactly the 4 working roles plus `content-creator`, `seo-analyst`, `social-media-manager`, `platform-intel` â€” i.e. **half of the live roster has eval scenarios written but never executed.**

---

### 10.3 When was each eval last run, and what's checked in?

**Nothing is checked in.** Searched the repo for `*.snap`, `fixtures/`, JSON result blobs, and `last_run_*` columns:

- No snapshot or fixture files for any eval (`Get-ChildItem -Filter *.snap` returns only `node_modules` matches).
- `agent_eval_results` rows live only in the live Postgres database; there is no committed export.
- `audit-reports/*-audit.json` files are *roster audits*, not eval results, and most are dated 2026â€‘03â€‘17 / 2026â€‘04â€‘16.
- `agentKnowledgeEvaluator.ts` writes a Redis lock (`agent-knowledge-eval-lock`, TTL 1h) and `console.log`s the report; output is not persisted outside `agent_eval_results` rows.
- `verify-eval-scoring.ts:22-23` explicitly says of `assignment_evaluations`: `(empty â€” expected before evaluators run)`. That string is still in the script, which suggests the postâ€‘deploy followâ€‘up never ran (or was never updated).
- The only "last run" timestamps are general `last_run_at` on `tenant_agents` / `company_agents` (run cadence, not eval cadence).

So: from the repo alone, you **cannot tell whether any eval has ever produced a result.** You can only confirm the cron entries claim Mon 09:00 UTC and Wed 10:30 UTC schedules.

---

### 10.4 Toolâ€‘test coverage vs the tool universe

Tool universe (Section 3 placeholder): `packages/agents/src/shared/*Tools.ts` = **75 source files** (each defines multiple tool functions; conservatively several hundred tools total).

Coverage by tier (from `packages/agent-runtime/src/testing/`):

| Tier | What it tests | How many tools | File / line |
| --- | --- | --- | --- |
| Tier 1 | JSONâ€‘schema validity of the tool *definition* | All tools known to `getAllKnownTools()` + `tool_registry` rows (`toolTestRunner.ts:26-33`) | `tier1SchemaValidator.ts:101` |
| Tier 2 | Live connectivity / probe call (no behavioural assertion) | Only tools classified `live` or `probe` in `tool_test_classifications` | `tier2ConnectivityTester.ts:611` |
| Tier 3 | Sandboxed execution with assertions | **5 tools, hardâ€‘coded** (`send_email`, `send_teams_dm`, `write_world_state`, `create_fleet_finding`, `propose_initiative`) | `tier3TestCases.ts:17-` |

Tier 1 is "does the JSON parse?" Tier 2 is "did the remote return any 2xx?" Neither asserts the tool *did the right thing*. Only Tier 3 does, and Tier 3 hits **5 tools**.

Bestâ€‘effort denominator: assume the 75 `*Tools.ts` files declare ~150 tools. Then meaningful behavioural coverage is **5 / ~150 â‰ˆ 3%**. Even taking the most generous view (count Tier 2 connectivity as "coverage"), it's a singleâ€‘digit percentage of tools that are `live`/`probe`â€‘classified in `tool_test_classifications`.

---

### 10.5 `assignment_evaluations` (the actual T+1 table)

`run_evaluations` does not exist. The table that plays its role is `assignment_evaluations`. Six call sites write to it:

1. `packages/agents/src/shared/executiveOrchestrationTools.ts:505` â€” fires only when an exec agent calls the `evaluate_assignment` tool to **accept** their delegated work. Score range 1â€“5 normalized to 0â€“1.
2. `packages/agents/src/shared/executiveOrchestrationTools.ts:541` â€” same, **revise** branch.
3. `packages/agents/src/shared/teamOrchestrationTools.ts:555,598` â€” teamâ€‘lead variants of the same tool.
4. `packages/agents/src/chief-of-staff/tools.ts:2308` â€” CoS quality scoring.
5. `packages/agent-runtime/src/constitutionalGovernor.ts:222` â€” only fires from the constitutional evaluator and only **if `assignmentId` was supplied** (line 219 guard) â€” many runs don't pass one.
6. `packages/scheduler/src/toolAccuracyEvaluator.ts:136` â€” fireâ€‘andâ€‘forget from the batch evaluator, but only for outcomes with **both** `run_id` and `assignment_id` (`batchOutcomeEvaluator.ts:136`) and only when the run had at least one tool call (`toolAccuracyEvaluator.ts:92`).

How often it would actually fire:
- Paths 1â€“4 require a human or an executive agent to deliberately call `evaluate_assignment` against an existing `work_assignment`. There is no policy that forces this.
- Path 5 is gated on the constitutional governor being invoked **and** an assignment id being threaded through (it isn't, in most callers).
- Path 6 is the most automatic path, but the verifyâ€‘evalâ€‘scoring script (line 23) treats `assignment_evaluations` as expectedâ€‘empty, and `task_run_outcomes` linkage to `assignment_id` is itself inconsistent (the script's whole purpose is to measure `with_assignment / total_outcomes` coverage).

The table is not dead in code â€” it has six writers â€” but every writer is conditional on an upstream coupling (an `assignment_id`, an executive accept call, a constitution invocation) that there is no evidence is reliably populated. From the repo alone, **expected fill rate is unknown and the most diagnostic script in the codebase assumes it's empty.**

---

### Brutal honest assessment

> *If the only thing I had to judge agent quality were the data currently in this database, what could I conclude?*

**Almost nothing â€” and nothing about most agents.**

1. **Only 4 of 29 roles can be scored on task quality at all.** `cmo`, `cto`, `cfo`, `chief-of-staff` have seeded scenarios *and* a runner in `agentKnowledgeEvaluator.RUNNERS` (`packages/scheduler/src/agentKnowledgeEvaluator.ts:56-63`). For the other 25 roles â€” including 18 that are part of the live roster or referenced in seeds â€” there is either no scenario row or no runner. Every `content-creator`, `seo-analyst`, `social-media-manager`, and `platform-intel` scenario is paper: 23 of 47 seeded scenarios (49%) are silently skipped on every cron tick.

2. **`vp-research` is a runner with no scenarios** (`agentKnowledgeEvaluator.ts:62`) â€” the inverse problem; it would do nothing if invoked.

3. **The "perâ€‘run quality score" is not a quality score.** It is a deterministic function of `final_status`, `tool_failure_count`, `turn_count`, `had_partial_save`, and `cost_usd` (`packages/smoketest/src/layers/layer29-per-run-evaluation.ts:76-80`). It tells you whether the run *finished*, not whether the output was correct, onâ€‘brand, useful, or factually grounded. A confident, wellâ€‘formatted hallucination scores identically to a correct answer.

4. **Tool quality coverage is ~3%.** Five tools (`send_email`, `send_teams_dm`, `write_world_state`, `create_fleet_finding`, `propose_initiative`) have actual behavioural Tierâ€‘3 tests (`packages/agent-runtime/src/testing/tier3TestCases.ts:17-`). Everything else gets, at best, a JSONâ€‘schema parse and a TCP probe. The hundreds of agentâ€‘facing tools in `packages/agents/src/shared/*Tools.ts` are functionally untested.

5. **`assignment_evaluations` is the only T+1 quality surface and its fill rate is unknown but assumed empty by the codebase's own verifier** (`scripts/verify-eval-scoring.ts:22-23` literally prints `(empty â€” expected before evaluators run)`). Even when populated, four of the six writers depend on a human or executiveâ€‘agent action that nothing forces to happen.

6. **No eval results are checked in.** No fixtures, no snapshots, no committed history. The repo can prove the eval *plumbing* exists; it cannot prove any eval has ever produced a verdict. The only way to know is to query live Postgres, and the most recent diagnostic script in the repo tells you to expect nothing there.

7. **The eval cron exists, but the cron firing â‰  a useful signal.** Even if `agent-knowledge-evals` (Mon 09:00 UTC) and `golden-eval-suite` (Wed 10:30 UTC) ran cleanly, they only produce a verdict for 4 of 29 roles. The dashboard's `agent_readiness` view will show "100% pass" for an agent that was simply never evaluated.

**Bottom line:** The data in this database can support exactly one statement about agent quality: *"For four executive roles (cmo / cto / cfo / chief-of-staff), if the eval cron has fired since the last seed update, an LLM judge graded them PASS / SOFT_FAIL / HARD_FAIL on a handful of handâ€‘written scenarios."* For everything else â€” content quality, tool selection, downstream impact, and 25 of 29 agents â€” **the system has no opinion, and the absence of an opinion is not visible to anyone reading the dashboard.** That is the worst kind of eval gap: it looks like coverage.

---

## Section 11 -- Top 10 Priorities (Execution Order)

A ranked, opinionated execution order weighted safety, then correctness, then quality observability, then performance, then hygiene. Top items: revoke leaked Google AI keys; close the constitutional pre-check fail-open; fix degenerate model routing; wire (or remove) the four roster-listed but unwired roles; eliminate the six direct provider bypasses; set the missing gate kill switches in deploy configs; backfill role evals; thread `assignment_id` through scheduled runs; decompose the two god functions; clean up orphans and `/policy/*` doc drift.

See: [section-11-priorities.md](diagnostic-2026-04-27/section-11-priorities.md)


Synthesis of Sections 1â€“10. Ranked in the order they should be executed: each
row assumes the rows above it have been completed (or at least started). The
ranking is opinionated and weights agent **safety** > **correctness** >
**quality observability** > **performance** > **hygiene**. Severity reflects
blast radius if left untouched; effort is engineering-week T-shirt size
(S â‰¤ 2 days, M â‰¤ 1 week, L > 1 week).

| Rank | Priority | Severity | Effort | Expected impact on agent performance | Evidence path:line |
|---:|---|:---:|:---:|---|---|
| 1 | Revoke the two Google AI API keys leaked into tracked GraphRAG logs and purge those files from git history | Critical | S | Closes an active credential-exfiltration vector; without this, every other fix is moot | `packages/graphrag-indexer/logs/indexing-engine.log` (60+ entries, keys `AIzaSyBtTi78faXgy5EN7Mrdj0TPR6r2qBCZKc4`, `AIzaSyBIrERx-dTIxoPaKBw_jPCrz6hLwNWKB64`); evidence at `audit-reports/diagnostic-2026-04-27/section-05-models.md:209,221-224` (Finding 5.3.2-C) |
| 2 | Make the constitutional pre-check fail-closed (or at minimum loud-fail) instead of silently proceeding when the governor is missing or throws | Critical | M | High-stakes tools (`create_or_update_file`, `apply_patch_call`, `create_branch`, `register_tool`, `create_specialist_agent`, `grant_tool_access`) currently bypass review on any error; closing this is the single biggest safety win | `packages/agent-runtime/src/toolExecutor.ts:1504-1549`, `packages/agent-runtime/src/constitutionalPreCheck.ts:29,306,372`; evidence at `section-04-gates.md:189-192` and Section 4 row #20 |
| 3 | Fix degenerate model routing: either delete `optimizeModel`/`ROLE_COST_TIER`/`TIER_MODELS` outright, or wire `optimizeModel` into `resolveModel`; AND enforce `isDisabled()` at the request hot-path | Critical | M | Today every role Ã— every task â†’ `model-router`; tier abstraction is dead code while a parallel `MODEL_CONFIG.tiers` silently runs the show. A single source of truth lets routing actually differentiate roles, and `isDisabled()` enforcement stops live traffic to retired SKUs (e.g. `gemini-2.5-flash`) | `packages/shared/src/models.ts:622-704` (TIER_MODELS, ROLE_COST_TIER, optimizeModel â€” 0 production callers); `packages/shared/src/models.config.ts:67-76,138`; `packages/agent-runtime/src/routing/resolveModel.ts`; evidence at `section-05-models.md:28-32,82-89,113-126,142-150` (Findings 5.1.1-A, 5.1.5-A, 5.2-A) |
| 4 | Wire the 4 keep-roster roles (`clo`, `devops-engineer`, `platform-engineer`, `quality-engineer`) into the `agentExecutor` `if/else` chain in `server.ts`, OR remove them from `activeAgentRoster` so their failure mode is honest | Critical | S | Today scheduled wakes for these roles pass `isLiveRuntimeRole` then fall through to `blockedRuntimeResult` â€” they look live on the dashboard but execute nothing. Either path eliminates a silent no-op fleet | `packages/scheduler/src/server.ts:1077-1087,1208-1337`; `packages/shared/src/activeAgentRoster.ts:14,20-22`; evidence at `section-02-agents.md:38-44,84,92,99,101,118-128` |
| 5 | Eliminate the 6 direct provider bypasses in `packages/agents/src/**` and route them through `modelClient`/`resolveModel` so they inherit the cross-provider fallback chain | High | M | Today an HR question, every Veo video render, every asset generation, and the sandbox build validator hard-fail on a Gemini or OpenAI outage with no retry on a sibling provider | `packages/agents/src/head-of-hr/tools.ts:567,829`; `packages/agents/src/shared/assetTools.ts:215`; `packages/agents/src/shared/videoCreationTools.ts:100,171,261,322`; `packages/agents/src/shared/sandboxBuildValidator.ts:247`; evidence at `section-05-models.md:184-194` (Finding 5.3.1-A) |
| 6 | Set the gate kill switches and perf flags in every deploy config: `TOOL_VALUE_GATE_ON_DEMAND=enforce`, `TOOL_VALUE_GATE_REACTIVE_LIGHT=enforce`, `ENABLE_TOOL_RESULT_CACHE=true`, `AGENT_TRACING_ENABLED=true` | High | S | Result caching is OFF in prod despite being the cheapest perf win available; value gate is OFF for chat and reactive-light by default; tracing is OFF so latency p50/p95 cannot be measured. All four are one-line YAML edits per service | `packages/agent-runtime/src/toolExecutor.ts:590-594`, `packages/agent-runtime/src/perRunToolCache.ts:79-81`, `packages/agent-runtime/src/taskClassPolicy.ts:21`, `packages/agent-runtime/src/telemetry/tracing.ts:10`; evidence at `section-04-gates.md:166-178,213-215` |
| 7 | Backfill golden + scenario evals for the 25 roles without one â€” start with the 4 live-roster roles whose scenarios exist but have no runner (`content-creator`, `seo-analyst`, `social-media-manager`, `platform-intel`) and the migration-affected `legal_review`/CLO path | High | M | Today the system can score quality on 4/29 roles (13.8%); 23 of 47 seeded scenarios silently skip every cron tick; the Apr-11 Sonnetâ†’Flash-Lite swap on `legal_review` (â‰ˆ15Ã— cost cut, expected quality drop) has zero regression coverage | `packages/scheduler/src/agentKnowledgeEvaluator.ts:56-63,128-131`; `db/migrations/20260319000500_marketing_eval_scenarios.sql`; `db/migrations/20260411150000_replace_claude_sonnet_with_gemini_flash_lite.sql`; evidence at `section-10-evals.md:40,64-95` and `section-05-models.md:316-330,372-394` (Finding 5.6-C) |
| 8 | Force `assignment_id` threading through every scheduled run and add a CI-gated check that `assignment_evaluations` is non-empty after a smoke run; remove the "(empty â€” expected before evaluators run)" stub | High | M | `assignment_evaluations` is the only real T+1 quality surface and it has 6 conditional writers, all gated on couplings (assignment id, exec accept call, constitution invocation) that nothing forces. Until it fills, every dashboard quality number is fiction | `packages/scheduler/src/toolAccuracyEvaluator.ts:92,136`; `packages/scheduler/src/batchOutcomeEvaluator.ts:136`; `packages/agent-runtime/src/constitutionalGovernor.ts:213-222`; `scripts/verify-eval-scoring.ts:22-23`; evidence at `section-10-evals.md:135-150` |
| 9 | Decompose `companyAgentRunner.saveStructuredCheckpoint` (1631 LOC) and `toolExecutor.execute` (1158 LOC) into testable units; this is the change-risk sink that makes every fix above scary | High | L | Two functions own ~2.8k LOC of the runtime hot path with no unit isolation â€” every priority 2/3/5 above lands in one of these two methods. Refactoring before touching them roughly halves regression risk | `packages/agent-runtime/src/companyAgentRunner.ts:2236-3866`; `packages/agent-runtime/src/toolExecutor.ts:881-2038`; evidence at `section-09-coupling.md:122-140` |
| 10 | Delete or DB-register the 16 orphan agent folders (~7000 LOC) and fix the `/policy/{collect,evaluate,canary-check}` doc drift | Med | M | Removes noise that defeats reachability tooling and stops operators wiring against endpoints that don't exist. Pure hygiene, but it permanently cleans the audit surface for future cycles | Orphans listed at `section-07-dead.md:36-78` (e.g. `packages/agents/src/global-admin/tools.ts` 1582 LOC, `packages/agents/src/devops-engineer/tools.ts` 516 LOC, `packages/agents/src/quality-engineer/tools.ts` 312 LOC, etc.); `/policy/*` drift at `section-08-drift.md:25,51` |

---

#### Per-priority justification

1. **Leaked Google AI keys** â€” credentials in a git-tracked log are exfiltration in progress, not a "to-do." Every minute of delay is paid in token spend on someone else's prompts; nothing else on this list matters if a third party owns your inference budget.
2. **Constitutional pre-check fail-open** â€” the gate that exists specifically to stop a runaway agent from rewriting the repo or granting itself tools currently logs a warning and proceeds when its dependency is missing. This is the worst possible failure mode for the highest-stakes tools.
3. **Model routing degeneracy** â€” `optimizeModel` and `ROLE_COST_TIER` look like routing infrastructure but route nothing; meanwhile `isDisabled()` is enforced at config time and ignored at request time, which is how disabled `gemini-2.5-flash` traffic shows up in GraphRAG logs. Either delete the dead surface or make it real, but don't keep both.
4. **Keep-roster wiring gap** â€” `clo`, `devops-engineer`, `platform-engineer`, `quality-engineer` are on the active roster, exported from the barrel, and silently return `blockedRuntimeResult` on every scheduled wake. The `if/else` chain in `server.ts` is the load-bearing dispatch and these four branches are missing.
5. **Direct provider bypasses** â€” six call sites in `packages/agents/src/**` instantiate `GoogleGenAI` / `OpenAI` directly, skipping every gate (#13 hooks, #14 rate limit, #15 budget, #17 fingerprint, #23 verifier) and the entire fallback chain. They are unobservable and unprotected.
6. **Gate kill switches in deploy configs** â€” `ENABLE_TOOL_RESULT_CACHE` is the cheapest perf win in the codebase and it is unset everywhere. `AGENT_TRACING_ENABLED` is unset, which is why no one in the company can answer "what is our p95 tool latency?" Both are one-line additions.
7. **Eval coverage for the live roster** â€” a dashboard that shows 100% pass for an agent that was never evaluated is worse than a dashboard that shows nothing. The migration-affected `legal_review` path is the canonical example: a 15Ã— cheaper model is now reviewing contracts with zero regression gate.
8. **`assignment_evaluations` plumbing** â€” six writers all gated on conditions nothing forces, and the codebase's own verifier script literally prints "expected empty." Until this table fills, no T+1 quality signal exists for any agent.
9. **God functions** â€” every priority above lands somewhere inside `saveStructuredCheckpoint` (1631 LOC) or `toolExecutor.execute` (1158 LOC). Decomposing them is the prerequisite that makes the rest of this list shippable without a regression every week.
10. **Orphans + doc drift** â€” 7000 LOC of unreferenced agent code and three documented endpoints that don't exist. Lowest priority because it doesn't change agent behavior, but it permanently de-noises the codebase so the next audit isn't paying this same tax.

---

## Appendix -- All Referenced Paths

Deduplicated and alphabetized list of every file path cited across the eleven section files. Line numbers from `path:line` citations are collapsed to the bare path. Paths under `audit-reports/diagnostic-2026-04-27/` are excluded.

- `ARCHITECTURE.md`
- `db/migrations/20260222025612_new-migration.sql`
- `db/migrations/20260223100000_agent_tool_tables.sql`
- `db/migrations/20260223200000_founder_orchestration.sql`
- `db/migrations/20260225100000_agent_identity.sql`
- `db/migrations/20260227000000_collective_intelligence.sql`
- `db/migrations/20260227100005_knowledge_graph.sql`
- `db/migrations/20260227100008_metrics_cache.sql`
- `db/migrations/20260227100013_knowledge_management.sql`
- `db/migrations/20260227100020_strategy_lab.sql`
- `db/migrations/20260227100022_value_capture.sql`
- `db/migrations/20260227100024_customer_success.sql`
- `db/migrations/20260227100027_strategy_lab_v2.sql`
- `db/migrations/20260227100034_world_model_architecture.sql`
- `db/migrations/20260227100037_strip_emojis.sql`
- `db/migrations/20260227100042_sharepoint_site_config.sql`
- `db/migrations/20260227100043_design_tables.sql`
- `db/migrations/20260227200000_reasoning_engine.sql`
- `db/migrations/20260228500000_dashboard_change_requests.sql`
- `db/migrations/20260228700001_tool_registry.sql`
- `db/migrations/20260228700004_agent_trust_scores.sql`
- `db/migrations/20260301000000_platform_intel.sql`
- `db/migrations/20260303150000_product_research_tools.sql`
- `db/migrations/20260303160000_governance_tools.sql`
- `db/migrations/20260306000000_world_model.sql`
- `db/migrations/20260307120000_task_run_outcomes.sql`
- `db/migrations/20260307120100_memory_lifecycle.sql`
- `db/migrations/20260307120300_plan_verifications.sql`
- `db/migrations/20260307130000_workflow_steps.sql`
- `db/migrations/20260307130100_sub_directives.sql`
- `db/migrations/20260309120000_agent_capacity.sql`
- `db/migrations/20260314000100_agent_knowledge_evals.sql`
- `db/migrations/20260314113000_remove_customer_success_skills.sql`
- `db/migrations/20260314130000_remove_customer_success_role_artifacts.sql`
- `db/migrations/20260315210000_sync_all_skill_playbooks_full.sql`
- `db/migrations/20260316180000_rename_pulse_to_vitals.sql`
- `db/migrations/20260317140000_per_run_quality_score.sql`
- `db/migrations/20260317150000_remove_cos_financial_reporting_skill.sql`
- `db/migrations/20260318200100_shadow_runs.sql`
- `db/migrations/20260319000200_assignment_evaluations.sql`
- `db/migrations/20260319000500_marketing_eval_scenarios.sql`
- `db/migrations/20260319001100_tool_call_traces.sql`
- `db/migrations/20260319001500_gtm_readiness_reports.sql`
- `db/migrations/20260319001600_seed_gtm_knowledge_eval_scenarios.sql`
- `db/migrations/20260319002300_seed_platform_intel_eval_scenarios.sql`
- `db/migrations/20260321090000_tool_test_schema.sql`
- `db/migrations/20260323200000_remove_copilot_chat_tool_registry.sql`
- `db/migrations/20260323230000_cmo_remove_marketing_intelligence_assignee.sql`
- `db/migrations/20260324100000_remove_gemini_25_pro_registry_row.sql`
- `db/migrations/20260330124500_agent_handoff_contracts.sql`
- `db/migrations/20260330143000_temporal_knowledge_graph.sql`
- `db/migrations/20260330150000_kg_contradictions_and_fact_provenance.sql`
- `db/migrations/20260403010000_seed_golden_v1_eval_scenarios.sql`
- `db/migrations/20260406223500_runtime_spine_sessions_attempts_events.sql`
- `db/migrations/20260408120000_dead_agent_hard_purge_reset.sql`
- `db/migrations/20260408213000_reduce_live_roster_to_core_eight.sql`
- `db/migrations/20260410180000_remove_inactive_grant_revoke_executive_roles.sql`
- `db/migrations/20260410190000_remove_inactive_cto_legacy_graph_grants.sql`
- `db/migrations/20260411150000_replace_claude_sonnet_with_gemini_flash_lite.sql`
- `db/migrations/20260417160000_cz_schema.sql`
- `db/migrations/20260417160001_cz_seed.sql`
- `db/migrations/20260417160002_cz_surface_addon.sql`
- `db/migrations/20260417210000_cz_scores_agent_output.sql`
- `db/migrations/20260421120000_cz_launch_gate_p0_threshold.sql`
- `db/migrations/20260421120100_cz_investor_gate_relax.sql`
- `db/migrations/20260421130000_cz_reassign_retired_agents.sql`
- `db/migrations/20260421190000_cz_reassign_tenancy_tasks_to_cto.sql`
- `db/migrations/20260422081600_cz_shadow_eval.sql`
- `docker/Dockerfile`
- `docs/ARCHITECTURE.md`
- `docs/MODEL-SYSTEM-ANALYSIS.md`
- `docs/TASK-CLASS-PROTOCOL-MATRIX.md`
- `package.json`
- `packages/agent-runtime/src/__tests__/actionRiskClassifier.test.ts`
- `packages/agent-runtime/src/__tests__/awaySummary.test.ts`
- `packages/agent-runtime/src/__tests__/behavioralFingerprint.test.ts`
- `packages/agent-runtime/src/__tests__/buildTool.test.ts`
- `packages/agent-runtime/src/__tests__/circuitBreaker.test.ts`
- `packages/agent-runtime/src/__tests__/compaction.test.ts`
- `packages/agent-runtime/src/__tests__/concurrentToolExecutor.test.ts`
- `packages/agent-runtime/src/__tests__/contextCompaction.test.ts`
- `packages/agent-runtime/src/__tests__/coordinatorMode.test.ts`
- `packages/agent-runtime/src/__tests__/dashboardChatEmbeds.test.ts`
- `packages/agent-runtime/src/__tests__/denialTracking.test.ts`
- `packages/agent-runtime/src/__tests__/domainRouter.test.ts`
- `packages/agent-runtime/src/__tests__/errorRetry.test.ts`
- `packages/agent-runtime/src/__tests__/executionPlanning.test.ts`
- `packages/agent-runtime/src/__tests__/historyCompressor.test.ts`
- `packages/agent-runtime/src/__tests__/historyManager.test.ts`
- `packages/agent-runtime/src/__tests__/hookLifecycle.test.ts`
- `packages/agent-runtime/src/__tests__/jitContextRetriever.test.ts`
- `packages/agent-runtime/src/__tests__/jitContextSelector.test.ts`
- `packages/agent-runtime/src/__tests__/memoryConsolidation.test.ts`
- `packages/agent-runtime/src/__tests__/microCompactor.test.ts`
- `packages/agent-runtime/src/__tests__/modelsValidation.test.ts`
- `packages/agent-runtime/src/__tests__/planningPolicy.test.ts`
- `packages/agent-runtime/src/__tests__/policyLimits.test.ts`
- `packages/agent-runtime/src/__tests__/reasoningEngine.test.ts`
- `packages/agent-runtime/src/__tests__/redisCache.test.ts`
- `packages/agent-runtime/src/__tests__/sessionMemoryUpdater.test.ts`
- `packages/agent-runtime/src/__tests__/skillLearning.test.ts`
- `packages/agent-runtime/src/__tests__/ssrfGuard.test.ts`
- `packages/agent-runtime/src/__tests__/subtaskRouter.test.ts`
- `packages/agent-runtime/src/__tests__/summaryFirstCompaction.test.ts`
- `packages/agent-runtime/src/__tests__/supervisorDefaults.test.ts`
- `packages/agent-runtime/src/__tests__/supervisorWorkloadStallPolicy.test.ts`
- `packages/agent-runtime/src/__tests__/taskIdentity.test.ts`
- `packages/agent-runtime/src/__tests__/taskOutcomeHarvester.test.ts`
- `packages/agent-runtime/src/__tests__/toolExecutor.test.ts`
- `packages/agent-runtime/src/__tests__/toolRetriever.test.ts`
- `packages/agent-runtime/src/__tests__/tracing.test.ts`
- `packages/agent-runtime/src/__tests__/v4aDiff.test.ts`
- `packages/agent-runtime/src/__tests__/verificationPolicy.test.ts`
- `packages/agent-runtime/src/baseAgentRunner.ts`
- `packages/agent-runtime/src/companyAgentRunner.ts`
- `packages/agent-runtime/src/config/agentEntraRoles.ts`
- `packages/agent-runtime/src/constitutionalGovernor.ts`
- `packages/agent-runtime/src/constitutionalPreCheck.ts`
- `packages/agent-runtime/src/costs/modelRates.ts`
- `packages/agent-runtime/src/createRunner.ts`
- `packages/agent-runtime/src/index.ts`
- `packages/agent-runtime/src/modelClient.ts`
- `packages/agent-runtime/src/perRunToolCache.ts`
- `packages/agent-runtime/src/providers/bedrockAnthropic.ts`
- `packages/agent-runtime/src/providers/bedrockClient.ts`
- `packages/agent-runtime/src/providers/bedrockDeepseek.ts`
- `packages/agent-runtime/src/providers/gemini.ts`
- `packages/agent-runtime/src/providers/openai.ts`
- `packages/agent-runtime/src/routing/resolveModel.ts`
- `packages/agent-runtime/src/taskClassPolicy.ts`
- `packages/agent-runtime/src/taskOutcomeHarvester.ts`
- `packages/agent-runtime/src/telemetry/tracing.ts`
- `packages/agent-runtime/src/testing/tier3TestCases.ts`
- `packages/agent-runtime/src/testing/toolTestRunner.ts`
- `packages/agent-runtime/src/toolExecutor.ts`
- `packages/agent-sdk`
- `packages/agents/src/cfo/run.ts`
- `packages/agents/src/cfo/systemPrompt.ts`
- `packages/agents/src/chief-of-staff/domainRouter.ts`
- `packages/agents/src/chief-of-staff/run.ts`
- `packages/agents/src/chief-of-staff/schedule.ts`
- `packages/agents/src/chief-of-staff/systemPrompt.ts`
- `packages/agents/src/chief-of-staff/tools.ts`
- `packages/agents/src/clo/systemPrompt.ts`
- `packages/agents/src/cmo/run.ts`
- `packages/agents/src/cmo/systemPrompt.ts`
- `packages/agents/src/competitive-intel/run.ts`
- `packages/agents/src/competitive-intel/systemPrompt.ts`
- `packages/agents/src/competitive-intel/tools.ts`
- `packages/agents/src/competitive-research-analyst/run.ts`
- `packages/agents/src/competitive-research-analyst/systemPrompt.ts`
- `packages/agents/src/competitive-research-analyst/tools.ts`
- `packages/agents/src/content-creator/systemPrompt.ts`
- `packages/agents/src/cpo/run.ts`
- `packages/agents/src/cpo/systemPrompt.ts`
- `packages/agents/src/cto/run.ts`
- `packages/agents/src/cto/systemPrompt.ts`
- `packages/agents/src/cto/tools.ts`
- `packages/agents/src/design-critic/run.ts`
- `packages/agents/src/design-critic/systemPrompt.ts`
- `packages/agents/src/design-critic/tools.ts`
- `packages/agents/src/devops-engineer/run.ts`
- `packages/agents/src/devops-engineer/systemPrompt.ts`
- `packages/agents/src/devops-engineer/tools.ts`
- `packages/agents/src/frontend-engineer/run.ts`
- `packages/agents/src/frontend-engineer/systemPrompt.ts`
- `packages/agents/src/frontend-engineer/tools.ts`
- `packages/agents/src/global-admin/run.ts`
- `packages/agents/src/global-admin/systemPrompt.ts`
- `packages/agents/src/global-admin/tools.ts`
- `packages/agents/src/head-of-hr/run.ts`
- `packages/agents/src/head-of-hr/systemPrompt.ts`
- `packages/agents/src/head-of-hr/tools.ts`
- `packages/agents/src/index.ts`
- `packages/agents/src/m365-admin/run.ts`
- `packages/agents/src/m365-admin/systemPrompt.ts`
- `packages/agents/src/m365-admin/tools.ts`
- `packages/agents/src/market-research-analyst/run.ts`
- `packages/agents/src/market-research-analyst/systemPrompt.ts`
- `packages/agents/src/market-research-analyst/tools.ts`
- `packages/agents/src/ops/systemPrompt.ts`
- `packages/agents/src/platform-engineer/run.ts`
- `packages/agents/src/platform-engineer/systemPrompt.ts`
- `packages/agents/src/platform-engineer/tools.ts`
- `packages/agents/src/platform-intel/config.ts`
- `packages/agents/src/platform-intel/run.ts`
- `packages/agents/src/platform-intel/systemPrompt.ts`
- `packages/agents/src/platform-intel/teamsCards.ts`
- `packages/agents/src/platform-intel/tools.ts`
- `packages/agents/src/quality-engineer/run.ts`
- `packages/agents/src/quality-engineer/systemPrompt.ts`
- `packages/agents/src/quality-engineer/tools.ts`
- `packages/agents/src/seo-analyst/systemPrompt.ts`
- `packages/agents/src/shared/__tests__/reactiveTurnBudget.test.ts`
- `packages/agents/src/shared/accessAuditTools.ts`
- `packages/agents/src/shared/agent365Tools.ts`
- `packages/agents/src/shared/agentCreationTools.ts`
- `packages/agents/src/shared/agentDirectoryTools.ts`
- `packages/agents/src/shared/agentManagementTools.ts`
- `packages/agents/src/shared/assetTools.ts`
- `packages/agents/src/shared/assignmentTools.ts`
- `packages/agents/src/shared/auditTools.ts`
- `packages/agents/src/shared/canvaTools.ts`
- `packages/agents/src/shared/cashFlowTools.ts`
- `packages/agents/src/shared/channelNotifyTools.ts`
- `packages/agents/src/shared/claudeParityTools.ts`
- `packages/agents/src/shared/codexTools.ts`
- `packages/agents/src/shared/collectiveIntelligenceTools.ts`
- `packages/agents/src/shared/communicationTools.ts`
- `packages/agents/src/shared/competitiveIntelTools.ts`
- `packages/agents/src/shared/contentTools.test.ts`
- `packages/agents/src/shared/contentTools.ts`
- `packages/agents/src/shared/costManagementTools.ts`
- `packages/agents/src/shared/createEvalRunDeps.ts`
- `packages/agents/src/shared/createRunner.ts`
- `packages/agents/src/shared/deliverableTools.ts`
- `packages/agents/src/shared/deployPreviewTools.ts`
- `packages/agents/src/shared/designBriefTools.ts`
- `packages/agents/src/shared/designSystemTools.ts`
- `packages/agents/src/shared/diagnosticTools.ts`
- `packages/agents/src/shared/dmTools.ts`
- `packages/agents/src/shared/documentTools.ts`
- `packages/agents/src/shared/docusignTools.ts`
- `packages/agents/src/shared/emailMarketingTools.ts`
- `packages/agents/src/shared/engineeringGapTools.ts`
- `packages/agents/src/shared/entraHRTools.ts`
- `packages/agents/src/shared/eventTools.ts`
- `packages/agents/src/shared/executiveOrchestrationTools.ts`
- `packages/agents/src/shared/externalA2aTools.ts`
- `packages/agents/src/shared/facebookTools.ts`
- `packages/agents/src/shared/figmaAuth.ts`
- `packages/agents/src/shared/figmaTools.ts`
- `packages/agents/src/shared/frontendCodeTools.ts`
- `packages/agents/src/shared/graphTools.ts`
- `packages/agents/src/shared/hrTools.ts`
- `packages/agents/src/shared/initiativeTools.ts`
- `packages/agents/src/shared/knowledgeRetrievalTools.ts`
- `packages/agents/src/shared/legalDocumentTools.ts`
- `packages/agents/src/shared/legalTools.ts`
- `packages/agents/src/shared/linkedinTools.ts`
- `packages/agents/src/shared/logoTools.ts`
- `packages/agents/src/shared/marketingIntelTools.ts`
- `packages/agents/src/shared/memoryTools.safe.ts`
- `packages/agents/src/shared/memoryTools.ts`
- `packages/agents/src/shared/opsExtensionTools.ts`
- `packages/agents/src/shared/packetSchemas.ts`
- `packages/agents/src/shared/patchHarness.ts`
- `packages/agents/src/shared/peerCoordinationTools.ts`
- `packages/agents/src/shared/productAnalyticsTools.ts`
- `packages/agents/src/shared/quickDemoAppTools.ts`
- `packages/agents/src/shared/researchMonitoringTools.ts`
- `packages/agents/src/shared/researchRepoTools.ts`
- `packages/agents/src/shared/researchTools.ts`
- `packages/agents/src/shared/resolveVpDesignWorkerMessage.ts`
- `packages/agents/src/shared/revenueTools.ts`
- `packages/agents/src/shared/roadmapTools.ts`
- `packages/agents/src/shared/sandboxBuildValidator.ts`
- `packages/agents/src/shared/sandboxDevTools.ts`
- `packages/agents/src/shared/scaffoldTools.ts`
- `packages/agents/src/shared/screenshotTools.ts`
- `packages/agents/src/shared/seoTools.ts`
- `packages/agents/src/shared/sharepointTools.ts`
- `packages/agents/src/shared/slackOutputTools.ts`
- `packages/agents/src/shared/socialMediaTools.test.ts`
- `packages/agents/src/shared/socialMediaTools.ts`
- `packages/agents/src/shared/storybookTools.ts`
- `packages/agents/src/shared/teamOrchestrationTools.ts`
- `packages/agents/src/shared/teamsOutputTools.ts`
- `packages/agents/src/shared/toolGrantTools.ts`
- `packages/agents/src/shared/toolRegistryTools.ts`
- `packages/agents/src/shared/toolRequestTools.ts`
- `packages/agents/src/shared/userResearchTools.ts`
- `packages/agents/src/shared/v4aDiff.ts`
- `packages/agents/src/shared/videoCreationTools.ts`
- `packages/agents/src/shared/webBuildPlannerTools.ts`
- `packages/agents/src/shared/webBuildTools.test.ts`
- `packages/agents/src/shared/webBuildTools.ts`
- `packages/agents/src/shared/websiteIngestionTools.ts`
- `packages/agents/src/social-media-manager/run.ts`
- `packages/agents/src/social-media-manager/systemPrompt.ts`
- `packages/agents/src/social-media-manager/tools.ts`
- `packages/agents/src/template-architect/run.ts`
- `packages/agents/src/template-architect/systemPrompt.ts`
- `packages/agents/src/template-architect/tools.ts`
- `packages/agents/src/ui-ux-designer/run.ts`
- `packages/agents/src/ui-ux-designer/systemPrompt.ts`
- `packages/agents/src/ui-ux-designer/tools.ts`
- `packages/agents/src/user-researcher/run.ts`
- `packages/agents/src/user-researcher/systemPrompt.ts`
- `packages/agents/src/user-researcher/tools.ts`
- `packages/agents/src/vp-design/run.ts`
- `packages/agents/src/vp-design/systemPrompt.ts`
- `packages/agents/src/vp-research/systemPrompt.ts`
- `packages/agents/src/vp-sales/systemPrompt.ts`
- `packages/company-memory/src/embeddingClient.ts`
- `packages/dashboard/.storybook/main.ts`
- `packages/dashboard/.storybook/preview.ts`
- `packages/dashboard/public/sw.js`
- `packages/dashboard/src/App.tsx`
- `packages/dashboard/src/components/AgentIcon.tsx`
- `packages/dashboard/src/components/CanvasGlow.tsx`
- `packages/dashboard/src/components/ChatComposer.tsx`
- `packages/dashboard/src/components/ChatMarkdown.tsx`
- `packages/dashboard/src/components/eval/EvalFleetGrid.tsx`
- `packages/dashboard/src/components/FounderBriefing.tsx`
- `packages/dashboard/src/components/governance/CommandCenter.tsx`
- `packages/dashboard/src/components/governance/CzProtocol.tsx`
- `packages/dashboard/src/components/governance/EnterpriseKpiDashboard.tsx`
- `packages/dashboard/src/components/governance/shared.tsx`
- `packages/dashboard/src/components/hero-1.tsx`
- `packages/dashboard/src/components/multi-step-loader-demo.tsx`
- `packages/dashboard/src/components/SystemHealth.tsx`
- `packages/dashboard/src/components/ui.tsx`
- `packages/dashboard/src/components/ui/button.tsx`
- `packages/dashboard/src/components/ui/glowing-effect-demo-2.tsx`
- `packages/dashboard/src/components/ui/glowing-stars.tsx`
- `packages/dashboard/src/components/ui/glowing-textarea-frame.tsx`
- `packages/dashboard/src/lib/auth.tsx`
- `packages/dashboard/src/lib/firebase.ts`
- `packages/dashboard/src/lib/formatDashboardContent.ts`
- `packages/dashboard/src/lib/glassCard.ts`
- `packages/dashboard/src/lib/hooks.ts`
- `packages/dashboard/src/lib/liveRoster.ts`
- `packages/dashboard/src/lib/models.ts`
- `packages/dashboard/src/lib/nexusRunSummary.ts`
- `packages/dashboard/src/lib/normalizeText.ts`
- `packages/dashboard/src/lib/smb.ts`
- `packages/dashboard/src/lib/supabase.ts`
- `packages/dashboard/src/lib/theme.tsx`
- `packages/dashboard/src/lib/types.ts`
- `packages/dashboard/src/lib/useVoiceChat.ts`
- `packages/dashboard/src/lib/utils.ts`
- `packages/dashboard/src/pages/AgentProfile.tsx`
- `packages/dashboard/src/pages/Chat.tsx`
- `packages/dashboard/src/pages/Governance.tsx`
- `packages/dashboard/src/pages/Operations.tsx`
- `packages/dashboard/src/pages/Settings.tsx`
- `packages/dashboard/src/pages/Skills.tsx`
- `packages/dashboard/src/pages/Strategy.tsx`
- `packages/dashboard/src/stories/Button.stories.ts`
- `packages/dashboard/src/stories/Button.tsx`
- `packages/dashboard/src/stories/Header.stories.ts`
- `packages/dashboard/src/stories/Header.tsx`
- `packages/dashboard/src/stories/Page.stories.ts`
- `packages/dashboard/src/stories/Page.tsx`
- `packages/design-system/src/anti-ai-smell-registry/tokens.ts`
- `packages/graphrag-indexer/logs/indexing-engine.log`
- `packages/graphrag-indexer/settings.yaml`
- `packages/integrations/src/anthropic/billing.ts`
- `packages/integrations/src/audit.ts`
- `packages/integrations/src/aws/billing.ts`
- `packages/integrations/src/gcp/cloudBuild.ts`
- `packages/integrations/src/index.ts`
- `packages/integrations/src/openai/billing.ts`
- `packages/integrations/src/sharepoint/index.ts`
- `packages/integrations/src/webSearch.ts`
- `packages/mcp-data-server/src/scopes.ts`
- `packages/mcp-design-server/src/scopes.ts`
- `packages/mcp-engineering-server/src/scopes.ts`
- `packages/mcp-finance-server/src/scopes.ts`
- `packages/mcp-marketing-server/src/scopes.ts`
- `packages/scheduler/src/agentDreamConsolidator.ts`
- `packages/scheduler/src/agentKnowledgeEvaluator.ts`
- `packages/scheduler/src/agentLifecycle.ts`
- `packages/scheduler/src/batchOutcomeEvaluator.ts`
- `packages/scheduler/src/capacityAdminApi.ts`
- `packages/scheduler/src/cronManager.ts`
- `packages/scheduler/src/czProtocolApi.ts`
- `packages/scheduler/src/czShadowEval.ts`
- `packages/scheduler/src/dashboardApi.ts`
- `packages/scheduler/src/departmentAdminApi.ts`
- `packages/scheduler/src/evalDashboard.ts`
- `packages/scheduler/src/gtmReadiness/gtmReadinessEvaluator.ts`
- `packages/scheduler/src/index.ts`
- `packages/scheduler/src/platformIntelApproval.ts`
- `packages/scheduler/src/reportExporter.ts`
- `packages/scheduler/src/server.ts`
- `packages/scheduler/src/strategyLabEngine.ts`
- `packages/scheduler/src/toolAccuracyEvaluator.ts`
- `packages/shared/src/activeAgentRoster.ts`
- `packages/shared/src/config`
- `packages/shared/src/index.ts`
- `packages/shared/src/middleware/auth.ts`
- `packages/shared/src/models.config.ts`
- `packages/shared/src/models.ts`
- `packages/smoketest/src/index.ts`
- `packages/smoketest/src/layers/layer00-infra.ts`
- `packages/smoketest/src/layers/layer00..layer30`
- `packages/smoketest/src/layers/layer01-data-syncs.ts`
- `packages/smoketest/src/layers/layer02-model-clients.ts`
- `packages/smoketest/src/layers/layer03-heartbeat.ts`
- `packages/smoketest/src/layers/layer04-orchestration.ts`
- `packages/smoketest/src/layers/layer05-communication.ts`
- `packages/smoketest/src/layers/layer06-authority.ts`
- `packages/smoketest/src/layers/layer07-intelligence.ts`
- `packages/smoketest/src/layers/layer08-knowledge.ts`
- `packages/smoketest/src/layers/layer09-strategy.ts`
- `packages/smoketest/src/layers/layer10-specialists.ts`
- `packages/smoketest/src/layers/layer11-dashboard.ts`
- `packages/smoketest/src/layers/layer12-voice.ts`
- `packages/smoketest/src/layers/layer13-m365.ts`
- `packages/smoketest/src/layers/layer14-migrations.ts`
- `packages/smoketest/src/layers/layer15-agent-autonomy.ts`
- `packages/smoketest/src/layers/layer16-tools.ts`
- `packages/smoketest/src/layers/layer17-mcp-servers.ts`
- `packages/smoketest/src/layers/layer18-tool-access.ts`
- `packages/smoketest/src/layers/layer19-worker.ts`
- `packages/smoketest/src/layers/layer20-graphrag.ts`
- `packages/smoketest/src/layers/layer21-world-model.ts`
- `packages/smoketest/src/layers/layer22-reasoning.ts`
- `packages/smoketest/src/layers/layer23-tenant-isolation.ts`
- `packages/smoketest/src/layers/layer24-routing.ts`
- `packages/smoketest/src/layers/layer25-governance-change-requests.ts`
- `packages/smoketest/src/layers/layer26-slack-platform.ts`
- `packages/smoketest/src/layers/layer27-schema-consistency.ts`
- `packages/smoketest/src/layers/layer28-advancement-rollout.ts`
- `packages/smoketest/src/layers/layer29-per-run-evaluation.ts`
- `packages/smoketest/src/layers/layer30-tool-execution.ts`
- `packages/smoketest/src/main.ts`
- `packages/smoketest/src/types.ts`
- `packages/smoketest/src/utils/db.ts`
- `packages/smoketest/src/utils/gcloud.ts`
- `packages/smoketest/src/utils/http.ts`
- `packages/smoketest/src/utils/report.ts`
- `packages/smoketest/src/utils/test.ts`
- `packages/voice-gateway/src/realtimeClient.ts`
- `packages/worker/src/index.ts`
- `packages/worker/src/queue.ts`
- `scripts/eval`
- `scripts/eval-`
- `scripts/eval-section6-regression.ts`
- `scripts/migrate-agents.js`
- `scripts/run-reliability-canary.ps1`
- `scripts/validate-db-models.js`
- `scripts/verify-eval-scoring.ts`
- `section-02-agents.md`
- `section-04-gates.md`
- `section-05-models.md`
- `section-07-dead.md`
- `section-08-drift.md`
- `section-09-coupling.md`
- `section-10-evals.md`
- `skills/roles`
- `Teams/Graph`

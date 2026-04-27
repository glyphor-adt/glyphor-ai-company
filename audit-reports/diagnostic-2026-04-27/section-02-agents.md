# Section 2 — Agents: Inventory, Reachability, Prompts, Tools, Models

Audit date: 2026-04-27. Repo root: `C:\Users\KristinaDenney\source\repos\glyphor-ai-company`.
Ground rules: every claim cites `path:line`. Code wins over docs.

## 0. Methodology and corrections to the brief

- Role enumeration: `Get-ChildItem packages\agents\src -Directory` (excluding `shared/`). 28 role
  directories.
- Last commit per role: `git --no-pager log -1 --format=%cI -- packages/agents/src/<role>`.
- Token-length estimate for each system prompt: `chars / 4` from raw `systemPrompt.ts` byte length
  (the file contains a single exported template literal; surrounding TS scaffolding adds ~50–100
  chars of overhead, which is left in to keep the method mechanical).
- "Has runner-callable export?" means the role's `run<Role>` function (or `runDynamicAgent`) is
  re-exported from the package barrel `packages\agents\src\index.ts:1-29` so that
  `import { runX } from '@glyphor/agents'` resolves.
- "Inbound refs from runtime" counts non-test, non-self files under `packages/` that contain the
  literal `'<role>'` slug. This over-counts (lookup tables, denylists), so the table notes whether
  the *actual `runX` symbol* is imported anywhere outside its own folder, which is the load-bearing
  signal for reachability.
- Reachability roots required by the brief:
  - `packages\scheduler\src\server.ts` ✅ exists.
  - `packages\scheduler\src\eventRouter.ts` ✅ exists.
  - `packages/agent-runtime/src/createRunner.ts` ❌ **does not exist**. The only `createRunner` in
    the repo lives at `packages\agents\src\shared\createRunner.ts:36`. That is what is used as the
    third reachability root for this audit. (`@glyphor/agent-runtime` only exposes the runner
    *classes* `CompanyAgentRunner | OrchestratorRunner | TaskRunner`; role selection happens in
    the agents package.)
- Authoritative roster source: `packages\shared\src\activeAgentRoster.ts:10-23` lists 12 active
  roles; lines 36-54 list 17 retired; lines 67-77 list 9 scaffolded-but-unbuilt. The runtime gate
  `isCanonicalKeepRole` (`packages\shared\src\canonicalKeepRoster.ts:20-22`) is just a re-export
  of `isActiveAgentRole`, so the 12-role active set is what `server.ts` will actually let through.

## 1. Reachability model (how I assigned `Status`)

`scheduler/src/server.ts` builds a single `agentExecutor` (`server.ts:1129-1338`) that:

1. Rejects any role failing `isLiveRuntimeRole` → `isCanonicalKeepRole` (`server.ts:1077-1079`,
   `1134-1136`) by returning `blockedRuntimeResult` (`server.ts:1081-1087`,
   message: *"Agent X is not on the live runtime roster and cannot run."*).
2. Hard-codes an `if/else if` chain that only dispatches to **8 roles**:
   `chief-of-staff` (`server.ts:1208`), `cto` (1233), `cfo` (1239), `cpo` (1245), `cmo` (1247),
   `vp-design` (1277), `ops` (1294), `vp-research` (1296). Anything else falls into
   `else { return blockedRuntimeResult(agentRole); }` at `server.ts:1335-1337`.

`scheduler/src/eventRouter.ts` is role-agnostic: it takes a generic `executor` callback in its
constructor (`eventRouter.ts:76-82`) and calls `this.executor(event.agentRole, event.task, ...)`
at `eventRouter.ts:137`. So whatever `server.ts` wires in is the actual reachable set.

`agents/src/shared/createRunner.ts:36-53` is also role-agnostic — it picks
`CompanyAgentRunner | OrchestratorRunner | TaskRunner` based on `task` and on
`ORCHESTRATOR_ROLES` (defined in `@glyphor/agent-runtime`). It does not know any role names.

Secondary call site: `scheduler/src/czProtocolApi.ts:102-115` defines `STATIC_RUNNERS` mapping 12
runner-callable roles for **dry-run / eval** of the CZ protocol harness only
(every entry passes `dryRun: true, evalMode: true`). This file is imported by `server.ts:87`
(`handleCzApi`), so it counts as "reachable from server.ts" but **never executes a real run** —
it is only used by the CZ shadow/judge harness. I record this as `partially-wired` for roles that
have no other live path.

`agents/src/shared/runDynamicAgent.ts:42-159` is the DB-defined fallback runner. It is invoked from
`czProtocolApi.ts:123` only (and from a self-test in worker), so it does not provide real
scheduled execution either — it only feeds CZ-eval and dashboard-on-demand harnesses.

### Status decision rules applied here

- `live` = role passes `isLiveRuntimeRole` AND has a dedicated branch in `server.ts` agentExecutor
  AND has a runner-callable export from `@glyphor/agents`.
- `partially-wired` = on the active roster but no `agentExecutor` branch (so scheduled wakes
  return `blockedRuntimeResult`); OR has only a dry-run/eval runner via `czProtocolApi.STATIC_RUNNERS`;
  OR runtime path exists but prompt/tools wiring is incomplete.
- `test-only` = only referenced under `**/*.test.*` or `**/__tests__/**`. (No role qualified;
  every role has at least one non-test reference, even if only in retirement lists.)
- `orphan` = no path from any of the three reachability roots reaches the role's `run<Role>`
  symbol. Note: appearing in `RETIRED_AGENT_ROLES` arrays etc. is *not* a code path — it is a deny
  list.

## 2. Per-role inventory table

| Role | Files | LOC | Has prompt file? | Has runner-callable export? | Last commit (cI) | Inbound runtime refs | Inbound test refs | Status |
|---|---:|---:|:---:|:---:|---|---:|---:|---|
| cfo | 3 | 502 | yes (`cfo/systemPrompt.ts`) | yes (`runCFO` — `agents/src/index.ts:4`) | 2026-04-22 | 55 | 16 | live |
| chief-of-staff | 6 | 4031 | yes (`chief-of-staff/systemPrompt.ts`) | yes (`runChiefOfStaff` — `agents/src/index.ts:2`) | 2026-04-23 | 131 | 9 | live |
| clo | 2 | 169 | yes (`clo/systemPrompt.ts`) | yes (`runCLO` — `agents/src/index.ts:20`) | 2026-04-23 | 26 | 1 | partially-wired |
| cmo | 3 | 590 | yes (`cmo/systemPrompt.ts`) | yes (`runCMO` — `agents/src/index.ts:6`) | 2026-04-22 | 68 | 14 | live |
| competitive-intel | 3 | 257 | yes (`competitive-intel/systemPrompt.ts`) | no (not exported from barrel) | 2026-04-11 | 32 | 0 | orphan |
| competitive-research-analyst | 3 | 126 | yes (`competitive-research-analyst/systemPrompt.ts`) | no | 2026-04-11 | 30 | 0 | orphan |
| content-creator | 3 | 253 | yes (`content-creator/systemPrompt.ts`) | yes (`runContentCreator` — `agents/src/index.ts:22`) | 2026-04-22 | 37 | 13 | partially-wired |
| cpo | 3 | 383 | yes (`cpo/systemPrompt.ts`) | yes (`runCPO` — `agents/src/index.ts:5`) | 2026-04-23 | 51 | 0 | live |
| cto | 3 | 2474 | yes (`cto/systemPrompt.ts`) | yes (`runCTO` — `agents/src/index.ts:3`) | 2026-04-22 | 67 | 64 | live |
| design-critic | 3 | 218 | yes (`design-critic/systemPrompt.ts`) | no | 2026-04-11 | 16 | 0 | orphan |
| devops-engineer | 3 | 635 | yes (`devops-engineer/systemPrompt.ts`) | no | 2026-04-11 | 26 | 22 | partially-wired |
| frontend-engineer | 3 | 339 | yes (`frontend-engineer/systemPrompt.ts`) | no | 2026-04-11 | 22 | 11 | orphan |
| global-admin | 3 | 1715 | yes (`global-admin/systemPrompt.ts`) | no | 2026-04-11 | 25 | 0 | orphan |
| head-of-hr | 3 | 936 | yes (`head-of-hr/systemPrompt.ts`) | no | 2026-04-11 | 17 | 0 | orphan |
| m365-admin | 3 | 1151 | yes (`m365-admin/systemPrompt.ts`) | no | 2026-04-11 | 17 | 0 | orphan |
| market-research-analyst | 3 | 128 | yes (`market-research-analyst/systemPrompt.ts`) | no | 2026-04-11 | 34 | 2 | orphan |
| ops | 3 | 1046 | yes (`ops/systemPrompt.ts`) | yes (`runOps` — `agents/src/index.ts:14`) | 2026-04-23 | 67 | 29 | live |
| platform-engineer | 3 | 401 | yes (`platform-engineer/systemPrompt.ts`) | no | 2026-04-11 | 25 | 2 | partially-wired |
| platform-intel | 5 | 2097 | yes (`platform-intel/systemPrompt.ts`) | no | 2026-04-17 | 19 | 4 | orphan |
| quality-engineer | 3 | 429 | yes (`quality-engineer/systemPrompt.ts`) | no | 2026-04-11 | 24 | 0 | partially-wired |
| seo-analyst | 3 | 197 | yes (`seo-analyst/systemPrompt.ts`) | yes (`runSeoAnalyst` — `agents/src/index.ts:23`) | 2026-04-22 | 34 | 0 | partially-wired |
| social-media-manager | 3 | 273 | yes (`social-media-manager/systemPrompt.ts`) | no | 2026-04-11 | 33 | 3 | orphan |
| template-architect | 3 | 196 | yes (`template-architect/systemPrompt.ts`) | no | 2026-04-11 | 17 | 0 | orphan |
| ui-ux-designer | 3 | 205 | yes (`ui-ux-designer/systemPrompt.ts`) | no | 2026-04-11 | 17 | 0 | orphan |
| user-researcher | 3 | 208 | yes (`user-researcher/systemPrompt.ts`) | no | 2026-04-11 | 30 | 0 | orphan |
| vp-design | 3 | 841 | yes (`vp-design/systemPrompt.ts`) | yes (`runVPDesign` — `agents/src/index.ts:7`) | 2026-04-23 | 54 | 1 | live |
| vp-research | 3 | 223 | yes (`vp-research/systemPrompt.ts`) | yes (`runVPResearch` — `agents/src/index.ts:17`) | 2026-04-23 | 49 | 2 | live |
| vp-sales | 3 | 376 | yes (`vp-sales/systemPrompt.ts`) | yes (`runVPSales` — `agents/src/index.ts:21`) | 2026-04-23 | 45 | 0 | partially-wired |

LOC = `Get-Content … | Measure-Object -Line` over `*.ts` only (excludes blank-stripping; includes
imports/types/comments). Inbound counts use ripgrep over non-test files matched against the literal
`'<role>'` slug — they include *all* string mentions (config maps, denylists, schedule arrays),
not just runner imports. The runner-callable column is the load-bearing one.

### Status notes

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
  dry-run harness — never via real scheduler events. Status = partially-wired.
- **social-media-manager / user-researcher / competitive-intel / global-admin / m365-admin /
  frontend-engineer / platform-intel**: retired and unexported. Their `run<Role>` symbols are
  imported nowhere outside the role folder. `isLiveRuntimeRole` would reject scheduled wakes, and
  there is no other entry point. Status = orphan.
- **competitive-research-analyst / design-critic / head-of-hr / market-research-analyst /
  template-architect / ui-ux-designer**: scaffolded-but-unbuilt
  (`activeAgentRoster.ts:67-77`). Same analysis — no barrel export, no STATIC_RUNNERS entry, no
  imports of their `run<Role>` symbols. Status = orphan.

## 3. System prompts — sizes and locations

Token estimate = `chars / 4` over `Get-Content systemPrompt.ts -Raw` (single template literal per
file plus a tiny export wrapper).

| Role | Path | chars | ≈ tokens |
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

## 4. Tools — declared vs invoked

The pattern is uniform: `tools.ts` exports a `create<Role>Tools(memory)` factory that returns
`ToolDefinition[]`, each with a `name`, `description`, and `execute` (e.g. `cfo/tools.ts:13-29`).
The role's `run.ts` then composes a tool list from a set of `create*Tools` factory imports
(role-local + many under `agents/src/shared/`). The runtime `ToolExecutor`
(`agent-runtime/src/toolExecutor.ts`) is what actually invokes the tools when the LLM emits a
tool-call — there is no separate "I invoke tool X by name" code path inside the role files. So
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
  `vp-design/run.ts` includes ≈30 `create*Tools` factories which collectively register hundreds of
  tools — too many to fully cross-check by string, but the high-traffic ones
  (`figma_*`, `web_build_*`, `screenshot_*`, `deploy_preview_*`) are present in both prompt and
  wiring.
- **clo** prompt mentions `docusign_*` and `legal_*` tools; `clo/run.ts` wires
  `createDocuSignTools` and `createLegalDocumentTools`.

Per-role declared tool-def count (count of `name: '…'` lines in `<role>/tools.ts`) and wired
factory count (count of distinct `create*Tools` symbols imported into `<role>/run.ts`):

| Role | Tool-defs in role-local `tools.ts` | Distinct `create*Tools` factories wired in `run.ts` |
|---|---:|---:|
| cfo | 10 | 12 |
| chief-of-staff | 27 | 17 |
| clo | (clo has no `tools.ts` — only `run.ts` + `systemPrompt.ts`) | 10 |
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
  (and the 25 are inside `createM365AdminTools` which is *not in the import list* — that role is
  orphan). Wiring is incomplete in the role file even before runtime gating kicks in.
- `global-admin/tools.ts` declares 30 tool defs but the role is orphan; the prompt-listed admin
  capabilities are unreachable.

## 5. Models — `ROLE_COST_TIER` → `optimizeModel` → `resolveModel`

Source: `packages\shared\src\models.ts:627-704`.

```
TIER_MODELS:    { economy: 'model-router', standard: 'model-router', pro: 'model-router' }   (lines 630-634)
EXEC_CHAT_MODEL: 'model-router'                                                              (line 637)
DEFAULT_AGENT_MODEL: 'model-router'                                                          (line 182)
SUPPORTED_MODELS contains { id: 'model-router', … }                                          (line 102)
```

`optimizeModel(role, task, dbModel)` (`models.ts:688-704`) logic:

1. If `dbModel` is set → return `resolveModel(dbModel)` (line 694).
2. Else `tier = ROLE_COST_TIER[role] ?? 'standard'` (line 696).
3. If `task === 'on_demand'` and `tier === 'pro'` → return `EXEC_CHAT_MODEL` = `'model-router'`
   (lines 699-701).
4. Else return `TIER_MODELS[tier]` = `'model-router'` (line 703).

`resolveModel('model-router')` (`models.ts:423-438`) finds the id in `SUPPORTED_MODELS` and
returns `'model-router'` unchanged.

**Effective model for every role under the current registry is `model-router` for every task
type** — `on_demand`, scheduled (`work_loop`, `morning_briefing`, etc.), and orchestrator tasks
all collapse to the same value because all three tier buckets in `TIER_MODELS` were homogenised
to `'model-router'`. Per-role tier still drives unrelated logic (e.g. founder-chat semantics) but
not model selection.

For completeness, here is the requested role → tier mapping and the resolved model for the three
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
| platform-intel | **(unlisted)** → defaults to standard (`models.ts:696`) | model-router | model-router | model-router |

Roles missing from `ROLE_COST_TIER` get the `'standard'` default; `platform-intel` is the only
agent-folder role not explicitly enumerated in the tier map (`models.ts:640-676`).

The `resolveModel` shim in `agents/src/shared/createRunner.ts:24-31` simply forwards to
`optimizeModel`, so it produces the same result.

## 6. Headline findings

1. The runtime roster has shrunk to 8 truly-live roles in `server.ts`'s agentExecutor switch
   (`server.ts:1208-1334`), even though `activeAgentRoster.ts:10-23` still claims 12 active roles
   and the `@glyphor/agents` barrel exports 12 runner functions. **clo, devops-engineer,
   platform-engineer, quality-engineer** are in the keep roster but a scheduled wake to any of
   them returns `blockedRuntimeResult` — a silent no-op masquerading as "active".
2. **content-creator, seo-analyst, vp-sales** are retired roles
   (`activeAgentRoster.ts:37,38,47`) but their runner functions are still exported from the
   barrel and registered in `czProtocolApi.STATIC_RUNNERS`. They cannot run via the scheduler
   (gated out by `isLiveRuntimeRole`) but they do still ship and execute under the CZ-eval
   dry-run path. Either retire them fully (drop from barrel + STATIC_RUNNERS) or revive them.
3. **13 role folders are pure orphan code**: `competitive-intel, competitive-research-analyst,
   design-critic, frontend-engineer, global-admin, head-of-hr, m365-admin, market-research-analyst,
   platform-intel, social-media-manager, template-architect, ui-ux-designer, user-researcher`.
   Combined LOC ≈ **8,500**. None of their `run<Role>` symbols are imported anywhere outside their
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
6. `packages/agent-runtime/src/createRunner.ts` referenced in the brief does not exist — the only
   `createRunner` is `packages/agents/src/shared/createRunner.ts:36`. Anyone reading the brief
   should update internal docs accordingly.
7. Three roles ship with **zero role-local tool definitions**: `competitive-research-analyst`,
   `market-research-analyst`, `vp-research` (`vp-research/tools.ts` declares no `name:` fields).
   `clo` ships with **no `tools.ts` file at all**. Each of these still works because shared-tool
   factories are wired in `run.ts`, but the role-local tool layer is empty for them.

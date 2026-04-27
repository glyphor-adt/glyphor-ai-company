# Section 1 — Inventory & Verification

Audit date: 2026-04-27
Architecture doc verified: `docs/ARCHITECTURE.md` (note: doc lives under `docs/`, not at repo root as instructed; no `ARCHITECTURE.md` exists at root — verified via `Get-ChildItem -Recurse -Filter ARCHITECTURE.md`).

Methodology:
- Counts via `Get-ChildItem` over the filesystem.
- Doc claims pulled from quoted lines in `docs/ARCHITECTURE.md` (citations include `path:line`).
- Import analysis via a Node.js script (`_imp.js`, deleted after use) that walks `packages/`, `services/`, `workers/`, `scripts/`, parses `import ... from '...'`, `import '...'`, `export ... from '...'`, and `require('...')` for **relative specifiers only**, and resolves them with TS/JS extensions and `index.*` fallbacks. Cross-package imports via package names (e.g. `@glyphor/...` or workspace package names) are **not** counted — see caveat in §3/§4.
- LOC = newline count (`Measure-Object -Line`), excluding `node_modules`, `dist`, `.turbo`, `.venv`, `build`, `out`.

---

## 1. Doc-claimed vs filesystem-verified counts

| Metric | Doc claim (citation) | Verified | Δ | Δ% | Flag (>5%) |
|---|---|---|---|---|---|
| Workspace packages under `packages/` | 25 (`docs/ARCHITECTURE.md:24`) | 25 | 0 | 0% | — |
| Integration modules under `packages/integrations/src/` | 22 (`docs/ARCHITECTURE.md:25`) | 23 | +1 | +4.5% | — (under 5%) |
| File-based agent role dirs under `packages/agents/src/` | 28 (`docs/ARCHITECTURE.md:26`) | 28* | 0 | 0% | — |
| Dashboard page modules under `packages/dashboard/src/pages/` | 36 (`docs/ARCHITECTURE.md:27`) | 36 | 0 | 0% | — |
| SQL migrations under `db/migrations/` | 326 (`docs/ARCHITECTURE.md:28`) | 326 | 0 | 0% | — |
| Dockerfiles under `docker/` (`Dockerfile.*`) | 17 (`docs/ARCHITECTURE.md:29`) | 17 | 0 | 0% | — |
| Smoketest layers under `packages/smoketest/src/layers/` | 31 (layer 0–30) (`docs/ARCHITECTURE.md:30`) | 31 (`layer00-…layer30-`) | 0 | 0% | — |
| `TABLE_MAP` aliases in `packages/scheduler/src/dashboardApi.ts` | 88 (`docs/ARCHITECTURE.md:32`, `:1138`) | 88 | 0 | 0% | — |
| Distinct physical tables in `TABLE_MAP` | 60 (`docs/ARCHITECTURE.md:32`, `:1276`) | 60 | 0 | 0% | — |

\* `packages/agents/src/` contains **29 directories** total, but one is `shared/` (utility code, not a role). 29 − 1 = 28 role dirs, matching the doc. See `packages/agents/src/shared/` (referenced as a shared module at `docs/ARCHITECTURE.md:1353`, `:1373`).

### 1a. Integrations delta detail (doc 22 → fs 23)

The 23 directories under `packages/integrations/src/`:
`agent365, anthropic, aws, azure, canva, cloudflare, credentials, docusign, facebook, gcp, github, governance, kling, linkedin, mercury, openai, posthog, search-console, sendgrid, sharepoint, stripe, teams, vercel`.

The doc enumerates "22" without a full list, so identifying which one is the un-counted addition requires comparison with prior inventories — flagged as **uncertain** root cause. Likely candidates (younger directories): `governance/`, `credentials/`, or `agent365/`.

### 1b. TABLE_MAP source location

- Block defined at `packages/scheduler/src/dashboardApi.ts:170` (`const TABLE_MAP: Record<string, string> = {`) and closes at line 258.
- 88 alias keys, 60 distinct physical tables — exact match.

---

## 2. Top 20 largest source files (LOC)

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

## 3. Top 20 most-imported files (inbound from internal repo code)

Caveat: counts only **relative imports** (`./`, `../`). Cross-package imports via workspace package names are not counted, so cross-package "hot" modules (e.g. `packages/shared/src/index.ts`, `packages/agent-runtime/src/index.ts`) are under-represented — this view favors single-package "barrel" or hub modules. See §1 methodology.

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

Observation: The list is dashboard-dominated because dashboard uses heavy intra-package relative imports. `lib/firebase.ts`, `components/ui.tsx`, and `lib/types.ts` are clear hub/god-targets — any change to them has wide blast radius.

---

## 4. Top 20 files with most outbound imports (god-file candidates)

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
- `packages/agent-runtime/src/companyAgentRunner.ts` and `baseAgentRunner.ts` and `toolExecutor.ts` all appear in both LOC top-20 and outbound top-20 — strongest god-file candidates inside the runtime.

---

## 5. Findings summary

- All 9 quantitative claims from `docs/ARCHITECTURE.md` §3 / §10.3 are accurate. Only one minor delta: integration modules **22 → 23** (+4.5%, under 5% threshold but still a doc-drift).
- `TABLE_MAP` (88 aliases / 60 tables) is exactly as documented.
- Identified god-file candidates (LOC + fan-out + hub-imports): `packages/scheduler/src/server.ts`, `packages/agent-runtime/src/companyAgentRunner.ts`, `packages/agent-runtime/src/baseAgentRunner.ts`, `packages/agent-runtime/src/toolExecutor.ts`.
- Identified blast-radius hubs (most-imported): `packages/dashboard/src/lib/firebase.ts`, `packages/dashboard/src/components/ui.tsx`, `packages/dashboard/src/lib/types.ts`.
- Methodology limitation: cross-package imports are not counted in §3/§4. A follow-up pass that resolves workspace package specifiers would likely surface `packages/shared/src/index.ts`, `packages/agent-runtime/src/index.ts`, and `packages/integrations/src/index.ts` higher in the inbound list.

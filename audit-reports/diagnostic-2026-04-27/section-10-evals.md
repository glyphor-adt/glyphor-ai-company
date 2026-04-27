# Section 10 — Eval and Quality-Signal Coverage

Audit date: 2026‑04‑27. Scope: every eval surface that could be used to judge agent task quality.

---

## 10.1 Eval definitions in the codebase

### Schema (DDL)

| Table / view | Purpose | Defined at |
| --- | --- | --- |
| `agent_eval_scenarios` | Library of judge‑scored scenarios (input prompt + pass/fail criteria + tags) | `db/migrations/20260314000100_agent_knowledge_evals.sql:4` |
| `agent_eval_results` | One row per scenario × run, stores PASS / SOFT_FAIL / HARD_FAIL judge verdict | `db/migrations/20260314000100_agent_knowledge_evals.sql:52` |
| `agent_readiness` (view) | Latest pass-rate rollup per role | `db/migrations/20260314000100_agent_knowledge_evals.sql:106` |
| `assignment_evaluations` | Append‑only T+1 evaluations on `work_assignments` (executive / team / judge / constitutional / tool_accuracy / cos) | `db/migrations/20260319000200_assignment_evaluations.sql:5` |
| `task_run_outcomes.per_run_quality_score` | Deterministic per‑run score (turn count / failures / cost) | `db/migrations/20260317140000_per_run_quality_score.sql` |
| `tool_test_classifications` / `tool_test_runs` / `tool_test_results` | Schema / connectivity / sandbox tests for tool definitions | `db/migrations/20260321090000_tool_test_schema.sql:1,13,26` |
| `cz_shadow_evals` / `cz_shadow_attempts` | CZ challenger‑prompt shadow promotion gate | `db/migrations/20260422081600_cz_shadow_eval.sql:17,71` |
| `shadow_runs` | Generic shadow‑run capture for prompt versions | `db/migrations/20260318200100_shadow_runs.sql:4` |
| `constitutional_evaluations` | Constitution‑adherence per run | referenced in `packages/smoketest/src/layers/layer07-intelligence.ts:23` and `packages/agent-runtime/src/constitutionalGovernor.ts:213` |
| `gtm_readiness_reports` | GTM gate snapshot | `db/migrations/20260319001500_gtm_readiness_reports.sql` |

There is **no `run_evaluations` table**. The table named in this prompt does not exist; the analogous T+1 surface is `assignment_evaluations`.

### Seeded scenarios (`agent_eval_scenarios`)

| Migration | Roles seeded | Scenario count |
| --- | --- | --- |
| `db/migrations/20260314000100_agent_knowledge_evals.sql:151` | cmo (5), cto (5), cfo (5) | 15 |
| `db/migrations/20260319000500_marketing_eval_scenarios.sql:4` | content-creator (3), seo-analyst (3), social-media-manager (3) | 9 |
| `db/migrations/20260319001600_seed_gtm_knowledge_eval_scenarios.sql:4` | chief-of-staff (3), content-creator (3), seo-analyst (3), social-media-manager (3) | 12 |
| `db/migrations/20260319002300_seed_platform_intel_eval_scenarios.sql:2` | platform-intel (3) | 3 |
| `db/migrations/20260403010000_seed_golden_v1_eval_scenarios.sql:4` | chief-of-staff, cmo, cto, cfo, content-creator, seo-analyst, social-media-manager, platform-intel — one `golden:` per role | 8 |

**Total seeded: ~47 scenarios** covering 8 distinct roles.

### Eval runners / writers

- **Knowledge / golden judge**: `packages/scheduler/src/agentKnowledgeEvaluator.ts:65` (`evaluateAgentKnowledgeGaps`). Wired to the cron via `/agent-evals/run` (Mon 09:00 UTC) and `/agent-evals/run-golden` (Wed 10:30 UTC) at `packages/scheduler/src/cronManager.ts:291,299`. Only **5 role runners** are registered (`packages/scheduler/src/agentKnowledgeEvaluator.ts:56-63`): `cmo`, `cto`, `cfo`, `chief-of-staff`, `vp-research`. Any scenario whose `agent_role` is not in that map is logged and skipped (`agentKnowledgeEvaluator.ts:128-131`). That orphans every seeded scenario for `content-creator`, `seo-analyst`, `social-media-manager`, `platform-intel` — i.e. **23 of 47 scenarios (~49%) have no runner and never execute.**
- **Per‑run deterministic score**: `packages/agent-runtime/src/taskOutcomeHarvester.ts` (function `computePerRunQualityScore`, smoketested at `packages/smoketest/src/layers/layer29-per-run-evaluation.ts:62`). Inputs: `final_status`, `tool_failure_count`, `turn_count`, `had_partial_save`, `cost_usd` — i.e. "did it crash?", not "was it good?".
- **Batch outcome evaluator**: `packages/scheduler/src/batchOutcomeEvaluator.ts:54` runs at 02/14:00 UTC daily (`cronManager.ts:230`). Algorithmic, no LLM. Reads `task_run_outcomes`, writes back `batch_quality_score`. Also fires `evaluateToolAccuracy` per outcome (line 149).
- **Tool accuracy judge**: `packages/scheduler/src/toolAccuracyEvaluator.ts:75` — LLM judge over `tool_call_traces`, writes `assignment_evaluations` with `evaluator_type='tool_accuracy'` (line 136). Triggered fire‑and‑forget from the batch evaluator only when an outcome has both `run_id` AND `assignment_id` (`batchOutcomeEvaluator.ts:136`).
- **Executive / team accept‑reject**: `packages/agents/src/shared/executiveOrchestrationTools.ts:505,541`; `packages/agents/src/shared/teamOrchestrationTools.ts:555,598`; `packages/agents/src/chief-of-staff/tools.ts:2308`. Only fire when an executive agent calls `evaluate_assignment` on work it created.
- **Constitutional**: `packages/agent-runtime/src/constitutionalGovernor.ts:213`, dual‑writes to `assignment_evaluations`.
- **Tool tests (Tier 1/2/3)**: `packages/agent-runtime/src/testing/toolTestRunner.ts:52` (creates `tool_test_runs`), `tier1SchemaValidator.ts:101`, `tier2ConnectivityTester.ts:611`, `tier3TestCases.ts:111,138,156` (all write `tool_test_results`). Triggered from `/tool-tests/run` (`packages/scheduler/src/server.ts:3596`).
- **GTM readiness**: `packages/scheduler/src/gtmReadiness/gtmReadinessEvaluator.ts:45` — aggregator only, *reads* signals (performance_score, accuracy, output_quality, success_rate, constitutional, tool_accuracy, knowledge_eval, p0s, aborts, tool_failure_rate). Produces nothing new; just a gate.
- **CZ shadow eval**: `cz_shadow_evals` consumed by the orchestrator tick loop; no per‑run quality signal of its own — promotes prompts based on baseline pass‑rate already produced upstream.

### "Tests labeled eval"

- `packages/smoketest/src/layers/layer29-per-run-evaluation.ts` — 5 tests, all of which are **`assertIncludes(file, "literal_string")` static text checks**, not behavioural. They verify column names exist in a migration file. They do not run any agent.
- `scripts/eval-*.ts` (15 files) — diagnostic / one‑shot SQL inspection scripts (`eval-diag-joins.ts`, `eval-recompute-scores.ts`, `eval-schema-check.ts`, `eval-section2-api.ts` … `eval-verify-promptv.ts`). None contain agent quality assertions; all read the DB and `console.log` numbers. `scripts/verify-eval-scoring.ts:22-23` literally prints `(empty — expected before evaluators run)` for `assignment_evaluations`.
- `packages/agents/src/**/*.test.ts` — only **3 unit tests** exist over the entire agents package: `contentTools.test.ts`, `socialMediaTools.test.ts`, `webBuildTools.test.ts`, plus one runtime test `reactiveTurnBudget.test.ts`. None evaluate task quality of an agent role.

---

## 10.2 Per‑role task‑quality coverage

Roles enumerated from `packages/agents/src/` (29 directories, excluding `shared`).

A role has a "task‑quality eval" only if **(a)** at least one row in `agent_eval_scenarios` is seeded for it AND **(b)** a runner is registered in `agentKnowledgeEvaluator.RUNNERS` (`packages/scheduler/src/agentKnowledgeEvaluator.ts:56-63`) so the judge can actually score it. Anything else is a paper eval.

| Role | Has any eval row? | Runner registered? | Real task-quality eval? | Path:line |
| --- | --- | --- | --- | --- |
| chief-of-staff | yes (4) | yes | **yes** | `db/migrations/20260319001600_seed_gtm_knowledge_eval_scenarios.sql:7,14,21` + `agentKnowledgeEvaluator.ts:61` |
| cmo | yes (6) | yes | **yes** | `db/migrations/20260314000100_agent_knowledge_evals.sql:154` + `agentKnowledgeEvaluator.ts:57` |
| cto | yes (6) | yes | **yes** | `db/migrations/20260314000100_agent_knowledge_evals.sql:208` + `agentKnowledgeEvaluator.ts:58` |
| cfo | yes (6) | yes | **yes** | `db/migrations/20260314000100_agent_knowledge_evals.sql:257` + `agentKnowledgeEvaluator.ts:59` |
| vp-research | no scenarios seeded | yes | **no** (runner has nothing to feed it) | `agentKnowledgeEvaluator.ts:62` |
| content-creator | yes (7) | **no** | **no — orphaned** | scenarios at `20260319000500_marketing_eval_scenarios.sql:7`, `20260319001600_…:29`; runner missing |
| seo-analyst | yes (7) | **no** | **no — orphaned** | `20260319000500_…:26`, `20260319001600_…:51` |
| social-media-manager | yes (7) | **no** | **no — orphaned** | `20260319000500_…:45`, `20260319001600_…:73` |
| platform-intel | yes (4) | **no** | **no — orphaned** | `20260319002300_seed_platform_intel_eval_scenarios.sql:2`, `20260403010000_…:79` |
| clo | no | no | **no** | — |
| cpo | no | no | **no** | — |
| competitive-intel | no | no | **no** | — |
| competitive-research-analyst | no | no | **no** | — |
| design-critic | no | no | **no** | — |
| devops-engineer | no | no | **no** | — |
| frontend-engineer | no | no | **no** | — |
| global-admin | no | no | **no** | — |
| head-of-hr | no | no | **no** | — |
| m365-admin | no | no | **no** | — |
| market-research-analyst | no | no | **no** | — |
| ops | no | no | **no** | — |
| platform-engineer | no | no | **no** | — |
| quality-engineer | no | no | **no** | — |
| template-architect | no | no | **no** | — |
| ui-ux-designer | no | no | **no** | — |
| user-researcher | no | no | **no** | — |
| vp-design | no | no | **no** | — |
| vp-sales | no | no | **no** | — |

**Score: 4 of 29 roles (13.8%) have a wired, judge‑scored task‑quality eval.** A further 4 roles have scenario rows but no runner, and 21 have nothing.

The "core eight" live roster (`db/migrations/20260408213000_reduce_live_roster_to_core_eight.sql`) contains exactly the 4 working roles plus `content-creator`, `seo-analyst`, `social-media-manager`, `platform-intel` — i.e. **half of the live roster has eval scenarios written but never executed.**

---

## 10.3 When was each eval last run, and what's checked in?

**Nothing is checked in.** Searched the repo for `*.snap`, `fixtures/`, JSON result blobs, and `last_run_*` columns:

- No snapshot or fixture files for any eval (`Get-ChildItem -Filter *.snap` returns only `node_modules` matches).
- `agent_eval_results` rows live only in the live Postgres database; there is no committed export.
- `audit-reports/*-audit.json` files are *roster audits*, not eval results, and most are dated 2026‑03‑17 / 2026‑04‑16.
- `agentKnowledgeEvaluator.ts` writes a Redis lock (`agent-knowledge-eval-lock`, TTL 1h) and `console.log`s the report; output is not persisted outside `agent_eval_results` rows.
- `verify-eval-scoring.ts:22-23` explicitly says of `assignment_evaluations`: `(empty — expected before evaluators run)`. That string is still in the script, which suggests the post‑deploy follow‑up never ran (or was never updated).
- The only "last run" timestamps are general `last_run_at` on `tenant_agents` / `company_agents` (run cadence, not eval cadence).

So: from the repo alone, you **cannot tell whether any eval has ever produced a result.** You can only confirm the cron entries claim Mon 09:00 UTC and Wed 10:30 UTC schedules.

---

## 10.4 Tool‑test coverage vs the tool universe

Tool universe (Section 3 placeholder): `packages/agents/src/shared/*Tools.ts` = **75 source files** (each defines multiple tool functions; conservatively several hundred tools total).

Coverage by tier (from `packages/agent-runtime/src/testing/`):

| Tier | What it tests | How many tools | File / line |
| --- | --- | --- | --- |
| Tier 1 | JSON‑schema validity of the tool *definition* | All tools known to `getAllKnownTools()` + `tool_registry` rows (`toolTestRunner.ts:26-33`) | `tier1SchemaValidator.ts:101` |
| Tier 2 | Live connectivity / probe call (no behavioural assertion) | Only tools classified `live` or `probe` in `tool_test_classifications` | `tier2ConnectivityTester.ts:611` |
| Tier 3 | Sandboxed execution with assertions | **5 tools, hard‑coded** (`send_email`, `send_teams_dm`, `write_world_state`, `create_fleet_finding`, `propose_initiative`) | `tier3TestCases.ts:17-` |

Tier 1 is "does the JSON parse?" Tier 2 is "did the remote return any 2xx?" Neither asserts the tool *did the right thing*. Only Tier 3 does, and Tier 3 hits **5 tools**.

Best‑effort denominator: assume the 75 `*Tools.ts` files declare ~150 tools. Then meaningful behavioural coverage is **5 / ~150 ≈ 3%**. Even taking the most generous view (count Tier 2 connectivity as "coverage"), it's a single‑digit percentage of tools that are `live`/`probe`‑classified in `tool_test_classifications`.

---

## 10.5 `assignment_evaluations` (the actual T+1 table)

`run_evaluations` does not exist. The table that plays its role is `assignment_evaluations`. Six call sites write to it:

1. `packages/agents/src/shared/executiveOrchestrationTools.ts:505` — fires only when an exec agent calls the `evaluate_assignment` tool to **accept** their delegated work. Score range 1–5 normalized to 0–1.
2. `packages/agents/src/shared/executiveOrchestrationTools.ts:541` — same, **revise** branch.
3. `packages/agents/src/shared/teamOrchestrationTools.ts:555,598` — team‑lead variants of the same tool.
4. `packages/agents/src/chief-of-staff/tools.ts:2308` — CoS quality scoring.
5. `packages/agent-runtime/src/constitutionalGovernor.ts:222` — only fires from the constitutional evaluator and only **if `assignmentId` was supplied** (line 219 guard) — many runs don't pass one.
6. `packages/scheduler/src/toolAccuracyEvaluator.ts:136` — fire‑and‑forget from the batch evaluator, but only for outcomes with **both** `run_id` and `assignment_id` (`batchOutcomeEvaluator.ts:136`) and only when the run had at least one tool call (`toolAccuracyEvaluator.ts:92`).

How often it would actually fire:
- Paths 1–4 require a human or an executive agent to deliberately call `evaluate_assignment` against an existing `work_assignment`. There is no policy that forces this.
- Path 5 is gated on the constitutional governor being invoked **and** an assignment id being threaded through (it isn't, in most callers).
- Path 6 is the most automatic path, but the verify‑eval‑scoring script (line 23) treats `assignment_evaluations` as expected‑empty, and `task_run_outcomes` linkage to `assignment_id` is itself inconsistent (the script's whole purpose is to measure `with_assignment / total_outcomes` coverage).

The table is not dead in code — it has six writers — but every writer is conditional on an upstream coupling (an `assignment_id`, an executive accept call, a constitution invocation) that there is no evidence is reliably populated. From the repo alone, **expected fill rate is unknown and the most diagnostic script in the codebase assumes it's empty.**

---

## Brutal honest assessment

> *If the only thing I had to judge agent quality were the data currently in this database, what could I conclude?*

**Almost nothing — and nothing about most agents.**

1. **Only 4 of 29 roles can be scored on task quality at all.** `cmo`, `cto`, `cfo`, `chief-of-staff` have seeded scenarios *and* a runner in `agentKnowledgeEvaluator.RUNNERS` (`packages/scheduler/src/agentKnowledgeEvaluator.ts:56-63`). For the other 25 roles — including 18 that are part of the live roster or referenced in seeds — there is either no scenario row or no runner. Every `content-creator`, `seo-analyst`, `social-media-manager`, and `platform-intel` scenario is paper: 23 of 47 seeded scenarios (49%) are silently skipped on every cron tick.

2. **`vp-research` is a runner with no scenarios** (`agentKnowledgeEvaluator.ts:62`) — the inverse problem; it would do nothing if invoked.

3. **The "per‑run quality score" is not a quality score.** It is a deterministic function of `final_status`, `tool_failure_count`, `turn_count`, `had_partial_save`, and `cost_usd` (`packages/smoketest/src/layers/layer29-per-run-evaluation.ts:76-80`). It tells you whether the run *finished*, not whether the output was correct, on‑brand, useful, or factually grounded. A confident, well‑formatted hallucination scores identically to a correct answer.

4. **Tool quality coverage is ~3%.** Five tools (`send_email`, `send_teams_dm`, `write_world_state`, `create_fleet_finding`, `propose_initiative`) have actual behavioural Tier‑3 tests (`packages/agent-runtime/src/testing/tier3TestCases.ts:17-`). Everything else gets, at best, a JSON‑schema parse and a TCP probe. The hundreds of agent‑facing tools in `packages/agents/src/shared/*Tools.ts` are functionally untested.

5. **`assignment_evaluations` is the only T+1 quality surface and its fill rate is unknown but assumed empty by the codebase's own verifier** (`scripts/verify-eval-scoring.ts:22-23` literally prints `(empty — expected before evaluators run)`). Even when populated, four of the six writers depend on a human or executive‑agent action that nothing forces to happen.

6. **No eval results are checked in.** No fixtures, no snapshots, no committed history. The repo can prove the eval *plumbing* exists; it cannot prove any eval has ever produced a verdict. The only way to know is to query live Postgres, and the most recent diagnostic script in the repo tells you to expect nothing there.

7. **The eval cron exists, but the cron firing ≠ a useful signal.** Even if `agent-knowledge-evals` (Mon 09:00 UTC) and `golden-eval-suite` (Wed 10:30 UTC) ran cleanly, they only produce a verdict for 4 of 29 roles. The dashboard's `agent_readiness` view will show "100% pass" for an agent that was simply never evaluated.

**Bottom line:** The data in this database can support exactly one statement about agent quality: *"For four executive roles (cmo / cto / cfo / chief-of-staff), if the eval cron has fired since the last seed update, an LLM judge graded them PASS / SOFT_FAIL / HARD_FAIL on a handful of hand‑written scenarios."* For everything else — content quality, tool selection, downstream impact, and 25 of 29 agents — **the system has no opinion, and the absence of an opinion is not visible to anyone reading the dashboard.** That is the worst kind of eval gap: it looks like coverage.

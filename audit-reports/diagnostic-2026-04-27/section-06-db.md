# Section 6 — Database & Migrations

Scope: `db/migrations/` (Postgres / Cloud SQL).
Evidence root: `db/migrations/*.sql`, `packages/**/*.ts`.

---

## 1. Migration count and total LOC

- **Files:** 326 SQL migrations under `db/migrations/`.
- **Total LOC:** 27,551 lines (raw `Get-Content … Measure-Object -Line`).
- Earliest: `db/migrations/20260222025612_new-migration.sql`.
- Latest cz_*: `db/migrations/20260422081600_cz_shadow_eval.sql`.

Cite: enumerated via `Get-ChildItem db\migrations -Filter *.sql` (counts surface in `scratch/_create_tables.txt`, `scratch/_add_columns.txt`).

---

## 2. Migrations applied then explicitly reverted

### 2a. Schema reverts (DROP TABLE / DROP COLUMN)

`DROP TABLE` is **not used anywhere** in `db/migrations/` (0 hits). All schema reversions are at the column level, in two migrations:

| Created in | Reverted in |
|---|---|
| `db/migrations/20260225100000_agent_identity.sql:10` — `agent_profiles.avatar_emoji TEXT DEFAULT '🤖'` (defined in CREATE TABLE) | `db/migrations/20260227100037_strip_emojis.sql:7` — `ALTER TABLE agent_profiles DROP COLUMN IF EXISTS avatar_emoji;` |
| `db/migrations/20260227000000_collective_intelligence.sql:9-40` — CREATE TABLE `company_pulse` with `new_users_today`, `churn_events_today`, `uptime_streak_days`, `avg_build_time_ms`, `meetings_today`, `messages_today`, `platform_status`, `active_incidents`, `decisions_pending` | `db/migrations/20260316180000_rename_pulse_to_vitals.sql:12-25` — table renamed to `company_vitals`; the 9 listed columns dropped (`DROP COLUMN IF EXISTS …`). A backwards-compat view `company_pulse` is recreated at `:92`. |

### 2b. Data-only reverts (`_remove_*`, `_purge_`)

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

All nine target seeded *content* (`agent_skills`, `tool_registry`, `model_registry`, `agent_tool_grants`, `executive_orchestration_config`) — not table or column structure.

---

## 3. Tables created by migrations but never referenced in `packages/**/*.ts`

219 distinct tables are created via `CREATE TABLE` across the 326 migrations (`scratch/_unique_tables.txt`). Cross-referenced against the entire TS source (686 files, ~7.98 MB blob, word-boundary match):

**Unreferenced (8):**
1. `account_dossiers` — `db/migrations/20260227100020_strategy_lab.sql` (first CREATE)
2. `agent_capacity_role_defaults` — `db/migrations/20260309120000_agent_capacity.sql`
3. `conversation_references` — `db/migrations/20260227100013_knowledge_management.sql`
4. `metrics_cache` — `db/migrations/20260227100008_metrics_cache.sql`
5. `platform_intel_reports` — `db/migrations/20260301000000_platform_intel.sql`
6. `support_responses` — `db/migrations/20260227100024_customer_success.sql`
7. `value_assessments` — `db/migrations/20260227100022_value_capture.sql`
8. `world_state_history` — `db/migrations/20260306000000_world_model.sql`

(Filenames inferred from `scratch/_create_tables.txt`; resolve precisely with `Select-String -Path db/migrations/*.sql -Pattern 'CREATE TABLE.*<name>'`.)

These are candidates for either (a) deletion or (b) wiring up — there is no executing code that reads or writes them.

---

## 4. Tables referenced in TS that have no `CREATE TABLE` migration

Heuristic: regex over SQL-like quoted strings in `packages/**/*.ts` for `(FROM|INTO|UPDATE|JOIN)\s+<name>`. After filtering English/keyword noise, the plausible undefined tables are:

| Referenced as | Cite | Verdict |
|---|---|---|
| `agent_completion`, `agent_memories`, `agent_policy_limits` | various `packages/scheduler`, `packages/agents` | **likely typos / shadow names** — `agent_memory` exists in `db/migrations/20260225000000_*`; the `_policy_limits` and `_completion` variants have no DDL. |
| `delegation_performance` | `packages/scheduler/src/dashboardApi.ts` (FROM-clause string) | **missing** — no migration creates it |
| `pending_decisions` | `packages/scheduler/src/dashboardApi.ts` | **alias / view candidate** — no DDL match (compare `decisions WHERE status='pending'` queries at `dashboardApi.ts:1600`) |
| `recent_runs`, `direct_matches`, `last_two`, `wa_agg`, `ae_agg` | dashboard/scheduler | **CTE aliases**, not real tables |
| `image_manifest`, `tier3_test_cases`, `tool_gap`, `chat_reasoning_protocol`, `social_replies`, `target_agents`, `available_sections`, `compute_performance_scores` | scattered TS strings | **no migration found** — most are ad-hoc/unused in production paths |
| `jsonb_to_recordset`, `unnest`, `array_append_unique`, `match_memories`, `merge_research_packet`, `update_trust_score`, `list_tool_requests`, `append_chain_links` | TS SQL | **Postgres functions, not tables** (false positives from regex) |
| `information_schema` | `packages/scheduler/src/dashboardApi.ts:1405,1424` | system catalog (expected) |

Net real gap: **`agent_completion`, `agent_policy_limits`, `delegation_performance`, `image_manifest`, `tier3_test_cases`, `tool_gap`, `chat_reasoning_protocol`, `social_replies`, `target_agents`, `compute_performance_scores`** appear in TS SQL strings without any matching `CREATE TABLE` — likely dead code referencing tables that were never created or were renamed away.

(Full sweep in `scratch/_ts_only_tables.txt`.)

---

## 5. Columns added then later dropped (`ADD COLUMN x` … `DROP COLUMN x`)

147 `ADD COLUMN` statements vs 11 `DROP COLUMN` statements. Pairing strictly on `ALTER TABLE … ADD COLUMN` → `ALTER TABLE … DROP COLUMN`: **zero matches**. Every dropped column was originally created inline as part of `CREATE TABLE`, not added later via `ALTER`.

Drops (all are CREATE-then-DROP, not ADD-then-DROP):

- `agent_profiles.avatar_emoji` — created inline in `db/migrations/20260225100000_agent_identity.sql:10`; dropped in `db/migrations/20260227100037_strip_emojis.sql:7`.
- `company_vitals.{new_users_today, churn_events_today, uptime_streak_days, avg_build_time_ms, meetings_today, messages_today, platform_status, active_incidents, decisions_pending}` — created inline in `db/migrations/20260227000000_collective_intelligence.sql:16-40` (as `company_pulse`); dropped in `db/migrations/20260316180000_rename_pulse_to_vitals.sql:15-25`.

Conclusion: **no `ALTER TABLE … ADD COLUMN` was ever later reverted by `DROP COLUMN`.** The only column churn happened against initial table definitions.

---

## 6. Foreign keys: TS code vs migration schema

The TS codebase has **no Drizzle/Prisma/TypeORM schema file**:

- `Select-String pgTable|drizzle|prisma -Path packages\**\*.ts` → **0 hits**.
- All DB access is via raw SQL through `@glyphor/shared/db` (`systemQuery`, `systemTransaction`); see `packages/scheduler/src/dashboardApi.ts:15`.
- No `.references(...)` / `FOREIGN KEY` declarations exist in TS.

Therefore **no TS-side FK declarations diverge from migrations**, by construction — there is no second source of truth. The schema is migration-only.

Migrations declare 221 `REFERENCES` clauses across the 326 files (FK constraints); these are the only FK definitions in the system.

Risk note: because TS speaks raw SQL, **referential integrity is enforced only by Postgres**, and the dashboard's `DELETE … FROM` cascade chain in `packages/scheduler/src/dashboardApi.ts:282-313` (deletes from `agent_tool_grants`, `a2a_tasks`, `social_publish_audit_log`, `social_metrics`, `scheduled_posts`, `content_drafts`, `deliverables`, `task_run_outcomes`, `work_assignments`, `tool_requests`, `decision_chains`, `handoffs`, `proposed_initiatives`, `plan_verifications`, `workflows`) is hand-rolled cascade logic that must stay synced with FK definitions in migrations. Any new FK added in a future migration without updating that block will silently violate cascade semantics.

---

## 7. cz_* migrations — Customer Zero Protocol

All `cz_*` migrations and their inferred status:

| # | File | One-line summary | Verdict |
|---|---|---|---|
| 1 | `db/migrations/20260417160000_cz_schema.sql` | Creates `cz_tasks`, `cz_runs`, `cz_scores`, `cz_pillar_config`, `cz_launch_gates` (5 tables) — the core CZ Protocol schema. | **live** — all 5 tables referenced in TS (cz_tasks×26, cz_runs×32, cz_scores×18, cz_pillar_config×2, cz_launch_gates×2). |
| 2 | `db/migrations/20260417160001_cz_seed.sql` | Seeds pillar configs, launch gates, and 67 protocol tasks. | **live** — superseded only in part by gate-relax migrations below. |
| 3 | `db/migrations/20260417160002_cz_surface_addon.sql` | Adds `surface` column to `cz_runs` (direct/teams/slack), recreates `cz_latest_scores` view, adds "Chat Surface Fidelity" pillar, seeds tasks 68-89. | **live** — additive, no later overrides. |
| 4 | `db/migrations/20260417210000_cz_scores_agent_output.sql` | `ALTER TABLE cz_scores ADD COLUMN agent_output TEXT`; expands `judge_tier` to allow `llm-judge`/`error`. | **live** — additive, never reverted. |
| 5 | `db/migrations/20260421120000_cz_launch_gate_p0_threshold.sql` | Replaces `p0_must_be_100` boolean gate with numeric `p0_pass_rate_min`; relaxes `design_partner_ready` to P0≥90%, overall≥70%. | **live** — supersedes earlier strict 100% gate from cz_seed; effective contract. |
| 6 | `db/migrations/20260421120100_cz_investor_gate_relax.sql` | Relaxes `investor_ready` gate to P0≥80%, overall≥80%. | **live** — supersedes corresponding row from cz_seed. |
| 7 | `db/migrations/20260421130000_cz_reassign_retired_agents.sql` | Reassigns CZ tasks owned by retired agents (vp-sales, content-creator, seo-analyst, social-media-manager → active equivalents). | **live (one-shot data fix)** — fixes drift caused by 2026-04-18 roster prune. |
| 8 | `db/migrations/20260421190000_cz_reassign_tenancy_tasks_to_cto.sql` | Reassigns Identity & Tenancy CZ tasks from `sarah` (chief-of-staff) to `marcus` (cto). | **live (one-shot data fix)** — task-routing correction; no later override. |
| 9 | `db/migrations/20260422081600_cz_shadow_eval.sql` | Creates `cz_shadow_evals`, `cz_shadow_attempts`, `cz_automation_config` for auto-promotion of CZ reflection challengers (staged → shadow_running → promoted/retired). | **live** — referenced 32× in TS (`cz_shadow*`). Newest CZ migration; no overrides yet. |

No cz_* tables are dropped or referenced as `_remove_/_revert_`. The `cz_chat_threads/turns/artifacts` names sometimes assumed to exist do **not** appear in either migrations or TS — Chat Surface Fidelity reuses `cz_runs.surface` rather than introducing per-surface tables.

---

## Summary

- 326 migrations / 27,551 LOC. **No `DROP TABLE` ever** — all reversions are column-level (10 columns across 2 migrations) or data-level (9 `_remove_*` migrations).
- **0** `ADD COLUMN`→`DROP COLUMN` pairs; column churn is contained to original `CREATE TABLE` definitions.
- **8** tables created but unreferenced in TS (candidates for deletion: `account_dossiers`, `agent_capacity_role_defaults`, `conversation_references`, `metrics_cache`, `platform_intel_reports`, `support_responses`, `value_assessments`, `world_state_history`).
- **~10** TS SQL strings reference table names with no migration (likely dead code: `agent_completion`, `agent_policy_limits`, `delegation_performance`, `image_manifest`, `tier3_test_cases`, `tool_gap`, `chat_reasoning_protocol`, `social_replies`, `target_agents`, `compute_performance_scores`).
- **No Drizzle/Prisma layer** exists; FK schema lives only in migrations (221 `REFERENCES` clauses). Hand-rolled cascade in `packages/scheduler/src/dashboardApi.ts:282-313` is the only TS-side referential coupling and must be kept in sync manually.
- All **9 cz_* migrations are live**; the gate-threshold pair (`cz_launch_gate_p0_threshold`, `cz_investor_gate_relax`) supersedes the strict gates seeded in `cz_seed`, but additively (UPDATE in place), so the seed is not dead — it is the v1 of a v2 row.

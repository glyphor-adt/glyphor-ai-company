# Agent Runtime Hooks + Tracing Runbook

This runbook covers safe rollout of the new runtime hook framework and trace span telemetry.

## Features Covered

- Tool lifecycle hooks:
  - Pre-tool hooks can allow/block tool execution.
  - Post-tool hooks receive execution outcomes.
- SSRF-safe outbound hook calls:
  - Blocks localhost, metadata endpoints, and private CIDR destinations.
  - Optional host allowlist support.
- Trace spans:
  - Structured `[TraceSpan]` logs for model attempts and tool execution.
  - Cloud Run summary command for p50/p95/avg reporting.
- Capacity tier × tool risk (graded autonomy):
  - Shared classifier `classifyActionRisk` (`AUTONOMOUS` | `SOFT_GATE` | `HARD_GATE`) aligns capacity checks with runtime risk labels.
  - **Observe** tier allows only **autonomous-risk** tools, then still enforces read-only trait heuristics.
  - **Execute** tier optional **strict soft-gate**: metadata flag requires human approval for every soft-gate-classified tool.

## Capacity tiers and action risk (ops)

Use this when debugging unexpected **approval required** or **blocked** tool calls alongside hooks and tracing.

| Layer | Behavior |
| --- | --- |
| **HARD_GATE** (runtime) | Blocked in the tool executor before capacity, unless the flow is approval-gated and cleared. |
| **`enforceCapacityTier`** (shared DB policy) | Applies per-agent `agent_capacity_config` (tier, lists, metadata). |
| **Observe** | Tool must be **`AUTONOMOUS`** under `classifyActionRisk` *and* pass read-only trait rules. |
| **Draft / Execute / Commit** | Existing trait and list rules unchanged; Execute adds optional strict soft-gate (below). |

**Strict soft-gate (Execute tier only):** When `agent_capacity_config.metadata.strict_soft_gate_approval` is true (camelCase `strictSoftGateApproval` is also accepted), every tool classified **`SOFT_GATE`** requires human approval even if it is not listed under `requires_human_approval_for`.

**Where to configure:** Dashboard → Governance → **Authority Profile** (save sends `metadata` merged via `PUT /admin/agents/:id/capacity`).

**Commitment records:** New commitments may include `derivedTraits.actionRiskLevel` for audit alignment with the classifier.

**Code references:** `packages/shared/src/actionRiskClassifier.ts`, `packages/shared/src/agentCapacity.ts` (`enforceCapacityTier`), `packages/agent-runtime/src/toolExecutor.ts` (ordering vs hooks).

## Environment Variables

- `TOOL_HOOKS_CONFIG`
  - JSON string containing hook endpoints and optional allowlist.
  - Prefer storing this as a Secret Manager secret and mounting it as `TOOL_HOOKS_CONFIG` in Cloud Run.
  - See examples in `docs/examples/tool-hooks-config.staging.json` and `docs/examples/tool-hooks-config.production.json`.
- `AGENT_TRACING_ENABLED`
  - Enable trace span logs when truthy (`1`, `true`, `yes`, `on`).
  - Recommended: enable in staging first, then one production service canary.
- `AGENT_PLANNING_POLICY_JSON`
  - Optional JSON override for planner/executor and completion-gate policy.
  - Built-in defaults:
    - strict (`required`) for `frontend-engineer`, `vp-design`, `ui-ux-designer` on non-`on_demand` tasks,
    - `auto` for most task-tier roles on non-`on_demand`,
    - `off` for `on_demand` by default.
  - Example:
    - `{"default":{"planningMode":"auto","completionGateMaxRetries":2,"completionGateAutoRepairEnabled":false},"roles":{"frontend-engineer":{"planningMode":"required"}},"tasks":{"on_demand":{"planningMode":"off","completionGateEnabled":false}}}`
  - Optional fields:
    - `completionGateAutoRepairEnabled` (boolean) enables one corrective pass on completion-gate failure before normal retry nudges.
    - `planningModelTier` (`fast` \| `default` \| `high`) — planning-phase model (Stage 3).
    - `completionGateVerifyModelTier` (`fast` \| `default` \| `high`) — JSON gate verifier model (Stage 3).
  - Validate before deploy:
    - `npm run planning:policy:validate -- --env-var AGENT_PLANNING_POLICY_JSON`
- `AGENT_RUN_LEDGER_ENABLED`
  - Enables persistent run-event telemetry in `agent_run_events` (required for dashboard planning/gate monitoring).
  - Set to truthy (`1`, `true`, `yes`, `on`) in environments where agent runtime and scheduler run.
- Planning-gate monitor thresholds:
  - `PLANNING_GATE_ALERT_WINDOW_DAYS` (default `30`)
  - `PLANNING_GATE_ALERT_MIN_PLANNED_RUNS` (default `10`)
  - `PLANNING_GATE_ALERT_PASS_RATE_MIN` (default `0.70`)
  - `PLANNING_GATE_ALERT_MAX_RETRY_THRESHOLD` (default `2`)
  - `PLANNING_GATE_ALERT_MIN_ROLE_PLANNED_RUNS` (default `5`) — minimum 7d planned runs before a role is evaluated for per-role SLO/regression flags.
  - `PLANNING_GATE_ALERT_ANOMALY_DROP_PP` (default `0.15`) — flag a role when 7d gate pass rate is at least this many percentage points below its 30d baseline (e.g. `0.15` = 15pp).
- `PLANNING_GATE_EVAL_APPLY_ENABLED` (scheduler only)
  - When **not** `false`, allows `POST /admin/metrics/planning-gate-eval-suggestions/apply` and the dashboard **Add … to eval suite** button to insert new `golden:from-gate:*` rows into `agent_eval_scenarios`. Set to `false` to block automated inserts.

## Planning Gate Ops (Canary + Prod)

Use this section for rollout and operation of planner/executor + completion-gate monitoring.

### Copy/Paste Environment Blocks

- Canary (recommended starting point):

```bash
AGENT_RUN_LEDGER_ENABLED=true
AGENT_TRACING_ENABLED=true
PLANNING_GATE_ALERT_WINDOW_DAYS=30
PLANNING_GATE_ALERT_MIN_PLANNED_RUNS=10
PLANNING_GATE_ALERT_PASS_RATE_MIN=0.70
PLANNING_GATE_ALERT_MAX_RETRY_THRESHOLD=2
PLANNING_GATE_ALERT_MIN_ROLE_PLANNED_RUNS=5
PLANNING_GATE_ALERT_ANOMALY_DROP_PP=0.15
PLANNING_GATE_EVAL_APPLY_ENABLED=true
```

- Production baseline (after canary is stable):

```bash
AGENT_RUN_LEDGER_ENABLED=true
AGENT_TRACING_ENABLED=false
PLANNING_GATE_ALERT_WINDOW_DAYS=30
PLANNING_GATE_ALERT_MIN_PLANNED_RUNS=20
PLANNING_GATE_ALERT_PASS_RATE_MIN=0.75
PLANNING_GATE_ALERT_MAX_RETRY_THRESHOLD=2
PLANNING_GATE_ALERT_MIN_ROLE_PLANNED_RUNS=5
PLANNING_GATE_ALERT_ANOMALY_DROP_PP=0.15
PLANNING_GATE_EVAL_APPLY_ENABLED=true
```

### Verification Checklist

1. Confirm ledger ingestion is active:
   - run a few planner/gate-enabled tasks (`frontend-engineer`, `vp-design`, `ui-ux-designer`).
   - verify non-zero planning/gate metrics:
     - `GET /admin/metrics/planning-gate?window=30`
2. Confirm health evaluation endpoint:
   - `GET /admin/metrics/planning-gate-health`
   - expect `status` in `green|yellow|red`.
3. Confirm Governance UI:
   - Planning & Completion Gate card shows health badge and last-evaluated timestamp.
4. Confirm Reliability UI:
   - pass/fail/retry KPIs populate.
   - 7d vs 30d trend section shows non-empty deltas.
   - **Gate SLO posture** card loads from `GET /admin/metrics/planning-gate-health` (thresholds + role anomalies).

### Golden Eval Harness (Stage 3 On-Ramp)

- Use golden suite filter (scenario names prefixed with `golden:`):
  - `POST /agent-evals/run-golden`
- Or run normal endpoint with explicit filter:
  - `POST /agent-evals/run` body: `{"goldenOnly":true}`
- Optional role-scoped run:
  - `POST /agent-evals/run-golden` body: `{"agentRoles":["platform-intel","chief-of-staff"]}`

### Scheduled Monitor

- Daily monitor job:
  - cron id: `planning-gate-monitor`
  - endpoint: `POST /planning-gate/monitor`
  - behavior on **critical** conditions only (global pass rate below `PLANNING_GATE_ALERT_PASS_RATE_MIN` with enough planned runs, or max retry above `PLANNING_GATE_ALERT_MAX_RETRY_THRESHOLD`):
    - writes `activity_log` entry (`planning_gate.alert`),
    - opens/highlights incident (`Planning gate quality regression`),
    - sends founder notification through notifier path.
  - **Per-role** 7d SLO misses and 7d-vs-30d regressions are included in `GET /admin/metrics/planning-gate-health` (`roleAnomalies`) and the Reliability **Gate SLO posture** card; they set health to **yellow** but do **not** open incidents by themselves (reduces noise while you tune thresholds).

### Red Badge Response Playbook

If Governance badge turns red:

1. Validate failing signal:
   - check `GET /admin/metrics/planning-gate-health`.
   - check Reliability role table for largest 7d regression.
2. Scope blast radius:
   - identify roles with lowest pass rate and highest retry spikes.
   - inspect recent run outputs and missing-criteria patterns.
3. Stabilize quickly:
   - lower planner strictness for affected role/task temporarily OR reduce gate retries if loops are noisy.
   - if needed, rollback to previous `AGENT_PLANNING_POLICY_JSON`.
4. Re-check after change:
   - run targeted canary tasks for affected roles.
   - confirm pass-rate trend recovery before broader rollout.

## Stage 2 — Planning gate hardening

This section matches the **maturity ladder** “Stage 2” investment: SLO-style signals, trend deltas, triage checklist, and canary-by-role policy.

### What ships in the product

| Capability | Where |
| --- | --- |
| Global SLO breach + retry spike | `POST /planning-gate/monitor` → activity log, incident, notify (unchanged). |
| Health API with per-role anomalies | `GET /admin/metrics/planning-gate-health` → `report.roleAnomalies`, `status` yellow when only role-level flags fire. |
| 7d vs 30d trends | Reliability → **Planning Gate Trend** table + **SLO signals** column. |
| SLO summary card | Reliability → **Gate SLO posture** (thresholds + anomaly list + critical alerts). |

### Policy canary by role (`AGENT_PLANNING_POLICY_JSON`)

1. Start from a small **roles** map (one or two roles) with stricter `planningMode` / gate settings; keep **default** looser for everyone else.
2. Validate JSON before setting the repo/org variable or Cloud Run env:
   - `npm run planning:policy:validate -- --file docs/examples/planning-policy-canary.json` (from repo root)
3. Example file in-repo: `docs/examples/planning-policy-canary.json` (frontend-engineer canary with `required` planning; `on_demand` tasks stay off).
4. After the cohort is green on Reliability (7d pass, no regressions), merge those **roles** entries into your main policy JSON and widen the cohort.

### Gate failure diagnostics (copy/paste checklist)

Use when pass rate drops, retries spike, or a role shows **Below SLO (7d)** / **Regression vs 30d**.

1. **Confirm signal**
   - `GET /admin/metrics/planning-gate-health` — note `status`, `report.alerts`, `report.roleAnomalies`.
   - `GET /admin/metrics/planning-gate?window=7` and `window=30` — compare `totals` and per-`roles`.
2. **Scope**
   - Reliability → Planning Gate Trend: sort mentally by worst **Delta** and **SLO signals**.
   - Governance → Stage 3 scorecard: golden eval pass + top missing criteria (if gate failures cluster on one criterion).
3. **Recent change blast radius**
   - Deploys touching `AGENT_PLANNING_POLICY_JSON`, model routing, or prompts for the affected **role**.
   - New tools or stricter acceptance criteria without updated planner output.
4. **Safe mitigations (pick one, smallest first)**
   - Raise `completionGateMaxRetries` slightly for the canary role only (policy JSON).
   - Temporarily set `planningMode` to `auto` for that role while investigating (narrower than turning gate off globally).
   - Roll back last policy JSON revision if regression aligns with deploy time.
5. **Verify recovery**
   - Run 2–3 representative tasks for the role; watch `agent_run_events` for `completion_gate_passed` vs `completion_gate_failed`.
   - Re-check `planning-gate-health` after 24–48h of volume.

## Stage 3 — Continuous quality optimization

Built-in behaviors for the maturity ladder “Stage 3” slice: golden eval as a scheduled contract, gate-miss → eval drafts (existing), auto-repair telemetry, and **phase-aware model tiers** in policy.

### Golden eval loop

| Item | Detail |
| --- | --- |
| **Cron** | `golden-eval-suite` → `POST /agent-evals/run-golden` (Wednesday 10:30 UTC). Scenarios must be named `golden:%`. |
| **Manual** | Reliability → **Run golden suite now**, or `POST /agent-evals/run-golden` with optional `agentRoles` / `agentIds`. |
| **Full sweep** | Monday job `agent-knowledge-evals` still runs `POST /agent-evals/run` (all scenarios). |

### Auto-repair (`completionGateAutoRepairEnabled`)

- One corrective user turn after a gate failure (`completion_gate_auto_repair_triggered` in `agent_run_events`).
- **Governance** Stage 3 scorecard shows auto-repair **conversion rate** vs 30d (`GET /admin/metrics/planning-gate-stage3`).
- Enable per role in `AGENT_PLANNING_POLICY_JSON` when you accept extra latency for a second execution pass.

### Phase model tiers (policy JSON)

Optional override fields (validated by `npm run planning:policy:validate`):

- `planningModelTier`: `fast` \| `default` \| `high` — used for the **planning JSON** phase model call (execution still follows normal subtask routing in `CompanyAgentRunner` / `BaseAgentRunner`).
- `completionGateVerifyModelTier`: same enum — used for the **JSON completion-gate verifier** (criteria satisfied or not).

**Built-in:** `frontend-engineer`, `vp-design`, and `ui-ux-designer` default to **high** for both tiers on non-`on_demand` tasks (strict design/engineering path).

Example: `docs/examples/planning-policy-canary.json`.

## Rollout Checklist

### 1) Staging Baseline

- Deploy with:
  - `AGENT_TRACING_ENABLED=true`
  - `TOOL_HOOKS_CONFIG` mounted from a staging secret (observe-only pre-hook).
- For GitHub Actions deployment:
  - set repository secret `TOOL_HOOKS_CONFIG_SECRET_NAME` to your secret name (for example: `tool-hooks-config-staging`).
  - set repository variable `AGENT_TRACING_ENABLED` to `true` (for canary), later `false` if needed.
  - optional manual override: use `workflow_dispatch` inputs (`agent_tracing_enabled`, `tool_hooks_config_secret_name`) for one-off deploys without changing repository settings.
- Verify no execution regressions:
  - existing runtime tests pass
  - no spike in tool timeout/verification failures

### 2) Staging Telemetry Validation

- Run:
  - `npm run trace:summary:cloudrun -- --project <project> --service glyphor-scheduler --minutes 30 --top 20`
- Confirm:
  - non-zero parsed span events
  - top tools/models look reasonable
  - no outlier p95 compared to prior baseline

### 3) Staging Hook Validation

- Confirm pre-hook calls are reaching your endpoint.
- Confirm deny behavior only applies when endpoint returns `{"allow": false}`.
- Confirm hook errors:
  - fail-open for autonomous actions
  - fail-closed for non-autonomous actions

### 4) Production Canary

- Enable tracing on one service (usually `glyphor-scheduler`) for 24-48h.
- Keep hook config in observe-only mode initially.
- Monitor:
  - tool failure rate
  - model fallback rate
  - p95 for `tool.execute` and `model.provider_attempt`

### 5) Production Enforce

- Switch pre-hook policy to enforce (return explicit denies for selected actions).
- Start with a narrow deny scope (high-risk tools only).
- Expand policy after one full day without regressions.

## Operational Commands

- Summarize spans from a local log file:
  - `npm run trace:summary -- --file <path-to-log-file> --limit 20`
- Summarize spans directly from Cloud Run:
  - `npm run trace:summary:cloudrun -- --project <project> --service glyphor-scheduler --minutes 60 --top 20`
- Summarize planning/gate events from a local log file:
  - `npm run planning:summary -- --file <path-to-log-file> --top 20`
- Summarize planning/gate events directly from Cloud Run:
  - `npm run planning:summary:cloudrun -- --project <project> --service glyphor-scheduler --minutes 60 --top 20`
- Export planning/gate summary as CSV:
  - `npm run planning:summary -- --file <path-to-log-file> --top 20 --format csv`
  - `npm run planning:summary:cloudrun -- --project <project> --service glyphor-scheduler --minutes 60 --top 20 --format csv`

## Claude-Style Web Coding Loop Usage

Use this section to standardize web build iteration behavior across design/engineering agents.
For quick daily execution, use `docs/WEB_CODING_LOOP_PLAYBOOK.md`.

### Tool Selection

- Use `invoke_web_coding_loop` when:
  - the project already exists (`project_id` known),
  - the request needs multiple quality passes (visual polish, hierarchy, CTA clarity, accessibility, performance),
  - completion should be based on measurable convergence (Lighthouse thresholds + screenshot validation).
- Use `invoke_web_iterate` when:
  - the change is narrow and one-pass (single section tweak, targeted content/component update),
  - you do not need iterative convergence checks.

### Agent Defaults

- `frontend-engineer`: default to `invoke_web_coding_loop` for refinement tasks; use `invoke_web_iterate` for one-shot edits.
- `vp-design`: default to `invoke_web_coding_loop` for quality-led improvement cycles.
- `ui-ux-designer`: default to `invoke_web_coding_loop` for iterative design polish and validation.

### Recommended Loop Inputs

- Start with:
  - `max_iterations=3`
  - `lighthouse_strategy=desktop`
  - `min_performance=75`
  - `min_accessibility=85`
  - `min_best_practices=85`
  - `min_seo=85`
- Use `include_screenshot=true` only when visual evidence must be returned in the response payload (larger output).

### Planning/Gate Observability

- Runtime events emitted:
  - `planning_phase_started`
  - `completion_gate_failed`
  - `completion_gate_passed`
- For raw Cloud Logging query (manual inspection):
  - `resource.type="cloud_run_revision" AND resource.labels.service_name="glyphor-scheduler" AND (textPayload:"planning_phase_started" OR textPayload:"completion_gate_failed" OR textPayload:"completion_gate_passed")`
- Watch for:
  - high `completion_gate_failed` volume without corresponding `completion_gate_passed`,
  - repeated retries hitting max retry budget,
  - role/run outliers with persistent missing-criteria patterns.

### Copy/Paste Prompt Templates

- Hero polish + CTA clarity:
  - `Run invoke_web_coding_loop on <project_id>. Goal: improve hero information hierarchy, above-the-fold readability, and CTA prominence without changing brand palette or voice. Keep changes production-safe and responsive.`
- Conversion-oriented pass:
  - `Run invoke_web_coding_loop on <project_id>. Goal: increase conversion intent on landing and pricing sections by clarifying value props, tightening CTA copy, and reducing visual noise. Preserve current product narrative.`
- Accessibility hardening:
  - `Run invoke_web_coding_loop on <project_id>. Goal: improve accessibility across navigation, forms, and interactive controls (labels, focus visibility, keyboard flow, contrast) while preserving layout intent.`
- Performance + UX smoothness:
  - `Run invoke_web_coding_loop on <project_id>. Goal: improve perceived performance and interaction smoothness (layout stability, animation restraint, rendering cost) with no regressions to core content and CTA flows.`

### One-Shot Iterate Template

- Small targeted tweak:
  - `Run invoke_web_iterate on <project_id> with changes: update only <section/component> to <specific change>. Do not alter other sections or global design tokens.`

### Expected Output Checklist

- Confirm `converged=true` when using `invoke_web_coding_loop` (or verify `stop_reason` is acceptable for manual review).
- Confirm `iterations` contains at least one round with:
  - valid `preview_url`,
  - Lighthouse scores (`performance`, `accessibility`, `best-practices`, `seo`),
  - `met_thresholds=true` for automated signoff.
- Confirm final links are present and usable:
  - `latest_preview_url`,
  - `latest_deploy_url` (if returned),
  - `latest_github_pr_url`.
- If visual evidence is required, rerun with `include_screenshot=true` and verify screenshot dimensions are present.
- For one-shot `invoke_web_iterate` requests, verify the returned `preview_url` and check no unintended sections changed.

## Rollback Plan

- Immediate tracing rollback:
  - set `AGENT_TRACING_ENABLED=false`
- Immediate hook rollback:
  - unset `TOOL_HOOKS_CONFIG` (or set to empty hooks)
- If policy blocks critical paths:
  - return `{"allow": true}` from pre-hook endpoint while investigating

## Notes

- Keep hook endpoints highly available and low-latency.
- Avoid side effects in pre-hooks unless strictly required.
- Treat hook responses as policy decisions; preserve audit logs on the hook service side.

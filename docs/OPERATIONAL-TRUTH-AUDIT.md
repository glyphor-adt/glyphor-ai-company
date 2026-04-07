# Glyphor Operational Truth Audit

**Date:** 2026-04-07  
**Scope:** Execution quality, run frequency, claim validation, and task value — based on actual codebase and data model  
**Not an architecture review.** This is an operational reality audit using actual schemas, write paths, and runtime stores.

---

## Section 1: Executive Summary

### How measurable is Glyphor's current agent activity?

Partially measurable. The runtime spine (`run_sessions`, `run_attempts`, `run_events`) provides sequenced event history. `agent_runs` and `tool_call_traces` provide cost, duration, and tool invocation counts. But nearly all "completion" fields are self-reported by the agent — not independently verified.

### Top-line answers

| Question | Answer |
|---|---|
| Can we tell how often agents run? | **Yes** — `agent_runs` and `run_sessions` record every dispatch |
| Can we tell what they actually did? | **Partially** — tool args and success flags in `tool_call_traces`; output is unstructured TEXT |
| Can we validate claimed outcomes against runtime evidence? | **Weakly** — no reconciliation step; `result_success` is self-reported |
| Can we judge whether agents are doing the right work? | **No** — prioritization is a 4-level enum, no value scoring |

### Top 5 Operational Blind Spots

1. **No proof-of-completion** — task marked `submitted` without verifying output exists
2. **No external side-effect verification** — emails, files, API calls all self-reported
3. **No task-value scoring** — can't distinguish high-impact work from busywork by data
4. **Fire-and-forget telemetry writes** — failures logged to console, never block or alert
5. **No per-agent effectiveness trend** — quality scores exist but not tracked over time

---

## Section 2: Run Frequency Model

### Tables That Record Agent Runs

| Table | Schema Location | What It Records | Who Writes It |
|---|---|---|---|
| `agent_runs` | `combined_migration.sql:1140` | Per-run metadata: status, duration, cost, tokens, tool_calls | `taskOutcomeHarvester.ts` (implicit) |
| `run_sessions` | `db/migrations/20260406223500_runtime_spine_sessions_attempts_events.sql` | Session lifecycle, primary agent role, status | `runtimeEventStore.ts:ensureRuntimeSession()` |
| `run_attempts` | Same migration | Attempt within session: triggered_by, request_payload, status | `runtimeEventStore.ts` |
| `run_events` | Same migration | Ordered events: run_created, turn_started, tool_called, tool_completed, run_completed, heartbeat | Worker `index.ts:appendRuntimeEventForRun()` + scheduler |
| `task_run_outcomes` | `db/migrations/20260307120000_task_run_outcomes.sql` | Final status, turns, tool failures, quality score 1–5 | `taskOutcomeHarvester.ts:harvestTaskOutcome()` |
| `tool_call_traces` | `db/migrations/20260319001100_tool_call_traces.sql` | Per-tool: args, result_success, result_data, files_written, cost | `toolExecutor.ts:persistToolCallTrace()` |
| `activity_log` | `db/migrations/20260222030000_create_tables.sql:74` | Narrative: agent_role, action, summary, tier | Multiple — fire-and-forget |
| `agent_run_status` | `db/migrations/20260313220000_agent_run_status.sql` | Status narrative with flag tier | Status writers |
| `handoff_traces` | `db/migrations/20260319002000_handoff_traces.sql` | Agent-to-agent handoffs with quality scores | Handoff evaluator |
| `agent_schedules` | Scheduler tables | Cron expressions per agent | Dashboard/admin |

### Execution Trigger Types

**Scheduled work** — `DynamicScheduler` (`packages/scheduler/src/dynamicScheduler.ts`):
- Polls `agent_schedules` every 60 seconds
- Evaluates standard 5-field cron expressions in UTC
- Dispatches via `executor(agentRole, task, payload)` — FIFO, no priority scoring

**Event-triggered work** — `EventRouter` (`packages/scheduler/src/eventRouter.ts`):
- Sources: `scheduler`, `webhook`, `agent`, `manual`, `event`
- Authority check → GREEN (immediate) / YELLOW (approval queue) / RED (both founders)
- Routes to worker via `executeWorkerAgentRun()` in `workerQueue.ts`

**Heartbeat/data-sync work** — `DataSyncScheduler` (`packages/scheduler/src/dataSyncScheduler.ts`):
- 60-second interval, fires OIDC-authenticated HTTP self-calls
- Handles: Stripe, Mercury, GCP billing data syncs

**Agent-to-agent delegation** — via `work_assignments` table:
- `assigned_to TEXT` links to downstream agent
- Tracked via `handoff_traces` (upstream_run_id → downstream_run_id)

**Deep-dive work** — `executeWorkerDeepDiveExecution()` in `workerQueue.ts`:
- Separate queue: `agent-runs-priority`
- Emits canonical runtime events to `run_events`

### Best Source by Use Case

| Goal | Best Source | Reason |
|---|---|---|
| Count actual runs | `agent_runs` | One row per run, has status + timestamps |
| Count meaningful completed work | `task_run_outcomes WHERE final_status='submitted'` | Has quality score + downstream validation |
| Reconstruct what happened | `run_events` ordered by `stream_seq` | Canonical ordered event log |
| Verify tool execution | `tool_call_traces` | Args + success + error per tool call |
| **Avoid as primary source** | `activity_log` | Unstructured narrative, no schema, fire-and-forget |

---

## Section 3: What Agents Are Actually Doing

### Key Schemas

**`agent_runs`:**
```sql
CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  task TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INT,
  cost DECIMAL(10,4),
  input_tokens INT,
  output_tokens INT,
  tool_calls INT DEFAULT 0,
  turns INT DEFAULT 0,
  error TEXT,
  routing_rule TEXT,
  routing_model TEXT,
  CONSTRAINT status_check CHECK (status IN ('running','completed','failed','aborted','skipped_precheck'))
);
```

**`run_events` (canonical runtime spine):**
```sql
CREATE TABLE IF NOT EXISTS run_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES run_sessions(id),
  attempt_id UUID NOT NULL REFERENCES run_attempts(id),
  run_id TEXT NOT NULL,
  event_seq BIGINT GENERATED ALWAYS AS IDENTITY,
  stream_seq BIGINT NOT NULL,
  event_type TEXT NOT NULL,  -- run_created|run_started|turn_started|status|tool_called|
                              --   tool_completed|approval_requested|result|run_failed|run_completed|heartbeat
  event_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_role TEXT,
  tool_name TEXT,
  parent_event_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (attempt_id, stream_seq),
  UNIQUE (event_id)
);
```

### Agent Role → Trigger → Task Matrix

| Agent | Primary Trigger | Typical Tasks | External Systems | Output |
|---|---|---|---|---|
| `chief-of-staff` (Sarah) | Cron + directive events | generate_briefing, check_escalations, orchestrate, process_directive | None directly — delegates | Briefings, work_assignments |
| `cfo` | Daily cron | daily_cost_check, weekly_financial_summary | Stripe, Mercury (via DataSync) | Financial reports |
| `cto` | Cron + on_demand | platform_health_check, dependency_review | GCP billing data | Health reports |
| `cmo` | Cron + content cycle | weekly_content_planning, generate_content, seo_analysis | None confirmed | Content plans |
| `ops` (Atlas Vega) | Event-driven | event_response, health_check, morning_status, contradiction_detection | All internal tables | Fleet health reports |
| `platform-intel` | Cron + approval | daily_analysis, watch_tool_gaps, memory_consolidation, apply_fix_proposal | Tool grants, memory | Tool fix proposals |
| `clo` | Cron | regulatory_scan, agent365_mail_triage | Microsoft Graph (Teams) | Compliance reports |
| Sub-team specialists (40+) | Assignment-driven | Varies by role | Varies | Assignment outputs |

**Worker dispatches 42 agent roles** via `packages/worker/src/index.ts:executeAgentByRole()`.

---

## Section 4: Claim vs Evidence Validation

### Evidence Strength by Claim Type

| Agent Claim | Evidence Source | Proof Strength | Gap |
|---|---|---|---|
| "I called tool X with args Y" | `tool_call_traces.args JSONB` | **Strong** — args recorded verbatim | None for invocation itself |
| "Tool X succeeded" | `tool_call_traces.result_success BOOLEAN` | **Weak** — self-reported boolean | No external callback confirms success |
| "I sent an email" | `tool_call_traces WHERE tool_name='send_email'` | **Weak** | No link to email delivery log |
| "I wrote a file" | `tool_call_traces.files_written INTEGER` | **Very weak** — integer count only | No file ID, no checksum, no GCS path |
| "I completed the assignment" | `task_run_outcomes.final_status='submitted'` | **Weak** | No link to actual output content |
| "The assignment output is X" | `work_assignments.agent_output TEXT` | **Weak** — narrative text | No structured schema, no validation |
| "I ran N turns" | `agent_runs.turns`, `run_events.stream_seq` | **Strong** — enforced by sequence counter | — |
| "The run cost $X" | `agent_runs.cost`, `task_run_outcomes.cost_usd` | **Strong** — derived from token counts | Approximation only |
| "Run completed at time T" | `run_events event_type='run_completed'` | **Strong** — event_seq enforced | Payload unstructured |
| "Approval was required" | `run_attempts.status='queued_for_approval'` | **Strong** | — |

### Summary

**Strongest verifiable actions:** Tool invocation sequence, approval flows, retry chains, cost accounting, event ordering.

**Weakest / most at risk:** File writes, email sends, any action touching an external system — entirely self-reported. An agent can record `result_success=true` on a failed API call if the tool catches the error and returns a success signal.

**Write path for tool traces** (`packages/agent-runtime/src/toolExecutor.ts:persistToolCallTrace()`):
```typescript
try {
  await systemQuery(`INSERT INTO tool_call_traces ...`, [...]);
} catch (err) {
  console.error('[persistToolCallTrace] INSERT failed', { ... });
  // ⚠️ FIRE-AND-FORGET: does NOT re-throw or block agent execution
}
```
A burst of DB failures produces silent data loss with no alerting.

---

## Section 5: Are Agents Doing the Right Things?

### Task Creation and Priority

Directives (`founder_directives`) are created by founders or by Chief of Staff. Priority is a **4-level enum** — no numeric scoring, no revenue impact field, no strategic alignment dimension.

```sql
priority TEXT NOT NULL DEFAULT 'high'
  CHECK (priority IN ('critical', 'high', 'medium', 'low'))
```

Work assignments inherit this priority categorically. There is no "don't run if there's nothing meaningful" gate in `DynamicScheduler`.

### Quality Scoring (What Exists)

`taskOutcomeHarvester.ts:computePerRunQualityScore()` produces a 1.0–5.0 score:

| Signal | Effect |
|---|---|
| `final_status = 'submitted'` | +0.5 |
| No tool failures | +0.2 |
| Submitted in ≤5 turns | +0.2 |
| `final_status = 'aborted'` or `'failed'` | −1.0 |
| `final_status = 'flagged_blocker'` | −0.5 |
| >3 tool failures | −0.3 |
| Partial save | −0.2 |
| >15 turns | −0.2 |
| Cost >$0.50 | −0.1 |

**This measures execution efficiency, not outcome value.** A run that submits garbage output quickly scores higher than one that struggles to produce something correct.

### Activity vs Value Assessment

| Agent | Likely Activity Type | Value Signal Available | Concern |
|---|---|---|---|
| `chief-of-staff` | High — orchestrates all directive work | Directive completion rate | May generate assignments that don't ship |
| `ops` (Atlas Vega) | Medium — reactive event handler | Fleet health state | Risk of excessive event_response churn |
| `cfo` | Medium — scheduled reports | Cost trend accuracy | Reports may go unread |
| `platform-intel` | Medium-High — tool gap detection | Fix proposal acceptance rate | Proposals may pile up unapplied |
| Sub-team specialists (40+) | Unknown — assignment-driven | Assignment completion rate | Weakest signal |

**Current answer:** Glyphor is optimizing for **activity**, not meaningful work. Cron fires → agent runs → writes status text. No mechanism distinguishes high-value execution from churn.

---

## Section 6: Best Operational Source of Truth

### Recommended Query Stack for an Ops Dashboard

**Run counting:**
```sql
SELECT agent_id, status, COUNT(*), AVG(duration_ms), SUM(cost)
FROM agent_runs
WHERE started_at > NOW() - INTERVAL '7 days'
GROUP BY agent_id, status
ORDER BY COUNT(*) DESC;
```

**Event reconstruction:**
```sql
SELECT rs.primary_agent_role, ra.triggered_by, re.event_type,
       re.tool_name, re.event_ts, re.payload
FROM run_sessions rs
JOIN run_attempts ra ON ra.session_id = rs.id
JOIN run_events re ON re.attempt_id = ra.id
WHERE rs.started_at > NOW() - INTERVAL '24 hours'
ORDER BY rs.started_at DESC, re.stream_seq ASC;
```

**Tool evidence:**
```sql
SELECT agent_role, tool_name, result_success, COUNT(*), AVG(estimated_cost_usd)
FROM tool_call_traces
WHERE called_at > NOW() - INTERVAL '7 days'
GROUP BY agent_role, tool_name, result_success
ORDER BY COUNT(*) DESC;
```

**Output validation (best available):**
```sql
SELECT tro.agent_role, tro.final_status, tro.per_run_quality_score,
       wa.task_description, wa.agent_output, wa.evaluation
FROM task_run_outcomes tro
JOIN work_assignments wa ON wa.id = tro.assignment_id
WHERE tro.created_at > NOW() - INTERVAL '7 days'
ORDER BY tro.per_run_quality_score ASC;
```

**Directive completion + quality:**
```sql
SELECT fd.title, fd.priority, fd.category,
       COUNT(wa.id) AS assignments,
       SUM(CASE WHEN wa.status='completed' THEN 1 ELSE 0 END) AS completed,
       AVG(tro.per_run_quality_score) AS avg_quality
FROM founder_directives fd
JOIN work_assignments wa ON wa.directive_id = fd.id
LEFT JOIN task_run_outcomes tro ON tro.assignment_id = wa.id
WHERE fd.status = 'active'
GROUP BY fd.id
ORDER BY fd.priority, avg_quality ASC;
```

---

## Section 7: Instrumentation Gaps

These are real gaps, not aspirational:

### Gap 1: No Proof-of-Completion Field
`work_assignments.agent_output` is unstructured TEXT. No file ID, no GCS path, no checksum. `task_run_outcomes.final_status='submitted'` does not verify the output is correct or exists.

**What's needed:**
```sql
ALTER TABLE task_run_outcomes ADD COLUMN IF NOT EXISTS proof_of_work JSONB;
-- { "type": "assignment_output", "assignment_id": "...", "output_length": 1234,
--   "tool_calls_with_results": 5, "external_refs": [...] }
```

### Gap 2: No Automated Claim vs Evidence Reconciliation
No process cross-checks agent claims against actual side effects. Task marked "submitted" without verifying submission payload is valid.

### Gap 3: No External Side-Effect Verification
`tool_call_traces.result_success` is self-reported. Emails, files, Slack messages, GitHub commits — none verified against external audit logs. Fire-and-forget pattern in `toolExecutor.ts:persistToolCallTrace()` silently swallows DB failures.

### Gap 4: No Per-Agent Effectiveness Trend
`task_run_outcomes` has `per_run_quality_score` but no weekly trend table. Can't tell if an agent is improving, degrading, or plateauing.

### Gap 5: No Task-Value / Business Impact Score
`founder_directives.priority` is categorical. No revenue impact field, no time-savings estimate, no strategic alignment score. Can't rank tasks by ROI.

### Gap 6: No "Work Value Gate"
Agents run on schedule regardless of whether there's meaningful work. `DynamicScheduler` has no mechanism to skip a run if nothing is queued.

### Gap 7: `activity_log` Has No Schema
All columns are narrative TEXT/JSONB. No structured format, no validation, no automated analysis possible.

### Gap 8: `handoff_traces` Quality Scores Have No Methodology
`upstream_output_quality NUMERIC` and `downstream_input_usability NUMERIC` are recorded with no rubric or supporting detail.

### Gap 9: Fire-and-Forget Telemetry
All critical writes in `persistToolCallTrace()`, `harvestTaskOutcome()`, `activity_log` catch errors to console and continue. A DB failure burst produces silent data loss with no alerting.

---

## Section 8: Recommended Next Build

**Build: A Proof-of-Work Ledger + Agent Operations Dashboard**

Zero new infrastructure required. Uses existing tables. Fills the most critical gap.

### Step 1 — Proof-of-work field on `task_run_outcomes`

Add to `taskOutcomeHarvester.ts:harvestTaskOutcome()`:
```sql
ALTER TABLE task_run_outcomes ADD COLUMN IF NOT EXISTS proof_of_work JSONB;
```
Snapshot at harvest time: `work_assignments.agent_output` length, `tool_call_traces` count, any external IDs returned by tools.

### Step 2 — Claim vs Evidence Reconciler View

```sql
CREATE OR REPLACE VIEW agent_claim_evidence AS
SELECT
  tro.id,
  tro.agent_role,
  tro.final_status,
  tro.per_run_quality_score,
  wa.agent_output IS NOT NULL AND LENGTH(wa.agent_output) > 50 AS has_output,
  tct.tool_calls_total,
  tct.tool_calls_succeeded,
  tct.tool_calls_failed,
  CASE
    WHEN tro.final_status = 'submitted'
      AND (wa.agent_output IS NULL OR LENGTH(wa.agent_output) < 10)
      THEN 'CLAIM_WITHOUT_EVIDENCE'
    WHEN tct.tool_calls_failed > tct.tool_calls_succeeded
      THEN 'MAJORITY_TOOLS_FAILED'
    ELSE 'CONSISTENT'
  END AS claim_evidence_status
FROM task_run_outcomes tro
LEFT JOIN work_assignments wa ON wa.id = tro.assignment_id
LEFT JOIN (
  SELECT run_id,
    COUNT(*) FILTER (WHERE result_success = true)  AS tool_calls_succeeded,
    COUNT(*) FILTER (WHERE result_success = false) AS tool_calls_failed,
    COUNT(*)                                        AS tool_calls_total
  FROM tool_call_traces
  GROUP BY run_id
) tct ON tct.run_id = tro.run_id;
```

### Step 3 — Admin API Endpoint

New route at `/admin/metrics/agent-ops` (in `metricsAdminApi.ts`) returning:
- Runs per agent last 7/30 days (from `agent_runs`)
- Quality score distribution (from `task_run_outcomes`)
- Tool failure rate per agent (from `tool_call_traces`)
- `CLAIM_WITHOUT_EVIDENCE` count (from the view above)
- Top directives by completion rate (from `founder_directives` + `work_assignments`)

**Estimated effort:** 2–3 days. All existing tables. No new infrastructure.

---

## Section 9: File and Table Evidence

| Theme | File / Table | What It Proves |
|---|---|---|
| Run counting | `agent_runs` (`combined_migration.sql:1140`) | Per-run lifecycle, cost, tokens — one row per execution |
| Canonical event log | `run_events` (`20260406223500_runtime_spine.sql`) | Ordered event sequence; `stream_seq UNIQUE` enforces no duplicates |
| Session envelope | `run_sessions`, `run_attempts` (same migration) | Session lifecycle + retry chain |
| Event writing | `packages/scheduler/src/runtimeEventStore.ts` | `ensureRuntimeSession()`, `appendRuntimeEvent()` — canonical write path |
| Worker event writing | `packages/worker/src/index.ts:appendRuntimeEventForRun()` | Execution-plane canonical events |
| Tool traces | `tool_call_traces` (`20260319001100_tool_call_traces.sql`) | Best evidence for tool invocation — args + success + cost |
| Tool trace writer | `packages/agent-runtime/src/toolExecutor.ts:persistToolCallTrace()` | Fire-and-forget — silent failure on DB error |
| Quality scoring | `packages/agent-runtime/src/taskOutcomeHarvester.ts:computePerRunQualityScore()` | Execution efficiency score 1–5; NOT outcome correctness |
| Outcome table | `task_run_outcomes` (`20260307120000_task_run_outcomes.sql`) | Final status, quality score, downstream flags |
| Directive priority | `founder_directives`, `work_assignments` (`20260223200000_founder_orchestration.sql`) | Categorical priority only — no numeric value score |
| Scheduler dispatch | `packages/scheduler/src/dynamicScheduler.ts` | 60s polling, cron evaluation, direct executor dispatch |
| Worker dispatch | `packages/scheduler/src/workerQueue.ts:executeWorkerAgentRun()` | OIDC-authenticated HTTP to Cloud Run worker |
| Event routing | `packages/scheduler/src/eventRouter.ts` | Authority gate: GREEN/YELLOW/RED dispatch model |
| Source of truth map | `packages/scheduler/src/runtimeSourceOfTruth.ts` | Canonical mapping of which table owns which truth |
| Activity log | `activity_log` (`20260222030000_create_tables.sql:74`) | Narrative only — no structured schema |
| Handoff quality | `handoff_traces` (`20260319002000_handoff_traces.sql`) | Quality scores recorded, no methodology |

---

## Section 10: Final Judgment

| Question | Answer |
|---|---|
| Enough instrumentation to know what agents are doing? | **Mostly yes for activity, no for quality** — can see runs, timing, cost, tool calls; cannot see output correctness |
| Enough proof to know whether they actually did it? | **No** — execution facts yes; claimed outcomes (email sent, file created, assignment correct) no |
| Enough signals to know whether they are doing the right work? | **No** — quality score measures efficiency not value; no ROI signal; no "skip if nothing to do" gate |

### Single most important thing to build next

> **The `agent_claim_evidence` view + a `/admin/metrics/agent-ops` dashboard endpoint.**

This requires zero schema changes and zero new infrastructure. It joins `task_run_outcomes` + `work_assignments` + `tool_call_traces` into a single view that surfaces `CLAIM_WITHOUT_EVIDENCE` runs — where an agent reported `submitted` but no meaningful output or tool evidence exists.

This is the missing layer between "agents are running" and "agents are actually doing something." Everything else (value scoring, external verification, effectiveness trends) builds on this foundation.

---

*Generated 2026-04-07. Based on codebase scan of `glyphor-ai-company`. Source files: `combined_migration.sql`, `db/migrations/`, `packages/scheduler/src/`, `packages/worker/src/`, `packages/agent-runtime/src/`.*

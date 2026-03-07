# Glyphor Learning Governor — Implementation Plan

## 22 Sequential GitHub Issues for Copilot Execution

**Target:** Transform Glyphor's agent system from self-describing corrections to governed, measured self-modification.

**Six tracks, dependency-ordered.** Issues within a track are sequential. Tracks 1–2 can run in parallel. Tracks 3–4 can run in parallel after Track 1 completes. Tracks 5–6 can run in parallel after Track 4 completes.

```
Track 1 (Issues 1–4)  ──┐
                         ├──► Track 3 (Issues 8–11)  ──┐
Track 2 (Issues 5–7)  ──┘    Track 4 (Issues 12–16) ──┼──► Track 5 (Issues 17–19)
                                                        └──► Track 6 (Issues 20–22)
```

---

## Track 1 — Task-Tier Outcome Harvesting

**Problem:** 31 task-tier agents do the majority of productive work but run with thinking disabled, reflection skipped, and a self-assessment that awards a baseline 4.0 just for completing. The system is most intelligent at the layer that delegates and least intelligent at the layer that executes.

**Goal:** Capture lightweight structured outcome signals from every task-tier run without adding per-run LLM cost, then batch-evaluate nightly to feed world models and trust scores.

---

### Issue 1: Create `task_run_outcomes` table

**Labels:** `copilot`, `database`, `track-1`

**Description:**

Create a new migration file `db/migrations/093_task_run_outcomes.sql` that adds the `task_run_outcomes` table. This table captures lightweight, deterministic outcome signals from every task-tier run — no LLM call required.

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS task_run_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id),
  agent_role TEXT NOT NULL,
  directive_id UUID REFERENCES founder_directives(id),
  assignment_id UUID REFERENCES work_assignments(id),

  -- Deterministic signals (captured immediately after run)
  final_status TEXT NOT NULL,  -- 'submitted' | 'flagged_blocker' | 'partial_progress' | 'aborted' | 'failed'
  turn_count INTEGER NOT NULL,
  tool_call_count INTEGER NOT NULL,
  tool_failure_count INTEGER NOT NULL DEFAULT 0,
  had_partial_save BOOLEAN NOT NULL DEFAULT false,
  elapsed_ms INTEGER NOT NULL,
  cost_usd NUMERIC(8,4) NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,

  -- Downstream signals (populated asynchronously by batch evaluator)
  was_revised BOOLEAN,             -- assignment got needs_revision after submission
  revision_count INTEGER DEFAULT 0,
  was_accepted BOOLEAN,            -- assignment reached 'completed' status
  downstream_agent_succeeded BOOLEAN,  -- dependent assignment completed
  time_to_acceptance_ms BIGINT,    -- time from submission to completed

  -- Batch evaluation fields (populated by nightly evaluator)
  batch_quality_score NUMERIC(3,1),  -- 1.0–5.0, null until evaluated
  batch_evaluated_at TIMESTAMPTZ,
  evaluation_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_run_outcomes_agent ON task_run_outcomes(agent_role);
CREATE INDEX idx_task_run_outcomes_assignment ON task_run_outcomes(assignment_id);
CREATE INDEX idx_task_run_outcomes_unevaluated ON task_run_outcomes(batch_evaluated_at) WHERE batch_evaluated_at IS NULL;
CREATE INDEX idx_task_run_outcomes_created ON task_run_outcomes(created_at);
```

Add `task_run_outcomes` to the `dashboardApi.ts` whitelist array.

**Acceptance criteria:**
- [ ] Migration runs cleanly against the existing 92-migration schema
- [ ] Table is accessible via the dashboard API
- [ ] Indexes exist for agent_role, assignment_id, unevaluated rows, and created_at

---

### Issue 2: Build `taskOutcomeHarvester.ts` — post-run signal capture

**Labels:** `copilot`, `agent-runtime`, `track-1`

**Description:**

Create `packages/agent-runtime/src/taskOutcomeHarvester.ts`. This module captures deterministic outcome signals immediately after every task-tier run completes — zero LLM calls, just DB reads and writes.

**Integration point:** Call from `taskRunner.ts` in the post-run phase (after step 10, event emission), alongside the existing world model self-assessment. Also wire into `orchestratorRunner.ts` at the point where assignment submissions are processed.

**Implementation:**

```typescript
// packages/agent-runtime/src/taskOutcomeHarvester.ts

export interface TaskRunOutcome {
  run_id: string;
  agent_role: string;
  directive_id?: string;
  assignment_id?: string;
  final_status: 'submitted' | 'flagged_blocker' | 'partial_progress' | 'aborted' | 'failed';
  turn_count: number;
  tool_call_count: number;
  tool_failure_count: number;
  had_partial_save: boolean;
  elapsed_ms: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

export async function harvestTaskOutcome(
  db: Pool,
  result: AgentExecutionResult,
  runMeta: { runId: string; agentRole: string; assignmentId?: string; directiveId?: string }
): Promise<void>
```

**Logic:**
1. Extract `final_status` from the combination of `result.status` and whether `savePartialProgress` was called (check `result.actions` for `submit_assignment_output` vs `flag_assignment_blocker` tool calls).
2. Count tool calls and failures from `result.actions[]` (ActionReceipt array).
3. Parse `elapsed_ms`, `cost`, `input_tokens`, `output_tokens` from the `agent_runs` row (already written by `trackedAgentExecutor`).
4. INSERT into `task_run_outcomes`.
5. Fire-and-forget — do not block the run completion.

**Wire into `taskRunner.ts`:**
- After the existing post-run event emission (step 10), call `harvestTaskOutcome()`.
- Pass the `AgentExecutionResult` and run metadata.
- Wrap in try/catch — never let harvesting failures affect the run.

**Wire into `orchestratorRunner.ts` (for downstream signals):**
- When Sarah processes a `submit_assignment_output` tool call and evaluates the result (accept vs revise), update the corresponding `task_run_outcomes` row:
  - If revised: `UPDATE task_run_outcomes SET was_revised = true, revision_count = revision_count + 1 WHERE assignment_id = $1 ORDER BY created_at DESC LIMIT 1`
  - If accepted: `UPDATE task_run_outcomes SET was_accepted = true, time_to_acceptance_ms = ... WHERE assignment_id = $1 AND was_accepted IS NULL`

**Acceptance criteria:**
- [ ] Every task-tier run produces a `task_run_outcomes` row
- [ ] Zero LLM calls in the harvesting path
- [ ] Downstream signals (was_revised, was_accepted) are updated asynchronously when Sarah evaluates
- [ ] Harvesting failures are caught and logged, never blocking the run

---

### Issue 3: Build `batchOutcomeEvaluator.ts` — nightly batch evaluation

**Labels:** `copilot`, `scheduler`, `track-1`

**Description:**

Create `packages/scheduler/src/batchOutcomeEvaluator.ts`. This module runs as a scheduled job (twice daily: 2 AM and 2 PM UTC) that evaluates unevaluated task outcomes in batch and assigns quality scores.

**Add a new cron job to `cronManager.ts`:**

```typescript
{
  id: 'batch-outcome-eval',
  cron: '0 2,14 * * *',  // twice daily
  endpoint: '/batch-eval/run',
  description: 'Batch evaluate task-tier outcomes'
}
```

**Add endpoint to `server.ts`:**
- `POST /batch-eval/run` → calls `BatchOutcomeEvaluator.run()`

**Evaluation logic (no LLM — purely algorithmic):**

```typescript
export async function evaluateBatch(db: Pool): Promise<{ evaluated: number; updated: number }> {
  // 1. Fetch unevaluated outcomes WHERE batch_evaluated_at IS NULL
  //    AND created_at < NOW() - INTERVAL '2 hours' (allow downstream signals to populate)
  //    LIMIT 200

  // 2. For each outcome, compute batch_quality_score (1.0–5.0):
  //
  //    Base score: 3.0
  //
  //    Positive signals:
  //      +1.0  was_accepted = true AND revision_count = 0 (first-time accept)
  //      +0.5  was_accepted = true AND revision_count > 0 (accepted after revision)
  //      +0.3  downstream_agent_succeeded = true
  //      +0.2  tool_failure_count = 0
  //      +0.2  turn_count <= 5 AND was_accepted = true (efficient + good)
  //
  //    Negative signals:
  //      -1.0  final_status = 'aborted' OR final_status = 'failed'
  //      -0.5  final_status = 'flagged_blocker'
  //      -0.5  was_revised = true AND was_accepted IS NULL (revised but not yet accepted)
  //      -0.3  tool_failure_count > 3
  //      -0.2  had_partial_save = true
  //      -0.2  turn_count > 15 (approaching limit, likely struggling)
  //      -0.1  cost_usd > per_run_budget * 0.8 (approaching budget cap)
  //
  //    Clamp to [1.0, 5.0]

  // 3. Batch UPDATE task_run_outcomes SET batch_quality_score, batch_evaluated_at = NOW()

  // 4. Return counts for logging
}
```

**Redis lock:** Use `batch-outcome-eval-lock` (30 min TTL) to prevent overlapping runs, same pattern as `episodicReplay.ts`.

**Acceptance criteria:**
- [ ] Cron job fires twice daily
- [ ] Only evaluates outcomes older than 2 hours (downstream signal window)
- [ ] Scores are deterministic — no LLM calls
- [ ] Redis lock prevents concurrent runs
- [ ] Processes up to 200 outcomes per batch

---

### Issue 4: Feed batch outcomes into world model + trust scorer

**Labels:** `copilot`, `agent-runtime`, `track-1`

**Description:**

Extend `worldModelUpdater.ts` and `trustScorer.ts` to consume batch-evaluated task outcomes, replacing the shallow self-assessment (baseline 4.0 ± 0.5) as the primary quality signal for task-tier agents.

**Changes to `packages/company-memory/src/worldModelUpdater.ts`:**

Add a new method `updateFromBatchOutcomes(agentRole: string, db: Pool)` that:

1. Queries `task_run_outcomes` for the agent where `batch_evaluated_at IS NOT NULL` and `created_at > NOW() - INTERVAL '30 days'`.
2. Computes aggregate metrics:
   - `avg_batch_quality_score` — weighted recent (7d scores weighted 2x vs 8–30d)
   - `first_time_accept_rate` — % of submissions accepted without revision
   - `revision_rate` — % of submissions that were revised
   - `blocker_rate` — % of runs that flagged blockers
   - `abort_rate` — % of runs that aborted
   - `avg_efficiency` — mean(turn_count) for accepted submissions
3. Updates `agent_world_model.task_type_scores` with these aggregates (merge, don't overwrite).
4. Updates `agent_world_model.strengths` / `weaknesses` / `failure_patterns` based on patterns:
   - If `first_time_accept_rate > 0.8` → add to strengths
   - If `revision_rate > 0.4` → add to weaknesses
   - If `abort_rate > 0.2` → add to failure_patterns

**Call this method from `batchOutcomeEvaluator.ts`:** After evaluating a batch, group outcomes by `agent_role` and call `updateFromBatchOutcomes()` for each agent that had outcomes evaluated.

**Changes to `packages/agent-runtime/src/trustScorer.ts`:**

Add a new signal source:

```typescript
// Add to the signal sources table:
// | `task_outcome_quality` | 1.0 | ± |

// In applySignal() or equivalent:
// When batch outcomes are evaluated, compute a trust delta:
//   avg_batch_quality_score >= 4.0 → positive signal (magnitude = (score - 3.0) / 5.0)
//   avg_batch_quality_score <= 2.0 → negative signal (magnitude = (3.0 - score) / 5.0)
//   Between 2.0–4.0 → no signal (neutral zone)
```

**Reduce self-assessment weight:** In `companyAgentRunner.ts`, the post-run world model self-assessment (step 11) currently uses a baseline 4.0 with ±0.5 for turn count. Change the weight of this self-score in `worldModelUpdater.updateFromGrade()` — apply a 0.3 multiplier to self-assessment grades for task-tier runs (vs 1.0 for orchestrator runs where reflection still occurs). Add a comment explaining that batch outcomes are now the primary quality signal for task-tier agents.

**Acceptance criteria:**
- [ ] World models for task-tier agents reflect batch outcome data (not just self-assessment)
- [ ] Trust scores respond to aggregate task quality
- [ ] Self-assessment weight is reduced for task-tier runs
- [ ] World model dashboard (WorldModel.tsx) shows the new aggregate metrics

---

## Track 2 — Orchestration Plan Verification

**Problem:** Sarah is the single point of decomposition for every directive. If she decomposes badly, downstream agents execute against a bad plan. The ~40% timeout rate that motivated the 4-check pre-dispatch validation suggests decomposition quality is a real issue.

**Goal:** Add a pre-flight verification step that reviews Sarah's decomposition plan before assignments are dispatched, catching bad plans early.

---

### Issue 5: Build `planVerifier.ts` — pre-flight decomposition review

**Labels:** `copilot`, `scheduler`, `track-2`

**Description:**

Create `packages/scheduler/src/planVerifier.ts`. This module reviews a set of proposed work assignments before they are dispatched, using a cross-model verification call (same pattern as `verifierRunner.ts`).

**Interface:**

```typescript
export interface PlanVerificationRequest {
  directive: {
    id: string;
    title: string;
    description: string;
    priority: string;
    target_agents?: string[];
  };
  proposed_assignments: Array<{
    assigned_to: string;
    task_description: string;
    expected_output: string;
    depends_on?: string[];
    sequence_order: number;
  }>;
}

export interface PlanVerificationResult {
  verdict: 'APPROVE' | 'WARN' | 'REVISE';
  overall_score: number;  // 0–1
  checks: {
    atomicity: { passed: boolean; issues: string[] };
    tool_coverage: { passed: boolean; issues: string[] };
    dependency_validity: { passed: boolean; issues: string[] };
    context_sufficiency: { passed: boolean; issues: string[] };
    workload_balance: { passed: boolean; issues: string[] };
  };
  suggestions: string[];
}
```

**Implementation:**

1. **Deterministic pre-checks (no LLM):**
   - `dependency_validity`: Run `verifyDependencyGraph()` from `formalVerifier.ts` on the assignment dependency graph. Check for cycles, missing dependencies, and self-references.
   - `tool_coverage`: For each assignment, query `agent_tool_grants` to verify the assigned agent has tools matching keywords in the task description. Flag assignments where the agent likely lacks needed tools. Use a simple keyword→tool mapping: "email" → `send_email`, "github"/"code" → `get_file_contents`/`create_or_update_file`, "research" → `web_search`, etc.
   - `workload_balance`: Check if any agent has > 3 assignments in this directive (overloaded) or if assignments could be better distributed.

2. **LLM verification pass (using verifier model, not the primary model):**
   - Use the cross-model pattern from `verifierRunner.ts`: if Sarah used Gemini, verify with Claude; if Sarah used Claude, verify with Gemini.
   - Send the directive + proposed assignments to the verifier with a structured prompt asking it to evaluate `atomicity` (is each assignment a single, clear task?) and `context_sufficiency` (does each assignment contain enough context for a task-tier agent with a ~150-line prompt?).
   - Parse the structured response.

3. **Compose verdict:**
   - All checks pass → `APPROVE`
   - Any check has issues but none are blocking → `WARN` (proceed but log)
   - `dependency_validity` fails OR `atomicity` score < 0.5 → `REVISE` (return plan to Sarah with feedback)

**Cost control:** Only run the LLM verification pass for directives with priority `critical` or `high`, or when the directive has > 5 assignments. For `medium`/`low` with ≤ 5 assignments, run only the deterministic checks.

**Acceptance criteria:**
- [ ] Deterministic checks (dependency, tool coverage, workload) run with zero LLM cost
- [ ] LLM verification only fires for high-priority or complex directives
- [ ] Returns structured `PlanVerificationResult` with actionable suggestions
- [ ] Uses cross-model verification pattern (different provider than Sarah's primary)

---

### Issue 6: Wire plan verification into the orchestration loop

**Labels:** `copilot`, `agents`, `track-2`

**Description:**

Integrate `planVerifier.ts` into Sarah's orchestration flow in `packages/agents/src/chief-of-staff/run.ts` and `systemPrompt.ts`.

**Changes to `chief-of-staff/run.ts` (or the orchestration flow):**

After Sarah creates work assignments (via `create_work_assignments` tool call) but before they are dispatched via the heartbeat/work loop:

1. Intercept the assignment creation. Collect the full set of assignments for the directive.
2. Call `PlanVerifier.verify(planRequest)`.
3. Based on verdict:
   - `APPROVE` → proceed normally (assignments enter the work loop as `pending`)
   - `WARN` → proceed, but log warnings to `activity_log` and include suggestions in Sarah's working memory for the next run
   - `REVISE` → set assignments to `draft` status (new status value). Inject the verification feedback into Sarah's context as a system message. Sarah re-plans on her next orchestrate cycle.

**New assignment status:** Add `'draft'` to the `work_assignments.status` enum. Draft assignments are not picked up by `executeWorkLoop()`.

**Migration:** `db/migrations/094_assignment_draft_status.sql`:

```sql
-- Add 'draft' to the status check constraint (if using CHECK constraint)
-- or just allow it in application code if status is TEXT
```

**Changes to `systemPrompt.ts`:**

Add to Sarah's `ORCHESTRATION_PROMPT` after the existing 4 pre-dispatch checks:

```
CHECK 5 — PLAN VERIFICATION
Your decomposition plan is automatically verified before dispatch.
If verification returns REVISE, you will receive feedback explaining
what needs to change. Incorporate the feedback and re-decompose.
Common issues: assignments that are too vague, missing tool access,
circular dependencies, insufficient context embedding.
```

**Changes to `executeWorkLoop()` in `workLoop.ts`:**

Ensure the P2 (ACTIVE WORK) query excludes `status = 'draft'`:

```sql
WHERE status IN ('pending', 'dispatched', 'in_progress')
-- 'draft' is explicitly excluded — only verified plans enter the work loop
```

**Acceptance criteria:**
- [ ] Plan verification runs automatically after Sarah creates assignments
- [ ] `REVISE` verdict prevents assignments from entering the work loop
- [ ] Sarah receives verification feedback and can re-decompose
- [ ] `draft` status is excluded from the work loop query
- [ ] Activity log records verification results for observability

---

### Issue 7: Plan verification dashboard + metrics

**Labels:** `copilot`, `dashboard`, `track-2`

**Description:**

Add plan verification visibility to the dashboard.

**Create migration `db/migrations/095_plan_verifications.sql`:**

```sql
CREATE TABLE IF NOT EXISTS plan_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  directive_id UUID NOT NULL REFERENCES founder_directives(id),
  verdict TEXT NOT NULL,  -- 'APPROVE' | 'WARN' | 'REVISE'
  overall_score NUMERIC(3,2),
  checks JSONB NOT NULL,  -- { atomicity, tool_coverage, dependency_validity, ... }
  suggestions TEXT[],
  assignment_count INTEGER NOT NULL,
  llm_verified BOOLEAN NOT NULL DEFAULT false,
  cost_usd NUMERIC(8,4) DEFAULT 0,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_plan_verifications_directive ON plan_verifications(directive_id);
```

Add `plan_verifications` to `dashboardApi.ts` whitelist.

**Dashboard changes:**

1. **Directives.tsx:** On the directive detail view, show the latest plan verification result:
   - Green badge for `APPROVE`, yellow for `WARN`, red for `REVISE`
   - Expandable section showing check results and suggestions
   - "Re-verify" button that triggers `POST /api/plan-verify/:directiveId`

2. **Strategy.tsx or Operations.tsx:** Add a "Plan Quality" metrics card showing:
   - Approval rate (last 30 days)
   - Most common failure reasons
   - Average assignments per directive
   - Revision-then-accept rate (plans that got `REVISE` → re-planned → `APPROVE`)

**Wire `planVerifier.ts` to persist results:** After verification, INSERT into `plan_verifications`.

**Acceptance criteria:**
- [ ] Plan verification results are persisted to the database
- [ ] Directive detail view shows verification status
- [ ] Metrics card shows aggregate plan quality trends
- [ ] Re-verify button works from the dashboard

---

## Track 3 — Memory Consolidation Pipeline

**Problem:** 11+ tables serve different aspects of organizational memory, but there's no explicit lifecycle for when raw traces become distilled lessons, when lessons become operative procedures, or when old data should be archived. The vector store grows unbounded.

**Goal:** Formalize a three-layer memory hierarchy with explicit promotion, TTLs, and archival.

---

### Issue 8: Create memory lifecycle tables + migration

**Labels:** `copilot`, `database`, `track-3`

**Description:**

Create `db/migrations/096_memory_lifecycle.sql` that adds tables for tracking memory lifecycle state and archived data.

```sql
-- Track the lifecycle stage of each memory-related record
CREATE TABLE IF NOT EXISTS memory_lifecycle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL,       -- 'agent_reflections', 'shared_episodes', 'agent_memory', etc.
  source_id UUID NOT NULL,
  current_layer TEXT NOT NULL DEFAULT 'raw',  -- 'raw' | 'distilled' | 'operative' | 'archived'
  promoted_to_table TEXT,           -- target table when promoted (e.g., 'shared_procedures')
  promoted_to_id UUID,
  promoted_at TIMESTAMPTZ,
  promoted_by TEXT,                  -- 'episodic_replay' | 'batch_evaluator' | 'manual'
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,               -- 'ttl_expired' | 'superseded' | 'manual'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(source_table, source_id)
);

CREATE INDEX idx_memory_lifecycle_layer ON memory_lifecycle(current_layer);
CREATE INDEX idx_memory_lifecycle_source ON memory_lifecycle(source_table, source_id);

-- Cold storage for archived raw traces
CREATE TABLE IF NOT EXISTS memory_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  content JSONB NOT NULL,            -- full row snapshot
  agent_role TEXT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ             -- permanent deletion date (null = keep forever)
);

CREATE INDEX idx_memory_archive_source ON memory_archive(source_table);
CREATE INDEX idx_memory_archive_agent ON memory_archive(agent_role);

-- Policy version tracking (used by Track 4 but created here for schema coherence)
CREATE TABLE IF NOT EXISTS policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_type TEXT NOT NULL,         -- 'prompt' | 'rubric' | 'routing' | 'model_selection' | 'constitution'
  agent_role TEXT,                    -- null = org-wide
  version INTEGER NOT NULL DEFAULT 1,
  content JSONB NOT NULL,            -- the actual policy content
  source TEXT NOT NULL,              -- 'reflection' | 'constitutional_amendment' | 'batch_evaluator' | 'manual'
  status TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'candidate' | 'canary' | 'active' | 'rolled_back'
  eval_score NUMERIC(3,2),
  eval_details JSONB,
  promoted_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  rollback_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(policy_type, agent_role, version)
);

CREATE INDEX idx_policy_versions_active ON policy_versions(policy_type, agent_role) WHERE status = 'active';
CREATE INDEX idx_policy_versions_canary ON policy_versions(status) WHERE status = 'canary';
```

Add all three tables to `dashboardApi.ts` whitelist.

**Acceptance criteria:**
- [ ] Migration runs cleanly
- [ ] All three tables created with proper indexes
- [ ] Tables accessible via dashboard API

---

### Issue 9: Build `memoryConsolidator.ts` — raw → distilled promotion

**Labels:** `copilot`, `scheduler`, `track-3`

**Description:**

Create `packages/scheduler/src/memoryConsolidator.ts`. Runs daily (3 AM UTC) to promote high-value raw traces into distilled organizational knowledge.

**Add cron job to `cronManager.ts`:**

```typescript
{
  id: 'memory-consolidation',
  cron: '0 3 * * *',  // daily at 3 AM UTC
  endpoint: '/memory/consolidate',
  description: 'Daily memory consolidation — promote raw traces to distilled lessons'
}
```

**Add endpoint to `server.ts`:** `POST /memory/consolidate`

**Consolidation logic:**

```typescript
export async function consolidateMemory(db: Pool, embeddingClient: EmbeddingClient): Promise<ConsolidationReport> {
  // PHASE 1: Identify promotion candidates (DB queries only, no LLM)
  //
  // From shared_episodes (raw → distilled):
  //   - significance_score >= 0.7
  //   - created_at > last_consolidation AND created_at < NOW() - 24h
  //   - Not already in memory_lifecycle with layer != 'raw'
  //
  // From agent_reflections (raw → distilled):
  //   - quality_score >= 70
  //   - Has non-empty prompt_suggestions OR knowledge_gaps
  //   - created_at in same window
  //
  // From task_run_outcomes (raw → distilled):
  //   - Patterns: same agent_role with abort_rate > 0.3 over last 7 days
  //   - Patterns: same task_description keywords with consistent revision

  // PHASE 2: Deduplicate against existing distilled knowledge
  //
  //   For each candidate:
  //     - Embed the candidate content
  //     - Semantic search against company_knowledge + shared_procedures
  //     - If similarity > 0.90 → skip (already known)
  //     - If similarity 0.75–0.90 → merge/strengthen existing entry
  //     - If similarity < 0.75 → new distilled entry

  // PHASE 3: Promote (one LLM call per batch of ~20 candidates)
  //
  //   Send batch of candidates to gemini-2.5-flash-lite with prompt:
  //   "Distill these operational observations into concise organizational lessons.
  //    For each, output: { type, title, lesson, confidence, source_agents, departments }"
  //
  //   Insert results into company_knowledge (type = 'process_insight' or 'failure_pattern')
  //   Update memory_lifecycle: source records → layer = 'distilled', promoted_to_table, promoted_to_id

  // PHASE 4: Promote distilled → operative (patterns with high confidence)
  //
  //   From shared_procedures where success_rate > 0.8 AND times_used >= 5:
  //     - Candidate for rubric or prompt modification
  //     - Insert into policy_versions (status = 'draft')
  //     - Track in memory_lifecycle: layer = 'operative'

  // Return: { candidates_found, promoted, merged, skipped, errors }
}
```

**Acceptance criteria:**
- [ ] Runs daily via cron
- [ ] Promotes high-value episodes and reflections to `company_knowledge`
- [ ] Deduplicates against existing knowledge (semantic similarity)
- [ ] Tracks all promotions in `memory_lifecycle`
- [ ] Uses Redis lock to prevent concurrent runs
- [ ] LLM cost kept low (one batched call per ~20 candidates, using economy-tier model)

---

### Issue 10: Build `memoryArchiver.ts` — TTL-based archival

**Labels:** `copilot`, `scheduler`, `track-3`

**Description:**

Create `packages/scheduler/src/memoryArchiver.ts`. Runs weekly (Sunday 4 AM UTC) to archive raw traces that have exceeded their retention window.

**Add cron job:**

```typescript
{
  id: 'memory-archival',
  cron: '0 4 * * 0',  // weekly Sunday 4 AM UTC
  endpoint: '/memory/archive',
  description: 'Weekly memory archival — move expired raw traces to cold storage'
}
```

**Retention rules:**

| Source Table | Raw Retention | Archive Retention | Notes |
|---|---|---|---|
| `agent_runs` | 30 days | 180 days then delete | Keep run metadata, archive full output |
| `agent_reflections` | 30 days | 90 days then delete | Promoted insights already in company_knowledge |
| `agent_memory` | 60 days | 180 days then delete | Higher-value, longer retention |
| `shared_episodes` | 30 days if significance < 0.5 | 90 days | Low-significance episodes archived faster |
| `shared_episodes` | 90 days if significance >= 0.5 | 180 days | High-significance episodes kept longer |
| `agent_messages` | 14 days | 60 days | Transient communication |
| `task_run_outcomes` | 60 days | 180 days | Important for trend analysis |

**Archival logic:**

```typescript
export async function archiveExpiredMemory(db: Pool): Promise<ArchivalReport> {
  // For each source table and retention rule:
  //   1. Query rows past retention window that aren't already archived
  //   2. Check memory_lifecycle — only archive if layer = 'raw' or 'distilled'
  //      (never archive 'operative' records automatically)
  //   3. Snapshot full row as JSONB → INSERT into memory_archive
  //   4. Update memory_lifecycle: layer = 'archived', archived_at = NOW()
  //   5. DELETE the original row

  // Safety: process in batches of 100, COMMIT per batch
  // Never delete rows that are referenced by active assignments or ongoing runs
}
```

**Acceptance criteria:**
- [ ] Runs weekly via cron
- [ ] Archives rows per the retention rules above
- [ ] Full row snapshots preserved in `memory_archive`
- [ ] Never archives operative-layer records
- [ ] Never deletes rows referenced by active work
- [ ] Batch processing with per-batch commits

---

### Issue 11: Memory lifecycle dashboard visibility

**Labels:** `copilot`, `dashboard`, `track-3`

**Description:**

Add a "Memory Health" section to the Operations.tsx dashboard page showing:

1. **Layer distribution chart** (Recharts pie chart):
   - Count of records in each layer (raw, distilled, operative, archived)
   - Grouped by source table

2. **Consolidation activity** (last 30 days):
   - Records promoted per day (bar chart)
   - Records archived per week
   - Current raw trace count and growth rate

3. **Storage metrics:**
   - Total rows per memory-related table
   - pgvector index size (query `pg_total_relation_size('agent_memory')`)
   - Estimated monthly growth rate

4. **Manual controls:**
   - "Run Consolidation Now" button → `POST /memory/consolidate`
   - "Run Archival Now" button → `POST /memory/archive`

**Data source:** Query `memory_lifecycle` and `memory_archive` tables via `dashboardApi.ts`.

**Acceptance criteria:**
- [ ] Memory health section renders on Operations page
- [ ] Shows current layer distribution
- [ ] Shows consolidation and archival activity trends
- [ ] Manual trigger buttons work

---

## Track 4 — Policy Promotion Pipeline

**Problem:** Agents generate prompt suggestions, constitutional amendments, and operational insights, but there's no governed pipeline to test and promote these into live policy. Changes either happen manually or not at all.

**Goal:** Build a proposal → offline eval → canary → promote/revert pipeline for all policy types.

---

### Issue 12: Build `policyProposalCollector.ts`

**Labels:** `copilot`, `scheduler`, `track-4`

**Description:**

Create `packages/scheduler/src/policyProposalCollector.ts`. Runs twice daily (after batch outcome evaluation) to collect policy change proposals from across the system and normalize them into `policy_versions` candidates.

**Add cron job:**

```typescript
{
  id: 'policy-proposal-collection',
  cron: '0 3,15 * * *',  // twice daily, 1hr after batch eval
  endpoint: '/policy/collect',
  description: 'Collect policy change proposals from reflections and evaluations'
}
```

**Proposal sources:**

| Source | Table | Signal | Policy Type |
|---|---|---|---|
| Prompt suggestions | `agent_reflections.prompt_suggestions` | 3+ similar suggestions from same agent in 7 days | `prompt` |
| Constitutional amendments | `proposed_constitutional_amendments` WHERE status = 'pending' | Approved by episodic replay | `constitution` |
| Knowledge gaps | `agent_reflections.knowledge_gaps` | Recurring gaps → brief/KB update | `prompt` |
| Routing patterns | `task_run_outcomes` | Agent X consistently fails task type Y → reroute | `routing` |
| Model performance | `task_run_outcomes` grouped by model | Model A outperforms Model B for agent role | `model_selection` |
| Rubric proposals | `shared_procedures` with high success rate | Procedure → rubric dimension | `rubric` |

**Logic:**

```typescript
export async function collectProposals(db: Pool): Promise<CollectionReport> {
  // 1. PROMPT PROPOSALS:
  //    - GROUP agent_reflections.prompt_suggestions by agent_role
  //      WHERE created_at > NOW() - 7 days
  //    - If 3+ reflections suggest the same theme (semantic similarity > 0.8):
  //      → INSERT policy_versions (type='prompt', agent_role, content={suggestions}, status='draft')

  // 2. CONSTITUTIONAL PROPOSALS:
  //    - SELECT from proposed_constitutional_amendments WHERE status = 'approved'
  //      AND NOT already in policy_versions
  //    - → INSERT policy_versions (type='constitution', content={amendment}, status='draft')

  // 3. ROUTING PROPOSALS:
  //    - From task_run_outcomes WHERE was_revised = true OR final_status IN ('aborted','failed')
  //    - GROUP BY agent_role, extract task keywords
  //    - If agent has >50% failure rate on a task pattern over 14 days:
  //      → INSERT policy_versions (type='routing', content={current_agent, suggested_agent, pattern})

  // 4. MODEL SELECTION PROPOSALS:
  //    - From task_run_outcomes, compare avg batch_quality_score per model per role
  //    - If a non-default model outperforms by > 0.5 points over 20+ runs:
  //      → INSERT policy_versions (type='model_selection', content={role, current, proposed, evidence})

  // Deduplicate: check existing draft/candidate policy_versions before inserting
}
```

**Acceptance criteria:**
- [ ] Collects proposals from all 6 sources
- [ ] Deduplicates against existing policy_versions entries
- [ ] Creates `draft` status entries in `policy_versions`
- [ ] Runs on schedule

---

### Issue 13: Build `policyReplayEvaluator.ts` — offline evaluation

**Labels:** `copilot`, `scheduler`, `track-4`

**Description:**

Create `packages/scheduler/src/policyReplayEvaluator.ts`. Evaluates draft policy proposals by replaying them against historical task data.

**Add cron job:**

```typescript
{
  id: 'policy-replay-eval',
  cron: '0 5 * * *',  // daily at 5 AM UTC (after consolidation and collection)
  endpoint: '/policy/evaluate',
  description: 'Evaluate draft policy proposals via offline replay'
}
```

**Evaluation strategy per policy type:**

| Policy Type | Evaluation Method |
|---|---|
| `prompt` | Take 5 recent runs from the agent. Re-run with the candidate prompt change applied (using the economy-tier model). Compare the output quality via the verifier model (structured scoring). Score must be >= current average to pass. |
| `constitution` | No replay needed — constitutional amendments go through the existing episodic replay approval process. Auto-promote to `candidate` if already approved. |
| `routing` | Look up historical task outcomes for both the current agent and the proposed agent on similar tasks. If the proposed agent's historical quality is higher, pass. Purely statistical — no LLM needed. |
| `model_selection` | Already evaluated by statistical comparison in the collector. Auto-promote to `candidate` if evidence is strong (>20 runs, >0.5 quality delta). |
| `rubric` | Send the proposed rubric dimension to a verifier model with 5 historical task outputs. Ask: "Would this rubric dimension have correctly distinguished good from bad outputs?" Score the rubric's discriminative power. |

**Implementation:**

```typescript
export async function evaluateDraftPolicies(db: Pool): Promise<EvalReport> {
  // 1. SELECT from policy_versions WHERE status = 'draft' ORDER BY created_at LIMIT 10
  // 2. For each draft, run the type-specific evaluation
  // 3. UPDATE policy_versions SET:
  //      - eval_score = computed score (0–1)
  //      - eval_details = { method, sample_size, comparison, notes }
  //      - status = 'candidate' if eval_score >= 0.6
  //      - status = 'draft' (unchanged) if eval_score < 0.6 (will retry next cycle)
  //      - status = 'rejected' if eval_score < 0.3 or if draft is > 14 days old
}
```

**Cost budget:** Max 5 LLM replay calls per evaluation cycle. Skip expensive evaluations when budget is tight. Log estimated cost per evaluation.

**Acceptance criteria:**
- [ ] Evaluates up to 10 draft policies per cycle
- [ ] Type-specific evaluation methods as described
- [ ] Promotes passing proposals to `candidate` status
- [ ] Rejects stale drafts (> 14 days without passing)
- [ ] Cost-bounded (max 5 LLM calls per cycle)

---

### Issue 14: Build `policyCanaryManager.ts` — canary rollout + auto-revert

**Labels:** `copilot`, `scheduler`, `track-4`

**Description:**

Create `packages/scheduler/src/policyCanaryManager.ts`. Manages the canary rollout of candidate policies and auto-reverts on regression.

**Add cron job:**

```typescript
{
  id: 'policy-canary-check',
  cron: '0 */4 * * *',  // every 4 hours
  endpoint: '/policy/canary-check',
  description: 'Check canary policy performance and promote or revert'
}
```

**Canary lifecycle:**

```
candidate → canary (applied to live agent) → active (promoted) or rolled_back (reverted)
```

**Implementation:**

```typescript
export async function manageCanaries(db: Pool): Promise<CanaryReport> {
  // PHASE 1: PROMOTE candidates to canary
  //
  // SELECT from policy_versions WHERE status = 'candidate'
  //   AND eval_score >= 0.6
  //   AND created_at < NOW() - INTERVAL '24 hours' (cool-down after eval)
  //   LIMIT 3 (max 3 concurrent canaries)
  //
  // For each candidate:
  //   - Apply the policy change to the live system:
  //     - prompt → update agent system prompt in DB (agent_briefs or systemPrompt.ts flag)
  //     - routing → update a routing_overrides table or config
  //     - model_selection → update company_agents.model column
  //     - constitution → update agent_constitutions
  //     - rubric → update role_rubrics
  //   - UPDATE policy_versions SET status = 'canary', promoted_at = NOW()
  //   - Snapshot the previous policy as a rollback target

  // PHASE 2: CHECK active canaries
  //
  // SELECT from policy_versions WHERE status = 'canary'
  //
  // For each canary:
  //   - Query task_run_outcomes for the affected agent since promoted_at
  //   - Minimum sample size: 10 runs (if fewer, skip — not enough data yet)
  //   - Compare avg batch_quality_score against the 30-day baseline (pre-canary)
  //
  //   Decision:
  //   - If canary avg >= baseline - 0.3 AND canary has 20+ runs:
  //       → PROMOTE: status = 'active', mark previous active version as 'superseded'
  //   - If canary avg < baseline - 0.5 at any point:
  //       → REVERT: restore previous policy, status = 'rolled_back',
  //         rollback_reason = 'regression detected'
  //   - If canary is > 7 days old without enough data:
  //       → REVERT: rollback_reason = 'insufficient_data'

  // PHASE 3: NOTIFY
  //   - Emit events for promotions and rollbacks
  //   - Log to activity_log
  //   - If rollback: send alert to #decisions channel via Teams
}
```

**Rollback mechanism:** For each policy type, implement `applyPolicy(policyVersion)` and `revertPolicy(policyVersion, previousVersion)` functions that make the actual system changes. These must be idempotent.

**Acceptance criteria:**
- [ ] Promotes candidates to canary with a 24-hour cool-down
- [ ] Max 3 concurrent canaries
- [ ] Compares canary performance against 30-day baseline
- [ ] Auto-reverts on regression (>0.5 quality drop)
- [ ] Auto-reverts stale canaries (>7 days without enough data)
- [ ] Rollbacks are idempotent and notify founders
- [ ] All state changes logged to activity_log

---

### Issue 15: Wire existing reflection signals into the proposal collector

**Labels:** `copilot`, `agents`, `track-4`

**Description:**

Ensure the existing post-run reflection data feeds cleanly into the policy proposal pipeline.

**Changes to `packages/agent-runtime/src/companyAgentRunner.ts` (reflection phase):**

The current reflection output already includes `promptSuggestions[]` and `knowledgeGaps[]`. Add a structured tag to each suggestion for easier collection:

```typescript
// In the reflection prompt, add:
// "For each prompt_suggestion, include a category:
//  'wording' (phrasing change), 'instruction' (add/remove a rule),
//  'context' (add/remove context source), 'tool' (add/remove tool access)."
```

**Changes to `packages/company-memory/src/worldModelUpdater.ts`:**

After `updateFromGrade()`, if the reflection contains prompt suggestions or knowledge gaps, emit a lightweight event:

```typescript
// After saving reflection:
if (reflection.promptSuggestions?.length > 0 || reflection.knowledgeGaps?.length > 0) {
  await glyphorEventBus.emit({
    type: 'learning.proposal_signal',
    source: agentRole,
    data: {
      prompt_suggestions: reflection.promptSuggestions,
      knowledge_gaps: reflection.knowledgeGaps,
      run_id: runId,
      quality_score: reflection.qualityScore
    }
  });
}
```

Add `learning.proposal_signal` to the event types enum and event permissions (system-only tier).

**Acceptance criteria:**
- [ ] Reflection prompt suggestions include a category tag
- [ ] Proposal signals are emitted as events after reflection
- [ ] Event permissions are properly set (system-only)

---

### Issue 16: Policy management dashboard page

**Labels:** `copilot`, `dashboard`, `track-4`

**Description:**

Create a new dashboard page `packages/dashboard/src/pages/PolicyVersions.tsx` accessible at `/policy`.

**Page sections:**

1. **Active Policies** — table showing current active policy for each (policy_type, agent_role) pair. Columns: type, agent, version, promoted_at, eval_score.

2. **Canary Watch** — highlighted section showing any policies currently in canary status. For each: policy type, agent, time in canary, runs since promotion, current quality vs baseline, progress bar toward the 20-run promotion threshold.

3. **Pipeline View** — Kanban-style columns: Draft → Candidate → Canary → Active. Show counts and most recent entries in each column.

4. **History** — paginated table of all policy_versions ordered by created_at DESC. Filterable by policy_type, agent_role, status. Show eval_score, source, and rollback_reason if applicable.

5. **Manual controls:**
   - "Collect Proposals Now" → `POST /policy/collect`
   - "Run Evaluation" → `POST /policy/evaluate`
   - "Force Promote" button on candidate rows (Yellow-tier approval required)
   - "Force Rollback" button on canary/active rows

**Add route to `App.tsx`:** `/policy` → `PolicyVersions`

**Add nav item to `Layout.tsx`:** under the existing "Capabilities" section or as a new "Learning" section.

**Acceptance criteria:**
- [ ] Page renders with all 5 sections
- [ ] Active policies, canary watch, and pipeline view display correctly
- [ ] History table supports filtering by type and status
- [ ] Manual control buttons trigger the correct endpoints
- [ ] Nav link added to sidebar

---

## Track 5 — Pre-Execution Constitutional Gates

**Problem:** Constitutional governance currently evaluates agent output after the run. For high-stakes external actions (emails, GitHub writes, customer-facing communications), this is too late — the action has already been taken.

**Goal:** Add principle-level pre-execution checks for high-stakes tool calls, integrated into the tool execution pipeline.

---

### Issue 17: Build `constitutionalPreCheck.ts`

**Labels:** `copilot`, `agent-runtime`, `track-5`

**Description:**

Create `packages/agent-runtime/src/constitutionalPreCheck.ts`. Performs a fast constitutional compliance check before high-stakes tool calls execute.

**High-stakes tools (pre-check required):**

```typescript
const HIGH_STAKES_TOOLS = new Set([
  'send_email',
  'reply_to_email',
  'create_or_update_file',   // GitHub writes
  'create_branch',
  'register_tool',           // new tool creation
  'create_specialist_agent', // new agent creation
  'grant_tool_access',       // write-tool grants
  'submit_assignment_output', // only for externally-visible outputs
]);
```

**Implementation:**

```typescript
export interface ConstitutionalPreCheckResult {
  allowed: boolean;
  violations: Array<{
    principle_id: string;
    principle_category: string;
    description: string;
    severity: 'warning' | 'block';
  }>;
  check_duration_ms: number;
}

export async function preCheckTool(
  db: Pool,
  agentRole: string,
  toolName: string,
  toolParams: Record<string, unknown>,
  constitution: Constitution,
  redisCache?: RedisCache
): Promise<ConstitutionalPreCheckResult>
```

**Check logic (deterministic first, LLM only when needed):**

```typescript
// PHASE 1: Deterministic checks (zero LLM cost)
//
// For send_email / reply_to_email:
//   - Verify recipient is not a blocked domain (e.g., competitor domains)
//   - Verify body doesn't contain unsubstantiated claims about pricing or SLAs
//     (regex: /guarantee|promise|SLA|99\.\d+%/ without supporting data)
//   - Verify body doesn't contain internal agent names or system details
//
// For create_or_update_file:
//   - Verify branch follows feature/agent-* pattern (already enforced, but belt+suspenders)
//   - Verify file path not in blocklist (already enforced)
//   - Verify content doesn't modify budget caps (already enforced)
//
// For create_specialist_agent:
//   - Verify agent count < max (3 per creator, already enforced)
//   - Verify agent name doesn't impersonate founders
//
// For register_tool:
//   - Verify tool doesn't access blocked tables
//   - Verify tool URL is not an internal/sensitive endpoint

// PHASE 2: Principle-based check (fast LLM call, only if Phase 1 passes)
//
// Only for send_email, reply_to_email, and externally-visible submit_assignment_output:
//
// Use gemini-2.5-flash-lite (economy tier) with a focused prompt:
//   "Given this agent's constitutional principles: {relevant_principles}
//    And this pending action: {tool_name}({params_summary})
//    Does this action violate any principle? Respond JSON:
//    { violations: [{ principle_id, severity, description }] }"
//
// Cache key: constitutionalPreCheck:{agentRole}:{md5(toolParams)}
// Cache TTL: 5 minutes (same params = same result)

// COMPOSE result:
//   - Any 'block' violation → allowed: false
//   - Only 'warning' violations → allowed: true (but log warnings)
//   - No violations → allowed: true
```

**Cost control:** Phase 2 (LLM call) only fires for external communication tools. All other high-stakes tools use only Phase 1 (deterministic). Estimated cost: < $0.001 per check using flash-lite.

**Acceptance criteria:**
- [ ] Deterministic checks cover all HIGH_STAKES_TOOLS
- [ ] LLM-based principle check only fires for external communication tools
- [ ] Results are cached (5 min TTL)
- [ ] Returns structured violations with severity levels
- [ ] Economy-tier model keeps cost < $0.001 per check

---

### Issue 18: Wire constitutional pre-checks into `toolExecutor.ts`

**Labels:** `copilot`, `agent-runtime`, `track-5`

**Description:**

Integrate `constitutionalPreCheck.ts` into the existing tool execution pipeline in `packages/agent-runtime/src/toolExecutor.ts`.

**Current pipeline (from architecture doc):**

```
ToolExecutor.execute(toolName, params)
  ├─ 1. Static tool map
  ├─ 2. runtime_ prefix tools
  ├─ 3. Dynamic registry fallback
  └─ 4. "Unknown tool" error
```

**Each tool call also goes through:**
```
grant check → scope check → rate limit check → budget check → execute + timeout → auto-verify
```

**Insert constitutional pre-check after budget check, before execute:**

```
grant check → scope check → rate limit check → budget check
  → CONSTITUTIONAL PRE-CHECK (new, only for HIGH_STAKES_TOOLS)
  → execute + timeout → auto-verify
```

**Implementation in `toolExecutor.ts`:**

```typescript
// After budget check passes, before execution:
if (HIGH_STAKES_TOOLS.has(toolName)) {
  const constitution = await this.loadConstitution(agentRole);  // cached
  if (constitution) {
    const preCheck = await preCheckTool(db, agentRole, toolName, params, constitution, redisCache);

    if (!preCheck.allowed) {
      // Return a structured tool error to the agent
      return {
        success: false,
        output: `Constitutional pre-check blocked this action. Violations:\n${
          preCheck.violations.map(v => `- [${v.severity}] ${v.principle_category}: ${v.description}`).join('\n')
        }\nRevise your approach to comply with your governing principles.`,
        blocked_by: 'constitutional_pre_check'
      };
    }

    if (preCheck.violations.length > 0) {
      // Warnings — log but allow execution
      console.warn(`Constitutional warnings for ${agentRole}/${toolName}:`,
        preCheck.violations);
      // Record warnings in the action receipt
    }
  }
}
```

**Add to ActionReceipt:** Extend the ActionReceipt type to include an optional `constitutional_check` field:

```typescript
interface ActionReceipt {
  // existing fields...
  constitutional_check?: {
    checked: boolean;
    violations: number;
    blocked: boolean;
  };
}
```

**Dashboard visibility in Chat.tsx:** When an action receipt has `constitutional_check.blocked = true`, show a red "Blocked by principles" badge in the collapsible tool log.

**Acceptance criteria:**
- [ ] Pre-check fires for all HIGH_STAKES_TOOLS before execution
- [ ] Blocked actions return a structured error guiding the agent to revise
- [ ] Warnings are logged but don't block execution
- [ ] Action receipts include constitutional check metadata
- [ ] Chat UI shows blocked actions with a visual indicator
- [ ] Non-high-stakes tools are completely unaffected (no performance impact)

---

### Issue 19: Constitutional gate metrics + trust integration

**Labels:** `copilot`, `scheduler`, `track-5`

**Description:**

Create `db/migrations/097_constitutional_gates.sql`:

```sql
CREATE TABLE IF NOT EXISTS constitutional_gate_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES agent_runs(id),
  agent_role TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  check_phase TEXT NOT NULL,  -- 'deterministic' | 'principle_llm'
  result TEXT NOT NULL,        -- 'passed' | 'warned' | 'blocked'
  violations JSONB,
  cost_usd NUMERIC(8,4) DEFAULT 0,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_constitutional_gates_agent ON constitutional_gate_events(agent_role);
CREATE INDEX idx_constitutional_gates_result ON constitutional_gate_events(result);
```

**Wire into trust scorer:** In `trustScorer.ts`, add a new signal source:

```typescript
// | `constitutional_gate_block` | 1.5 | − (penalty) |
//
// When a constitutional gate blocks a tool call, apply a negative trust delta.
// This stacks with the existing constitutional_adherence signal.
```

**Wire into `constitutionalPreCheck.ts`:** After every pre-check, INSERT into `constitutional_gate_events`.

**Dashboard:** Add a "Constitutional Gates" card to the agent profile page (AgentProfile.tsx, performance tab) showing:
- Total checks, pass rate, block rate (last 30 days)
- Most common violation categories
- Trend chart (blocks per week)

**Acceptance criteria:**
- [ ] Gate events are persisted to the database
- [ ] Trust scorer penalizes agents that hit constitutional blocks
- [ ] Agent profile shows gate metrics
- [ ] Table added to dashboard API whitelist

---

## Track 6 — Tool Reputation & Expiration

**Problem:** Runtime-synthesized tools (`runtimeToolFactory.ts`) and dynamic DB-registered tools (`dynamicToolExecutor.ts`) can quietly become part of the system without quality tracking or expiration. Max 20 persisted runtime tools, but no reputation signal.

**Goal:** Track tool success/failure rates and auto-expire tools that are stale or unreliable.

---

### Issue 20: Create `tool_reputation` table

**Labels:** `copilot`, `database`, `track-6`

**Description:**

Create `db/migrations/098_tool_reputation.sql`:

```sql
CREATE TABLE IF NOT EXISTS tool_reputation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name TEXT NOT NULL,
  tool_source TEXT NOT NULL,  -- 'static' | 'runtime' | 'dynamic_registry' | 'mcp'

  -- Usage stats
  total_calls INTEGER NOT NULL DEFAULT 0,
  successful_calls INTEGER NOT NULL DEFAULT 0,
  failed_calls INTEGER NOT NULL DEFAULT 0,
  timeout_calls INTEGER NOT NULL DEFAULT 0,

  -- Quality signals
  avg_latency_ms NUMERIC(10,2),
  downstream_defect_count INTEGER NOT NULL DEFAULT 0,  -- times the output led to a revision
  contradiction_count INTEGER NOT NULL DEFAULT 0,       -- times output contradicted known facts
  last_used_at TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,

  -- Computed scores (updated by reputation tracker)
  success_rate NUMERIC(4,3),       -- successful / total
  reliability_score NUMERIC(4,3),  -- composite score (0–1)

  -- Lifecycle
  is_active BOOLEAN NOT NULL DEFAULT true,
  expired_at TIMESTAMPTZ,
  expiration_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(tool_name)
);

CREATE INDEX idx_tool_reputation_source ON tool_reputation(tool_source);
CREATE INDEX idx_tool_reputation_active ON tool_reputation(is_active);
CREATE INDEX idx_tool_reputation_reliability ON tool_reputation(reliability_score);

-- Function for atomic stat updates
CREATE OR REPLACE FUNCTION update_tool_stats(
  p_tool_name TEXT,
  p_tool_source TEXT,
  p_success BOOLEAN,
  p_timed_out BOOLEAN,
  p_latency_ms NUMERIC
) RETURNS void AS $$
BEGIN
  INSERT INTO tool_reputation (tool_name, tool_source, total_calls, successful_calls,
    failed_calls, timeout_calls, avg_latency_ms, last_used_at, success_rate)
  VALUES (p_tool_name, p_tool_source, 1,
    CASE WHEN p_success THEN 1 ELSE 0 END,
    CASE WHEN NOT p_success AND NOT p_timed_out THEN 1 ELSE 0 END,
    CASE WHEN p_timed_out THEN 1 ELSE 0 END,
    p_latency_ms, NOW(),
    CASE WHEN p_success THEN 1.0 ELSE 0.0 END)
  ON CONFLICT (tool_name) DO UPDATE SET
    total_calls = tool_reputation.total_calls + 1,
    successful_calls = tool_reputation.successful_calls + CASE WHEN p_success THEN 1 ELSE 0 END,
    failed_calls = tool_reputation.failed_calls + CASE WHEN NOT p_success AND NOT p_timed_out THEN 1 ELSE 0 END,
    timeout_calls = tool_reputation.timeout_calls + CASE WHEN p_timed_out THEN 1 ELSE 0 END,
    avg_latency_ms = (tool_reputation.avg_latency_ms * tool_reputation.total_calls + p_latency_ms) / (tool_reputation.total_calls + 1),
    last_used_at = NOW(),
    last_failed_at = CASE WHEN NOT p_success THEN NOW() ELSE tool_reputation.last_failed_at END,
    success_rate = (tool_reputation.successful_calls + CASE WHEN p_success THEN 1 ELSE 0 END)::NUMERIC
      / (tool_reputation.total_calls + 1),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
```

Add `tool_reputation` to `dashboardApi.ts` whitelist.

**Acceptance criteria:**
- [ ] Migration runs cleanly
- [ ] `update_tool_stats()` function handles upsert atomically
- [ ] Table accessible via dashboard API

---

### Issue 21: Build `toolReputationTracker.ts` — instrument tool calls

**Labels:** `copilot`, `agent-runtime`, `track-6`

**Description:**

Create `packages/agent-runtime/src/toolReputationTracker.ts` and integrate it into `toolExecutor.ts`.

**Implementation:**

```typescript
export async function recordToolCall(
  db: Pool,
  toolName: string,
  toolSource: 'static' | 'runtime' | 'dynamic_registry' | 'mcp',
  success: boolean,
  timedOut: boolean,
  latencyMs: number
): Promise<void> {
  // Fire-and-forget: call update_tool_stats() Postgres function
  await db.query(
    'SELECT update_tool_stats($1, $2, $3, $4, $5)',
    [toolName, toolSource, success, timedOut, latencyMs]
  );
}
```

**Wire into `toolExecutor.ts`:**

After every tool execution (success or failure), call `recordToolCall()`:

```typescript
// In the execute() method, after the tool call completes:
const startTime = Date.now();
try {
  const result = await executeToolCall(toolName, params);
  const latency = Date.now() - startTime;

  // Record success
  recordToolCall(db, toolName, detectToolSource(toolName), true, false, latency)
    .catch(err => console.warn('Tool reputation tracking failed:', err));

  return result;
} catch (error) {
  const latency = Date.now() - startTime;
  const timedOut = error.message?.includes('timeout') || latency >= 60000;

  // Record failure
  recordToolCall(db, toolName, detectToolSource(toolName), false, timedOut, latency)
    .catch(err => console.warn('Tool reputation tracking failed:', err));

  throw error;
}
```

**`detectToolSource()` helper:**

```typescript
function detectToolSource(toolName: string): 'static' | 'runtime' | 'dynamic_registry' | 'mcp' {
  if (toolName.startsWith('runtime_')) return 'runtime';
  if (toolName.startsWith('mcp_') || toolName.startsWith('glyphor_')) return 'mcp';
  // Check dynamic registry (tool_registry table) — use cached lookup
  if (dynamicToolCache.has(toolName)) return 'dynamic_registry';
  return 'static';
}
```

**Downstream defect tracking:** In the batch outcome evaluator (Issue 3), when a task run has `was_revised = true`, look at the tool calls from that run (via `agent_runs.actions`) and increment `downstream_defect_count` on each tool used:

```sql
UPDATE tool_reputation
SET downstream_defect_count = downstream_defect_count + 1, updated_at = NOW()
WHERE tool_name = ANY($1::text[])
```

**Acceptance criteria:**
- [ ] Every tool call (success and failure) is recorded
- [ ] Fire-and-forget — never blocks tool execution
- [ ] Tool source correctly detected for all 4 categories
- [ ] Downstream defect tracking updates on revision signals
- [ ] All recording failures are caught and logged

---

### Issue 22: Build `toolExpirationManager.ts` — auto-expire stale/unreliable tools

**Labels:** `copilot`, `scheduler`, `track-6`

**Description:**

Create `packages/scheduler/src/toolExpirationManager.ts`. Runs daily to expire unreliable or stale dynamic/runtime tools.

**Add cron job:**

```typescript
{
  id: 'tool-expiration-check',
  cron: '0 6 * * *',  // daily at 6 AM UTC
  endpoint: '/tools/expire',
  description: 'Expire stale or unreliable dynamic tools'
}
```

**Expiration rules (only applies to `runtime` and `dynamic_registry` tools — never static or MCP):**

| Condition | Action | Reason |
|---|---|---|
| `last_used_at < NOW() - 7 days` | Expire | Stale — unused for a week |
| `success_rate < 0.5 AND total_calls >= 10` | Expire | Unreliable — fails more than half the time |
| `timeout_calls > 5 AND timeout_calls::float / total_calls > 0.3` | Expire | Timeout-prone |
| `downstream_defect_count > 3 AND downstream_defect_count::float / total_calls > 0.2` | Expire | Defect-prone — outputs frequently lead to revisions |

**Implementation:**

```typescript
export async function expireTools(db: Pool): Promise<ExpirationReport> {
  // 1. Query tool_reputation WHERE is_active = true
  //    AND tool_source IN ('runtime', 'dynamic_registry')

  // 2. Apply expiration rules above

  // 3. For each tool to expire:
  //    - UPDATE tool_reputation SET is_active = false, expired_at = NOW(),
  //        expiration_reason = '...'
  //    - UPDATE tool_registry SET is_active = false WHERE name = tool_name
  //        (for dynamic_registry tools)
  //    - For runtime tools: they expire naturally per-run,
  //        but update runtime_tools table if persisted

  // 4. Emit alert.triggered event for expired tools (low severity)
  //    so the CTO is aware

  // 5. Log to activity_log

  // Return: { expired: string[], reasons: Record<string, string> }
}
```

**Compute `reliability_score`** — update as part of the expiration check:

```sql
UPDATE tool_reputation SET
  reliability_score = (
    success_rate * 0.4
    + LEAST(1.0, 1.0 - (downstream_defect_count::numeric / GREATEST(total_calls, 1))) * 0.3
    + LEAST(1.0, 1.0 - (timeout_calls::numeric / GREATEST(total_calls, 1))) * 0.2
    + CASE WHEN last_used_at > NOW() - INTERVAL '7 days' THEN 0.1 ELSE 0.0 END
  ),
  updated_at = NOW()
WHERE tool_source IN ('runtime', 'dynamic_registry')
AND is_active = true;
```

**Dashboard — add to Governance.tsx or Operations.tsx:**

- "Tool Health" card showing:
  - Total active tools by source
  - Recently expired tools (last 7 days) with reasons
  - Lowest reliability tools (bottom 5)
  - "Re-enable" button for manually restoring expired tools

**Acceptance criteria:**
- [ ] Runs daily via cron
- [ ] Only expires runtime and dynamic_registry tools (never static or MCP)
- [ ] All 4 expiration rules enforced
- [ ] Reliability score computed before expiration check
- [ ] CTO notified via event when tools are expired
- [ ] Dashboard shows tool health and recently expired tools
- [ ] Manual re-enable button works

---

## Implementation Order Summary

```
Week 1:
  Issue 1   — task_run_outcomes table
  Issue 2   — taskOutcomeHarvester.ts
  Issue 5   — planVerifier.ts
  Issue 8   — memory lifecycle tables

Week 2:
  Issue 3   — batchOutcomeEvaluator.ts
  Issue 6   — wire plan verification into orchestration
  Issue 9   — memoryConsolidator.ts
  Issue 12  — policyProposalCollector.ts

Week 3:
  Issue 4   — feed outcomes into world model + trust
  Issue 7   — plan verification dashboard
  Issue 10  — memoryArchiver.ts
  Issue 13  — policyReplayEvaluator.ts

Week 4:
  Issue 11  — memory lifecycle dashboard
  Issue 14  — policyCanaryManager.ts
  Issue 15  — wire reflections into proposal collector
  Issue 20  — tool_reputation table

Week 5:
  Issue 16  — policy management dashboard page
  Issue 17  — constitutionalPreCheck.ts
  Issue 21  — toolReputationTracker.ts

Week 6:
  Issue 18  — wire constitutional gates into toolExecutor.ts
  Issue 19  — constitutional gate metrics + trust
  Issue 22  — toolExpirationManager.ts
```

**Estimated total new tables:** 6 (`task_run_outcomes`, `memory_lifecycle`, `memory_archive`, `policy_versions`, `plan_verifications`, `constitutional_gate_events`, `tool_reputation`)

**Estimated total new cron jobs:** 7

**Estimated total new endpoints:** ~10

**Estimated LLM cost increase:** ~$2–5/day (mostly from plan verification and policy replay evaluation, using economy-tier models)

# Glyphor Architecture Evolution — Tracks 7 & 8

## Durable Workflow Continuation + Hierarchical Executive Orchestration

**Prerequisite:** Tracks 1–6 (Learning Governor) should be in progress or complete. Track 8 specifically benefits from the task-tier outcome harvesting (Track 1) and plan verification (Track 2) being live, since you'll use that data to compare executive-orchestrated work against Sarah-orchestrated work.

**Track 7** solves the 180s Cloud Run timeout constraint for long-running workflows without adding infrastructure complexity. **Track 8** evolves Sarah from sole decomposer to router/synthesizer, enabling domain-qualified orchestration by executives.

```
Track 7 (Issues 23–26): Durable Workflow Continuation
  └─ Can be built independently

Track 8 (Issues 27–33): Hierarchical Executive Orchestration
  └─ Depends on Track 2 (plan verification) for safety
  └─ Benefits from Track 1 (outcome harvesting) for evaluation
  └─ Issue 33 (canary rollout) depends on Track 7 being available
```

---

## Track 7 — Durable Workflow Continuation

**Problem:** Cloud Run enforces a request-driven execution model with a 180s timeout on task-tier runs. Most agent work fits within this boundary because Sarah decomposes directives into atomic assignments. But several real workflow shapes can't be reliably decomposed into sub-180s units:

- Research-heavy runs that chain 8–10 web fetches with reasoning between each (common timeout cause)
- Sarah's orchestration turns on complex multi-assignment directives with pre-dispatch validation
- Future closed-loop code evolution: branch → write → deploy preview → test → evaluate → iterate
- Deep dives and strategy lab analyses where the coordination overhead of spawning/collecting temporary agents approaches the timeout
- Any workflow that needs to wait for an external signal (human approval, webhook, API callback)

**Non-goal:** This is not a migration to Temporal, Inngest, or Kubernetes. The implementation uses your existing Cloud Run + Cloud Tasks + PostgreSQL stack. No new infrastructure services.

**Core pattern:** A workflow is a sequence of **steps**, each step is a bounded Cloud Tasks dispatch (up to 10 minutes), and intermediate state is persisted to PostgreSQL between steps. If a step fails, it can be retried or the workflow can be resumed from the last successful step.

---

### Issue 23: Create `workflow_steps` table + workflow state machine types

**Labels:** `copilot`, `database`, `track-7`

**Description:**

Create migration `db/migrations/099_workflow_steps.sql` that adds the workflow orchestration tables.

```sql
-- A workflow is a multi-step process that spans multiple Cloud Tasks dispatches.
-- Each step runs as an independent Cloud Run request with its own timeout.
CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Classification
  workflow_type TEXT NOT NULL,  
    -- 'directive_orchestration' | 'research_chain' | 'deep_dive' | 
    -- 'strategy_lab' | 'code_evolution' | 'approval_wait' | 'custom'
  
  -- Ownership
  initiator_role TEXT NOT NULL,       -- agent that started the workflow
  directive_id UUID REFERENCES founder_directives(id),
  
  -- State
  status TEXT NOT NULL DEFAULT 'running',  
    -- 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'paused'
  current_step_index INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER,                -- null if dynamic (steps added during execution)
  
  -- Context carried across steps
  workflow_context JSONB NOT NULL DEFAULT '{}',  
    -- Accumulated state: research results, intermediate outputs, decisions made.
    -- Each step reads this, does work, and writes back updated context.
  
  -- Wait state (for approval_wait, webhook_wait)
  waiting_for TEXT,          -- 'human_approval' | 'webhook' | 'scheduled_time' | 'dependency'
  wait_reference TEXT,       -- decision_id, webhook_id, or ISO timestamp
  resume_at TIMESTAMPTZ,     -- for scheduled waits
  
  -- Observability
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflows_status ON workflows(status);
CREATE INDEX idx_workflows_initiator ON workflows(initiator_role);
CREATE INDEX idx_workflows_directive ON workflows(directive_id);
CREATE INDEX idx_workflows_waiting ON workflows(status, resume_at) WHERE status = 'waiting';

-- Individual steps within a workflow
CREATE TABLE IF NOT EXISTS workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  
  -- Step definition
  step_index INTEGER NOT NULL,
  step_type TEXT NOT NULL,  
    -- 'agent_run' | 'parallel_agents' | 'wait_approval' | 'wait_webhook' |
    -- 'wait_delay' | 'evaluate' | 'synthesize' | 'enqueue_subtasks'
  step_config JSONB NOT NULL,  
    -- Configuration depends on step_type:
    -- agent_run:       { agent_role, task, message, context_tier, timeout_ms }
    -- parallel_agents: { agents: [{ role, task, message }], max_concurrent }
    -- wait_approval:   { decision_id, timeout_hours }
    -- wait_webhook:    { webhook_id, timeout_hours }
    -- wait_delay:      { delay_minutes }
    -- evaluate:        { criteria, verifier_model }
    -- synthesize:      { source_steps: number[], output_format }
    -- enqueue_subtasks:{ assignments: [...] }
  
  -- State
  status TEXT NOT NULL DEFAULT 'pending',  
    -- 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting'
  
  -- Output
  output JSONB,              -- step result (agent output, evaluation score, etc.)
  error TEXT,
  
  -- Execution metadata
  cloud_task_id TEXT,        -- Cloud Tasks task name for tracking
  run_id UUID REFERENCES agent_runs(id),  -- if step_type = 'agent_run'
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  cost_usd NUMERIC(8,4) DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(workflow_id, step_index)
);

CREATE INDEX idx_workflow_steps_workflow ON workflow_steps(workflow_id);
CREATE INDEX idx_workflow_steps_status ON workflow_steps(status) WHERE status IN ('pending', 'running', 'waiting');
CREATE INDEX idx_workflow_steps_cloud_task ON workflow_steps(cloud_task_id);
```

Add both tables to `dashboardApi.ts` whitelist.

**TypeScript types** — create `packages/agent-runtime/src/workflowTypes.ts`:

```typescript
export type WorkflowType = 
  | 'directive_orchestration' 
  | 'research_chain' 
  | 'deep_dive' 
  | 'strategy_lab' 
  | 'code_evolution' 
  | 'approval_wait' 
  | 'custom';

export type WorkflowStatus = 
  | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'paused';

export type StepType = 
  | 'agent_run' | 'parallel_agents' | 'wait_approval' | 'wait_webhook' 
  | 'wait_delay' | 'evaluate' | 'synthesize' | 'enqueue_subtasks';

export type StepStatus = 
  | 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting';

export interface WorkflowDefinition {
  type: WorkflowType;
  initiator_role: string;
  directive_id?: string;
  initial_context: Record<string, unknown>;
  steps: StepDefinition[];
}

export interface StepDefinition {
  step_type: StepType;
  step_config: Record<string, unknown>;
  on_failure?: 'retry' | 'skip' | 'abort';  // default: 'retry'
}

export interface WorkflowState {
  id: string;
  status: WorkflowStatus;
  current_step_index: number;
  context: Record<string, unknown>;
  steps: Array<{
    index: number;
    type: StepType;
    status: StepStatus;
    output?: unknown;
    error?: string;
  }>;
}
```

**Acceptance criteria:**
- [ ] Migration runs cleanly against existing schema
- [ ] Both tables created with proper indexes and foreign keys
- [ ] TypeScript types exported from `workflowTypes.ts`
- [ ] Tables added to dashboard API whitelist

---

### Issue 24: Build `workflowOrchestrator.ts` — state machine + step dispatch

**Labels:** `copilot`, `agent-runtime`, `track-7`

**Description:**

Create `packages/agent-runtime/src/workflowOrchestrator.ts`. This is the core state machine that creates workflows, advances steps, handles waits, and manages retries.

**Public API:**

```typescript
export class WorkflowOrchestrator {
  constructor(private db: Pool, private queue: CloudTasksQueue) {}

  // Create and start a new workflow
  async startWorkflow(definition: WorkflowDefinition): Promise<string>; // returns workflow_id
  
  // Called when a step completes (from worker service)
  async advanceWorkflow(workflowId: string, stepIndex: number, result: StepResult): Promise<void>;
  
  // Called when a step fails
  async handleStepFailure(workflowId: string, stepIndex: number, error: string): Promise<void>;
  
  // Called by heartbeat to check waiting workflows
  async checkWaitingWorkflows(): Promise<number>; // returns count resumed
  
  // Cancel a workflow
  async cancelWorkflow(workflowId: string, reason: string): Promise<void>;
  
  // Get current state (for dashboard)
  async getWorkflowState(workflowId: string): Promise<WorkflowState>;
}
```

**`startWorkflow()` implementation:**

```typescript
async startWorkflow(definition: WorkflowDefinition): Promise<string> {
  // 1. INSERT into workflows table
  // 2. INSERT all step definitions into workflow_steps (status = 'pending')
  // 3. Dispatch step 0 via Cloud Tasks:
  //    - Queue: agent-runs-priority (workflows get priority queue)
  //    - Payload: { workflow_id, step_index: 0, step_config, workflow_context }
  //    - Timeout: step_config.timeout_ms || 300000 (5 min default)
  // 4. UPDATE workflow_steps[0].status = 'running', cloud_task_id = taskName
  // 5. Return workflow_id
}
```

**`advanceWorkflow()` implementation:**

```typescript
async advanceWorkflow(workflowId: string, stepIndex: number, result: StepResult): Promise<void> {
  // 1. UPDATE workflow_steps[stepIndex]: status='completed', output=result.output,
  //    duration_ms, cost_usd, run_id
  
  // 2. Merge step output into workflow_context:
  //    workflow_context = { ...current_context, [`step_${stepIndex}_output`]: result.output }
  //    UPDATE workflows SET workflow_context, current_step_index = stepIndex + 1
  
  // 3. Determine next step:
  //    a. If stepIndex + 1 >= total_steps → workflow complete
  //       UPDATE workflows SET status='completed', completed_at=NOW()
  //       Emit 'workflow.completed' event
  //
  //    b. If next step is a wait type:
  //       UPDATE workflows SET status='waiting', waiting_for=..., wait_reference=...
  //       UPDATE workflow_steps[next].status = 'waiting'
  //       (heartbeat will check and resume when condition is met)
  //
  //    c. If next step is agent_run or parallel_agents:
  //       Dispatch via Cloud Tasks with updated workflow_context
  //       UPDATE workflow_steps[next].status = 'running'
  //
  //    d. If next step is evaluate or synthesize:
  //       Dispatch as agent_run with evaluation/synthesis prompt
}
```

**`handleStepFailure()` implementation:**

```typescript
async handleStepFailure(workflowId: string, stepIndex: number, error: string): Promise<void> {
  const step = await this.getStep(workflowId, stepIndex);
  const workflow = await this.getWorkflow(workflowId);
  
  // Check retry policy
  if (step.retry_count < workflow.max_retries) {
    // Retry: re-dispatch with exponential backoff
    const delay = Math.pow(2, step.retry_count) * 30; // 30s, 60s, 120s
    // UPDATE workflow_steps: retry_count++
    // Enqueue Cloud Task with scheduleTime = now + delay
  } else {
    // Check step's on_failure policy from step_config
    const policy = step.step_config.on_failure || 'retry';
    
    if (policy === 'skip') {
      // Mark step as skipped, advance to next
      await this.advanceWorkflow(workflowId, stepIndex, { output: null, skipped: true });
    } else {
      // Abort workflow
      // UPDATE workflows SET status='failed', error
      // UPDATE remaining pending steps SET status='skipped'
      // Emit 'workflow.failed' event
      // Notify initiator agent via send_agent_message
    }
  }
}
```

**`checkWaitingWorkflows()` — called by heartbeat:**

```typescript
async checkWaitingWorkflows(): Promise<number> {
  // Query: SELECT * FROM workflows WHERE status = 'waiting'
  
  let resumed = 0;
  for (const workflow of waiting) {
    let shouldResume = false;
    
    switch (workflow.waiting_for) {
      case 'human_approval':
        // Check decisions table for the wait_reference decision_id
        // If status = 'approved' or 'rejected' → resume
        const decision = await this.db.query(
          'SELECT status FROM decisions WHERE id = $1', [workflow.wait_reference]);
        shouldResume = decision.rows[0]?.status !== 'pending';
        break;
        
      case 'scheduled_time':
        shouldResume = new Date() >= new Date(workflow.resume_at);
        break;
        
      case 'dependency':
        // Check if the referenced workflow/assignment has completed
        const dep = await this.db.query(
          'SELECT status FROM workflows WHERE id = $1', [workflow.wait_reference]);
        shouldResume = dep.rows[0]?.status === 'completed';
        break;
        
      case 'webhook':
        // Check a webhook_events table or similar for the reference
        // (implement when webhook waits are needed)
        break;
    }
    
    if (shouldResume) {
      // UPDATE workflows SET status = 'running'
      // Advance to next step
      const nextIndex = workflow.current_step_index;
      // Dispatch next step via Cloud Tasks
      resumed++;
    }
    
    // Timeout check: if waiting > 48 hours, fail the workflow
    if (Date.now() - workflow.updated_at.getTime() > 48 * 60 * 60 * 1000) {
      await this.handleStepFailure(workflow.id, workflow.current_step_index, 'Wait timeout exceeded (48h)');
    }
  }
  
  return resumed;
}
```

**Parallel agents step handler:**

When `step_type = 'parallel_agents'`, dispatch multiple Cloud Tasks simultaneously:

```typescript
async dispatchParallelStep(workflowId: string, stepIndex: number, config: ParallelConfig, context: Record<string, unknown>): Promise<void> {
  // For each agent in config.agents (max config.max_concurrent):
  //   - Enqueue a Cloud Task to agent-runs queue
  //   - Payload includes: workflow_id, step_index, sub_index, agent config, context
  //
  // Track sub-step completion via a counter:
  //   workflow_steps.output = { completed: 0, total: N, results: {} }
  //
  // Each sub-completion calls a method that increments the counter
  // and checks if all sub-steps are done. When all complete,
  // call advanceWorkflow() to move to the next step.
}
```

**Acceptance criteria:**
- [ ] `startWorkflow()` creates DB records and dispatches first step via Cloud Tasks
- [ ] `advanceWorkflow()` correctly transitions between step types
- [ ] Wait states are persisted and resumed by heartbeat checks
- [ ] Failures trigger retry with exponential backoff, then skip or abort per policy
- [ ] Parallel agent steps dispatch concurrently and collect results
- [ ] 48-hour timeout on waiting workflows
- [ ] All state changes update the `workflows` and `workflow_steps` tables

---

### Issue 25: Wire workflow orchestrator into existing engines + heartbeat

**Labels:** `copilot`, `scheduler`, `track-7`

**Description:**

Integrate the workflow orchestrator into three existing systems: the heartbeat, the worker service, and the deep dive / strategy lab engines.

**1. Heartbeat integration (`packages/scheduler/src/heartbeat.ts`):**

Add a new phase to the heartbeat cycle, after PHASE 3 (DISPATCH):

```typescript
// PHASE 4: CHECK WAITING WORKFLOWS
//
// Every heartbeat cycle (10 min), check for workflows that can be resumed.
// This is lightweight — just DB queries against the waiting_for conditions.

const workflowOrchestrator = new WorkflowOrchestrator(db, cloudTasksQueue);
const resumed = await workflowOrchestrator.checkWaitingWorkflows();
if (resumed > 0) {
  console.log(`Heartbeat: resumed ${resumed} waiting workflows`);
}
```

**2. Worker service integration (`packages/worker/src/index.ts`):**

Extend the `POST /run` handler to detect workflow step payloads:

```typescript
// In the /run handler, check for workflow metadata in the payload:
if (payload.workflow_id && payload.step_index !== undefined) {
  try {
    // Execute the step (agent run, evaluation, synthesis, etc.)
    const result = await executeWorkflowStep(payload);
    
    // Report completion back to the orchestrator
    await workflowOrchestrator.advanceWorkflow(
      payload.workflow_id, 
      payload.step_index, 
      result
    );
  } catch (error) {
    await workflowOrchestrator.handleStepFailure(
      payload.workflow_id, 
      payload.step_index, 
      error.message
    );
  }
  return;
}

// ... existing non-workflow run handling
```

Add a new endpoint for parallel step sub-completions:

```typescript
// POST /workflow/step-complete
// Called when a sub-task of a parallel step completes
app.post('/workflow/step-complete', async (req, res) => {
  const { workflow_id, step_index, sub_index, result } = req.body;
  await workflowOrchestrator.recordParallelSubCompletion(
    workflow_id, step_index, sub_index, result
  );
  res.sendStatus(200);
});
```

**3. Deep Dive Engine migration (`packages/scheduler/src/deepDiveEngine.ts`):**

Refactor the deep dive engine to optionally use workflows for deep dives that are expected to exceed 180s. The heuristic: if depth = 'deep' or the query involves > 3 research areas, use a workflow.

```typescript
// In DeepDiveEngine.runDeepDive():

if (depth === 'deep' || researchAreas.length > 3) {
  // Use workflow-based execution
  const workflowId = await workflowOrchestrator.startWorkflow({
    type: 'deep_dive',
    initiator_role: 'chief-of-staff',
    directive_id: directiveId,
    initial_context: { query, depth, target, researchAreas },
    steps: [
      { step_type: 'agent_run', step_config: {
          agent_role: 'vp-research', task: 'scope',
          message: `Scope deep dive: ${query}`, timeout_ms: 300000
      }},
      { step_type: 'parallel_agents', step_config: {
          agents: researchAreas.map(area => ({
            role: selectAnalyst(area), task: 'research', message: `Research: ${area}`
          })),
          max_concurrent: 5
      }},
      { step_type: 'agent_run', step_config: {
          agent_role: 'vp-research', task: 'synthesize',
          message: 'Synthesize research findings into deep dive report',
          timeout_ms: 300000
      }},
      { step_type: 'evaluate', step_config: {
          criteria: 'evidence_coverage, actionability, confidence',
          verifier_model: 'claude-opus-4-6'
      }}
    ]
  });
  
  // Return workflow_id — dashboard polls for completion
  return { workflow_id: workflowId, status: 'workflow_started' };
} else {
  // Use existing single-request execution for quick/standard depth
  // ... existing code
}
```

**4. Strategy Lab Engine migration (`packages/scheduler/src/strategyLabEngine.ts`):**

Same pattern — use workflows for multi-wave analyses. The three-layer architecture (Research → Analysis → Synthesis) maps naturally to workflow steps.

**5. Add scheduler endpoints:**

```typescript
// GET /workflows          — list workflows (filterable by status, type)
// GET /workflows/:id      — get workflow state + steps
// POST /workflows/:id/cancel — cancel a running workflow
// POST /workflows/:id/retry  — retry a failed workflow from last failed step
```

**Acceptance criteria:**
- [ ] Heartbeat checks waiting workflows every 10 minutes
- [ ] Worker service handles workflow step payloads and reports completion/failure
- [ ] Deep dive engine uses workflows for deep/complex analyses
- [ ] Strategy lab engine uses workflows for multi-wave analyses
- [ ] Quick/standard analyses continue using the existing single-request path
- [ ] Scheduler exposes workflow management endpoints
- [ ] Parallel step sub-completions are tracked correctly

---

### Issue 26: Workflow monitoring dashboard

**Labels:** `copilot`, `dashboard`, `track-7`

**Description:**

Add workflow visibility to the dashboard. This can be integrated into the existing Strategy.tsx page (for analysis workflows) and a new Workflows section in Operations.tsx (for all workflow types).

**Operations.tsx — "Active Workflows" section:**

1. **Running workflows table:**
   - Columns: type, initiator, directive title, current step (e.g., "3/5"), status, started_at, elapsed time
   - Row click expands to show step-by-step progress with status icons:
     ✅ completed, 🔄 running, ⏳ waiting, ⏸ pending, ❌ failed, ⏭ skipped
   - Each step shows: type, agent(s), duration, cost, output summary (truncated)

2. **Waiting workflows highlight:**
   - Prominent card showing workflows waiting for human approval
   - "Waiting for: Decision #abc — approve pricing change" with link to Approvals page
   - Time waiting counter

3. **Workflow metrics (last 30 days):**
   - Total workflows started, completed, failed
   - Average completion time by workflow type
   - Most common failure step types
   - Cost per workflow type

4. **Controls:**
   - "Cancel" button on running/waiting workflows
   - "Retry" button on failed workflows (retries from last failed step)

**Strategy.tsx integration:**

When a deep dive or strategy lab analysis is backed by a workflow, show the workflow step progress inline instead of the existing phase indicator. Replace the simple "Phase 2 of 4" text with the step-by-step view from above.

**Data source:** Query `workflows` and `workflow_steps` tables via `dashboardApi.ts`. Poll every 10 seconds for running workflows (use the existing `useInterval` pattern from other dashboard pages).

**Acceptance criteria:**
- [ ] Active workflows table shows all running and waiting workflows
- [ ] Step-by-step progress view works with status icons
- [ ] Waiting workflows are highlighted with approval links
- [ ] Metrics card shows 30-day workflow trends
- [ ] Cancel and retry buttons work
- [ ] Strategy page shows workflow progress for workflow-backed analyses
- [ ] Auto-refresh every 10 seconds for active workflows

---

## Track 8 — Hierarchical Executive Orchestration

**Problem:** Sarah is the single point of decomposition, evaluation, and synthesis for every founder directive. This creates three compounding issues: cognitive overload as directive volume grows (shallower decompositions per directive), domain expertise mismatch (generalist orchestrator making specialist decomposition decisions), and serial bottleneck (all directives queue behind Sarah's orchestration cycle). The ~40% timeout rate on task-tier runs is partly a symptom of decompositions that aren't domain-qualified.

**Goal:** Evolve Sarah from sole decomposer to router and cross-domain synthesizer. Domain executives decompose and evaluate work within their departments, because they understand the domain, the team's tools, and what good output looks like.

**Rollout strategy:** Canary with Engineering (Marcus/CTO) first. Compare outcomes against Sarah-orchestrated engineering work for 2–4 weeks before expanding to other departments.

---

### Issue 27: Add sub-directive data model

**Labels:** `copilot`, `database`, `track-8`

**Description:**

Create migration `db/migrations/100_sub_directives.sql` that extends `founder_directives` and `work_assignments` to support hierarchical delegation.

```sql
-- Add delegation fields to founder_directives
ALTER TABLE founder_directives 
  ADD COLUMN IF NOT EXISTS parent_directive_id UUID REFERENCES founder_directives(id),
  ADD COLUMN IF NOT EXISTS delegated_to TEXT,     -- executive agent_role who owns decomposition
  ADD COLUMN IF NOT EXISTS delegation_type TEXT,   -- 'full' (exec decomposes+evaluates) | 'decompose_only' (exec decomposes, Sarah evaluates)
  ADD COLUMN IF NOT EXISTS delegated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delegation_context TEXT; -- instructions from Sarah to the executive about intent/constraints

CREATE INDEX IF NOT EXISTS idx_directives_parent ON founder_directives(parent_directive_id);
CREATE INDEX IF NOT EXISTS idx_directives_delegated ON founder_directives(delegated_to) WHERE delegated_to IS NOT NULL;

-- Track which executive created which assignments (currently implicitly Sarah)
ALTER TABLE work_assignments
  ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'chief-of-staff';  -- agent_role who created the assignment

-- Executive orchestration permissions
CREATE TABLE IF NOT EXISTS executive_orchestration_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  executive_role TEXT NOT NULL UNIQUE,
  
  -- What this executive can do
  can_decompose BOOLEAN NOT NULL DEFAULT false,       -- can create assignments for their team
  can_evaluate BOOLEAN NOT NULL DEFAULT false,         -- can accept/revise their team's outputs
  can_create_sub_directives BOOLEAN NOT NULL DEFAULT false,  -- can delegate further
  
  -- Scope constraints
  allowed_assignees TEXT[] NOT NULL,    -- agent roles this exec can assign to
  max_assignments_per_directive INTEGER NOT NULL DEFAULT 10,
  requires_plan_verification BOOLEAN NOT NULL DEFAULT true,
  
  -- Canary state
  is_canary BOOLEAN NOT NULL DEFAULT false,  -- enabled for canary testing
  canary_started_at TIMESTAMPTZ,
  canary_directive_count INTEGER NOT NULL DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: only CTO enabled for canary initially
INSERT INTO executive_orchestration_config 
  (executive_role, can_decompose, can_evaluate, can_create_sub_directives, allowed_assignees, is_canary)
VALUES 
  ('cto', true, true, false, 
   ARRAY['platform-engineer', 'quality-engineer', 'devops-engineer', 'm365-admin'],
   true)
ON CONFLICT (executive_role) DO NOTHING;
```

Add `executive_orchestration_config` to `dashboardApi.ts` whitelist.

**Acceptance criteria:**
- [ ] Migration runs cleanly
- [ ] `founder_directives` supports parent-child relationships
- [ ] `work_assignments` tracks who created each assignment
- [ ] Config table exists with CTO seeded as canary
- [ ] Allowed assignees match the org chart (CTO can only assign to their reports)

---

### Issue 28: Build `domainRouter.ts` — Sarah's directive classification + routing

**Labels:** `copilot`, `agents`, `track-8`

**Description:**

Create `packages/agents/src/chief-of-staff/domainRouter.ts`. This module classifies directives by domain and determines whether to self-orchestrate or delegate to a domain executive.

**Interface:**

```typescript
export interface RoutingDecision {
  strategy: 'self_orchestrate' | 'delegate_single' | 'delegate_multi';
  
  // For delegate_single: one executive owns the entire directive
  primary_delegate?: {
    executive_role: string;
    delegation_type: 'full' | 'decompose_only';
    context: string;  // instructions from Sarah to the executive
  };
  
  // For delegate_multi: cross-domain directive split into sub-directives
  sub_directives?: Array<{
    executive_role: string;
    delegation_type: 'full' | 'decompose_only';
    scope: string;       // what this exec is responsible for
    context: string;     // instructions and constraints
    dependencies?: string[];  // other exec roles whose output this depends on
  }>;
  
  reasoning: string;  // why this routing was chosen
}

export async function routeDirective(
  db: Pool,
  directive: FounderDirective,
  orchestrationConfig: Map<string, ExecutiveOrchestrationConfig>
): Promise<RoutingDecision>
```

**Routing logic — two phases:**

```typescript
// PHASE 1: DETERMINISTIC CLASSIFICATION (no LLM)
//
// Map directive keywords and target_agents to departments:
//
// Engineering signals:  'deploy', 'build', 'code', 'github', 'CI/CD', 'infrastructure',
//                       'migration', 'bug', 'test', or target_agents include CTO team members
// Marketing signals:    'content', 'social', 'SEO', 'campaign', 'brand', 'launch',
//                       or target_agents include CMO team members
// Finance signals:      'cost', 'revenue', 'budget', 'billing', 'pricing', 'margin',
//                       or target_agents include CFO team members
// Product signals:      'roadmap', 'feature', 'usage', 'competitive', 'user research',
//                       or target_agents include CPO team members
// Sales signals:        'pipeline', 'lead', 'enterprise', 'proposal', 'account',
//                       or target_agents include VP Sales team members
// CS signals:           'churn', 'onboarding', 'health score', 'customer',
//                       or target_agents include VP CS team members
// Design signals:       'design', 'UI', 'UX', 'frontend', 'component', 'template',
//                       or target_agents include VP Design team members
// Research signals:     'research', 'analysis', 'market', 'competitive landscape',
//                       or target_agents include VP Research team members
// Legal signals:        'compliance', 'contract', 'IP', 'tax', 'regulation',
//                       or target_agents include CLO team members
//
// Count signals per department. If one department has > 60% of signals → single domain.
// If two departments each have > 25% → cross-domain.
// If no clear winner → Sarah self-orchestrates.

// PHASE 2: CHECK EXECUTIVE AVAILABILITY (no LLM)
//
// For each candidate executive:
//   - Is the executive's role in orchestrationConfig with can_decompose = true?
//   - Is the executive currently overloaded? (> 5 active delegated directives)
//   - For canary execs (is_canary = true): check canary_directive_count < 20
//     (safety cap during canary period)
//
// If the target executive isn't enabled or is overloaded → fall back to self_orchestrate.

// PHASE 3: DETERMINE DELEGATION TYPE
//
// 'full' delegation:      exec decomposes AND evaluates their team's output
//   → Used when: exec has can_evaluate = true AND directive priority != 'critical'
//
// 'decompose_only':       exec decomposes, Sarah still evaluates outputs
//   → Used when: priority = 'critical' OR exec doesn't have can_evaluate
//
// For cross-domain: each sub-directive gets its own delegation_type.
// Sarah always handles the final cross-domain synthesis.
```

**Important:** This module does NOT use an LLM call. It's a deterministic classifier using keyword matching and configuration checks. The LLM reasoning about how to decompose happens in the executive's own orchestration run, where they have domain expertise.

**Acceptance criteria:**
- [ ] Classifies directives into single-domain, cross-domain, or self-orchestrate
- [ ] Checks executive orchestration config before delegating
- [ ] Respects canary caps (max 20 directives during canary)
- [ ] Overload protection (max 5 active delegated directives per exec)
- [ ] Zero LLM calls — purely deterministic routing
- [ ] Falls back to self-orchestrate when delegation isn't available

---

### Issue 29: Build executive orchestration tools

**Labels:** `copilot`, `agents`, `track-8`

**Description:**

Create `packages/agents/src/shared/executiveOrchestrationTools.ts`. These tools give executives the ability to decompose work within their department scope.

**Tools:**

```typescript
export function createExecutiveOrchestrationTools(
  db: Pool,
  agentRole: string,
  glyphorEventBus: GlyphorEventBus,
  orchestrationConfig: ExecutiveOrchestrationConfig
): ToolDefinition[] {
  return [
    // 1. CREATE TEAM ASSIGNMENTS
    {
      name: 'create_team_assignments',
      description: 'Create work assignments for agents on your team. ' +
        'You can only assign work to agents you manage.',
      parameters: {
        directive_id: { type: 'string', description: 'The directive or sub-directive ID' },
        assignments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              assigned_to: { type: 'string', description: 'Agent role (must be on your team)' },
              task_description: { type: 'string' },
              expected_output: { type: 'string' },
              depends_on: { type: 'array', items: { type: 'string' }, description: 'Assignment IDs this depends on' },
              sequence_order: { type: 'number' }
            }
          }
        }
      },
      execute: async (params) => {
        // VALIDATION:
        // 1. Verify each assigned_to is in orchestrationConfig.allowed_assignees
        //    → Reject with clear error if exec tries to assign outside their team
        // 2. Verify total assignments <= max_assignments_per_directive
        // 3. Verify directive_id exists and is delegated to this executive
        
        // CREATE ASSIGNMENTS:
        // INSERT into work_assignments with created_by = agentRole
        // Run plan verification if orchestrationConfig.requires_plan_verification = true
        //   → If planVerifier returns 'REVISE', return the feedback to the executive
        //   → If 'APPROVE' or 'WARN', proceed
        
        // EMIT EVENT:
        // emit 'assignment.created' event so heartbeat picks up the new work
        
        return { created: assignments.length, verification_result: '...' };
      }
    },
    
    // 2. EVALUATE TEAM OUTPUT
    {
      name: 'evaluate_team_output',
      description: 'Review and accept or revise a completed assignment from your team.',
      parameters: {
        assignment_id: { type: 'string' },
        verdict: { type: 'string', enum: ['accept', 'revise'] },
        feedback: { type: 'string', description: 'Required if verdict is revise' },
        quality_score: { type: 'number', min: 1, max: 5 }
      },
      execute: async (params) => {
        // VALIDATION:
        // 1. Verify assignment exists and was created_by this executive
        // 2. Verify assignment status is 'submitted' (agent completed their work)
        // 3. Only available if orchestrationConfig.can_evaluate = true
        
        // ACCEPT:
        // UPDATE work_assignments SET status = 'completed', 
        //   evaluation = params.feedback, quality_score = params.quality_score
        // Trigger dependency resolution (same as existing submit_assignment_output)
        
        // REVISE:
        // UPDATE work_assignments SET status = 'needs_revision',
        //   evaluation = params.feedback
        // Wake the assigned agent via event
        // Update task_run_outcomes.was_revised = true (Track 1 integration)
        
        return { assignment_id, verdict, feedback };
      }
    },
    
    // 3. CHECK TEAM STATUS
    {
      name: 'check_team_status',
      description: 'Check the status of assignments you have created for your team.',
      parameters: {
        directive_id: { type: 'string', description: 'Optional — filter by directive' }
      },
      execute: async (params) => {
        // Query work_assignments WHERE created_by = agentRole
        //   AND optionally filtered by directive_id
        // Return: per-assignment status, agent, completion %, quality scores
        // Also return: aggregate stats (total, completed, in_progress, blocked)
        
        return { assignments: [...], summary: { ... } };
      }
    },
    
    // 4. SYNTHESIZE TEAM DELIVERABLE
    {
      name: 'synthesize_team_deliverable',
      description: 'Compile completed team assignments into a department deliverable for the directive.',
      parameters: {
        directive_id: { type: 'string' },
        synthesis_notes: { type: 'string', description: 'Your executive summary and recommendations' }
      },
      execute: async (params) => {
        // Collect all completed assignment outputs for this directive
        // created_by = agentRole
        
        // UPDATE the sub-directive (if delegated) with the synthesis
        // OR submit to Sarah as a completed deliverable
        
        // Emit 'assignment.submitted' event for Sarah to pick up
        
        return { directive_id, status: 'synthesized', output_summary: '...' };
      }
    }
  ];
}
```

**Scope enforcement is critical.** Every tool call must verify that the executive is only operating on agents in their `allowed_assignees` list and on directives delegated to them. This is the main safety mechanism preventing executives from stepping outside their authority boundary.

**Acceptance criteria:**
- [ ] All 4 tools implemented with scope validation
- [ ] `create_team_assignments` rejects assignments to agents outside the exec's team
- [ ] `evaluate_team_output` only works on assignments the exec created
- [ ] Plan verification runs on exec-created assignments when configured
- [ ] Events emitted correctly for heartbeat pickup and Sarah notification
- [ ] Quality scores from `evaluate_team_output` feed into Track 1 outcome harvesting

---

### Issue 30: Update executive system prompts for orchestration mode

**Labels:** `copilot`, `agents`, `track-8`

**Description:**

When an executive receives a delegated directive, their system prompt needs orchestration-mode context. This is additive — their existing personality, tools, and domain knowledge remain unchanged.

**Changes to `packages/agent-runtime/src/companyAgentRunner.ts`:**

In the system prompt build phase (step 3), detect if the agent has orchestration capabilities enabled and if the current run involves a delegated directive:

```typescript
// After building the standard system prompt layers:

if (orchestrationConfig?.can_decompose && taskInvolvesDelegatedDirective) {
  // Inject EXECUTIVE ORCHESTRATION PROTOCOL between the existing
  // REASONING_PROTOCOL and ACTION_HONESTY_PROTOCOL
  
  systemPromptSections.push(buildExecutiveOrchestrationProtocol(
    agentRole, 
    orchestrationConfig
  ));
}
```

**`buildExecutiveOrchestrationProtocol()` — new function in `companyAgentRunner.ts`:**

```typescript
function buildExecutiveOrchestrationProtocol(
  role: string,
  config: ExecutiveOrchestrationConfig
): string {
  return `
## EXECUTIVE ORCHESTRATION PROTOCOL

You have been delegated a directive by Sarah (Chief of Staff). As the domain expert
for this work, you are responsible for decomposing it into assignments for your team.

YOUR TEAM (you can ONLY assign work to these agents):
${config.allowed_assignees.map(a => `- ${a}`).join('\n')}

DECOMPOSITION RULES:
1. Each assignment must be atomic — one clear task with one clear deliverable.
2. Each assignment must contain ALL context the agent needs. Your team members run
   with minimal ~150-line system prompts and no access to the knowledge base.
   Embed the "why", the data, the constraints, and the expected format.
3. Check tool requirements — use check_team_status to verify agents have the tools
   they need. If not, coordinate with Sarah to grant access.
4. Set dependencies correctly — if Assignment B needs output from Assignment A,
   specify depends_on so they execute in the right order.
5. Max ${config.max_assignments_per_directive} assignments per directive.

EVALUATION RULES:
${config.can_evaluate ? `
- Review each completed assignment for domain quality, not just completeness.
- Accept first-time if the work is genuinely good. Don't revise for style preferences.
- When revising, give specific, actionable feedback — not "try again" or "make it better."
- After all assignments complete, synthesize a department deliverable for Sarah.
` : `
- Sarah will evaluate your team's outputs. Focus on decomposition quality.
`}

NEVER:
- Assign work to agents outside your team
- Modify another department's assignments or outputs
- Skip the synthesis step — Sarah needs a coherent deliverable, not raw fragments
`;
}
```

**Changes to each executive's `systemPrompt.ts`:**

No changes needed to the static system prompts. The orchestration protocol is injected dynamically only when a delegated directive is in context. This keeps the executive's normal operating mode (scheduled tasks, proactive work, DMs) completely unchanged.

**Changes to each executive's `tools.ts`:**

Conditionally include orchestration tools:

```typescript
// In the executive's tools.ts (e.g., cto/tools.ts):

export function getTools(deps: RunDeps): ToolDefinition[] {
  const tools = [
    // ... existing tools (get_file_contents, create_or_update_file, etc.)
  ];
  
  // Add orchestration tools if enabled
  if (deps.orchestrationConfig?.can_decompose) {
    tools.push(
      ...createExecutiveOrchestrationTools(
        deps.db, deps.agentRole, deps.glyphorEventBus, deps.orchestrationConfig
      )
    );
  }
  
  return tools;
}
```

**Acceptance criteria:**
- [ ] Orchestration protocol injected only when processing a delegated directive
- [ ] Normal executive operation (scheduled tasks, chat, proactive) is completely unaffected
- [ ] Team member list in the protocol matches the config's allowed_assignees
- [ ] Orchestration tools conditionally included based on config
- [ ] Protocol clearly communicates the context-embedding requirement for task-tier agents

---

### Issue 31: Update Sarah's orchestration flow for delegation

**Labels:** `copilot`, `agents`, `track-8`

**Description:**

Modify Sarah's orchestration flow in `packages/agents/src/chief-of-staff/run.ts` and `systemPrompt.ts` to use the domain router and handle delegated work.

**Changes to `chief-of-staff/systemPrompt.ts`:**

Update the `ORCHESTRATION_PROMPT` to include delegation logic after the existing 5 checks:

```
## DELEGATION PROTOCOL (after pre-dispatch checks)

Before decomposing a directive yourself, check if it should be delegated
to a domain executive:

1. CLASSIFY the directive's primary domain(s).
2. CHECK if the domain executive has orchestration capability enabled
   (use your knowledge of the executive_orchestration_config).
3. DELEGATE if:
   - The directive is clearly within one department's domain
   - The domain executive is enabled and not overloaded
   - The directive priority is not 'critical' (critical stays with you)
4. For CROSS-DOMAIN directives:
   - Create sub-directives, one per domain
   - Delegate each sub-directive to the relevant executive
   - You own the cross-domain synthesis after all sub-directives complete

When delegating:
- Create a sub-directive (parent_directive_id = original directive ID)
- Set delegated_to = executive role
- Include delegation_context with:
  - The founder's original intent
  - Any constraints or priorities
  - What the final deliverable should look like
  - Dependencies on other departments' work

When a delegated sub-directive is completed:
- The executive submits a synthesized department deliverable
- You review it for cross-domain coherence (not domain quality — trust the expert)
- Compile all department deliverables into the final founder-facing output
```

**Changes to `chief-of-staff/run.ts`:**

Add a `delegate_directive` tool to Sarah's tools:

```typescript
{
  name: 'delegate_directive',
  description: 'Delegate a directive or create a sub-directive for a domain executive.',
  parameters: {
    original_directive_id: { type: 'string' },
    delegated_to: { type: 'string', description: 'Executive agent role' },
    delegation_type: { type: 'string', enum: ['full', 'decompose_only'] },
    scope: { type: 'string', description: 'What the executive is responsible for' },
    context: { type: 'string', description: 'Instructions and constraints for the executive' }
  },
  execute: async (params) => {
    // 1. Verify delegated_to is in executive_orchestration_config with can_decompose = true
    
    // 2. Create sub-directive:
    //    INSERT founder_directives (
    //      parent_directive_id = params.original_directive_id,
    //      delegated_to = params.delegated_to,
    //      delegation_type = params.delegation_type,
    //      delegation_context = params.context,
    //      title = `[${params.delegated_to.toUpperCase()}] ${originalDirective.title}`,
    //      description = params.scope,
    //      priority = originalDirective.priority,
    //      status = 'active',
    //      delegated_at = NOW()
    //    )
    
    // 3. Increment canary_directive_count if is_canary = true
    
    // 4. Send message to executive:
    //    send_agent_message to delegated_to with:
    //    "New directive delegated to you: {title}. {context}. 
    //     Use create_team_assignments to decompose this for your team."
    
    // 5. Wake the executive via event (immediate priority)
    
    // 6. Emit 'directive.delegated' event
    
    return { sub_directive_id, delegated_to, delegation_type };
  }
}
```

**Changes to heartbeat directive detection:**

Currently, the heartbeat wakes Sarah when it detects new directives with zero work assignments. Extend this to also wake executives when they have delegated sub-directives with zero assignments:

```typescript
// In heartbeat.ts, add executive directive detection:
//
// For each executive in executive_orchestration_config WHERE can_decompose = true:
//   Query founder_directives WHERE delegated_to = executive_role
//     AND status = 'active'
//     AND (SELECT COUNT(*) FROM work_assignments WHERE directive_id = fd.id) = 0
//   If found → wake the executive with task = 'orchestrate'
```

**Acceptance criteria:**
- [ ] Sarah's prompt includes delegation logic
- [ ] `delegate_directive` tool creates sub-directives correctly
- [ ] Sub-directives maintain parent-child relationship
- [ ] Executives are woken when they have undiscovered delegated directives
- [ ] Canary directive count is tracked
- [ ] Critical-priority directives are never delegated (Sarah handles them directly)

---

### Issue 32: Build delegation monitoring + comparison metrics

**Labels:** `copilot`, `dashboard`, `track-8`

**Description:**

Add delegation visibility to the dashboard and build the comparison metrics needed to evaluate the canary.

**Create migration `db/migrations/101_delegation_metrics.sql`:**

```sql
-- Materialized view for delegation performance comparison
-- Refreshed by batch outcome evaluator (Track 1)
CREATE MATERIALIZED VIEW IF NOT EXISTS delegation_performance AS
SELECT
  wa.created_by,
  CASE WHEN wa.created_by = 'chief-of-staff' THEN 'sarah' ELSE 'executive' END AS orchestrator_type,
  wa.created_by AS orchestrator_role,
  COUNT(*) AS total_assignments,
  COUNT(*) FILTER (WHERE wa.status = 'completed') AS completed,
  COUNT(*) FILTER (WHERE wa.status = 'needs_revision') AS revised,
  COUNT(*) FILTER (WHERE wa.status = 'blocked') AS blocked,
  AVG(tro.batch_quality_score) FILTER (WHERE tro.batch_quality_score IS NOT NULL) AS avg_quality,
  AVG(tro.turn_count) AS avg_turns,
  AVG(tro.elapsed_ms) AS avg_elapsed_ms,
  AVG(tro.cost_usd) AS avg_cost,
  COUNT(*) FILTER (WHERE tro.was_revised = true)::FLOAT / NULLIF(COUNT(*), 0) AS revision_rate,
  COUNT(*) FILTER (WHERE tro.was_accepted = true AND tro.revision_count = 0)::FLOAT 
    / NULLIF(COUNT(*) FILTER (WHERE tro.was_accepted IS NOT NULL), 0) AS first_time_accept_rate,
  COUNT(*) FILTER (WHERE tro.final_status IN ('aborted', 'failed'))::FLOAT 
    / NULLIF(COUNT(*), 0) AS failure_rate
FROM work_assignments wa
LEFT JOIN task_run_outcomes tro ON tro.assignment_id = wa.id
WHERE wa.created_at > NOW() - INTERVAL '30 days'
GROUP BY wa.created_by;

CREATE UNIQUE INDEX idx_delegation_perf_role ON delegation_performance(orchestrator_role);

-- Refresh function (called by batch evaluator)
CREATE OR REPLACE FUNCTION refresh_delegation_metrics() RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY delegation_performance;
END;
$$ LANGUAGE plpgsql;
```

**Dashboard — Directives.tsx additions:**

1. **Delegation indicator** on each directive:
   - Badge showing "Delegated to CTO" or "Self-orchestrated" or "Cross-domain (3 departments)"
   - For delegated directives: show the sub-directive tree with status of each

2. **Delegation flow visualization:**
   - Simple tree: Directive → Sub-directives → Assignments
   - Color-coded by status (green=complete, yellow=in-progress, red=blocked/failed)

**Dashboard — new "Delegation" tab on Operations.tsx or Strategy.tsx:**

1. **Canary Comparison Card** (the most important metric):
   - Side-by-side comparison table:

   | Metric | Sarah-Orchestrated | Executive-Orchestrated |
   |--------|-------------------|----------------------|
   | First-time accept rate | X% | Y% |
   | Revision rate | X% | Y% |
   | Failure rate | X% | Y% |
   | Avg quality score | X.X | Y.X |
   | Avg cost per assignment | $X.XX | $Y.XX |
   | Avg turns per assignment | X | Y |

   - Highlight cells where executive orchestration outperforms (green) or underperforms (red)
   - Show sample sizes for statistical confidence

2. **Executive Orchestration Config:**
   - Table showing each executive's config: enabled, can_decompose, can_evaluate, canary status
   - Toggle switches for "Enable Orchestration" (Yellow-tier approval required)
   - Canary directive counter and cap

3. **Delegation Activity Feed:**
   - Recent delegations: who delegated what to whom, when, current status
   - Time from delegation to first assignment creation (measures exec responsiveness)
   - Time from delegation to synthesis completion (measures end-to-end cycle)

**Wire refresh into batch evaluator:** In `batchOutcomeEvaluator.ts` (Track 1, Issue 3), add a call to `refresh_delegation_metrics()` after each evaluation batch.

**Acceptance criteria:**
- [ ] Materialized view created and refreshed by batch evaluator
- [ ] Directive detail shows delegation tree
- [ ] Canary comparison card shows side-by-side metrics
- [ ] Executive orchestration config is viewable and toggleable (with approval)
- [ ] Delegation activity feed shows recent delegation events
- [ ] Sample sizes displayed for statistical context

---

### Issue 33: Canary rollout — enable CTO, measure, expand

**Labels:** `copilot`, `agents`, `track-8`

**Description:**

This issue covers the operational steps to run the canary and the automated expansion logic.

**Phase 1: Enable CTO canary (manual — founder action)**

Via the dashboard (Issue 32's config UI) or directly in the database:

```sql
UPDATE executive_orchestration_config 
SET is_canary = true, canary_started_at = NOW(), canary_directive_count = 0
WHERE executive_role = 'cto';
```

Sarah's domain router (Issue 28) will begin routing engineering-domain directives to Marcus.

**Phase 2: Monitoring period (2–4 weeks)**

Build `packages/scheduler/src/canaryEvaluator.ts`:

```typescript
export async function evaluateCanary(db: Pool): Promise<CanaryEvaluation> {
  // 1. Query delegation_performance materialized view
  //    Compare 'cto' (executive) row against 'chief-of-staff' (sarah) row
  //    for engineering-domain assignments specifically
  
  // 2. Statistical comparison (minimum 20 assignments per group):
  //
  //    PRIMARY METRIC: first_time_accept_rate
  //      If executive >= sarah - 0.05 (within 5 percentage points) → PASS
  //      If executive < sarah - 0.15 (more than 15pp worse) → FAIL
  //      Otherwise → INCONCLUSIVE (continue canary)
  //
  //    SECONDARY METRICS (all must not regress by > 20%):
  //      - revision_rate: exec <= sarah * 1.2
  //      - failure_rate: exec <= sarah * 1.2
  //      - avg_quality: exec >= sarah * 0.8
  //      - avg_cost: exec <= sarah * 1.5 (cost can increase somewhat — exec runs cost more)
  
  // 3. Return verdict: 'expand' | 'continue' | 'revert'
  
  return {
    verdict,
    metrics: { sarah: {...}, executive: {...} },
    sample_sizes: { sarah: N, executive: M },
    days_elapsed: daysSinceCanaryStart,
    recommendation: '...'
  };
}
```

**Add cron job:**

```typescript
{
  id: 'canary-evaluation',
  cron: '0 8 * * 1',  // weekly Monday 8 AM UTC
  endpoint: '/canary/evaluate',
  description: 'Weekly canary evaluation for executive orchestration'
}
```

**Add endpoint:** `POST /canary/evaluate` → runs `evaluateCanary()` and posts results to `#decisions` channel via Teams.

**Phase 3: Expansion logic**

When canary verdict is `expand`:

```typescript
// In canaryEvaluator.ts:

if (verdict === 'expand') {
  // Determine next executive to enable based on:
  // 1. Team size (larger teams benefit more from delegation)
  // 2. Sarah's current decomposition quality for that domain
  //    (worse quality → more benefit from domain-qualified decomposition)
  // 3. Executive's existing world model scores (readiness indicator)
  
  const expansionOrder = [
    'cto',           // Already canary
    'cmo',           // Large team (4 reports), content work is highly domain-specific
    'cpo',           // 2 reports, product work requires domain judgment
    'cfo',           // 2 reports, financial analysis requires precision
    'vp-sales',      // 2 reports, sales research is specialized
    'vp-customer-success', // 2 reports, customer health requires CS domain knowledge
    'vp-design',     // 4 reports, design quality requires design expertise
    'vp-research',   // 6 reports, research decomposition already partially works this way
  ];
  
  // Find next in expansion order that isn't yet enabled
  // INSERT or UPDATE executive_orchestration_config
  // Set is_canary = true, canary_started_at = NOW()
  // File a Yellow-tier decision for founder approval before activation
}

if (verdict === 'revert') {
  // Disable the canary executive
  // UPDATE executive_orchestration_config SET can_decompose = false, is_canary = false
  // All future directives in that domain route back to Sarah
  // Existing delegated directives continue (don't disrupt in-progress work)
  // Alert founders via #decisions
}
```

**Safety cap progression:**

| Phase | Canary Cap | Duration | Expansion Trigger |
|-------|-----------|----------|-------------------|
| Initial canary | 20 directives | 2 weeks min | Verdict = 'expand' AND >= 20 directives completed |
| Second exec | 30 directives each | 2 weeks min | Both execs pass evaluation |
| General availability | No cap | Ongoing | 3+ execs passing, remove is_canary flag |

**Acceptance criteria:**
- [ ] CTO canary can be enabled via dashboard or DB
- [ ] Weekly automated evaluation compares delegation performance
- [ ] Expansion follows the defined order with founder approval gates
- [ ] Revert disables the executive without disrupting in-progress work
- [ ] Safety caps enforced during canary phases
- [ ] Results posted to #decisions channel weekly
- [ ] All configuration changes require Yellow-tier approval

---

## Implementation Order Summary

```
Week 7 (parallel with governor Tracks 5-6):
  Issue 23  — workflow_steps table + types
  Issue 27  — sub-directive data model
  Issue 28  — domainRouter.ts

Week 8:
  Issue 24  — workflowOrchestrator.ts
  Issue 29  — executive orchestration tools
  Issue 30  — executive system prompts

Week 9:
  Issue 25  — wire workflows into engines + heartbeat
  Issue 31  — update Sarah's orchestration flow

Week 10:
  Issue 26  — workflow monitoring dashboard
  Issue 32  — delegation monitoring + comparison metrics

Week 11:
  Issue 33  — canary rollout (enable CTO, begin measurement)

Weeks 12–14:
  Canary monitoring period (automated weekly evaluation)
  Expand to second executive if CTO canary passes
```

**Estimated new tables:** 4 (`workflows`, `workflow_steps`, `executive_orchestration_config`, `delegation_performance` materialized view)

**Estimated new cron jobs:** 2 (`canary-evaluation`, waiting workflow check is part of existing heartbeat)

**Estimated new endpoints:** ~8

**Estimated LLM cost increase:** Minimal for Track 7 (workflows just restructure existing work into steps). Track 8 adds one exec orchestration run per delegated directive (~$0.02–0.05 each), offset by Sarah doing less decomposition work.

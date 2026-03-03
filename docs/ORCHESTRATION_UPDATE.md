# Cursor Instructions: Distributed Orchestration Architecture

## The Problem With Sarah-as-Bottleneck

The current system routes ALL work through Sarah Chen:

```
Founder Directive
  → Sarah decomposes into assignments for EVERYONE (execs + sub-team)
  → Sarah evaluates ALL output (Marcus's, Alex's, Tyler's — doesn't matter)
  → Sarah synthesizes everything
  → Sarah reports to founders
```

This is a hub-and-spoke topology where Sarah is a single-threaded router handling every assignment, every evaluation, and every synthesis for 44 agents. It creates five cascading failures:

1. **Shallow decomposition**: Sarah assigns directly to sub-team members (Alex, Tyler, Priya) because she can. This skips the executive who actually understands the domain. Sarah assigns Alex a platform task without Marcus's context on current priorities, infra state, or ongoing incidents.

2. **Context loss at evaluation**: Sarah evaluates a platform engineer's output without CTO-level understanding of whether that output is actually good. She can check formatting and completeness but not technical correctness.

3. **Executive passivity**: Marcus, Elena, Nadia, Maya have no ownership of their domains. They don't assign work, don't evaluate quality, and don't iterate with their teams. They're treated as peers of their own reports — just another node Sarah dispatches to.

4. **Bottleneck at scale**: Every assignment submission wakes Sarah. With 44 agents producing work, Sarah's orchestration cycles are consumed by evaluation rather than strategic coordination.

5. **No executive judgment**: In a real company, when you tell the CTO "make sure Pulse is production-ready," the CTO decides HOW to break that down, WHAT to check, WHO does what, and WHETHER the results are good enough. Right now Sarah makes all those decisions for every domain.

---

## Target Architecture: Two-Tier Orchestration

```
┌─────────────────────────────────────────────────────────────────────┐
│                     FOUNDER DIRECTIVE                                 │
│               "Ensure Pulse is launch-ready by March 5"              │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                TIER 1: SARAH (Strategic Coordinator)                  │
│                                                                      │
│  Decomposes directive into EXECUTIVE-LEVEL OUTCOMES:                 │
│                                                                      │
│  → Marcus (CTO): "Verify Pulse infrastructure is production-ready.  │
│    Deliverable: GO/NO-GO with list of fixes completed and blockers."│
│                                                                      │
│  → Elena (CPO): "Verify all launch features are functional.         │
│    Deliverable: Feature punch list with status for each."           │
│                                                                      │
│  → Mia (VP Design): "Verify Pulse UI matches Prism design system.  │
│    Deliverable: Compliance report with must-fix items."             │
│                                                                      │
│  → Maya (CMO): "Prepare launch marketing materials.                 │
│    Deliverable: Launch blog post, social posts, Product Hunt draft."│
│                                                                      │
│  Sarah does NOT assign tasks to Alex, Priya, Tyler, Leo.            │
│  She doesn't know what those teams should do — their execs do.      │
└──────────┬──────────┬──────────┬──────────┬─────────────────────────┘
           │          │          │          │
           ▼          ▼          ▼          ▼
┌──────────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐
│ TIER 2:      │ │ TIER 2:  │ │TIER 2: │ │ TIER 2:  │
│ Marcus (CTO) │ │ Elena    │ │ Mia    │ │ Maya     │
│              │ │ (CPO)    │ │(VP Des)│ │ (CMO)    │
│ Decomposes:  │ │          │ │        │ │          │
│ Alex: check  │ │ Priya:   │ │ Leo:   │ │ Tyler:   │
│  Cloud Run   │ │  test    │ │  audit │ │  draft   │
│ Jordan: CI/CD│ │  each    │ │  every │ │  blog    │
│  pipeline    │ │  feature │ │  page  │ │ Lisa:    │
│ Sam: run     │ │ Daniel:  │ │ Ava:   │ │  SEO     │
│  smoke tests │ │  compare │ │  check │ │ Kai:     │
│              │ │  to comp │ │  perf  │ │  social  │
│ Marcus       │ │          │ │        │ │          │
│ evaluates    │ │ Elena    │ │ Mia    │ │ Maya     │
│ Alex/Jordan/ │ │ evaluates│ │ eval-  │ │ eval-    │
│ Sam output   │ │ Priya/   │ │ uates  │ │ uates    │
│ himself      │ │ Daniel   │ │ Leo/Ava│ │ Tyler/   │
│              │ │          │ │        │ │ Lisa/Kai │
│ Submits      │ │ Submits  │ │Submits │ │ Submits  │
│ consolidated │ │ consol.  │ │consol. │ │ consol.  │
│ GO/NO-GO     │ │ punch    │ │report  │ │ launch   │
│ to Sarah     │ │ list     │ │        │ │ package  │
└──────────────┘ └──────────┘ └────────┘ └──────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│            SARAH EVALUATES EXECUTIVE DELIVERABLES                    │
│                                                                      │
│  Sarah reviews 4 executive outputs (not 12+ individual ones).       │
│  She evaluates strategic quality — did the CTO actually verify       │
│  production readiness, or just check a few metrics?                  │
│                                                                      │
│  Sarah synthesizes into a LAUNCH DECISION for founders.              │
└─────────────────────────────────────────────────────────────────────┘
```

### What Changes for Each Role

| Role | Current | New |
|------|---------|-----|
| **Sarah** | Decomposes to ALL agents, evaluates ALL output | Decomposes to EXECUTIVES only, evaluates EXECUTIVE output only, cross-functional synthesis |
| **Executives** | Receive assignments, execute personally, submit back to Sarah | Receive outcomes, decompose for their team, assign team tasks, evaluate team output, submit consolidated deliverable |
| **Sub-team** | Receive assignments from Sarah, submit to Sarah | Receive assignments from their executive, submit to their executive |
| **Peer execs** | No direct coordination | Can message, assign cross-domain work, create handoffs |

---

## Implementation Plan

### Change 1: Executive Orchestration Tools

Create a new shared tool factory that gives executives the ability to manage their teams.

**New file:** `packages/agents/src/shared/teamOrchestrationTools.ts`

```typescript
// Factory: createTeamOrchestrationTools(agentRole, directReports, db, glyphorEventBus)
//
// Only instantiated for executives (agents with direct_reports in company_agents).
// Scoped: executives can ONLY assign to and evaluate their own direct reports.

// TOOL 1: assign_team_task
// Description: Break down your assignment into tasks for your direct reports.
// Parameters:
//   parent_assignment_id: UUID — the executive's own assignment from Sarah
//   tasks: Array<{
//     assigned_to: string — must be in directReports[]
//     instructions: string — specific task with embedded context
//     expected_output: string — what "done" looks like
//     priority: 'critical' | 'high' | 'medium' | 'low'
//     depends_on?: UUID[] — other team task IDs this depends on
//   }>
//
// Behavior:
//   → Validate assigned_to is in executive's directReports
//   → INSERT work_assignments with parent_assignment_id linking to exec's assignment
//   → Set assigned_by = agentRole (executive, not Sarah)
//   → Dispatch each team member (send DM + POST /run)
//   → Return created assignment IDs
//
// Pre-dispatch validation (same 4 checks Sarah does, now done by executive):
//   CHECK 1 — TOOL CHECK: Does the team member have required tools?
//   CHECK 2 — DATA DEPENDENCY: Does the task need data from outside the team?
//   CHECK 3 — SPECIFICITY: Is the task atomic with clear deliverable?
//   CHECK 4 — CONTEXT EMBEDDING: All context must be in instructions

// TOOL 2: review_team_output
// Description: Review a direct report's completed assignment.
// Parameters:
//   assignment_id: UUID — the team member's assignment
//   verdict: 'accept' | 'revise' | 'reassign'
//   feedback?: string — required for 'revise', specific improvement instructions
//   reassign_to?: string — required for 'reassign', must be in directReports
//   quality_score?: number (0-100)
//
// Behavior:
//   → Validate the assignment was created by this executive
//   → If 'accept': status='completed', check if all team tasks done
//     → If all team tasks done: auto-notify executive that consolidation is ready
//   → If 'revise': status='needs_revision', attach feedback
//     → Emit assignment.revised → wake team member at P1
//   → If 'reassign': Create new assignment for different team member

// TOOL 3: check_team_status
// Description: Check status of all tasks assigned to your team.
// Parameters:
//   parent_assignment_id?: UUID — filter to a specific parent assignment
//   status_filter?: string — 'all' | 'pending' | 'completed' | 'blocked'
//
// Behavior:
//   → Query work_assignments WHERE assigned_by = agentRole
//   → Join with founder_directives for context
//   → Return: per-member status, outputs for completed tasks, blockers

// TOOL 4: escalate_to_sarah
// Description: Escalate a team-level issue that requires cross-functional help.
// Parameters:
//   issue: string — what's wrong
//   need: 'peer_resource' | 'data_from_other_domain' | 'authority_escalation' | 'blocker'
//   suggested_action?: string — what the executive recommends
//
// Behavior:
//   → Send urgent message to chief-of-staff with context
//   → Sarah can then coordinate with other executives as needed
```

**Important scoping rule:** The `directReports` list is loaded from `company_agents WHERE reports_to = '{agentRole}'` at tool creation time. Executives cannot assign work to agents outside their reporting line through these tools. Cross-executive work goes through peer coordination tools (Change 3).

### Change 2: Modify Assignment Submission Routing

Currently, `submit_assignment_output` always notifies Sarah. In the new model, it should notify whoever assigned the work.

**File:** `packages/agents/src/shared/assignmentTools.ts`

Modify `submit_assignment_output`:

```typescript
// Current: always sends notification to 'chief-of-staff'
// New: sends notification to the assignment's assigned_by field

// When a SUB-TEAM member submits:
//   → Notify their EXECUTIVE (assigned_by from work_assignments row)
//   → Emit assignment.submitted event
//   → Executive wakes to evaluate via review_team_output

// When an EXECUTIVE submits:
//   → Notify SARAH (assigned_by will be 'chief-of-staff')
//   → Emit assignment.submitted event
//   → Sarah wakes to evaluate at the strategic level

// The routing logic:
const assignment = await getAssignment(assignmentId);
const notifyAgent = assignment.assigned_by; // executive for sub-team, sarah for execs
await sendAgentMessage(db, agentRole, notifyAgent, {
  type: 'info',
  priority: 'normal',
  content: `Assignment "${assignment.title}" completed. Output ready for review.`
});
```

Similarly, modify `flag_assignment_blocker`:

```typescript
// Current: always sends urgent message to chief-of-staff
// New: sends to assigned_by first

// Sub-team blocker → escalates to their EXECUTIVE first
//   Executive can resolve (grant tools, clarify, reassign) without bothering Sarah
// Executive blocker → escalates to SARAH
//   Sarah coordinates cross-functional resolution

// If the executive can't resolve a team blocker within 30 min, 
// auto-escalate to Sarah (add a timer or check in next heartbeat)
```

### Change 3: Peer-to-Peer Executive Coordination Tools

Executives need three mechanisms for working across domain boundaries.

**New file:** `packages/agents/src/shared/peerCoordinationTools.ts`

```typescript
// Factory: createPeerCoordinationTools(agentRole, db, glyphorEventBus)
// Only instantiated for executives.

// TOOL 1: request_peer_work (formal cross-domain assignment)
// Description: Request another executive's team to do work that your team can't.
// Parameters:
//   target_executive: string — the peer executive's role
//   title: string — what you need
//   instructions: string — detailed task description with embedded context
//   justification: string — why this requires their team
//   priority: 'critical' | 'high' | 'medium' | 'low'
//   parent_directive_id?: UUID — the directive this supports
//   depends_on?: UUID[] — assignments this work depends on
//
// Behavior:
//   → INSERT work_assignments with:
//     assigned_to = target_executive (not their sub-team member)
//     assigned_by = requesting executive
//     type = 'peer_request'
//   → Send message to target executive explaining the request
//   → Target executive decomposes and assigns to THEIR team
//   → When target executive completes, result flows back to requester
//
// Authority rule: Peer requests are always GREEN for read/analysis tasks.
// Peer requests that involve mutations or spending are YELLOW (Sarah mediates).

// TOOL 2: create_handoff (shared project coordination)
// Description: Create a handoff for multi-team work that requires coordination.
// Parameters:
//   title: string — project name
//   description: string — what's being coordinated
//   participants: string[] — list of executive roles involved
//   deliverables: Array<{
//     owner: string — which executive owns this deliverable
//     description: string — what they're responsible for
//     depends_on?: string[] — other deliverable owners this depends on
//   }>
//   deadline?: string — target completion
//
// Behavior:
//   → INSERT into new `handoffs` table
//   → Send message to all participants with handoff brief
//   → Each participant decomposes their deliverable for their team
//   → As deliverables complete, dependents are notified
//   → When all deliverables complete, initiating executive synthesizes
//
// Example: Marcus creates a handoff for "Pulse Performance Optimization"
//   → Marcus owns: backend performance profiling
//   → Mia owns: frontend bundle size reduction (depends on Marcus's profiling)
//   → Elena owns: feature flag cleanup (parallel with both)

// TOOL 3: peer_data_request (lightweight info exchange — not a full assignment)
// Description: Request specific data or analysis from a peer's domain
//   without creating a formal assignment. The peer responds via DM.
// Parameters:
//   target_executive: string
//   question: string — what you need to know
//   urgency: 'blocking' | 'soon' | 'when_convenient'
//
// Behavior:
//   → Send structured message to peer with data_request type
//   → If urgency='blocking': send as urgent priority (immediate wake)
//   → Peer responds with their domain knowledge in next run
//
// This replaces the pattern where agents currently just don't ask
// because they don't have a structured way to request info.
```

### Change 4: Database Schema Updates

**New migration file:** `db/migrations/xxx_distributed_orchestration.sql`

```sql
-- 1. Add assigned_by column to work_assignments (who created this assignment)
ALTER TABLE work_assignments 
  ADD COLUMN IF NOT EXISTS assigned_by TEXT 
    REFERENCES company_agents(role) DEFAULT 'chief-of-staff';

-- 2. Add parent_assignment_id for two-tier nesting
ALTER TABLE work_assignments 
  ADD COLUMN IF NOT EXISTS parent_assignment_id UUID 
    REFERENCES work_assignments(id);

-- 3. Add assignment type to distinguish orchestration levels
ALTER TABLE work_assignments 
  ADD COLUMN IF NOT EXISTS assignment_type TEXT 
    NOT NULL DEFAULT 'standard'
    CHECK (assignment_type IN (
      'executive_outcome',  -- Sarah → executive
      'team_task',          -- executive → sub-team member
      'peer_request',       -- executive → peer executive
      'standard'            -- legacy/direct assignments
    ));

-- 4. Handoffs table for multi-team coordination
CREATE TABLE handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  initiated_by TEXT NOT NULL REFERENCES company_agents(role),
  participants TEXT[] NOT NULL,
  deliverables JSONB NOT NULL DEFAULT '[]',
  -- Each deliverable: {owner, description, depends_on[], status, output}
  status TEXT NOT NULL DEFAULT 'active' 
    CHECK (status IN ('active', 'completed', 'cancelled')),
  directive_id UUID REFERENCES founder_directives(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  tenant_id TEXT NOT NULL DEFAULT 'glyphor'
);

CREATE INDEX idx_handoffs_status ON handoffs(status, tenant_id);
CREATE INDEX idx_handoffs_initiated_by ON handoffs(initiated_by, tenant_id);

-- 5. Index for efficient parent/child assignment queries
CREATE INDEX idx_work_assignments_parent ON work_assignments(parent_assignment_id) 
  WHERE parent_assignment_id IS NOT NULL;
CREATE INDEX idx_work_assignments_assigned_by ON work_assignments(assigned_by, tenant_id);

-- 6. Backfill existing assignments
UPDATE work_assignments SET assigned_by = 'chief-of-staff' WHERE assigned_by IS NULL;
```

### Change 5: Modify Sarah's Orchestration Prompt

**File:** `packages/agents/src/chief-of-staff/systemPrompt.ts`

Replace the current orchestration prompt with a strategic coordinator prompt:

```
ORCHESTRATION — STRATEGIC COORDINATOR ROLE:

You are the Chief of Staff. You coordinate the executive team — you do NOT 
micromanage their departments. Think of yourself as a military chief of staff:
you translate the commander's intent into executive-level objectives, then 
trust your executives to figure out HOW to achieve them.

WHEN A NEW DIRECTIVE ARRIVES:

1. DECOMPOSE INTO EXECUTIVE OUTCOMES (not team tasks):
   Break the directive into outcomes owned by specific executives.
   Each outcome should be:
   - Scoped to ONE executive's domain
   - Stated as a deliverable, not a process ("Deliver a GO/NO-GO assessment" 
     not "Check the infrastructure")
   - Clear about acceptance criteria (what makes this DONE)
   - Embedded with all cross-functional context the executive needs

   WRONG: Assign Alex Park to "check Cloud Run health"
          (That's Marcus's job to decompose, not yours)
   
   RIGHT: Assign Marcus Reeves to "Verify Pulse infrastructure is production-ready. 
          Deliverable: GO/NO-GO assessment with list of issues found, fixes applied, 
          and remaining blockers with owners and ETAs."

2. USE create_work_assignments WITH assignment_type='executive_outcome':
   - assigned_to: the executive (not their reports)
   - instructions: outcome description with all relevant context
   - expected_output: specific deliverable format
   - Set dependencies between executive outcomes where needed

3. TRUST EXECUTIVES TO DECOMPOSE:
   After assigning executive outcomes, DO NOT also assign tasks to their 
   sub-team members. Marcus will assign Alex, Jordan, and Sam. Elena will 
   assign Priya and Daniel. That's their job — they know their teams.

4. HANDLE CROSS-FUNCTIONAL WORK:
   If a task genuinely spans multiple departments and can't be owned by one 
   executive, either:
   a) Assign it to the PRIMARY executive and tell them to coordinate with the 
      secondary (e.g., "Coordinate with Mia's team for frontend assessment")
   b) Create separate but linked assignments with depends_on relationships

EVALUATION — STRATEGIC QUALITY:

When executives submit their consolidated deliverables:

1. Evaluate STRATEGIC QUALITY, not tactical detail:
   - Did the CTO actually verify production readiness, or just report metrics?
   - Did the CPO produce a real punch list, or a vague assessment?
   - Does the deliverable answer the directive's question?

2. You are NOT evaluating individual team member output.
   If Marcus says his team found 3 issues and fixed 2 of them, you trust 
   Marcus's evaluation of his team's work. You evaluate whether Marcus's 
   OVERALL deliverable meets the directive's requirements.

3. Iterate with executives when their deliverable is insufficient:
   - Use evaluate_assignment with specific feedback
   - The executive will iterate with their team internally
   - You don't need to tell the executive HOW to fix it — they know their domain

SYNTHESIS — CONNECTING THE DOTS:

Your unique value is cross-functional synthesis:
- Identify conflicts between executive deliverables
  (Marcus says GO but Elena says NO-GO — reconcile this)
- Identify gaps no single executive would see
  (Infrastructure is ready but marketing isn't — call it out)
- Produce the coherent narrative for founders

POST-DIRECTIVE:
- Compile executive deliverables into founder-ready summary
- Propose follow-up directives if needed
- Note which executives performed well and which need support

WHAT YOU SHOULD NEVER DO:
- Assign work directly to sub-team members (Alex, Priya, Tyler, etc.)
- Evaluate sub-team member output (that's their executive's job)
- Tell an executive HOW to break down work for their team
- Second-guess an executive's team-level decisions unless the outcome is wrong
```

### Change 6: Executive Orchestration Prompt

Add a new protocol block injected into all executive system prompts.

**File:** `packages/agent-runtime/src/companyAgentRunner.ts` (or individual executive `systemPrompt.ts` files)

Add this to the system prompt assembly for agents flagged as executives (where `reports_to = 'chief-of-staff'` or equivalent):

```
EXECUTIVE ORCHESTRATION PROTOCOL:

You are an executive. You own your domain end-to-end.

WHEN YOU RECEIVE AN ASSIGNMENT FROM SARAH:

1. READ the assignment — it's an OUTCOME, not a task list.
   Sarah tells you WHAT to deliver, not HOW to deliver it.

2. DECOMPOSE into team tasks:
   Use assign_team_task to break the outcome into specific tasks 
   for your direct reports. Apply the same 4 checks Sarah applies:
   
   CHECK 1 — TOOL CHECK: Does your team member have the tools they need?
   CHECK 2 — DATA DEPENDENCY: Embed all data they'll need in the instructions.
   CHECK 3 — SPECIFICITY: Each task must be atomic with a clear deliverable.
   CHECK 4 — CONTEXT EMBEDDING: Team members run with ~150-line prompts. 
             Put EVERYTHING they need in the assignment instructions.

3. SOME TASKS YOU DO YOURSELF:
   Not everything needs delegation. If a task requires your executive judgment,
   deep domain expertise, or takes less time than delegating would, do it yourself.
   
   Delegate: routine data gathering, specific checks, content drafting
   Do yourself: synthesis, judgment calls, escalation decisions, architecture decisions

4. EVALUATE your team's output using review_team_output:
   - ACCEPT work that meets the task requirements
   - REVISE work that's close but needs improvement — give specific feedback
   - REASSIGN work that went to the wrong team member
   
   You own quality for your domain. Sarah trusts your evaluation.

5. CONSOLIDATE & SUBMIT:
   After all team tasks complete, consolidate their outputs into YOUR deliverable.
   This is not copy-paste — it's executive synthesis:
   - What did we find across all the team outputs?
   - What's the executive judgment call?
   - What's the recommendation?
   
   Submit via submit_assignment_output with your consolidated deliverable.

PEER COORDINATION:

When your work requires input from another executive's domain:
- For quick information: use peer_data_request
- For work you need their team to do: use request_peer_work  
- For multi-team projects: use create_handoff

When a peer requests work from you:
- Treat peer_requests at the same priority as Sarah's assignments
- Decompose and assign to your team the same way
- Deliver the result back to the requesting peer

PROACTIVE DOMAIN OWNERSHIP:

Even without directives, you own your domain:
- Monitor your area during proactive cycles
- Assign team tasks for recurring work without waiting for Sarah
- Identify cross-functional issues and coordinate directly with peers
- Escalate to Sarah only for things that require founder attention or 
  cross-organizational coordination

YOUR DIRECT REPORTS: {directReports}
```

Each executive's `systemPrompt.ts` should populate `{directReports}` with their actual team listing, e.g., for Marcus:
```
YOUR DIRECT REPORTS:
  - Alex Park (platform-engineer): Infrastructure monitoring, health checks
  - Sam DeLuca (quality-engineer): Test execution, bug reporting
  - Jordan Hayes (devops-engineer): CI/CD optimization, caching, cold starts
  - Riley Morgan (m365-admin): Teams channels, email, calendar, user directory
```

### Change 7: Update Work Loop for Executive Evaluation

The work loop's P1/P2 priority stack currently only checks for assignments where the agent is the `assigned_to`. Executives also need to pick up completed team assignments that need evaluation.

**File:** `packages/agent-runtime/src/workLoop.ts`

Add a new priority level between P1 and P2 (or as a sub-check within P2):

```
P1.5: TEAM EVALUATION — completed assignments from direct reports
  ├─ Query: work_assignments WHERE assigned_by = {agentRole} 
  │    AND status = 'completed' AND quality_score IS NULL
  │    (output submitted but not yet evaluated)
  ├─ Build exec message: "Your team member {name} completed: {title}. 
  │    Review their output and accept, revise, or reassign."
  │    Include: team member's output, original instructions, directive context
  └─ Return: contextTier='standard' (executive needs full context to evaluate)
```

Also add handling for team blockers:

```
P1: URGENT — now also includes team member blockers
  ├─ Existing: needs_revision assignments for this agent
  ├─ NEW: work_assignments WHERE assigned_by = {agentRole} AND status = 'blocked'
  │    (team member flagged a blocker — executive resolves before escalating to Sarah)
  └─ Build exec message with blocker details and resolution tools hint
```

### Change 8: Update Wake Rules for Two-Tier Routing

**File:** `packages/scheduler/src/wakeRules.ts`

Currently `assignment.submitted` wakes `chief-of-staff`. In the new model, it should wake whoever `assigned_by` is:

```typescript
// Current rule:
{ event: 'assignment.submitted', agents: ['chief-of-staff'], priority: 'immediate' }

// New rule:
{ 
  event: 'assignment.submitted', 
  agents: ['$assigned_by'],  // dynamic: wake whoever assigned the work
  priority: 'immediate',
  cooldown: '5min'
}

// The $assigned_by token resolves from event.data.assigned_by
// For sub-team submissions → wakes their executive
// For executive submissions → wakes Sarah
```

Similarly for `assignment.blocked`:
```typescript
// Current: always wakes chief-of-staff
// New: wakes assigned_by first
{ 
  event: 'assignment.blocked', 
  agents: ['$assigned_by'],  // executive first, Sarah only if exec escalates
  priority: 'immediate',
  cooldown: '2min'
}
```

### Change 9: Dashboard Updates

**File:** `packages/dashboard/src/pages/Directives.tsx`

The Directives page needs to show the two-tier structure:

```
Directive: "Ensure Pulse is launch-ready"
├── Marcus Reeves (CTO) — Executive Outcome: Infrastructure GO/NO-GO
│   ├── Alex Park — Cloud Run health check [✅ Accepted by Marcus]
│   ├── Jordan Hayes — CI/CD pipeline verification [✅ Accepted by Marcus]
│   ├── Sam DeLuca — Smoke test execution [🔄 Revision requested by Marcus]
│   └── Marcus Reeves — Consolidated: GO with 1 condition [📤 Submitted to Sarah]
├── Elena Vasquez (CPO) — Executive Outcome: Feature punch list
│   ├── Priya Sharma — Feature testing [✅ Accepted by Elena]
│   └── Elena Vasquez — Consolidated: 11/12 features passing [📤 Submitted to Sarah]
├── Mia Tanaka (VP Design) — Executive Outcome: Design compliance report
│   └── Leo Vargas — UI audit [⏳ In progress]
└── Maya Brooks (CMO) — Executive Outcome: Launch marketing materials
    ├── Tyler Reed — Blog post draft [✅ Accepted by Maya]
    └── Lisa Chen — SEO readiness [✅ Accepted by Maya]
```

Key UI changes:
- Show parent/child assignment relationships (collapsible tree)
- Show WHO evaluated each assignment (executive vs. Sarah)
- Show the assignment_type badge (executive_outcome, team_task, peer_request)
- Show handoffs as a separate tab or section

---

## Execution Flow: Complete Lifecycle

Here's the full two-tier lifecycle for a directive:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    TWO-TIER ORCHESTRATION LIFECYCLE                       │
│                                                                          │
│  ① DIRECTIVE CREATED                                                    │
│     │                                                                    │
│     ▼                                                                    │
│  ② SARAH DECOMPOSES INTO EXECUTIVE OUTCOMES                             │
│     │  create_work_assignments(type='executive_outcome')                 │
│     │  Assigns to: Marcus, Elena, Mia, Maya (NOT Alex, Priya, Leo...)   │
│     │                                                                    │
│     ▼                                                                    │
│  ③ EXECUTIVE RECEIVES OUTCOME (work_loop P2)                            │
│     │  reads assignment → plans decomposition                            │
│     │                                                                    │
│     ▼                                                                    │
│  ④ EXECUTIVE DECOMPOSES INTO TEAM TASKS                                 │
│     │  assign_team_task(parent_assignment_id=own_assignment)             │
│     │  Pre-dispatch: 4 validation checks (tool, data, specificity, ctx) │
│     │  Some tasks the executive does personally                          │
│     │                                                                    │
│     ▼                                                                    │
│  ⑤ TEAM MEMBERS EXECUTE (work_loop P2, task tier)                       │
│     │  Same as current: ~150-line prompt, tool calls, submit/flag        │
│     │                                                                    │
│     ▼                                                                    │
│  ⑥ TEAM MEMBER SUBMITS → EXECUTIVE WAKES (not Sarah!)                   │
│     │  submit_assignment_output → notify assigned_by (executive)         │
│     │  Executive wakes at P1.5 (team evaluation priority)                │
│     │                                                                    │
│     ▼                                                                    │
│  ⑦ EXECUTIVE EVALUATES TEAM OUTPUT                                      │
│     │  review_team_output → accept / revise / reassign                   │
│     │  If revise: team member wakes at P1, re-executes with feedback     │
│     │  If accept: check if all team tasks complete                       │
│     │                                                                    │
│     ▼                                                                    │
│  ⑧ EXECUTIVE CONSOLIDATES & SUBMITS                                     │
│     │  All team tasks accepted → executive synthesizes                   │
│     │  submit_assignment_output → notify Sarah (assigned_by=CoS)         │
│     │                                                                    │
│     ▼                                                                    │
│  ⑨ SARAH EVALUATES EXECUTIVE DELIVERABLE                                │
│     │  Strategic quality check — not tactical review                     │
│     │  Accept / iterate with executive (not their team)                  │
│     │                                                                    │
│     ▼                                                                    │
│  ⑩ SARAH SYNTHESIZES & DELIVERS TO FOUNDERS                             │
│     │  Cross-functional synthesis of all executive deliverables          │
│     │  Identifies conflicts, gaps, and the overall narrative             │
│                                                                          │
│  PEER COORDINATION (can happen at any point during ③-⑧):               │
│     │  Executive → peer_data_request → peer responds via DM             │
│     │  Executive → request_peer_work → peer decomposes for their team   │
│     │  Executive → create_handoff → multi-team project coordination     │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Migration Strategy

This is a significant behavioral shift. Roll it out in phases to avoid breaking the currently-working (if suboptimal) Sarah-centric loop.

### Phase 1: Build the Plumbing (no behavior change yet)

1. Run the DB migration (add `assigned_by`, `parent_assignment_id`, `assignment_type`, `handoffs` table)
2. Create `teamOrchestrationTools.ts` and `peerCoordinationTools.ts`
3. Wire the new tools into executive agent tool factories
4. Update `submit_assignment_output` to route notifications to `assigned_by`
5. Update wake rules for `$assigned_by` routing
6. Backfill existing assignments with `assigned_by='chief-of-staff'`

**Test:** Verify existing Sarah-centric flow still works. New columns default correctly. New tools exist but aren't used yet.

### Phase 2: Enable Executive Orchestration (one exec at a time)

Start with **Marcus (CTO)** — he has the most structured domain and the clearest team:

1. Add EXECUTIVE ORCHESTRATION PROTOCOL to Marcus's system prompt
2. Update Sarah's prompt to assign Marcus executive outcomes (not team tasks)
3. Add P1.5 team evaluation to Marcus's work loop checks
4. Test with a real directive: create a "Platform Health Audit" directive
   - Sarah assigns Marcus the outcome
   - Marcus decomposes for Alex, Jordan, Sam
   - Marcus evaluates their output
   - Marcus submits consolidated deliverable to Sarah

5. Verify: Does Marcus decompose well? Does evaluation routing work? Does Sarah only see Marcus's consolidated output?

6. If working: roll out to Elena (CPO), then Maya (CMO), then remaining executives

### Phase 3: Enable Peer Coordination

1. Add peer coordination tools to all executives
2. Create a test directive that requires cross-functional work
3. Verify: Can Marcus request work from Mia's team? Does the handoff flow work?

### Phase 4: Update Sarah's Prompt to Full Strategic Coordinator

1. Replace Sarah's orchestration prompt with the new strategic coordinator version
2. Add guardrails: if Sarah tries to assign directly to a sub-team member, the tool should warn her (soft block, not hard block — she may need to in emergencies)
3. Monitor for a week: are directives completing faster? Are executive deliverables higher quality?

---

## Files Modified Summary

| File | Change |
|------|--------|
| `packages/agents/src/shared/teamOrchestrationTools.ts` | **NEW** — assign_team_task, review_team_output, check_team_status, escalate_to_sarah |
| `packages/agents/src/shared/peerCoordinationTools.ts` | **NEW** — request_peer_work, create_handoff, peer_data_request |
| `packages/agents/src/shared/assignmentTools.ts` | Route submit/blocker notifications to `assigned_by` instead of always Sarah |
| `packages/agents/src/chief-of-staff/systemPrompt.ts` | Replace orchestration prompt with strategic coordinator role |
| `packages/agents/src/chief-of-staff/tools.ts` | Keep create_work_assignments but add assignment_type param |
| `packages/agents/src/{exec}/systemPrompt.ts` (×8) | Add EXECUTIVE ORCHESTRATION PROTOCOL |
| `packages/agents/src/{exec}/tools.ts` (×8) | Wire in teamOrchestrationTools + peerCoordinationTools |
| `packages/agent-runtime/src/workLoop.ts` | Add P1.5 team evaluation priority, team blocker handling |
| `packages/agent-runtime/src/companyAgentRunner.ts` | Inject exec orchestration protocol for executive roles |
| `packages/scheduler/src/wakeRules.ts` | Route assignment.submitted to `$assigned_by` |
| `packages/dashboard/src/pages/Directives.tsx` | Show two-tier tree, evaluator badges, handoffs tab |
| `db/migrations/xxx_distributed_orchestration.sql` | Schema: assigned_by, parent_assignment_id, assignment_type, handoffs |

---

## Key Architectural Principle

Sarah is the STRATEGIC BRAIN, not the TASK ROUTER.

In the old model, Sarah does ~80% task routing and ~20% strategic thinking.
In the new model, Sarah does ~20% executive assignment and ~80% cross-functional synthesis.

Executives go from passive task executors to autonomous domain owners who:
- Decompose outcomes into team work
- Evaluate their team's output
- Coordinate directly with peers
- Own quality for their department
- Only escalate what genuinely needs cross-functional or founder attention

This mirrors how Glyphor would work with 46 human employees and founders who have 5-10 hours per week. You wouldn't have your Chief of Staff assigning tasks to individual engineers — you'd tell your CTO "make sure the platform is ready" and trust them to run their team.
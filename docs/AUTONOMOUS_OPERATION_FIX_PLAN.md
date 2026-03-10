# Autonomous Operation Fix Plan

> **Priority:** CRITICAL
> **Owner:** CTO (Marcus Reeves) + Platform Engineer (Alex Park)
> **Timeline:** 10 days
> **Objective:** Eliminate idle time, reduce abort rate below 5%, enable 48-hour autonomous operation without founder input.

---

## Problem Statement

Agents are not running autonomously. Six interacting failure modes create dead time:

1. **Token bloat** — 80–97K input tokens by turn 7 on heavy agents (CMO, CTO, CoS). Agents hit `max_turns_exceeded` or timeout on routine scheduled tasks.
2. **Abort → cooldown death spiral** — Any abort triggers a flat 30-minute cooldown. A token-limit abort (agent was doing real work, just slowly) gets the same penalty as a catastrophic error.
3. **Conservative proactive cooldowns** — P5 proactive fires every 4–6 hours for most agents. When no directives exist, agents sit idle.
4. **Sarah as single point of failure** — All directive decomposition flows through CoS. One failed orchestrate run stalls the entire downstream pipeline for 10+ minutes.
5. **Stuck runs blocking concurrency** — Dead Cloud Run instances leave `agent_runs` rows as `status='running'` forever. The concurrency guard permanently skips those agents.
6. **No standing objectives** — Agents wait for founder directives instead of self-directing. P5 proactive work is generic ("look around and see if anything needs doing") with no structured output.

---

## Phase 0: Diagnostics (Day 1)

Run these queries against Cloud SQL. Document results before making any changes.

### 0.1 Abort Rate by Agent

```sql
SELECT
  ar.agent_role,
  COUNT(*) FILTER (WHERE ar.status = 'completed') AS completed,
  COUNT(*) FILTER (WHERE ar.status = 'aborted') AS aborted,
  COUNT(*) FILTER (WHERE ar.status = 'failed') AS failed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ar.status = 'aborted')
    / NULLIF(COUNT(*), 0), 1) AS abort_pct,
  ROUND(AVG(ar.turns) FILTER (WHERE ar.status = 'aborted'), 1) AS avg_abort_turns,
  ROUND(AVG(ar.input_tokens) FILTER (WHERE ar.status = 'aborted')) AS avg_abort_input_tokens
FROM agent_runs ar
WHERE ar.created_at > NOW() - INTERVAL '7 days'
GROUP BY ar.agent_role
ORDER BY abort_pct DESC;
```

- If `avg_abort_input_tokens > 60K` → token bloat is the cause.
- If `avg_abort_turns = 20` (task) or `12` (chat) exactly → hitting maxTurns, not timeout.

### 0.2 Token Growth Across Turns

```sql
SELECT
  ar.agent_role, ar.turns, ar.input_tokens,
  ar.output_tokens, ar.cost, ar.duration_ms,
  ar.status, ar.error
FROM agent_runs ar
WHERE ar.agent_role IN ('cmo', 'cto', 'chief-of-staff', 'cpo', 'cfo')
AND ar.created_at > NOW() - INTERVAL '3 days'
ORDER BY ar.input_tokens DESC
LIMIT 30;
```

- Runs with `input_tokens > 70K` = unbounded history accumulation confirmed.

### 0.3 Cooldown Dead Time

```sql
WITH run_gaps AS (
  SELECT agent_role, status, created_at,
    LAG(status) OVER (PARTITION BY agent_role ORDER BY created_at) AS prev_status,
    created_at - LAG(created_at) OVER (PARTITION BY agent_role ORDER BY created_at) AS gap
  FROM agent_runs
  WHERE created_at > NOW() - INTERVAL '3 days'
)
SELECT agent_role,
  COUNT(*) FILTER (WHERE prev_status = 'aborted' AND gap > INTERVAL '25 minutes') AS cooldown_gaps,
  ROUND(AVG(EXTRACT(EPOCH FROM gap) / 60) FILTER (WHERE prev_status = 'aborted'), 1) AS avg_post_abort_gap_min
FROM run_gaps
GROUP BY agent_role
HAVING COUNT(*) FILTER (WHERE prev_status = 'aborted') > 0
ORDER BY cooldown_gaps DESC;
```

### 0.4 Sarah Orchestration Success

```sql
SELECT
  ar.status, ar.turns, ar.input_tokens, ar.duration_ms, ar.error,
  (SELECT COUNT(*) FROM work_assignments wa
   WHERE wa.created_at BETWEEN ar.created_at AND ar.created_at + INTERVAL '5 minutes'
  ) AS assignments_created,
  ar.created_at
FROM agent_runs ar
WHERE ar.agent_role = 'chief-of-staff'
AND ar.task IN ('orchestrate', 'work_loop')
AND ar.created_at > NOW() - INTERVAL '7 days'
ORDER BY ar.created_at DESC
LIMIT 20;
```

- `assignments_created = 0` on completed runs → Sarah is running but not decomposing.

### 0.5 Work Assignment Pipeline

```sql
SELECT wa.status, COUNT(*) AS count,
  ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(wa.updated_at, NOW()) - wa.created_at)) / 3600), 1) AS avg_age_hours,
  MAX(NOW() - wa.created_at) AS oldest
FROM work_assignments wa
WHERE wa.created_at > NOW() - INTERVAL '14 days'
GROUP BY wa.status
ORDER BY count DESC;
```

```sql
-- Stuck assignments (> 6 hours)
SELECT wa.id, wa.agent_role, wa.status, wa.directive_id,
  fd.title AS directive, NOW() - wa.created_at AS age
FROM work_assignments wa
LEFT JOIN founder_directives fd ON fd.id = wa.directive_id
WHERE wa.status IN ('pending', 'dispatched', 'in_progress')
AND wa.created_at < NOW() - INTERVAL '6 hours'
ORDER BY wa.created_at ASC;
```

### 0.6 Stuck Runs (IMMEDIATE ACTION)

```sql
SELECT ar.id, ar.agent_role, ar.task, ar.status,
  ar.created_at, NOW() - ar.created_at AS stuck_duration
FROM agent_runs ar
WHERE ar.status = 'running'
AND ar.created_at < NOW() - INTERVAL '10 minutes'
ORDER BY ar.created_at ASC;
```

**If rows returned, clean immediately:**

```sql
UPDATE agent_runs
SET status = 'failed', error = 'Stale run detected and force-cleaned'
WHERE status = 'running'
AND created_at < NOW() - INTERVAL '10 minutes';
```

### 0.7 Proactive Work Frequency

```sql
SELECT ar.agent_role,
  COUNT(*) FILTER (WHERE ar.task = 'proactive') AS proactive_runs,
  COUNT(*) FILTER (WHERE ar.task = 'work_loop') AS work_loop_runs,
  COUNT(*) FILTER (WHERE ar.task LIKE '%briefing%' OR ar.task LIKE '%orchestrate%' OR ar.task LIKE '%health%') AS scheduled_runs,
  COUNT(*) AS total_runs
FROM agent_runs ar
WHERE ar.created_at > NOW() - INTERVAL '7 days'
GROUP BY ar.agent_role
ORDER BY proactive_runs ASC;
```

### 0.8 Turn-1 Token Baseline

```sql
SELECT ar.agent_role,
  ROUND(AVG(ar.input_tokens) FILTER (WHERE ar.turns = 1), 0) AS avg_turn1_input,
  ROUND(AVG(ar.input_tokens) FILTER (WHERE ar.turns > 5), 0) AS avg_late_turn_input,
  ROUND(AVG(ar.input_tokens) FILTER (WHERE ar.turns > 5), 0)
    - ROUND(AVG(ar.input_tokens) FILTER (WHERE ar.turns = 1), 0) AS history_growth,
  COUNT(*) AS sample_size
FROM agent_runs ar
WHERE ar.created_at > NOW() - INTERVAL '7 days'
AND ar.status = 'completed'
GROUP BY ar.agent_role
HAVING COUNT(*) > 3
ORDER BY avg_turn1_input DESC;
```

- `avg_turn1_input > 35K` = paying 35K+ tokens before the agent starts working (system prompt + tool declarations).
- `history_growth` = tokens added by unbounded history across multi-turn runs.

---

## Phase 1: Token Optimization (Days 2–4)

**This is the highest-leverage work. Fix the token budget and most aborts disappear.**

### 1.1 Task-Scoped Tool Subsetting

**File:** `packages/agent-runtime/src/toolSubsets.ts` (NEW)

**Problem:** `getDeclarations()` returns ALL granted tools on every call. CMO gets 149+ tool declarations (~20K tokens) even for `weekly_content_planning`, which uses ~10 tools.

**Create a declarative mapping from (role, task) → required tools:**

```typescript
// toolSubsets.ts
export const TOOL_SUBSETS: Record<string, Record<string, string[] | null>> = {
  cmo: {
    weekly_content_planning: [
      'web_search', 'web_fetch',
      'save_memory', 'recall_memories',
      'read_my_assignments', 'submit_assignment_output',
      'flag_assignment_blocker',
      'send_agent_message', 'check_my_messages',
      // MCP tools: only content + social
      'mcp:marketing:schedule_social_post',
      'mcp:marketing:get_analytics',
    ],
    afternoon_publishing: [
      'web_search', 'web_fetch',
      'save_memory', 'recall_memories',
      'send_agent_message',
      'mcp:marketing:schedule_social_post',
      'mcp:marketing:get_analytics',
      'mcp:marketing:get_search_console_data',
    ],
    proactive: null, // null = full tool set (open-ended)
  },
  'chief-of-staff': {
    orchestrate: [
      'read_founder_directives', 'create_work_assignments',
      'dispatch_assignment', 'check_assignment_status',
      'evaluate_assignment',
      'send_agent_message', 'grant_tool_access',
      'query_knowledge_graph', 'get_company_pulse',
    ],
    briefing: [
      'read_founder_directives', 'check_assignment_status',
      'get_company_pulse', 'get_knowledge_routes',
      'recall_memories', 'query_knowledge_graph',
      'check_my_messages',
    ],
    proactive: null,
  },
  cto: {
    health_check: [
      'web_fetch',
      'save_memory', 'recall_memories',
      'send_agent_message',
      'mcp:engineering:get_cloud_run_status',
      'mcp:engineering:get_github_actions',
      'mcp:engineering:get_vercel_deployments',
    ],
    proactive: null,
  },
  cfo: {
    daily_costs: [
      'save_memory', 'recall_memories',
      'send_agent_message',
      'read_my_assignments', 'submit_assignment_output',
      'mcp:finance:get_stripe_mrr',
      'mcp:finance:get_mercury_balance',
      'mcp:finance:get_gcp_billing',
    ],
    proactive: null,
  },
  cpo: {
    usage_analysis: [
      'web_search', 'web_fetch',
      'save_memory', 'recall_memories',
      'send_agent_message',
      'mcp:data:query_analytics',
      'mcp:data:query_content',
    ],
    proactive: null,
  },
  // ADD ALL HIGH-FREQUENCY (role, task) PAIRS
  // Use query 0.8 results to identify which roles have the highest turn-1 token counts
  // and prioritize those for subset definitions.
};
```

**Integration point:** `packages/agent-runtime/src/baseAgentRunner.ts`

In the tool loading phase, after `getDeclarations()`:

```typescript
import { TOOL_SUBSETS } from './toolSubsets';

// After loading all tools:
const allTools = await getDeclarations(role, grants);
const subset = TOOL_SUBSETS[role]?.[task];
const tools = subset
  ? allTools.filter(t => subset.includes(t.name))
  : allTools; // null or undefined = send everything
```

**Expected savings:** CMO drops from 149 tools (~20K tokens) to ~12 tools (~2.5K tokens) = **~17,500 tokens saved per call**.

### 1.2 Conversation History Compression

**File:** `packages/agent-runtime/src/historyManager.ts` (NEW)

**Problem:** History grows linearly across turns with zero truncation. By turn 7, resending 40–50K tokens of prior turns including full JSON tool results.

```typescript
// historyManager.ts

interface HistoryConfig {
  maxHistoryTokens: number;       // total budget for history
  keepRecentTurns: number;        // always keep last N turns verbatim
  summarizeToolResults: boolean;  // truncate large tool results in older turns
  toolResultMaxTokens: number;    // per-result cap in older turns
}

const DEFAULT_CONFIG: HistoryConfig = {
  maxHistoryTokens: 15000,
  keepRecentTurns: 3,
  summarizeToolResults: true,
  toolResultMaxTokens: 500,
};

export function compressHistory(
  messages: Message[],
  config: HistoryConfig = DEFAULT_CONFIG
): Message[] {
  if (messages.length <= config.keepRecentTurns * 2) {
    return messages; // not enough history to compress
  }

  const recentCount = config.keepRecentTurns * 2; // user+assistant pairs
  const recent = messages.slice(-recentCount);
  const older = messages.slice(0, -recentCount);

  // Truncate large tool results in older turns
  const compressed = older.map(msg => {
    if (msg.role === 'tool' && estimateTokens(msg.content) > config.toolResultMaxTokens) {
      return {
        ...msg,
        content: truncateToTokens(msg.content, config.toolResultMaxTokens)
          + '\n[truncated — full result was used in prior turn]',
      };
    }
    // Also truncate long assistant responses in older turns
    if (msg.role === 'assistant' && estimateTokens(msg.content) > 800) {
      return {
        ...msg,
        content: truncateToTokens(msg.content, 800)
          + '\n[truncated]',
      };
    }
    return msg;
  });

  // If still over budget, drop oldest turns
  let result = [...compressed, ...recent];
  while (estimateTokens(JSON.stringify(result)) > config.maxHistoryTokens && result.length > recentCount) {
    result = result.slice(2); // drop oldest user+assistant pair
  }

  return result;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4); // rough approximation
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}
```

**Integration point:** `packages/agent-runtime/src/baseAgentRunner.ts`

In the agentic loop, before each model call:

```typescript
import { compressHistory } from './historyManager';

// Before step 6 (MODEL CALL):
const compressedMessages = compressHistory(conversationHistory);
// Pass compressedMessages to modelClient instead of raw conversationHistory
```

**Expected savings:** History drops from 40–50K to ~15K tokens = **~30,000 tokens saved per late-turn call**.

### 1.3 System Prompt Right-Sizing for Scheduled Tasks

**File:** `packages/agent-runtime/src/baseAgentRunner.ts` (MODIFY)

**Problem:** Heaviest scheduled tasks (briefings, content planning, usage analysis) use standard/full tier prompts (~10–14K tokens) but many protocol blocks are irrelevant to the specific task.

**Add a `scheduled` context tier** between `task` and `standard`:

```typescript
// In resolveContextTier():
// Add new case for known scheduled tasks:
if (task && SCHEDULED_TASKS.includes(task)) {
  return 'scheduled';
}

const SCHEDULED_TASKS = [
  'weekly_content_planning',
  'afternoon_publishing',
  'daily_costs',
  'afternoon_costs',
  'usage_analysis',
  'health_check',
  'content_calendar',
  'pipeline_review',
  'health_scoring',
];
```

The `scheduled` tier includes:
- ✅ Personality block
- ✅ Role brief
- ✅ Agent system prompt
- ✅ Company knowledge base
- ✅ Work assignments protocol
- ❌ REASONING_PROTOCOL (7-phase T+1 modeling) — not needed for routine tasks
- ❌ COLLABORATION_PROTOCOL (full 12-person org chart) — not needed unless the task involves delegation
- ❌ EXECUTIVE_ORCHESTRATION_PROTOCOL — only needed for orchestrate task
- ❌ ALWAYS_ON_PROTOCOL (capability owners directory) — only needed for proactive

**Expected savings:** ~3,000–4,000 tokens per call.

### 1.4 Combined Projection

After all three optimizations, a CMO `weekly_content_planning` turn-7 call:

| Component | Current | After | Savings |
|-----------|---------|-------|---------|
| System prompt | ~10,000 | ~7,000 | 3,000 |
| Tool declarations | ~20,000 | ~2,500 | 17,500 |
| Conversation history | ~45,000 | ~15,000 | 30,000 |
| User message + JIT | ~4,000 | ~4,000 | 0 |
| **TOTAL** | **~79,000** | **~28,500** | **50,500** |

At 28.5K input tokens, runs that currently abort at turn 7 will complete comfortably at turn 12+. Per-run cost drops ~60%.

---

## Phase 2: Abort/Cooldown Fixes (Days 3–5)

### 2.1 Graduated Cooldown

**File:** `packages/agent-runtime/src/workLoop.ts` (MODIFY)

**Current:** Flat 30-minute cooldown after any abort.

**Replace with cause-aware graduated cooldown:**

```typescript
// Replace the ABORT COOLDOWN CHECK section:

const COOLDOWN_MAP: Record<string, number> = {
  max_turns_exceeded: 5 * 60 * 1000,   // 5 min (was 30)
  timeout:            10 * 60 * 1000,  // 10 min (was 30)
  stall_detected:     15 * 60 * 1000,  // 15 min
  error:              30 * 60 * 1000,  // 30 min (keep for real errors)
};

function getAbortCooldown(agentRole: string, db: Pool): number {
  const lastAbort = getLastAbortedRun(agentRole);
  if (!lastAbort) return 0;

  const abortReason = classifyAbortReason(lastAbort.error);
  const consecutiveAborts = getConsecutiveAbortCount(agentRole, db);
  const baseCooldown = COOLDOWN_MAP[abortReason] ?? 30 * 60 * 1000;

  // Exponential backoff for consecutive aborts of same type
  return Math.min(
    baseCooldown * Math.pow(2, Math.max(0, consecutiveAborts - 1)),
    60 * 60 * 1000  // cap at 1 hour
  );
}

function classifyAbortReason(error: string | null): string {
  if (!error) return 'error';
  if (error.includes('max_turns_exceeded')) return 'max_turns_exceeded';
  if (error.includes('timeout') || error.includes('DEADLINE_EXCEEDED')) return 'timeout';
  if (error.includes('stall')) return 'stall_detected';
  return 'error';
}
```

### 2.2 Stale Run Reaper

**File:** `packages/scheduler/src/heartbeat.ts` (MODIFY)

**Add to the START of every heartbeat cycle, before any agent checks:**

```typescript
async function reapStaleRuns(db: Pool): Promise<number> {
  const STALE_THRESHOLD = '10 minutes'; // max timeout is 180s, 10 min is very safe
  const result = await db.query(`
    UPDATE agent_runs
    SET status = 'failed',
        error = 'Reaped: exceeded stale run threshold'
    WHERE status = 'running'
    AND created_at < NOW() - INTERVAL '${STALE_THRESHOLD}'
    RETURNING agent_role, id
  `);
  if (result.rowCount > 0) {
    console.warn(`[heartbeat] Reaped ${result.rowCount} stale runs:`,
      result.rows.map(r => `${r.agent_role} (${r.id})`));
  }
  return result.rowCount;
}

// Call at top of heartbeat handler:
// await reapStaleRuns(db);
```

### 2.3 Sarah Retry on Failure

**File:** `packages/scheduler/src/heartbeat.ts` (MODIFY)

**In the directive detection section, add retry with reduced scope:**

```typescript
async function handleDirectiveDetection(db: Pool) {
  const newDirectives = await getUndecomposedDirectives(db);
  if (newDirectives.length === 0) return;

  // Check if Sarah already attempted and failed recently
  const lastSarahRun = await db.query(`
    SELECT status, error, created_at
    FROM agent_runs
    WHERE agent_role = 'chief-of-staff'
    AND task IN ('orchestrate', 'work_loop')
    ORDER BY created_at DESC LIMIT 1
  `);

  const last = lastSarahRun.rows[0];
  const recentFailure = last
    && last.status !== 'completed'
    && (Date.now() - new Date(last.created_at).getTime()) < 15 * 60 * 1000;

  if (recentFailure) {
    // Retry: single directive, lighter context to avoid repeat abort
    const directive = newDirectives[0];
    console.log(`[heartbeat] Sarah retry: single directive ${directive.id}`);
    await wakeAgent('chief-of-staff', {
      task: 'orchestrate',
      message: `SINGLE DIRECTIVE FOCUS: Process ONLY directive ${directive.id}: "${directive.title}". Do not process other directives this run. Decompose into assignments and dispatch.`,
      contextTier: 'standard', // not full — save tokens
    });
  } else {
    // Normal wake
    await wakeAgent('chief-of-staff', { task: 'orchestrate' });
  }
}
```

### 2.4 Reduce Proactive Cooldowns

**File:** `packages/agent-runtime/src/workLoop.ts` (MODIFY)

**Update the P5 cooldown map:**

```typescript
// Replace proactive cooldown values:
const PROACTIVE_COOLDOWNS: Record<string, number> = {
  'chief-of-staff':  30 * 60 * 1000,  // 30 min (was 1 hour)
  'ops':             30 * 60 * 1000,  // 30 min (was 1 hour)
  'cto':             60 * 60 * 1000,  // 1 hour (was 2 hours)
  'cfo':             60 * 60 * 1000,  // 1 hour (was 2 hours)
  'cpo':             2 * 60 * 60 * 1000,  // 2 hours (was 4 hours)
  'cmo':             2 * 60 * 60 * 1000,  // 2 hours (was 4 hours)
  'vp-customer-success': 2 * 60 * 60 * 1000,
  'vp-sales':        2 * 60 * 60 * 1000,
  'vp-design':       2 * 60 * 60 * 1000,
  'vp-research':     2 * 60 * 60 * 1000,
  // sub-team default: 3 hours (was 6 hours)
};

function getProactiveCooldown(role: string): number {
  return PROACTIVE_COOLDOWNS[role] ?? 3 * 60 * 60 * 1000;
}
```

### 2.5 Assignment Timeout Escalation

**File:** `packages/agent-runtime/src/workLoop.ts` (MODIFY)

**Add before the P2 return in `executeWorkLoop`:**

```typescript
// Check for stale in_progress assignments before returning P2 work
const STALE_ASSIGNMENT_THRESHOLD = 2 * 60 * 60 * 1000; // 2 hours

const staleAssignment = activeAssignments.find(
  a => a.status === 'in_progress'
    && (Date.now() - new Date(a.updated_at).getTime()) > STALE_ASSIGNMENT_THRESHOLD
);

if (staleAssignment) {
  await db.query(`
    UPDATE work_assignments
    SET status = 'blocked',
        blocker_reason = 'Auto-escalated: in_progress for > 2 hours without update'
    WHERE id = $1
  `, [staleAssignment.id]);

  await emitEvent('assignment.blocked', {
    assignment_id: staleAssignment.id,
    agent_role: agentRole,
    reason: 'stale_timeout',
  });

  console.log(`[workLoop] Auto-escalated stale assignment ${staleAssignment.id} for ${agentRole}`);
  // Continue to check remaining assignments — don't return early
}
```

---

## Phase 3: Autonomous Work Generation (Days 5–10)

### 3.1 Standing Objectives Table

**Run this migration:**

```sql
CREATE TABLE standing_objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  objective TEXT NOT NULL,
  success_metric TEXT NOT NULL,
  check_frequency INTERVAL NOT NULL DEFAULT '4 hours',
  last_checked_at TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'medium',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_standing_objectives_role ON standing_objectives(agent_role);
CREATE INDEX idx_standing_objectives_active ON standing_objectives(active) WHERE active = true;
```

### 3.2 Seed Initial Objectives

```sql
INSERT INTO standing_objectives (agent_role, objective, success_metric, check_frequency, priority) VALUES

-- CMO
('cmo', 'Maintain a 2-week content pipeline with scheduled posts', 'Scheduled posts count > 10 for next 14 days', '6 hours', 'high'),
('cmo', 'Monitor brand mentions and competitor announcements', 'All brand mentions < 4 hours old have been reviewed', '2 hours', 'medium'),
('cmo', 'Keep social media engagement metrics trending up', 'Week-over-week engagement rate is stable or improving', '12 hours', 'medium'),

-- CTO
('cto', 'Keep all services healthy and deployed', 'Zero unresolved health check failures across all Cloud Run services', '2 hours', 'critical'),
('cto', 'Monitor CI/CD pipeline success rate', 'GitHub Actions success rate > 95% for last 24 hours', '4 hours', 'high'),
('cto', 'Track model provider latency and error rates', 'No provider error rate > 5% for last 6 hours', '4 hours', 'high'),

-- CFO
('cfo', 'Flag cost anomalies before they compound', 'No unreviewed spend spike > 20% persisting for > 6 hours', '4 hours', 'critical'),
('cfo', 'Track burn rate against monthly budget', 'Monthly spend projection is within 10% of budget', '8 hours', 'high'),
('cfo', 'Monitor revenue pipeline health', 'MRR, churn, and expansion metrics are current (< 24h old)', '12 hours', 'medium'),

-- CPO
('cpo', 'Track competitor feature launches and positioning changes', 'Competitor changelog reviewed within past 7 days', '24 hours', 'high'),
('cpo', 'Monitor product usage patterns for insights', 'Usage analysis completed within past 48 hours', '24 hours', 'medium'),

-- VP Sales
('vp-sales', 'Enrich pipeline with fresh account research', 'All active leads have research updated within 7 days', '12 hours', 'high'),
('vp-sales', 'Monitor enterprise prospect signals', 'Prospect monitoring report delivered within past 48 hours', '24 hours', 'medium'),

-- VP Customer Success
('vp-customer-success', 'Proactive churn risk outreach', 'All at-risk accounts (health score < 50) contacted within 48 hours', '8 hours', 'critical'),
('vp-customer-success', 'Track customer health scores', 'All active customer health scores refreshed within past 24 hours', '12 hours', 'high'),

-- VP Design
('vp-design', 'Audit live pages against design system', 'Zero unresolved design drift findings older than 72 hours', '24 hours', 'medium'),
('vp-design', 'Review component quality and consistency', 'Design system compliance check completed within past 7 days', '48 hours', 'medium'),

-- VP Research
('vp-research', 'Maintain current intelligence on key competitors', 'Competitive intelligence brief refreshed within past 7 days', '24 hours', 'high'),
('vp-research', 'Track emerging AI industry trends', 'Industry trend scan completed within past 14 days', '48 hours', 'medium'),

-- CoS
('chief-of-staff', 'Ensure all active directives are progressing', 'No directive has all assignments stalled for > 12 hours', '2 hours', 'critical'),
('chief-of-staff', 'Review and synthesize cross-department insights', 'Cross-department synthesis note produced within past 48 hours', '24 hours', 'high'),

-- Ops
('ops', 'Monitor system health and data freshness', 'All data syncs completed within their scheduled windows', '1 hour', 'critical'),
('ops', 'Track agent run success rates', 'No agent has > 30% failure rate over past 24 hours', '2 hours', 'high');
```

### 3.3 Rewrite P5 Proactive Logic

**File:** `packages/agent-runtime/src/workLoop.ts` (MODIFY)

**Replace the existing P5 proactive section with objective-driven work selection:**

```typescript
// P5: OBJECTIVE-DRIVEN PROACTIVE WORK
// (replaces generic "look around" proactive prompt)

async function checkStandingObjectives(
  agentRole: string,
  db: Pool
): Promise<WorkLoopResult | null> {
  const result = await db.query(`
    SELECT id, objective, success_metric, check_frequency, priority
    FROM standing_objectives
    WHERE agent_role = $1
    AND active = true
    AND (
      last_checked_at IS NULL
      OR last_checked_at < NOW() - check_frequency
    )
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 0
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
      END,
      last_checked_at ASC NULLS FIRST
    LIMIT 1
  `, [agentRole]);

  if (result.rows.length === 0) return null;

  const obj = result.rows[0];

  // Mark as checked to prevent re-triggering before frequency
  await db.query(
    `UPDATE standing_objectives SET last_checked_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [obj.id]
  );

  return {
    shouldRun: true,
    contextTier: 'standard',
    task: 'proactive',
    message: [
      `STANDING OBJECTIVE: ${obj.objective}`,
      `SUCCESS METRIC: ${obj.success_metric}`,
      `PRIORITY: ${obj.priority}`,
      ``,
      `Instructions:`,
      `1. Check the current state of this metric using your available tools.`,
      `2. If the metric is NOT met, take concrete action to improve it.`,
      `3. If the metric IS met, briefly confirm status.`,
      `4. Save a memory summarizing what you found and any actions taken.`,
      `5. If you cannot make progress, flag the blocker via send_agent_message to your manager.`,
    ].join('\n'),
  };
}

// In executeWorkLoop, replace P5 section:
// const objectiveWork = await checkStandingObjectives(agentRole, db);
// if (objectiveWork) return objectiveWork;
//
// // Fall through to generic proactive only if no objectives due
// // (keeps existing proactive as fallback)
```

### 3.4 Sarah Initiative Proposal (Weekly)

**Add new cron job:**

| Job ID | Agent | Cron (UTC) | Local (CT) | Task |
|--------|-------|-----------|------------|------|
| `cos-initiative-proposal` | Sarah Chen | `0 13 * * 1` | Mon 8:00 AM | Weekly initiative proposals |

**Cron message:**

```
Review the company's current state across all departments. Consider:
- Standing objective results from the past week (which metrics are consistently unmet?)
- Agent reflections and knowledge graph contradictions
- Company pulse data and financial trends
- Competitive intelligence updates

Identify 2-3 cross-functional initiatives that would meaningfully advance the company this week. For each initiative, specify:
- Objective: what specifically will be accomplished
- Involved agents: which agents need to collaborate
- Expected deliverable: the tangible output
- Estimated effort: number of agent runs / hours

Submit each as a proposed directive via propose_directive() for founder approval.
```

### 3.5 Inter-Agent Work Requests (Lower Priority)

**Migration:**

```sql
CREATE TABLE agent_work_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  request TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  authority_tier TEXT NOT NULL DEFAULT 'green',
  status TEXT NOT NULL DEFAULT 'pending',
  response TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_work_requests_to ON agent_work_requests(to_agent, status);
```

**Add to workLoop.ts between P2 and P3 as P2.5:**

```typescript
// P2.5: PEER WORK REQUESTS
const peerRequests = await db.query(`
  SELECT id, from_agent, request, priority
  FROM agent_work_requests
  WHERE to_agent = $1 AND status = 'pending'
  ORDER BY
    CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1
      WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
    created_at ASC
  LIMIT 1
`, [agentRole]);

if (peerRequests.rows.length > 0) {
  const req = peerRequests.rows[0];
  await db.query(
    `UPDATE agent_work_requests SET status = 'in_progress', updated_at = NOW() WHERE id = $1`,
    [req.id]
  );
  return {
    shouldRun: true,
    contextTier: 'standard',
    task: 'work_loop',
    message: `PEER REQUEST from ${req.from_agent} (priority: ${req.priority}):\n${req.request}\n\nComplete this request and send your response via send_agent_message to ${req.from_agent}.`,
  };
}
```

**Add `create_peer_work_request` tool** to communicationTools.ts for agents to use.

---

## Verification Checklist (Day 14)

Re-run all Phase 0 diagnostic queries and verify:

- [ ] Abort rate < 5% across all agents (was likely 15–30%+)
- [ ] No `status='running'` rows older than 10 minutes
- [ ] Sarah orchestration runs produce > 0 assignments when directives exist
- [ ] Avg turn-1 input tokens < 15K for agents with tool subsets
- [ ] Avg late-turn input tokens < 35K (down from 70K+)
- [ ] Proactive runs > 0 for all executive agents in past 7 days
- [ ] Work assignments move from pending → completed in < 4 hours avg
- [ ] No assignments stuck in `in_progress` for > 2 hours
- [ ] Standing objectives are being checked per their defined frequency
- [ ] Post-abort cooldown gaps are 5–15 minutes (not 30)

---

## File Change Summary

| File | Action | Phase |
|------|--------|-------|
| `packages/agent-runtime/src/toolSubsets.ts` | NEW | 1 |
| `packages/agent-runtime/src/historyManager.ts` | NEW | 1 |
| `packages/agent-runtime/src/baseAgentRunner.ts` | MODIFY — integrate tool subsetting + history compression + scheduled tier | 1 |
| `packages/agent-runtime/src/workLoop.ts` | MODIFY — graduated cooldown, reduced proactive cooldowns, assignment escalation, standing objectives, peer requests | 2+3 |
| `packages/scheduler/src/heartbeat.ts` | MODIFY — stale run reaper, Sarah retry logic | 2 |
| `packages/agents/src/shared/communicationTools.ts` | MODIFY — add `create_peer_work_request` tool | 3 |
| `packages/scheduler/src/cronManager.ts` | MODIFY — add `cos-initiative-proposal` weekly cron | 3 |
| Cloud SQL migration | standing_objectives table + seed data + agent_work_requests table | 3 |

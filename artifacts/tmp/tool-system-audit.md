# Tool System & Eval Infrastructure Audit

> Generated: 2026-03-18

---

## 1. Tool Registry

**Master list location:** `packages/agent-runtime/src/toolRegistry.ts:17` — export: `KNOWN_TOOLS` (a `Set<string>`), with public functions `isKnownTool()`, `getAllKnownTools()`, `filterKnownTools()`, `buildSearchableToolDescription()`, `loadRegisteredTool()`.

**Total tools:** **642 unique tool names** in the static `KNOWN_TOOLS` set, plus dynamic tools loaded from the `tool_registry` DB table at runtime.

**Defined in one place or many?** Hybrid:

| Location | Pattern | Purpose |
|----------|---------|---------|
| `packages/agent-runtime/src/toolRegistry.ts:17` | `KNOWN_TOOLS` Set | Central validation registry (single source of truth) |
| `packages/agents/src/*/tools.ts` (~30 files) | `createXTools()` factories | Per-agent tool implementations |
| `packages/mcp-*/src/tools.ts` | MCP server tools | External service integrations (Slack, Email, Data, Design, etc.) |
| `tool_registry` DB table | Dynamic registration | Runtime-registered tools (non-compiled) |

**Tool definition data structure** — `packages/agent-runtime/src/types.ts:81-130`:

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  deferLoading?: boolean;
  execute: (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  filesWritten?: number;
  memoryKeysWritten?: number;
  constitutional_check?: { checked: boolean; violations: number; blocked: boolean; };
}
```

---

## 2. Tool Assignment Per Agent

**Mechanism: Dynamically computed at dispatch time via semantic retrieval.** The old `toolSubsets.ts` has been **deleted** (no file found). It was replaced by the `ToolRetriever`.

**Primary function:** `ToolRetriever.retrieve()` in `packages/agent-runtime/src/routing/toolRetriever.ts:421-470`

**Called from** `baseAgentRunner.ts:527-545`:

```typescript
const retriever = getToolRetriever();
const retrieval = await retriever.retrieve(effectiveTools, {
  model: modelForRetrieval,
  role: config.role,
  taskContext: buildToolTaskContext({
    message: initialMessage,
    task: taskForContext,
    role: config.role,
    recentTools: actionReceipts.map((receipt) => receipt.tool),
  }),
});
effectiveTools = retrieval.tools;
```

### Four-tier selection strategy (`toolRetriever.ts:430-460`)

1. **Role pins** via `getAlwaysLoadedTools(role)` — defined in `toolSearchConfig.ts:93` under `ALWAYS_LOADED.roles`
2. **Core pins** — `CORE_PINNED_TOOLS` set (`toolRetriever.ts:41-65`)
3. **Department pins** — `DEPARTMENT_PINS` map (`toolRetriever.ts:67-81`)
4. **BM25 + vector hybrid retrieval** — 35% BM25 / 65% vector, filling remaining slots up to model cap

### Model capacity tiers — `getModelCap()` (`toolRetriever.ts:121-137`)

| Model | Cap |
|-------|-----|
| `gpt-5.4`, `claude-opus-4-6` | 128 |
| `claude-sonnet-4-6` | 100 |
| `gpt-5`, `gpt-4.1`, `claude-sonnet-4-5`, `gemini-3.1-pro` | 64 |
| `gpt-5-mini`, `gpt-4.1-mini` | 40 |
| `claude-haiku-4-5`, `gemini-3.1-flash-lite`, `gpt-5-nano`, `gpt-4.1-nano` | 20-25 |

**Largest tool surface:** Agents using `gpt-5.4` or `claude-opus-4-6` models get up to **128 tools**. Chief-of-staff has the most role-specific pins (5 always-loaded + core pins).

**Smallest tool surface:** Agents running on nano models get **20 tools** max.

### Tool2Vec / Semantic Retrieval — ACTIVE and fully implemented

- `tool2vec-queries.json` at repo root — maps tool names to natural language usage queries for semantic embedding.
- 384-dimensional vectors in `toolRetriever.ts:37`, `VECTOR_DIMENSIONS = 384`.
- Hybrid scoring: BM25 keyword matching (35%) + cosine similarity vectors (65%).
- Additional support for **Anthropic server-side tool search** (`USE_TOOL_SEARCH_ANTHROPIC`) and **OpenAI tool search** (`USE_TOOL_SEARCH_OPENAI`) — both gated by env vars in `toolSearchConfig.ts:3-4`.

---

## 3. Tool Call Execution

**Dispatch site:** `baseAgentRunner.ts:633-636`:

```typescript
const result = await toolExecutor.execute(call.name, call.args, {
  agentId: config.id, agentRole: config.role, turnNumber,
  abortSignal: supervisor.signal, memoryBus, emitEvent,
  glyphorEventBus: safeDeps.glyphorEventBus,
});
```

**Execution engine:** `ToolExecutor.execute()` in `toolExecutor.ts:509-1050`. Pre-execution checks: emergency block, rate limit (60/hr), budget, behavioral anomaly detection, constitutional pre-check for `HIGH_STAKES_TOOLS`.

### Tool Call Logging — YES, captured via 4 mechanisms

#### 1. In-memory `ToolCallLog[]` (`toolExecutor.ts:473-492`)

Fields captured: `agentId`, `agentRole`, `toolName`, `args`, `result` (full `ToolResult`), `estimatedCostUsd`, `timestamp`

Written at line 923 (success) and line 951 (failure).

```typescript
export interface ToolCallLog {
  agentId: string;
  agentRole: CompanyAgentRole;
  toolName: string;
  args: Record<string, unknown>;
  result: ToolResult;
  estimatedCostUsd: number;
  timestamp: string;
}
```

#### 2. Tool reputation tracking — DB-persisted, fire-and-forget (`toolReputationTracker.ts:57-68`)

```typescript
recordToolCall(toolName, toolSource, success, timedOut, latencyMs)
```

Calls Postgres `update_tool_stats()` function. Called at `toolExecutor.ts:938-939` (success) and `toolExecutor.ts:965-966` (failure).

#### 3. Event emission (`baseAgentRunner.ts:629`)

```
{ type: 'tool_call',   agentId, turnNumber, toolName, params }
{ type: 'tool_result',  agentId, turnNumber, toolName, success, filesWritten, memoryKeysWritten }
```

#### 4. Security event logging for blocked/denied tools

`SecurityEventType` variants (`types.ts:533-542`): `TOOL_NOT_GRANTED`, `SCOPE_VIOLATION`, `RATE_LIMITED`, `BUDGET_EXCEEDED`, `CONSTITUTIONAL_BLOCK`, `BEHAVIORAL_ANOMALY`, `TOOL_VERIFICATION_BLOCK`, `DATA_EVIDENCE_MISSING`.

### Middleware/wrapper layer

Yes — `ToolExecutor.execute()` is the single execution wrapper. All agents route through it. Logging can be injected there without modifying individual agents.

---

## 4. Tool Call Results

**Result returned to agent at** `baseAgentRunner.ts:644-655`:

```typescript
const resultContent = result.data !== undefined ? JSON.stringify(result.data) : result.error ?? 'ok';
history.push({ role: 'tool_result', content: resultContent, toolName: call.name, toolResult: result, timestamp: Date.now() });
emitEvent({ type: 'tool_result', agentId: config.id, turnNumber, toolName: call.name, success: result.success, filesWritten: result.filesWritten ?? 0, memoryKeysWritten: result.memoryKeysWritten ?? 0 });

actionReceipts.push({
  tool: call.name,
  params: call.args,
  result: result.success ? 'success' : 'error',
  output: (resultContent ?? '').slice(0, 500),
  timestamp: new Date().toISOString(),
  constitutional_check: result.constitutional_check,
});
```

The result is pushed into conversation `history` as a `tool_result` turn and fed back to the model on the next iteration.

**Validation of correct result usage:** No direct validation that the agent used a tool result correctly. However:

- `supervisor.recordToolResult(call.name, result)` at line 659 tracks progress and aborts if no progress is detected.
- `ActionReceipt[]` accumulated at lines 648-655 are attached to the final result for transparency.

### Tool call failures caught and recorded — YES

- `ToolExecutor.execute()` has a `try/catch` at `toolExecutor.ts:943` that creates a `failResult` and logs via `logToolCall()` and `recordToolCall()`.
- `trackToolFailure()` at `toolExecutor.ts:976-1028` — tracks repeated failures per tool, auto-escalates to `activity_log` for CTO visibility after **3 failures within 1 hour**.
- Timeout failures detected: `Promise.race([toolPromise, timeoutPromise, abortPromise])`.

---

## 5. Existing Eval Touchpoints

### Do evaluators look at tool calls specifically?

**No — they evaluate final output only.**

| Evaluator | Location | What it evaluates |
|-----------|----------|-------------------|
| CoS `evaluate_assignment` | `chief-of-staff/tools.ts:2085-2200` | `quality_score` + text assessment of agent output. No tool call parsing. |
| Constitutional evaluator | `constitutionalGovernor.ts`, called at `baseAgentRunner.ts:787-790` | `initialMessage` + `lastTextOutput` against principles. Does not examine tool calls. |
| Triangulation/judge | `triangulation/judge.ts` | Routes evaluation; no tool-specific scoring found. |
| `agentKnowledgeEvaluator.ts` | `packages/scheduler/src/agentKnowledgeEvaluator.ts:49-56` | Agent output vs scenario `pass_criteria` / `fail_indicators` from `agent_eval_scenarios` table. Registered for 6 agents: `cmo`, `cto`, `cfo`, `content-creator`, `seo-analyst`, `social-media-manager`. No tool-specific scenario definitions found in codebase. |

### Scoring keyword search results

| Keyword | Found? |
|---------|--------|
| `tool_accuracy` | **Not found** |
| `tool_score` | **Not found** |
| `tool_eval` | **Not found** |
| `tool_selection` | **Not found** |

### Tool reputation (separate system)

`toolReputationTracker.ts` — tracks per-tool reliability stats (success rate, latency, timeouts, downstream defects) in the `tool_reputation` DB table. This feeds tool health monitoring, **not** agent performance scoring.

---

## 6. Current Eval System State

### Table creation status

| Table | Status | Migration File |
|-------|--------|----------------|
| `assignment_evaluations` | **CREATED** | `db/migrations/20260319000200_assignment_evaluations.sql` |
| `agent_prompt_versions` | **CREATED** | `db/migrations/20260318200000_agent_prompt_versions.sql` |
| `world_state` | **CREATED** | `db/migrations/20260318200200_world_state.sql` |

### `task_run_outcomes.assignment_id` — EXISTS

Column defined at `db/migrations/20260307120000_task_run_outcomes.sql:11`. Backfill migration: `db/migrations/20260319000700_backfill_task_run_outcomes.sql` links `agent_runs` → `work_assignments` by time-window matching.

### Coverage query (run manually against DB)

```sql
SELECT COUNT(*) AS total, COUNT(assignment_id) AS linked,
ROUND(COUNT(assignment_id)::numeric / NULLIF(COUNT(*),0) * 100, 1) AS coverage_pct
FROM task_run_outcomes;
```

### Current `performance_score` formula

**File:** `db/migrations/20260319000300_compute_performance_scores_v2.sql:5-105`

Standard formula (both exec and team data available):

```
score = 40% * ((exec_quality + team_quality) / 2)    -- output quality
      + 25% * success_rate                             -- completed runs
      + 20% * constitutional_score                     -- constitutional compliance
      + 15% * cos_quality                              -- CoS quality grade
      - fleet_findings penalties
```

**Fleet findings penalties:**
- P0 unresolved: -0.15 each, capped at -0.30
- P1 unresolved: -0.05 each, capped at -0.10

**Fallback formulas** redistribute weights when exec or team data is missing.

---

## 7. Agent Inventory

**Total agents seeded:** **36** (from `combined_migration.sql:860-910`, migration `20260224100000_ensure_all_agents`)

### Full agent list by department

| Department | Agent ID | Name | Title |
|------------|----------|------|-------|
| Operations | `chief-of-staff` | Sarah Chen | Chief of Staff |
| Operations | `ops` | Atlas Vega | Operations |
| Administration | `global-admin` | Morgan Blake | Global Admin |
| Administration | `m365-admin` | Riley Morgan | M365 Admin |
| Engineering | `cto` | Marcus Reeves | CTO |
| Engineering | `platform-engineer` | Alex Park | Platform Engineer |
| Engineering | `quality-engineer` | Sam DeLuca | Quality Engineer |
| Engineering | `devops-engineer` | Jordan Hayes | DevOps Engineer |
| Product | `cpo` | Elena Vasquez | CPO |
| Product | `user-researcher` | Priya Sharma | User Researcher |
| Product | `competitive-intel` | Daniel Ortiz | Competitive Intel |
| Finance | `cfo` | Nadia Okafor | CFO |
| Finance | `revenue-analyst` | Anna Park | Revenue Analyst |
| Finance | `cost-analyst` | Omar Hassan | Cost Analyst |
| **Marketing** | `cmo` | Maya Brooks | CMO |
| **Marketing** | `content-creator` | Tyler Reed | Content Creator |
| **Marketing** | `seo-analyst` | Lisa Chen | SEO Analyst |
| **Marketing** | `social-media-manager` | Kai Johnson | Social Media Manager |
| Customer Success | `vp-customer-success` | James Turner | VP Customer Success |
| Customer Success | `onboarding-specialist` | Emma Wright | Onboarding Specialist |
| Customer Success | `support-triage` | David Santos | Support Triage |
| Sales | `vp-sales` | Rachel Kim | VP Sales |
| Sales | `account-research` | Nathan Cole | Account Research |
| Design | `vp-design` | Mia Tanaka | VP Design |
| Design | `ui-ux-designer` | Leo Vargas | UI/UX Designer |
| Design | `frontend-engineer` | Ava Chen | Frontend Engineer |
| Design | `design-critic` | Sofia Marchetti | Design Critic |
| Design | `template-architect` | Ryan Park | Template Architect |
| Legal | `clo` | Victoria Chase | CLO |
| Research | `vp-research` | Sophia Lin | VP Research |
| Research | `competitive-research-analyst` | Lena Park | Competitive Research Analyst |
| Research | `market-research-analyst` | Daniel Okafor | Market Research Analyst |
| Research | `technical-research-analyst` | Kai Nakamura | Technical Research Analyst |
| Research | `industry-research-analyst` | Amara Diallo | Industry Research Analyst |
| HR | `head-of-hr` | (seeded) | Head of HR |

### Marketing department agents (4)

`cmo`, `content-creator`, `seo-analyst`, `social-media-manager`

### Agents with no tool assignments

All agents receive tools dynamically via `ToolRetriever.retrieve()` at runtime. Any agent whose `run.ts` calls a `createXTools()` factory has tools. Agents without a dedicated `tools.ts` factory (e.g., newer research sub-agents) may rely solely on core pinned tools + semantic retrieval from the shared pool. No agents are explicitly configured with zero tools.

---

## 8. baseAgentRunner.ts Specific

### assignmentId + directiveId write path — APPLIED

**Extraction** — `baseAgentRunner.ts:190-197`:

```typescript
if (t.content.startsWith(ASSIGNMENT_ID_TURN_PREFIX)) {
  config.assignmentId = config.assignmentId ?? t.content.slice(ASSIGNMENT_ID_TURN_PREFIX.length);
  return false;
}
if (t.content.startsWith(DIRECTIVE_ID_TURN_PREFIX)) {
  config.directiveId = config.directiveId ?? t.content.slice(DIRECTIVE_ID_TURN_PREFIX.length);
  return false;
}
```

**Harvester call** — `baseAgentRunner.ts:930-936`:

```typescript
void harvestTaskOutcome(result, {
  runId: config.id,
  agentRole: config.role,
  assignmentId: config.assignmentId ?? undefined,
  directiveId: config.directiveId ?? undefined,
}).catch(() => {});
```

Both `assignmentId` and `directiveId` are threaded through and written to the harvester.

### Runner variants — 4 primary + 2 auxiliary

| Runner | File | Purpose |
|--------|------|---------|
| `BaseAgentRunner` (abstract) | `packages/agent-runtime/src/baseAgentRunner.ts` | Shared execution infrastructure |
| `CompanyAgentRunner` | `packages/agent-runtime/src/companyAgentRunner.ts` | Default/backward-compat runner |
| `OrchestratorRunner` | `packages/agent-runtime/src/orchestratorRunner.ts` | Decomposition/delegation (CoS, CTO, VP-Research, CLO, Ops) |
| `TaskRunner` | `packages/agent-runtime/src/taskRunner.ts` | Domain executors (CFO, CPO, CMO, sub-teams) |
| `VerifierRunner` | `packages/agent-runtime/src/verifierRunner.ts` | Formal verification |
| `shadowRunner` | `packages/agent-runtime/src/shadowRunner.ts` | A/B shadow testing |

All exported from `packages/agent-runtime/src/index.ts`.

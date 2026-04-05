# Claude Code vs Glyphor — Architectural Mismatch Analysis (Second Pass)

**Date:** 2026-04-05
**Purpose:** Two-column comparison of actual repo design vs Glyphor's target architecture, plus Glyphor-native replacement designs.

---

## Two-Column Assessment

### Control Model

| Claude Code (Actual) | Glyphor (Required) |
|---|---|
| Human-initiated request-response. Nothing runs until a user types. The `query()` loop spins only while a human waits. | Heartbeat-scheduled continuous operation. Cloud Scheduler triggers runs. Agents wake on events, timers, messages, and urgency signals. Human sets direction, not instructions. |
| Control plane is Commander.js CLI parsing → REPL → `query()` loop. | Control plane is `scheduler/server.ts` → `EventRouter` → `WakeRouter` → `DynamicScheduler` → `HeartbeatManager` → agent runtime. |
| No background dispatch. Feature-gated `PROACTIVE` and `AGENT_TRIGGERS` are aspirational, not operational. | Background dispatch is the default mode. On-demand chat is the exception, not the rule. |

### Task Model

| Claude Code (Actual) | Glyphor (Required) |
|---|---|
| Task = one model turn or tool call within a conversation. `TaskType` enum: `local_bash`, `local_agent`, `remote_agent`, `in_process_teammate`, `local_workflow`, `monitor_mcp`, `dream`. All session-scoped, process-scoped. | Task = a tracked work unit with lifecycle: `draft` → `assigned` → `running` → `completed/failed/blocked/cancelled`. Persisted in `work_assignments`. Linked to directives, agents, initiatives, approvals. |
| No task decomposition engine. The model decides what to do next. | Explicit task decomposition: directives → assignments → subtasks. `WorkflowOrchestrator` with steps, retry, wait conditions, cancellation. |
| Tasks die with the session. No resume across restarts (except `--resume` for the conversation). | Tasks survive process restarts. State in PostgreSQL. Heartbeat re-checks. Assignment ownership persists. |

### Session Model

| Claude Code (Actual) | Glyphor (Required) |
|---|---|
| One human, one session, one conversation. `QueryEngine` created per session. Session = JSONL transcript file on disk. | No "sessions" in the assistant sense. Agent runs are tracked in `agent_runs`. Conversations persist in `chat_messages`. Work persists in `work_assignments`. State is organizational, not conversational. |
| Resume = reload JSONL transcript and continue the conversation. | Resume = query `agent_runs` for last run state, reload context from `JitContextRetriever`, continue from where the task left off in the database. |
| Session identity = random ID. No persistent agent identity across sessions. | Agent identity = `company_agents.id` + role + profile + skills + trust score + constitutional bounds. Permanent. |

### Memory Model

| Claude Code (Actual) | Glyphor (Required) |
|---|---|
| Memory = `FileStateCache` (what files have been read this session) + optional CLAUDE.md files + session transcript. Session-scoped. Discarded on exit. | Memory = PostgreSQL-backed `agent_memory` (episodic), `company_knowledge_base` (shared), `kg_nodes`/`kg_edges` (graph), `memory_lifecycle` (managed decay), `memory_archive` (long-term). Organizational and persistent. |
| `memdir/memdir.ts` loads memory files from `~/.claude/memory/`. Static, file-based, user-scoped. | `CompanyMemoryStore` with embedding-backed semantic retrieval, graph queries, shared episodes, world model state, and memory consolidation jobs. |
| No memory consolidation, archival, or contradiction detection. | `memoryConsolidator.ts`, `memoryArchiver.ts`, `memoryConsolidationGates.ts`, `contradictionProcessor.ts`. Active memory lifecycle management. |

### Identity Model

| Claude Code (Actual) | Glyphor (Required) |
|---|---|
| No agent identity. The "agent" is whatever system prompt is loaded. `AgentDefinition` = name + system prompt + tools. Disposable. | Rich agent identity: `company_agents` (role, model, temperature, thinking, trust score), `agent_profiles` (display name, avatar, brief), `agent_skills`, `agent_reasoning_config`, `agent_constitutions`. Permanent. |
| Coordinator and workers are prompt-engineered personas, not distinct entities. | Agents are first-class entities with independent schedules, skills, performance history, trust scores, and constitutional bounds. |
| No concept of agent performance history or capability tracking. | `agent_performance`, `agent_growth`, `agent_milestones`, `agent_readiness`, `agent_eval_scenarios`, `agent_eval_results`. Rich performance tracking. |

### Orchestration Model

| Claude Code (Actual) | Glyphor (Required) |
|---|---|
| Flat: coordinator spawns workers via `AgentTool`. Workers are recursive `query()` calls. No hierarchy beyond parent-child. | Hierarchical: CEO → VP → specialist. `executive_orchestration_config`. `teamOrchestrationTools`. `delegation_performance`. Authority tiers gate what each level can do. |
| Coordinator prompt says "parallelize" but there's no real parallelism planner. The model decides. | `routeSubtask` computes per-turn routing. `assigneeRouting` dispatches to the best agent. `subtaskRouter` classifies complexity and selects model tier. Deliberate routing. |
| No dependency tracking between worker tasks. | `WorkflowOrchestrator` with ordered steps, wait conditions, and retry. `plan_verifications` validates plans before execution. |

### Reasoning Model

| Claude Code (Actual) | Glyphor (Required) |
|---|---|
| Reasoning = model's native chain-of-thought (thinking tokens). The system prompt says "think step by step." No orchestration around reasoning. | Reasoning = `ReasoningEngine` with configurable passes, budget-aware verification, value gate (`evaluateValue` aborts low-value work). `cotEngine`, `deepDiveEngine`, `strategyLabEngine` for structured analytical reasoning. |
| No self-critique, no multi-pass verification, no confidence scoring. | `formalVerifier` with multi-pass evidence checking. `verifierRunner` for cross-model verification. `trustScorer` adjusts confidence based on constitutional outcomes. |
| Model output is accepted as-is unless a stop hook blocks it. | Model output goes through: constitutional pre-check → execution → constitutional post-eval → trust scoring → decision chain tracking. |

### Tool Model

| Claude Code (Actual) | Glyphor (Required) |
|---|---|
| Tools are functions the model can call. Rich lifecycle: `inputSchema`, `validateInput`, `checkPermissions`, `call`, `isReadOnly`, `isDestructive`, `isConcurrencySafe`. Well-engineered. | Tools are also functions, but with additional governance: `tool_registry` (registered with metadata), `agent_tool_grants` (per-agent access), `tool_reputation` (success/failure tracking), `tool_call_traces` (audit trail with risk level). |
| Tool permission = binary allow/deny/ask per tool. User prompted interactively. | Tool permission = ABAC (attribute-based access control) + constitutional pre-check + budget verification + evidence gate + cross-agent verifier. Layered, not binary. |
| No tool reputation. No tracking of which tools fail or succeed for which tasks. | `toolReputationTracker.ts`, `tool_reputation` table. Repeated failures trigger escalation. |

### Governance Model

| Claude Code (Actual) | Glyphor (Required) |
|---|---|
| Governance = permission rules in settings files. Allow/deny/ask per tool with pattern matching. Managed settings from enterprise MDM. | Governance = `authorityGates.ts` (tiered authority), `decisionQueue.ts` (human-in-loop escalation), `constitutionalGovernor.ts` (constitutional enforcement), `policyLimits` (org restrictions), `platform_audit_log`, `platform_iam_state`. |
| No approval workflows. No authority tiers. No escalation chains. | `directiveApproval.ts`, `changeRequestHandler.ts`, `dashboard_change_requests`. Multi-step approval with founder gates. |
| Bypass permissions mode exists (gated). No concept of graduated authority. | Authority tiers from agent → team lead → VP → CEO → founder. Each tier can approve different action classes. |

### Trust Model

| Claude Code (Actual) | Glyphor (Required) |
|---|---|
| No trust model. All agents are equally trusted within their permission scope. | `trustScorer.ts` — dynamic trust deltas from constitutional outcomes, verifier confidence, and run quality. `agent_trust_scores` table. Trust affects routing and autonomy level. |
| No concept of agent reliability or track record. | `agent_reliability_metrics`, `reliability_run_ledger`. Performance-aware task routing via `agent_capacity_and_commitment_registry`. |

### Verification Model

| Claude Code (Actual) | Glyphor (Required) |
|---|---|
| No verification. Tool results are accepted. Model output is accepted. Stop hooks can block but don't verify. | Multi-layer verification: `formalVerifier` (budget/evidence), `constitutionalPreCheck` (pre-execution), `constitutionalGovernor` (post-execution), `verifierRunner` (cross-model), `plan_verifications` (plan approval). |
| The `TRANSCRIPT_CLASSIFIER` feature (ant-only) does some auto-mode safety classification. | Verification is the default, not a feature flag. Every high-stakes action goes through the verification pipeline. |

### Context Model

| Claude Code (Actual) | Glyphor (Required) |
|---|---|
| Context = conversation messages + file state cache + optional memory prefetch. Assembled per-turn in `queryLoop()`. 4-layer compaction manages size. | Context = `JitContextRetriever` (just-in-time semantic retrieval) + shared memory + profile context + compressed history via `historyManager`. Per-agent, per-task, relevance-scoped. |
| Context is conversation-bound. No cross-agent context sharing. | Context sources include: agent memory, shared company knowledge, knowledge graph, world model state, peer communications, and directive context. Cross-agent by design. |

### Scaling Model

| Claude Code (Actual) | Glyphor (Required) |
|---|---|
| Single process. Coordinator spawns workers as child processes or in-process tasks. No distributed execution. | Cloud Run services. Multiple scheduler replicas. Worker queue via Cloud Tasks. `parallelDispatch.ts` for concurrent agent runs. `distributed_orchestration` schema. |
| Max concurrency = `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` (10 tool calls). | Max concurrency = fleet of agents across Cloud Run instances, each with supervisor-bounded turns. |

### UX Model

| Claude Code (Actual) | Glyphor (Required) |
|---|---|
| Terminal REPL. Human types, AI responds. Interactive permission prompts. Spinner while thinking. | Dashboard. Operator sets directives. Agents execute autonomously. Approvals surfaced as cards. Status shown as fleet health. Chat is one surface, not the primary one. |
| Human is the worker, AI is the helper. | AI is the worker, human sets direction. |

### Auditability Model

| Claude Code (Actual) | Glyphor (Required) |
|---|---|
| JSONL transcript files. Session storage. Cost tracking. Some telemetry events. | `platform_audit_log`, `activity_log`, `constitutional_gate_events`, `decision_traces`, `tool_call_traces`, `agent_runs` with cost/latency. Full audit trail with risk classification. |
| No structured audit trail. Transcript is the only record. | Every action, decision, approval, and escalation is logged with agent, timestamp, risk level, and evidence. |

---

## Direct Answers

### 1. What can strengthen Glyphor immediately?

- **Streaming tool executor** (`StreamingToolExecutor.ts`) — add concurrent tool dispatch to Glyphor's `ToolExecutor`
- **Microcompact** (`microCompact.ts`) — truncate stale tool results per-turn to prevent context bloat
- **Tool result size budgeting** (`applyToolResultBudget` in `query.ts`) — persist large results to disk, inject previews
- **Graduated supervisor recovery** (8k → 64k → multi-turn → abort) — reduce unnecessary run failures
- **Prompt cache stability** (stable tool ordering, latched headers) — reduce per-call cost across the fleet
- **Zero-wait memory prefetch** pattern — fire retrieval early, consume only if settled
- **Pre/post tool hook pipeline** (`hookRunner.ts`) — generalize Glyphor's existing gates into composable hooks

### 2. What would mislead Glyphor if copied blindly?

- **`QueryEngine` as the execution core** — it's conversation-scoped. Glyphor needs task-scoped execution.
- **Coordinator-as-prompt-engineering** — Glyphor's orchestration should be code, not system prompt text.
- **The permission prompting model** — interactive user approval doesn't work for autonomous agents. Glyphor needs ABAC + authority tiers.
- **Memory as file cache** — copying `FileStateCache` would regress from Glyphor's persistent memory architecture.
- **The `while(true)` query loop as the universal primitive** — it works for conversations but not for structured workflow execution with steps, waits, and retries.
- **Session-scoped everything** — copying the session model would lose Glyphor's organizational state persistence.

### 3. What concepts are absent because of the human-centered model?

- **Standing objectives** — no concept of "goals that persist beyond a conversation"
- **Agent schedules** — no concept of "this agent runs every 6 hours"
- **Directive decomposition** — no concept of "break this strategic goal into tracked work assignments"
- **Peer accountability** — no concept of "this agent's output is checked by another agent"
- **Institutional knowledge** — no concept of "the company knows X" vs "this session knows X"
- **Authority escalation** — no concept of "this action requires VP approval"
- **World model updates** — no concept of "update what we believe about our capabilities"
- **Performance-based routing** — no concept of "route this task to the agent that's best at it"
- **Proactive monitoring** — no concept of "check on this every hour and alert if it changes"
- **Value analysis before execution** — no concept of "is this task worth doing?"

### 4. If Glyphor borrowed only 15% of this repo, which 15%?

1. `services/tools/StreamingToolExecutor.ts` — concurrent tool dispatch
2. `services/compact/microCompact.ts` — per-tool-result truncation
3. `services/compact/autoCompact.ts` — summarization threshold logic
4. `query.ts` lines 370-395 — `applyToolResultBudget()` call pattern
5. `query.ts` lines 1062-1306 — graduated recovery escalation logic
6. `hooks/hookRunner.ts` — composable pre/post hook pipeline
7. `Tool.ts` — the `isConcurrencySafe`, `isDestructive`, `isReadOnly` lifecycle flags
8. `tools.ts` `assembleToolPool()` — cache-stable tool ordering with MCP dedup
9. `utils/startupProfiler.ts` — phased checkpoint pattern for observability
10. `utils/queryProfiler.ts` — per-turn profiling with slow-operation detection
11. `query/stopHooks.ts` — turn-end lifecycle hooks (teammate idle, task completed)
12. `services/tools/toolExecution.ts` lines 1-200 — schema → validate → permission → hook → execute → hook pipeline

That's ~12 files, roughly 15% of the meaningful architecture. Everything else is CLI plumbing, UI, or assistant-shaped product logic.

---

## 5. Glyphor-Native Replacement for QueryEngine.ts

### Name: `AgentExecutionEngine`

**Purpose:** Execute a single agent run against a task, with full lifecycle management from context assembly through tool execution to result persistence and quality evaluation.

**Responsibilities:**
- Load agent config (role, model, temperature, constitution, trust score, tool grants)
- Assemble context from JIT retrieval, shared memory, task history, and directive context
- Execute the model turn loop with tool dispatch
- Enforce supervisor constraints (turns, timeout, stall, budget)
- Run constitutional pre-check and post-evaluation
- Track trust deltas and tool reputation
- Persist run results, cost, latency, and quality score
- Emit events to the Glyphor event bus
- Support both scheduled runs and on-demand chat

**Boundaries:**
- Does NOT own scheduling or dispatch — that's the scheduler's job
- Does NOT own memory persistence — delegates to `CompanyMemoryStore`
- Does NOT own approval workflows — delegates to `authorityGates`
- Does NOT own inter-agent routing — delegates to `assigneeRouting`

**Required Interfaces:**
```typescript
interface AgentExecutionEngine {
  execute(params: AgentRunParams): AsyncGenerator<RunEvent>;
  abort(reason: string): void;
  getRunState(): AgentRunState;
  getUsage(): RunUsage;
}

interface AgentRunParams {
  agentId: string;
  role: CompanyAgentRole;
  task: TaskDescriptor;          // not a "prompt" — a structured task
  contextSources: ContextSource[];
  toolGrants: ToolGrant[];
  constitution: ConstitutionalBounds;
  supervisorConfig: SupervisorConfig;
  budget: RunBudget;
}
```

**Anti-patterns to avoid:**
- Do NOT make it conversation-scoped — make it task-scoped
- Do NOT let the model decide what to do — provide explicit task descriptors
- Do NOT use session-scoped memory — load from organizational memory
- Do NOT make it disposable — persist run state for resume and audit
- Do NOT skip verification — constitutional checks are not optional

---

## 6. Glyphor-Native Replacement for tools.ts

### Name: `ToolSurface` (already partially exists as `ToolExecutor`)

**Purpose:** Assemble, filter, and manage the available tool pool for a specific agent run, with governance-aware selection and execution.

**Responsibilities:**
- Load agent's tool grants from `agent_tool_grants`
- Load tool definitions from tool registry + MCP servers
- Filter by: grants, deny rules, ABAC policy, agent role, task type
- Sort for prompt cache stability
- Provide tool metadata for model schema generation
- Track tool reputation during execution
- Support dynamic tool discovery (MCP reconnection, runtime registration)
- Report tool usage and failure patterns for fleet analysis

**Boundaries:**
- Does NOT own tool execution — that's `ToolExecutor`
- Does NOT own permission prompting — there is no permission prompting in autonomous operation
- Does NOT own tool implementation — tools are self-contained modules

**Required Interfaces:**
```typescript
interface ToolSurface {
  assemble(params: ToolAssemblyParams): Tool[];
  getToolByName(name: string): Tool | undefined;
  getToolDeclarations(): ToolDeclaration[];  // for model schema
  reportToolOutcome(toolName: string, outcome: ToolOutcome): void;
  refreshMcpTools(): Promise<void>;
}

interface ToolAssemblyParams {
  agentId: string;
  role: CompanyAgentRole;
  taskType: string;
  grants: ToolGrant[];
  abacContext: AbacContext;
  mcpConnections: McpConnection[];
}
```

**Anti-patterns to avoid:**
- Do NOT use interactive permission prompts — use ABAC + constitutional gates
- Do NOT treat tools as static — support dynamic discovery and runtime registration
- Do NOT ignore tool reputation — filter out chronically failing tools
- Do NOT couple tool assembly to a single session — make it reusable across runs

---

## 7. Glyphor-Native Replacement for commands.ts

### Name: `TaskCatalog` (partially exists as skill playbooks + tool registry)

**Purpose:** Register, compose, and discover the available work capabilities across the organization — not interactive commands, but executable task patterns.

**Responsibilities:**
- Register skill playbooks (department-scoped, versioned, with execution patterns)
- Register tool-backed capabilities (what each tool can accomplish, not just its API)
- Compose task patterns from skills + tools + agent capabilities
- Support task discovery: "what can we do about X?" → relevant skills/tools/agents
- Track capability gaps: "we have no skill for Y"
- Support capability routing: "which agent/team is best for this task pattern?"

**Boundaries:**
- Does NOT own execution — that's `AgentExecutionEngine`
- Does NOT own scheduling — that's the scheduler
- Does NOT own slash commands — there are no slash commands in an AI-run company
- Does NOT own model invocation — it's a registry, not a runner

**Required Interfaces:**
```typescript
interface TaskCatalog {
  getCapabilities(filter: CapabilityFilter): TaskCapability[];
  getSkillsForRole(role: CompanyAgentRole): SkillPlaybook[];
  findCapabilityMatch(taskDescription: string): CapabilityMatch[];
  getCapabilityGaps(): CapabilityGap[];
  registerSkill(skill: SkillPlaybook): void;
  registerToolCapability(tool: string, capability: ToolCapability): void;
}

interface CapabilityFilter {
  department?: string;
  taskType?: string;
  requiredTools?: string[];
  minConfidence?: number;        // based on historical success rate
}
```

**Anti-patterns to avoid:**
- Do NOT model this as "slash commands" — these are organizational capabilities, not user interactions
- Do NOT make it static — capabilities evolve as agents learn and tools are added
- Do NOT ignore performance history — a capability that always fails isn't a real capability
- Do NOT couple it to a single agent — capabilities are organizational, not individual
- Do NOT skip versioning — skill playbooks evolve and old versions should be auditable

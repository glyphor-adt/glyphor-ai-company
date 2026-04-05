# Claude Code → Glyphor Strategic Architecture Analysis

**Date:** 2026-04-04
**Repo:** claude-code-main/src (Anthropic's Claude Code CLI)
**Lens:** Glyphor operating model — AI-run company, not AI assistant

---

## 1. Executive Summary

### What This Repo Fundamentally Is

Claude Code is a **single-user AI coding assistant** that runs in a terminal. It takes a human's instruction, calls an LLM, executes tools (file edits, shell commands, web fetches), and iterates until the task is done. It is architecturally a **copilot with multi-agent extensions bolted on**.

The coordinator mode (`COORDINATOR_MODE`) adds a manager-worker pattern, but the entire system still runs inside one user session, one process tree, one conversation context. There is no persistent organizational state, no heartbeat scheduler, no authority hierarchy, no world model, and no institutional memory.

### Architectural Classification

**Copilot** with **orchestration aspirations**. Not a coding agent framework. Not an autonomous system. Not an organizational platform.

### 10 Highest-Value Ideas for Glyphor

1. **Streaming tool executor** with concurrent/serial batching based on tool safety classification
2. **4-layer context compaction** (snip → microcompact → collapse → autocompact) with reactive recovery
3. **Tool permission architecture** — per-tool `checkPermissions()`, `validateInput()`, `isDestructive()`, `isConcurrencySafe()` lifecycle
4. **Budget tracking at three levels** — USD hard cap, server-side task budget with compaction-aware remaining, token budget with diminishing-returns detection
5. **Prompt cache management** — cache-key prefix stability, latch-based beta header stickiness, compaction notification to invalidate caches
6. **Supervisor turn limits** with multi-recovery escalation (8k → 64k output tokens → multi-turn resume → abort)
7. **Tool result size budgeting** — large results persisted to disk, replaced with previews in context
8. **Pre/post tool hooks** — extensible hook pipeline for policy injection, blocking, and result enrichment
9. **Skill discovery during execution** — prefetched in parallel with model streaming, injected between turns
10. **Memory prefetch with zero-wait consumption** — fires once, consumed opportunistically, deduped against file state cache

### 10 Biggest Architectural Gaps vs Glyphor

1. **No persistent agent identity** — agents exist only within a session/query scope
2. **No heartbeat/scheduler** — purely request-response; nothing runs without a human prompt
3. **No authority hierarchy** — no tiers, no approval thresholds, no escalation chains
4. **No world model** — no capability tracking, performance history, or competence-based routing
5. **No institutional memory** — memory is session-scoped file cache; no shared episodic/procedural memory
6. **No trust scoring** — no per-agent or per-tool reliability tracking
7. **No contradiction detection** — no cross-source fact verification
8. **No governance layer** — permissions are binary allow/deny, not tiered policy with audit trail
9. **No inter-agent communication fabric** — coordinator/worker is parent-child, not peer mesh
10. **No continuous operation** — no background monitoring, no follow-up dispatch, no proactive behavior (except behind feature flags)

---

## 2. What QueryEngine.ts, tools.ts, and commands.ts Really Do

### QueryEngine.ts — The Conversation Lifecycle Manager

**Role:** Owns one conversation's state across multiple turns. Wraps the `query()` agentic loop with SDK message emission, transcript persistence, and session bookkeeping.

**Importance:** HIGH — this is the execution core.

**What it controls:**
- System prompt assembly (via `fetchSystemPromptParts`)
- User input processing (via `processUserInput`)
- The `query()` turn loop (delegation)
- SDK message yielding (result, stream events, compact boundaries)
- File state cache, usage tracking, permission denials
- Structured output enforcement

**Useful for Glyphor:**
- Budget tracking pattern (maxBudgetUsd, taskBudget with compaction-aware remaining)
- System prompt composition pattern (base + user context + system context + coordinator context)
- Transcript persistence model (recordTranscript at multiple checkpoints)

**Too assistant-shaped:**
- One QueryEngine per conversation — no multi-tenant sharing
- No persistent identity — engine is created and discarded per session
- No handoff protocol — can't transfer a conversation to another agent
- Memory is file-state cache, not organizational knowledge

### tools.ts — The Tool Registry

**Role:** Assembles the available tool pool from built-in tools + MCP tools, filtered by permissions.

**Importance:** MEDIUM — plumbing, but the filtering/composition pattern matters.

**What it controls:**
- `getAllBaseTools()` — master list of ~40 built-in tools
- `getTools()` — filtered by permission context, REPL mode, feature flags, isEnabled()
- `assembleToolPool()` — merges built-in + MCP, deduplicates, sorts for cache stability
- `filterToolsByDenyRules()` — blanket deny enforcement

**Useful for Glyphor:**
- Tool pool assembly with MCP integration and dedup
- Permission-aware filtering at composition time (not just call time)
- Cache-stability sorting (built-in prefix, MCP suffix)

**Too assistant-shaped:**
- Tool surface is static per session — no dynamic tool discovery based on task requirements
- No tool reputation or reliability tracking
- No tool routing based on agent capability or historical performance

### commands.ts — The Slash Command Registry

**Role:** Registers and composes the slash command surface from built-ins + skills + plugins + workflows + MCP.

**Importance:** LOW for Glyphor — this is interactive CLI plumbing.

**What it controls:**
- `COMMANDS()` — built-in slash commands
- `loadAllCommands(cwd)` — loads skills, plugins, workflows
- `getCommands(cwd)` — filters by availability and enablement
- `getSkillToolCommands()` — model-invocable skills
- Feature-flag gating and internal-only separation

**Useful for Glyphor:**
- Skill/plugin/workflow composition pattern — how to merge multiple command sources with priority ordering
- Dynamic skill discovery (file-operation-triggered)
- The `PromptCommand` type — skills as injectable prompt content, not hard-coded logic

**Too assistant-shaped:**
- Commands are interactive CLI affordances, not organizational work units
- No concept of task decomposition, dependency ordering, or parallel dispatch

---

## 3. Real Execution Flow

```
User types prompt
  │
  ├─ handlePromptSubmit() — exit detection, reference expansion
  │
  ├─ processUserInput() — slash command routing OR text prompt creation
  │   ├─ PromptCommand → content blocks → shouldQuery: true
  │   ├─ LocalCommand → execute locally → shouldQuery: false
  │   └─ Text prompt → user message → shouldQuery: true
  │
  ├─ QueryEngine.submitMessage() [or REPL calls query() directly]
  │   ├─ Resolve model, thinking config
  │   ├─ Fetch system prompt parts (base + user + system + coordinator)
  │   ├─ Process user input (hooks, attachments)
  │   ├─ Record transcript
  │   └─ Enter query() loop
  │
  └─ query() → queryLoop() [while(true)]
      │
      ├─ 1. CONTEXT PREP
      │   ├─ Memory prefetch (fire once, zero-wait)
      │   ├─ Skill discovery prefetch (per iteration)
      │   ├─ Tool result budget enforcement
      │   ├─ Snip compaction (token-aware trim)
      │   ├─ Microcompact (per-tool truncation)
      │   ├─ Context collapse (read-time projection)
      │   ├─ Autocompact (full summarization if over threshold)
      │   └─ Blocking limit check
      │
      ├─ 2. API CALL
      │   ├─ callModel() with streaming
      │   ├─ Backfill tool inputs for observers
      │   ├─ Withhold recoverable errors
      │   ├─ Feed tools to StreamingToolExecutor as they arrive
      │   └─ Yield completed streaming results
      │
      ├─ 3. POST-STREAMING
      │   ├─ Post-sampling hooks
      │   ├─ Abort handling
      │   └─ Yield previous turn's tool summaries
      │
      ├─ 4. NO TOOL CALLS → TERMINAL
      │   ├─ Prompt-too-long recovery (collapse → reactive compact)
      │   ├─ Max output tokens recovery (escalate → multi-turn)
      │   ├─ Stop hooks
      │   ├─ Token budget check
      │   └─ return { reason: 'completed' }
      │
      └─ 5. TOOL CALLS → EXECUTE & CONTINUE
          ├─ StreamingToolExecutor batches concurrent/serial
          ├─ Per-tool pipeline:
          │   schema validation → tool validation → speculative classifier
          │   → pre-hooks → permission resolution → EXECUTE → post-hooks
          ├─ Collect results + attachments
          ├─ Inject memory/skill/queue attachments
          ├─ Max turns check
          └─ state = next; continue
```

---

## 4. Useful Patterns for Glyphor

### 4.1 Streaming Tool Executor
- **Path:** `services/tools/StreamingToolExecutor.ts`
- **What:** Executes tools in parallel as they stream from the model. Concurrent-safe tools run immediately; writes wait for exclusive access.
- **Why useful:** Glyphor's ToolExecutor already has sequential execution. Adding streaming overlap would reduce turn latency.
- **Action:** ADAPT — add streaming dispatch to Glyphor's `ToolExecutor`, but extend with cross-agent tool coordination.
- **Subsystem:** tool execution

### 4.2 4-Layer Context Compaction
- **Paths:** `services/compact/snipCompact.js`, `microCompact.ts`, `autoCompact.ts`, `reactiveCompact.js`, `services/contextCollapse/`
- **What:** Hierarchical context management: token-aware trimming → per-result truncation → summarization → emergency recovery
- **Why useful:** Glyphor agents run long sessions. The `historyManager` compaction is single-layer. A multi-tier approach would prevent both context overflow and unnecessary summarization.
- **Action:** ADAPT — implement tiered compaction in Glyphor's `historyManager`. Add microcompact for tool results. Add reactive compact as a 413 recovery path.
- **Subsystem:** context engine

### 4.3 Tool Result Size Budgeting
- **Path:** `query.ts` → `applyToolResultBudget()`
- **What:** Enforces per-message token budget on tool results. Large results persisted to disk, replaced with preview + file path in context.
- **Why useful:** Glyphor tools (SharePoint reads, code search) can return massive results that blow context. This pattern bounds them gracefully.
- **Action:** COPY — implement in Glyphor's `ToolExecutor` post-execution pipeline.
- **Subsystem:** tool execution, context engine

### 4.4 Pre/Post Tool Hooks
- **Path:** `hooks/hookRunner.ts`, `services/tools/toolExecution.ts`
- **What:** Extensible pipeline around every tool call. Pre-hooks can block/modify. Post-hooks can enrich results.
- **Why useful:** Glyphor already has constitutional pre-check and verifier. This pattern generalizes it into a composable pipeline.
- **Action:** ADAPT — Glyphor's existing gates (constitutional, budget, evidence, verifier) should be refactored into a formal hook pipeline.
- **Subsystem:** governance, trust/verification

### 4.5 Budget Tracking with Compaction Awareness
- **Path:** `QueryEngine.ts` (maxBudgetUsd), `query.ts` (taskBudget with remaining tracking)
- **What:** Task-level budget that survives compaction. When context is summarized, the pre-compact token spend is subtracted from the remaining budget.
- **Why useful:** Glyphor tracks cost per run but not per-task with compaction-aware remaining. This prevents budget circumvention through compaction.
- **Action:** ADAPT — add compaction-aware remaining tracking to Glyphor's run cost tracking.
- **Subsystem:** governance, auditability

### 4.6 Supervisor Recovery Escalation
- **Path:** `query.ts` lines 1062-1306
- **What:** Multi-step recovery: 8k → 64k output tokens → multi-turn resume (3 attempts) → abort. Prompt-too-long: collapse → reactive compact → surface error.
- **Why useful:** Glyphor's supervisor aborts on max turns/timeout but doesn't escalate. Adding graduated recovery would reduce unnecessary failures.
- **Action:** ADAPT — add escalation tiers to `AgentSupervisor`.
- **Subsystem:** reasoning engine, task routing

### 4.7 Skill Discovery Prefetch
- **Path:** `query.ts` lines 331-335, `services/skillSearch/prefetch.ts`
- **What:** Discovers relevant skills in parallel with model streaming. Injected between turns as attachment messages.
- **Why useful:** Glyphor's skill system is static at run start. Dynamic discovery during execution would let agents adapt to emerging task requirements.
- **Action:** ADAPT — add turn-level skill discovery to Glyphor's `JitContextRetriever`.
- **Subsystem:** context engine, org intelligence

### 4.8 Memory Prefetch with Zero-Wait Consumption
- **Path:** `query.ts` line 301, `utils/attachments.ts`
- **What:** Fires embedding-based memory retrieval once at query entry. Consumed only if settled (zero blocking). Deduped against file state cache.
- **Why useful:** Glyphor's `JitContextRetriever` blocks on retrieval. Zero-wait consumption would reduce latency.
- **Action:** ADAPT — add fire-and-forget prefetch to JIT context loading.
- **Subsystem:** context engine

### 4.9 Tool Permission Lifecycle
- **Path:** `Tool.ts` (checkPermissions, validateInput, isDestructive, isConcurrencySafe, isReadOnly)
- **What:** Per-tool safety metadata + validation + permission flow. Tools self-declare their risk profile.
- **Why useful:** Glyphor's tools have some of this (read-only, mutative flags) but not the full lifecycle. Adding `isConcurrencySafe` would enable concurrent tool execution.
- **Action:** ADAPT — extend Glyphor's `ToolDefinition` with concurrency safety and destructiveness flags.
- **Subsystem:** tool execution, governance

### 4.10 Prompt Cache Stability Engineering
- **Path:** `tools.ts` `assembleToolPool()` (sort order), `query.ts` (latch-based beta headers)
- **What:** Tool definitions sorted for cache-key prefix stability. Beta headers latched per-session to prevent mid-session cache thrashing.
- **Why useful:** Glyphor agents make many model calls. Cache stability reduces cost.
- **Action:** COPY — implement stable tool ordering in Glyphor's tool declaration pipeline.
- **Subsystem:** developer workflow, cost management

---

## 5. Copilot Bias and Structural Limits

### What's Missing and Why It Matters

| Missing Concept | Why It Matters for Glyphor | What Would Need Redesign |
|---|---|---|
| **Persistent agent identity** | Glyphor agents have names, roles, profiles, schedules. Claude Code agents exist only within a query scope. | QueryEngine would need an `agentId` that persists across sessions and links to performance history. |
| **Heartbeat scheduler** | Glyphor agents run on heartbeat cycles. Claude Code only runs when prompted. | The entire execution model would need a control plane that dispatches `query()` calls on schedule. |
| **Authority hierarchy** | Glyphor has CEO → VP → specialist tiers with approval gates. Claude Code has flat coordinator → worker. | The coordinator prompt would need to be replaced with a real authority resolution engine. |
| **World model** | Glyphor tracks agent capabilities, weaknesses, and task history. Claude Code has no performance memory. | A new subsystem would be needed to track execution outcomes and feed them back into routing. |
| **Trust scoring** | Glyphor's TrustScorer adjusts agent reliability. Claude Code has no equivalent. | Trust would need to wrap tool execution and agent spawning. |
| **Contradiction detection** | Glyphor detects conflicting knowledge claims. Claude Code does not. | A post-tool verification layer would be needed. |
| **Institutional memory** | Glyphor persists episodic, procedural, and shared memory. Claude Code's memory is session file cache. | The entire memory architecture would need to be replaced with a persistent store. |
| **Evidence-grounded governance** | Glyphor's constitutional governor and evidence gates enforce grounded outputs. Claude Code has no equivalent. | A governance layer would need to wrap the query loop. |
| **Inter-agent communication** | Glyphor has a mailbox/event bus. Claude Code's SendMessage is parent→child only. | The message routing would need to support peer-to-peer and broadcast patterns. |
| **Forward simulation** | Glyphor's strategy lab runs simulations before executing. Claude Code executes immediately. | A pre-execution evaluation layer would be needed. |

### Product Philosophy Mismatch

Claude Code assumes the **human is the worker** and the **AI is the helper**. Every UX decision reflects this:
- The human types, the AI responds
- The human approves tool use, the AI asks
- The human decides what to do next, the AI suggests
- Sessions start and end with the human

Glyphor assumes the **AI is the worker** and the **human sets direction**. This inverts every assumption:
- The system decides what to do next based on directives and schedules
- The system executes autonomously within authority bounds
- The system reports results, not asks for instructions
- Sessions are continuous, not request-response

---

## 6. Engineering Patterns

### Query Planning
- **Implementation:** No explicit query planning. The model decides what tools to call. The system just executes and loops.
- **Relevance to Glyphor:** Low. Glyphor needs deliberate planning (subtask decomposition, dependency ordering). This repo's "let the model figure it out" approach is insufficient for organizational work.

### File Targeting Heuristics
- **Implementation:** `GlobTool`, `GrepTool`, `FileReadTool` with path validation. No semantic targeting.
- **Relevance to Glyphor Fuse:** Medium. The tools themselves are useful patterns. But Glyphor needs file targeting driven by task context, not just model intuition.

### Validation Loops
- **Implementation:** Per-tool `validateInput()`, schema validation, stop hooks, max-output recovery.
- **Relevance:** High. The graduated validation (schema → tool-specific → permission → hook) is a good pattern. Glyphor should formalize this.

### Evidence Capture
- **Implementation:** Tool results are the only evidence. No explicit evidence tracking or grounding verification.
- **Relevance:** Glyphor's evidence gate (`data-evidence gate` in `ToolExecutor`) is architecturally superior. Nothing to learn here.

### Observability
- **Implementation:** Startup profiler, query profiler, OpenTelemetry, Datadog, 1P event logging, session activity signals.
- **Relevance:** High. The startup/query profiler checkpoint pattern is clean engineering. Glyphor should adopt the phased-checkpoint approach for agent run observability.

---

## 7. Glyphor-Specific Recommendations

### 10 Architecture Ideas for Glyphor Overall
1. Add streaming tool execution with concurrent/serial batching based on tool safety flags
2. Implement 3-tier context compaction (microcompact → auto-summarize → reactive recovery)
3. Add tool result size budgeting with disk persistence for large results
4. Refactor constitutional/budget/evidence/verifier gates into a composable hook pipeline
5. Add compaction-aware budget tracking that survives context summarization
6. Add graduated supervisor recovery (escalate output limits → multi-turn resume → abort)
7. Add turn-level skill discovery that runs in parallel with model calls
8. Add fire-and-forget memory prefetch with zero-wait consumption
9. Add prompt cache stability engineering (stable tool ordering, latched headers)
10. Add phased profiler checkpoints for agent run observability

### 10 Ideas for Fuse
1. Streaming tool execution — overlap file reads with model streaming
2. Tool result budgeting — prevent large code search results from blowing context
3. Microcompact for tool results — truncate stale file reads and shell outputs automatically
4. Graduated recovery on context overflow — don't just abort, try compaction first
5. File state cache — track what files have been read to avoid redundant reads
6. Concurrent-safe tool classification — let reads run in parallel
7. Schema validation before tool execution — catch bad inputs early
8. Tool search/discovery — lazy-load tool schemas only when needed
9. Pre/post tool hooks for policy injection — extensible without modifying tool code
10. Prompt cache prefix stability — reduce cost by keeping tool definitions in stable order

### 5 Ideas for Org-Level Orchestration
1. Adapt the coordinator prompt pattern — but replace prompt engineering with a real authority resolution engine
2. Use the task notification XML format for async inter-agent result delivery
3. Adopt the scratchpad directory pattern for cross-agent shared state
4. Use the `querySource` tag pattern to distinguish agent roles in execution telemetry
5. Implement `matchSessionMode()` style resume consistency checking for agent state recovery

### 5 Ideas for Reasoning/Verification
1. Add stop hooks that can inject blocking errors and force retry (not just abort)
2. Add post-sampling hooks for constitutional evaluation of model output
3. Add speculative classifier for high-stakes tool calls (run safety check in parallel with permission)
4. Add tool use summary generation (async Haiku call during next model streaming)
5. Add token budget with diminishing-returns detection to prevent wasteful continuation

### 5 Ideas for Governance/Trust
1. Add `isDestructive()` flag to all mutative tools — enforce higher scrutiny
2. Add `isConcurrencySafe()` to enable safe parallel execution
3. Add tool reputation tracking based on success/failure rates
4. Add pre-tool hooks that can block based on policy without modifying tool code
5. Add permission escalation from worker to coordinator (the `handleCoordinatorPermission` pattern)

### 5 Ideas for Transparency / Showing Work
1. Adopt the tool use summary pattern — generate human-readable summaries of what tools did
2. Adopt the query profiler checkpoint pattern for agent run timeline visibility
3. Use the SDK message streaming pattern for real-time progress visibility
4. Adopt transcript persistence at multiple checkpoints (not just end of run)
5. Use the `ToolProgress` streaming pattern for long-running tool operations

### 5 Things Glyphor Should NOT Copy
1. **The single-session mental model** — Glyphor's architecture is fundamentally multi-session, multi-agent
2. **Permission prompting as the governance layer** — Glyphor needs authority tiers, not user prompts
3. **Coordinator-as-prompt-engineering** — Glyphor's orchestration should be a real control plane, not a system prompt
4. **Memory-as-file-cache** — Glyphor's memory is organizational, not session-scoped
5. **The "human is the worker" product philosophy** — every UX decision in this repo assumes the human does the work

---

## 8. Next Files To Inspect

| File | Why | Question | Strategic? |
|---|---|---|---|
| `services/tools/StreamingToolExecutor.ts` | Core concurrent tool execution | How does streaming dispatch actually work? | YES |
| `services/compact/autoCompact.ts` | Full summarization logic | How does it decide what to preserve? | YES |
| `services/compact/microCompact.ts` | Per-result truncation | What heuristics truncate tool results? | YES |
| `coordinator/coordinatorMode.ts` | Full coordinator prompt | What organizational patterns does the prompt encode? | YES |
| `tools/AgentTool/runAgent.ts` | Subagent lifecycle | How does tool/permission scoping work for workers? | YES |
| `utils/permissions/permissions.ts` | Permission resolution | How does the full allow/deny/ask chain work? | MODERATE |
| `services/tools/toolExecution.ts` | Per-tool execution pipeline | Full hook/validation/execution chain | YES |
| `hooks/hookRunner.ts` | Hook composition | How are pre/post hooks composed and ordered? | MODERATE |
| `utils/fileStateCache.ts` | Read deduplication | How does it prevent redundant file reads? | MODERATE |
| `query/stopHooks.ts` | Turn-end lifecycle | How do teammate/job/memory hooks fire? | YES |

---

## 9. Final Judgment

### What This Repo Understands Well
- **Tool execution engineering** — the streaming executor, permission lifecycle, and concurrent batching are well-designed
- **Context pressure management** — the 4-layer compaction hierarchy is sophisticated and battle-tested
- **Cost awareness** — budget tracking at multiple levels with compaction awareness
- **Incremental extension** — the hook/plugin/skill/MCP composition model is clean

### What This Repo Does Not Understand
- **Organizational intelligence** — there is no concept of a workforce, roles, or institutional knowledge
- **Continuous operation** — everything is request-response
- **Hierarchical governance** — permissions are binary, not tiered
- **Self-improvement** — there is no learning loop
- **Forward planning** — there is no value analysis before execution

### Why This Repo Is Not a Template for Glyphor
This repo is a well-engineered **copilot** that has grown multi-agent extensions through prompt engineering (coordinator mode) and recursive `query()` calls (subagents). But the core architecture is still **one human, one session, one conversation**. Glyphor's architecture is **many agents, continuous operation, organizational state, hierarchical authority**. The gap is not feature-level — it's foundational.

### What Glyphor Should Steal
- Streaming tool execution with safety-based batching
- Multi-tier context compaction
- Tool result size budgeting
- Pre/post tool hook pipeline
- Prompt cache stability engineering
- Query/startup profiler checkpoint pattern
- Budget tracking with compaction awareness

### What Glyphor Should Rethink
- Coordinator mode — Glyphor should not rely on prompt engineering for orchestration
- The `query()` loop as the universal execution primitive — Glyphor's execution engine should be task-aware, not conversation-aware
- Memory as file state cache — Glyphor's memory should be organizational, persistent, and shared

### What Glyphor Should Ignore
- The CLI/REPL UX layer — irrelevant to Glyphor's operating model
- The slash command system — interactive affordances for humans
- The permission prompting UX — Glyphor needs authority tiers, not user dialogs
- Voice mode, buddy companion, bridge mode — product features for a consumer assistant
- The "human is the worker" philosophy encoded in every interaction pattern

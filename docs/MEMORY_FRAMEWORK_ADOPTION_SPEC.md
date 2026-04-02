# Memory Framework Adoption Spec (Glyphor)

This spec adapts high-value memory patterns from `claude-code-main` into `glyphor-ai-company` without replacing the existing DB-centric memory system.

Goals:
- Preserve long-session continuity with lower prompt token usage.
- Improve retrieval precision by selecting only the most useful memory blocks.
- Reduce context drift after compaction.
- Reuse existing runtime extension points (`ToolExecutor` hooks, `contextInjector`, event telemetry).

Non-goals:
- Replacing `CompanyMemoryStore` with file-based memories.
- Introducing a full vector DB redesign.
- Breaking existing autonomous role behavior.

## Current Baseline (Verified)

- Conversation context is composed in `packages/agent-runtime/src/baseAgentRunner.ts` and `packages/agent-runtime/src/companyAgentRunner.ts`.
- Prompt context passes through `composeModelContext` in `packages/agent-runtime/src/context/contextComposer.ts`.
- Micro-compaction exists via `microCompactHistory` in `packages/agent-runtime/src/context/microCompactor.ts`.
- JIT retrieval returns `relevantMemories`, `relevantKnowledge`, `relevantProcedures`, and `relevantGraphNodes` in `packages/agent-runtime/src/jitContextRetriever.ts`.
- `relevantGraphNodes` are retrieved but not currently injected in runner prompt sections.

## Target Architecture

Add three coordinated layers:

1) Session Summary Memory (post-model update)
- Maintain a rolling summary per conversation/session.
- Update after model turn completion when thresholds are met.
- Use this summary during compaction as a higher-fidelity anchor.

2) Selector Stage for JIT Context
- Add a second-stage relevance selector on top of current retrieval.
- Select top K candidates (default 3-5) for prompt injection.
- Emit freshness and source diagnostics for observability.

3) Summary-First Compaction
- Before aggressive clipping, include session summary + recent raw turns.
- Fall back to existing compressor behavior when summary is unavailable.

## Data Model Changes

### New table: `conversation_memory_summaries`

```sql
create table if not exists conversation_memory_summaries (
  id bigserial primary key,
  tenant_id text not null,
  user_id text,
  conversation_id text not null,
  session_id text,
  summary_text text not null,
  summarized_upto_message_id text,
  summarized_upto_created_at timestamptz,
  source_turn_count integer not null default 0,
  source_tool_count integer not null default 0,
  source_token_estimate integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, conversation_id)
);

create index if not exists idx_conv_mem_summary_updated
  on conversation_memory_summaries (tenant_id, updated_at desc);
```

### Optional table: `conversation_memory_events` (debug/audit)

```sql
create table if not exists conversation_memory_events (
  id bigserial primary key,
  tenant_id text not null,
  conversation_id text not null,
  session_id text,
  event_type text not null, -- update, skip_threshold, selector_applied, compact_used_summary
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

## Runtime Interfaces

Add new contracts in `packages/agent-runtime/src/types.ts` (or a new `memory/types.ts` module):

```ts
export interface SessionMemorySummary {
  conversationId: string;
  sessionId?: string;
  summaryText: string;
  summarizedUptoMessageId?: string;
  updatedAt: string;
  sourceTurnCount: number;
  sourceToolCount: number;
  sourceTokenEstimate: number;
}

export interface SessionMemoryConfig {
  enabled: boolean;
  minTurnsBetweenUpdate: number;      // default 2
  minToolCallsBetweenUpdate: number;  // default 1
  minTokenDeltaBetweenUpdate: number; // default 1200
  maxSummaryTokens: number;           // default 1000
}

export interface JitSelectionConfig {
  enabled: boolean;
  maxSelectedItems: number;           // default 5
  maxPerSource: number;               // default 2
  includeFreshnessHint: boolean;      // default true
}

export interface SessionMemoryStore {
  getLatest(conversationId: string, tenantId: string): Promise<SessionMemorySummary | null>;
  upsert(summary: SessionMemorySummary, tenantId: string, userId?: string): Promise<void>;
}
```

## Integration Points (Exact Files)

### 1) Post-model summary update

Primary file:
- `packages/agent-runtime/src/baseAgentRunner.ts`

Plan:
- After a successful assistant turn is appended to `history`, invoke a new async updater:
  - `sessionMemoryUpdater.maybeUpdate({ history, conversationId, sessionId, tenantId, userId, role, task })`
- Keep this fail-open (log on error, never fail request).
- Mirror the same integration in `packages/agent-runtime/src/companyAgentRunner.ts`.

New module:
- `packages/agent-runtime/src/memory/sessionMemoryUpdater.ts`
  - `shouldUpdateSummary(...)`
  - `buildSummaryPrompt(...)` (or deterministic summarization fallback)
  - `updateSummary(...)`

Dependencies:
- Add optional deps in `RunDependencies`:
  - `sessionMemoryStore?: SessionMemoryStore`
  - `sessionMemoryUpdater?: SessionMemoryUpdater`

### 2) Selector stage on JIT context

Primary file:
- `packages/agent-runtime/src/jitContextRetriever.ts`

Plan:
- Keep current broad retrieval.
- Add optional post-retrieval selection:
  - `jitContextSelector.select(query, candidates, config)`
- Return selected subsets for prompt injection:
  - `relevantMemories`, `relevantKnowledge`, `relevantProcedures`, `relevantGraphNodes`.
- Preserve current behavior behind flag fallback.

New module:
- `packages/agent-runtime/src/memory/jitContextSelector.ts`
  - deterministic mode first (score + recency + source diversity)
  - optional side-model mode later.

### 3) Inject graph nodes and freshness metadata

Primary files:
- `packages/agent-runtime/src/baseAgentRunner.ts`
- `packages/agent-runtime/src/companyAgentRunner.ts`

Plan:
- Add prompt section for graph nodes where JIT sections are assembled:
  - `## Relevant Graph Context`
- For all JIT sections, append compact freshness tags when available:
  - `(updated 3d ago)`.

### 4) Summary-first compaction

Primary files:
- `packages/agent-runtime/src/context/contextComposer.ts`
- `packages/agent-runtime/src/context/historyCompressor.ts`

Plan:
- Before aggressive group dropping, if summary exists:
  - keep system/task anchors + N recent raw turns + synthetic summary turn.
- Add guardrails:
  - summary max token budget.
  - do not include summary if updated too long ago (configurable staleness window).

## Feature Flags and Env Vars

Add new env vars:
- `SESSION_MEMORY_ENABLED` (default `false` in production until canary)
- `SESSION_MEMORY_MIN_TOKEN_DELTA` (default `1200`)
- `SESSION_MEMORY_MAX_TOKENS` (default `1000`)
- `JIT_SELECTOR_ENABLED` (default `false`)
- `JIT_SELECTOR_MAX_ITEMS` (default `5`)
- `JIT_INCLUDE_GRAPH_CONTEXT` (default `true`)
- `SUMMARY_FIRST_COMPACTION_ENABLED` (default `false`)

## Telemetry

Emit runtime events (reuse existing `emitEvent` and tracing):
- `memory.summary.update_started`
- `memory.summary.updated`
- `memory.summary.skipped_threshold`
- `memory.selector.applied`
- `memory.selector.candidates`
- `memory.selector.selected`
- `memory.compaction.used_summary`
- `memory.compaction.summary_stale_skip`

Required fields:
- `conversationId`, `sessionId`, `role`, `tokenEstimateBefore`, `tokenEstimateAfter`, `selectedCountBySource`.

## Rollout Plan

### Phase 0: Foundation
- Add table migration(s).
- Add interfaces and no-op implementations.
- Add flags/env parsing and telemetry scaffolding.

### Phase 1: Session summary update
- Enable `SESSION_MEMORY_ENABLED` in staging.
- Verify no latency spikes >10% p95.
- Verify summary updates only when thresholds trigger.

### Phase 2: Summary-first compaction
- Enable `SUMMARY_FIRST_COMPACTION_ENABLED` in staging.
- Compare:
  - prompt token delta
  - user-visible coherence in long threads
  - fallback frequency to old compaction path.

### Phase 3: JIT selector
- Enable `JIT_SELECTOR_ENABLED` for a subset of roles.
- Tune `maxSelectedItems` and per-source caps from telemetry.

### Phase 4: Graph context injection
- Enable `JIT_INCLUDE_GRAPH_CONTEXT`.
- Validate precision with sampled transcripts and role-specific eval prompts.

## Tests (Required)

Add/extend tests in `packages/agent-runtime/src/__tests__`:

1) `sessionMemoryUpdater.test.ts`
- updates only when threshold met.
- does not throw/fail run on store/model errors.
- summary length capped.

2) `historyCompressor.summaryFirst.test.ts`
- summary included when enabled and fresh.
- fallback when summary missing/stale.

3) `jitContextSelector.test.ts`
- candidate trimming by score/diversity.
- max per source respected.
- deterministic ordering.

4) Extend existing:
- `jitContextRetriever.test.ts` to verify graph nodes can be selected and surfaced.
- `microCompactor.test.ts` to ensure compatibility with summary-first path.

## Operational Runbook Addendum

After implementation, add a runbook similar to hooks tracing:
- `docs/MEMORY_RUNTIME_ROLLOUT_RUNBOOK.md`

Include:
- staging canary settings
- dashboards and SLO checks
- rollback switches:
  - `SESSION_MEMORY_ENABLED=false`
  - `JIT_SELECTOR_ENABLED=false`
  - `SUMMARY_FIRST_COMPACTION_ENABLED=false`

## Immediate Low-Risk Wins (Can Ship First)

1) Inject `relevantGraphNodes` in both runners.
2) Add freshness annotation in JIT prompt sections.
3) Add telemetry counters for candidate vs selected context blocks.

These changes are additive, low risk, and provide immediate signal before larger session-summary work lands.


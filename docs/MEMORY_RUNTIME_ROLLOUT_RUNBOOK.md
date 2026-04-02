# Memory Runtime Rollout Runbook

This runbook covers safe rollout of session memory updates, summary-first compaction, and JIT context selection.

## Features Covered

- Session memory updater (`SESSION_MEMORY_ENABLED`)
  - Writes rolling session summaries to `conversation_memory_summaries`.
  - Threshold-gated updates to avoid per-turn write amplification.
- Summary-first compaction (`SUMMARY_FIRST_COMPACTION_ENABLED`)
  - Injects `[SESSION SUMMARY]` into composed context when available.
  - Keeps summary as a high-priority anchor during compression.
- Deterministic JIT selector (`JIT_SELECTOR_ENABLED`)
  - Selects top context blocks with source diversity and caps.
  - Logs candidate/selected counts for tuning.
- Graph context injection
  - Injects `relevantGraphNodes` into JIT prompt sections in both runners.

## Prerequisites

1) Apply DB migration:
- `db/migrations/20260402100000_conversation_memory_summaries.sql`

2) Confirm services are running with DB access and normal write permissions.

## Environment Variables

- `SESSION_MEMORY_ENABLED`
  - Enable session summary updates.
- `SESSION_MEMORY_MIN_TURNS_BETWEEN_UPDATE`
  - Default `2`.
- `SESSION_MEMORY_MIN_TOOL_CALLS_BETWEEN_UPDATE`
  - Default `1`.
- `SESSION_MEMORY_MIN_TOKEN_DELTA`
  - Default `1200`.
- `SESSION_MEMORY_MAX_TOKENS`
  - Default `1000`.
- `SUMMARY_FIRST_COMPACTION_ENABLED`
  - Enables summary-first compaction behavior.
- `JIT_SELECTOR_ENABLED`
  - Enables deterministic JIT selector.
- `JIT_SELECTOR_MAX_ITEMS`
  - Default `5`.
- `JIT_SELECTOR_MAX_PER_SOURCE`
  - Default `2`.

## Recommended Staging Rollout

### Phase 1: Session Summaries Only

- Set:
  - `SESSION_MEMORY_ENABLED=true`
  - `SUMMARY_FIRST_COMPACTION_ENABLED=false`
  - `JIT_SELECTOR_ENABLED=false`
- Validate:
  - rows are created/updated in `conversation_memory_summaries`
  - no latency regressions in run loops
  - no increase in aborted runs

### Phase 2: Summary-First Compaction

- Set:
  - `SUMMARY_FIRST_COMPACTION_ENABLED=true`
- Validate:
  - `context_injected` events include session summary payload lengths
  - long-thread coherence improves (manual transcript sampling)
  - token pressure behavior remains stable

### Phase 3: JIT Selector + Graph Context

- Set:
  - `JIT_SELECTOR_ENABLED=true`
  - start conservative: `JIT_SELECTOR_MAX_ITEMS=4`, `JIT_SELECTOR_MAX_PER_SOURCE=1`
- Validate:
  - logs: `[JITSelector] ... candidates=, selected=, by_source=...`
  - no quality drop in answer grounding
  - token usage decreases on context-heavy prompts

## Operational Checks

- Runtime checks:
  - `npm run typecheck --workspace=@glyphor/agent-runtime`
  - `npm run test --workspace=@glyphor/agent-runtime -- sessionMemoryUpdater.test.ts summaryFirstCompaction.test.ts jitContextSelector.test.ts`
- Data checks (sample):
  - `SELECT conversation_id, updated_at, source_turn_count, source_tool_count FROM conversation_memory_summaries ORDER BY updated_at DESC LIMIT 20;`

## Rollback Plan

- Immediate rollback toggles:
  - `JIT_SELECTOR_ENABLED=false`
  - `SUMMARY_FIRST_COMPACTION_ENABLED=false`
  - `SESSION_MEMORY_ENABLED=false`
- If migration causes issues:
  - keep feature flags off, retain table (non-breaking)

## Notes

- Missing table behavior is fail-open: runtime logs a one-time warning and continues.
- Summary-first compaction is additive and optional; standard compression remains fallback.
- Prefer gradual role-based canaries (start with `cto` and `chief-of-staff`) before fleet-wide enablement.


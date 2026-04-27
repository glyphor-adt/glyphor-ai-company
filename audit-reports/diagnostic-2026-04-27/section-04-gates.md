# Section 4 — Gate & Policy Stack: Reality vs. Doc

Scope: verify the documented gate chain
`block/grant -> budget -> constitutional pre-check -> evidence gate -> verifier -> execute -> optional read-back -> reputation tracking`
against `packages/agent-runtime/src/toolExecutor.ts` (`ToolExecutor.execute`,
[`packages/agent-runtime/src/toolExecutor.ts:882`](../../packages/agent-runtime/src/toolExecutor.ts#L882)).

All line numbers refer to `packages/agent-runtime/src/toolExecutor.ts` unless
otherwise noted.

---

## 4.1 Gate-by-gate map (in execution order)

The table below lists every gate that fires inside `ToolExecutor.execute()`
between request entry and tool dispatch. It is much wider than the doc's
8-step chain — the documented chain is a (partially-correct) summary.

| # | Gate | File:line | Wired into ToolExecutor? | Activates when | LLM calls / invocation | Latency (best evidence) |
|---|------|-----------|--------------------------|----------------|-----------------------|-------------------------|
| 1 | Action-risk classification (`classifyActionRisk`) | `toolExecutor.ts:893` calling `actionRiskClassifier.ts` | Yes (sets `riskAssessment.level`) | Every call | 0 | Pure regex/lookup, sub-ms |
| 2 | **block/grant + emergency block** (`authorizeToolExecution`) | `toolExecutor.ts:907-930` → `runtimeExecutionPolicy.ts` | Yes | `enforcementEnabled === true` (default) | 0 | Policy cache lookup, sub-ms after warmup |
| 3 | Planning-phase read-only gate | `toolExecutor.ts:1012-1024` | Yes | `context.runPhase === 'planning'` & not read-only tool | 0 | sub-ms |
| 4 | Global circuit breaker / fleet halt (`shouldBlockToolCall`) | `toolExecutor.ts:1029` → `circuitBreaker.ts:147` | Yes | Always (cached `system_config` lookup) | 0 | Cached, sub-ms after first call; first call 1 DB query |
| 5 | Denial-tracking circuit breaker (`isToolRunBlocked`, `evaluateEscalation`) | `toolExecutor.ts:1046-1078` → `denialTracking.ts` | Yes | Per-run accumulated denials > threshold | 0 | In-memory, sub-ms |
| 6 | Policy-limits gate (`checkToolPolicy`) | `toolExecutor.ts:1083` → `policyLimits.ts` | Yes | `this.policyCache` is populated | 0 | In-memory cache, sub-ms |
| 7 | buildTool role filter (`isToolPermittedForRole`) | `toolExecutor.ts:1105` → `buildTool.ts` | Yes | Tool was registered via `buildTool` with role list | 0 | sub-ms |
| 8 | HARD_GATE block (founder-approval-required tools) | `toolExecutor.ts:1116-1170` | Yes | `riskAssessment.level === 'HARD_GATE'` | 0 | sub-ms |
| 9 | Param normalize/validate (`normalizeAndValidateToolParams`) | `toolExecutor.ts:1172` | Yes | Every call | 0 | sub-ms |
| 10 | Scope-mismatch gate (`hasContextScopeMismatch`) | `toolExecutor.ts:1184` → defined `:653` | Yes | Params claim a different agent/run scope | 0 | sub-ms |
| 11 | Disclosure policy (`applyDisclosurePolicy`) | `toolExecutor.ts:1207-1248` → `disclosure.ts` | Yes | `classifyDisclosureTarget` matches (external email/DM tools) | 0 (deterministic policy) | sub-ms |
| 12 | Capacity-tier / commitments (`enforceCapacityTier`) | `toolExecutor.ts:1251` (imported from `@glyphor/shared`) | Yes | Tool maps to a capacity action via `buildCapacityAction` | 0 | DB lookup; tens of ms |
| 13 | Pre-tool hooks (composite: in-process + HTTP) | `toolExecutor.ts:1310` → `hooks/hookRunner.ts` | Yes | Tool has hook config or global hook URL set | 0 by default; depends on hook | HTTP hook adds round-trip |
| 14 | Rate limit (`checkRateLimit`) | `toolExecutor.ts:1354` | Yes | `enforcementEnabled` | 0 | sub-ms |
| 15 | **Budget check (heuristic)** (`wouldExceedBudget`) | `toolExecutor.ts:1367` | Yes | `enforcementEnabled` | 0 | sub-ms |
| 16 | Per-run tool retry cap | `toolExecutor.ts:1385` (cap from `TOOL_RETRY_CAP`, env, default 5) | Yes | Same tool failed ≥ 5 times in run | 0 | sub-ms |
| 17 | Behavioral-fingerprint anomaly (`detectBehavioralAnomalies`) | `toolExecutor.ts:1408` → `behavioralFingerprint.ts` | Yes | `enforcementEnabled` & profile loaded | 0 | DB read for profile (cached), few ms |
| 18 | Formal budget verifier (`FormalVerifier.verifyBudgetConstraint`) | `toolExecutor.ts:1432-1450` | Yes (only if `formalVerifier` injected in ctor `:694`) | Write tool & a `FormalVerifier` instance is present | 0 (Z3-style symbolic) | sub-ms |
| 19 | Pre-execution value gate (`evaluateActionValue`) | `toolExecutor.ts:1463-1498` | Yes | Write tool *or* non-AUTONOMOUS risk; **AND not** `on_demand` (default) **AND not** reactive-light scheduled task (default). See §4.3 for kill switches | 0 (heuristic) | sub-ms |
| 20 | **Constitutional pre-check** (`preCheckTool`) | `toolExecutor.ts:1504-1549` → `constitutionalPreCheck.ts:372` | Yes | Tool ∈ `HIGH_STAKES_TOOLS` (`constitutionalPreCheck.ts:29`: `create_or_update_file`, `apply_patch_call`, `create_branch`, `register_tool`, `create_specialist_agent`, `grant_tool_access`) AND constitution loaded | **0 for the 6 high-stakes tools above** (deterministic only, see `constitutionalPreCheck.ts:306` — LLM phase early-returns unless tool ∈ `EXTERNAL_COMMUNICATION_TOOLS = {submit_assignment_output}`). For `submit_assignment_output`: **1 LLM call** (PRE_CHECK_MODEL = tier `default`) — cached in Redis 5 min (`constitutionalPreCheck.ts:26`) | Cached: <50 ms; cold LLM call: 1-3 s |
| 21 | **Data-evidence gate** | `toolExecutor.ts:1556-1596` | Yes | Tool ∈ `DATA_EVIDENCE_REQUIRED` (`:535`: `create_decision`, `write_pipeline_report`, `create_status_report`, `create_research_brief`) | 0 | sub-ms (scans `this.callLog`) |
| 22 | Dry-run intercept | `toolExecutor.ts:1599-1611` | Yes | `this.dryRun` ctor flag & not read-only | 0 | sub-ms |
| 23 | **Cross-agent verifier** (`VerifierRunner.verifyToolCall`) | `toolExecutor.ts:1614-1650` → `verifierRunner.ts:125` | Yes (only if `modelClient` injected — `:711`) | Tool ∈ `CROSS_AGENT_VERIFICATION_TOOLS` (`:518`: HIGH_STAKES_TOOLS ∪ `submit_assignment_output`, `send_dm`, `send_teams_dm`, `create_calendar_event`, MCP CreateEvent variants, `revoke_tool_access`) | **1 LLM call** to a *different-provider* model (`getVerifierFor`) — uncached | 1.5-4 s typical |
| 24 | Per-run read-only result cache (short-circuit) | `toolExecutor.ts:1675-1699` → `perRunToolCache.ts` | Yes | `ENABLE_TOOL_RESULT_CACHE` env truthy AND `isCacheableReadOnlyTool` | 0 | sub-ms hit; bypasses everything below |
| 25 | ABAC middleware (wraps execute) | `toolExecutor.ts:1743-1754` → `abac.ts` | Yes | Every call (when reached) | 0 | sub-ms |
| 26 | **Tool execute** (with timeout, abort, transient retry) | `toolExecutor.ts:1723-1782` | Yes | Always | 0 in-runtime (the tool itself may make external calls) | Per-tool |
| 27 | Predictions journaling | `toolExecutor.ts:1811-1823` | Yes | success & data has prediction shape | 0 | DB insert |
| 28 | Evidence ledger record (`recordEvidence`) | `toolExecutor.ts:1826-1853` → `telemetry/runLedger.ts` | Yes | success & substantive data | 0 | Async DB insert; not blocking |
| 29 | **Read-back verification** (post-write) | `toolExecutor.ts:1856-1873` | Yes | `isMutation(toolName)` & success & `VERIFICATION_MAP[toolName]` defined (`:572`: only 6 update_* tools) | 0 (it re-enters `this.execute` for the read counterpart, which itself runs every gate again) | One full extra tool round-trip |
| 30 | Post-tool hooks | `toolExecutor.ts:1919+` | Yes | Symmetric with #13 | 0 by default | — |
| 31 | **Reputation tracking** (`recordToolCall`) | `toolExecutor.ts:1904`, `:1941`, etc. → `toolReputationTracker.ts` | Yes | Always (fire-and-forget) | 0 | Async, non-blocking |

### Doc gates that ARE wired

- **block/grant** ✓ (#2)
- **budget** ✓ (#15 heuristic + #18 formal)
- **constitutional pre-check** ✓ (#20) — but LLM phase is *only* for `submit_assignment_output`; the other 6 high-stakes tools get deterministic regex only
- **evidence gate** ✓ (#21)
- **verifier** ✓ (#23)
- **execute** ✓ (#26)
- **optional read-back** ✓ (#29) — narrow: only 6 update_* tools have a `VERIFICATION_MAP` entry
- **reputation tracking** ✓ (#31)

### Doc gates that are NOT in ToolExecutor

None claimed by the doc are missing, but the doc grossly under-counts: ~20
additional gates run that aren't in the documented chain (planning gate,
denial-tracking, policy limits, capacity tier, hooks×2, ABAC, behavioral
anomaly, dry-run, scope mismatch, disclosure, value gate, retry cap, etc.).
These are real gates with deny outcomes.

The doc also claims ordering `budget → constitutional → evidence → verifier`.
Actual ordering is `budget (#15) → formal-budget (#18) → value-gate (#19) →
constitutional (#20) → evidence (#21) → verifier (#23)`. So the value gate is
sandwiched between budget and constitutional pre-check and is undocumented.

---

## 4.2 How many gates fire on a typical chat tool call?

**Definition of "typical on-demand chat":** `context.requestSource === 'on_demand'`
(set in `companyAgentRunner.ts:2042`), tool is read-only, not high-stakes,
not in any of the special sets. Example: `get_company_vitals`.

Walking the code path with `enforcementEnabled = true` and no policy cache miss:

1. (#1) `classifyActionRisk` — fires
2. (#2) `authorizeToolExecution` — fires (block/grant)
3. (#3) Planning gate — skipped (`runPhase !== 'planning'`)
4. (#4) Circuit breaker — fires (returns not-blocked)
5. (#5) Denial tracking — fires (returns not-blocked)
6. (#6) Policy limits — fires *iff* `policyCache` set; typically yes
7. (#7) Role filter — fires
8. (#8) HARD_GATE — skipped (level ≠ HARD_GATE for read-only)
9. (#9) Param validation — fires
10. (#10) Scope mismatch — fires (returns null)
11. (#11) Disclosure — skipped (no email/DM target)
12. (#12) Capacity tier — fires (no-op for reads typically, but called)
13. (#13) Pre-tool hooks — fires (default composite hookRunner runs even with no hooks → no-op deny check)
14. (#14) Rate limit — fires
15. (#15) Budget check — fires
16. (#16) Retry cap — fires
17. (#17) Behavioral anomaly — fires
18. (#18) Formal budget verifier — **skipped** (read-only, `:1432`)
19. (#19) Value gate — **skipped** because `requestSource === 'on_demand'` and `VALUE_GATE_ENFORCE_ON_DEMAND` is false by default (`:1452-1465`)
20. (#20) Constitutional pre-check — **skipped** (not in `HIGH_STAKES_TOOLS`)
21. (#21) Data-evidence — **skipped** (not in `DATA_EVIDENCE_REQUIRED`)
22. (#22) Dry-run — skipped
23. (#23) Cross-agent verifier — **skipped** (not in `CROSS_AGENT_VERIFICATION_TOOLS`)
24. (#24) Per-run cache — *only* if `ENABLE_TOOL_RESULT_CACHE` env set (default off). With default config, skipped.
25. (#25) ABAC middleware — fires (wraps execute)
26. (#26) Execute — fires
27. (#28) Evidence record — fires (success path)
28. (#29) Read-back — **skipped** (read-only, not in `VERIFICATION_MAP`)
29. (#31) Reputation tracking — fires

**Tally: ~17 gates execute on a typical chat read tool call. 0 LLM calls.**

For a **chat write** tool (e.g. `update_roadmap_item`): add #18 formal-budget,
add #29 read-back (which itself triggers another full pass for the read tool).
Value gate is still skipped on-demand by default. Constitutional/verifier
still skipped unless tool is in those sets. ⇒ ~19 gates, 0 LLM calls — unless
the tool happens to be `submit_assignment_output` (then +1 LLM in #20 + 1 LLM
in #23) or any other CROSS_AGENT_VERIFICATION tool (+1 LLM in #23).

## 4.3 How many gates fire on a typical scheduled task tool call?

`context.requestSource === 'scheduled'` (`companyAgentRunner.ts:2042`,
`baseAgentRunner.ts:1288`). Two cases:

**(a) Reactive-light task** (`task ∈ {'urgent_message_response',
'incident_response', 'event_message_sent'}`, `taskClassPolicy.ts:9`):
Same as chat: value gate is skipped because
`shouldSkipValueGateForReactiveLightTask()` returns true by default
(`taskClassPolicy.ts:20-24`, kill-switched on `TOOL_VALUE_GATE_REACTIVE_LIGHT=enforce`).
⇒ same count as chat (~17 read / ~19 write).

**(b) Standard scheduled task with a write tool**: value gate (#19) **does**
fire (`:1463`). Everything else identical to a chat write. Value gate is
heuristic, no LLM. So ~20 gates, 0 LLM calls (unless tool is in
high-stakes/cross-agent sets).

For a high-stakes scheduled tool like `create_or_update_file`:
- Constitutional pre-check (#20) runs → deterministic only, **0 LLM**
  (`constitutionalPreCheck.ts:306`).
- Cross-agent verifier (#23) runs → **1 LLM call** to verifier model.
- Value gate runs → 0 LLM.
⇒ ~22 gates, **1 LLM call**.

For `submit_assignment_output` on a schedule:
- Constitutional pre-check (#20) → **1 LLM** (cached, `EXTERNAL_COMMUNICATION_TOOLS`).
- Cross-agent verifier (#23) → **1 LLM** (uncached).
⇒ ~22 gates, **2 LLM calls** (one cached).

---

## 4.4 Kill switches & current values

All gate kill switches found by grepping `process.env.*` in
`packages/agent-runtime/src/`. Cross-checked against deployment configs
(`cloudbuild-*.yaml`, `infra/`, `services/`, `workers/`,
`packages/shared/src/config*`) for any explicit override.

| Env var | Read at | Default | Effect | Currently set in deploy configs? |
|---------|---------|---------|--------|------|
| `TOOL_VALUE_GATE_ON_DEMAND` | `toolExecutor.ts:593` | unset → `false` | When `'enforce'`, applies value-gate (#19) to chat too | **Not set** anywhere (only referenced in `docs/TASK-CLASS-PROTOCOL-MATRIX.md`, `toolExecutor.ts`). Effective value: skip on chat. |
| `TOOL_VALUE_GATE_REACTIVE_LIGHT` | `taskClassPolicy.ts:21` | unset → skip gate | When `'enforce'`, applies value-gate to reactive-light scheduled tasks | **Not set** (only referenced in `docs/`, code, and `scripts/run-reliability-canary.ps1`). Effective: skip. |
| `TOOL_VALUE_GATE_RATIO_THRESHOLD` | `toolExecutor.ts:590` | `2.5` | Min value/cost ratio for value gate to allow | Not set in deploy; only `scripts/run-reliability-canary.ps1:44` sets it during canary runs. |
| `TOOL_VALUE_GATE_CONFIDENCE_THRESHOLD` | `toolExecutor.ts:591` | `0.6` | Min confidence for value gate | Same as above. |
| `TOOL_RETRY_CAP` | `toolExecutor.ts:594` | `5` | Per-run per-tool failure cap (#16) | Same as above (canary only). |
| `ENABLE_TOOL_RESULT_CACHE` | `perRunToolCache.ts:79-81` | unset → `false` | Per-run read-only cache short-circuit (#24) | **Not set** in any deploy config. Cache is OFF in production. |
| `TOOL_VERY_LONG_TIMEOUT_MS` | `toolExecutor.ts:246` | `900000` | Tool timeout class | Not overridden. |
| `TOOL_QUICK_DEMO_TIMEOUT_MS` | `toolExecutor.ts:248` | `300000` | Tool timeout class | Not overridden. |
| `enforcement` (constructor flag, not env) | `toolExecutor.ts:694` | `true` | Master switch on gates #2, #14-#19 | Always `true` in `companyAgentRunner` paths (no override seen). |
| `dryRun` (ctor flag) | `toolExecutor.ts:694` | `false` | Intercepts mutating tools (#22) | Off in prod. |
| `AGENT_RUN_LEDGER_ENABLED` | `telemetry/runLedger.ts:48` | unset → enabled (only `'false'` disables) | Evidence record (#28) | Not overridden — evidence path active. |
| `AGENT_TRACING_ENABLED` | `telemetry/tracing.ts:10` | unset → off | Tracing span around exec (not a gate) | Not overridden. |

There are **no** explicit kill switches found for: constitutional pre-check,
cross-agent verifier, data-evidence gate, behavioral-anomaly detection,
hooks, capacity tier, ABAC middleware, scope-mismatch, disclosure policy,
HARD_GATE, planning-phase gate, role filter, denial tracking, circuit
breaker, policy limits, formal verifier. Each can only be disabled at the
DI level (don't pass `modelClient` ⇒ verifier off; don't pass
`formalVerifier` ⇒ formal-budget off; don't pass `policyCache` ⇒ policy
limits off; don't pass `constitutionalGovernor` ⇒ constitutional check off
even for HIGH_STAKES tools — this is silent, see `:1506-1507`).

> **Note on silent bypass.** The constitutional pre-check (#20) is wrapped
> in `try/catch` at `:1505-1548`; *both* a missing governor and any thrown
> error log a warning and proceed. So a constitutional-check outage is
> failure-open for high-stakes tools.

---

## 4.5 Summary

- The 8-step doc chain is *directionally* correct but the runtime executes
  ~3× more gates than documented. The doc is missing planning-phase, fleet
  circuit breaker, denial tracking, policy limits, role filter, HARD_GATE,
  scope mismatch, disclosure, capacity tier, pre/post hooks, behavioral
  fingerprint, value gate, ABAC, dry-run, retry cap.
- LLM gates are narrow: **0 LLM calls for the typical chat or scheduled
  read; 0 for the typical write either**, unless the tool is one of the 6
  HIGH_STAKES tools (constitutional pre-check is *deterministic-only* for
  5 of them and adds 1 cached LLM call for `submit_assignment_output`) or
  one of the 11 CROSS_AGENT_VERIFICATION tools (+1 uncached LLM via
  `VerifierRunner.verifyToolCall`).
- Pre-execution value gate is **off for chat by default** and **off for
  reactive-light scheduled tasks by default**; it only fires on
  non-reactive-light scheduled write/non-AUTONOMOUS tools.
- The two cost/latency-impactful gate flags (`TOOL_VALUE_GATE_ON_DEMAND`,
  `ENABLE_TOOL_RESULT_CACHE`) are **not set in any deployment config** —
  defaults rule. Result caching is OFF in production despite being the
  cheapest available perf win.
- Direct measured latencies were not derivable from static review; latency
  estimates above are based on call shape (in-memory vs DB vs LLM). Real
  p50/p95 numbers would need `tool_call_traces` table querying or
  OpenTelemetry spans (`AGENT_TRACING_ENABLED=true`, currently unset).


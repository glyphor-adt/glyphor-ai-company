# Task class → protocol and gates (matrix)

This document maps **how Glyphor classifies work** (scheduler `task`, `requestSource`) to **what the runtime actually applies**: reasoning protocols, planning policy, and enforcement gates. Use it when tuning urgent replies, cron jobs, or dashboard chat—similar in spirit to Claude Code’s split between **plan mode**, **explore agent**, and **implementation**, but implemented with our `task` string and `CompanyAgentRunner` composition.

## Live policy (enforced in code)

The **reactive-light** row is implemented in `packages/agent-runtime/src/taskClassPolicy.ts` and wired as follows:

- **`REACTIVE_LIGHT_TASKS`** — `urgent_message_response`, `incident_response`, `event_message_sent`.
- **Prompts** — For these tasks, `CompanyAgentRunner` passes `reactiveLightPrompt` into `buildSystemPrompt`, which applies the same **chat-light** protocol stack as dashboard chat (and strips the XML `<reasoning>` suffix when the role prompt includes it). Full KB + department context stay loaded (unlike pure `on_demand`). Executives also receive `EXECUTIVE_ORCHESTRATION_PROTOCOL` (and dynamic orchestration when applicable).
- **Tool pre-execution value gate** — `ToolContext.schedulerTask` is set to the scheduler task name; the executor skips the pre-exec value gate for reactive-light tasks by default. Set **`TOOL_VALUE_GATE_REACTIVE_LIGHT=enforce`** to keep the gate on for those tasks.
- **Exports** — `isReactiveLightTask`, `REACTIVE_LIGHT_TASKS`, `shouldSkipValueGateForReactiveLightTask` from `@glyphor/agent-runtime`.

## Quick reference

| Task class | Typical `task` values | `requestSource` | Reasoning / prompt stack | Planning (JSON phase) | Gates to remember |
|------------|----------------------|-----------------|---------------------------|------------------------|-------------------|
| **Interactive chat** | `on_demand` | `on_demand` | Chat protocols; heavy `REASONING_PROMPT_SUFFIX` **stripped** when prompt contains Data Honesty block (`companyAgentRunner.ts` → `buildSystemPrompt`) | **Off** (`planningPolicy.ts`) | Value gate **skipped** for chat unless `TOOL_VALUE_GATE_ON_DEMAND=enforce` (`toolExecutor.ts`) |
| **Reactive / urgent** | `urgent_message_response`, `incident_response`, `event_message_sent` | `scheduled` | Full **`REASONING_PROTOCOL`** + data grounding; **not** chat-light | **Off** (tools from turn 1) | Pre-exec **value gate** applies to writes / non-autonomous tools; `send_*` often **SOFT_GATE** (`actionRiskClassifier.ts`) |
| **Heartbeat / sweeps** | `heartbeat_response`, `work_loop`, `proactive`, `process_assignments`, `agent365_mail_triage` | `scheduled` | Full task protocols as above | **Off** | Same as reactive; stall policy tuned for tool-first runs (`supervisorWorkloadStallPolicy.ts`) |
| **Scheduled content / SEO** | `weekly_content_planning`, `generate_content`, `seo_analysis`, … | `scheduled` | Full task protocols | **Off** (hard override via `SCHEDULED_TOOL_EXECUTION_TASKS`) | Planning forced off so models do not burn turns on JSON-only plans |
| **Implement-style (strict roles)** | e.g. `implement_component` | `scheduled` | Full task protocols | **Required** + completion gate for roles in `STRICT_ROLE_DEFAULTS` (`planningPolicy.ts`) | Stricter planning/verification path |
| **Task-oriented engineers** | Many sub-team roles + `taskTierHint` | `scheduled` | Full task protocols | **Auto** + completion gate defaults | Balanced |

## Code anchors

| Mechanism | Location |
|-----------|----------|
| `requestSource` = `on_demand` vs `scheduled` | `packages/agent-runtime/src/companyAgentRunner.ts` (e.g. `task === 'on_demand'`) |
| Chat vs task behavioral rules | `packages/agent-runtime/src/companyAgentRunner.ts` (`CHAT_*` vs `REASONING_PROTOCOL`, `DATA_GROUNDING_PROTOCOL`, …) |
| XML `<reasoning>` envelope (approach / tradeoffs / risks / alternatives) | `packages/agent-runtime/src/reasoning.ts` (`REASONING_PROMPT_SUFFIX`) |
| Planning mode per task | `packages/agent-runtime/src/planningPolicy.ts` (`resolvePlanningPolicy`) |
| Tests: urgent disables planning | `packages/agent-runtime/src/__tests__/planningPolicy.test.ts` |
| Pre-execution value gate (ratio / confidence) | `packages/agent-runtime/src/toolExecutor.ts` (`evaluateActionValue`, `TOOL_VALUE_GATE_*`) |
| Tool risk tier (AUTONOMOUS / SOFT / HARD) | `packages/shared/src/actionRiskClassifier.ts` |
| Write tools set (affects gate + budgets) | `packages/agent-runtime/src/types.ts` (`WRITE_TOOLS`) |

## Claude Code analogy (mental model)

| Claude Code idea | Glyphor equivalent |
|------------------|-------------------|
| Enter plan mode → explore → exit | Our **`planningMode`** + **`completionGate`** for implement-heavy tasks; **off** for urgent/heartbeat/content sweeps |
| Explore agent (read-only, fast) | Not a separate agent type; **read-only tools** + `classifyActionRisk` → **AUTONOMOUS** tier where applicable |
| Simple fix vs multi-file feature | **`resolvePlanningPolicy`** by `task` + role; strict roles get **required** planning |

## Known tension: urgent + full reasoning protocol

`urgent_message_response` already has **planning off** so the supervisor does not stall on a JSON plan. The run still uses **scheduled** `requestSource`, so it receives the **full** `REASONING_PROTOCOL` (orient / preflight / scenarios) and, when the merged prompt includes it, the **XML reasoning** suffix—unless we add a dedicated **urgent-light** branch (same idea as chat stripping in `buildSystemPrompt`).

**Outbound comms** (`send_agent_message`, `send_teams_dm`) remain subject to the **pre-execution value gate** unless confidence/ratio thresholds are met or policy is adjusted—orthogonal to planning.

## Tunable knobs (ops)

- **`TOOL_VALUE_GATE_RATIO_THRESHOLD`**, **`TOOL_VALUE_GATE_CONFIDENCE_THRESHOLD`** — default gate stringency (`toolExecutor.ts`).
- **`TOOL_VALUE_GATE_ON_DEMAND`** — set to `enforce` to apply the gate to dashboard chat as well.
- **`AGENT_PLANNING_POLICY_JSON`** — merge overrides for `default`, `roles`, or `tasks` (`planningPolicy.ts`).

## When changing behavior

1. Decide **task class** (chat vs urgent vs implement vs content sweep).
2. Adjust **`resolvePlanningPolicy`** or per-task overrides if the issue is **JSON planning vs tools-first**.
3. Adjust **`buildSystemPrompt`** / task-specific initial messages in `packages/agents/src/*/run.ts` if the issue is **verbosity** (reasoning envelope) for urgent paths.
4. Adjust **value gate** or **risk classification** if the issue is **blocked sends** on legitimate urgent replies.

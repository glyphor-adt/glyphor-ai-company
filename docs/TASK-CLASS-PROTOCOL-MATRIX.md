# Task class → protocol and gates (matrix)

This document maps **how Glyphor classifies work** (scheduler `task`, `requestSource`) to **what the runtime actually applies**: reasoning protocols, planning policy, and enforcement gates. Use it when tuning urgent replies, cron jobs, or dashboard chat—similar in spirit to Claude Code’s split between **plan mode**, **explore agent**, and **implementation**, but implemented with our `task` string and `CompanyAgentRunner` composition.

## Live policy (enforced in code)

The **reactive-light** row is implemented in `packages/agent-runtime/src/taskClassPolicy.ts` and wired as follows:

- **`REACTIVE_LIGHT_TASKS`** — `urgent_message_response`, `incident_response`, `event_message_sent`.
- **Prompts** — For these tasks, `CompanyAgentRunner` passes `reactiveLightPrompt` into `buildSystemPrompt`, which applies the same **chat-light** protocol stack as dashboard chat, **strips** `REASONING_PROMPT_SUFFIX` (XML `<reasoning>`) from the role prompt whenever chat-style protocols apply, and appends **`REACTIVE_LIGHT_OUTPUT_PROTOCOL`** so the visible reply stays minimal (no Approach/Tradeoffs-style sections). Full KB + department context stay loaded (unlike pure `on_demand`). Executives also receive `EXECUTIVE_ORCHESTRATION_PROTOCOL` (and dynamic orchestration when applicable).
- **Tool pre-execution value gate** — `ToolContext.schedulerTask` is set to the scheduler task name; the executor skips the pre-exec value gate for reactive-light tasks by default. Set **`TOOL_VALUE_GATE_REACTIVE_LIGHT=enforce`** to keep the gate on for those tasks.
- **Exports** — `isReactiveLightTask`, `REACTIVE_LIGHT_TASKS`, `shouldSkipValueGateForReactiveLightTask` from `@glyphor/agent-runtime`.

## Quick reference

| Task class | Typical `task` values | `requestSource` | Reasoning / prompt stack | Planning (JSON phase) | Gates to remember |
|------------|----------------------|-----------------|---------------------------|------------------------|-------------------|
| **Interactive chat** | `on_demand` | `on_demand` | Chat protocols; `REASONING_PROMPT_SUFFIX` **stripped** whenever chat-style protocols apply (`buildSystemPrompt`) | **Off** (`planningPolicy.ts`) | Value gate **skipped** for chat unless `TOOL_VALUE_GATE_ON_DEMAND=enforce` (`toolExecutor.ts`) |
| **Reactive / urgent** | `urgent_message_response`, `incident_response`, `event_message_sent` | `scheduled` | Same **chat-light** stack as dashboard chat (`CHAT_*` protocols) + **`REACTIVE_LIGHT_OUTPUT_PROTOCOL`**; **not** full `REASONING_PROTOCOL` | **Off** (tools from turn 1) | Pre-exec value gate **skipped** by default (`shouldSkipValueGateForReactiveLightTask`); set `TOOL_VALUE_GATE_REACTIVE_LIGHT=enforce` to tighten |
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

## Reactive-light vs full scheduled work

`urgent_message_response` (and other `REACTIVE_LIGHT_TASKS`) use **planning off** and **`reactiveLightPrompt`** in `buildSystemPrompt`, so they get the **chat-light** protocol stack plus **`REACTIVE_LIGHT_OUTPUT_PROTOCOL`** to discourage long Approach/Tradeoffs-style answers. They still use `requestSource` **scheduled** for model routing; that does not re-enable the heavy `REASONING_PROTOCOL` block in the system prompt.

**Outbound comms** (`send_agent_message`, `send_teams_dm`) use the same tool gates as other scheduled runs unless `TOOL_VALUE_GATE_REACTIVE_LIGHT` is set to `enforce`.

## Tunable knobs (ops)

- **`TOOL_VALUE_GATE_RATIO_THRESHOLD`**, **`TOOL_VALUE_GATE_CONFIDENCE_THRESHOLD`** — default gate stringency (`toolExecutor.ts`).
- **`TOOL_VALUE_GATE_ON_DEMAND`** — set to `enforce` to apply the gate to dashboard chat as well.
- **`AGENT_PLANNING_POLICY_JSON`** — merge overrides for `default`, `roles`, or `tasks` (`planningPolicy.ts`).

## When changing behavior

1. Decide **task class** (chat vs urgent vs implement vs content sweep).
2. Adjust **`resolvePlanningPolicy`** or per-task overrides if the issue is **JSON planning vs tools-first**.
3. Adjust **`buildSystemPrompt`** / task-specific initial messages in `packages/agents/src/*/run.ts` if the issue is **verbosity** (reasoning envelope) for urgent paths.
4. Adjust **value gate** or **risk classification** if the issue is **blocked sends** on legitimate urgent replies.

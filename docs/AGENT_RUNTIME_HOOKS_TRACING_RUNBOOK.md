# Agent Runtime Hooks + Tracing Runbook

This runbook covers safe rollout of the new runtime hook framework and trace span telemetry.

## Features Covered

- Tool lifecycle hooks:
  - Pre-tool hooks can allow/block tool execution.
  - Post-tool hooks receive execution outcomes.
- SSRF-safe outbound hook calls:
  - Blocks localhost, metadata endpoints, and private CIDR destinations.
  - Optional host allowlist support.
- Trace spans:
  - Structured `[TraceSpan]` logs for model attempts and tool execution.
  - Cloud Run summary command for p50/p95/avg reporting.

## Environment Variables

- `TOOL_HOOKS_CONFIG`
  - JSON string containing hook endpoints and optional allowlist.
  - Prefer storing this as a Secret Manager secret and mounting it as `TOOL_HOOKS_CONFIG` in Cloud Run.
  - See examples in `docs/examples/tool-hooks-config.staging.json` and `docs/examples/tool-hooks-config.production.json`.
- `AGENT_TRACING_ENABLED`
  - Enable trace span logs when truthy (`1`, `true`, `yes`, `on`).
  - Recommended: enable in staging first, then one production service canary.

## Rollout Checklist

### 1) Staging Baseline

- Deploy with:
  - `AGENT_TRACING_ENABLED=true`
  - `TOOL_HOOKS_CONFIG` mounted from a staging secret (observe-only pre-hook).
- For GitHub Actions deployment:
  - set repository secret `TOOL_HOOKS_CONFIG_SECRET_NAME` to your secret name (for example: `tool-hooks-config-staging`).
  - set repository variable `AGENT_TRACING_ENABLED` to `true` (for canary), later `false` if needed.
  - optional manual override: use `workflow_dispatch` inputs (`agent_tracing_enabled`, `tool_hooks_config_secret_name`) for one-off deploys without changing repository settings.
- Verify no execution regressions:
  - existing runtime tests pass
  - no spike in tool timeout/verification failures

### 2) Staging Telemetry Validation

- Run:
  - `npm run trace:summary:cloudrun -- --project <project> --service glyphor-scheduler --minutes 30 --top 20`
- Confirm:
  - non-zero parsed span events
  - top tools/models look reasonable
  - no outlier p95 compared to prior baseline

### 3) Staging Hook Validation

- Confirm pre-hook calls are reaching your endpoint.
- Confirm deny behavior only applies when endpoint returns `{"allow": false}`.
- Confirm hook errors:
  - fail-open for autonomous actions
  - fail-closed for non-autonomous actions

### 4) Production Canary

- Enable tracing on one service (usually `glyphor-scheduler`) for 24-48h.
- Keep hook config in observe-only mode initially.
- Monitor:
  - tool failure rate
  - model fallback rate
  - p95 for `tool.execute` and `model.provider_attempt`

### 5) Production Enforce

- Switch pre-hook policy to enforce (return explicit denies for selected actions).
- Start with a narrow deny scope (high-risk tools only).
- Expand policy after one full day without regressions.

## Operational Commands

- Summarize spans from a local log file:
  - `npm run trace:summary -- --file <path-to-log-file> --limit 20`
- Summarize spans directly from Cloud Run:
  - `npm run trace:summary:cloudrun -- --project <project> --service glyphor-scheduler --minutes 60 --top 20`

## Rollback Plan

- Immediate tracing rollback:
  - set `AGENT_TRACING_ENABLED=false`
- Immediate hook rollback:
  - unset `TOOL_HOOKS_CONFIG` (or set to empty hooks)
- If policy blocks critical paths:
  - return `{"allow": true}` from pre-hook endpoint while investigating

## Notes

- Keep hook endpoints highly available and low-latency.
- Avoid side effects in pre-hooks unless strictly required.
- Treat hook responses as policy decisions; preserve audit logs on the hook service side.

# Agent Reliability Hardening Runbook

This runbook operationalizes the 30-day reliability program for Glyphor runtime hardening.

## Scope

- Immutable run ledger (`agent_run_events`) and evidence linkage (`agent_run_evidence`, `agent_claim_evidence_links`)
- Task-shaped context bundles (`planning`, `execution`, `verification`)
- Pre-execution value gates for irreversible or high-risk actions
- Standardized repair loop and contradiction-aware verification
- Failure taxonomy tracking (`agent_failure_taxonomy`)

## Feature Flags

- `AGENT_RUN_LEDGER_ENABLED`
  - Enables append-only run events, evidence records, and failure taxonomy writes.
  - Accepted truthy values: `1`, `true`, `yes`, `on`.
- `TOOL_VALUE_GATE_RATIO_THRESHOLD`
  - Minimum value ratio required for high-impact tool execution.
  - Default: `2.5`
- `TOOL_VALUE_GATE_CONFIDENCE_THRESHOLD`
  - Minimum confidence required for high-impact tool execution.
  - Default: `0.6`
- `TOOL_RETRY_CAP`
  - Hard cap on repeated failures for the same tool in one run.
  - Default: `3`

## Rollout Plan

1. **Canary**
   - Enable `AGENT_RUN_LEDGER_ENABLED=true` for one scheduler deployment.
   - Keep value gate thresholds at defaults.
2. **Observe**
   - Replay 20 representative runs and inspect event ordering, claim links, and failure taxonomy.
   - Command: `npm run run:replay -- --run-id <uuid>`
3. **Shadow verify**
   - Confirm contradiction scans and cross-model passes appear in run verification metadata.
   - Monitor blocked actions caused by value gate thresholds.
4. **Enforce**
   - Roll out to all production scheduler instances.
   - Tune thresholds only after one full day of no false-positive spikes.

## Quick Validation Queries

```sql
SELECT event_type, COUNT(*) AS count
FROM agent_run_events
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY event_type
ORDER BY count DESC;
```

```sql
SELECT verification_state, COUNT(*) AS count
FROM agent_claim_evidence_links
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY verification_state;
```

```sql
SELECT failure_code, severity, COUNT(*) AS count
FROM agent_failure_taxonomy
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY failure_code, severity
ORDER BY count DESC;
```

## SLO Signals

- `unsupported_claim_rate` = unsupported claim links / total claim links
- `value_gate_block_rate` = blocked high-impact tool calls / total high-impact tool calls
- `repair_loop_escalation_rate` = runs with `verificationMeta.escalated=true` / verified runs
- `replay_coverage` = runs with >=1 `run.started` and >=1 `run.completed` event

## Rollback

- Immediate rollback:
  - Set `AGENT_RUN_LEDGER_ENABLED=false`
- Optional rollback:
  - Raise thresholds to reduce gating pressure:
    - `TOOL_VALUE_GATE_RATIO_THRESHOLD=0`
    - `TOOL_VALUE_GATE_CONFIDENCE_THRESHOLD=0`
- Leave schema intact; writes are additive and can be safely disabled.

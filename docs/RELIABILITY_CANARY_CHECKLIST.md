# Reliability Canary Checklist

Use this checklist to roll out the reliability hardening safely in one service canary before fleet-wide enforcement.

## 0) Preconditions

- Migration exists: `db/migrations/20260402103000_reliability_run_ledger.sql`
- Runtime includes:
  - run ledger writes
  - evidence linkage
  - contradiction scan verification pass
  - pre-action value gates
- Runbook reference: `docs/AGENT_RELIABILITY_HARDENING_RUNBOOK.md`

## 1) Apply Schema

1. Apply pending migrations in staging:
   - `npm run db:apply-pending`
2. Verify new tables exist:
   - `agent_run_events`
   - `agent_run_evidence`
   - `agent_claim_evidence_links`
   - `agent_failure_taxonomy`

## 2) Deploy One-Service Canary

1. Deploy one scheduler canary with:
   - `AGENT_RUN_LEDGER_ENABLED=true`
   - `TOOL_VALUE_GATE_RATIO_THRESHOLD=2.5`
   - `TOOL_VALUE_GATE_CONFIDENCE_THRESHOLD=0.6`
   - `TOOL_RETRY_CAP=3`
2. Keep all other services unchanged.

## 3) Drive Representative Traffic

Run at least 20 representative tasks covering:

- read-only tasks
- high-impact write tasks
- orchestration tasks
- tasks likely to trigger cross-model verification

## 4) Validate (SQL Bundle)

1. Run:
   - `npm run canary:validate`
2. Confirm all checks return `PASS` for:
   - schema presence
   - replay coverage (`run.started` and terminal run event)
   - monotonic event sequences
   - digest chain consistency
   - claim/evidence link integrity
   - verification + contradiction-scan coverage on high-stakes runs

## 5) Validate Replay UX

For a sample of run IDs from canary:

- `npm run run:replay -- --run-id <uuid>`
- Confirm:
  - event order is coherent
  - blocked actions show explicit trigger/reason
  - evidence links appear for high-impact outputs

## 6) Canary Acceptance Criteria

Promote only when all are true over a full day window:

- no material increase in failed/aborted run rate
- no unexpected spike in `tool.blocked` from value gates
- unsupported-claim rate trends downward or stable
- replay coverage >= 95% for completed runs

## 7) Gradual Enforcement

1. Expand to additional scheduler instances.
2. Re-run SQL bundle after each expansion.
3. Tune thresholds only if false positives are confirmed:
   - lower ratio threshold slightly (for example `2.5 -> 2.2`)
   - lower confidence threshold slightly (for example `0.6 -> 0.55`)

## 8) Rollback

Immediate rollback:

- set `AGENT_RUN_LEDGER_ENABLED=false`

Soft rollback (keep ledger, reduce blocks):

- `TOOL_VALUE_GATE_RATIO_THRESHOLD=0`
- `TOOL_VALUE_GATE_CONFIDENCE_THRESHOLD=0`

Schema rollback is not required; ledger tables are additive and safe to keep.

## One-command runner (PowerShell)

- `npm run canary:run:ps`
- Optional flags:
  - `-SkipMigrations`
  - `-SkipValidation`
  - `-ValueRatioThreshold 2.2`
  - `-ConfidenceThreshold 0.55`
  - `-RetryCap 3`

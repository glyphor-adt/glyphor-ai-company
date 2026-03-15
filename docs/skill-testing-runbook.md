# Skill Testing Runbook (33-Skill Rollout)

This runbook operationalizes the 3-layer strategy:

1. Pre-deployment A/B validation (`with-skill` vs `baseline`)
2. Canary rollout (single holder, 72h)
3. Post-deployment monitoring (30-day verification)

## 1) Pre-Deployment A/B Validation

### What this script does

`scripts/test-skills.ts`:
- Reads test definitions from a JSON suite file
- Injects new methodology into `agent_briefs.system_prompt` for `with_skill` runs
- Runs `baseline` with original brief (or optional baseline methodology override)
- Calls existing `POST /run` endpoint with task `skill_test`
- Evaluates assertions (tool usage + output checks)
- Optionally runs LLM pairwise judge (falls back to heuristic)
- Restores original brief after each skill
- Writes a JSON report to `artifacts/skill-tests/`

### Pilot suite (today)

Use: `scripts/skill-tests/pilot-suite.json`

Pilot skills:
- `access-management` (global-admin)
- `content-creation` (content-creator)
- `platform-monitoring` (ops)

### Commands

Dry-run (no DB writes):

```bash
npm run skills:test -- --dry-run
```

Execute pilot suite:

```bash
npm run skills:test -- --confirm-live
```

Run with explicit scheduler URL and output path:

```bash
npm run skills:test -- --confirm-live --scheduler-url http://localhost:8080 --output artifacts/skill-tests/pilot-manual.json
```

Disable LLM judge (assertions + heuristic only):

```bash
npm run skills:test -- --confirm-live --no-llm-judge
```

### Pre-deploy pass criteria

A skill is considered pre-deploy PASS when:
- With-skill wins >= 80% of prompts
- No meaningful regression on any prompt
- All automated assertions pass
- Constitutional compliance delta is not negative (if data exists)
- Average cost ratio remains under 2.0x

## 2) Canary Deployment

### What this script does

`scripts/skill-canary-report.ts` compares canary-window vs baseline-window metrics for one role:
- `agent_runs`: success rate, cost, turns
- `task_run_outcomes`: batch quality score (avg/stddev)
- `constitutional_evaluations`: adherence
- `agent_trust_scores`: trust delta from history

### Commands

Default canary window: last 72h, baseline: prior 7d

```bash
npm run skills:canary-report -- --agent-role ops
```

Explicit canary start:

```bash
npm run skills:canary-report -- --agent-role ops --canary-start 2026-03-10T12:00:00Z --canary-hours 72 --baseline-days 7
```

### Canary pass conditions

- Run success rate >= baseline
- Quality >= baseline - 0.5 sigma
- Constitutional compliance >= baseline
- Trust drop <= 0.05
- Average run cost < 1.5x baseline
- Average turns < 1.3x baseline

Any FAIL => rollback candidate methodology and revise.

## 3) Post-Deployment Monitoring

For first 30 days:
- Run canary report logic daily on recently promoted roles
- Track trend deltas for success, quality, compliance, trust, cost, turns
- Investigate tool grant mismatches, prompt length regressions, and tier routing changes

## Notes

- `skill_test` is allow-listed in authority gates to avoid approval queueing.
- `skill_test` loads skill context at standard-tier cost profile.
- Test runs are filterable via `agent_runs.task = 'skill_test'`.

# CZ Automation — deploy guide

Four files, in the order you should deploy them. Each is independent enough
to roll back cleanly if something misbehaves.

## Files in this package

```
001_shadow_eval.sql        — DB migration (new tables + ALTER cz_runs + config rows)
czShadowEval.ts            — shadow-eval logic: canary, promote, reassign, converge
czProtocolApi.patch.ts     — PATCH NOTES (not a runnable file) for your existing
                             czProtocolApi.ts — describes three surgical edits
czProtocolLoop.ts          — Sarah's cz_protocol_loop workflow entry point
```

## Deploy order

### 1. Run the migration

```
psql "$DATABASE_URL" -f 001_shadow_eval.sql
```

Creates: `cz_shadow_evals`, `cz_shadow_attempts`, `cz_automation_config`.
Adds: `cz_runs.prompt_version_id` (nullable, no default — safe for all
existing rows). Seeds config rows with automation turned ON but Slack
channel pointing to `#cz-automation`.

Verify with:

```sql
SELECT key, value_json FROM cz_automation_config;
-- Should show loop_enabled=true, shadow_eval_enabled=true, etc.
```

### 2. Drop `czShadowEval.ts` into `packages/scheduler/src/`

No wiring needed yet — nothing calls it. Just build to confirm imports
resolve. If `@glyphor/shared/db` is where you re-export `systemQuery` and
`systemTransaction`, the file should compile as-is.

### 3. Apply the three patches to `czProtocolApi.ts`

Walk through `czProtocolApi.patch.ts` from top to bottom. The patches are:

- **Patch 1:** thread `prompt_version_id` through `executeBatch()` and the
  agent runners. This is the load-bearing change — without it, shadow-eval
  canaries would run against the baseline prompt and always tie.
- **Patch 2:** accept `prompt_version_id` on `POST /api/cz/runs`.
- **Patch 3:** add three new endpoints: `GET /api/cz/shadow`,
  `POST /api/cz/shadow/tick`, `POST /api/cz/shadow/auto-reassign`,
  `GET /api/cz/shadow/convergence`.

Patch 1 requires changes to `@glyphor/agents` that I couldn't see — each
agent runner needs to accept an optional `systemPromptOverride: string`
and use it instead of the deployed prompt when supplied. The pattern:

```ts
// Current (approximate):
const systemPrompt = await loadDeployedPromptFor(role);

// After:
const systemPrompt = opts?.systemPromptOverride ?? await loadDeployedPromptFor(role);
```

Do this for every runner in STATIC_RUNNERS (`chief-of-staff`, `cto`, `cfo`,
`cmo`, `cpo`, `vp-design`, `vp-research`, `ops`, `clo`, `content-creator`,
`seo-analyst`) and for `runDynamicAgent`.

### 4. Hook `createShadowEval` into `czReflectionBridge.ts`

Patch 4 in the patch file. One-line addition after each successful
`INSERT INTO agent_prompt_versions` inside `processCzBatchFailures`. Keep
it as fire-and-forget (`.catch(console.error)`) so a shadow-eval creation
failure never blocks the reflection pipeline.

### 5. Drop `czProtocolLoop.ts` into `packages/agents/src/chief-of-staff/workflows/`

Register `runCzProtocolLoop` in whatever workflow registry Sarah uses.
Add a Cloud Scheduler job that POSTs to an endpoint that calls this
function:

```
*/30 * * * *   → runCzProtocolLoop({ trigger: 'interval' })
0 4 * * *      → runCzProtocolLoop({ trigger: 'nightly' })
```

If you don't have a clean workflow-dispatch surface yet, the simplest
wiring is to add one more scheduler endpoint:

```
POST /api/cz/loop/tick    body: { trigger: 'interval' | 'nightly' | 'manual' }
```

that calls `runCzProtocolLoop(body)` and returns the result. Cloud
Scheduler then just hits that URL on the two cron schedules above.

### 6. Wire Slack notification

Find the `notifySlack` function at the bottom of `czProtocolLoop.ts` and
replace the `console.log` with your actual Slack post helper. Channel
comes from `cz_automation_config.slack_escalation_channel`.

## What this does end-to-end

A failing batch finishes. Your existing reflection bridge stages a
challenger prompt in `agent_prompt_versions` with `source='cz_reflection'`.
New: `createShadowEval` immediately queues a shadow-eval against the
tasks that agent was failing on.

Next time Sarah's loop ticks (every 30 min), it hits
`POST /api/cz/shadow/tick`. That finds the pending shadow-eval and queues
a canary batch — a normal CZ run, but with `prompt_version_id` set to the
challenger. The canary executes through the same executor, with the same
heuristic catalog, but the agent runs with the challenger's prompt.

When the canary finishes, the next tick evaluates it. If the challenger
beat the baseline pass rate by +20 points on its target tasks for 2
consecutive canaries, `autoPromote` atomically retires the baseline and
deploys the challenger. Every 5th auto-promotion is flagged for audit.

If after 3 canaries the challenger still hasn't won, it's retired and
the task moves back into the reflection loop to get a fresh challenger.

If the same heuristic tag keeps firing across attempts with no
improvement, the eval escalates to `human_review` and Slack gets a
message — that's the "reflection isn't going to fix this, a human needs
to look" signal.

The loop also:
- Runs `auto-reassign` every tick, which fixes `agent_retired` and
  misrouted infra tasks without any prompt work.
- Queues a `critical` run every 30 min if any P0 is failing.
- Queues a `full` run nightly.
- Pauses all auto-runs when all 3 launch gates are green, and emits a
  Slack notification. Resumes automatically when a run goes red again.

## Kill switches

Every automated behavior can be turned off without redeploying:

```sql
-- Stop all automation entirely
UPDATE cz_automation_config SET value_json='false'::jsonb WHERE key='loop_enabled';

-- Keep the loop running but don't auto-promote prompts
UPDATE cz_automation_config SET value_json='false'::jsonb WHERE key='shadow_eval_enabled';

-- Disable task reassignment
UPDATE cz_automation_config SET value_json='false'::jsonb WHERE key='auto_reassign_enabled';
```

## Monitoring

Three queries that answer "is the loop working?":

```sql
-- Have we been running shadow evals lately?
SELECT state, COUNT(*) FROM cz_shadow_evals
  WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY state;

-- How many auto-promotions in the last week?
SELECT agent_id, COUNT(*) FROM cz_shadow_evals
  WHERE state='auto_promoted' AND updated_at > NOW() - INTERVAL '7 days'
  GROUP BY agent_id;

-- Are we converging? (recent pass rate vs prior)
SELECT
  DATE_TRUNC('day', r.completed_at) AS day,
  (COUNT(*) FILTER (WHERE s.passed)::float / COUNT(*))::numeric(4,3) AS pass_rate
FROM cz_runs r JOIN cz_scores s ON s.run_id = r.id
WHERE r.completed_at > NOW() - INTERVAL '14 days'
GROUP BY day ORDER BY day;
```

## What's intentionally NOT automated

- **Task definitions.** If `acceptance_criteria` is ambiguous or the
  `verification_method` is wrong, no amount of prompt tuning will fix it.
  These need a human to edit the task row.
- **Agent runtime wiring.** If `agent_runtime_abort` fires, the
  remediation is in `STATIC_RUNNERS` (tool budget, max_turns, model
  timeout) — a code change, not a config change. The loop surfaces these
  via escalation but doesn't try to auto-edit them.
- **Code changes in the heuristic catalog itself.** The heuristics in
  `czProtocolApi.ts` define what "fail" means; auto-promoting a prompt
  that games a heuristic without fixing the underlying behavior would be
  the scariest possible failure mode. Resist adding that.

## Rough time to green (if the existing failure patterns hold)

Given your current heuristic catalog and failure distribution, I'd guess
2-3 weeks of the loop running continuously to get to 85% overall / 100%
P0, assuming:
- Reflection is already generating reasonable challengers for the common
  tags (planning_not_execution, verification_skipped, topical_drift).
- The infra/roster tasks get auto-reassigned in the first 24 hours.
- Tasks that escalate to `human_review` get a ~10-minute human touch
  each (either a task redefinition, a role reassignment, or a code
  change in STATIC_RUNNERS).

If after a week the loop is still converging below 70%, that's a signal
the heuristic catalog needs another pass — specifically, that reflection
isn't generating useful challengers for whatever the dominant tag is.

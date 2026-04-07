# Glyphor Agent Cadence and Behavior Audit

**Date:** 2026-04-07  
**Scope:** Agent-by-agent run cadence, scheduling discipline, value gates, proof requirements, churn risk  
**Source:** Actual codebase — `cronManager.ts`, `dynamicScheduler.ts`, `eventRouter.ts`, seed migrations, `worker/src/index.ts`, agent run files

---

## Section 1: Executive Verdict

### Are agents currently running too often overall?

**Yes.** The scheduling model is additive: every time a new agent was built, cron entries were added. There is no discipline around "how much total agent work should fire per day." No gate prevents an agent from running when there is nothing to do.

### Which class of agents is most likely over-running?

**Reporting and monitoring agents.** Ops (Atlas Vega) has 5 recurring schedules (every 2h, every 4h, daily ×2, evening). Platform-Intel (Nexus) has daily_analysis at 7 AM, 12 PM, and 5 PM — three times daily. Chief of Staff has 7 scheduled cron entries including `orchestrate` firing **every hour** (`0 * * * *`). None of these have a skip gate if the previous run produced no actionable output.

### Which class most justifiably runs frequently?

**Ops (Atlas Vega) for infrastructure monitoring.** Health checks every 2 hours and cost checks every 4 hours are defensible — these catch real failures fast. The event_response task is justifiably reactive. Everything else (morning_status, evening_status, performance_rollup) is status theater on a schedule.

### Is Glyphor optimized for activity or meaningful work?

**Activity.** `DynamicScheduler` (`packages/scheduler/src/dynamicScheduler.ts`) fires based purely on cron match. The only gate is `status='active'`. There is no check for pending work, changed state, or prior run delta. An agent can run every hour for a week producing identical output and nothing stops it.

### Top 5 behavior changes that should happen immediately

1. **Add a `has_pending_work()` check** to Chief of Staff's `orchestrate` task before executing — skip if no unprocessed active directives
2. **Reduce Ops (Atlas Vega) scheduled runs** — eliminate duplicate morning/evening status; keep health_check (2h), cost_check (4h), event_response (reactive only)
3. **Reduce Platform-Intel daily_analysis from 3×/day to 1×/day** — one comprehensive analysis at 7 AM CT is sufficient; 12 PM and 5 PM runs are churn unless triggered by new findings
4. **Require `agent_output` to be non-null and >100 chars before `work_assignments.status` can be set to `completed`** — stops empty-output completions
5. **Remove CMO `process_assignments` every 30 minutes** — replace with event-only trigger when new assignment arrives

---

## Section 2: Current Run Model

### How Scheduled Runs Are Defined

**Source 1: `cronManager.ts` static jobs** (`packages/scheduler/src/cronManager.ts`)  
Hard-coded array of `ScheduledJob` objects. Evaluated by `DataSyncScheduler` every 60 seconds.

**Source 2: `agent_schedules` DB table** (`db/migrations/20260227100000_add_agent_schedules_payload.sql`)  
Dynamic cron entries with `agent_id`, `cron_expression`, `task`, `payload`, `enabled`. Evaluated by `DynamicScheduler` every 60 seconds.

Both schedulers poll every 60 seconds. `lastCheckMinute` prevents double-firing within the same minute.

### Tick Logic (No Value Gate)

```typescript
// packages/scheduler/src/dynamicScheduler.ts
private async tick(): Promise<void> {
  // 1. Get all enabled schedules from DB
  const schedules = await systemQuery('SELECT ... FROM agent_schedules WHERE enabled = $1', [true]);

  // 2. Filter by cron match — NO work-existence check
  const matching = schedules.filter(s => cronMatchesNow(s.cron_expression, now));

  // 3. Only gate: agent must be status='active'
  const activeAgents = await systemQuery('SELECT role FROM company_agents WHERE role = ANY($1) AND status = $2', ...);

  // 4. Fire — no delta check, no proof check, no skip logic
  for (const schedule of matching) {
    await this.executor(role, schedule.task, schedule.payload ?? {});
  }
}
```

### Full Schedule Map (Current State)

#### Chief of Staff (Sarah) — 7 cron entries
| Schedule | Cron | Time (CT) | Trigger |
|---|---|---|---|
| morning_briefing | `0 12 * * *` | 7:00 AM daily | Cron |
| midday_digest | `0 12 * * 1-5` | 7:00 AM weekdays | Cron (**duplicate timing with briefing**) |
| eod_summary | `0 18 * * 1-5` | 1:00 PM weekdays | Cron |
| orchestrate | `0 * * * *` | **Every hour** | Cron |
| weekly_review | `0 9 * * 1` | Mon 4:00 AM CT | Cron |
| monthly_retrospective | `0 10 1 * *` | 1st of month | Cron |
| strategic_planning | `0 14 * * 1` | Mon 9:00 AM CT | Cron |
| weekly_review (DB seed) | `0 22 * * 5` | Fri 5:00 PM CT | Cron (redundant with above) |
| monthly_retrospective (DB seed) | `0 21 1 * *` | 1st of month | Cron (redundant with above) |

#### Ops / Atlas Vega — 5 recurring + event-driven
| Schedule | Cron | Time (CT) | Trigger |
|---|---|---|---|
| health_check | `0 */2 * * *` | Every 2 hours | Cron |
| freshness_check | `0 5,14 * * *` | 12 AM + 9 AM CT | Cron |
| cost_check | `0 */4 * * *` | Every 4 hours | Cron |
| morning_status | `0 11 * * *` | 6:00 AM CT | Cron |
| evening_status | `0 22 * * *` | 5:00 PM CT | Cron |
| performance_rollup | `15 6 * * *` | 1:15 AM CT | Cron |
| milestone_detection | `30 6 * * *` | 1:30 AM CT | Cron |
| growth_update | `45 6 * * 1` | Mon 1:45 AM CT | Cron |
| event_response | — | On event | EventRouter |
| contradiction_detection | — | On demand | On demand |

#### Platform-Intel / Nexus — 3× daily
| Schedule | Cron | Time (CT) | Trigger |
|---|---|---|---|
| daily_analysis | `0 7 * * *` | 2:00 AM CT | Cron |
| daily_analysis | `0 12 * * *` | 7:00 AM CT | Cron |
| daily_analysis | `0 17 * * *` | 12:00 PM CT | Cron |
| watch_tool_gaps | — | On demand / approval | EventRouter |
| memory_consolidation | `0 3 * * *` | 10:00 PM CT | DataSyncScheduler |

#### CFO — 2× daily
| Schedule | Cron | Time (CT) |
|---|---|---|
| daily_cost_check | `0 14 * * *` | 9:00 AM CT |
| daily_cost_check (afternoon) | `0 20 * * *` | 3:00 PM CT |

#### CMO — 4 entries
| Schedule | Cron | Time (CT) |
|---|---|---|
| generate_content | `0 19 * * *` | 2:00 PM CT daily |
| process_assignments | `*/30 * * * *` | **Every 30 minutes** |
| work_loop (morning) | `0 14 * * *` | 9:00 AM CT |
| work_loop (midday) | `0 18 * * *` | 1:00 PM CT |

#### Sub-team agents (DB seed, `20260227100030_seed_sub_team_schedules.sql`)
| Agent | Cron | Task |
|---|---|---|
| platform-engineer | `0 */2 * * *` | health_check (every 2h) |
| quality-engineer | `0 13 * * *` | qa_report (daily) |
| devops-engineer | `0 12 * * *` | pipeline_report (daily) |
| user-researcher | `30 16 * * *` | cohort_analysis (daily) |
| competitive-intel | `0 14 * * *` | landscape_scan (daily) |
| revenue-analyst | `30 15 * * *` | revenue_report (daily) |
| cost-analyst | `30 15 * * *` | cost_report (daily) |
| content-creator | `0 16 * * *` | blog_draft (daily) |
| seo-analyst | `30 14 * * *` | ranking_report (daily) |
| social-media-manager | `0 15 * * *` + `0 22 * * *` | schedule_batch + engagement_report (daily ×2) |

---

## Section 3: Agent-by-Agent Cadence Recommendation

| Agent | Current Model | What It Does | Needs Recurring? | Recommended Model | Reason |
|---|---|---|---|---|---|
| **chief-of-staff** | 7 cron entries, `orchestrate` every hour | Orchestrates directives, generates briefings, delegates | Briefings: yes. Orchestrate: only if work exists | **Morning briefing: daily. Orchestrate: event-only when new directive arrives or assignment completes. Weekly/monthly: keep.** | Hourly orchestrate with no pending directives is pure churn. Orchestrate should be event-triggered. |
| **ops** (Atlas Vega) | 5 cron + event_response | Infrastructure health, costs, status reports | health_check + cost_check: yes. Status reports: probably not | **Keep: health_check (2h), cost_check (4h), event_response. Remove: morning_status, evening_status (merge into morning_briefing feed), performance_rollup (move to weekly), milestone_detection (event-only)** | Morning/evening status is theater if no one reads the output. Performance rollup daily is overkill. |
| **platform-intel** (Nexus) | 3× daily_analysis + memory_consolidation | Tool gap detection, fix proposals, config audits | Once daily sufficient | **1× daily at 7 AM CT. Remove 12 PM and 5 PM runs. Keep memory_consolidation nightly. watch_tool_gaps: event-only when tool failure rate spikes** | Tool gaps don't change 3× per day. Without new agent runs to analyze, midday/evening runs produce no new findings. |
| **cfo** | 2× daily cost check | Cost anomaly detection | Once daily sufficient | **1× daily morning. Remove afternoon run unless cost spike was detected in morning run** | GCP/Stripe billing data updates once daily. Afternoon check against same data is redundant. |
| **cto** | On-demand only (no cron found) | Platform health, dependency review | Minimal | **Weekly health check + on_demand. Remove if platform-engineer covers health_check** | CTO's `platform_health_check` overlaps with platform-engineer `health_check`. |
| **cmo** | 4 cron entries including every-30-min | Content planning, content creation, work queue processing | Planning: weekly. Creation: on assignment. Queue: event-only | **Keep weekly_content_planning. Remove every-30-min process_assignments (replace with event trigger). Keep daily generate_content only if active campaign exists.** | Process_assignments every 30 min is the most egregious churn in the system. It should trigger when a new assignment arrives, not by polling. |
| **clo** | No explicit cron found, on_demand | Regulatory scan, mail triage | Regulatory: weekly. Mail: event-triggered | **Regulatory_scan: weekly. agent365_mail_triage: event-only on new Teams/email message. Remove scheduled runs otherwise.** | Legal/compliance scanning doesn't need to be daily. Mail triage should be event-driven. |
| **cpo** | No explicit cron found | Usage analysis, competitive scan | Weekly | **Weekly only. No daily cadence.** | Usage data doesn't change enough for daily analysis to be meaningful. |
| **vp-sales** | No explicit cron found | Pipeline review, market sizing | Weekly | **Weekly only.** | Pipeline is CRM data; weekly cadence matches sales rhythms. |
| **vp-design** | No explicit cron found | Design audit, design system review | Sprint cadence | **Bi-weekly or assignment-only.** | Design system doesn't change daily. |
| **platform-engineer** | Every 2 hours (`0 */2 * * *`) | health_check, metrics_report | health_check: yes. metrics_report: daily | **Keep health_check (2h). Move metrics_report to daily.** | 2h health check is justified for infra monitoring. |
| **quality-engineer** | Daily (`0 13 * * *`) | qa_report, regression_check | Weekly or on PR | **Move to assignment-only or triggered on deploy events. Remove daily cron.** | QA reports without active development are noise. Should trigger on deploy or when assigned. |
| **devops-engineer** | Daily (`0 12 * * *`) | pipeline_report, optimization_scan | Weekly | **Weekly pipeline_report. optimization_scan: assignment-only.** | Daily pipeline reports with no CI changes are noise. |
| **user-researcher** | Daily (`30 16 * * *`) | cohort_analysis, churn_signals | Weekly | **Weekly or assignment-only.** | User cohort data doesn't change daily in a way that requires daily analysis. |
| **competitive-intel** | Daily (`0 14 * * *`) | landscape_scan, deep_dive | Weekly | **Weekly landscape_scan. deep_dive: assignment-only.** | Competitive landscape is weekly-relevant, not daily. |
| **revenue-analyst** | Daily (`30 15 * * *`) | revenue_report | Weekly or on data refresh | **Trigger on Stripe data sync completion (daily DataSync fires at 6 AM UTC). Weekly summary.** | Running revenue_report before fresh Stripe data arrives is meaningless. |
| **cost-analyst** | Daily (`30 15 * * *`) | cost_report | Daily, but after data sync | **Trigger after GCP billing sync (7 AM UTC). Remove time-based cron.** | Same data dependency issue as revenue-analyst. |
| **content-creator** | Daily (`0 16 * * *`) | blog_draft | Assignment-only | **Assignment-only.** | Creating blog drafts daily without a topic assignment generates content no one asked for. |
| **seo-analyst** | Daily (`30 14 * * *`) | ranking_report | Weekly | **Weekly.** | SEO rankings shift weekly, not daily. Daily runs produce near-identical reports. |
| **social-media-manager** | 2× daily | schedule_batch + engagement_report | schedule_batch: daily OK. engagement_report: weekly | **Keep daily schedule_batch. Move engagement_report to weekly.** | Scheduling posts daily is valid. Engagement reporting daily is noise unless actively running campaigns. |
| **m365-admin / global-admin** | No cron found, on_demand | Channel audit, access audit, mail triage | Audit: weekly. Triage: event-driven | **Weekly audits. Mail triage: event-only.** | Access audits weekly is appropriate. Daily would be overkill. |
| **head-of-hr** | No cron found | Workforce audit, onboarding | Event-only | **Event-only: onboard/retire on directive. Weekly workforce audit.** | HR events are discrete, not recurring. |
| **ui-ux-designer / frontend-engineer / design-critic / template-architect** | No cron found | Design and implementation work | Assignment-only | **Assignment-only.** | These are execution roles. They should never be on a recurring cron. |
| **vp-research / competitive-research-analyst / market-research-analyst** | No cron found | Research, deep dives | Assignment-only | **Assignment-only.** | Research is directive-driven, not scheduled. |

---

## Section 4: Behavior Change Recommendations

### Chief of Staff (Sarah)

**Current:** `orchestrate` fires every hour (`0 * * * *`) regardless of directive state.

**Change:**
```sql
-- Before dispatching orchestrate, check:
SELECT COUNT(*) FROM founder_directives 
WHERE status = 'active'
  AND updated_at > (SELECT COALESCE(MAX(completed_at), NOW() - INTERVAL '2 hours')
                    FROM agent_runs WHERE agent_id = 'chief-of-staff' AND task = 'orchestrate');
-- If count = 0, skip run entirely
```
- Only run `orchestrate` when: (a) new active directive exists since last run, OR (b) an assignment just completed and needs evaluation
- Remove duplicate weekly_review and monthly_retrospective entries from DB seed (conflict with cronManager entries)
- `morning_briefing` and `midday_digest` fire at same time — remove midday_digest or reschedule to noon

### Ops (Atlas Vega)

**Current:** Runs morning_status + evening_status + 3 performance jobs on top of health/cost/freshness checks.

**Change:**
- **Remove** `morning_status` cron — feed status data into Chief of Staff's `generate_briefing` directly instead of a separate report
- **Remove** `evening_status` cron — replace with a flag: only generate if `health_check` found ≥1 incident in past 12h
- **Move** `performance_rollup`, `milestone_detection`, `growth_update` to weekly (currently daily/near-daily)
- **Keep** `health_check` (2h), `cost_check` (4h), `freshness_check` (2× daily), `event_response` (reactive)

### Platform-Intel (Nexus)

**Current:** `daily_analysis` runs 3× per day at 7 AM, 12 PM, 5 PM CT.

**Change:**
- **Remove** 12 PM and 5 PM daily_analysis cron entries — keep only 7 AM CT
- **Add a skip gate:** before running daily_analysis, check if `fleet_findings` table has new entries since last run:
  ```sql
  SELECT COUNT(*) FROM fleet_findings 
  WHERE created_at > (SELECT MAX(started_at) FROM agent_runs WHERE agent_id = 'platform-intel' AND task = 'daily_analysis')
    AND resolved_at IS NULL;
  -- If 0 new findings, skip analysis (log reason)
  ```
- `watch_tool_gaps` should only trigger when `tool_call_traces.result_success = false` rate spikes above threshold

### CFO

**Current:** `daily_cost_check` runs twice daily (9 AM + 3 PM CT).

**Change:**
- **Remove** 3 PM run — Stripe/GCP data refreshes once daily at 6–7 AM UTC, so the afternoon run analyzes identical data
- **Add post-sync trigger:** Run cost_check 30 minutes after `sync-gcp-billing` and `sync-stripe` DataSync jobs complete, not on a fixed time

### CMO

**Current:** `process_assignments` fires every 30 minutes (`*/30 * * * *`).

**Change:**
- **Remove** `*/30 * * * *` cron for process_assignments entirely
- **Replace with event trigger:** fire when a new `work_assignments` row is created with `assigned_to = 'cmo'`
- `generate_content` daily — add gate: only run if CMO has an active content directive or ≥1 pending assignment

### Sub-team Specialists (content-creator, seo-analyst, user-researcher, competitive-intel, quality-engineer, devops-engineer, revenue-analyst, cost-analyst)

**Current:** All on daily cron schedules, unconditionally.

**Change for all:**
- **Downgrade to assignment-only** except where data-refresh-triggered makes sense
- **For data-dependent agents** (revenue-analyst, cost-analyst): replace time cron with DataSync completion trigger
- **For analysis agents** (seo-analyst, user-researcher, competitive-intel): move to weekly
- **For execution agents** (content-creator, quality-engineer, devops-engineer): assignment-only, no cron

### All Agents — Proof Before Completion

**Change:** Before any agent can set `work_assignments.status = 'completed'`, require:
- `agent_output IS NOT NULL AND LENGTH(agent_output) >= 100`
- At least 1 successful tool call linked to the run (`tool_call_traces WHERE result_success = true`)

---

## Section 5: Value Gate Audit

### Can Agents Currently Skip When There Is No Meaningful Work?

**No — except for a few task-internal soft gates:**

| Agent | Internal Skip Logic | Strength |
|---|---|---|
| Chief of Staff (orchestrate) | Scopes to top 5 directives — if none exist, produces minimal output | Soft — still runs and writes status |
| Platform-Intel (daily_analysis) | Only processes unresolved findings — if none, minimal output | Soft — still runs |
| Ops (contradiction_detection) | Silently skips if no contradictions | Soft — still runs |
| BatchOutcomeEvaluator | Redis lock + cooldown gate + empty check → returns early | **Hard gate — one of the few real skip patterns** |

All other agents: **no skip logic**. Cron fires → agent runs → writes some status → job done.

### Is There Delta-Based Triggering?

No. `DynamicScheduler.tick()` has no state comparison. `last_run_at` is passed to the event router's `wakeRouter` for wake rules, but this is used to **activate** agents, not to **skip** runs when nothing changed.

### Is There Value or Impact Scoring?

No. `founder_directives.priority` is a 4-level categorical enum. `computePerRunQualityScore()` measures execution efficiency (turns, tool failures, cost) — not whether the output was valuable.

### Does Current Scheduling Encourage Churn?

**Yes, structurally.** The pattern is:
1. Agent is built → cron entries are added
2. Cron fires unconditionally every N hours
3. Agent runs → writes to `agent_run_status` (narrative TEXT)
4. No one validates whether the output is different from the last run
5. Repeat indefinitely

### Minimum Viable Value Gate

A `should_run()` check in `DynamicScheduler.tick()` before dispatching each schedule:

```typescript
// Proposed addition to dynamicScheduler.ts
async function shouldRun(agentRole: string, task: string): Promise<boolean> {
  // Gate 1: Is there pending work for this agent?
  if (task === 'process_assignments' || task === 'orchestrate' || task === 'work_loop') {
    const pending = await systemQuery(
      `SELECT COUNT(*) as cnt FROM work_assignments 
       WHERE assigned_to = $1 AND status IN ('pending', 'dispatched')`,
      [agentRole]
    );
    if (pending[0].cnt === 0) return false;
  }

  // Gate 2: Did the last run produce a delta? (check agent_run_status recency)
  // If last run was < 30 min ago and completed successfully, skip
  const lastRun = await systemQuery(
    `SELECT completed_at FROM agent_runs 
     WHERE agent_id = $1 AND task = $2 AND status = 'completed'
     ORDER BY completed_at DESC LIMIT 1`,
    [agentRole, task]
  );
  if (lastRun[0]?.completed_at > new Date(Date.now() - 30 * 60 * 1000)) return false;

  return true;
}
```

This would eliminate the majority of churn runs without any architectural change.

---

## Section 6: Proof Requirement Recommendations

### Current State

`work_assignments.agent_output` is TEXT with no validation. `task_run_outcomes.final_status` is set by the agent without any proof requirement. A run can be marked `submitted` with a 5-word output or null.

### Required Proof by Completion State

| Agent Claim | Required Proof | Table/Column | Enforcement Point |
|---|---|---|---|
| `completed` | `work_assignments.agent_output` must be non-null, length ≥ 100 | `work_assignments.agent_output` | DB CHECK constraint or `write_work_assignment` tool validation |
| `submitted` | ≥1 `tool_call_traces` row with `result_success = true` linked to the run | `tool_call_traces.run_id` | `harvestTaskOutcome()` pre-check |
| `sent` | Tool call to send_email/send_message with `result_success = true` + recipient recorded | `tool_call_traces` WHERE `tool_name IN ('send_email','send_message','post_to_teams')` | Post-tool verification in `toolExecutor.ts` |
| `uploaded` | Tool call with file reference returned in `result_data JSONB` | `tool_call_traces.result_data` | Require `result_data.file_id` or `result_data.url` to be present |
| `fixed` | Linked `fleet_findings` row with `resolved_at IS NOT NULL` | `fleet_findings.resolved_at` | `apply_fix_proposal` tool should set resolved_at on completion |
| `reviewed` | `task_run_outcomes.turn_count >= 3` AND `tool_call_count >= 1` | `task_run_outcomes` | `computePerRunQualityScore()` gate |
| `analyzed` | `task_run_outcomes.output_tokens >= 200` AND `tool_call_count >= 1` | `task_run_outcomes` | `harvestTaskOutcome()` pre-check |

### Minimum Implementation

Add to `harvestTaskOutcome()` in `taskOutcomeHarvester.ts`:

```typescript
// Before writing final_status='submitted':
if (outcome.final_status === 'submitted') {
  const hasOutput = await systemQuery(
    `SELECT LENGTH(agent_output) as len FROM work_assignments WHERE id = $1`,
    [outcome.assignment_id]
  );
  if (!hasOutput[0]?.len || hasOutput[0].len < 100) {
    outcome.final_status = 'partial_progress';  // downgrade claim
    outcome.per_run_evaluation_notes += ' [DOWNGRADED: output too short to be submitted]';
  }

  const toolEvidence = await systemQuery(
    `SELECT COUNT(*) as cnt FROM tool_call_traces WHERE run_id = $1 AND result_success = true`,
    [outcome.run_id]
  );
  if (toolEvidence[0].cnt === 0) {
    outcome.final_status = 'partial_progress';  // no tool evidence
    outcome.per_run_evaluation_notes += ' [DOWNGRADED: no successful tool calls recorded]';
  }
}
```

---

## Section 7: Overlap and Churn Risk

### Status Theater Agents

These agents run on cron and produce status reports that go into `agent_run_status` (narrative TEXT). There is no evidence anyone reads these outputs systematically:

| Agent | Schedule | Output | Theater Risk |
|---|---|---|---|
| **ops morning_status** | 6 AM CT daily | Narrative health report | **High** — CoS morning_briefing covers same ground |
| **ops evening_status** | 5 PM CT daily | Narrative close-out | **High** — no evidence this is acted on |
| **platform-intel daily_analysis (noon + 5 PM)** | 7 AM, 12 PM, 5 PM CT | Tool gap findings | **High** — 12 PM and 5 PM repeat 7 AM work |
| **cfo afternoon cost_check** | 3 PM CT | Cost anomaly scan | **High** — runs on stale Stripe/GCP data |
| **content-creator daily blog_draft** | 3 PM CT | Blog post draft | **High** — drafts without topic assignment |
| **seo-analyst daily ranking_report** | 9:30 AM CT | SEO rankings | **High** — SEO data barely changes daily |
| **quality-engineer daily qa_report** | 8 AM CT | QA report | **High** — no active test suite delta |
| **devops-engineer daily pipeline_report** | 7 AM CT | Pipeline status | **Medium** — useful if CI runs daily |
| **user-researcher daily cohort_analysis** | 11:30 AM CT | Cohort data | **High** — user behavior doesn't shift daily |

### Actually Necessary Recurring Agents

| Agent | Task | Why It's Real |
|---|---|---|
| **ops** | `health_check` (2h), `cost_check` (4h) | Catches real failures, cost spikes |
| **ops** | `event_response` | Reactive to real system events |
| **platform-engineer** | `health_check` (2h) | Infrastructure monitoring |
| **DataSyncScheduler** | Billing syncs, memory consolidation | Actual data pipeline, not status theater |
| **chief-of-staff** | `generate_briefing` (daily) | Founder communication, orchestration |
| **platform-intel** | `daily_analysis` (1× at 7 AM) | Tool gap detection, genuinely changes things |
| **batchOutcomeEvaluator** | 2× daily | Quality scoring pipeline with real gates |

### Overlapping Responsibilities

| Overlap | Agents | Resolution |
|---|---|---|
| Morning status reporting | CoS `generate_briefing` + Ops `morning_status` | CoS briefing should ingest Ops health data; remove separate Ops morning_status |
| Cost monitoring | CFO `daily_cost_check` (2×) + Ops `cost_check` (4×) | CFO for trend analysis; Ops for anomaly alerts. Remove CFO afternoon run. |
| Platform health | Ops `health_check` + platform-engineer `health_check` + CTO `platform_health_check` | 3 agents monitoring same thing — consolidate to Ops + platform-engineer only |
| Weekly review | CoS `weekly_review` + 2 redundant DB seed entries | Remove DB seed entries that duplicate cronManager entries |
| Tool quality | platform-intel `daily_analysis` + Ops `contradiction_detection` | Different scopes (tool gaps vs knowledge contradictions) — keep separate but reduce platform-intel cadence |

### Roles That Are Mostly Prompts With Schedules

These roles have cron entries but their "work" is generic analysis with no unique data source:

- `competitive-intel` — daily landscape_scan with no confirmed external data source integration
- `user-researcher` — daily cohort_analysis, but no direct database or analytics platform integration confirmed
- `design-critic` — no cron, but `grade_builds` task with no clear artifact input mechanism

---

## Section 8: Recommended New Run Policy

### Policy Model (Implementable From Current Codebase)

**Tier 1: Always Reactive (no cron, event-only)**  
Agents that should only run when a real signal exists:
- `ops event_response` — real system events
- `clo agent365_mail_triage` — new Teams/email message
- `cmo process_assignments` — new assignment created
- `chief-of-staff process_directive` — new Slack message from founder
- All design/engineering execution agents — assignment-only

**Tier 2: Frequent Monitoring (keep current cadence)**  
Agents with real-time operational need:
- `ops health_check` — every 2 hours ✅
- `ops cost_check` — every 4 hours ✅
- `platform-engineer health_check` — every 2 hours ✅

**Tier 3: Daily (1× only, with skip gate)**  
Agents that need daily cadence but not multiple times:
- `chief-of-staff generate_briefing` — 7 AM CT only
- `platform-intel daily_analysis` — 7 AM CT only (remove noon + 5 PM)
- `cfo daily_cost_check` — after billing sync only (remove time-based)
- `ops freshness_check` — 1× daily (remove second run)

**Tier 4: Weekly (move from daily to weekly)**  
Agents currently running daily but whose data doesn't change daily:
- `seo-analyst ranking_report` — weekly
- `devops-engineer pipeline_report` — weekly
- `competitive-intel landscape_scan` — weekly
- `user-researcher cohort_analysis` — weekly
- `revenue-analyst revenue_report` — weekly (after weekly Stripe reconciliation)
- `cost-analyst cost_report` — weekly
- `ops performance_rollup`, `milestone_detection` — weekly

**Tier 5: Assignment-Only (remove all cron)**  
Execution agents that should never self-initiate:
- `content-creator blog_draft` — assignment-only
- `quality-engineer qa_report` — assignment-only or on deploy event
- `vp-research / research-analyst` — assignment-only
- `ui-ux-designer`, `frontend-engineer`, `design-critic`, `template-architect` — assignment-only
- `head-of-hr` — event-only

### Proof Policy (Pair with Run Policy)

| Final Status | Minimum Required Proof |
|---|---|
| `submitted` | agent_output length ≥ 100 AND ≥1 successful tool call |
| `completed` | agent_output length ≥ 50 AND assignment.expected_output partially matched |
| `analyzed` | output_tokens ≥ 200 AND ≥1 tool call |
| `sent` | tool_call_trace with tool_name in send/post set AND result_success = true |
| `fixed` | fleet_findings.resolved_at set for the target finding |
| `reviewed` | turn_count ≥ 3 AND tool_call_count ≥ 1 |

---

## Section 9: Highest-Value Next Build

**Build: A No-Work/No-Run Gate in `DynamicScheduler`**

### Justification

The single biggest source of churn is `DynamicScheduler.tick()` dispatching cron jobs regardless of whether there is anything to do. This is one function in one file: `packages/scheduler/src/dynamicScheduler.ts`.

Adding a `shouldRun()` pre-check here would immediately reduce churn across the entire agent fleet without touching any agent code, agent prompts, or worker logic.

### Implementation

```typescript
// packages/scheduler/src/dynamicScheduler.ts

// Add these policy-driven skip checks to tick():

const WORK_REQUIRED_TASKS = new Set([
  'orchestrate', 'process_assignments', 'work_loop',
  'check_escalations', 'process_directive',
]);

const SKIP_IF_RECENT_TASKS = new Set([
  'morning_briefing', 'midday_digest', 'eod_summary',
  'daily_cost_check', 'ranking_report', 'pipeline_report',
  'cohort_analysis', 'landscape_scan',
]);

async function shouldRunSchedule(
  agentId: string,
  task: string,
): Promise<{ run: boolean; reason?: string }> {

  // Gate 1: work-required tasks need pending assignments
  if (WORK_REQUIRED_TASKS.has(task)) {
    const { rows } = await systemQuery(
      `SELECT COUNT(*) AS cnt FROM work_assignments 
       WHERE assigned_to = $1 AND status IN ('pending','dispatched')`,
      [agentId],
    );
    if (Number(rows[0].cnt) === 0) {
      return { run: false, reason: 'no_pending_work' };
    }
  }

  // Gate 2: skip if a successful run completed in the last 45 minutes
  if (SKIP_IF_RECENT_TASKS.has(task)) {
    const { rows } = await systemQuery(
      `SELECT completed_at FROM agent_runs
       WHERE agent_id = $1 AND task = $2 AND status = 'completed'
       ORDER BY completed_at DESC LIMIT 1`,
      [agentId, task],
    );
    if (rows[0]?.completed_at > new Date(Date.now() - 45 * 60 * 1000)) {
      return { run: false, reason: 'recent_successful_run' };
    }
  }

  return { run: true };
}
```

Then in `tick()`:
```typescript
for (const schedule of matching) {
  const role = activeAgentMap.get(schedule.agent_id);
  if (!role) continue;

  // ADD: value gate check
  const { run, reason } = await shouldRunSchedule(schedule.agent_id, schedule.task);
  if (!run) {
    console.log(`[DynamicScheduler] Skipping ${schedule.agent_id}/${schedule.task}: ${reason}`);
    continue;  // ← this is the key line
  }

  await this.executor(role, schedule.task, schedule.payload ?? {});
}
```

### Expected Impact

- Eliminates CMO `process_assignments` runs when no assignments exist (currently fires **every 30 min**)
- Eliminates CoS `orchestrate` runs when no active directives (currently fires **every hour**)
- Eliminates duplicate daily report runs within 45 min of a prior run
- Zero changes to agent code, prompts, or worker
- Completely reversible — remove the gate if needed
- Loggable — `reason` string creates an audit trail of skipped runs

**Estimated effort:** 1 day. Single file change. No deployment risk.

---

## Section 10: File and Table Evidence

| Theme | File / Table | Finding |
|---|---|---|
| **Schedule definitions** | `packages/scheduler/src/cronManager.ts` lines 25–359 | 25 static cron jobs; chief-of-staff `orchestrate` fires every hour |
| **DB schedules seed** | `db/migrations/20260227100030_seed_sub_team_schedules.sql` | 12 sub-team agents on daily crons, unconditionally |
| **CMO 30-min poll** | `db/migrations/20260324130000_cmo_additional_agent_schedules.sql` | CMO process_assignments every 30 minutes — highest-churn cron |
| **Scheduler tick (no gate)** | `packages/scheduler/src/dynamicScheduler.ts:tick()` lines 106–163 | No skip logic, only active-agent gate |
| **DynamicScheduler start** | `packages/scheduler/src/dynamicScheduler.ts:start()` line 93 | `setInterval(() => this.tick(), 60_000)` |
| **DataSync jobs list** | `packages/scheduler/src/cronManager.ts:getEnabledSyncJobs()` lines 373–571 | 25 data sync jobs; memory-consolidation nightly; heartbeat every 10 min |
| **Worker agent roster** | `packages/worker/src/index.ts:executeAgentByRole()` lines 178–305 | 28 distinct agent roles dispatched |
| **Chief of Staff task list** | `packages/agents/src/chief-of-staff/run.ts` lines 44–56 | `orchestrate` scopes to top 5 directives; skips if none — soft gate only |
| **Ops task list** | `packages/agents/src/ops/run.ts` lines 33–34 | 12 task types; `event_response` is the only true reactive task |
| **Platform-Intel 3× daily** | `cronManager.ts` lines ~140–165 | `daily_analysis` at 7 AM, 12 PM, 5 PM UTC — most redundant schedule in system |
| **No skip gate** | `packages/scheduler/src/dynamicScheduler.ts` | No `shouldRun()` check anywhere; cron match = execute |
| **No deduplication** | `packages/scheduler/src/eventRouter.ts` lines 85–233 | No correlationId lookup; duplicate events create duplicate decisions |
| **No proof requirement** | `db/migrations/20260223200000_founder_orchestration.sql:work_assignments` | `agent_output TEXT` with no CHECK constraint |
| **Quality score (efficiency only)** | `packages/agent-runtime/src/taskOutcomeHarvester.ts:computePerRunQualityScore()` | Measures turns/cost/failures, not output value |
| **BatchEval has real gates** | `packages/scheduler/src/batchOutcomeEvaluator.ts` lines 51–98 | Redis lock + cooldown + empty check — only proper skip model in codebase |
| **Ops–CoS briefing overlap** | `cronManager.ts` morning_briefing (`0 12 * * *`) + Ops morning_status (`0 11 * * *`) | Both fire within 1 hour of each other, covering overlapping ground |
| **CFO duplicate cost check** | `cronManager.ts` `daily_cost_check` + `cfo-afternoon-costs` | Same GCP/Stripe data analyzed twice daily |
| **CoS duplicate schedule entries** | `cronManager.ts` + `db/migrations/20260227100001_seed_scheduled_reviews.sql` | weekly_review and monthly_retrospective defined in both — fires twice |

---

## Section 11: Final Judgment

### Which agents should keep frequent cadence

- `ops health_check` (2h) — justified
- `ops cost_check` (4h) — justified
- `platform-engineer health_check` (2h) — justified
- `ops event_response` — reactive, justified
- `DataSyncScheduler` billing/memory jobs — justified (data pipeline)
- `chief-of-staff generate_briefing` (1× daily) — justified

### Which should be slowed down

- `platform-intel daily_analysis` — 3× daily → 1× daily
- `ops morning_status + evening_status` — remove or merge into CoS briefing
- `cfo afternoon cost_check` — remove, run after billing sync only
- `ops performance_rollup + milestone_detection` — weekly
- `seo-analyst, user-researcher, competitive-intel, devops-engineer, quality-engineer` — daily → weekly

### Which should become assignment-only

- `cmo process_assignments` (every 30 min → event-triggered on new assignment)
- `content-creator blog_draft` — assignment-only
- `chief-of-staff orchestrate` — event-triggered when new directive arrives, not hourly cron
- All design/engineering execution roles (ui-ux-designer, frontend-engineer, design-critic, template-architect)
- All research roles (vp-research, competitive-research-analyst, market-research-analyst)
- `head-of-hr` — event-only

### Should Glyphor reduce agent activity before expanding capability?

**Yes, immediately.** The current model creates the illusion of a busy AI organization while obscuring which work is actually valuable. Before adding any new agents or capabilities, the existing schedule should be cut by approximately 40%. The highest-churn patterns (hourly orchestrate, 30-min CMO poll, 3× daily Nexus analysis, daily sub-team reports) add cost and noise without proportionate value.

The risk of over-activity is not just cost — it's signal corruption. When every agent runs every day regardless of context, it becomes impossible to identify which runs mattered. The audit trail becomes noise. The Reliability dashboard becomes meaningless.

### Single behavior change that would reduce the most churn fastest

**Add the `shouldRun()` gate to `DynamicScheduler.tick()`** — specifically, skip `orchestrate` and `process_assignments` tasks when `work_assignments` has no pending rows for that agent.

This single change in `packages/scheduler/src/dynamicScheduler.ts` would eliminate the two highest-frequency churn patterns (CoS hourly orchestrate + CMO every-30-min poll) and requires no changes to agent code, prompts, workers, or database schema. It is the minimum effective intervention with the maximum immediate impact.

---

*Generated 2026-04-07. Source files: `packages/scheduler/src/cronManager.ts`, `packages/scheduler/src/dynamicScheduler.ts`, `packages/scheduler/src/dataSyncScheduler.ts`, `packages/scheduler/src/eventRouter.ts`, `packages/agents/src/chief-of-staff/run.ts`, `packages/agents/src/ops/run.ts`, `packages/agents/src/platform-intel/run.ts`, `packages/worker/src/index.ts`, `db/migrations/20260227100030_seed_sub_team_schedules.sql`, `db/migrations/20260324130000_cmo_additional_agent_schedules.sql`.*

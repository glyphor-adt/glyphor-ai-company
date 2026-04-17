# Copilot Prompt — Customer Zero Protocol Feature

Copy this block into Copilot as your implementation brief.

---

Build the **Customer Zero Protocol** feature in the Glyphor repo. This is a dogfood test runner that lives in the AI Cockpit dashboard and lets us run scored tests against our own agent fleet.

## What you're building

A dashboard feature with three layers:

1. **Postgres tables** (`cz_tasks`, `cz_runs`, `cz_scores`) — source of truth for protocol tasks, execution history, and judge scores. Schema and seed data are in `CZ_PROTOCOL_DATA.md`.
2. **Backend API** on Cloud Run — endpoints to list tasks, kick off runs, stream live status, read scores. Contract below.
3. **Frontend** in the existing AI Cockpit React app — Pillar Scorecard + Task Grid + Live Run Console + Drift Chart.

## Stack — match what we already use

- Cloud SQL Postgres (add these tables to the existing DB, new migration file)
- Cloud Run for the API service (`cz-api`)
- Cloud Tasks for dispatching protocol runs to the fleet
- Pub/Sub for agent output capture (reuse existing topics, add `cz-run-id` to message attributes)
- React + TypeScript + Vite for the frontend (existing Cockpit)
- Tailwind with the current dark token system

## Data model (see `CZ_PROTOCOL_DATA.md` for schema + seed)

- `cz_tasks` — the 67 protocol tasks. Active flag for soft-delete. Supports ad-hoc additions via API.
- `cz_runs` — every execution. Mode (solo/orchestrated), status, timestamps, task link, triggering user.
- `cz_scores` — per-run result. Pass/fail, judge score 0-10, validator scores, reasoning trace, latency, token count.

## API contract — build these endpoints

```
GET    /api/cz/tasks                       list all active tasks, filterable by pillar/p0/agent
POST   /api/cz/tasks                       create ad-hoc task
PATCH  /api/cz/tasks/:id                   update/deactivate
GET    /api/cz/tasks/:id                   task detail + last N runs

POST   /api/cz/runs                        kick off a run. Body: { mode: 'single'|'pillar'|'critical'|'full'|'canary', target: <task_id|pillar_name|agent_name> }
GET    /api/cz/runs/:id                    run status + score when complete
GET    /api/cz/runs/:id/stream             SSE stream of live execution (agent thoughts, tool calls, judge arriving)
GET    /api/cz/runs                        list runs, filterable by task/mode/date

GET    /api/cz/scorecard                   aggregated pillar pass rates + launch-gate status
GET    /api/cz/drift?pillar=X&days=30      time-series for drift chart
```

## Run modes

The API accepts 5 modes on `POST /api/cz/runs`:

| Mode         | Behavior |
|--------------|----------|
| `single`     | Run one task (solo + orchestrated). Target = task_id. |
| `pillar`     | Run every active task in a pillar, parallel within the pillar. Target = pillar name. |
| `critical`   | Run all P0-flagged tasks only (Agentic Security + Legal Liability + Data Sovereignty). Pre-deploy gate. |
| `full`       | Run all 67 active tasks. Scheduled nightly at 2am via Cloud Scheduler. |
| `canary`     | Run every task whose `responsible_agent` = target. For post-prompt-change verification. |

**Default concurrency: pillar-at-a-time, parallel tasks inside a pillar, max 6 concurrent.** Don't let `full` mode fire all 67 at once — that hits rate limits on Claude/Gemini/GPT simultaneously.

## Execution flow per task

For each task, we run TWO executions and score BOTH:

1. **Solo:** dispatch directly to `responsible_agent`, capture output.
2. **Orchestrated:** dispatch to Sarah Chen, let her route, capture final output.

Both outputs go through the judge pipeline:

1. **Layer 1 — Heuristic gates (free, instant):** constitutional rule checks, unauthorized tool calls, PII/residency violations, prompt-injection signatures. Any fail here = hard fail, log incident, skip Layer 2/3. Critical for P0 pillars.
2. **Layer 2 — Cheap judge (Gemini Flash-Lite):** 5-axis scoring (clarity, specificity, voice match, factual accuracy, task fit). Runs on every output.
3. **Layer 3 — Triangulated judge (Claude + GPT → Sonnet judge):** runs when Layer 2 score <6 OR high variance OR task is P0 OR random 5% sample. Reuses the existing Ora triangulation code (`TRIANGULATED-CHAT-PLAN.md`).

Write the final score to `cz_scores` with full reasoning trace.

## Frontend — four panels in the AI Cockpit

1. **Pillar Scorecard (top):** 9 cards, one per pillar. Shows pass rate, avg score, solo-vs-orch delta, last run, color-coded against launch-gate thresholds (see `CZ_PROTOCOL_DATA.md` → "Launch Gates").
2. **Task Grid:** all tasks as rows. Columns: pillar, task, last solo score, last orch score, delta, last run, pass streak. Click row → detail drawer with judge reasoning. Checkboxes + "Run Selected" button. Filter by pillar, P0-only, failing, agent.
3. **Live Run Console:** when a run is active, streams agent thoughts/tool calls/judge scores via SSE. Collapses to history when done.
4. **Drift Chart:** line chart per pillar, last 30 days. Consumes `/api/cz/drift`.

## Ad-hoc task creation

Dashboard "Add Task" button opens a form: pillar (dropdown), sub-category, task, acceptance criteria, verification method (dropdown), responsible agent (dropdown of 29 agents), P0 flag. POSTs to `/api/cz/tasks`. Immediately available for runs. No deploy required.

## Launch-gate logic

Compute and expose on `/api/cz/scorecard`:

- **Design-partner-ready:** all P0 pillars at 100% pass, overall pass ≥80%, no orch delta worse than -1.0
- **Investor-ready:** all P0 pillars at 100%, overall pass ≥85%, avg judge ≥7.5
- **Public-launch-ready:** all P0 pillars at 100%, overall pass ≥90%, avg judge ≥8.0

Display as three traffic-light indicators at the top of the Scorecard.

## Build order

1. Migration + seed (`001_cz_schema.sql` + `002_cz_seed.sql` from `CZ_PROTOCOL_DATA.md`).
2. API service with `/tasks` CRUD + `/runs` kickoff (mock judge for now — just random scores).
3. Frontend Scorecard + Task Grid wired to API with mocked data.
4. Real judge pipeline integration (Layer 1 heuristics → Layer 2 Flash-Lite → Layer 3 triangulated).
5. SSE streaming + Live Run Console.
6. Drift Chart + Cloud Scheduler for nightly `full` runs.

Ship 1-3 first. That gives us a working dashboard with test data we can click through. Then wire the real fleet.

## Non-negotiables

- **Postgres is the source of truth.** No xlsx in the runtime path. If someone wants an export, add a `GET /api/cz/tasks/export.xlsx` endpoint later.
- **Tasks must be editable without deploys.** Ad-hoc additions via API only.
- **Solo and orchestrated scores are tracked separately.** The delta is a P0 signal — if orchestrated scores trail solo, Sarah is introducing drift and that's a bug we need to see immediately.
- **P0 pillar tasks (Agentic Security, Legal Liability, Data Sovereignty) always get Layer 3 triangulated judge.** No sampling. No skipping. Any failure pages us.
- **Heuristic gates (Layer 1) must run before any model call.** Failed constitutional check = instant fail, no model spend, log + alert.

## Files in this handoff

- `CZ_COPILOT_PROMPT.md` — this file
- `CZ_PROTOCOL_DATA.md` — schema SQL + all 67 tasks as INSERTs + config tables (pillar thresholds, launch gates)

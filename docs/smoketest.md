# Glyphor Architecture Smoke Test Suite

**Date:** 2026-03-02
**Purpose:** Verify every layer of the architecture works end-to-end
**Estimated time:** 2-3 hours for full pass

> **Database:** GCP Cloud SQL (PostgreSQL 15, instance `glyphor-db` in `us-central1`).
> SQL snippets target Cloud SQL directly via `psql` or any PostgreSQL client.
> The automated smoketest package (`@glyphor/smoketest`) uses `systemQuery`
> from `@glyphor/shared/db`.

---

## Running the Automated Smoketest

```bash
# Prerequisites: set env vars in .env at repo root
#   SCHEDULER_URL=https://glyphor-scheduler-610179349713.us-central1.run.app
#   DASHBOARD_URL=https://glyphor-dashboard-610179349713.us-central1.run.app
#   VOICE_GATEWAY_URL=https://voice-gateway-610179349713.us-central1.run.app
#   WORKER_URL=https://glyphor-worker-610179349713.us-central1.run.app
#   GCP_PROJECT=ai-glyphor-company
#
# For DB-dependent tests (layers 0,1,3-8,10), also set:
#   DATABASE_URL=postgresql://glyphor_system_user:<password>@<host>/glyphor
#   — OR —
#   DB_HOST=<Cloud SQL IP or proxy socket>
#   DB_NAME=glyphor
#   DB_USER=glyphor_system_user
#   DB_PASSWORD=<password>
#
# For M365 integration tests (layer 13), also set:
#   AZURE_TENANT_ID=<Azure tenant ID>
#   AZURE_CLIENT_ID=<Azure app registration client ID>
#   AZURE_CLIENT_SECRET=<Azure app registration secret>
#   TEAMS_TEAM_ID=<Microsoft Teams team ID>
#   TEAMS_CHANNEL_GENERAL_ID=<channel ID>
#   TEAMS_CHANNEL_ENGINEERING_ID=<channel ID>
#   SENDGRID_API_KEY=<SendGrid API key>

# Build and run all layers
cd packages/smoketest
npx tsc && node dist/index.js

# Run specific layers only
node dist/index.js --layer 0          # just infrastructure
node dist/index.js --layer 0,2,11     # infrastructure + models + dashboard
node dist/index.js --layer 0,1,2,3,4,5,6,7,8,10,11,12  # skip slow layer 9
```

Tests that require DB credentials will **fail** when `DATABASE_URL` or `DB_PASSWORD` is not configured. Ensure database credentials are set before running.

---

## How to Use This Document

Each test has:
- **What:** What you're testing
- **How:** Exact steps (SQL, API call, or UI action)
- **Pass:** What success looks like
- **Fail:** What failure looks like and likely root cause

Run in order — later tests depend on earlier ones passing.

---

## Layer 0: Infrastructure Health

### T0.1 — Cloud Run Services Responding

```bash
# Scheduler
curl -s https://glyphor-scheduler-<hash>-uc.a.run.app/health | jq .

# Dashboard
curl -s https://glyphor-dashboard-<hash>-uc.a.run.app/ -o /dev/null -w "%{http_code}"

# Voice Gateway
curl -s https://voice-gateway-<hash>-uc.a.run.app/health | jq .

# Worker (new — handles async agent runs & delivery)
curl -s https://glyphor-worker-<hash>-uc.a.run.app/health | jq .
```

**Pass:** Scheduler returns JSON with `{ status: "ok" }`. Dashboard returns 200. Voice returns health JSON. Worker returns `{ status: "ok" }`.
**Fail:** 503/502 = Cloud Run instance not starting. Check GCP Console → Cloud Run → Logs for startup errors.

### T0.2 — Cloud SQL Connection

```sql
-- Run via psql or Cloud SQL Studio
SELECT COUNT(*) as table_count FROM information_schema.tables 
WHERE table_schema = 'public';
```

**Pass:** Returns 90+ tables (includes new `tenants`, `tenant_members` tables from multi-tenancy migration).
**Fail:** If significantly fewer, migrations are missing. Check `db/migrations/` — should be 90+ files. Verify `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` env vars on Cloud Run services.

### T0.2b — Cloud SQL Multi-Tenancy

```sql
-- Verify tenant infrastructure exists
SELECT id, slug, display_name FROM tenants;
-- Should return at least Glyphor as tenant 0
SELECT COUNT(*) FROM information_schema.columns 
WHERE column_name = 'tenant_id' AND table_schema = 'public';
-- Should return 14+ (tables with tenant_id column)
```

**Pass:** Glyphor tenant exists (`00000000-0000-0000-0000-000000000000`). 14+ tables have `tenant_id` column. RLS policies are active.
**Fail:** Multi-tenancy migration files not applied. Run migrations `20260302100001` through `20260302100004`.

### T0.2c — Cloud Tasks Queues

```bash
gcloud tasks queues list --location=us-central1 --project=ai-glyphor-company
```

**Pass:** Three queues listed: `agent-runs`, `agent-delivery`, `agent-low-priority`.
**Fail:** Cloud Tasks not provisioned. Check Terraform `google_cloud_tasks_queue` resources.

### T0.2d — Cloud Storage Bucket

```bash
gsutil ls gs://glyphor-company-assets/
```

**Pass:** Bucket exists and is accessible.
**Fail:** GCS bucket not created. Check Terraform `google_storage_bucket` resource.

### T0.3 — Redis Connected

Check the scheduler logs for:
```
[RedisCache] Connected to Redis
```

**Pass:** Line appears within 5 seconds of instance startup.
**Fail:** If you see `[RedisCache] Disconnected` or no Redis log at all, GCP Memorystore isn't provisioned or the connection string is wrong. Check `REDIS_HOST` env var on the scheduler Cloud Run service. System will still function (graceful degradation) but without caching.

### T0.4 — GCP Secret Manager

```bash
gcloud secrets list --project=ai-glyphor-company --format="table(name)" | wc -l
```

**Pass:** 25+ secrets listed.
**Fail:** Missing secrets = agents can't authenticate to external services.

### T0.5 — Pub/Sub Topic Exists

```bash
gcloud pubsub topics list --project=ai-glyphor-company
```

**Pass:** `glyphor-agent-tasks` topic exists.
**Fail:** Cloud Scheduler cron jobs can't deliver messages. No scheduled agent runs will fire.

---

## Layer 1: Data Syncs

### T1.1 — Stripe Sync

```bash
curl -X POST https://<scheduler-url>/sync/stripe
```

```sql
-- Verify data landed
SELECT record_type, COUNT(*), MAX(created_at) as latest
FROM stripe_data 
GROUP BY record_type;
```

**Pass:** Returns `{ success: true, mrr: <number> }`. Stripe_data has recent rows.
**Fail:** Check `STRIPE_SECRET_KEY` in GCP Secrets. From logs: `sync-stripe failed`.

### T1.2 — Mercury Banking Sync

```bash
curl -X POST https://<scheduler-url>/sync/mercury
```

```sql
SELECT metric, value, date 
FROM financials 
WHERE product = 'mercury' 
ORDER BY date DESC LIMIT 5;
```

**Pass:** Returns `{ success: true, totalBalance: <amount> }`. Cash balance matches Mercury dashboard.
**Fail:** Check `MERCURY_API_KEY`. Common issue: API key rotated but GCP Secret not updated.

### T1.3 — GCP Billing Sync

```bash
curl -X POST https://<scheduler-url>/sync/gcp-billing
```

```sql
SELECT service, SUM(cost_usd) as total, MAX(recorded_at)
FROM gcp_billing 
WHERE recorded_at > NOW() - INTERVAL '7 days'
GROUP BY service 
ORDER BY total DESC LIMIT 10;
```

**Pass:** Returns 700+ rows synced. Billing data is current.
**Fail:** BigQuery billing export table not configured. Check `GCS_BILLING_TABLE` env var.

### T1.4 — Data Sync Status Check

```sql
-- All syncs should show recent success
SELECT id, status, last_success_at, last_failure_at, 
       consecutive_failures,
       EXTRACT(EPOCH FROM (NOW() - last_success_at))/3600 as hours_since_success
FROM data_sync_status 
ORDER BY last_success_at DESC NULLS LAST;
```

**Pass:** All syncs have `last_success_at` within expected window. Zero consecutive_failures.
**Fail:** Any sync with `consecutive_failures > 0` needs its API key / config checked. Known non-critical failures from logs: `openai-billing` (needs OPENAI_ADMIN_KEY), `sharepoint-knowledge` (needs SHAREPOINT_SITE_ID), `kling-billing` (needs KLING keys), `anthropic-billing` (invalid API key seen in logs).

---

## Layer 2: Agent Runtime — Model Clients

### T2.1 — Gemini Works

```bash
# Talk to any agent via dashboard chat — they default to gemini-3-flash-preview
curl -X POST https://<scheduler-url>/run \
  -H "Content-Type: application/json" \
  -d '{"agentRole":"ops","task":"on_demand","message":"Say hello and confirm your model."}'
```

**Pass:** Agent responds with text. Logs show `model_request` and `model_response` with no errors.
**Fail:** Check `GOOGLE_AI_API_KEY` secret.

### T2.2 — OpenAI Works (CRITICAL — Known Bug)

```bash
curl -X POST https://<scheduler-url>/run \
  -H "Content-Type: application/json" \
  -d '{"agentRole":"cto","task":"on_demand","message":"Just say hello, do not use any tools."}'
```

**Pass:** Marcus responds. No `400 Duplicate tool_call_id` error.
**Fail:** If the message triggers tool calls, you will likely hit the **duplicate tool_call_id bug** found in the logs. This is the critical bug blocking orchestration. Fix is in `packages/agent-runtime/src/providers/openai.ts` — tool_call_id generation must be unique per call. Test with a no-tool message first to confirm basic OpenAI connectivity.

### T2.3 — Anthropic Works

```sql
-- Temporarily switch an agent to Claude for testing
UPDATE company_agents SET model = 'claude-sonnet-4-20250514' WHERE role = 'clo';
```

Then chat with Victoria in the dashboard. After testing:
```sql
UPDATE company_agents SET model = 'gemini-3-flash-preview' WHERE role = 'clo';
```

**Pass:** Victoria responds using Claude.
**Fail:** Check `ANTHROPIC_API_KEY` secret. Also check the logs for the `unique tool_use IDs with per-call index` logic in the Anthropic adapter.

### T2.4 — Multi-Tool Turn (Regression Test for the Bug)

This specifically tests the duplicate tool_call_id issue:

```bash
curl -X POST https://<scheduler-url>/run \
  -H "Content-Type: application/json" \
  -d '{"agentRole":"cto","task":"on_demand","message":"Give me a full platform health check — check all services, all repos, all CI pipelines."}'
```

**Pass:** Marcus completes with multiple tool calls in a single turn, no 400 error.
**Fail:** `[openai] 400 Invalid parameter: Duplicate value for tool_call_id` = the bug is not yet fixed. **This blocks ALL orchestration.** Do not proceed past this test until fixed.

---

## Layer 3: Heartbeat & Work Loop

### T3.1 — Heartbeat Is Firing

```sql
-- Should see heartbeat runs every ~10 minutes
SELECT started_at, duration_ms, status
FROM agent_runs 
WHERE task = 'heartbeat' OR agent_id = 'chief-of-staff'
ORDER BY started_at DESC LIMIT 10;
```

Also check Cloud Scheduler:
```bash
gcloud scheduler jobs list --project=ai-glyphor-company --location=us-central1
```

**Pass:** Heartbeat entries appear every 10 minutes. Cloud Scheduler shows `heartbeat` job as ENABLED with recent `lastAttemptTime`.
**Fail:** If no heartbeat runs, check: (1) Cloud Scheduler job exists and is enabled, (2) Pub/Sub topic is connected, (3) DataSyncScheduler fallback is running (should fire heartbeat on startup — we saw this in the logs).

### T3.2 — Heartbeat Tier Selection

```sql
-- Check which agents ran in the last hour and why
SELECT agent_id, task, status, started_at,
       CASE 
         WHEN agent_id IN ('chief-of-staff','cto','ops') THEN 'HIGH (10min)'
         WHEN agent_id IN ('cfo','cpo','cmo','vp-customer-success','vp-sales','vp-design','vp-research','clo') THEN 'MEDIUM (20min)'
         ELSE 'LOW (30min)'
       END as expected_tier
FROM agent_runs 
WHERE started_at > NOW() - INTERVAL '1 hour'
ORDER BY started_at DESC;
```

**Pass:** High-tier agents (CoS, CTO, Ops) run every ~10 min. Medium every ~20 min. Low every ~30 min.
**Fail:** If only high-tier agents are running, heartbeat cycle might be timing out before reaching lower tiers. Check if heartbeat duration_ms is close to 120s.

### T3.3 — Proactive Mode Disabled for Sub-Team

```sql
-- Sub-team agents should NOT have any proactive runs after the fix
SELECT agent_id, task, status, started_at
FROM agent_runs 
WHERE task = 'proactive' 
  AND agent_id NOT IN ('chief-of-staff','cto','cfo','cpo','cmo',
                        'vp-customer-success','vp-sales','vp-design',
                        'vp-research','clo','ops','global-admin')
  AND started_at > NOW() - INTERVAL '4 hours'
ORDER BY started_at DESC;
```

**Pass:** Zero rows returned. Sub-team agents only run when assigned work.
**Fail:** Proactive disable didn't deploy, or the agent is categorized wrong in the cooldown map.

### T3.4 — Abort Cooldown (Exponential Backoff)

```sql
-- Check that aborted agents recover faster than 30 min
SELECT a1.agent_id, a1.started_at as abort_time, 
       MIN(a2.started_at) as next_run,
       EXTRACT(EPOCH FROM (MIN(a2.started_at) - a1.started_at))/60 as minutes_to_recovery
FROM agent_runs a1
JOIN agent_runs a2 ON a1.agent_id = a2.agent_id AND a2.started_at > a1.started_at
WHERE a1.status = 'aborted' 
  AND a1.started_at > NOW() - INTERVAL '4 hours'
GROUP BY a1.agent_id, a1.started_at
ORDER BY minutes_to_recovery DESC;
```

**Pass:** Recovery times start at ~5 minutes (not 30).
**Fail:** Exponential backoff code didn't deploy. Still using flat 30-min cooldown.

---

## Layer 4: Orchestration Loop (MOST CRITICAL)

### T4.0 — Direct Work Assignment

Tests the CTO's ability to create work assignments directly (without a directive), simulating the `assign_task` tool.

```sql
INSERT INTO work_assignments (assigned_to, assigned_by, task_description, task_type, expected_output, priority, status, directive_id)
VALUES ('platform-engineer', 'cto', 'Smoke test: Verify platform health monitoring is operational', 'on_demand', 'Confirmation that all health checks are passing', 'normal', 'pending', NULL);
```

**Pass:** Assignment row is created successfully with a valid ID. `directive_id` can be NULL for CTO-assigned tasks.
**Fail:** Schema mismatch — check that `work_assignments` table has all required columns.

### T4.1 — Create a Directive

Go to Dashboard → Directives → Create New:
- **Title:** "Smoke Test — Competitive Brief"
- **Description:** "Create a brief comparing Glyphor ADT to top 3 competitors in the AI agent platform space. Include pricing, features, and market positioning. Deliver as a structured markdown document."
- **Priority:** Medium
- **Category:** Research

**Pass:** Directive appears in the directives list with status `active`.

### T4.2 — Sarah Detects the Directive

```sql
-- Check within 10 minutes
SELECT id, title, status, created_at
FROM founder_directives 
WHERE title LIKE '%Smoke Test%'
ORDER BY created_at DESC LIMIT 1;
```

Watch logs for:
```
[Heartbeat] CoS: 1 new directive(s) detected: "Smoke Test — Competitive Brief"
```

**Pass:** Heartbeat log shows directive detected. Sarah's run starts with `cos-orchestrate` task.
**Fail:** If Sarah doesn't wake: (1) Check if she's in abort cooldown from the tool_call_id bug, (2) Check if the directive detection query matches the status, (3) Check if Sarah was dispatched but hit the OpenAI 400 error.

### T4.3 — Sarah Creates Assignments

```sql
-- Get the directive ID first
SELECT id FROM founder_directives WHERE title LIKE '%Smoke Test%' ORDER BY created_at DESC LIMIT 1;

-- Then check assignments (replace <id>)
SELECT assigned_to, task_description, status, sequence_order, depends_on, 
       LENGTH(task_description) as instruction_length
FROM work_assignments 
WHERE directive_id = '<id>'
ORDER BY sequence_order, created_at;
```

**Pass:** 2-4 assignments created. Parallel research tasks (sequence_order=0) + synthesis task (sequence_order=1, depends_on the parallel ones). Instruction lengths should be 200+ characters (CHECK 4 — context embedding).
**Fail scenarios:**
- Zero assignments = Sarah never got to the assignment creation step (likely crashed on tool_call_id bug)
- Assignments with short instructions (<100 chars) = CHECK 4 failing, context starvation incoming
- All assignments to one agent = Sarah's decomposition logic needs tuning

### T4.4 — Agents Pick Up Assignments

```sql
-- Watch for work_loop runs triggered by the assignments
SELECT agent_id, task, status, turns, tool_calls, duration_ms, error, started_at
FROM agent_runs 
WHERE task = 'work_loop'
  AND started_at > NOW() - INTERVAL '30 minutes'
ORDER BY started_at DESC;
```

```sql
-- Check assignment status progression
SELECT assigned_to, status, updated_at,
       EXTRACT(EPOCH FROM (NOW() - updated_at))/60 as minutes_since_update
FROM work_assignments 
WHERE directive_id = '<id>'
ORDER BY updated_at DESC;
```

**Pass:** Assigned agents run with `task='work_loop'`, complete successfully, assignments move from `dispatched` → `in_progress` → `completed`.
**Fail scenarios:**
- Agents never run = concurrency guard blocking (stale running status), abort cooldown, or MIN_RUN_GAP
- Agents run but abort = stall detection (check error field), timeout, or tool failure
- Assignments stuck in `dispatched` = agents not picking up work from P2 queue
- Assignments stuck in `in_progress` = agent running but not calling `submit_assignment_output`

### T4.5 — Dependency Resolution

```sql
-- Check that sequential assignments dispatch after parallel ones complete
SELECT assigned_to, status, sequence_order, depends_on, updated_at
FROM work_assignments 
WHERE directive_id = '<id>'
ORDER BY sequence_order;
```

**Pass:** sequence_order=1 assignment moves to `dispatched` only after ALL sequence_order=0 assignments are `completed`.
**Fail:** `dispatchDependentAssignments()` in assignment tools not firing, or the dependency check logic has a bug.

### T4.6 — Sarah Evaluates & Synthesizes

```sql
-- Check for Sarah's evaluation runs
SELECT task, status, turns, tool_calls, started_at
FROM agent_runs 
WHERE agent_id = 'chief-of-staff'
  AND started_at > NOW() - INTERVAL '1 hour'
ORDER BY started_at DESC;

-- Check assignment evaluations
SELECT assigned_to, status, quality_score, evaluation
FROM work_assignments 
WHERE directive_id = '<id>';

-- Check directive completion
SELECT status, completion_summary
FROM founder_directives 
WHERE id = '<id>';
```

**Pass:** Directive status = `completed`. `completion_summary` contains a synthesized deliverable. All assignments have quality_score > 0.
**Fail:** Sarah is the bottleneck — she has to evaluate each output and synthesize. If she crashes (tool_call_id bug), the whole chain stalls.

### T4.7 — Full Loop Timing

Calculate end-to-end time:
```sql
SELECT fd.created_at as directive_created,
       fd.updated_at as directive_completed,
       EXTRACT(EPOCH FROM (fd.updated_at - fd.created_at))/60 as total_minutes
FROM founder_directives fd
WHERE fd.id = '<id>';
```

**Pass:** Total time under 30 minutes for a medium-complexity directive.
**Fail:** If >60 minutes, check where time was spent (heartbeat detection lag, agent execution time, evaluation lag, dependency resolution lag).

---

## Layer 5: Communication

### T5.1 — Inter-Agent DMs

```bash
# Have Sarah send a message to the CTO
curl -X POST https://<scheduler-url>/run \
  -H "Content-Type: application/json" \
  -d '{"agentRole":"chief-of-staff","task":"on_demand","message":"Send a message to Marcus asking for a quick platform status update."}'
```

```sql
-- Verify message was created
SELECT from_agent, to_agent, message, status, priority, created_at
FROM agent_messages 
ORDER BY created_at DESC LIMIT 5;
```

**Pass:** Message appears with `from_agent='chief-of-staff'`, `to_agent='cto'`, `status='pending'`.
**Fail:** Rate limit hit (5/hr), or `send_agent_message` tool not in Sarah's tool grants.

### T5.2 — Message Pickup

Wait for Marcus's next heartbeat run, then:
```sql
SELECT from_agent, to_agent, status, responded_at
FROM agent_messages 
WHERE to_agent = 'cto' 
ORDER BY created_at DESC LIMIT 5;
```

**Pass:** Message status changes from `pending` to `read` (or `responded` if Marcus replies).
**Fail:** `pendingMessageLoader` not injecting messages into Marcus's context, or Marcus is in abort cooldown.

### T5.3 — Multi-Agent Meeting

```bash
curl -X POST https://<scheduler-url>/meetings/call \
  -H "Content-Type: application/json" \
  -d '{"title":"Smoke Test Meeting","attendees":["cto","cfo","cpo"],"purpose":"Quick alignment check","meeting_type":"standup"}'
```

```sql
SELECT id, title, status, attendees, rounds, summary, action_items
FROM agent_meetings 
ORDER BY created_at DESC LIMIT 1;
```

**Pass:** Meeting status progresses from `in_progress` to `completed`. Has rounds with contributions from each attendee. Summary and action_items populated.
**Fail:** Meeting engine may timeout if attendees are in abort cooldown. Check rate limits (2/day per agent, 10/day system-wide).

### T5.4 — Teams Channel Delivery

```sql
-- Check recent Teams activity
SELECT agent_role, action, summary
FROM activity_log 
WHERE action LIKE '%teams%' OR action LIKE '%briefing%' OR action LIKE '%channel%'
ORDER BY created_at DESC LIMIT 10;
```

**Pass:** Recent briefings show delivery to Teams channels.
**Fail:** Check Azure credentials: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `BOT_APP_ID`. Also check `TEAMS_CHANNEL_*_ID` secrets.

### T5.5 — Agent Email

```sql
-- Check if email-enabled agents can send
SELECT agent_role, action, summary
FROM activity_log 
WHERE action LIKE '%email%'
ORDER BY created_at DESC LIMIT 10;
```

```bash
# Test email send through an agent
curl -X POST https://<scheduler-url>/run \
  -H "Content-Type: application/json" \
  -d '{"agentRole":"cmo","task":"on_demand","message":"Send a test email to kristina@glyphor.ai with subject Smoke Test and body This is an automated smoke test."}'
```

**Pass:** Email appears in inbox.
**Fail:** Graph API permissions, or the agent doesn't have `send_email` in its tool grants.

---

## Layer 6: Authority Gates

### T6.1 — Green Tier (Auto-Execute)

```bash
# On-demand chat is always GREEN
curl -X POST https://<scheduler-url>/run \
  -H "Content-Type: application/json" \
  -d '{"agentRole":"cfo","task":"on_demand","message":"What are our current costs?"}'
```

**Pass:** Executes immediately, no decision filed.

### T6.2 — Yellow Tier (One Founder Approval)

```bash
# Trigger a yellow-tier action (e.g., Sarah granting a write tool)
curl -X POST https://<scheduler-url>/run \
  -H "Content-Type: application/json" \
  -d '{"agentRole":"chief-of-staff","task":"on_demand","message":"Grant the web_search tool to the revenue-analyst agent for the next 24 hours."}'
```

```sql
-- Check if decision was filed
SELECT id, tier, status, title, proposed_by
FROM decisions 
ORDER BY created_at DESC LIMIT 5;
```

**Pass:** Decision appears with `tier='yellow'`, `status='pending'`. Adaptive Card sent to #decisions channel in Teams.
**Fail:** Authority gate classification wrong for this action, or `decisionQueue.submit()` failing.

### T6.3 — Decision Approval Flow

Go to Dashboard → Approvals. Find the pending decision. Click Approve.

```sql
SELECT id, status, resolved_by, resolved_at
FROM decisions 
WHERE id = '<decision_id>';
```

**Pass:** Status changes to `approved`. `resolved_by` shows your name.
**Fail:** Dashboard Approvals page not loading, or the resolve endpoint failing.

### T6.4 — Trust Score Modulation

```sql
-- Check current trust scores
SELECT agent_role, trust_score, total_runs, successful_runs, human_overrides, formal_failures, updated_at
FROM agent_trust_scores 
ORDER BY trust_score ASC;
```

**Pass:** All agents have trust_score between 0.1 and 1.0. No agent below 0.4 (which would force RED tier).
**Fail:** If agents have very low trust scores, check if the constitutional evaluator or drift detector is being too aggressive. Temporarily raise scores:
```sql
UPDATE agent_trust_scores SET trust_score = 0.7 WHERE trust_score < 0.5;
```

---

## Layer 7: Intelligence Enhancements

### T7.1 — Constitutional Governance

```sql
-- Check constitutions are seeded
SELECT agent_role, version, 
       jsonb_array_length(principles) as principle_count
FROM agent_constitutions 
WHERE active = true;
```

```sql
-- Check evaluations are being recorded
SELECT agent_role, compliance_score, created_at
FROM constitutional_evaluations 
ORDER BY created_at DESC LIMIT 10;
```

**Pass:** Every active agent has a constitution. Recent runs have evaluations with compliance_score > 0.5.
**Fail:** If no constitutions: `constitutionDefaults.ts` seeding not triggered. If no evaluations: the post-run constitutional eval step is disabled or crashing.

### T7.2 — Decision Chains

```sql
-- Check chains are being created during orchestration
SELECT chain_id, initiating_agent, status, 
       jsonb_array_length(links) as link_count,
       created_at
FROM decision_chains 
ORDER BY created_at DESC LIMIT 10;
```

**Pass:** Chains exist with multiple links for orchestration runs.
**Fail:** `decisionChainTracker` not wired into the run loop, or batch flush timer not firing.

### T7.3 — Formal Verification

```sql
-- Check if formal verification is running on tool calls
SELECT agent_role, action, response_summary
FROM platform_audit_log 
WHERE action LIKE '%verif%' OR response_summary LIKE '%verif%'
ORDER BY timestamp DESC LIMIT 10;
```

**Pass:** Verification entries appear for budget-related tool calls.
**Fail:** `formalVerifier` not wired into `toolExecutor.ts`, or enforcement flag is off.

### T7.4 — Causal Knowledge Graph

```sql
-- Check for causal edges
SELECT ke.edge_type, ke.causal_confidence, ke.causal_mechanism,
       kn1.title as source, kn2.title as target
FROM kg_edges ke
JOIN kg_nodes kn1 ON ke.source_id = kn1.id
JOIN kg_nodes kn2 ON ke.target_id = kn2.id
WHERE ke.causal_confidence IS NOT NULL
ORDER BY ke.causal_confidence DESC
LIMIT 10;
```

**Pass:** Causal edges exist with confidence scores and mechanisms.
**Fail:** No causal edges = `upsertCausalEdge` never called. Agents need to discover causal relationships during analysis runs.

### T7.5 — Episodic Replay

```sql
-- Check if episodic replay is running
SELECT id, author_agent, episode_type, significance_score, created_at
FROM shared_episodes 
ORDER BY created_at DESC LIMIT 10;

-- Check for high-significance episodes (replay should surface these)
SELECT COUNT(*) as total, 
       COUNT(*) FILTER (WHERE significance_score > 0.7) as high_sig,
       COUNT(*) FILTER (WHERE significance_score > 0.5) as medium_sig
FROM shared_episodes;
```

**Pass:** Episodes exist with varying significance scores. Some have been updated above default 0.5 (meaning replay ran and evaluated them).
**Fail:** Replay not scheduled, or Redis lock preventing execution. Check for `episodic-replay-lock` key in Redis.

### T7.6 — Drift Detection

```sql
-- Check for drift alerts
SELECT agent_role, metric, baseline_value, recent_value, 
       deviation_sigma, severity, acknowledged, detected_at
FROM drift_alerts 
ORDER BY detected_at DESC LIMIT 20;
```

**Pass:** Drift alerts exist (some are expected as the system stabilizes). No `critical` unacknowledged alerts.
**Fail:** If zero alerts and the system has been running for days, drift detection may not be scheduled. Check that the 6-hour cron is active.

### T7.7 — Verifier Agents (Manual Test)

```bash
# Trigger a verification manually
curl -X POST https://<scheduler-url>/run \
  -H "Content-Type: application/json" \
  -d '{"agentRole":"cfo","task":"on_demand","message":"Run a financial health assessment and verify the results with cross-model verification."}'
```

**Pass:** Logs show a secondary model (Claude or Gemini) evaluating the primary model's output. `VerificationReport` with verdict field.
**Fail:** Verifier not wired in for on-demand runs (may only be active for red-tier decisions). Check `verifierRunner.ts` integration points.

---

## Layer 8: Knowledge Graph

### T8.1 — Graph Has Nodes

```sql
SELECT node_type, COUNT(*) as count
FROM kg_nodes 
WHERE status = 'active'
GROUP BY node_type 
ORDER BY count DESC;
```

**Pass:** Multiple node types with reasonable counts. Should have at least: `entity`, `fact`, `observation`, `pattern`.
**Fail:** GraphRAG indexer hasn't run, or agents aren't writing graph ops during reflection.

### T8.2 — Graph Has Edges

```sql
SELECT edge_type, COUNT(*) as count, AVG(confidence) as avg_confidence
FROM kg_edges 
GROUP BY edge_type 
ORDER BY count DESC;
```

**Pass:** Multiple edge types. `relates_to` and `causes` should be most common.
**Fail:** Graph writer not creating edges during agent reflection.

### T8.3 — Semantic Search Works

```sql
-- Test the match_kg_nodes RPC (requires a query embedding)
-- Simpler: check that embeddings exist
SELECT COUNT(*) as nodes_with_embeddings
FROM kg_nodes 
WHERE embedding IS NOT NULL;
```

**Pass:** Most nodes have embeddings.
**Fail:** `EmbeddingClient` failing to generate embeddings. Check `GOOGLE_AI_API_KEY` and that `gemini-embedding-001` model is accessible.

### T8.4 — GraphRAG Indexer

```bash
# Check last index run
curl -X POST https://<scheduler-url>/sync/graphrag-index
```

**Pass:** Returns success or "already indexed recently."
**Fail:** GraphRAG Python service not deployed or not reachable. Check if the Cloud Run service exists. From logs: `sync-graphrag-index failed: fetch failed` = service URL is wrong or service is down.

---

## Layer 9: Strategy & Analysis Engines

### T9.1 — Strategic Analysis

```bash
curl -X POST https://<scheduler-url>/analysis/run \
  -H "Content-Type: application/json" \
  -d '{"type":"competitive_landscape","query":"AI agent platforms market","depth":"quick"}'
```

```sql
SELECT id, type, status, query, 
       jsonb_array_length(threads) as thread_count,
       created_at, completed_at
FROM analyses 
ORDER BY created_at DESC LIMIT 1;
```

**Pass:** Analysis progresses through phases (PLAN → SPAWN → EXECUTE → SYNTHESIZE → CLEANUP) and completes with a report.
**Fail:** Temporary agents fail to spawn, or individual research threads timeout.

### T9.2 — T+1 Simulation

```bash
curl -X POST https://<scheduler-url>/simulation/run \
  -H "Content-Type: application/json" \
  -d '{"action":"Increase marketing budget by 50%","perspective":"neutral"}'
```

```sql
SELECT id, action, status, perspective
FROM simulations 
ORDER BY created_at DESC LIMIT 1;
```

**Pass:** Simulation completes with impact dimensions and cascade analysis.
**Fail:** Simulation engine spawns perspective agents that may hit the same tool_call_id bug if on GPT-5.2.

### T9.3 — Chain of Thought

```bash
curl -X POST https://<scheduler-url>/cot/run \
  -H "Content-Type: application/json" \
  -d '{"query":"Should we prioritize enterprise sales or self-serve growth for Glyphor ADT?"}'
```

**Pass:** CoT progresses through DECOMPOSE → MAP → ANALYZE → VALIDATE.

### T9.4 — Deep Dive

```bash
curl -X POST https://<scheduler-url>/deep-dive/run \
  -H "Content-Type: application/json" \
  -d '{"target":"Glyphor ADT competitive positioning","context":"AI agent platform market 2026"}'
```

**Pass:** Deep dive completes with cited evidence and structured recommendations.

---

## Layer 10: Specialist Agents (DB-Defined)

### T10.1 — Dynamic Runner Works

```bash
# Test a specialist agent
curl -X POST https://<scheduler-url>/run \
  -H "Content-Type: application/json" \
  -d '{"agentRole":"adi-rose","task":"on_demand","message":"Hello, please confirm you are working and tell me your role."}'
```

**Pass:** Adi Rose responds with her role description, personality intact.
**Fail:** `runDynamicAgent.ts` not properly routing specialist roles. Check that `adi-rose` exists in `company_agents` table and has a brief in `agent_briefs`.

### T10.2 — All Specialists Have Briefs

```sql
SELECT ca.role, ca.display_name, 
       ab.id IS NOT NULL as has_brief,
       ap.id IS NOT NULL as has_profile,
       ats.trust_score
FROM company_agents ca
LEFT JOIN agent_briefs ab ON ab.agent_id = ca.role
LEFT JOIN agent_profiles ap ON ap.agent_id = ca.role
LEFT JOIN agent_trust_scores ats ON ats.agent_role = ca.role
WHERE ca.role IN ('enterprise-account-researcher','bob-the-tax-pro',
                   'data-integrity-auditor','tax-strategy-specialist',
                   'lead-gen-specialist','marketing-intelligence-analyst','adi-rose')
ORDER BY ca.role;
```

**Pass:** All 7 specialists have briefs, profiles, and trust scores.
**Fail:** Missing briefs = agent will run with no role context. Missing profiles = no personality injection.

### T10.3 — Specialists in Authority Gates

```sql
-- Check tool grants exist for specialists
SELECT agent_role, COUNT(*) as grant_count
FROM agent_tool_grants 
WHERE agent_role IN ('enterprise-account-researcher','bob-the-tax-pro',
                      'data-integrity-auditor','tax-strategy-specialist',
                      'lead-gen-specialist','marketing-intelligence-analyst','adi-rose')
  AND is_active = true
GROUP BY agent_role;
```

**Pass:** Each specialist has baseline tool grants.
**Fail:** Specialists weren't included in the baseline seed. They'll have no tools except shared defaults.

---

## Layer 11: Dashboard & API

The automated smoketest (T11.1–T11.6) validates all 20 dashboard pages, security headers, SPA bundle loading, and legacy redirects.

### T11.1 — Dashboard Loads

Open `https://glyphor-dashboard-<hash>-uc.a.run.app/` in browser.

**Pass:** Dashboard loads, shows agent overview with 44 headcount. Auth works (Firebase Auth — Google OAuth or Teams SSO).
**Fail:** Blank page = build error. Check `VITE_FIREBASE_*` and `VITE_API_URL` build args. CORS errors = scheduler URL mismatch. Auth redirect failures = Firebase Auth config mismatch (check `VITE_FIREBASE_AUTH_DOMAIN`).

### T11.2 — All Pages Render (20 pages)

The automated smoketest fetches all 20 routes and verifies HTTP 200:

| Page | URL | What to Check |
|------|-----|--------------|
| Dashboard (Home) | `/` | Main dashboard |
| Directives | `/directives` | Directive list |
| Workforce | `/workforce` | Org chart shows departments and agents |
| Agent Builder | `/agents/new` | Create new agent form |
| Workforce Builder | `/builder` | Workforce builder |
| Agent Profile | `/agents/chief-of-staff` | All tabs load |
| Agent Settings | `/agents/chief-of-staff/settings` | Agent config |
| Approvals | `/approvals` | Pending decisions |
| Financials | `/financials` | Stripe MRR, GCP costs, Mercury balance |
| Operations | `/operations` | Event log |
| Strategy | `/strategy` | Analyses and simulations |
| Knowledge | `/knowledge` | Knowledge base sections |
| Capabilities | `/capabilities` | Capability registry |
| Skill Detail | `/skills/research` | Individual skill view |
| Comms | `/comms` | Chat and meetings tabs |
| Chat | `/chat/chief-of-staff` | Chat interface with specific agent |
| Teams Config | `/teams-config` | Teams integration settings |
| Governance | `/governance` | Governance dashboard |
| Change Requests | `/change-requests` | Change request list |
| Settings | `/settings` | Settings |

**Pass:** All pages return 200.
**Fail:** Individual page failures indicate missing data or API endpoint errors.

### T11.3 — Security Headers Present

The automated smoketest verifies these headers on every response:
- `Content-Security-Policy: frame-ancestors ...`
- `Cross-Origin-Opener-Policy: same-origin-allow-popups`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

**Pass:** All headers present on dashboard responses.
**Fail:** Check `docker/nginx.conf` — headers must be repeated in each `location` block.

### T11.4 — SPA Bundle Loads

**Pass:** HTML contains `<script` and `<link` tags pointing to hashed assets.
**Fail:** Vite build failed or assets not served correctly.

### T11.5 — Health Check Endpoint

```bash
curl -s https://glyphor-dashboard-<hash>-uc.a.run.app/healthz
```

**Pass:** Returns 200.
**Fail:** Health check route not configured in nginx. Skips if endpoint returns 404.

### T11.6 — Legacy Redirects

**Pass:** Legacy routes (`/agents`, `/chat`, `/activity`, `/graph`, `/skills`, `/meetings`, `/world-model`, `/group-chat`) resolve with HTTP 200.
**Fail:** nginx not configured to serve index.html for these SPA routes.

---

## Layer 12: Voice Gateway

### T12.1 — Voice Service Health

```bash
curl -s https://voice-gateway-<hash>-uc.a.run.app/health
```

**Pass:** Returns health JSON.
**Fail:** Voice gateway Cloud Run service not deployed or not started.

### T12.2 — Voice Session

Use the dashboard voice button (if available) to start a voice session with an agent.

**Pass:** WebRTC connection established. Agent speaks. Voice matches the agent's assigned voice from `voiceMap.ts`.
**Fail:** OpenAI Realtime API key issue, or WebRTC ICE negotiation failing.

---

## Layer 13: Microsoft 365 Integration

### T13.1 — Azure Credentials Configured

Verifies `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET` are set.

**Pass:** All three Azure credential env vars present.
**Fail:** Missing credentials = no Graph API access. Set in GCP Secret Manager and `.env`.

### T13.2 — Teams Channel IDs Configured

Checks `TEAMS_TEAM_ID` and at least 2 of the 5 core channel IDs (general, engineering, decisions, financials, growth).

**Pass:** Team ID and 2+ channel IDs configured.
**Fail:** Missing channel IDs = agents can't post to Teams channels. Get IDs from Teams Admin → Manage Teams → Channel details.

### T13.3 — Teams Bot Endpoint

Sends a minimal Bot Framework activity to `/api/teams/messages`. Expects any response other than 404.

**Pass:** Endpoint reachable (200/202 = accepted, 401 = JWT validation working).
**Fail:** 404 = bot endpoint not deployed. Check scheduler server routes.

### T13.4 — Teams Activity in Logs

Checks `activity_log` for recent Teams-related entries (briefings, channel posts).

**Pass:** Teams activity entries found from multiple agents.
**Fail:** Agents not posting to Teams. Check Azure credentials and channel IDs. Verify `post_to_teams` tool is in agent tool grants.

### T13.5 — Email Activity in Logs

Checks `activity_log` for email-related entries (send_email, read_inbox).

**Pass:** Email activity entries found.
**Fail:** Email not configured. Check `AZURE_MAIL_CLIENT_ID`/`AZURE_MAIL_CLIENT_SECRET` for Graph API email, or `SENDGRID_API_KEY` for SendGrid.

### T13.6 — M365 Admin Agents

Verifies `m365-admin` and `global-admin` agents exist in `company_agents` with active tool grants.

**Pass:** Both admin agents exist and have tool grants.
**Fail:** Missing agents = M365 operations unavailable. Seed agent data in `company_agents`, `agent_briefs`, `agent_tool_grants`.

### T13.7 — SharePoint Knowledge Ingested

Checks `company_knowledge` for entries with `discovered_by = 'sharepoint-sync'`.

**Pass:** SharePoint documents ingested into knowledge base.
**Fail:** SharePoint sync hasn't run or failed. Check `SHAREPOINT_SITE_ID`, `AZURE_FILES_CLIENT_ID`. Run `POST /sync/sharepoint-knowledge`.

### T13.8 — SendGrid Configuration

Checks for SendGrid API keys (main key + scoped per-department keys).

**Pass:** At least 1 SendGrid key configured.
**Fail:** Email fallback unavailable. Set `SENDGRID_API_KEY` in env.

---

## Results Summary Template

After running all tests, fill in:

| Layer | Tests | Pass | Fail | Skip | Block | Notes |
|-------|-------|------|------|------|-------|-------|
| 0 — Infrastructure | 9 | | | | | Cloud SQL, Redis, Secrets, Pub/Sub, Worker, Cloud Tasks, Storage, Multi-tenancy |
| 1 — Data Syncs | 6 | | | | | Stripe, Mercury, GCP Billing, OpenAI/Anthropic Billing, SharePoint |
| 2 — Model Clients | 4 | | | | | Gemini, OpenAI, Anthropic |
| 3 — Heartbeat/Work Loop | 4 | | | | | |
| 4 — Orchestration | 8 | | | | | |
| 5 — Communication | 5 | | | | | DMs, Meetings, Teams, Email |
| 6 — Authority Gates | 4 | | | | | |
| 7 — Intelligence Enhancements | 7 | | | | | |
| 8 — Knowledge Graph | 4 | | | | | |
| 9 — Strategy Engines | 5 | | | | | 600s+ timeout — run separately |
| 10 — Specialist Agents | 3 | | | | | |
| 11 — Dashboard & API | 7 | | | | | 20 pages, security headers, API CRUD |
| 12 — Voice | 2 | | | | | |
| 13 — M365 Integration | 8 | | | | | Azure, Teams, Email, SharePoint, SendGrid |
| **TOTAL** | **76** | | | | | |

### Known Issues

1. **DB-dependent tests require credentials:** 28 tests across layers 0,1,3-8,10 require `DATABASE_URL` or `DB_PASSWORD` in `.env`. Without them, tests will fail with connection errors.
2. **Pending migration:** `db/migrations/20260302210000_activity_log_add_agent_id.sql` adds `agent_id` and `detail` columns to `activity_log`. Until applied, T9.1–T9.4 (Strategy Engines) will fail with schema errors.
3. **Stripe/Mercury sync:** T1.1 and T1.2 require `STRIPE_SECRET_KEY` and `MERCURY_API_TOKEN` configured on the scheduler Cloud Run service.
4. **Layer 9 timeouts:** Strategic analysis (T9.1) and deep dive (T9.4) can take 600+ seconds. Run layer 9 separately.
5. **Worker service:** T0.6 requires `WORKER_URL` in `.env`. Set to the Cloud Run worker service URL.
6. **Cloud Tasks / Storage:** T0.7 and T0.8 require `gcloud` CLI with project access.
7. **Azure credentials:** T13.1–T13.3 require `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and Teams channel IDs in `.env`.
8. **M365 admin agents:** T13.6 requires `m365-admin` and `global-admin` agents seeded in the database with active tool grants.
9. **SendGrid:** T13.8 requires at least one `SENDGRID_API_KEY*` in `.env`.
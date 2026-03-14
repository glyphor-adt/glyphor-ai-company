---
name: platform-monitoring
slug: platform-monitoring
category: engineering
description: Continuously observe the health, performance, and reliability of the Glyphor platform — Cloud Run services, Cloud SQL PostgreSQL database, Cloud Tasks queues, event bus, agent runtimes, and external API dependencies. Use during scheduled health checks, when investigating performance anomalies, before and after deployments, or when any metric feels "off." This skill turns raw infrastructure signals into actionable status reports.
holders: cto, platform-engineer, devops-engineer, ops
tools_granted: check_system_health, query_logs, query_uptime, query_cloud_run_metrics, query_db_health, query_db_usage, query_resource_utilization, query_cold_starts, query_cache_metrics, query_error_patterns, get_cloud_run_metrics, get_container_logs, get_deployment_status, get_data_freshness, get_event_bus_health, get_service_dependencies, get_infrastructure_inventory, get_platform_health, inspect_cloud_run_service, identify_unused_resources, emit_alert, save_memory, send_agent_message
version: 2
---

# Platform Monitoring

You are the observability layer for a production autonomous agent platform running on GCP Cloud Run with Cloud SQL PostgreSQL (86 tables, pgvector), Cloud Tasks work queues, and Pub/Sub event triggers. Your job is to see problems before they become incidents, understand what "healthy" looks like so you can recognize when things deviate, and produce health reports that anyone on the team can read and act on.

Monitoring is not dashboarding. Dashboards show data. Monitoring is the act of looking at that data with judgment — recognizing when a number that looks fine in isolation is actually a leading indicator of failure when compared to its trend, its peers, or its context.

## What You're Monitoring

### The Infrastructure Stack

**Cloud Run services** — the compute layer. Three production services: `glyphor-scheduler` (API + cron + event handling), `glyphor-worker` (Cloud Tasks processor for agent runs), and `glyphor-dashboard` (React SPA served via nginx). Key signals: request count, latency percentiles (p50, p95, p99), error rate, instance count, cold start frequency, CPU utilization, memory utilization. Cloud Run auto-scales, so instance count is both a health signal and a cost signal.

**Cloud SQL PostgreSQL** — the persistence layer. 86 tables accessed via `pg` connection pool. Key signals: connection pool utilization (this is the killer — exhaustion cascades to every agent simultaneously), query latency by table, table sizes, index hit rates, pgvector query performance on embedding tables (agent_memory, kg_nodes). A connection pool at 80% utilization is not "80% healthy" — it's 20% from total failure with no graceful degradation.

**Cloud Tasks queues** — the work dispatch layer. Three queues: `agent-runs` (standard), `agent-runs-priority` (priority), `delivery` (output delivery). Key signals: queue depth, task age (oldest unprocessed task), delivery success rate, retry count. If the worker service is slow or down, tasks pile up here. A growing queue means agents are waiting to execute.

**Pub/Sub** — the trigger layer. Cloud Scheduler pushes to topic `glyphor-agent-tasks` to trigger agent runs. Key signals: undelivered messages, delivery latency, dead-letter queue size. If Pub/Sub delivery fails, scheduled agent runs stop silently.

**Event bus** — the nervous system. Agents communicate through events. Key signals: queue depth (should be near zero in steady state), delivery failure rate, stuck/undeliverable events, consumer lag. Rate limited: 10 events per agent per hour.

**Data sync jobs** — 9 scheduled sync jobs (Stripe, GCP billing, Mercury, OpenAI billing, Anthropic billing, Kling billing, SharePoint knowledge, governance, GraphRAG). Key signals: last successful sync time, sync duration, error count. Stale sync data means agents are making decisions on outdated information.

**External APIs** — the dependency layer. The platform calls OpenAI, Anthropic, Google, and various MCP servers. You cannot fix these when they break, but you must detect their failures quickly and distinguish "our problem" from "their problem." Key signals: response latency, error rates, rate limit hits.

**Agent runtimes** — the application layer. 28 agents running on schedules or triggered by events. Key signals: run success rate, average run duration, tool call count per run, abort rate, max-turn hits. An agent that suddenly takes 3x longer to complete is burning 3x the tokens — that's both a performance problem and a cost problem.

### Baselines, Not Thresholds

Static thresholds are fragile. "Alert if latency > 500ms" will either fire constantly during batch processing windows or miss a real problem when latency doubles from 50ms to 100ms (still under threshold, but a 100% increase).

Think in baselines. What does this metric normally look like at this time of day, on this day of the week? A 10% deviation from baseline is noise. A 50% deviation is worth investigating. A 200% deviation is an active problem.

When you don't have a computed baseline, use these sensible defaults for the Glyphor platform:

- Cloud Run p95 latency: under 2s for API calls, under 30s for agent runs
- Cloud Run error rate: under 1%
- Database connection pool: under 60% utilization
- Database query latency p95: under 200ms
- Cloud Tasks queue depth: under 50 tasks (agent-runs + priority combined)
- Cloud Tasks oldest task age: under 5 minutes
- Pub/Sub undelivered messages: 0
- Event bus queue depth: under 100 messages
- Agent run success rate: above 90%
- Cold start frequency: under 10% of total requests
- Memory utilization: under 80% (higher risks OOM kills)
- Data sync freshness: all syncs completed within their schedule window

## How to Run a Health Check

### The Quick Scan (2 minutes)

Use this for routine checks or when you just need to know "is everything OK?"

1. `check_system_health` — get the bird's-eye view of all services.
2. Look for any RED status. If everything is GREEN, you're done.
3. If anything is YELLOW or RED, transition to the deep scan for that specific subsystem.

### The Deep Scan (10-15 minutes)

Use this for pre/post-deployment verification, weekly reviews, or when something looks suspicious.

**Compute layer:**
- `query_cloud_run_metrics` — request volume, latency, errors for each service
- `query_cold_starts` — cold start frequency and duration (cold starts > 5s are problematic)
- `query_resource_utilization` — CPU and memory per service. Watch for memory creep (leak)
- `inspect_cloud_run_service` on any service showing anomalies — check env vars, secrets, resource limits

**Data layer:**
- `query_db_health` — connection pool, replication, general health
- `query_db_usage` — table sizes, query volume, slow queries
- `get_data_freshness` — when were critical tables last written? Stale `company_agents` or `skills` tables mean the system is frozen

**Agent layer:**
- `query_error_patterns` — aggregate errors across all agents. Look for common error types
- `get_event_bus_health` — queue depth, delivery failures, consumer status
- `get_platform_health` — composite platform score

**External dependencies:**
- `query_logs` filtered for external API errors — OpenAI 429s, Anthropic timeouts, MCP connection failures
- `get_service_dependencies` — map of what depends on what (useful for blast radius assessment)

### The Deployment Check (before and after every deploy)

**Before deploy:**
1. Run the quick scan. Save the baseline numbers.
2. Note current instance count, error rate, and p95 latency.

**After deploy (wait 5 minutes for new instances to warm):**
1. Run the quick scan again. Compare to pre-deploy baseline.
2. Specifically check: error rate should not increase, latency should not increase significantly, no new error patterns in logs.
3. Watch for 10 minutes. Some problems don't appear until the first scheduled agent run hits the new code.

## Producing Health Reports

A health report is not a data dump. It is a narrative with a verdict.

**Structure:**
- **Overall status:** GREEN / YELLOW / RED with one sentence explaining why
- **Key metrics vs baseline:** only metrics that deviated meaningfully
- **Concerns:** anything that's trending in the wrong direction, even if not yet alarming
- **Recommendations:** specific actions if any are needed
- **Cost note:** if infrastructure spend is anomalous, flag it

**What makes a report useful:**
- It tells the reader what to worry about without making them parse raw numbers
- It distinguishes "this is fine" from "this needs watching" from "this needs action"
- It connects infrastructure signals to business impact ("DB latency is up 40% which is increasing agent run duration and token costs")

**What makes a report useless:**
- Listing every metric with "normal" next to it
- Using jargon without context ("p95 is 1.2s" means nothing to a non-engineer — "API responses are 3x slower than usual" does)
- Reporting a problem without recommending an action

## Patterns That Predict Incidents

These are the leading indicators. If you catch these early, you prevent incidents instead of responding to them.

- **Memory utilization climbing steadily over hours/days** — memory leak. Will eventually OOM.
- **Connection pool utilization ratcheting up with each load spike and not fully releasing** — connection leak. Will eventually exhaust.
- **Cold start frequency increasing** — either traffic pattern changed or instances are being killed more often (memory limits? scaling config?)
- **Agent run duration increasing while success rate stays constant** — the agents are working harder for the same result. Usually means an external API got slower or a database table grew without index optimization.
- **Event bus queue depth growing slowly but steadily** — a consumer is falling behind. Will eventually cause visible lag in agent coordination.

Save these patterns as memories when you observe them. The most valuable monitoring is the kind that notices "this happened last month and led to an incident, and I'm seeing the same pattern now."

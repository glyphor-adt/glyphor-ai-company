---
name: budget-monitoring
slug: budget-monitoring
category: finance
description: Monitor spend against budget in real time, detect anomalies early, and route cost-control decisions before overruns compound. Use when daily cost reviews are run, when spend spikes appear in infrastructure or AI model usage, when budget thresholds are crossed, or when founders need immediate clarity on cost risk and corrective actions. This skill is shared between Nadia (operational control) and Bob (tax deductibility and tax-position implications).
holders: cfo, bob-the-tax-pro
tools_granted: query_costs, get_cost_anomalies, get_vendor_costs, get_gcp_costs, get_ai_model_costs, get_infrastructure_costs, get_burn_rate, get_cash_flow, get_pending_transactions, create_budget, check_budget_status, query_agent_run_costs, query_financials, file_decision, save_memory, send_agent_message
version: 2
---

# Budget Monitoring

Budget monitoring is an active control system, not a month-end report. By the time a monthly review reveals a major overrun, the money is already gone. Your job is to surface risk early enough that the company can still choose.

At Glyphor, this matters more than in typical SaaS. AI model usage and agent-run volume can change rapidly, and a small routing regression can multiply spend in hours, not quarters. Budget monitoring is therefore a daily operating function.

## Shared Ownership Model

This skill is shared by two roles with different lenses:

- **Nadia (CFO):** operational spend control, forecasting, runway protection.
- **Bob (Tax Strategist):** tax treatment implications and deductibility framing for cost categories.

Nadia leads runtime cost control. Bob adds tax-optimized interpretation where relevant.

## Monitoring Loop

### 1. Pull current spend state

Use:
- `query_costs`
- `get_gcp_costs`
- `get_ai_model_costs`
- `get_infrastructure_costs`
- `get_vendor_costs`

Segment spend into:
- AI API costs
- Infrastructure costs
- SaaS/vendor costs
- Other operating spend

### 2. Compare to budget and trend

Use:
- `create_budget` / `check_budget_status`
- `get_burn_rate`
- `get_cash_flow`
- `query_agent_run_costs`

Always compare:
- actual vs budget
- current period vs prior period
- current run-rate vs projected month-end

### 3. Detect anomalies

Use `get_cost_anomalies` and verify with raw category queries.

Budget anomalies are most meaningful when paired with causal hypotheses:
- model mix shift
- run-frequency increase
- failed task retries
- infra scaling change
- vendor plan change

### 4. Escalate by threshold

**Pre-Revenue Context:** Glyphor is pre-revenue, bootstrapped, and in active development. The founders fund infrastructure out of pocket and have full cost visibility. Do NOT file decisions about overall burn rate, runway, or spending trajectories — this spending is planned and expected. Only escalate genuine anomalies: unexpected spikes caused by bugs, loops, or misconfigurations.

Use these default triggers for **unexpected variance only** (not planned dev spending):

- **< $10 variance:** log and monitor.
- **$10-$50:** investigate root cause; notify relevant owner.
- **$50-$100:** file Yellow decision with options.
- **> $100:** file Yellow decision and recommend immediate containment action.
- **> $500:** file Red decision; founders need same-day action.

Escalation is about decision velocity, not alarm volume. During pre-revenue, distinguish between "we're spending money to build" (expected, do not escalate) and "something is broken and burning cash" (unexpected, escalate).

### 5. Recommend corrective actions

Every alert should include action paths, not just variance numbers:

1. Remove clear waste.
2. Right-size model routing by task complexity.
3. Reduce unnecessary run frequency.
4. Optimize infrastructure sizing and schedule windows.
5. Renegotiate or cancel low-value vendor subscriptions.

## Bob's Tax Lens

When Bob uses this skill, include tax treatment context for major spend lines:

- likely ordinary business deduction
- possible capitalization/amortization treatment
- documentation needed for defensible tax position

If a spend-control recommendation changes tax posture materially, flag that explicitly in the recommendation note.

## Reporting Cadence

- **Daily AM check:** opening risk posture and overnight anomaly sweep.
- **Daily PM check:** intraday spike detection and containment status.
- **Weekly summary:** trend narrative and recommended budget adjustments.

Save notable anomalies and resolved root causes as memories so repeated patterns are handled faster over time.

## Operating Standard

Budget monitoring is complete only when variance is paired with a clear decision recommendation, owner, and expected dollar impact.
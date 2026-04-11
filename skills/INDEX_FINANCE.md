# Finance Team Skills — Implementation Index

## Agent → Skill Mapping

| Agent | Role | Reports To | Runner Type | Skills |
|-------|------|------------|-------------|--------|
| Nadia Okafor | CFO | Sarah Chen | Executive runner | `financial-reporting` (v2), `budget-monitoring` (v2), `revenue-analysis` (v2) |
| Robert "Bob" Finley | CPA & Tax Strategist | Victoria Chase (CLO) | Dynamic runner | `budget-monitoring` (v2, shared), `tax-strategy` (NEW) |

> **Note:** Bob Finley is a specialist agent using `runDynamicAgent.ts` (no file-based runner). He is defined in `CompanyAgentRole` and the database. Currently listed under Legal department — should be reassigned to Finance.

> **Note:** Bob shares `budget-monitoring` with Nadia. His focus is the tax deductibility angle of costs; Nadia's focus is operational cost control. The skill serves both.

## Architecture References

**Data sync pipelines feeding finance:**
| Source | Sync Time (CT) | Endpoint | Data |
|--------|----------------|----------|------|
| Stripe | 12:00 AM | `/sync/stripe` | MRR, churn, subscriptions, invoices |
| GCP BigQuery | 1:00 AM | `/sync/gcp-billing` | Cloud Run/SQL/Tasks/Storage costs by service |
| Mercury | 2:00 AM | `/sync/mercury` | Bank balance, cash flow, vendor subscriptions |

All sync to the `financials` table in Cloud SQL. LLM usage for GPT models is billed via **Azure AI Foundry** (see cost tools / Azure exports); Claude is on **Amazon Bedrock** (AWS Cost and Usage). Nadia's morning run depends on these completing successfully overnight.

**Tool files:**
- `revenueTools.ts` — 6 tools: MRR breakdown, Stripe subscriptions/invoices, churn, forecasts, LTV
- `costManagementTools.ts` — 8 tools: GCP/AI/vendor costs, anomaly detection, burn rate, budgets, unit economics
- `cashFlowTools.ts` — 5 tools: Mercury balance, cash flow, transactions, financial reports, margins
- `mcp-finance-server` (Cloud Run) — 7 tools: Stripe, Mercury, BigQuery billing

**Budget enforcement (runtime):**
Per-agent cost caps enforced in `toolExecutor.ts`:
- Per-run: $0.08 default
- Daily: $2.00
- Monthly: $60.00
- `budget_spike` anomaly: fires when run cost > 3× historical average

**Nadia's schedules:**
- `cfo-daily-costs`: 9:00 AM CT — morning cost analysis
- `cfo-afternoon-costs`: 3:00 PM CT — afternoon anomaly catch

**Entity:** Glyphor, Inc. — Delaware C-Corp, 60/40 equity (Kristina/Andrew). No W-2 employees. Texas nexus (Dallas).

## Size Comparison

| Skill | Old | New |
|-------|-----|-----|
| financial-reporting | 6 lines, 3 tools | ~155 lines, 33 tools |
| budget-monitoring | 6 lines, 3 tools | ~155 lines, 16 tools |
| revenue-analysis | 6 lines, 2 tools | ~155 lines, 22 tools |
| tax-strategy | (didn't exist) | ~145 lines, 16 tools |

## Key Design Decisions

**1. Financial reporting is structured, not freeform.** The skill defines a mandatory 6-section structure (Executive Summary → Revenue → Costs → Margins/Unit Economics → Cash/Runway → Recommendations) with specific metrics in each section. Every report follows the same format so founders always know where to look.

**2. Data freshness is an explicit check.** Before producing any report, Nadia must verify the `financials` table was updated in the last 24 hours. If a sync failed, she flags which data is stale rather than presenting old data as current.

**3. Budget monitoring has explicit escalation thresholds.** The skill defines dollar-amount triggers: <$10 = log, $10-50 = investigate, $50-100 = Yellow decision, >$100 = Yellow + pause agent, >$500 = Red decision. These match the existing `budget_spike` anomaly detector's logic but extend it with CFO-level judgment.

**4. Cost structure is AI-company-specific.** The skills explicitly address that AI API costs are 50-70% of total costs (unlike typical SaaS at 5-15% hosting), that model routing affects costs as much as run volume, and that a single model routing regression can triple daily spend. The optimization hierarchy (eliminate waste → right-size models → reduce frequency → optimize infrastructure → negotiate vendors) is prioritized by impact.

**5. Revenue analysis teaches the composition, not just the number.** MRR is decomposed into five flows (new + expansion - contraction - churn = ending). NRR targets are specified. Cohort analysis methodology is explained (month-2 drop-off, stabilization point, expansion signal, cohort quality changes). Revenue concentration risk thresholds are defined (25% = Yellow).

**6. Tax strategy addresses R&D credit specifically.** The skill walks through the four-part qualification test for IRC §41, identifies which Glyphor engineering work likely qualifies (agent runtime, self-improvement pipeline, MCP bridge) vs. doesn't (routine bug fixes, admin), and emphasizes contemporaneous documentation requirements. It also flags the Section 174 capitalization requirement for software development costs.

**7. Bob connects tax to engineering.** The tax-strategy skill explicitly identifies Marcus (CTO) as critical for R&D credit documentation and specifies what information to request from him. This cross-team coordination is what makes a tax specialist useful in an AI company — the intersection of engineering work and tax qualification.

## File Inventory

```
skills/finance/
├── financial-reporting.md  # v2 — Nadia (CFO)
├── budget-monitoring.md    # v2 — Nadia (CFO), Bob (shared)
├── revenue-analysis.md     # v2 — Nadia (CFO)
├── tax-strategy.md         # NEW — Bob Finley
└── INDEX.md                # This file
```

## Cross-Team Notes

- `financial-reporting` was previously also assigned to `chief-of-staff` (Sarah Chen). **Remove Sarah as a holder.** Sarah routes and synthesizes but does not produce financial reports — that is Nadia's job. Sarah reads Nadia's output; she doesn't create it.
- Bob Finley needs department reassignment from `Legal` to `Finance` in the `company_agents` table. His reporting line to Victoria Chase (CLO) for compliance purposes remains correct, but his operational department should be Finance.
- Budget monitoring data feeds incident response — when a cost anomaly is caused by an infrastructure issue, Nadia alerts Marcus (CTO) or Atlas (Ops) who use the `incident-response` skill to investigate and resolve.

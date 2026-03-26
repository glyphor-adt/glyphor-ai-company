---
name: revenue-analysis
slug: revenue-analysis
category: finance
description: Analyze revenue streams, cohort behavior, pricing impact, expansion dynamics, and churn patterns to produce actionable intelligence about Glyphor's commercial health. Use when investigating MRR/ARR trends, evaluating pricing model changes, analyzing customer cohort retention, understanding revenue concentration risk, modeling pricing scenarios, or producing revenue intelligence for fundraising preparation. This skill looks beyond the headline number to understand the composition, quality, and sustainability of Glyphor's revenue.
holders: cfo
tools_granted: query_financials, query_stripe_mrr, query_stripe_revenue, query_stripe_subscriptions, get_mrr_breakdown, get_revenue_forecast, get_unit_economics, calculate_unit_economics, calculate_ltv_cac, forecast_revenue, query_revenue_by_cohort, query_revenue_by_product, query_churn_revenue, get_churn_analysis, get_cohort_retention, get_subscription_details, get_stripe_invoices, query_customers, save_memory, send_agent_message, file_decision
version: 2
---

# Revenue Analysis

Revenue analysis is not accounting. Accounting tells you how much money came in. Revenue analysis tells you whether that money is durable, growing, and profitable — and warns you when it isn't.

At Glyphor's stage, the revenue number itself matters less than its trajectory and composition. An investor looking at $50K MRR cares about three things: is it growing (MoM rate), is it sticky (retention), and is the growth efficient (LTV:CAC)? Your analysis must answer all three, not just the first.

## Revenue Decomposition

### MRR components

MRR is not a single number — it's a composite of five flows. Pull via `get_mrr_breakdown`:

```
Starting MRR
  + New MRR         (first-time subscribers)
  + Expansion MRR   (existing customers upgrading or adding seats)
  - Contraction MRR (existing customers downgrading)
  - Churned MRR     (customers leaving entirely)
  = Ending MRR
```

**The composition tells the story.** $10K MRR growing from $8K because of $4K new + $1K expansion - $3K churn is a very different business than $10K growing from $9K because of $1.5K new + $0.5K expansion - $1K churn. The first is high-growth but leaky. The second is slower-growth but retentive. They require different strategic responses.

### Net Revenue Retention (NRR)

NRR = (Starting MRR + Expansion - Contraction - Churn) / Starting MRR × 100%

- **NRR > 120%**: Excellent. Existing customers are growing faster than churning. The business can grow with zero new customers. This is the SaaS holy grail.
- **NRR 100-120%**: Good. Existing customers are net-positive. Growth needs some new customer acquisition but isn't entirely dependent on it.
- **NRR < 100%**: Concerning. The customer base is shrinking. Every month, you start in a deeper hole that new customers must fill. Below 80% is a crisis.

Track NRR monthly and flag any month below 100% as a Yellow-tier finding.

### Revenue by product

`query_revenue_by_product` — which products drive revenue?

- **Pulse** (AI creative production): revenue, customer count, average deal size
- **Web Build** (AI development): revenue, customer count, average deal size
- **Any other revenue streams** (consulting, custom work, etc.)

Product mix matters for strategic planning. If 80% of revenue comes from one product, that's concentration risk. If the smaller product is growing faster, that may be the future and deserves more investment.

## Cohort Analysis

Cohort analysis is the most powerful tool for understanding revenue quality. Pull via `query_revenue_by_cohort` and `get_cohort_retention`.

### What cohort analysis reveals

A **cohort** is a group of customers who started in the same time period (usually month). Tracking each cohort's revenue over time reveals whether your product is getting stickier or leakier.

**Reading a cohort table:**
- The diagonal tells you what's happening right now
- Each row tells you the lifetime behavior of one cohort
- Improving retention in newer cohorts = product is getting better
- Declining retention in newer cohorts = something broke (product, positioning, or customer quality)

**What to look for:**
- **Month 2 drop-off** — how many customers survive the first renewal? If 30%+ churn in month 2, the onboarding or first-value experience is broken.
- **Cohort stabilization** — at what month does retention flatten? Good products see retention stabilize by month 4-6. If churn is still linear at month 12, the product has a value-delivery problem.
- **Cohort expansion** — do older cohorts grow in revenue over time (expansion > contraction)? This is the NRR signal at the cohort level.
- **Cohort quality changes** — are January customers better or worse than June customers? Changes in cohort quality often correlate with changes in marketing channel (different acquisition channels produce different customer quality).

### Churn analysis

`get_churn_analysis` and `query_churn_revenue` for detailed churn patterns:

- **Logo churn** (customers lost / total customers) vs. **revenue churn** (revenue lost / total revenue). They can diverge significantly — losing 10 small customers is different from losing 1 large customer.
- **Voluntary vs. involuntary churn.** Voluntary = customer decided to leave. Involuntary = payment failed. Involuntary churn is often recoverable with dunning automation.
- **Churn reasons** if captured — feature gaps, pricing, competitor switch, business closure, low usage.
- **Pre-churn signals** — declining usage in the months before cancellation. If you can identify these patterns, you can intervene before the churn happens (alert the CS function if it exists, or flag for founder outreach).

## Pricing Intelligence

### Current pricing analysis

Use `get_subscription_details` and `query_stripe_subscriptions` to understand:
- Distribution of customers across pricing tiers
- Average Revenue Per User (ARPU) by tier
- Discount usage and its revenue impact
- Free trial conversion rates (if applicable)

### Pricing scenario modeling

When the founders or CPO consider pricing changes, model the impact:

**Price increase scenario:**
- Assume X% of customers accept the increase, Y% downgrade, Z% churn
- Model net revenue impact over 3, 6, 12 months
- Use historical churn sensitivity as a baseline (if a similar change was made before)

**New tier scenario:**
- Estimate adoption by current tier distribution
- Model cannibalization (existing customers moving down) vs. expansion (existing customers moving up)
- Project net impact on ARPU and total MRR

**Competitor pricing context:**
- Reference competitive pricing data from Lena Park / Zara Petrov (Research / Marketing Intel)
- Position Glyphor's pricing against the competitive landscape
- Identify pricing gaps and opportunities

Always present pricing scenarios with confidence levels and assumptions stated explicitly. "If we raise Pulse pricing by 20%, MRR increases by $X assuming 10% churn — but churn could be 5-25% depending on competitor response and customer price sensitivity."

## Unit Economics

`calculate_unit_economics` and `calculate_ltv_cac` for the metrics investors obsess over:

**CAC (Customer Acquisition Cost):**
- Total sales + marketing spend / new customers acquired
- Break down by channel if possible — which acquisition channels are most efficient?
- Blended CAC vs. channel-specific CAC (blended hides expensive channels behind cheap ones)

**LTV (Lifetime Value):**
- Average monthly revenue per customer × average customer lifetime (in months)
- Or: ARPU / monthly churn rate (for steady-state estimation)
- Segment by tier/product — LTV varies dramatically by customer segment

**LTV:CAC ratio:**
- Target: 3:1 or higher for SaaS
- Below 3:1: acquiring customers costs too much relative to their value — either reduce CAC or increase LTV
- Below 1:1: losing money on every customer. File a Red decision.

**Payback period:**
- CAC / monthly gross profit per customer = months to break even
- Under 12 months: healthy
- 12-18 months: acceptable for enterprise
- Over 18 months: cash-intensive, needs funding or efficiency improvement

## Forecasting

`forecast_revenue` and `get_revenue_forecast` for forward-looking projections.

**Always forecast three scenarios:**
1. **Conservative** — assume growth rate decelerates, churn increases slightly
2. **Base** — assume current trends continue
3. **Optimistic** — assume growth rate maintains or accelerates, churn improves

**Ground forecasts in data, not hope.** A forecast that shows 50% MoM growth for the next 12 months when historical growth is 8% MoM is fiction, not a forecast. Divergence from historical trends must be justified by a specific catalyst (new product launch, pricing change, marketing spend increase).

**Revenue forecasts feed runway calculations** (see financial-reporting skill). When the forecast changes, runway changes. Alert founders when forecast revisions materially affect runway projections.

## Revenue Concentration Risk

Regularly check whether revenue is dangerously concentrated:

- **Customer concentration:** Does any single customer represent >10% of MRR? >25%? Losing that customer would cause a material revenue shock.
- **Product concentration:** Does >80% of revenue come from one product? That product has an outsized impact on company health.
- **Channel concentration:** Does >80% of new revenue come from one acquisition channel? That channel going dark would halt growth.

Flag concentration risks at the 25% threshold as Yellow decisions. Recommend diversification strategies when concentration is identified.

## Reporting and Memory

Save revenue analysis findings as memories with consistent tagging: metric, date, value, trend direction, confidence, and any anomalies. After 6 months of memories, you should have a revenue model of the business that lets you explain any number the founders ask about, predict next month's MRR within reasonable bounds, and identify the levers that actually move revenue.

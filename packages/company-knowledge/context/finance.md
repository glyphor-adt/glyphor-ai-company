# Finance Department

## Team
CFO: Nadia Okafor. Finance is a solo executive function right now.

## Key Metrics
Use tools for live data. Baseline references:
- MRR: $0 (pre-revenue)
- Monthly compute budget: $150
- Default model reference: gpt-5-mini class for routine work

## Data Sources
- Stripe for subscriptions and MRR
- Mercury for cash and vendor flows
- BigQuery and provider billing exports for compute and model spend
- Provider invoices for OpenAI, Anthropic, and media tooling

## Cost Monitoring
Per-agent budget caps are enforced. Nadia runs daily cost analysis and an afternoon anomaly pass.

## When You Have No Assigned Work
- Check whether any billing sync is stale for more than 24 hours
- Compare current compute trajectory against the $150 monthly budget
- Flag any agent whose daily cap is above 80 percent utilized
- Investigate any unexplained change in provider spend or billing sync quality

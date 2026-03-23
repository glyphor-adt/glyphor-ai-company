# Finance Department

## Team
CFO: Nadia Okafor. Finance is a solo executive function right now.

## GCP identity (not a Google Workspace user)
Nadia has no inbox. In Google Cloud she is represented by the dedicated service account **`sa-nadia@<project>.iam.gserviceaccount.com`** (Terraform: `google_service_account.cfo_agent`; governance mapping: `packages/integrations/src/governance/iamSync.ts`). Billing read and BigQuery access on the billing export dataset are granted to that SA. Runtime jobs that need those APIs should run as this SA (or impersonate it), not as a human user.

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

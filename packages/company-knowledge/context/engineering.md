# Engineering Department

## Team
CTO: Marcus Reeves. Engineering: Alex Park (Platform), Sam DeLuca (Quality), Jordan Hayes (DevOps), Riley Morgan (M365 Admin).

## Current Priorities
- Platform health stabilization is the top priority
- Fix the CTO death loop and remove blocked assignments older than the acceptable threshold
- Verify history compression is active before every model call
- Keep CI/CD, tool initialization, and orchestration reliability healthy enough for daily agent execution

## Core Stack
- GCP Cloud Run, Cloud SQL PostgreSQL, Cloud Tasks, Cloud Scheduler, Redis, Secret Manager, Artifact Registry
- TypeScript and Node.js across runtime services
- GitHub Actions to Docker to Artifact Registry to Cloud Run
- Microsoft 365 and Teams integration for internal communication

## Infrastructure Already Configured
All secrets and integrations below are **already provisioned** in GCP Secret Manager and mounted as environment variables on every Cloud Run service. Do NOT create assignments to "add" or "configure" these — they are live and working.

**AI & API keys:** GOOGLE_AI_API_KEY, OPENAI_API_KEY, AZURE_FOUNDRY_ENDPOINT, AZURE_FOUNDRY_API
**Database:** DB_HOST, DB_NAME, DB_USER, DB_PASSWORD (Cloud SQL PostgreSQL)
**GitHub:** GITHUB_TOKEN (PAT with repo access), GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_INSTALLATION_ID, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
**Microsoft 365 / Teams:** AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, TEAMS_TEAM_ID, all TEAMS_CHANNEL_* IDs, TEAMS_USER_* IDs, AGENT365_* credentials
**Payments & Banking:** STRIPE_SECRET_KEY, MERCURY_API_TOKEN
**Creative tools:** PULSE_SERVICE_ROLE_KEY, PULSE_MCP_ENDPOINT
**Infrastructure:** GCP_PROJECT_ID, GCS_BUCKET
**Design:** FIGMA_ACCESS_TOKEN, CANVA credentials, VERCEL_TOKEN

If a tool returns a "not configured" error for any of the above, the issue is a code bug — not a missing secret. Escalate to Marcus, don't self-block.

## Tools
- `mcp-engineering-server` for GitHub, CI/CD, deploy, and runtime diagnostics
- `mcp-teams-server` and `mcp-email-server` for operational communication triage
- Runtime logs, metrics, and agent health data across scheduler, worker, and agent runtime
- Deployment pipelines, migrations, and environment configuration
- Tool registry and MCP initialization paths

## When You Have No Assigned Work
- Marcus: Review platform health, failure patterns, and runtime drift
- Alex: Check dependency and architecture risks that could block platform health work
- Sam: Expand regression coverage around recent runtime changes
- Jordan: Verify deployment integrity and stale assignment cleanup paths
- Riley: Audit Teams, mailbox, and M365 operational issues affecting agents

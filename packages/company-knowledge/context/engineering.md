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

## Tools
- Runtime logs, metrics, and agent health data
- Tool registry and MCP initialization paths
- Deployment pipelines, migrations, and environment configuration

## When You Have No Assigned Work
- Marcus: Review platform health, failure patterns, and runtime drift
- Alex: Check dependency and architecture risks that could block platform health work
- Sam: Expand regression coverage around recent runtime changes
- Jordan: Verify deployment integrity and stale assignment cleanup paths
- Riley: Audit Teams, mailbox, and M365 operational issues affecting agents

# Runbook

> Last updated: 2025-02-22

## Prerequisites

- Node.js 22+
- npm (npm workspaces — **not** pnpm)
- Docker Desktop
- GCP CLI (`gcloud`) authenticated to project `ai-glyphor-company`
- Supabase project (`https://ztucrgzcoaryzuvkcaif.supabase.co`)
- Microsoft Teams incoming webhook URLs (or Entra ID app credentials for Graph API)
- Terraform 1.5+ (for infra changes only)

---

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment

```bash
cp .env.example .env
# Fill in all values — see "Environment Variables" section below
```

### 3. Run Supabase migrations

Apply schema via Supabase Dashboard SQL Editor or CLI:

```bash
# Via Supabase CLI (if installed)
supabase db push

# Or paste contents of supabase/migrations/*.sql
# into Supabase Dashboard > SQL Editor, in order:
#   20260222025612_new-migration.sql
#   20260222025852_remote_schema.sql
#   20260222030000_create_tables.sql
```

### 4. Seed company memory

```bash
chmod +x infra/scripts/seed-memory.sh
./infra/scripts/seed-memory.sh
```

### 5. Build all packages

```bash
npm run build
# This runs Turborepo which builds all packages in dependency order
```

### 6. Run agents locally

```bash
# Chief of Staff — Kristina briefing
node packages/agents/dist/chief-of-staff/run.js

# Chief of Staff — Andrew briefing
FOUNDER=andrew node packages/agents/dist/chief-of-staff/run.js

# CTO health check
node packages/agents/dist/cto/run.js

# Other agents follow same pattern:
#   node packages/agents/dist/{role}/run.js
```

### 7. Run dashboard locally

```bash
npm run dashboard:dev
# Opens at http://localhost:5173
```

---

## Docker Build & Deploy

### Scheduler

```bash
# Build
docker build --no-cache \
  -f docker/Dockerfile.scheduler \
  -t us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/scheduler:latest .

# Push
docker push us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/scheduler:latest

# Deploy
gcloud run deploy glyphor-scheduler \
  --image=us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/scheduler:latest \
  --project=ai-glyphor-company \
  --region=us-central1 \
  --allow-unauthenticated
```

> **Important**: Always use `--no-cache` when the model name, knowledge base, or
> agent prompts have changed. Docker layer caching can serve stale values.

### Dashboard

```bash
# Build (requires VITE_* build args)
docker build --no-cache \
  -f docker/Dockerfile.dashboard \
  --build-arg VITE_SUPABASE_URL=https://ztucrgzcoaryzuvkcaif.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=<your-anon-key> \
  --build-arg VITE_SCHEDULER_URL=https://glyphor-scheduler-610179349713.us-central1.run.app \
  --build-arg VITE_GOOGLE_CLIENT_ID=610179349713-hsb5cloabe445k72uk4nv79d8jcaag67.apps.googleusercontent.com \
  -t us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/dashboard:latest .

# Push
docker push us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/dashboard:latest

# Deploy
gcloud run deploy glyphor-dashboard \
  --image=us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/dashboard:latest \
  --project=ai-glyphor-company \
  --region=us-central1 \
  --allow-unauthenticated
```

---

## GCP Cloud Scheduler Jobs

All 9 jobs push to Pub/Sub topic `glyphor-agent-events`. To recreate:

```bash
# Generate all gcloud scheduler commands from code
node -e "
  const { generateCloudSchedulerCommands } = require('./packages/scheduler/dist/cronManager.js');
  console.log(generateCloudSchedulerCommands('ai-glyphor-company','glyphor-agent-events').join('\n\n'));
"
```

Or create manually:

```bash
gcloud scheduler jobs create pubsub cos-briefing-kristina \
  --schedule="0 12 * * *" \
  --topic="glyphor-agent-events" \
  --message-body='{"agentRole":"chief-of-staff","task":"morning_briefing","payload":{"founder":"kristina"}}' \
  --time-zone="America/Chicago" \
  --location="us-central1" \
  --project="ai-glyphor-company"

# Repeat for all 9 jobs — see cronManager.ts for full list
```

---

## GCP Secret Manager

All secrets are injected as environment variables at Cloud Run deploy time.

### Required Secrets

```bash
# Core
echo -n "..." | gcloud secrets versions add google-ai-api-key --data-file=-
echo -n "https://ztucrgzcoaryzuvkcaif.supabase.co" | gcloud secrets versions add supabase-url --data-file=-
echo -n "..." | gcloud secrets versions add supabase-service-key --data-file=-
echo -n "glyphor-company" | gcloud secrets versions add gcs-bucket --data-file=-

# Teams — Graph API (primary)
echo -n "19ab7456-..." | gcloud secrets versions add azure-tenant-id --data-file=-
echo -n "06c728b6-..." | gcloud secrets versions add azure-client-id --data-file=-
echo -n "..." | gcloud secrets versions add azure-client-secret --data-file=-
echo -n "..." | gcloud secrets versions add teams-team-id --data-file=-

# Teams — Channel IDs (one per channel)
echo -n "..." | gcloud secrets versions add teams-channel-briefing-kristina-id --data-file=-
echo -n "..." | gcloud secrets versions add teams-channel-briefing-andrew-id --data-file=-
echo -n "..." | gcloud secrets versions add teams-channel-decisions-id --data-file=-
echo -n "..." | gcloud secrets versions add teams-channel-engineering-id --data-file=-
echo -n "..." | gcloud secrets versions add teams-channel-growth-id --data-file=-
echo -n "..." | gcloud secrets versions add teams-channel-financials-id --data-file=-
echo -n "..." | gcloud secrets versions add teams-channel-general-id --data-file=-
echo -n "..." | gcloud secrets versions add teams-channel-product-fuse-id --data-file=-
echo -n "..." | gcloud secrets versions add teams-channel-product-pulse-id --data-file=-

# Teams — Webhook fallbacks
echo -n "https://..." | gcloud secrets versions add teams-webhook-kristina --data-file=-
echo -n "https://..." | gcloud secrets versions add teams-webhook-andrew --data-file=-
```

---

## Company Knowledge Base

The `packages/company-knowledge/` directory contains markdown files that are injected
into every Gemini API call as the system prompt prefix.

### Updating Knowledge

1. Edit `packages/company-knowledge/COMPANY_KNOWLEDGE_BASE.md` (shared context)
2. Edit `packages/company-knowledge/briefs/{codename}.md` (role-specific brief)
3. Rebuild and redeploy **scheduler** (the files are read at runtime from disk):

```bash
docker build --no-cache -f docker/Dockerfile.scheduler ...
# (full command in Docker Build section above)
```

> The Dockerfile copies `packages/company-knowledge/` into the runtime image.
> Changes require a new image push + deploy.

---

## Monitoring

### Cloud Run Logs

```bash
# Scheduler logs (agent executions)
gcloud run services logs read glyphor-scheduler \
  --region=us-central1 --project=ai-glyphor-company --limit=100

# Dashboard logs
gcloud run services logs read glyphor-dashboard \
  --region=us-central1 --project=ai-glyphor-company --limit=50

# Filter by agent
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="glyphor-scheduler" AND textPayload=~"chief-of-staff"' \
  --project=ai-glyphor-company --limit=20
```

### Cloud Run Revisions

```bash
# List active revisions
gcloud run revisions list --service=glyphor-scheduler \
  --region=us-central1 --project=ai-glyphor-company

gcloud run revisions list --service=glyphor-dashboard \
  --region=us-central1 --project=ai-glyphor-company
```

### Supabase Queries

```sql
-- Recent agent activity
SELECT agent_role, action, summary, created_at
FROM activity_log
ORDER BY created_at DESC
LIMIT 20;

-- Pending decisions
SELECT id, tier, status, title, proposed_by, assigned_to, created_at
FROM decisions
WHERE status = 'pending'
ORDER BY created_at DESC;

-- Agent last run times
SELECT role, name, status, model, last_run
FROM company_agents
ORDER BY last_run DESC;

-- Financial metrics (last 7 days)
SELECT date, product, metric, value
FROM financials
WHERE date > now() - interval '7 days'
ORDER BY date DESC;
```

---

## Environment Variables

### Scheduler Service

| Variable | Source | Description |
|----------|--------|-------------|
| `GOOGLE_AI_API_KEY` | Secret Manager | Gemini API key |
| `SUPABASE_URL` | Secret Manager | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Secret Manager | Supabase service role key |
| `GCS_BUCKET` | Secret Manager | GCS bucket name |
| `GCP_PROJECT_ID` | Hardcoded | `ai-glyphor-company` |
| `AZURE_TENANT_ID` | Secret Manager | Entra ID tenant |
| `AZURE_CLIENT_ID` | Secret Manager | Entra ID app client ID |
| `AZURE_CLIENT_SECRET` | Secret Manager | Entra ID app secret |
| `TEAMS_TEAM_ID` | Secret Manager | Teams team ID |
| `TEAMS_CHANNEL_*_ID` | Secret Manager | 9 channel IDs |
| `TEAMS_WEBHOOK_KRISTINA` | Secret Manager | Webhook fallback URL |
| `TEAMS_WEBHOOK_ANDREW` | Secret Manager | Webhook fallback URL |
| `PORT` | Cloud Run | Auto-set to 8080 |

### Dashboard (Build Args)

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `VITE_SCHEDULER_URL` | Scheduler Cloud Run URL |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID for Sign-In |

---

## Troubleshooting

| Issue | Check |
|-------|-------|
| Agent not running | Cloud Scheduler job history → Pub/Sub delivery → Cloud Run logs |
| Briefing not sent | Verify Teams `AZURE_CLIENT_SECRET` is set (not placeholder), check Graph API permissions |
| Chat returning empty | Check scheduler `/run` endpoint logs, verify `on_demand` is in GREEN_ACTIONS |
| Stale model or prompts | Rebuild with `--no-cache`, push, and deploy |
| Decision stuck | Check `decisions` table for `pending` items. Run `sendReminders()` manually |
| Dashboard auth fails | Verify `VITE_GOOGLE_CLIENT_ID` matches OAuth consent screen. Check if consent screen is still Internal |
| High Gemini costs | Review agent frequency in `cronManager.ts`. CTO runs every 30 min — most frequent |
| Build failure | Run `npm run build` locally, check TypeScript errors |
| Docker build uses wrong code | Always `--no-cache`; clear builder cache with `docker builder prune` |
| Teams cards not posting | Check `AZURE_CLIENT_SECRET` (currently a 2-char placeholder — needs real secret) |
| Reasoning tags in chat | Dashboard `Chat.tsx` has `stripReasoning()` — verify it runs before render |
| Lighthouse audits return 429 | Google PageSpeed IPs being rate-limited by Vercel WAF. See [Lighthouse IP Whitelist Guide](LIGHTHOUSE_IP_WHITELIST.md) |

### Lighthouse Rate Limiting (HTTP 429)

**Symptom**: VP Design (Mia) or Design Critic (Sofia) agents report 429 errors when running `run_lighthouse` or `run_lighthouse_batch` tools on `pulse.glyphor.ai` or `fuse.glyphor.ai`.

**Root Cause**: Vercel WAF/rate-limiting is blocking Google PageSpeed Insights API requests.

**Quick Fix**:
1. Access Vercel dashboard for affected project
2. Navigate to Settings → Firewall → Trusted IPs
3. Add Google IP ranges from `/infra/config/google-ips.sample.json`
4. Test with: `run_lighthouse(url: "https://pulse.glyphor.ai")`
5. Verify no 429 errors in agent activity logs

**Permanent Solution**:
1. Read full guide: [docs/LIGHTHOUSE_IP_WHITELIST.md](LIGHTHOUSE_IP_WHITELIST.md)
2. Run automation script: `./infra/scripts/update-google-ips.sh json > infra/config/google-ips.json`
3. Apply IP ranges to Vercel Trusted IPs or WAF exceptions
4. Set up weekly automation via GitHub Actions: `.github/workflows/update-google-ips.yml`
5. Monitor agent logs for recurring 429 errors

**Verification Query** (Supabase):
```sql
SELECT 
  agent_role,
  tool_name,
  created_at,
  result
FROM activity_log
WHERE tool_name IN ('run_lighthouse', 'run_lighthouse_batch')
  AND result LIKE '%429%'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

**Escalation**: If whitelisting doesn't resolve the issue, escalate to Marcus (CTO) for alternative solutions (dedicated Lighthouse server, Lighthouse CI service, etc.).

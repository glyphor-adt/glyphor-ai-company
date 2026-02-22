# Runbook

## Prerequisites

- Node.js 22+
- pnpm 9+
- GCP project with billing enabled
- Supabase project
- Microsoft Teams incoming webhook URLs
- Terraform 1.5+

## Local Development

### 1. Install dependencies

```bash
pnpm install
```

### 2. Set up environment

```bash
cp .env.example .env
# Fill in all values in .env
```

### 3. Run Supabase migration

Apply the schema to your Supabase project via the SQL editor or CLI:

```bash
# Via Supabase CLI
supabase db push --db-url "$SUPABASE_URL"

# Or paste contents of packages/company-memory/src/migrations/001_initial_schema.sql
# into Supabase Dashboard > SQL Editor
```

### 4. Seed company memory

```bash
chmod +x infra/scripts/seed-memory.sh
./infra/scripts/seed-memory.sh
```

### 5. Build all packages

```bash
pnpm build
```

### 6. Run Chief of Staff briefing locally

```bash
# Generate Kristina's morning briefing
node packages/agents/dist/chief-of-staff/run.js

# Or with specific founder
FOUNDER=andrew node packages/agents/dist/chief-of-staff/run.js
```

## Deployment

### 1. Configure Terraform

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your GCP project ID
```

### 2. Initialize and apply Terraform

```bash
terraform init -backend-config="bucket=your-tfstate-bucket"
terraform plan
terraform apply
```

### 3. Set secrets in GCP Secret Manager

```bash
echo -n "your-api-key" | gcloud secrets versions add google-ai-api-key --data-file=-
echo -n "https://your-project.supabase.co" | gcloud secrets versions add supabase-url --data-file=-
echo -n "your-service-key" | gcloud secrets versions add supabase-service-key --data-file=-
echo -n "your-bucket-name" | gcloud secrets versions add gcs-bucket --data-file=-
echo -n "https://webhook-url" | gcloud secrets versions add teams-webhook-kristina --data-file=-
echo -n "https://webhook-url" | gcloud secrets versions add teams-webhook-andrew --data-file=-
```

### 4. Build and deploy containers

```bash
chmod +x infra/scripts/deploy.sh
./infra/scripts/deploy.sh
```

## Monitoring

### Check agent activity

Query the `activity_log` table in Supabase:

```sql
SELECT agent_role, action, summary, created_at
FROM activity_log
ORDER BY created_at DESC
LIMIT 20;
```

### Check pending decisions

```sql
SELECT id, tier, status, title, proposed_by, assigned_to, created_at
FROM decisions
WHERE status = 'pending'
ORDER BY created_at DESC;
```

### View Cloud Run logs

```bash
gcloud run services logs read glyphor-chief-of-staff --region=us-central1 --limit=50
gcloud run services logs read glyphor-scheduler --region=us-central1 --limit=50
```

## Troubleshooting

| Issue | Check |
|-------|-------|
| Briefing not sent | Cloud Scheduler job history, Cloud Run logs, Teams webhook URL |
| Agent timeout | Increase Cloud Run timeout, check supervisor maxTurns |
| Decision stuck | Check `decisions` table for pending items, verify webhook URLs |
| High costs | Review Gemini API usage, check agent frequency |
| Build failure | `pnpm build` locally, check TypeScript errors |

# Vercel Secret Setup Guide

> **For: Morgan Blake (Global Admin)**  
> **Priority: P0**  
> **Issue: [P0] Telemetry Blackout & Phantom Pipeline**

## Overview

This document provides step-by-step instructions for configuring the missing Vercel secrets that are blocking deployment monitoring and causing the telemetry blackout.

## Background

The Glyphor platform uses Vercel for hosting the Fuse product and end-user projects. The CTO (Marcus Reeves), Platform Engineer (Alex Chen), DevOps Engineer (Jordan Hayes), and Cost Analyst (Omar Patel) agents all require access to Vercel deployment health metrics and logs.

Three secrets are required:

1. **VERCEL_TOKEN** - Vercel API authentication token
2. **VERCEL_TEAM_FUSE** - Vercel team ID for the Fuse product deployment
3. **VERCEL_TEAM_FUSE_PROJECTS** - Vercel team ID for end-user projects deployed through Fuse

## Prerequisites

- Access to GCP Secret Manager in project `ai-glyphor-company`
- Access to Vercel account with team admin permissions
- `gcloud` CLI authenticated to project `ai-glyphor-company`

## Step 1: Obtain Vercel API Token

1. Log in to Vercel at https://vercel.com
2. Navigate to **Settings** → **Tokens**
3. Click **Create Token**
4. Set the following:
   - **Token Name**: `glyphor-ai-company-monitoring`
   - **Scope**: Select both teams (Fuse product and Fuse projects)
   - **Expiration**: Never (or maximum allowed)
5. Click **Create** and copy the token (it will only be shown once)

## Step 2: Obtain Vercel Team IDs

1. Navigate to **Settings** → **General** for each team
2. The **Team ID** is displayed under the team name
3. Record both team IDs:
   - Fuse product team ID
   - Fuse projects team ID

## Step 3: Add Secrets to GCP Secret Manager

Run the following commands in your terminal (replace `<value>` with actual values):

```bash
# Set your GCP project
gcloud config set project ai-glyphor-company

# Add Vercel API token
echo -n "<your-vercel-api-token>" | gcloud secrets versions add vercel-token --data-file=-

# Add Fuse team ID
echo -n "<fuse-team-id>" | gcloud secrets versions add vercel-team-fuse --data-file=-

# Add Fuse projects team ID
echo -n "<fuse-projects-team-id>" | gcloud secrets versions add vercel-team-fuse-projects --data-file=-
```

## Step 4: Verify Secrets

Verify that the secrets were created successfully:

```bash
gcloud secrets describe vercel-token
gcloud secrets describe vercel-team-fuse
gcloud secrets describe vercel-team-fuse-projects
```

## Step 5: Trigger Deployment

The secrets are now available in Secret Manager, but the Cloud Run services need to be redeployed to pick them up.

### Option A: Via GitHub Actions (Recommended)

1. Merge this PR to the `main` branch
2. The GitHub Actions workflow will automatically:
   - Build the scheduler and chief-of-staff images
   - Deploy them to Cloud Run with the new secrets

### Option B: Manual Deployment via Terraform

If Terraform is already configured:

```bash
cd infra/terraform

# Initialize Terraform (if not already done)
terraform init -backend-config="bucket=<tfstate-bucket>"

# Plan the changes (should show secret additions)
terraform plan

# Apply the changes
terraform apply
```

### Option C: Manual Deployment via gcloud

Use the deployment script:

```bash
cd infra/scripts
export GCP_PROJECT_ID=ai-glyphor-company
export GCP_REGION=us-central1
export SUPABASE_URL=https://ztucrgzcoaryzuvkcaif.supabase.co
export SUPABASE_ANON_KEY=<supabase-anon-key>
export PROJECT_NUMBER=<gcp-project-number>
export GOOGLE_CLIENT_ID=<google-client-id>

chmod +x deploy.sh
./deploy.sh
```

## Step 6: Verify Deployment

After deployment, verify that the services are running with the new secrets:

```bash
# Check scheduler service
gcloud run services describe glyphor-scheduler \
  --region=us-central1 \
  --project=ai-glyphor-company \
  --format="value(status.url)"

# Check scheduler logs for Vercel-related activity
gcloud run services logs read glyphor-scheduler \
  --region=us-central1 \
  --project=ai-glyphor-company \
  --limit=50 | grep -i vercel

# Check Cloud Run instance count (should be > 0)
gcloud run services describe glyphor-scheduler \
  --region=us-central1 \
  --project=ai-glyphor-company \
  --format="value(status.traffic[0].percent)"
```

## Troubleshooting

### Secret not accessible by service account

If the service account cannot access the secrets, grant the necessary permissions:

```bash
# Get service account email
SA_EMAIL=$(gcloud iam service-accounts list \
  --filter="displayName:Glyphor Agent Runner" \
  --format="value(email)")

# Grant secret accessor role for each secret
for secret in vercel-token vercel-team-fuse vercel-team-fuse-projects; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/secretmanager.secretAccessor"
done
```

### Deployment still failing

Check the Cloud Run logs for specific error messages:

```bash
gcloud run services logs read glyphor-scheduler \
  --region=us-central1 \
  --project=ai-glyphor-company \
  --limit=100
```

Look for error messages related to:
- `VERCEL_TOKEN not configured`
- `VERCEL_TEAM_FUSE not configured`
- API authentication failures

## Success Criteria

Once the secrets are configured and deployed successfully, you should observe:

1. **Cloud Run Instances Active**: `gcloud run services describe glyphor-scheduler` shows active instances
2. **No Vercel-related Errors**: Logs show successful Vercel API calls
3. **CTO Health Checks Passing**: Marcus Reeves can query Fuse deployment health
4. **Telemetry Restored**: Platform monitoring shows live deployment data

## Post-Deployment

After successful deployment:

1. **Notify Stakeholders**: Inform the team that telemetry is restored
2. **Monitor Costs**: The $116.96/day "Zombie Burn" should stop
3. **Verify Pulse Launch**: Confirm that Pulse launch blockers are resolved

## Support

If you encounter issues:

1. Check the runbook: `docs/RUNBOOK.md`
2. Review Terraform configuration: `infra/terraform/main.tf`
3. Check deployment script: `infra/scripts/deploy.sh`
4. Contact the DevOps team for assistance

---

**Document Version**: 1.0  
**Last Updated**: 2026-02-28  
**Owner**: Morgan Blake (Global Admin)

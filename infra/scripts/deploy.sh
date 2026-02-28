#!/usr/bin/env bash
# deploy.sh — Build and deploy all Glyphor services to GCP Cloud Run
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
REPO="glyphor"
AR_REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"

echo "=== Building and deploying Glyphor AI Company ==="
echo "Project: ${PROJECT_ID}"
echo "Region:  ${REGION}"

# Ensure Artifact Registry repo exists
gcloud artifacts repositories describe "$REPO" \
  --location="$REGION" --project="$PROJECT_ID" 2>/dev/null || \
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --project="$PROJECT_ID"

# Build & push scheduler
echo "--- Building scheduler ---"
docker build -f docker/Dockerfile.scheduler -t "${AR_REGISTRY}/scheduler:latest" .
docker push "${AR_REGISTRY}/scheduler:latest"

# Build & push chief-of-staff agent
echo "--- Building chief-of-staff ---"
docker build -f docker/Dockerfile.chief-of-staff -t "${AR_REGISTRY}/chief-of-staff:latest" .
docker push "${AR_REGISTRY}/chief-of-staff:latest"

# Build & push dashboard
echo "--- Building dashboard ---"
docker build -f docker/Dockerfile.dashboard \
  --build-arg VITE_SUPABASE_URL="${SUPABASE_URL}" \
  --build-arg VITE_SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY}" \
  --build-arg VITE_SCHEDULER_URL="https://glyphor-scheduler-${PROJECT_NUMBER}.${REGION}.run.app" \
  --build-arg VITE_GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}" \
  -t "${AR_REGISTRY}/dashboard:latest" .
docker push "${AR_REGISTRY}/dashboard:latest"

# Deploy scheduler to Cloud Run
echo "--- Deploying scheduler ---"
gcloud run deploy glyphor-scheduler \
  --image="${AR_REGISTRY}/scheduler:latest" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --platform=managed \
  --allow-unauthenticated \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=3 \
  --set-env-vars="NODE_ENV=production" \
  --set-secrets="GOOGLE_AI_API_KEY=google-ai-api-key:latest,OPENAI_API_KEY=openai-api-key:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,SUPABASE_URL=supabase-url:latest,SUPABASE_SERVICE_KEY=supabase-service-key:latest,GCS_BUCKET=gcs-bucket:latest,AZURE_TENANT_ID=azure-tenant-id:latest,AZURE_CLIENT_ID=azure-client-id:latest,AZURE_CLIENT_SECRET=azure-client-secret:latest,TEAMS_TEAM_ID=teams-team-id:latest,TEAMS_CHANNEL_BRIEFING_KRISTINA_ID=teams-channel-briefing-kristina-id:latest,TEAMS_CHANNEL_BRIEFING_ANDREW_ID=teams-channel-briefing-andrew-id:latest,TEAMS_CHANNEL_DECISIONS_ID=teams-channel-decisions-id:latest,TEAMS_CHANNEL_GENERAL_ID=teams-channel-general-id:latest,TEAMS_CHANNEL_ENGINEERING_ID=teams-channel-engineering-id:latest,TEAMS_CHANNEL_GROWTH_ID=teams-channel-growth-id:latest,TEAMS_CHANNEL_FINANCIALS_ID=teams-channel-financials-id:latest,TEAMS_CHANNEL_PRODUCT_FUSE_ID=teams-channel-product-fuse-id:latest,TEAMS_CHANNEL_PRODUCT_PULSE_ID=teams-channel-product-pulse-id:latest,STRIPE_SECRET_KEY=stripe-secret-key:latest,MERCURY_API_TOKEN=mercury-api-token:latest,AZURE_MAIL_CLIENT_ID=azure-mail-client-id:latest,AZURE_MAIL_CLIENT_SECRET=azure-mail-client-secret:latest,GLYPHOR_MAIL_SENDER_ID=glyphor-mail-sender-id:latest,GITHUB_TOKEN=github-token:latest,GCP_PROJECT_ID=gcp-project-id:latest,VERCEL_TOKEN=vercel-token:latest,VERCEL_TEAM_FUSE=vercel-team-fuse:latest,VERCEL_TEAM_FUSE_PROJECTS=vercel-team-fuse-projects:latest"

# Deploy chief-of-staff agent
echo "--- Deploying chief-of-staff ---"
gcloud run deploy glyphor-chief-of-staff \
  --image="${AR_REGISTRY}/chief-of-staff:latest" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --platform=managed \
  --no-allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=2 \
  --timeout=300 \
  --set-env-vars="NODE_ENV=production" \
  --set-secrets="GOOGLE_AI_API_KEY=google-ai-api-key:latest,OPENAI_API_KEY=openai-api-key:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,SUPABASE_URL=supabase-url:latest,SUPABASE_SERVICE_KEY=supabase-service-key:latest,GCS_BUCKET=gcs-bucket:latest,AZURE_TENANT_ID=azure-tenant-id:latest,AZURE_CLIENT_ID=azure-client-id:latest,AZURE_CLIENT_SECRET=azure-client-secret:latest,TEAMS_TEAM_ID=teams-team-id:latest,TEAMS_CHANNEL_BRIEFING_KRISTINA_ID=teams-channel-briefing-kristina-id:latest,TEAMS_CHANNEL_BRIEFING_ANDREW_ID=teams-channel-briefing-andrew-id:latest,TEAMS_CHANNEL_DECISIONS_ID=teams-channel-decisions-id:latest,TEAMS_CHANNEL_GENERAL_ID=teams-channel-general-id:latest,TEAMS_CHANNEL_ENGINEERING_ID=teams-channel-engineering-id:latest,TEAMS_CHANNEL_GROWTH_ID=teams-channel-growth-id:latest,TEAMS_CHANNEL_FINANCIALS_ID=teams-channel-financials-id:latest,TEAMS_CHANNEL_PRODUCT_FUSE_ID=teams-channel-product-fuse-id:latest,TEAMS_CHANNEL_PRODUCT_PULSE_ID=teams-channel-product-pulse-id:latest,STRIPE_SECRET_KEY=stripe-secret-key:latest,MERCURY_API_TOKEN=mercury-api-token:latest,AZURE_MAIL_CLIENT_ID=azure-mail-client-id:latest,AZURE_MAIL_CLIENT_SECRET=azure-mail-client-secret:latest,GLYPHOR_MAIL_SENDER_ID=glyphor-mail-sender-id:latest,GITHUB_TOKEN=github-token:latest,GCP_PROJECT_ID=gcp-project-id:latest,VERCEL_TOKEN=vercel-token:latest,VERCEL_TEAM_FUSE=vercel-team-fuse:latest,VERCEL_TEAM_FUSE_PROJECTS=vercel-team-fuse-projects:latest"

# Deploy dashboard (publicly accessible — app handles Google Sign-In auth)
echo "--- Deploying dashboard ---"
gcloud run deploy glyphor-dashboard \
  --image="${AR_REGISTRY}/dashboard:latest" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --platform=managed \
  --allow-unauthenticated \
  --memory=256Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --port=8080

DASHBOARD_URL=$(gcloud run services describe glyphor-dashboard --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)')
echo "=== Dashboard live at: ${DASHBOARD_URL} ==="

echo "=== Deployment complete ==="

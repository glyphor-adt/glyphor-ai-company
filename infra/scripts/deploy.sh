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

# Deploy scheduler to Cloud Run
echo "--- Deploying scheduler ---"
gcloud run deploy glyphor-scheduler \
  --image="${AR_REGISTRY}/scheduler:latest" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --platform=managed \
  --no-allow-unauthenticated \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --set-env-vars="NODE_ENV=production" \
  --set-secrets="GOOGLE_AI_API_KEY=google-ai-api-key:latest,OPENAI_API_KEY=openai-api-key:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,SUPABASE_URL=supabase-url:latest,SUPABASE_SERVICE_KEY=supabase-service-key:latest,GCS_BUCKET=gcs-bucket:latest,TEAMS_WEBHOOK_KRISTINA=teams-webhook-kristina:latest,TEAMS_WEBHOOK_ANDREW=teams-webhook-andrew:latest"

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
  --min-instances=0 \
  --max-instances=2 \
  --timeout=300 \
  --set-env-vars="NODE_ENV=production" \
  --set-secrets="GOOGLE_AI_API_KEY=google-ai-api-key:latest,OPENAI_API_KEY=openai-api-key:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,SUPABASE_URL=supabase-url:latest,SUPABASE_SERVICE_KEY=supabase-service-key:latest,GCS_BUCKET=gcs-bucket:latest,TEAMS_WEBHOOK_KRISTINA=teams-webhook-kristina:latest,TEAMS_WEBHOOK_ANDREW=teams-webhook-andrew:latest"

echo "=== Deployment complete ==="

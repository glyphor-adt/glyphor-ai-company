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
DOCKER_BUILDKIT=1 docker build --progress=plain -f docker/Dockerfile.scheduler -t "${AR_REGISTRY}/scheduler:latest" .
docker push "${AR_REGISTRY}/scheduler:latest"

# Build & push chief-of-staff agent
echo "--- Building chief-of-staff ---"
DOCKER_BUILDKIT=1 docker build --progress=plain -f docker/Dockerfile.chief-of-staff -t "${AR_REGISTRY}/chief-of-staff:latest" .
docker push "${AR_REGISTRY}/chief-of-staff:latest"

# Build & push dashboard
echo "--- Building dashboard ---"
DOCKER_BUILDKIT=1 docker build --progress=plain -f docker/Dockerfile.dashboard \
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
  --set-env-vars="NODE_ENV=production,AGENT365_ENABLED=true" \
  --set-secrets="GOOGLE_AI_API_KEY=google-ai-api-key:latest,OPENAI_API_KEY=openai-api-key:latest,AZURE_FOUNDRY_ENDPOINT=azure-foundry-endpoint:latest,AZURE_FOUNDRY_API=azure-foundry-api:latest,DB_HOST=db-host:latest,DB_NAME=db-name:latest,DB_USER=db-user:latest,DB_PASSWORD=db-password:latest,GCS_BUCKET=gcs-bucket:latest,AZURE_TENANT_ID=azure-tenant-id:latest,AZURE_CLIENT_ID=azure-client-id:latest,AZURE_CLIENT_SECRET=azure-client-secret:latest,TEAMS_TEAM_ID=teams-team-id:latest,TEAMS_CHANNEL_BRIEFINGS_ID=teams-channel-briefings-id:latest,TEAMS_CHANNEL_DECISIONS_ID=teams-channel-decisions-id:latest,TEAMS_CHANNEL_GENERAL_ID=teams-channel-general-id:latest,TEAMS_CHANNEL_ENGINEERING_ID=teams-channel-engineering-id:latest,TEAMS_CHANNEL_GROWTH_ID=teams-channel-growth-id:latest,TEAMS_CHANNEL_FINANCIALS_ID=teams-channel-financials-id:latest,TEAMS_CHANNEL_ALERTS_ID=teams-channel-alerts-id:latest,TEAMS_CHANNEL_DELIVERABLES_ID=teams-channel-deliverables-id:latest,TEAMS_USER_ANDREW_ID=teams-user-andrew-id:latest,TEAMS_USER_KRISTINA_ID=teams-user-kristina-id:latest,STRIPE_SECRET_KEY=stripe-secret-key:latest,MERCURY_API_TOKEN=mercury-api-token:latest,GITHUB_TOKEN=github-token:latest,GCP_PROJECT_ID=gcp-project-id:latest,PULSE_SERVICE_ROLE_KEY=pulse-service-role-key:latest,PULSE_MCP_ENDPOINT=pulse-mcp-endpoint:latest,AGENT365_CLIENT_ID=agent365-client-id:latest,AGENT365_CLIENT_SECRET=agent365-client-secret:latest,AGENT365_TENANT_ID=agent365-tenant-id:latest,AGENT365_BLUEPRINT_ID=agent365-blueprint-id:latest,FACEBOOK_APP_ID=facebook-app-id:latest,FACEBOOK_APP_SECRET=facebook-app-secret:latest,FACEBOOK_LONG_LIVED_PAGE_ACCESS_TOKEN=facebook-page-access-token:latest,FACEBOOK_PAGE_ID=facebook-page-id:latest,FACEBOOK_BUSINESS_ACCOUNT_ID=facebook-business-account-id:latest,LINKEDIN_CLIENT_ID=linkedin-client-id:latest,LINKEDIN_CLIENT_SECRET=linkedin-client-secret:latest,LINKEDIN_REFRESH_TOKEN=linkedin-refresh-token:latest,LINKEDIN_ORGANIZATION_ID=linkedin-organization-id:latest,GRAPH_DELEGATED_REFRESH_TOKEN=graph-delegated-refresh-token:latest"

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
  --set-env-vars="NODE_ENV=production,AGENT365_ENABLED=true" \
  --set-secrets="GOOGLE_AI_API_KEY=google-ai-api-key:latest,OPENAI_API_KEY=openai-api-key:latest,AZURE_FOUNDRY_ENDPOINT=azure-foundry-endpoint:latest,AZURE_FOUNDRY_API=azure-foundry-api:latest,DB_HOST=db-host:latest,DB_NAME=db-name:latest,DB_USER=db-user:latest,DB_PASSWORD=db-password:latest,GCS_BUCKET=gcs-bucket:latest,AZURE_TENANT_ID=azure-tenant-id:latest,AZURE_CLIENT_ID=azure-client-id:latest,AZURE_CLIENT_SECRET=azure-client-secret:latest,TEAMS_TEAM_ID=teams-team-id:latest,TEAMS_CHANNEL_BRIEFINGS_ID=teams-channel-briefings-id:latest,TEAMS_CHANNEL_DECISIONS_ID=teams-channel-decisions-id:latest,TEAMS_CHANNEL_GENERAL_ID=teams-channel-general-id:latest,TEAMS_CHANNEL_ENGINEERING_ID=teams-channel-engineering-id:latest,TEAMS_CHANNEL_GROWTH_ID=teams-channel-growth-id:latest,TEAMS_CHANNEL_FINANCIALS_ID=teams-channel-financials-id:latest,TEAMS_CHANNEL_ALERTS_ID=teams-channel-alerts-id:latest,TEAMS_CHANNEL_DELIVERABLES_ID=teams-channel-deliverables-id:latest,TEAMS_USER_ANDREW_ID=teams-user-andrew-id:latest,TEAMS_USER_KRISTINA_ID=teams-user-kristina-id:latest,STRIPE_SECRET_KEY=stripe-secret-key:latest,MERCURY_API_TOKEN=mercury-api-token:latest,GITHUB_TOKEN=github-token:latest,GCP_PROJECT_ID=gcp-project-id:latest,PULSE_SERVICE_ROLE_KEY=pulse-service-role-key:latest,PULSE_MCP_ENDPOINT=pulse-mcp-endpoint:latest,AGENT365_CLIENT_ID=agent365-client-id:latest,AGENT365_CLIENT_SECRET=agent365-client-secret:latest,AGENT365_TENANT_ID=agent365-tenant-id:latest,AGENT365_BLUEPRINT_ID=agent365-blueprint-id:latest,FACEBOOK_APP_ID=facebook-app-id:latest,FACEBOOK_APP_SECRET=facebook-app-secret:latest,FACEBOOK_LONG_LIVED_PAGE_ACCESS_TOKEN=facebook-page-access-token:latest,FACEBOOK_PAGE_ID=facebook-page-id:latest,FACEBOOK_BUSINESS_ACCOUNT_ID=facebook-business-account-id:latest,LINKEDIN_CLIENT_ID=linkedin-client-id:latest,LINKEDIN_CLIENT_SECRET=linkedin-client-secret:latest,LINKEDIN_REFRESH_TOKEN=linkedin-refresh-token:latest,LINKEDIN_ORGANIZATION_ID=linkedin-organization-id:latest,GRAPH_DELEGATED_REFRESH_TOKEN=graph-delegated-refresh-token:latest"

# Deploy dashboard (publicly accessible — app handles Google Sign-In auth)
echo "--- Deploying dashboard ---"
gcloud run deploy glyphor-dashboard \
  --image="${AR_REGISTRY}/dashboard:latest" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --platform=managed \
  --allow-unauthenticated \
  --memory=4Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --port=8080

DASHBOARD_URL=$(gcloud run services describe glyphor-dashboard --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)')
echo "=== Dashboard live at: ${DASHBOARD_URL} ==="

echo "=== Deployment complete ==="

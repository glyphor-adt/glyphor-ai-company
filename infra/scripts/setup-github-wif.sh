#!/usr/bin/env bash
# setup-github-wif.sh — Set up Workload Identity Federation for GitHub Actions
# Run this ONCE to allow GitHub Actions to authenticate with GCP without a service account key.
set -euo pipefail

PROJECT_ID="ai-glyphor-company"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
GITHUB_REPO="glyphor-adt/glyphor-ai-company"
SA_EMAIL="glyphor-agent-runner@${PROJECT_ID}.iam.gserviceaccount.com"
POOL_NAME="github-actions-pool"
PROVIDER_NAME="github-actions-provider"

echo "=== Setting up Workload Identity Federation ==="
echo "Project: ${PROJECT_ID} (${PROJECT_NUMBER})"
echo "GitHub:  ${GITHUB_REPO}"
echo "SA:      ${SA_EMAIL}"

# 1. Enable required APIs
echo "--- Enabling APIs ---"
gcloud services enable iamcredentials.googleapis.com --project="$PROJECT_ID"
gcloud services enable sts.googleapis.com --project="$PROJECT_ID"

# 2. Create Workload Identity Pool
echo "--- Creating Workload Identity Pool ---"
gcloud iam workload-identity-pools create "$POOL_NAME" \
  --project="$PROJECT_ID" \
  --location="global" \
  --display-name="GitHub Actions Pool" \
  --description="Pool for GitHub Actions CI/CD" \
  2>/dev/null || echo "Pool already exists"

# 3. Create OIDC Provider for GitHub
echo "--- Creating OIDC Provider ---"
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_NAME" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="$POOL_NAME" \
  --display-name="GitHub Actions Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '${GITHUB_REPO}'" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  2>/dev/null || echo "Provider already exists"

# 4. Grant the service account impersonation rights
echo "--- Granting SA impersonation ---"
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/attribute.repository/${GITHUB_REPO}"

# 5. Grant the service account permissions needed for CI/CD
echo "--- Granting CI/CD permissions to SA ---"
for ROLE in "roles/run.admin" "roles/artifactregistry.writer" "roles/iam.serviceAccountUser"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --role="$ROLE" \
    --member="serviceAccount:${SA_EMAIL}" \
    --condition=None \
    2>/dev/null || true
done

# 6. Print values to set as GitHub Secrets
WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/providers/${PROVIDER_NAME}"
echo ""
echo "======================================================"
echo "  Add these as GitHub Repository Secrets:"
echo "======================================================"
echo ""
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER:"
echo "    ${WIF_PROVIDER}"
echo ""
echo "  GCP_SERVICE_ACCOUNT:"
echo "    ${SA_EMAIL}"
echo ""
echo "  VITE_SCHEDULER_URL:"
echo "    (the Cloud Run URL for glyphor-scheduler)"
echo ""
echo "  VITE_GOOGLE_CLIENT_ID:"
echo "    (your Google OAuth client ID)"
echo ""
echo "======================================================"
echo "  Done! GitHub Actions can now deploy to Cloud Run."
echo "======================================================"

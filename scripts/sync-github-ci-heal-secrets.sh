#!/usr/bin/env bash
# Push CI self-heal webhook URL + bearer token into GitHub Actions secrets for one or more repos.
# Reads from GCP (same source as Cloud Run): scheduler URL + Secret Manager ci-heal-webhook-secret.
#
# Usage:
#   ./scripts/sync-github-ci-heal-secrets.sh                    # default repos below
#   ./scripts/sync-github-ci-heal-secrets.sh owner/repo [owner/repo2 ...]
#
# Requires: gcloud (project ai-glyphor-company), gh auth with admin on targets.

set -euo pipefail

PROJECT="${GCP_PROJECT_ID:-ai-glyphor-company}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${GLYPHOR_SCHEDULER_SERVICE:-glyphor-scheduler}"
SECRET_NAME="${CI_HEAL_SECRET_NAME:-ci-heal-webhook-secret}"

DEFAULT_REPOS=(
  glyphor-adt/glyphor-ai-company
  glyphor-adt/glyphor-site
)

repos=( "$@" )
if [[ ${#repos[@]} -eq 0 ]]; then
  repos=( "${DEFAULT_REPOS[@]}" )
fi

BASE_URL="$(gcloud run services describe "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" --format='value(status.url)')"
HEAL_URL="${BASE_URL%/}/webhook/ci-heal"

TOKEN="$(gcloud secrets versions access latest --secret="${SECRET_NAME}" --project="${PROJECT}")"

for r in "${repos[@]}"; do
  printf '%s' "${HEAL_URL}" | gh secret set GLYPHOR_CI_HEAL_URL -R "${r}"
  printf '%s' "${TOKEN}" | gh secret set GLYPHOR_CI_HEAL_SECRET -R "${r}"
  echo "Set GLYPHOR_CI_HEAL_* on ${r}"
done

echo "CI heal webhook: ${HEAL_URL}"

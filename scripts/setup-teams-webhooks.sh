#!/usr/bin/env bash
# Wire Teams webhook URLs to GCP Secret Manager and Cloud Run.
#
# Usage:
#   ./scripts/setup-teams-webhooks.sh <channel> <webhook-url>
#
# Examples:
#   ./scripts/setup-teams-webhooks.sh decisions "https://prod-XX.westus.logic.azure.com:443/..."
#   ./scripts/setup-teams-webhooks.sh kristina-briefing "https://..."
#
# This creates a secret like "teams-webhook-decisions" in Secret Manager,
# then updates both glyphor-worker and glyphor-scheduler Cloud Run services
# with the corresponding env var (e.g., TEAMS_WEBHOOK_DECISIONS).

set -euo pipefail

CHANNEL="${1:?Usage: $0 <channel> <webhook-url>}"
URL="${2:?Usage: $0 <channel> <webhook-url>}"
REGION="${REGION:-us-central1}"
PROJECT="${GCP_PROJECT_ID:-ai-glyphor-company}"

# Channel → env var name mapping
declare -A ENV_MAP=(
  [decisions]="TEAMS_WEBHOOK_DECISIONS"
  [general]="TEAMS_WEBHOOK_GENERAL"
  [engineering]="TEAMS_WEBHOOK_ENGINEERING"
  [kristina-briefing]="TEAMS_WEBHOOK_KRISTINA_BRIEFING"
  [andrew-briefing]="TEAMS_WEBHOOK_ANDREW_BRIEFING"
  [growth]="TEAMS_WEBHOOK_GROWTH"
  [financials]="TEAMS_WEBHOOK_FINANCIALS"
  [alerts]="TEAMS_WEBHOOK_ALERTS"
  [product-fuse]="TEAMS_WEBHOOK_PRODUCT_FUSE"
  [product-pulse]="TEAMS_WEBHOOK_PRODUCT_PULSE"
  [deliverables]="TEAMS_WEBHOOK_DELIVERABLES"
)

ENV_VAR="${ENV_MAP[$CHANNEL]:-}"
if [ -z "$ENV_VAR" ]; then
  echo "Unknown channel: $CHANNEL"
  echo "Valid channels: ${!ENV_MAP[*]}"
  exit 1
fi

# Derive secret name from channel (e.g., "decisions" → "teams-webhook-decisions")
SECRET_NAME="teams-webhook-${CHANNEL}"

echo "=== Setting up Teams webhook: $CHANNEL ==="
echo "  Secret: $SECRET_NAME"
echo "  Env var: $ENV_VAR"
echo "  URL: ${URL:0:60}..."
echo ""

# 1. Create or update the secret
if gcloud secrets describe "$SECRET_NAME" --project="$PROJECT" &>/dev/null; then
  echo "Secret '$SECRET_NAME' exists — adding new version..."
  echo -n "$URL" | gcloud secrets versions add "$SECRET_NAME" --project="$PROJECT" --data-file=-
else
  echo "Creating secret '$SECRET_NAME'..."
  echo -n "$URL" | gcloud secrets create "$SECRET_NAME" --project="$PROJECT" --data-file=-
fi

# 2. Wire to Cloud Run services
for SERVICE in glyphor-worker glyphor-scheduler; do
  echo "Updating $SERVICE with $ENV_VAR..."
  gcloud run services update "$SERVICE" \
    --region="$REGION" \
    --project="$PROJECT" \
    --update-secrets="${ENV_VAR}=${SECRET_NAME}:latest" \
    --quiet
done

echo ""
echo "Done! $ENV_VAR is now available to both worker and scheduler."
echo "Channel posting to #${CHANNEL} will use this webhook on next request."

#!/usr/bin/env bash
# open-dashboard.sh — Open the Glyphor Command Center via authenticated Cloud Run proxy
# Usage: ./infra/scripts/open-dashboard.sh
#
# Prerequisites:
#   gcloud auth login   (authenticate with kristina@glyphor.ai or andrew@glyphor.ai)
#
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
PORT="${DASHBOARD_PORT:-3000}"

echo "🚀 Opening Glyphor Command Center..."
echo "   Project: ${PROJECT_ID}"
echo "   Port:    http://localhost:${PORT}"
echo ""
echo "   Press Ctrl+C to stop"
echo ""

# This proxies the authenticated Cloud Run service to localhost
gcloud run services proxy glyphor-dashboard \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --port="$PORT"

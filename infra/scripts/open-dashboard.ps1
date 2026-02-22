# open-dashboard.ps1 — Open the Glyphor Command Center via authenticated Cloud Run proxy
# Usage: .\infra\scripts\open-dashboard.ps1
#
# Prerequisites:
#   gcloud auth login   (authenticate with kristina@glyphor.ai or andrew@glyphor.ai)
#

$ErrorActionPreference = "Stop"

$ProjectId = if ($env:GCP_PROJECT_ID) { $env:GCP_PROJECT_ID } else { throw "Set GCP_PROJECT_ID environment variable" }
$Region = if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }
$Port = if ($env:DASHBOARD_PORT) { $env:DASHBOARD_PORT } else { "3000" }

Write-Host ""
Write-Host "  Opening Glyphor Command Center..." -ForegroundColor Cyan
Write-Host "  Project: $ProjectId"
Write-Host "  Port:    http://localhost:$Port"
Write-Host ""
Write-Host "  Press Ctrl+C to stop" -ForegroundColor DarkGray
Write-Host ""

# Proxy the authenticated Cloud Run service to localhost
gcloud run services proxy glyphor-dashboard `
  --project="$ProjectId" `
  --region="$Region" `
  --port="$Port"

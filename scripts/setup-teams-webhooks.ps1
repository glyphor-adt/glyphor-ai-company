<#
.SYNOPSIS
  Wire a Teams webhook URL to GCP Secret Manager and Cloud Run.

.EXAMPLE
  .\scripts\setup-teams-webhooks.ps1 -Channel decisions -WebhookUrl "https://prod-XX.westus.logic.azure.com:443/..."
  .\scripts\setup-teams-webhooks.ps1 -Channel kristina-briefing -WebhookUrl "https://..."
#>
param(
  [Parameter(Mandatory)][string]$Channel,
  [Parameter(Mandatory)][string]$WebhookUrl,
  [string]$Region = 'us-central1',
  [string]$Project = 'ai-glyphor-company'
)

$envMap = @{
  'decisions'          = 'TEAMS_WEBHOOK_DECISIONS'
  'general'            = 'TEAMS_WEBHOOK_GENERAL'
  'engineering'        = 'TEAMS_WEBHOOK_ENGINEERING'
  'briefings'          = 'TEAMS_WEBHOOK_BRIEFINGS'
  'growth'             = 'TEAMS_WEBHOOK_GROWTH'
  'financials'         = 'TEAMS_WEBHOOK_FINANCIALS'
  'alerts'             = 'TEAMS_WEBHOOK_ALERTS'
  'deliverables'       = 'TEAMS_WEBHOOK_DELIVERABLES'
}

$envVar = $envMap[$Channel]
if (-not $envVar) {
  Write-Error "Unknown channel: $Channel. Valid: $($envMap.Keys -join ', ')"
  return
}

$secretName = "teams-webhook-$Channel"

Write-Host "=== Setting up Teams webhook: $Channel ===" -ForegroundColor Cyan
Write-Host "  Secret:  $secretName"
Write-Host "  Env var: $envVar"
Write-Host "  URL:     $($WebhookUrl.Substring(0, [Math]::Min(60, $WebhookUrl.Length)))..."
Write-Host ""

# 1. Create or update the secret
$exists = gcloud secrets describe $secretName --project=$Project 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Secret '$secretName' exists - adding new version..."
  $WebhookUrl | gcloud secrets versions add $secretName --project=$Project --data-file=-
} else {
  Write-Host "Creating secret '$secretName'..."
  $WebhookUrl | gcloud secrets create $secretName --project=$Project --data-file=-
}

# 2. Wire to Cloud Run services
foreach ($service in @('glyphor-worker', 'glyphor-scheduler')) {
  Write-Host "Updating $service with $envVar..."
  gcloud run services update $service `
    --region=$Region `
    --project=$Project `
    --update-secrets="${envVar}=${secretName}:latest" `
    --quiet 2>&1 | Out-Null

  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Failed to update $service"
  }
}

Write-Host ""
Write-Host "Done! $envVar is now available to both worker and scheduler." -ForegroundColor Green
Write-Host "Channel posting to #$Channel will use this webhook on next request."

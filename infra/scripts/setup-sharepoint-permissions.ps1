<#
.SYNOPSIS
  Add required Graph API permissions for SharePoint knowledge site.

.DESCRIPTION
  Adds Sites.ReadWrite.All, Files.ReadWrite.All, and Sites.Search.All
  permissions to the glyphor-files app registration (or fallback to the
  main app). Then grants admin consent.

  Prerequisites:
    - Azure CLI installed and logged in (`az login`)
    - Global Admin or Application Administrator role

.EXAMPLE
  .\infra\scripts\setup-sharepoint-permissions.ps1
#>

param(
  [string]$AppName = "glyphor-files",
  [string]$FallbackAppId = $env:AZURE_CLIENT_ID
)

$ErrorActionPreference = "Stop"

Write-Host "=== SharePoint Permissions Setup ===" -ForegroundColor Cyan
Write-Host ""

# Find the app registration
$app = az ad app list --display-name $AppName --query "[0]" -o json 2>$null | ConvertFrom-Json
if (-not $app) {
  if ($FallbackAppId) {
    Write-Host "App '$AppName' not found. Using fallback: $FallbackAppId" -ForegroundColor Yellow
    $app = az ad app show --id $FallbackAppId -o json | ConvertFrom-Json
  } else {
    Write-Error "No app registration found. Set AZURE_CLIENT_ID or create 'glyphor-files' app."
  }
}

$appId = $app.appId
$appObjectId = $app.id
Write-Host "App: $($app.displayName) ($appId)" -ForegroundColor Green

# Microsoft Graph service principal ID (well-known)
$graphSpId = "00000003-0000-0000-c000-000000000000"

# Permission IDs (from Microsoft Graph API)
$permissions = @{
  "Sites.ReadWrite.All" = "9492366f-7969-46a4-8d15-ed1a20078f40"
  "Files.ReadWrite.All" = "75359482-378d-4052-8f01-80520e7db3cd"
}

Write-Host ""
Write-Host "Adding permissions..." -ForegroundColor Cyan

foreach ($perm in $permissions.GetEnumerator()) {
  Write-Host "  Adding $($perm.Key)..." -NoNewline
  try {
    az ad app permission add `
      --id $appObjectId `
      --api $graphSpId `
      --api-permissions "$($perm.Value)=Role" `
      --only-show-errors 2>$null
    Write-Host " OK" -ForegroundColor Green
  } catch {
    Write-Host " (may already exist)" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Granting admin consent..." -ForegroundColor Cyan
try {
  az ad app permission admin-consent --id $appObjectId --only-show-errors
  Write-Host "  Admin consent granted." -ForegroundColor Green
} catch {
  Write-Host "  Admin consent may require manual approval in Azure Portal." -ForegroundColor Yellow
  Write-Host "  Go to: Azure Portal > App registrations > $($app.displayName) > API permissions > Grant admin consent" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Cyan
Write-Host "1. Run the provisioning script:"
Write-Host "   node scripts/provision-sharepoint.mjs" -ForegroundColor White
Write-Host ""
Write-Host "2. Add the output env vars to Cloud Run:"
Write-Host "   SHAREPOINT_SITE_ID=<from output>"
Write-Host "   SHAREPOINT_DRIVE_ID=<from output>"
Write-Host "   SHAREPOINT_ROOT_FOLDER=Company-Agent-Knowledge"
Write-Host ""
Write-Host "3. Run the Supabase migration:"
Write-Host "   npx supabase db push"
Write-Host ""
Write-Host "Done!" -ForegroundColor Green

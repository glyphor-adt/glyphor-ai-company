#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Acquire an Agent 365 MCP refresh token via device code auth and store it in GCP Secret Manager.

.DESCRIPTION
    Agent 365 MCP servers require delegated (user) tokens — client credentials are blocked for
    agentic apps (AADSTS82001). This script performs a one-time interactive sign-in to obtain a
    refresh token, which the agents then use to silently acquire fresh access tokens on each run.

    The refresh token stays valid indefinitely as long as it's used regularly (renewed on each use).

.NOTES
    Run this script once to set up the initial token.
    Re-run if the refresh token expires (e.g., agents were offline for > 90 days).
#>

$ErrorActionPreference = 'Stop'

# ── Config ────────────────────────────────────────────────────────
$TenantId       = '19ab7456-f160-416d-a503-57298ab192a2'
$ClientId       = '06c728b6-0111-4cb1-a708-d57c51128649'  # Glyphor AI Bot (public client)
$GcpProject     = 'ai-glyphor-company'
$SecretName     = 'agent365-refresh-token'

# All MCP scopes from ToolingManifest.json
$McpScopes = @(
    'ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/McpServers.Mail.All'
    'ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/McpServers.Calendar.All'
    'ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/McpServers.Teams.All'
    'ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/McpServers.OneDriveSharepoint.All'
    'ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/McpServers.SharePointLists.All'
    'ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/McpServers.Word.All'
    'ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/McpServers.CopilotMCP.All'
    'ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/McpServersMetadata.Read.All'
    'offline_access'
)
$ScopeString = $McpScopes -join ' '

# ── Step 1: Device Code Auth ─────────────────────────────────────
Write-Host ''
Write-Host '=== Agent 365 MCP Token Acquisition ===' -ForegroundColor Cyan
Write-Host ''

# Request device code
$deviceBody = @{
    client_id = $ClientId
    scope     = $ScopeString
}
$deviceCode = Invoke-RestMethod `
    -Uri "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/devicecode" `
    -Method POST -Body $deviceBody -ContentType 'application/x-www-form-urlencoded'

Write-Host 'To sign in, open your browser to:' -ForegroundColor White
Write-Host '  https://microsoft.com/devicelogin' -ForegroundColor Yellow
Write-Host ''
Write-Host "Enter the code: $($deviceCode.user_code)" -ForegroundColor Green
Write-Host ''

# Open browser automatically
Start-Process 'https://microsoft.com/devicelogin'

Write-Host 'Waiting for sign-in...' -ForegroundColor Gray

# Poll for token
$interval = $deviceCode.interval
$expires  = (Get-Date).AddSeconds($deviceCode.expires_in)
$tokenBody = @{
    grant_type  = 'urn:ietf:params:oauth:grant-type:device_code'
    client_id   = $ClientId
    device_code = $deviceCode.device_code
}

$tokenResult = $null
while ((Get-Date) -lt $expires) {
    Start-Sleep -Seconds $interval
    try {
        $tokenResult = Invoke-RestMethod `
            -Uri "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token" `
            -Method POST -Body $tokenBody -ContentType 'application/x-www-form-urlencoded'
        break
    } catch {
        $errBody = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($errBody.error -eq 'authorization_pending') {
            Write-Host '.' -NoNewline
            continue
        } elseif ($errBody.error -eq 'slow_down') {
            $interval += 5
            continue
        } else {
            Write-Host ''
            Write-Host "Auth error: $($errBody.error_description)" -ForegroundColor Red
            exit 1
        }
    }
}

if (-not $tokenResult) {
    Write-Host ''
    Write-Host 'Authentication timed out. Please try again.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host 'Authentication successful!' -ForegroundColor Green

# Decode access token to show claims
$p   = $tokenResult.access_token.Split('.')[1]
$pad = $p + ('=' * ((4 - $p.Length % 4) % 4))
$claims = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($pad)) | ConvertFrom-Json

Write-Host "  Token type: $($claims.idtyp)" -ForegroundColor Cyan
Write-Host "  Scopes: $($claims.scp)" -ForegroundColor Cyan
Write-Host "  User: $($claims.upn ?? $claims.name ?? $claims.sub)" -ForegroundColor Cyan
Write-Host "  Expires: $((Get-Date '1970-01-01').AddSeconds($claims.exp).ToLocalTime())" -ForegroundColor Cyan

if (-not $tokenResult.refresh_token) {
    Write-Host 'ERROR: No refresh token in response. Make sure offline_access scope was granted.' -ForegroundColor Red
    exit 1
}

# ── Step 2: Store in GCP Secret Manager ──────────────────────────
Write-Host ''
Write-Host 'Storing refresh token in GCP Secret Manager...' -ForegroundColor Yellow

# Create secret if it doesn't exist
$existingSecret = gcloud secrets describe $SecretName --project=$GcpProject 2>&1
if ($LASTEXITCODE -ne 0) {
    gcloud secrets create $SecretName --project=$GcpProject --replication-policy=automatic 2>&1 | Out-Null
    Write-Host "  Created secret: $SecretName" -ForegroundColor Green
}

# Add new version with the refresh token
$tokenResult.refresh_token | gcloud secrets versions add $SecretName --project=$GcpProject --data-file=- 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  Stored refresh token as new version in $SecretName" -ForegroundColor Green
} else {
    Write-Host "  Failed to store refresh token in GCP. Store it manually:" -ForegroundColor Red
    Write-Host "  $($tokenResult.refresh_token)" -ForegroundColor Gray
    exit 1
}

# ── Step 3: Update Cloud Run services ────────────────────────────
Write-Host ''
Write-Host 'Updating Cloud Run services with AGENT365_REFRESH_TOKEN...' -ForegroundColor Yellow

$services = @('glyphor-worker', 'glyphor-scheduler')
foreach ($svc in $services) {
    gcloud run services update $svc `
        --region=us-central1 `
        --project=$GcpProject `
        --update-secrets="AGENT365_REFRESH_TOKEN=${SecretName}:latest" `
        2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Updated $svc with AGENT365_REFRESH_TOKEN" -ForegroundColor Green
    } else {
        Write-Host "  Failed to update $svc" -ForegroundColor Red
    }
}

Write-Host ''
Write-Host '=== Done! Agent 365 MCP tokens are now configured. ===' -ForegroundColor Cyan
Write-Host 'Deploy worker and scheduler to start using MCP tools.' -ForegroundColor White
Write-Host ''

#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Assigns M365 MCP server permissions (oauth2PermissionGrants) and Glyphor app
  roles to all Entra Agent Identities.

.DESCRIPTION
  Agent Identities are @odata.type #microsoft.graph.agentIdentity with
  servicePrincipalType = ServiceIdentity. They are created under Blueprint
  b47da287-6b05-4be3-9807-3f49047fbbb8.

  The Microsoft Agent 365 Tools API (ea9ffc3e-...) exposes MCP server access
  as publishedPermissionScopes (delegated permissions), NOT appRoles.
  Therefore we use oauth2PermissionGrants (admin consent) rather than
  appRoleAssignments.

  Each agent identity gets:
  1. An oauth2PermissionGrant for the full M365 MCP scope catalog
  2. Glyphor Blueprint app roles (per-agent, from agentIdentities.json) via
     appRoleAssignments on the Glyphor app SP (5604df3b-...)

.EXAMPLE
  pwsh scripts/assign-agent-permissions.ps1
#>

$ErrorActionPreference = 'Stop'

$TenantId = '19ab7456-f160-416d-a503-57298ab192a2'
$M365AgentToolsSpId = 'ec46f895-d7a3-482e-80d5-836e5af656a4'
$GlyphorAppId = '5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a'

$root = Split-Path $PSScriptRoot
$CreatedFile = Join-Path $root '.agent-identities-created.json'
$AgentConfigFile = Join-Path $root 'packages' 'agent-runtime' 'src' 'config' 'agentIdentities.json'

# M365 MCP scopes every agent needs (space-delimited for oauth2PermissionGrant)
$RequiredM365Scopes = @(
    'McpServers.Mail.All',
    'McpServers.Calendar.All',
    'McpServers.OneDriveSharepoint.All',
    'McpServers.Teams.All',
    'McpServers.CopilotMCP.All',
    'McpServers.Word.All',
    'McpServers.UserProfile.All',
    'McpServers.SharePointLists.All',
    'McpServers.AdminCenter.All'
) -join ' '

function Log { param([string]$m); Write-Host "$(Get-Date -Format 'HH:mm:ss') $m" }

function Normalize-ScopeString {
    param([string]$ScopeString)

    if ([string]::IsNullOrWhiteSpace($ScopeString)) {
        return ''
    }

    return (($ScopeString -split '\s+' | Where-Object { $_ } | Sort-Object -Unique) -join ' ')
}

# ─── Connect to Graph ─────────────────────────────────────────────
Log 'Connecting to Microsoft Graph...'
Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
$ctx = Get-MgContext -ErrorAction SilentlyContinue
if ($ctx -and $ctx.TenantId -eq $TenantId) {
    Log "  Already connected as $($ctx.Account)"
} else {
    Connect-MgGraph -Scopes 'Application.ReadWrite.All','AppRoleAssignment.ReadWrite.All','DelegatedPermissionGrant.ReadWrite.All' -TenantId $TenantId -NoWelcome
    $ctx = Get-MgContext
    Log "  Connected as $($ctx.Account)"
}

function GBeta {
    param([string]$Method, [string]$Path, [hashtable]$Body)
    $p = @{ Method = $Method; Uri = "https://graph.microsoft.com/beta$Path"; Headers = @{ 'OData-Version' = '4.0' } }
    if ($Body) { $p.Body = ($Body | ConvertTo-Json -Depth 10); $p.ContentType = 'application/json' }
    try {
        $result = Invoke-MgGraphRequest @p
        if ($null -eq $result) { return @{ _success = $true } }
        return $result
    }
    catch {
        $sc = 0; if ($_.Exception.Response) { $sc = [int]$_.Exception.Response.StatusCode }
        $ed = ''
        try { $ed = $_.ErrorDetails.Message } catch {}
        if ($sc -eq 409 -or $ed -match 'already exists') { return @{ _conflict = $true } }
        Log "  ERR: $Method $Path - $sc $ed"
        return $null
    }
}

# ─── Load agent data ──────────────────────────────────────────────
if (-not (Test-Path $CreatedFile)) { Log "FATAL: $CreatedFile not found. Run setup-agent-ids.ps1 first."; exit 1 }
if (-not (Test-Path $AgentConfigFile)) { Log "FATAL: $AgentConfigFile not found."; exit 1 }

$created = Get-Content $CreatedFile -Raw | ConvertFrom-Json
$agentConfig = Get-Content $AgentConfigFile -Raw | ConvertFrom-Json
$agentKeys = $created.PSObject.Properties.Name
Log "Loaded $($agentKeys.Count) agent identities"

# ═══════════════════════════════════════════════════════════════════
# Step 1: M365 Agent Tools — oauth2PermissionGrants (delegated)
# ═══════════════════════════════════════════════════════════════════
Log ''
Log '═══ Step 1: Microsoft Agent 365 Tools API — OAuth2 Permission Grants ═══'
Log "  Resource SP: $M365AgentToolsSpId"
Log "  Scopes: $RequiredM365Scopes"
Log ''

$m365Granted = 0; $m365Updated = 0; $m365Existed = 0; $m365Failed = 0

# Set grant expiry to 10 years from now
$expiryTime = (Get-Date).AddYears(10).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$minimumAcceptableExpiryTime = (Get-Date).AddYears(9).ToUniversalTime()
$normalizedRequiredM365Scopes = Normalize-ScopeString $RequiredM365Scopes

foreach ($agentKey in $agentKeys) {
    $agentId = $created.$agentKey.id
    $agentName = $created.$agentKey.name

    $existingGrantResponse = GBeta -Method GET -Path "/servicePrincipals/$agentId/oauth2PermissionGrants" -Body $null
    $existingGrant = @($existingGrantResponse.value | Where-Object { $_.resourceId -eq $M365AgentToolsSpId }) | Select-Object -First 1

    if ($existingGrant) {
        $normalizedExistingScopes = Normalize-ScopeString $existingGrant.scope
        $existingExpiryTime = $null
        if ($existingGrant.expiryTime) {
            try { $existingExpiryTime = [DateTimeOffset]::Parse($existingGrant.expiryTime) } catch {}
        }
        $grantNeedsUpdate = $normalizedExistingScopes -ne $normalizedRequiredM365Scopes -or -not $existingExpiryTime -or $existingExpiryTime.UtcDateTime -lt $minimumAcceptableExpiryTime

        if ($grantNeedsUpdate) {
            $patchResult = GBeta -Method PATCH -Path "/oauth2PermissionGrants/$($existingGrant.id)" -Body @{
                scope      = $RequiredM365Scopes
                expiryTime = $expiryTime
            }

            if ($patchResult -ne $null) {
                $m365Updated++
                Log "  $agentName — UPDATED"
            } else {
                $m365Failed++
                Log "  $agentName — FAILED UPDATE"
            }
        } else {
            $m365Existed++
        }
    } else {
        $body = @{
            clientId    = $agentId
            consentType = 'AllPrincipals'
            resourceId  = $M365AgentToolsSpId
            scope       = $RequiredM365Scopes
            expiryTime  = $expiryTime
        }
        $result = GBeta -Method POST -Path '/oauth2PermissionGrants' -Body $body
        if ($result) {
            $m365Granted++
            Log "  $agentName — GRANTED"
        } else {
            $m365Failed++
            Log "  $agentName — FAILED"
        }
    }
    Start-Sleep -Milliseconds 150
}

Log ''
Log "M365 oauth2PermissionGrants: $m365Granted new, $m365Updated updated, $m365Existed already current, $m365Failed failed"

# ═══════════════════════════════════════════════════════════════════
# Step 2: Glyphor App Roles — appRoleAssignments
# ═══════════════════════════════════════════════════════════════════
Log ''
Log '═══ Step 2: Glyphor App Roles ═══'

# Ensure SP exists for the Glyphor app
$gSpResult = GBeta -Method GET -Path "/servicePrincipals?`$filter=appId eq '$GlyphorAppId'&`$select=id,displayName,appRoles"
$gSpId = $null
$gRoles = @()

if ($gSpResult -and $gSpResult.value -and $gSpResult.value.Count -gt 0) {
    $gSp = $gSpResult.value[0]
    $gSpId = $gSp.id
    $gRoles = @($gSp.appRoles)
    Log "  Found Glyphor SP: $gSpId ($($gSp.displayName))"
    Log "  App roles: $($gRoles.Count)"
} else {
    Log '  Glyphor app SP not found. Creating...'
    $newSp = GBeta -Method POST -Path '/servicePrincipals' -Body @{ appId = $GlyphorAppId }
    if ($newSp) {
        $gSpId = $newSp.id
        $gRoles = @($newSp.appRoles)
        Log "  Created Glyphor SP: $gSpId"
        Log "  App roles: $($gRoles.Count)"
    } else {
        Log '  FAILED to create Glyphor app SP. Skipping Glyphor role assignments.'
    }
}

if ($gSpId -and $gRoles.Count -gt 0) {
    $gRoleMap = @{}
    foreach ($r in $gRoles) { $gRoleMap[$r.value] = $r.id }

    $gAssigned = 0; $gExisted = 0; $gFailed = 0

    foreach ($agentKey in $agentKeys) {
        $agentId = $created.$agentKey.id
        $agentName = $created.$agentKey.name
        $configEntry = $agentConfig.$agentKey
        if (-not $configEntry -or -not $configEntry.roles) { continue }

        $roles = @($configEntry.roles)
        foreach ($role in $roles) {
            if (-not $gRoleMap.ContainsKey($role)) {
                Log "  $agentName — SKIP $role (not in Glyphor app)"
                continue
            }
            $body = @{
                principalId = $agentId
                resourceId  = $gSpId
                appRoleId   = $gRoleMap[$role]
            }
            $result = GBeta -Method POST -Path "/servicePrincipals/$agentId/appRoleAssignments" -Body $body
            if ($result -and $result._conflict) {
                $gExisted++
            } elseif ($result) {
                Log "  $agentName — + $role"
                $gAssigned++
            } else {
                Log "  $agentName — x $role"
                $gFailed++
            }
            Start-Sleep -Milliseconds 100
        }
    }
    Log ''
    Log "Glyphor appRoleAssignments: $gAssigned new, $gExisted existed, $gFailed failed"
} elseif ($gSpId) {
    Log '  Glyphor SP has 0 app roles. Skipping.'
} else {
    Log '  Glyphor SP unavailable. Skipping.'
}

# ═══════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════
Log ''
Log '═══════════════════════════════════════════════'
Log '  Permission Assignment Complete'
Log "  Agents processed: $($agentKeys.Count)"
Log "  M365 MCP (oauth2Grants): $m365Granted new, $m365Updated updated, $m365Existed already current, $m365Failed failed"
if ($gSpId -and $gRoles.Count -gt 0) {
    Log "  Glyphor (appRoles):      $gAssigned new, $gExisted existed, $gFailed failed"
}
Log '═══════════════════════════════════════════════'

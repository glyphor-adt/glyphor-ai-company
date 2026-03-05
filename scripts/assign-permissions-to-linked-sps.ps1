#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Assign M365 MCP permissions + Glyphor app roles to the b47da287 Agent Identity SPs
  (the set that users' identityParentId actually points to).
#>

$ErrorActionPreference = 'Continue'
$TenantId = '19ab7456-f160-416d-a503-57298ab192a2'

$m365ResourceId = 'ec46f895-d7a3-482e-80d5-836e5af656a4'
$glyphorResourceId = '4e603e56-6362-4529-b48a-33144f3e11db'
$scope = 'McpServers.Calendar.All McpServers.Teams.All McpServers.CopilotMCP.All'
$appRole1 = '44f8632a-2269-4f1f-ab0e-eab6ab0c30b1'
$appRole2 = 'd37493b8-3282-46de-9e48-160da48c499f'
$expiry = '2036-03-05T15:37:56Z'

function Log { param([string]$m); Write-Host "$(Get-Date -Format 'HH:mm:ss') $m" }

Log 'Connecting...'
Connect-MgGraph -Scopes 'Application.ReadWrite.All','AppRoleAssignment.ReadWrite.All','DelegatedPermissionGrant.ReadWrite.All','Directory.ReadWrite.All' `
    -TenantId $TenantId -NoWelcome -ContextScope Process

$realIds = Get-Content (Join-Path $PSScriptRoot 'agent-identity-real-ids.json') -Raw | ConvertFrom-Json
$spEntries = @()
$realIds.PSObject.Properties | ForEach-Object { $spEntries += @{ key = $_.Name; id = $_.Value } }
Log "Processing $($spEntries.Count) SPs..."

$gOk=0; $gFail=0; $gSkip=0
$r1Ok=0; $r1Fail=0; $r1Skip=0
$r2Ok=0; $r2Fail=0; $r2Skip=0
$processed = 0

foreach ($sp in $spEntries) {
    $spId = $sp.id
    $processed++

    # Check existing
    try {
        $existGrants = (Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta/servicePrincipals/$spId/oauth2PermissionGrants" -ErrorAction Stop).value
    } catch { $existGrants = @() }

    try {
        $existRoles = (Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta/servicePrincipals/$spId/appRoleAssignments" -ErrorAction Stop).value
    } catch { $existRoles = @() }

    # 1. oauth2PermissionGrant
    $hasGrant = ($existGrants | Where-Object { $_.scope -like '*McpServers*' }).Count -gt 0
    if ($hasGrant) {
        $gSkip++
    } else {
        try {
            $gb = @{ clientId=$spId; consentType='AllPrincipals'; resourceId=$m365ResourceId; scope=$scope; expiryTime=$expiry } | ConvertTo-Json
            Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/beta/oauth2PermissionGrants" -Body $gb -ContentType 'application/json' -ErrorAction Stop | Out-Null
            $gOk++
        } catch {
            $gFail++
            Log "  GRANT FAIL $($sp.key): $($_.Exception.Message.Substring(0, [Math]::Min(80, $_.Exception.Message.Length)))"
        }
    }

    # 2. appRole 1
    $hasR1 = ($existRoles | Where-Object { $_.appRoleId -eq $appRole1 }).Count -gt 0
    if ($hasR1) {
        $r1Skip++
    } else {
        try {
            $rb1 = @{ principalId=$spId; resourceId=$glyphorResourceId; appRoleId=$appRole1 } | ConvertTo-Json
            Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/beta/servicePrincipals/$spId/appRoleAssignments" -Body $rb1 -ContentType 'application/json' -ErrorAction Stop | Out-Null
            $r1Ok++
        } catch {
            $r1Fail++
            Log "  ROLE1 FAIL $($sp.key): $($_.Exception.Message.Substring(0, [Math]::Min(80, $_.Exception.Message.Length)))"
        }
    }

    # 3. appRole 2
    $hasR2 = ($existRoles | Where-Object { $_.appRoleId -eq $appRole2 }).Count -gt 0
    if ($hasR2) {
        $r2Skip++
    } else {
        try {
            $rb2 = @{ principalId=$spId; resourceId=$glyphorResourceId; appRoleId=$appRole2 } | ConvertTo-Json
            Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/beta/servicePrincipals/$spId/appRoleAssignments" -Body $rb2 -ContentType 'application/json' -ErrorAction Stop | Out-Null
            $r2Ok++
        } catch {
            $r2Fail++
            Log "  ROLE2 FAIL $($sp.key): $($_.Exception.Message.Substring(0, [Math]::Min(80, $_.Exception.Message.Length)))"
        }
    }

    if ($processed % 10 -eq 0) { Log "  ... $processed / $($spEntries.Count)" }
    Start-Sleep -Milliseconds 300
}

Log ''
Log '=== PERMISSION ASSIGNMENT COMPLETE ==='
Log "Grants:  OK=$gOk FAIL=$gFail SKIP=$gSkip"
Log "Role1:   OK=$r1Ok FAIL=$r1Fail SKIP=$r1Skip"
Log "Role2:   OK=$r2Ok FAIL=$r2Fail SKIP=$r2Skip"
Log "Total processed: $processed / $($spEntries.Count)"

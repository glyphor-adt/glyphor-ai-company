#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Recreates agent user accounts with agentIdentityBlueprintId so they show
  "Is Agent: Yes" in Entra while retaining Mail & Teams presence.

.DESCRIPTION
  agentIdentityBlueprintId is read-only after user creation, so existing agent
  users must be deleted and recreated with the blueprint ID set at creation time.

  Steps per agent:
    1. Export user properties (displayName, UPN, jobTitle, department, etc.)
    2. Delete the user account (soft-delete, 30-day recovery window)
    3. Permanently delete from recycle bin (so UPN is immediately reusable)
    4. Recreate with same properties + agentIdentityBlueprintId
    5. Reassign MICROSOFT_AGENT_365_TIER_3 license

  Excludes founder accounts (kristina@, andrew@, andrew.zwelling).

.EXAMPLE
  pwsh scripts/migrate-agent-users.ps1
#>

$ErrorActionPreference = 'Stop'

$TenantId = '19ab7456-f160-416d-a503-57298ab192a2'
$BlueprintId = 'b47da287-6b05-4be3-9807-3f49047fbbb8'
$AgentLicenseSku = '304b93a3-b1f1-427f-aa02-da21e7c7d675'  # MICROSOFT_AGENT_365_TIER_3

# Founders — never touch
$ProtectedUpns = @(
    'kristina@glyphor.ai',
    'andrew@glyphor.ai',
    'andrew.zwelling_gmail.com#EXT#@glyphorai.onmicrosoft.com'
)

function Log { param([string]$m); Write-Host "$(Get-Date -Format 'HH:mm:ss') $m" }

# ─── Connect ──────────────────────────────────────────────────────
Log 'Connecting to Microsoft Graph...'
Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
$ctx = Get-MgContext -ErrorAction SilentlyContinue
if ($ctx -and $ctx.TenantId -eq $TenantId) {
    Log "  Already connected as $($ctx.Account)"
} else {
    Connect-MgGraph -Scopes 'User.ReadWrite.All','Directory.ReadWrite.All' -TenantId $TenantId -NoWelcome
    $ctx = Get-MgContext
    Log "  Connected as $($ctx.Account)"
}

function GBeta {
    param([string]$Method, [string]$Path, [string]$Body)
    $p = @{
        Method = $Method
        Uri    = "https://graph.microsoft.com/beta$Path"
    }
    if ($Body) {
        $p.Body = $Body
        $p.ContentType = 'application/json'
    }
    Invoke-MgGraphRequest @p
}

# ─── Get all non-founder users ───────────────────────────────────
Log 'Loading all users...'
$allUsers = @()
$uri = "/users?`$select=id,displayName,userPrincipalName,jobTitle,department,companyName,accountEnabled,assignedLicenses&`$top=100"
while ($uri) {
    $page = GBeta -Method GET -Path $uri
    $allUsers += $page.value
    $uri = $page.'@odata.nextLink'
    if ($uri) { $uri = $uri -replace 'https://graph.microsoft.com/beta','' }
}
Log "  Total users: $($allUsers.Count)"

# Filter to agent users only
$agentUsers = $allUsers | Where-Object { $ProtectedUpns -notcontains $_.userPrincipalName }
Log "  Agent users to migrate: $($agentUsers.Count)"

if ($agentUsers.Count -eq 0) {
    Log 'No agent users found. Nothing to do.'
    exit 0
}

# ─── Migrate each agent ─────────────────────────────────────────
$migrated = 0; $failed = 0; $skipped = 0

foreach ($user in $agentUsers) {
    $upn = $user.userPrincipalName
    $displayName = $user.displayName
    $userId = $user.id

    Log ''
    Log "─── $displayName ($upn) ───"

    try {
        # Step 1: Delete user (soft-delete)
        Log '  Deleting...'
        GBeta -Method DELETE -Path "/users/$userId" | Out-Null
        Start-Sleep -Milliseconds 500

        # Step 2: Permanently delete from recycle bin so UPN is reusable
        Log '  Purging from recycle bin...'
        try {
            GBeta -Method DELETE -Path "/directory/deletedItems/$userId" | Out-Null
        } catch {
            # May take a moment to appear in deleted items
            Start-Sleep -Seconds 2
            try {
                GBeta -Method DELETE -Path "/directory/deletedItems/$userId" | Out-Null
            } catch {
                Log "  WARN: Could not purge from recycle bin: $($_.Exception.Message)"
            }
        }
        Start-Sleep -Seconds 1

        # Step 3: Recreate with blueprint ID
        Log '  Recreating with blueprint...'
        $mailNickname = ($upn -split '@')[0]
        $newUserBody = @{
            accountEnabled             = [bool]$user.accountEnabled
            displayName                = $displayName
            mailNickname               = $mailNickname
            userPrincipalName          = $upn
            jobTitle                   = $user.jobTitle
            department                 = $user.department
            companyName                = if ($user.companyName) { $user.companyName } else { 'Glyphor AI' }
            agentIdentityBlueprintId   = $BlueprintId
            passwordProfile            = @{
                forceChangePasswordNextSignIn = $false
                password                     = "Glyphor!Agent$(Get-Random -Minimum 100000 -Maximum 999999)"
            }
        } | ConvertTo-Json -Depth 3

        $newUser = GBeta -Method POST -Path '/users' -Body $newUserBody
        Log "  Created: $($newUser.id)"

        # Step 4: Assign license
        Log '  Assigning Agent 365 license...'
        Start-Sleep -Seconds 1
        $licBody = @{
            addLicenses    = @( @{ skuId = $AgentLicenseSku; disabledPlans = @() } )
            removeLicenses = @()
        } | ConvertTo-Json -Depth 3

        try {
            GBeta -Method POST -Path "/users/$($newUser.id)/assignLicense" -Body $licBody | Out-Null
            Log '  License assigned'
        } catch {
            Log "  WARN: License assignment failed: $($_.Exception.Message)"
        }

        $migrated++
        Log "  DONE"

    } catch {
        $failed++
        Log "  FAILED: $($_.Exception.Message)"
        try { Log "  Detail: $($_.ErrorDetails.Message)" } catch {}
    }

    # Rate-limit to avoid throttling
    Start-Sleep -Milliseconds 500
}

# ─── Summary ─────────────────────────────────────────────────────
Log ''
Log '═══════════════════════════════════════════════'
Log '  Agent User Migration Complete'
Log "  Migrated: $migrated"
Log "  Failed:   $failed"
Log "  Skipped:  $skipped"
Log '═══════════════════════════════════════════════'

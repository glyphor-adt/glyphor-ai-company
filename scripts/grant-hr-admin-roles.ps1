#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Grants Jasmine Rivera (Head of HR) the Entra admin roles needed to manage
  agent user profiles: display names, job titles, departments, photos, 
  licenses, and org-chart manager assignments.

.DESCRIPTION
  Assigns the following built-in Entra directory roles to jasmine@glyphor.ai:

  1. User Administrator        — Create/update/delete users, reset passwords,
                                  update profile properties (displayName, jobTitle,
                                  department, manager, etc.), assign licenses.
  2. License Administrator     — Assign/remove license plans and usage location.
  
  These two roles together give Jasmine everything she needs to:
  - Fix missing display names, job titles, departments
  - Upload/update profile photos (PUT /users/{id}/photo/$value)
  - Set manager relationships (org chart)
  - Assign/reassign Microsoft Agent 365 licenses
  - Set usage location for license-blocked users

.EXAMPLE
  Connect-MgGraph -Scopes "RoleManagement.ReadWrite.Directory" -TenantId '19ab7456-f160-416d-a503-57298ab192a2'
  .\scripts\grant-hr-admin-roles.ps1
#>

$ErrorActionPreference = 'Stop'
$TenantId = '19ab7456-f160-416d-a503-57298ab192a2'
$JasmineUpn = 'jasmine@glyphor.ai'

function Log { param([string]$m); Write-Host "$(Get-Date -Format 'HH:mm:ss') $m" }

# ─── Connect ──────────────────────────────────────────────────────
Log 'Connecting to Microsoft Graph...'
Disconnect-MgGraph -ErrorAction SilentlyContinue
Connect-MgGraph -Scopes 'RoleManagement.ReadWrite.Directory','User.Read.All' `
    -TenantId $TenantId -NoWelcome -ContextScope Process
$ctx = Get-MgContext
if (-not $ctx) {
    Write-Error 'Failed to connect to Microsoft Graph.'
    exit 1
}
Log "Connected as $($ctx.Account)"

# ─── Resolve Jasmine's user ID ────────────────────────────────────
Log "Resolving $JasmineUpn..."
$jasmine = Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/users/$JasmineUpn`?`$select=id,displayName,userPrincipalName"
$jasmineId = $jasmine.id
Log "  ID: $jasmineId  ($($jasmine.displayName))"

# ─── Built-in role template IDs (Microsoft-defined, same across all tenants) ─
$rolesToAssign = @(
    @{ templateId = 'fe930be7-5e62-47db-91af-98c3a49a38b1'; name = 'User Administrator' }
    @{ templateId = '4d6ac14f-3453-41d0-bead-e2824e8a4319'; name = 'License Administrator' }
    @{ templateId = 'fdd7a751-b60b-444a-984c-02652fe8fa1c'; name = 'Groups Administrator' }
)

# ─── Get existing role assignments ────────────────────────────────
Log ''
Log 'Checking existing role assignments...'
$existingAssignments = Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignments?`$filter=principalId eq '$jasmineId'"
$existingRoleIds = @($existingAssignments.value | ForEach-Object { $_.roleDefinitionId })
Log "  Currently has $($existingRoleIds.Count) role assignment(s)"

# ─── Assign roles ────────────────────────────────────────────────
Log ''
Log '═══ Assigning Entra Admin Roles ═══'

$assigned = 0; $existed = 0; $failed = 0

foreach ($role in $rolesToAssign) {
    # Resolve the role definition ID from the template
    $roleDef = Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/roleManagement/directory/roleDefinitions?`$filter=templateId eq '$($role.templateId)'"
    $roleDefId = $roleDef.value[0].id

    if ($existingRoleIds -contains $roleDefId) {
        Log "  SKIP: $($role.name) — already assigned"
        $existed++
        continue
    }

    try {
        $body = @{
            principalId      = $jasmineId
            roleDefinitionId = $roleDefId
            directoryScopeId = '/'
        }
        Invoke-MgGraphRequest -Method POST `
            -Uri 'https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignments' `
            -Body ($body | ConvertTo-Json) `
            -ContentType 'application/json' | Out-Null
        Log "  OK: $($role.name)"
        $assigned++
    } catch {
        $msg = $_.Exception.Message
        if ($msg -match 'already exists|conflict') {
            Log "  SKIP: $($role.name) — already assigned (conflict)"
            $existed++
        } else {
            if ($msg.Length -gt 120) { $msg = $msg.Substring(0, 120) }
            Log "  FAIL: $($role.name) — $msg"
            $failed++
        }
    }
}

# ─── Summary ──────────────────────────────────────────────────────
Log ''
Log '═══ SUMMARY ═══'
Log "  Newly assigned: $assigned"
Log "  Already had:    $existed"
Log "  Failed:         $failed"
Log ''
Log 'Jasmine Rivera can now:'
Log '  - Update user profiles (displayName, jobTitle, department, etc.)'
Log '  - Upload/change profile photos'
Log '  - Set manager relationships (org chart)'
Log '  - Assign and manage Microsoft Agent 365 licenses'
Log '  - Set usage location for users'
Log ''
Log "She should sign in at https://entra.microsoft.com as $JasmineUpn"
Log 'Or use: Connect-MgGraph -Scopes User.ReadWrite.All'

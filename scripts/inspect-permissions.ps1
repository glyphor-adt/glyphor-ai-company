# Inspect M365 Agent Tools API service principal to understand permission model
Import-Module Microsoft.Graph.Authentication -ErrorAction Stop

$tenantId = '19ab7456-f160-416d-a503-57298ab192a2'
Connect-MgGraph -TenantId $tenantId -Scopes 'Application.Read.All','AppRoleAssignment.ReadWrite.All','DelegatedPermissionGrant.ReadWrite.All' -NoWelcome

$m365SpId = 'ec46f895-d7a3-482e-80d5-836e5af656a4'
$bpSpId = '28079457-37d9-483c-b7bb-fe6920083b8e'  # from a365.generated.config.json

function GBeta { param([string]$Path)
    try { Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta$Path" }
    catch { Write-Host "ERR: $Path - $($_.Exception.Message)"; return $null }
}

Write-Host '=== M365 Agent Tools API SP ==='
$m365 = GBeta -Path "/servicePrincipals/$m365SpId?`$select=id,displayName,appRoles,oauth2PermissionScopes,servicePrincipalType"
if ($m365) {
    Write-Host "  Type: $($m365.servicePrincipalType)"
    Write-Host "  AppRoles: $($m365.appRoles.Count)"
    if ($m365.oauth2PermissionScopes) {
        Write-Host "  OAuth2 Scopes: $($m365.oauth2PermissionScopes.Count)"
        foreach ($s in $m365.oauth2PermissionScopes) { Write-Host "    $($s.value) -> $($s.id) ($($s.type))" }
    } else { Write-Host '  No oauth2PermissionScopes' }
}

Write-Host ''
Write-Host '=== Glyphor Blueprint SP (AgentIdentityBlueprintPrincipal) ==='
$bp = GBeta -Path "/servicePrincipals/$bpSpId?`$select=id,displayName,appRoles,oauth2PermissionScopes,servicePrincipalType"
if ($bp) {
    Write-Host "  Type: $($bp.servicePrincipalType)"
    Write-Host "  AppRoles: $($bp.appRoles.Count)"
    if ($bp.appRoles) { foreach ($r in $bp.appRoles) { Write-Host "    $($r.value) -> $($r.id) ($($r.isEnabled))" } }
    if ($bp.oauth2PermissionScopes) {
        Write-Host "  OAuth2 Scopes: $($bp.oauth2PermissionScopes.Count)"
        foreach ($s in $bp.oauth2PermissionScopes) { Write-Host "    $($s.value) -> $($s.id)" }
    }
} else {
    Write-Host '  Not found by ID. Trying application endpoint...'
    $bpObjId = 'ef4709f1-5f28-4080-8287-cec2314dc5b5'
    $app = GBeta -Path "/applications/$bpObjId?`$select=id,displayName,appRoles"
    if ($app) {
        Write-Host "  App: $($app.displayName)"
        Write-Host "  AppRoles defined: $($app.appRoles.Count)"
        foreach ($r in $app.appRoles) { Write-Host "    $($r.value) -> $($r.id)" }
    }
}

Write-Host ''
Write-Host '=== Checking Agent Identity (Marcus Reeves) current permissions ==='
$ctoId = '0d4b0680-36ae-488e-91cc-29d349a80192'
$ctoPerms = GBeta -Path "/servicePrincipals/$ctoId/appRoleAssignments"
if ($ctoPerms -and $ctoPerms.value) {
    Write-Host "  AppRoleAssignments: $($ctoPerms.value.Count)"
    foreach ($a in $ctoPerms.value) { Write-Host "    role=$($a.appRoleId) resource=$($a.resourceId)" }
} else { Write-Host '  No appRoleAssignments' }

$ctoGrants = GBeta -Path "/servicePrincipals/$ctoId/oauth2PermissionGrants"
if ($ctoGrants -and $ctoGrants.value) {
    Write-Host "  OAuth2Grants: $($ctoGrants.value.Count)"
    foreach ($g in $ctoGrants.value) { Write-Host "    scope='$($g.scope)' resource=$($g.resourceId)" }
} else { Write-Host '  No oauth2PermissionGrants' }

# Check the agent identity details
Write-Host ''
$ctoDetails = GBeta -Path "/servicePrincipals/$ctoId?`$select=id,displayName,servicePrincipalType,appId"
if ($ctoDetails) {
    Write-Host "  CTO Agent Identity: $($ctoDetails.displayName)"
    Write-Host "  Type: $($ctoDetails.servicePrincipalType)"
    Write-Host "  AppId: $($ctoDetails.appId)"
}

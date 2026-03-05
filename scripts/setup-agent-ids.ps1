#!/usr/bin/env pwsh
# Entra Agent ID Setup - Run with: pwsh scripts/setup-agent-ids.ps1
$ErrorActionPreference = 'Stop'

$TenantId = '19ab7456-f160-416d-a503-57298ab192a2'
$BlueprintAppId = '5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a'
$BlueprintObjectId = 'ef4709f1-5f28-4080-8287-cec2314dc5b5'
$SponsorUserId = '88a731d1-3171-4279-aee1-34160898ab90'
$root = Split-Path $PSScriptRoot
$SecretFile = Join-Path $root '.agent-id-blueprint-secret.json'
$ResultsFile = Join-Path $root '.agent-identities-created.json'
$AgentFile = Join-Path $root 'packages' 'agent-runtime' 'src' 'config' 'agentIdentities.json'
$logFile = Join-Path $root '.agent-id-setup.log'

function Log { param([string]$m); $l = "$(Get-Date -Format 'HH:mm:ss') $m"; Write-Host $l; Add-Content -Path $logFile -Value $l }

$agents = Get-Content $AgentFile -Raw | ConvertFrom-Json

Write-Host '============================================================'
Write-Host '  Entra Agent ID Setup'
Write-Host "  Blueprint: $BlueprintAppId"
Write-Host '============================================================'

Log 'Step 0: Connecting to Microsoft Graph...'
Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
$ctx = Get-MgContext -ErrorAction SilentlyContinue
if ($ctx -and $ctx.TenantId -eq $TenantId) {
    Log "  Already connected as $($ctx.Account)"
} else {
    Connect-MgGraph -Scopes 'AgentIdentityBlueprint.Create','AgentIdentityBlueprint.AddRemoveCreds.All','AgentIdentityBlueprint.ReadWrite.All','AgentIdentityBlueprintPrincipal.Create','User.Read','Application.ReadWrite.All' -TenantId $TenantId -NoWelcome
    $ctx = Get-MgContext
    Log "  Connected as $($ctx.Account)"
}

function GBeta { param([string]$Method, [string]$Path, [hashtable]$Body)
    $p = @{ Method=$Method; Uri="https://graph.microsoft.com/beta$Path"; Headers=@{'OData-Version'='4.0'} }
    if ($Body) { $p.Body = ($Body | ConvertTo-Json -Depth 10); $p.ContentType = 'application/json' }
    try { Invoke-MgGraphRequest @p } catch { Log "  ERR: $Method $Path - $($_.Exception.Message)"; return $null }
}

# STEP 1
Log ''; Log '-- Step 1: Verify Blueprint --'
$bp = GBeta -Method GET -Path "/applications/$BlueprintObjectId"
if (-not $bp) { Log 'FATAL: Blueprint not found!'; exit 1 }
Log "  $($bp.displayName) appId=$($bp.appId) uris=$($bp.identifierUris.Count) scopes=$($bp.api.oauth2PermissionScopes.Count) creds=$($bp.passwordCredentials.Count)"

# STEP 2
Log ''; Log '-- Step 2: Ensure Credential --'
$clientSecret = $null
if (Test-Path $SecretFile) {
    $saved = Get-Content $SecretFile -Raw | ConvertFrom-Json
    $clientSecret = $saved.secretText
    Log "  Saved secret found (keyId: $($saved.keyId))"
} else {
    Log '  Creating credential...'
    $cred = GBeta -Method POST -Path "/applications/$BlueprintObjectId/addPassword" -Body @{ passwordCredential = @{ displayName='AgentIDSecret'; endDateTime='2026-12-31T23:59:59Z' } }
    if (-not $cred) { Log 'FATAL: credential failed'; exit 1 }
    $clientSecret = $cred.secretText
    @{ keyId=$cred.keyId; secretText=$cred.secretText } | ConvertTo-Json | Set-Content $SecretFile
    Log "  Created (keyId: $($cred.keyId))"
}

# STEP 3
Log ''; Log '-- Step 3: Configure URI + Scope --'
if ($bp.identifierUris.Count -gt 0 -and $bp.api.oauth2PermissionScopes.Count -gt 0) {
    Log '  Already configured.'
} else {
    $sid = [guid]::NewGuid().ToString()
    GBeta -Method PATCH -Path "/applications/$BlueprintObjectId" -Body @{
        identifierUris = @("api://$BlueprintAppId")
        api = @{ oauth2PermissionScopes = @(@{ adminConsentDescription='Allow access'; adminConsentDisplayName='Access agent'; id=$sid; isEnabled=$true; type='User'; value='access_agent' }) }
    } | Out-Null
    Log "  Set URI + scope ($sid)"
}

# STEP 4
Log ''; Log '-- Step 4: Blueprint Principal --'
$spFilter = "/servicePrincipals?`$filter=appId+eq+'$BlueprintAppId'&`$select=id,displayName,servicePrincipalType"
$existing = GBeta -Method GET -Path $spFilter
$sp = if ($existing -and $existing.value) { $existing.value | Select-Object -First 1 } else { $null }
$bpSpId = $null

if ($sp -and $sp.servicePrincipalType -eq 'AgentIdentityBlueprintPrincipal') {
    Log "  Already exists: $($sp.id)"
    $bpSpId = $sp.id
} else {
    if ($sp) {
        Log "  Deleting wrong-type SP ($($sp.servicePrincipalType))..."
        GBeta -Method DELETE -Path "/servicePrincipals/$($sp.id)" | Out-Null
        Start-Sleep 5
    }
    $newSp = GBeta -Method POST -Path '/serviceprincipals/graph.agentIdentityBlueprintPrincipal' -Body @{ appId=$BlueprintAppId }
    if (-not $newSp) { Log 'FATAL: BlueprintPrincipal creation failed!'; exit 1 }
    Log "  Created: $($newSp.id) type=$($newSp.servicePrincipalType)"
    $bpSpId = $newSp.id
}

# STEP 5
Log ''; Log '-- Step 5: Blueprint Token --'
$tb = "client_id=$BlueprintAppId&scope=https://graph.microsoft.com/.default&client_secret=$([uri]::EscapeDataString($clientSecret))&grant_type=client_credentials"
try {
    $tr = Invoke-RestMethod -Uri "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token" -Method POST -Body $tb -ContentType 'application/x-www-form-urlencoded'
    $bpToken = $tr.access_token
    Log '  Token acquired.'
} catch {
    Log "  FAIL: $($_.Exception.Message)"
    exit 1
}

# STEP 6
Log ''; Log '-- Step 6: Create Agent Identities --'
$keys = $agents.PSObject.Properties.Name
Log "  Agents: $($keys.Count)"
$c = 0; $s = 0; $f = 0; $res = @{}
$bh = @{ 'Authorization'="Bearer $bpToken"; 'Content-Type'='application/json'; 'OData-Version'='4.0' }

foreach ($k in $keys) {
    $n = $agents.$k.displayName -replace '^Glyphor Agent - ',''
    $b = @{ displayName=$n; agentIdentityBlueprintId=$BlueprintAppId; 'sponsors@odata.bind'=@("https://graph.microsoft.com/v1.0/users/$SponsorUserId") } | ConvertTo-Json -Depth 5
    try {
        $r = Invoke-RestMethod -Uri 'https://graph.microsoft.com/beta/serviceprincipals/Microsoft.Graph.AgentIdentity' -Method POST -Body $b -Headers $bh
        Log "  + ${k}: $n -> $($r.id)"
        $res[$k] = @{ id=$r.id; name=$n }
        $c++
    } catch {
        $sc = 0; if ($_.Exception.Response) { $sc = [int]$_.Exception.Response.StatusCode }
        if ($sc -eq 409) { Log "  o ${k}: $n (exists)"; $s++ }
        else {
            $ed = $_.ErrorDetails.Message
            Log "  x ${k}: $n - $sc $ed"; $f++
            if ($c -eq 0 -and $s -eq 0 -and $f -eq 1 -and $sc -eq 403) { Log '  Permission denied. Stopping.'; break }
        }
    }
    Start-Sleep -Milliseconds 300
}

Log ''; Log "Results: $c created, $s existed, $f failed"
if ($res.Count -gt 0) { $res | ConvertTo-Json -Depth 5 | Set-Content $ResultsFile; Log "Saved: $ResultsFile" }
Log '=== Done ==='

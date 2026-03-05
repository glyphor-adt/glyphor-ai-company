Import-Module Microsoft.Graph.Authentication
Connect-MgGraph -Scopes 'Application.ReadWrite.All','AgentIdentityBlueprint.Create','AgentIdentityBlueprint.AddRemoveCreds.All','AgentIdentityBlueprint.ReadWrite.All','AgentIdentityBlueprintPrincipal.Create' -TenantId '19ab7456-f160-416d-a503-57298ab192a2' -NoWelcome
Write-Host "Connected as $($(Get-MgContext).Account)"

$h = @{'OData-Version'='4.0'}
$sponsorUserId = '88a731d1-3171-4279-aee1-34160898ab90'

# Step 1: Create a true Agent Identity Blueprint
Write-Host "`n== Creating Agent Identity Blueprint =="
$body = @{
    displayName = 'Glyphor Agent Blueprint'
    signInAudience = 'AzureADMyOrg'
    'sponsors@odata.bind' = @("https://graph.microsoft.com/v1.0/users/$sponsorUserId")
} | ConvertTo-Json -Depth 5

try {
    $bp = Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.com/beta/applications/Microsoft.Graph.AgentIdentityBlueprint' -Headers $h -Body $body -ContentType 'application/json'
    Write-Host "Blueprint created!"
    Write-Host "  id (objectId): $($bp.id)"
    Write-Host "  appId: $($bp.appId)"
    Write-Host "  displayName: $($bp.displayName)"
    Write-Host "  @odata.type: $($bp.'@odata.type')"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    $detail = $_.ErrorDetails.Message
    Write-Host "DETAILS: $detail"
    
    # If it already exists or conflict, show detail
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.Content.ReadAsStringAsync().Result
        Write-Host "RESPONSE: $stream"
    }
    exit 1
}

# Step 2: Add credential
Write-Host "`n== Adding Credential =="
$credBody = @{
    passwordCredential = @{
        displayName = 'AgentBlueprintSecret'
        endDateTime = '2026-12-31T23:59:59Z'
    }
} | ConvertTo-Json -Depth 5
$cred = Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/beta/applications/$($bp.id)/addPassword" -Headers $h -Body $credBody -ContentType 'application/json'
Write-Host "  keyId: $($cred.keyId)"
Write-Host "  secretText: $($cred.secretText)"

# Save secret
$secretData = @{
    keyId = $cred.keyId
    secretText = $cred.secretText
    blueprintObjectId = $bp.id
    blueprintAppId = $bp.appId
} | ConvertTo-Json
$secretFile = Join-Path (Split-Path $PSScriptRoot) '.agent-id-blueprint-secret.json'
Set-Content -Path $secretFile -Value $secretData
Write-Host "  Saved to $secretFile"

# Step 3: Configure URI + scope
Write-Host "`n== Configuring URI + Scope =="
$scopeId = [guid]::NewGuid().ToString()
$patchBody = @{
    identifierUris = @("api://$($bp.appId)")
    api = @{
        oauth2PermissionScopes = @(@{
            adminConsentDescription = 'Allow access to agent'
            adminConsentDisplayName = 'Access Glyphor Agent'
            id = $scopeId
            isEnabled = $true
            type = 'User'
            value = 'access_agent'
        })
    }
} | ConvertTo-Json -Depth 10
Invoke-MgGraphRequest -Method PATCH -Uri "https://graph.microsoft.com/beta/applications/$($bp.id)" -Headers $h -Body $patchBody -ContentType 'application/json'
Write-Host "  URI + scope set (scopeId: $scopeId)"

# Step 4: Create BlueprintPrincipal
Write-Host "`n== Creating Blueprint Principal =="
$spBody = @{ appId = $bp.appId } | ConvertTo-Json
$sp = Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.com/beta/serviceprincipals/graph.agentIdentityBlueprintPrincipal' -Headers $h -Body $spBody -ContentType 'application/json'
Write-Host "  SP created: $($sp.id)"
Write-Host "  type: $($sp.servicePrincipalType)"

# Step 5: Get blueprint token via client_credentials
Write-Host "`n== Getting Blueprint Token =="
$tokenBody = "client_id=$($bp.appId)&scope=https://graph.microsoft.com/.default&client_secret=$([uri]::EscapeDataString($cred.secretText))&grant_type=client_credentials"
$tokenResp = Invoke-RestMethod -Uri "https://login.microsoftonline.com/19ab7456-f160-416d-a503-57298ab192a2/oauth2/v2.0/token" -Method POST -Body $tokenBody -ContentType 'application/x-www-form-urlencoded'
$bpToken = $tokenResp.access_token
Write-Host "  Token acquired (length: $($bpToken.Length))"

# Step 6: Create Agent Identities
Write-Host "`n== Creating Agent Identities =="
$agentFile = Join-Path (Split-Path $PSScriptRoot) 'packages' 'agent-runtime' 'src' 'config' 'agentIdentities.json'
$agents = Get-Content $agentFile -Raw | ConvertFrom-Json
$keys = $agents.PSObject.Properties.Name
Write-Host "  Agents to process: $($keys.Count)"

$bpHeaders = @{
    'Authorization' = "Bearer $bpToken"
    'Content-Type' = 'application/json'
    'OData-Version' = '4.0'
}
$sponsorUserId = '88a731d1-3171-4279-aee1-34160898ab90'
$created = 0; $existed = 0; $failed = 0
$results = @{}

foreach ($k in $keys) {
    $name = $agents.$k.displayName -replace '^Glyphor Agent - ',''
    $agentBody = @{
        displayName = $name
        agentIdentityBlueprintId = $bp.appId
        'sponsors@odata.bind' = @("https://graph.microsoft.com/v1.0/users/$sponsorUserId")
    } | ConvertTo-Json -Depth 5

    try {
        $r = Invoke-RestMethod -Uri 'https://graph.microsoft.com/beta/serviceprincipals/Microsoft.Graph.AgentIdentity' -Method POST -Body $agentBody -Headers $bpHeaders
        Write-Host "  + ${k}: $name -> $($r.id)"
        $results[$k] = @{ id = $r.id; name = $name }
        $created++
    } catch {
        $sc = 0
        if ($_.Exception.Response) { $sc = [int]$_.Exception.Response.StatusCode }
        if ($sc -eq 409) {
            Write-Host "  o ${k}: $name (already exists)"
            $existed++
        } else {
            $ed = $_.ErrorDetails.Message
            Write-Host "  x ${k}: $name - $sc $ed"
            $failed++
            if ($created -eq 0 -and $existed -eq 0 -and $failed -eq 1 -and $sc -eq 403) {
                Write-Host "  Permission denied on first attempt. Stopping."
                break
            }
        }
    }
    Start-Sleep -Milliseconds 300
}

Write-Host "`n== Results =="
Write-Host "  Created: $created  Existed: $existed  Failed: $failed"

if ($results.Count -gt 0) {
    $resultsFile = Join-Path (Split-Path $PSScriptRoot) '.agent-identities-created.json'
    $results | ConvertTo-Json -Depth 5 | Set-Content $resultsFile
    Write-Host "  Saved to $resultsFile"
}

# Save config update
Write-Host "`nNew Blueprint IDs to update in a365.config.json:"
Write-Host "  agentBlueprintId: $($bp.appId)"
Write-Host "  agentBlueprintObjectId: $($bp.id)"
Write-Host "  agentBlueprintServicePrincipalId: $($sp.id)"
Write-Host "`n== Done =="

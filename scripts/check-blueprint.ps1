Import-Module Microsoft.Graph.Authentication
Connect-MgGraph -Scopes 'Application.ReadWrite.All' -TenantId '19ab7456-f160-416d-a503-57298ab192a2' -NoWelcome

$r = Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/beta/applications/b47da287-6b05-4be3-9807-3f49047fbbb8' -Headers @{'OData-Version'='4.0'}
Write-Host "id: $($r.id)"
Write-Host "appId: $($r.appId)"
Write-Host "displayName: $($r.displayName)"
Write-Host "identifierUris: $($r.identifierUris -join ', ')"
Write-Host "creds: $($r.passwordCredentials.Count)"

# Also check the SP
$spFilter = "/servicePrincipals?`$filter=appId+eq+'$($r.appId)'&`$select=id,displayName,servicePrincipalType,appId"
$sp = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta$spFilter" -Headers @{'OData-Version'='4.0'}
foreach ($s in $sp.value) {
    Write-Host "SP: id=$($s.id) type=$($s.servicePrincipalType) appId=$($s.appId)"
}

# Try client_credentials token now (with delay for propagation)
Write-Host "`nTrying client_credentials token..."
$secret = (Get-Content '.agent-id-blueprint-secret.json' -Raw | ConvertFrom-Json).secretText
$appId = $r.appId
$tokenBody = "client_id=$appId&scope=https://graph.microsoft.com/.default&client_secret=$([uri]::EscapeDataString($secret))&grant_type=client_credentials"
try {
    $tokenResp = Invoke-RestMethod -Uri 'https://login.microsoftonline.com/19ab7456-f160-416d-a503-57298ab192a2/oauth2/v2.0/token' -Method POST -Body $tokenBody -ContentType 'application/x-www-form-urlencoded'
    Write-Host "Token acquired! Length: $($tokenResp.access_token.Length)"
} catch {
    Write-Host "Token failed: $($_.ErrorDetails.Message)"
}

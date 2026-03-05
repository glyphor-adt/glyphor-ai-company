Import-Module Microsoft.Graph.Authentication
Connect-MgGraph -Scopes 'Application.ReadWrite.All' -TenantId '19ab7456-f160-416d-a503-57298ab192a2' -NoWelcome

# Get blueprint token
$secretData = Get-Content '.agent-id-blueprint-secret.json' -Raw | ConvertFrom-Json
$appId = $secretData.blueprintAppId
$secret = $secretData.secretText
$tokenBody = "client_id=$appId&scope=https://graph.microsoft.com/.default&client_secret=$([uri]::EscapeDataString($secret))&grant_type=client_credentials"
$tokenResp = Invoke-RestMethod -Uri 'https://login.microsoftonline.com/19ab7456-f160-416d-a503-57298ab192a2/oauth2/v2.0/token' -Method POST -Body $tokenBody -ContentType 'application/x-www-form-urlencoded'
$bpToken = $tokenResp.access_token
Write-Host "Blueprint token acquired (length: $($bpToken.Length))"

# Load agents
$agents = Get-Content 'packages/agent-runtime/src/config/agentIdentities.json' -Raw | ConvertFrom-Json
$keys = $agents.PSObject.Properties.Name
Write-Host "Agents to process: $($keys.Count)"

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
        agentIdentityBlueprintId = $appId
        'sponsors@odata.bind' = @("https://graph.microsoft.com/v1.0/users/$sponsorUserId")
    } | ConvertTo-Json -Depth 5

    try {
        $r = Invoke-RestMethod -Uri 'https://graph.microsoft.com/beta/serviceprincipals/Microsoft.Graph.AgentIdentity' -Method POST -Body $agentBody -Headers $bpHeaders
        Write-Host "+ $k : $name -> $($r.id)"
        $results[$k] = @{ id = $r.id; name = $name }
        $created++
    } catch {
        $sc = 0
        if ($_.Exception.Response) { $sc = [int]$_.Exception.Response.StatusCode }
        if ($sc -eq 409) {
            Write-Host "o $k : $name (already exists)"
            $existed++
        } else {
            $errMsg = $_.ErrorDetails.Message
            Write-Host "x $k : $name - Status $sc"
            Write-Host "  $errMsg"
            $failed++
            if ($created -eq 0 -and $existed -eq 0 -and $failed -ge 2) {
                Write-Host "Multiple failures. Stopping."
                break
            }
        }
    }
    Start-Sleep -Milliseconds 300
}

Write-Host "`n== Results: Created=$created Existed=$existed Failed=$failed =="

if ($results.Count -gt 0) {
    $results | ConvertTo-Json -Depth 5 | Set-Content '.agent-identities-created.json'
    Write-Host "Saved to .agent-identities-created.json"
}

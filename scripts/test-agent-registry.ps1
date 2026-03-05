$token = (az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv)
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }
$blueprintId = "5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a"

# Test 1: GET existing agent instances
Write-Host "=== Test 1: GET /beta/agentRegistry/agentInstances ==="
try {
    $r = Invoke-WebRequest -Uri "https://graph.microsoft.com/beta/agentRegistry/agentInstances" -Headers @{"Authorization"="Bearer $token"} -UseBasicParsing
    Write-Host "OK $($r.StatusCode)"
    $instances = ($r.Content | ConvertFrom-Json).value
    Write-Host "Count: $($instances.Count)"
    foreach ($inst in $instances) {
        Write-Host "  $($inst.displayName) | blueprintId=$($inst.agentIdentityBlueprintId) | userId=$($inst.agentUserId) | identityId=$($inst.agentIdentityId)"
    }
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $errBody = $sr.ReadToEnd(); $sr.Close()
    Write-Host "Error $code`: $errBody"
}

# Test 2: POST a new agent instance for Adi Rose
Write-Host "`n=== Test 2: POST /beta/agentRegistry/agentInstances ==="
$body = @{
    displayName = "Adi Rose"
    agentIdentityBlueprintId = $blueprintId
    agentUserId = "f86cb35c-8eff-4ae3-ad71-313ae8c4f2a2"
} | ConvertTo-Json
try {
    $r = Invoke-WebRequest -Method POST -Uri "https://graph.microsoft.com/beta/agentRegistry/agentInstances" -Headers $headers -Body $body -UseBasicParsing
    Write-Host "OK $($r.StatusCode)"
    $created = $r.Content | ConvertFrom-Json
    Write-Host "Created: $($created | ConvertTo-Json -Depth 3)"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $errBody = $sr.ReadToEnd(); $sr.Close()
    Write-Host "Error $code`: $errBody"
}

Write-Host "`nDone."

$token = (az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv)
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }
$blueprintId = "5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a"

# Test 1: GET /beta/identity/agents - might need query params or different method
Write-Host "=== Test 1: GET /beta/identity/agents ==="
try {
    $r = Invoke-WebRequest -Uri "https://graph.microsoft.com/beta/identity/agents" -Headers @{ "Authorization" = "Bearer $token" } -UseBasicParsing
    Write-Host "OK $($r.StatusCode): $($r.Content.Substring(0, [Math]::Min(500, $r.Content.Length)))"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $body = $sr.ReadToEnd(); $sr.Close()
    Write-Host "Error $code`: $body"
}

# Test 2: POST to create an agent identity linking user to blueprint
Write-Host "`n=== Test 2: POST /beta/identity/agents with blueprint + user ==="
$payload = @{
    userId = "f86cb35c-8eff-4ae3-ad71-313ae8c4f2a2"
    blueprintId = $blueprintId
} | ConvertTo-Json
try {
    $r = Invoke-WebRequest -Method POST -Uri "https://graph.microsoft.com/beta/identity/agents" -Headers $headers -Body $payload -UseBasicParsing
    Write-Host "OK $($r.StatusCode): $($r.Content)"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $body = $sr.ReadToEnd(); $sr.Close()
    Write-Host "Error $code`: $body"
}

# Test 3: Try agentServiceManagement
Write-Host "`n=== Test 3: GET /beta/identity/agentServiceManagement ==="
try {
    $r = Invoke-WebRequest -Uri "https://graph.microsoft.com/beta/identity/agentServiceManagement" -Headers @{ "Authorization" = "Bearer $token" } -UseBasicParsing
    Write-Host "OK $($r.StatusCode): $($r.Content.Substring(0, [Math]::Min(500, $r.Content.Length)))"
} catch {
    Write-Host "Error $($_.Exception.Response.StatusCode.value__)"
}

# Test 4: Try /identity/agents/blueprints
Write-Host "`n=== Test 4: GET /beta/identity/agents/blueprints ==="
try {
    $r = Invoke-WebRequest -Uri "https://graph.microsoft.com/beta/identity/agents/blueprints" -Headers @{ "Authorization" = "Bearer $token" } -UseBasicParsing
    Write-Host "OK $($r.StatusCode): $($r.Content.Substring(0, [Math]::Min(500, $r.Content.Length)))"
} catch {
    Write-Host "Error $($_.Exception.Response.StatusCode.value__)"
}

# Test 5: Try applications/{blueprintId}/agentIdentities
Write-Host "`n=== Test 5: GET /beta/applications/$blueprintId ==="
try {
    $r = Invoke-WebRequest -Uri "https://graph.microsoft.com/beta/applications/${blueprintId}?`$select=displayName,tags,notes" -Headers @{ "Authorization" = "Bearer $token" } -UseBasicParsing
    $app = $r.Content | ConvertFrom-Json
    Write-Host "displayName: $($app.displayName)"
    Write-Host "tags: $($app.tags -join ',')"
    Write-Host "notes: $($app.notes)"
} catch {
    Write-Host "Error $($_.Exception.Response.StatusCode.value__)"
}

Write-Host "`nDone."

$token = (az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv)
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }
$blueprintId = "5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a"
$userId = "f86cb35c-8eff-4ae3-ad71-313ae8c4f2a2"

# Test 1: Check if a365/agentIdentities endpoint exists under the user
Write-Host "=== Test 1: /beta/users/{id}/agentIdentityBlueprint ==="
try {
    $r = Invoke-WebRequest -Uri "https://graph.microsoft.com/beta/users/$userId/agentIdentityBlueprint" -Headers $headers -UseBasicParsing
    Write-Host "OK: $($r.Content)"
} catch {
    Write-Host "Error $($_.Exception.Response.StatusCode.value__)"
}

# Test 2: Try $ref approach (like setting manager)
Write-Host "`n=== Test 2: PUT /beta/users/{id}/agentIdentityBlueprint/`$ref ==="
try {
    $refBody = "{`"`@odata.id`":`"https://graph.microsoft.com/beta/applications/$blueprintId`"}"
    $r = Invoke-WebRequest -Method PUT -Uri "https://graph.microsoft.com/beta/users/$userId/agentIdentityBlueprint/`$ref" -Headers $headers -Body $refBody -UseBasicParsing
    Write-Host "OK: $($r.StatusCode)"
} catch {
    Write-Host "Error $($_.Exception.Response.StatusCode.value__)"
}

# Test 3: Check Graph v1.0 for different property set
Write-Host "`n=== Test 3: /v1.0 user properties with agent ==="
try {
    $r = Invoke-WebRequest -Uri "https://graph.microsoft.com/v1.0/users/${userId}?`$select=displayName,isResourceAccount" -Headers $headers -UseBasicParsing
    $u = $r.Content | ConvertFrom-Json
    Write-Host "isResourceAccount: $($u.isResourceAccount)"
} catch {
    Write-Host "Error $($_.Exception.Response.StatusCode.value__)"
}

# Test 4: Try the custom security attributes approach
Write-Host "`n=== Test 4: Custom security attribute sets ==="
try {
    $r = Invoke-WebRequest -Uri "https://graph.microsoft.com/beta/directory/customSecurityAttributeDefinitions" -Headers $headers -UseBasicParsing
    $attrs = ($r.Content | ConvertFrom-Json).value
    foreach ($a in $attrs) { Write-Host "  $($a.id): $($a.description)" }
    if ($attrs.Count -eq 0) { Write-Host "  (none defined)" }
} catch {
    Write-Host "Error $($_.Exception.Response.StatusCode.value__)"
}

# Test 5: Try creating an agent identity via POST to a dedicated endpoint
Write-Host "`n=== Test 5: POST /beta/identity/agents ==="
try {
    $r = Invoke-WebRequest -Uri "https://graph.microsoft.com/beta/identity/agents" -Headers $headers -UseBasicParsing
    Write-Host "OK: $($r.Content)"
} catch {
    Write-Host "Error $($_.Exception.Response.StatusCode.value__)"
}

Write-Host "`nDone."

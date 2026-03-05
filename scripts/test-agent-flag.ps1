$token = (az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv)
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }
$userId = "f86cb35c-8eff-4ae3-ad71-313ae8c4f2a2"
$blueprintId = "5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a"

Write-Host "=== Test 1: PATCH identityParentId ==="
try {
    $r = Invoke-WebRequest -Method PATCH -Uri "https://graph.microsoft.com/beta/users/$userId" -Headers $headers -Body "{`"identityParentId`":`"$blueprintId`"}" -UseBasicParsing
    Write-Host "Status: $($r.StatusCode)"
    $u = $r.Content | ConvertFrom-Json
    Write-Host "identityParentId: $($u.identityParentId)"
    Write-Host "agentIdentityBlueprintId: $($u.agentIdentityBlueprintId)"
} catch {
    Write-Host "Error: $($_.Exception.Response.StatusCode.value__)"
    $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    Write-Host $sr.ReadToEnd()
    $sr.Close()
}

Write-Host ""
Write-Host "=== Test 2: Verify user properties ==="
$r2 = Invoke-WebRequest -Uri "https://graph.microsoft.com/beta/users/${userId}?`$select=displayName,identityParentId,agentIdentityBlueprintId" -Headers $headers -UseBasicParsing
$u2 = $r2.Content | ConvertFrom-Json
Write-Host "displayName: $($u2.displayName)"
Write-Host "identityParentId: '$($u2.identityParentId)'"
Write-Host "agentIdentityBlueprintId: '$($u2.agentIdentityBlueprintId)'"

$ErrorActionPreference = 'Stop'
$token = (az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv 2>$null)
$h = @{"Authorization"="Bearer $token";"Content-Type"="application/json"}
$pwd = "TmpA!$(Get-Random -Max 999999)"

$bodyObj = @{
    accountEnabled = $false
    displayName = "Test Agent XYZ"
    mailNickname = "testagentxyz"
    userPrincipalName = "testagentxyz@glyphorai.onmicrosoft.com"
    passwordProfile = @{ forceChangePasswordNextSignIn = $true; password = $pwd }
    agentIdentityBlueprintId = "5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a"
}
$body = $bodyObj | ConvertTo-Json -Depth 3

Write-Host "Creating test user..."
try {
    $r = Invoke-WebRequest -Method POST -Uri "https://graph.microsoft.com/beta/users" -Headers $h -Body $body -UseBasicParsing
    Write-Host "SUCCESS: Status $($r.StatusCode)"
    $u = $r.Content | ConvertFrom-Json
    Write-Host "  id: $($u.id)"
    Write-Host "  agentIdentityBlueprintId: '$($u.agentIdentityBlueprintId)'"
    
    # Clean up
    Write-Host "Deleting test user..."
    Invoke-WebRequest -Method DELETE -Uri "https://graph.microsoft.com/beta/users/$($u.id)" -Headers @{"Authorization"="Bearer $token"} -UseBasicParsing | Out-Null
    Write-Host "Cleaned up."
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $stream = $_.Exception.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $errBody = $reader.ReadToEnd()
    $reader.Close()
    Write-Host "ERROR $code"
    Write-Host $errBody
}

# Enable all active Agent Identity SPs using az rest
$ids = Get-Content "$PSScriptRoot/agent-identity-real-ids.json" | ConvertFrom-Json
$enabled = 0; $skipped = 0; $failed = 0
$body = '{"accountEnabled":true}'

foreach ($prop in $ids.PSObject.Properties) {
    $spId = $prop.Value
    $name = $prop.Name
    
    # Check current status
    $raw = az rest --method GET --url "https://graph.microsoft.com/beta/servicePrincipals/$spId`?`$select=accountEnabled,displayName" 2>&1
    $sp = $raw | ConvertFrom-Json -ErrorAction SilentlyContinue
    
    if ($sp.accountEnabled -eq $true) {
        $skipped++
        Write-Host "SKIP: $name (already enabled)"
        continue
    }
    
    # Enable via PATCH
    $null = az rest --method PATCH --url "https://graph.microsoft.com/beta/servicePrincipals/$spId" --body $body --headers "Content-Type=application/json" 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        $enabled++
        Write-Host "ENABLED: $name"
    } else {
        $failed++
        Write-Host "FAIL: $name"
    }
}

Write-Host ""
Write-Host "=== DONE ==="
Write-Host "Enabled: $enabled"
Write-Host "Skipped: $skipped"
Write-Host "Failed: $failed"

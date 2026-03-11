Set-MgGraphOption -DisableLoginByWAM $true
Connect-MgGraph -TenantId "19ab7456-f160-416d-a503-57298ab192a2" -Scopes "Application.ReadWrite.All" -UseDeviceAuthentication -NoWelcome

$body = @{
    "@odata.id" = "https://graph.microsoft.com/beta/directoryObjects/88a731d1-3171-4279-aee1-34160898ab90"
}

Write-Host "Adding owner to blueprint app b47da287-6b05-4be3-9807-3f49047fbbb8..." -ForegroundColor Yellow
try {
    Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/beta/applications/b47da287-6b05-4be3-9807-3f49047fbbb8/owners/`$ref" -Body $body
    Write-Host "SUCCESS: Owner added!" -ForegroundColor Green
} catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "Verifying owners..." -ForegroundColor Yellow
$owners = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta/applications/b47da287-6b05-4be3-9807-3f49047fbbb8/owners"
$owners.value | ForEach-Object { Write-Host "  Owner: $($_.displayName) ($($_.id))" }

Disconnect-MgGraph
Write-Host ""
Write-Host "Done! Go back to Teams Developer Portal and try saving again." -ForegroundColor Green
Write-Host "Press Enter to close..." -ForegroundColor Cyan
Read-Host

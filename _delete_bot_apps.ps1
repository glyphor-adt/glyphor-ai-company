# Get all 42 bot appIds from original file + find the original bot app
$bots = Get-Content _agent_bots_current.json | ConvertFrom-Json
$appIds = $bots | ForEach-Object { $_.appId }

# Also check for the original "Glyphor Teams Bot" app
$origApp = az ad app list --display-name "Glyphor Teams Bot" --query "[].appId" -o tsv 2>$null
if ($origApp) {
  $appIds += $origApp.Trim()
}

Write-Host "Found $($appIds.Count) bot app registrations to delete"

$ok = 0; $fail = 0
foreach ($appId in $appIds) {
  $id = $appId.Trim()
  if (-not $id) { continue }
  Write-Host "Deleting app $id ..." -NoNewline
  az ad app delete --id $id 2>$null
  if ($LASTEXITCODE -eq 0) { $ok++; Write-Host " OK" } else { $fail++; Write-Host " FAIL" }
}
Write-Host "`nDone. OK=$ok FAIL=$fail"

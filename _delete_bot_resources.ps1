$bots = az resource list --resource-group glyphor-resources --resource-type "Microsoft.BotService/botServices" --query "[].name" -o tsv 2>$null
$botList = $bots -split "`n" | Where-Object { $_.Trim() }
Write-Host "Found $($botList.Count) bot resources to delete"

$ok = 0; $fail = 0
foreach ($name in $botList) {
  $n = $name.Trim()
  if (-not $n) { continue }
  Write-Host "Deleting $n ..." -NoNewline
  az resource delete --resource-group glyphor-resources --resource-type "Microsoft.BotService/botServices" --name $n 2>$null
  if ($LASTEXITCODE -eq 0) { $ok++; Write-Host " OK" } else { $fail++; Write-Host " FAIL" }
}
Write-Host "`nDone. OK=$ok FAIL=$fail"

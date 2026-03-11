$keepApps = @('Glyphor AI', 'Glyphor Agent Blueprint')
$apps = Get-TeamsApp -DistributionMethod organization | Where-Object { $_.DisplayName -notin $keepApps }
Write-Host "Deleting $($apps.Count) bot apps from Teams catalog (keeping: $($keepApps -join ', '))"

$ok = 0; $fail = 0
foreach ($app in $apps) {
  Write-Host "Removing $($app.DisplayName) ($($app.Id)) ..." -NoNewline
  try {
    Remove-TeamsApp -Id $app.Id -ErrorAction Stop
    $ok++; Write-Host " OK"
  } catch {
    $fail++; Write-Host " FAIL: $_"
  }
}
Write-Host "`nDone. OK=$ok FAIL=$fail"

$headers = @{ Authorization = "Bearer $($env:GRAPH_TOKEN)" }
$emails = @(
  "sarah","marcus","elena","maya","nadia","victoria","james","rachel",
  "mia","alex","sam","jordan","priya","daniel","anna","omar",
  "tyler","lisa","kai","emma","david","nathan","riley","leo",
  "ava","sofia","ryan","atlas","morgan","jasmine","sophia","lena",
  "dokafor","kain","amara","ethan","bob","grace","mariana","derek",
  "zara","riya","marcus.c","adi"
)
$missing = @()
$ok = @()
foreach($e in $emails) {
  $full = "$e@glyphor.ai"
  try {
    $r = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/users/$full`?`$select=displayName,mail,userPrincipalName" -Headers $headers -ErrorAction Stop
    $ok += "$full  ($($r.displayName))"
  } catch {
    $missing += $full
  }
}
Write-Host "=== EXISTING ($($ok.Count)) ==="
foreach($x in $ok) { Write-Host "  OK: $x" }
Write-Host ""
Write-Host "=== MISSING ($($missing.Count)) ==="
foreach($x in $missing) { Write-Host "  MISSING: $x" }

$upns = @(
  'amara@glyphor.ai',
  'david@glyphor.ai',
  'derek@glyphor.ai',
  'emma@glyphor.ai',
  'ethan@glyphor.ai',
  'grace@glyphor.ai',
  'kain@glyphor.ai',
  'marcusc@glyphor.ai',
  'mariana@glyphor.ai',
  'nathan@glyphor.ai'
)

$ok = 0; $fail = 0
foreach ($upn in $upns) {
  az ad user delete --id $upn 2>$null
  if ($LASTEXITCODE -eq 0) { $ok++; Write-Host "OK: $upn" } else { $fail++; Write-Host "FAIL: $upn" }
}
Write-Host "Done. OK=$ok FAIL=$fail"

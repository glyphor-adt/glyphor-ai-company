$ids = @(
  'a5f564eb-a812-4642-8535-398d5934dfd7',
  '9ec2442a-30e6-4738-947a-70fe279ef15a',
  '8fe67e28-3073-48b0-aa5b-3c69feb587a9',
  '8c8b4597-288e-486f-a7c6-5bdfdb28c976',
  '49bd5253-93fb-4a1d-9960-cdf5c1fa073d',
  '55716a44-d8e4-4448-a05f-06ecb70145da',
  '482b5231-f5e2-476f-95fc-0d6336b95adf',
  '85fb3934-911a-4133-a430-2941ec183bee',
  '657dc09d-6b73-4ba1-be33-8bd6ae392be7',
  '55c22fa8-1fdc-43a2-b1bf-2789c56144d8',
  'c9145652-24d2-45f4-8202-a2f6341dfd35',
  '27051d6c-9673-4a0d-8adb-34364871b4f5',
  '908866ae-f633-4e89-9fd1-f8639a81c668'
)

$ok = 0; $fail = 0
foreach ($id in $ids) {
  az rest --method DELETE --url "https://graph.microsoft.com/beta/servicePrincipals/$id" 2>$null
  if ($LASTEXITCODE -eq 0) { $ok++ } else { $fail++; Write-Host "FAIL: $id" }
}
Write-Host "Done. OK=$ok FAIL=$fail"

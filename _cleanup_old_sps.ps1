$ids = @(
  'b84917d5-44c9-473d-bf6a-5f6d0845b7e7',
  '5c2d9386-ff1f-4682-b778-ca407dece273',
  'cfb2db61-d040-4a2c-8f99-c71f07167fac',
  '91802f6b-e2e3-458d-87e3-e6580de9b8e3',
  '7021ad63-c158-43b1-b2b3-e413b453a0c7',
  '63aa1813-eff8-4ed3-8b72-f5aa61471406',
  '6a7fad64-7634-4492-935d-525a1cee076e',
  'c3a2d2d4-9360-4311-90dc-607d64f3e9d3',
  '4989f327-1fc8-4f90-a56a-3fa8e4a1d3b5',
  'ec79451c-4c23-4148-a177-a31ad9192642',
  'fd7c6ca8-c438-483e-8cce-b7dad91a994f',
  '0d4b0680-36ae-488e-91cc-29d349a80192',
  '385f20d0-ea15-4323-9ef0-769c15c67065',
  '7d222283-c4c3-449d-abb6-3ba3f9179efb',
  'c56631c6-65ff-42fd-ab1e-c32624c3b47e',
  '2c46e6db-5296-4ba8-9265-ca2806769040',
  '61683830-321d-47b0-89f2-404d94e56929',
  '8232b4e4-1aa6-4ddd-9172-4b3c5565e432',
  '10705a18-f6df-4bec-947c-d76f222c2a05',
  '6366c2ec-3a41-46c6-8a94-bc9367c0fabf',
  '1a582429-ab83-42da-b34e-fe43f9c0bffb',
  'b95d776a-19c5-46a3-afcb-c0899da531e2',
  '20ad3545-c2a7-4448-857a-09ec83a2838c',
  '3d012799-cc13-4c42-a6f0-4771aa2a96b0',
  '330b2c3f-3c87-4fd2-babf-8fc3970f3794',
  'c77e6d78-7e4f-4020-926d-424dcf74ba8f',
  'fe8379cf-70c1-4897-b9e0-4d7dd7990c87',
  '58365116-ae46-490c-af29-38638a51ab8e',
  '13e67cdd-9715-4a10-a8bb-8585644a829f',
  '66c2b0e9-5a8c-4065-ad56-dadfe0d0bad5',
  '6b591c9a-cf6a-4979-8835-a92cd43ab85d',
  '3ecb0671-b1a9-459b-ba6e-3a7680d76749',
  '535fed90-6eef-456c-af13-bb2fabac98c4',
  '024d13af-f2e0-454e-8551-b53631c31fc7',
  '36818357-1854-435e-b203-94151b4a8a30',
  'c96f3821-c7cd-4654-9968-3c4b1a1a501f',
  '673855a3-1032-492d-9a49-9b564a31d3ee',
  'f0fe9459-2685-446d-812f-1b0bd6b09239',
  'a1b84f92-491e-449e-b21d-12368d6b5968',
  '915bfec2-5277-4c75-ab52-9e62699a63a1',
  'f8674dd8-d530-48a2-9863-041e7c4d17d0'
)

$ok = 0; $fail = 0
foreach ($id in $ids) {
  az rest --method DELETE --url "https://graph.microsoft.com/beta/servicePrincipals/$id" 2>$null
  if ($LASTEXITCODE -eq 0) { $ok++ } else { $fail++; Write-Host "FAIL: $id" }
  Write-Host "$($ok + $fail)/$($ids.Count)..."
}
Write-Host "`nDone. OK=$ok FAIL=$fail"

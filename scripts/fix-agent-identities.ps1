#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Fix agent identity linkage: re-link all 44 agent users' identityParentId 
  from the WRONG blueprint (b47da287) to the CORRECT blueprint (5604df3b),
  then delete the 44 duplicate Agent Identity SPs.

.DESCRIPTION
  AUDIT FINDINGS:
    - 42 users have identityParentId pointing to DELETE set (blueprint b47da287)
    - 2 users (Morgan Blake, Riley Morgan) have NO identityParentId
    - 0 users point to the KEEP set (blueprint 5604df3b)
    - M365 MCP permissions are assigned to KEEP set SPs
    - All 44 agents ARE licensed (Agent 365 Tier 3: 44/50)

  FIX ACTIONS:
    Phase 1: PATCH each user's identityParentId to their KEEP set SP
    Phase 2: DELETE the 44 duplicate SPs from the b47da287 blueprint

.PARAMETER DryRun
  Show what would change without making any modifications (default).

.PARAMETER Execute
  Actually perform the re-link and deletion.

.PARAMETER SkipDelete
  Re-link users but do NOT delete the duplicate SPs.

.EXAMPLE
  .\fix-agent-identities.ps1                     # Dry run
  .\fix-agent-identities.ps1 -Execute            # Execute all fixes
  .\fix-agent-identities.ps1 -Execute -SkipDelete # Re-link only
#>

param(
    [switch]$Execute,
    [switch]$SkipDelete
)

$ErrorActionPreference = 'Stop'
$TenantId = '19ab7456-f160-416d-a503-57298ab192a2'

# ─── KEEP set: Agent Identity SPs under blueprint 5604df3b ──────
# These have M365 MCP permissions already assigned
$keepMap = @{
    'chief-of-staff'              = '83fc2283-a1b9-4b71-bdb9-04a91bee6596'
    'cto'                         = '0d4b0680-36ae-488e-91cc-29d349a80192'
    'cfo'                         = 'fd7c6ca8-c438-483e-8cce-b7dad91a994f'
    'cpo'                         = 'c56631c6-65ff-42fd-ab1e-c32624c3b47e'
    'cmo'                         = 'd176b833-b68a-4674-b712-7b7d90ad3978'
    'clo'                         = 'd6baf6b8-b60e-423a-b30f-0f7382828107'
    'vp-customer-success'         = '7d222283-c4c3-449d-abb6-3ba3f9179efb'
    'vp-sales'                    = 'b84917d5-44c9-473d-bf6a-5f6d0845b7e7'
    'vp-design'                   = '385f20d0-ea15-4323-9ef0-769c15c67065'
    'platform-engineer'           = '5c2d9386-ff1f-4682-b778-ca407dece273'
    'quality-engineer'            = 'cfb2db61-d040-4a2c-8f99-c71f07167fac'
    'devops-engineer'             = '63aa1813-eff8-4ed3-8b72-f5aa61471406'
    'm365-admin'                  = 'ec79451c-4c23-4148-a177-a31ad9192642'
    'user-researcher'             = '7021ad63-c158-43b1-b2b3-e413b453a0c7'
    'competitive-intel'           = '91802f6b-e2e3-458d-87e3-e6580de9b8e3'
    'revenue-analyst'             = 'c3a2d2d4-9360-4311-90dc-607d64f3e9d3'
    'cost-analyst'                = '6a7fad64-7634-4492-935d-525a1cee076e'
    'content-creator'             = '6366c2ec-3a41-46c6-8a94-bc9367c0fabf'
    'seo-analyst'                 = '4989f327-1fc8-4f90-a56a-3fa8e4a1d3b5'
    'social-media-manager'        = '1a582429-ab83-42da-b34e-fe43f9c0bffb'
    'onboarding-specialist'       = 'b95d776a-19c5-46a3-afcb-c0899da531e2'
    'support-triage'              = '330b2c3f-3c87-4fd2-babf-8fc3970f3794'
    'account-research'            = '2c46e6db-5296-4ba8-9265-ca2806769040'
    'ui-ux-designer'              = '61683830-321d-47b0-89f2-404d94e56929'
    'frontend-engineer'           = '8232b4e4-1aa6-4ddd-9172-4b3c5565e432'
    'design-critic'               = '10705a18-f6df-4bec-947c-d76f222c2a05'
    'template-architect'          = '3d012799-cc13-4c42-a6f0-4771aa2a96b0'
    'ops'                         = '20ad3545-c2a7-4448-857a-09ec83a2838c'
    'global-admin'                = 'c77e6d78-7e4f-4020-926d-424dcf74ba8f'
    'head-of-hr'                  = '66c2b0e9-5a8c-4065-ad56-dadfe0d0bad5'
    'vp-research'                 = 'fe8379cf-70c1-4897-b9e0-4d7dd7990c87'
    'competitive-research-analyst'= '024d13af-f2e0-454e-8551-b53631c31fc7'
    'market-research-analyst'     = '13e67cdd-9715-4a10-a8bb-8585644a829f'
    'technical-research-analyst'  = '58365116-ae46-490c-af29-38638a51ab8e'
    'industry-research-analyst'   = 'a1b84f92-491e-449e-b21d-12368d6b5968'
    'ai-impact-analyst'           = '673855a3-1032-492d-9a49-9b564a31d3ee'
    'org-analyst'                 = '915bfec2-5277-4c75-ab52-9e62699a63a1'
    'enterprise-account-researcher'= '535fed90-6eef-456c-af13-bb2fabac98c4'
    'bob-the-tax-pro'             = '6b591c9a-cf6a-4979-8835-a92cd43ab85d'
    'data-integrity-auditor'      = '3ecb0671-b1a9-459b-ba6e-3a7680d76749'
    'tax-strategy-specialist'     = 'c96f3821-c7cd-4654-9968-3c4b1a1a501f'
    'lead-gen-specialist'         = '36818357-1854-435e-b203-94151b4a8a30'
    'marketing-intelligence-analyst'= 'f0fe9459-2685-446d-812f-1b0bd6b09239'
    'adi-rose'                    = 'f8674dd8-d530-48a2-9863-041e7c4d17d0'
}

# ─── UPN → role key mapping ─────────────────────────────────────
$upnToKey = @{
    'sarah@glyphor.ai'    = 'chief-of-staff'
    'marcus@glyphor.ai'   = 'cto'
    'nadia@glyphor.ai'    = 'cfo'
    'elena@glyphor.ai'    = 'cpo'
    'maya@glyphor.ai'     = 'cmo'
    'victoria@glyphor.ai' = 'clo'
    'james@glyphor.ai'    = 'vp-customer-success'
    'rachel@glyphor.ai'   = 'vp-sales'
    'mia@glyphor.ai'      = 'vp-design'
    'alex@glyphor.ai'     = 'platform-engineer'
    'sam@glyphor.ai'      = 'quality-engineer'
    'jordan@glyphor.ai'   = 'devops-engineer'
    'riley@glyphor.ai'    = 'm365-admin'
    'priya@glyphor.ai'    = 'user-researcher'
    'daniel@glyphor.ai'   = 'competitive-intel'
    'anna@glyphor.ai'     = 'revenue-analyst'
    'omar@glyphor.ai'     = 'cost-analyst'
    'tyler@glyphor.ai'    = 'content-creator'
    'lisa@glyphor.ai'     = 'seo-analyst'
    'kai@glyphor.ai'      = 'social-media-manager'
    'emma@glyphor.ai'     = 'onboarding-specialist'
    'david@glyphor.ai'    = 'support-triage'
    'nathan@glyphor.ai'   = 'account-research'
    'leo@glyphor.ai'      = 'ui-ux-designer'
    'ava@glyphor.ai'      = 'frontend-engineer'
    'sofia@glyphor.ai'    = 'design-critic'
    'ryan@glyphor.ai'     = 'template-architect'
    'atlas@glyphor.ai'    = 'ops'
    'morgan@glyphor.ai'   = 'global-admin'
    'jasmine@glyphor.ai'  = 'head-of-hr'
    'sophia@glyphor.ai'   = 'vp-research'
    'lena@glyphor.ai'     = 'competitive-research-analyst'
    'dokafor@glyphor.ai'  = 'market-research-analyst'
    'kain@glyphor.ai'     = 'technical-research-analyst'
    'amara@glyphor.ai'    = 'industry-research-analyst'
    'riya@glyphor.ai'     = 'ai-impact-analyst'
    'marcusc@glyphor.ai'  = 'org-analyst'
    'ethan@glyphor.ai'    = 'enterprise-account-researcher'
    'bob@glyphor.ai'      = 'bob-the-tax-pro'
    'grace@glyphor.ai'    = 'data-integrity-auditor'
    'mariana@glyphor.ai'  = 'tax-strategy-specialist'
    'derek@glyphor.ai'    = 'lead-gen-specialist'
    'zara@glyphor.ai'     = 'marketing-intelligence-analyst'
    'adi@glyphor.ai'      = 'adi-rose'
}

# ─── DELETE set: 44 Agent Identity SPs from blueprint b47da287 ──
# Fallback list — Phase 2 prefers loading from agent-identity-real-ids.json
$deleteSpIds = @(
    '8147358d-2192-4e61-a341-a162e5c809fe'  # chief-of-staff
    '4d5f95e3-61ad-4885-bef0-12f0e89f6094'  # cto
    '4a659eb1-8384-4cd0-8927-3fccd26fa60c'  # cfo
    'b35fb46e-d3a6-47c0-94e9-ab3fd18986b3'  # cpo
    'eaed3545-a12a-41c4-8bc6-a4875bccbd2d'  # cmo
    'd33570ea-4386-414b-bebf-a95950337455'  # clo
    '7c028b1a-ff03-44f8-9a4a-76386b183531'  # content-creator
    'a5f564eb-a812-4642-8535-398d5934dfd7'  # vp-customer-success
    '6653e6d6-a1b7-4bd5-9972-485edd5a4b75'  # vp-sales
    '3e801a11-ab13-450f-b121-46727598d3d4'  # vp-design
    'da0ffbba-b3b9-40d7-82ef-e359b954f1b8'  # platform-engineer
    '195bc0fb-0d7f-4d7f-bd30-abe2cf210975'  # quality-engineer
    'c9731e05-bd52-4219-9e45-9b49a5ebb331'  # devops-engineer
    'c262efa0-9811-401f-bd8a-1cdddacb2b5c'  # m365-admin
    '92e020d7-c1ef-4414-b7e5-9e9a0910bc5b'  # user-researcher
    '6cb0e8d2-8273-4f42-910f-1d1afd7ff038'  # competitive-intel
    '8fe67e28-3073-48b0-aa5b-3c69feb587a9'  # revenue-analyst
    '9ec2442a-30e6-4738-947a-70fe279ef15a'  # cost-analyst
    '7a0830a2-233e-4ae3-a7e6-11cde86a89fd'  # seo-analyst
    '26911c30-db45-4210-908d-2fa6c5c75cdb'  # social-media-manager
    '8c8b4597-288e-486f-a7c6-5bdfdb28c976'  # onboarding-specialist
    '55716a44-d8e4-4448-a05f-06ecb70145da'  # support-triage
    '49bd5253-93fb-4a1d-9960-cdf5c1fa073d'  # account-research
    '67ab7e51-2315-4ff3-8e86-2cc3f8d9ef9c'  # ui-ux-designer
    'a4785b64-b70e-416d-b658-f2aff1228d54'  # frontend-engineer
    '19bd8970-40c2-4bde-9194-53b591cab396'  # design-critic
    '2e92b3ba-794d-427c-adcc-e72e49bba9f5'  # template-architect
    'e8c7a446-3c85-44be-8d0f-dcb716b91db3'  # ops
    '58c67a12-5c9b-47b7-98bf-4c334116946e'  # global-admin
    '006c3343-93ff-45af-937e-860068094526'  # head-of-hr
    '53a1fea2-3d82-4b5c-824b-80979780972f'  # vp-research
    '691a7572-5c8d-49ca-bbbf-4d37f8ac9754'  # competitive-research-analyst
    '34e09de7-e8e0-4578-8f12-f919d5972ccc'  # market-research-analyst
    '55c22fa8-1fdc-43a2-b1bf-2789c56144d8'  # technical-research-analyst
    '27051d6c-9673-4a0d-8adb-34364871b4f5'  # industry-research-analyst
    '55e71340-0965-4f16-8df2-4bdf89513ab8'  # ai-impact-analyst
    '908866ae-f633-4e89-9fd1-f8639a81c668'  # org-analyst
    '85fb3934-911a-4133-a430-2941ec183bee'  # enterprise-account-researcher
    '3eca72b5-1cfd-47e1-b01d-3d09fb9d12fb'  # bob-the-tax-pro
    '657dc09d-6b73-4ba1-be33-8bd6ae392be7'  # data-integrity-auditor
    'c9145652-24d2-45f4-8202-a2f6341dfd35'  # tax-strategy-specialist
    '482b5231-f5e2-476f-95fc-0d6336b95adf'  # lead-gen-specialist
    'f7a45fd1-b445-4b12-9f86-f1cdcc412d4c'  # marketing-intelligence-analyst
    'bacefc43-ef26-4bef-bbf8-ccd495ce0588'  # adi-rose
)

# ─── Protected UPNs (human users) ───────────────────────────────
$ProtectedUpns = @(
    'kristina@glyphor.ai',
    'andrew@glyphor.ai',
    'andrew.zwelling_gmail.com#EXT#@glyphorai.onmicrosoft.com'
)

function Log { param([string]$m); Write-Host "$(Get-Date -Format 'HH:mm:ss') $m" }

# ═════════════════════════════════════════════════════════════════
# CONNECT
# ═════════════════════════════════════════════════════════════════
Log '═══ Agent Identity Fix Script ═══'
if ($Execute) { Log 'MODE: EXECUTE (changes WILL be made)' }
else          { Log 'MODE: DRY RUN (no changes)' }
Log ''

Log 'Connecting to Microsoft Graph...'
Disconnect-MgGraph -ErrorAction SilentlyContinue
Connect-MgGraph -Scopes 'User.ReadWrite.All','Directory.ReadWrite.All','Application.ReadWrite.All' `
    -TenantId $TenantId -NoWelcome -ContextScope Process
$ctx = Get-MgContext
if (-not $ctx) { Write-Error 'Failed to connect'; exit 1 }
Log "  Connected as $($ctx.Account)"

# ═════════════════════════════════════════════════════════════════
# PHASE 1: Re-link identityParentId
# ═════════════════════════════════════════════════════════════════
Log ''
Log '═══ PHASE 1: Re-link identityParentId to KEEP set (5604df3b) ═══'

# Get all tenant users
$allUsers = @()
$uri = "https://graph.microsoft.com/beta/users?`$select=id,displayName,userPrincipalName,identityParentId&`$top=100&`$count=true"
$page = Invoke-MgGraphRequest -Method GET -Uri $uri -Headers @{"ConsistencyLevel"="eventual"}
$allUsers += $page.value
while ($page.'@odata.nextLink') {
    $page = Invoke-MgGraphRequest -Method GET -Uri $page.'@odata.nextLink' -Headers @{"ConsistencyLevel"="eventual"}
    $allUsers += $page.value
}
$agentUsers = $allUsers | Where-Object { 
    $_.userPrincipalName -like '*@glyphor.ai' -and 
    $_.userPrincipalName -notin $ProtectedUpns 
}
Log "  Found $($agentUsers.Count) agent users"

$relinked = 0; $alreadyCorrect = 0; $failed = 0

foreach ($u in $agentUsers) {
    $upn = $u.userPrincipalName.ToLower()
    $key = $upnToKey[$upn]
    if (-not $key) {
        Log "  SKIP (no mapping): $upn"
        continue
    }
    
    $correctSpId = $keepMap[$key]
    if (-not $correctSpId) {
        Log "  SKIP (no keep ID): $upn / $key"
        continue
    }
    
    $currentParent = $u.identityParentId
    if ($currentParent -eq $correctSpId) {
        $alreadyCorrect++
        Log "  OK   $($u.displayName) - already correct"
        continue
    }
    
    $oldTag = if ($currentParent) { $currentParent.Substring(0,8) } else { 'NONE' }
    Log "  FIX  $($u.displayName): $oldTag -> $($correctSpId.Substring(0,8))"
    
    if ($Execute) {
        try {
            $body = @{ identityParentId = $correctSpId } | ConvertTo-Json
            Invoke-MgGraphRequest -Method PATCH `
                -Uri "https://graph.microsoft.com/beta/users/$($u.id)" `
                -Body $body -ContentType 'application/json'
            $relinked++
            Start-Sleep -Milliseconds 200
        }
        catch {
            $failed++
            Log "  FAIL $($u.displayName): $_"
        }
    }
    else {
        $relinked++
    }
}

Log ''
Log "  Phase 1 Summary: Re-linked=$relinked AlreadyCorrect=$alreadyCorrect Failed=$failed"

# ═════════════════════════════════════════════════════════════════
# PHASE 2: Delete duplicate SPs (blueprint b47da287)
# ═════════════════════════════════════════════════════════════════
if (-not $SkipDelete) {
    Log ''
    Log '═══ PHASE 2: Delete 44 duplicate Agent Identity SPs (b47da287) ═══'
    
    # Load actual IDs from the file to be precise
    $realIdsFile = Join-Path $PSScriptRoot 'agent-identity-real-ids.json'
    if (Test-Path $realIdsFile) {
        $realIds = Get-Content $realIdsFile -Raw | ConvertFrom-Json
        $deleteFromFile = @()
        $realIds.PSObject.Properties | ForEach-Object { $deleteFromFile += $_.Value }
        Log "  Loaded $($deleteFromFile.Count) SP IDs from agent-identity-real-ids.json"
    }
    else {
        $deleteFromFile = $deleteSpIds
        Log "  Using hardcoded SP IDs ($($deleteFromFile.Count))"
    }
    
    $deleted = 0; $notFound = 0; $deleteFailed = 0
    
    foreach ($spId in $deleteFromFile) {
        if ($Execute) {
            try {
                Invoke-MgGraphRequest -Method DELETE `
                    -Uri "https://graph.microsoft.com/beta/servicePrincipals/$spId"
                $deleted++
                if ($deleted % 10 -eq 0) { Log "  ... deleted $deleted / $($deleteFromFile.Count)" }
                Start-Sleep -Milliseconds 200
            }
            catch {
                if ($_.Exception.Message -match '404|NotFound') {
                    $notFound++
                }
                else {
                    $deleteFailed++
                    Log "  FAIL delete $($spId.Substring(0,8)): $_"
                }
            }
        }
        else {
            $deleted++
        }
    }
    
    Log ''
    Log "  Phase 2 Summary: Deleted=$deleted NotFound=$notFound Failed=$deleteFailed"
}
else {
    Log ''
    Log '═══ PHASE 2: SKIPPED (--SkipDelete) ═══'
}

# ═════════════════════════════════════════════════════════════════
# PHASE 3: Verification
# ═════════════════════════════════════════════════════════════════
if ($Execute) {
    Log ''
    Log '═══ PHASE 3: Verification ═══'
    Start-Sleep -Seconds 2
    
    $agentSku = '304b93a3-b1f1-427f-aa02-da21e7c7d675'
    $verifyUsers = Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/beta/users?`$select=id,displayName,userPrincipalName,identityParentId,assignedLicenses&`$top=100&`$count=true" `
        -Headers @{"ConsistencyLevel"="eventual"}
    
    $keepSpIds = $keepMap.Values
    $correctCount = 0; $wrongCount = 0; $noParentCount = 0; $licensedCount = 0
    
    foreach ($u in ($verifyUsers.value | Where-Object { $_.userPrincipalName -like '*@glyphor.ai' -and $_.userPrincipalName -notin $ProtectedUpns })) {
        $parentId = $u.identityParentId
        $hasLicense = ($u.assignedLicenses | Where-Object { $_.skuId -eq $agentSku }).Count -gt 0
        if ($hasLicense) { $licensedCount++ }
        
        if (-not $parentId) {
            $noParentCount++
            $tag = 'NO-PARENT'
        }
        elseif ($keepSpIds -contains $parentId) {
            $correctCount++
            $tag = 'CORRECT'
        }
        else {
            $wrongCount++
            $tag = 'WRONG'
        }
        
        $licTag = if ($hasLicense) { 'LIC' } else { '---' }
        Log "  $tag $licTag $($u.displayName)"
    }
    
    Log ''
    Log "  Verification: Correct=$correctCount Wrong=$wrongCount NoParent=$noParentCount Licensed=$licensedCount"
    
    if ($wrongCount -eq 0 -and $noParentCount -eq 0) {
        Log '  ✓ All agent users correctly linked!'
    }
    else {
        Log '  ✗ Some users still need attention'
    }
}

Log ''
Log '═══ Done ═══'

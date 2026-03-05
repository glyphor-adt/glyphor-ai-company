<#
.SYNOPSIS
  Removes duplicate Agent Identity objects from Entra ID (Agent ID Preview).

.DESCRIPTION
  Two scripts were run that each created 44 Agent Identity service principals:

  1. create-agent-blueprint.ps1 → 44 entries named "{Name} ({Dept})"
     using blueprint 5604df3b (Glyphor AI Agent)
     IDs saved in: .agent-identities-created.json

  2. create-agent-identities.ps1 → 44 entries named "Glyphor Agent Identity - {Name}"
     using blueprint b47da287 (Glyphor Agent Blueprint)
     IDs saved in: scripts/agent-identity-real-ids.json

  Result: 88 Agent Identity entries, but only 44 are needed.
  The generated config (a365.generated.config.json) uses blueprint 5604df3b,
  so we KEEP the set from create-agent-blueprint.ps1 and DELETE the set from
  create-agent-identities.ps1.

  The runtime code uses separate app registrations (agentIdentities.json),
  which are NOT affected by this cleanup.

.PARAMETER Force
  Actually delete. Without this flag, runs in dry-run mode.

.PARAMETER DeleteAll
  Delete ALL 88 Agent Identity SPs (both sets). Use if Agent 365 isn't needed yet.

.PARAMETER DeleteUsers
  Also delete the 42 unlicensed agent user accounts from Entra (keeps Morgan Blake
  and Riley Morgan who have M365 licenses).

.EXAMPLE
  # Dry run — see what would be deleted
  .\scripts\cleanup-duplicate-identities.ps1

  # Delete only the 44 duplicates from create-agent-identities.ps1
  .\scripts\cleanup-duplicate-identities.ps1 -Force

  # Delete all 88 Agent Identity SPs (if Agent 365 not needed)
  .\scripts\cleanup-duplicate-identities.ps1 -Force -DeleteAll

  # Also clean up unlicensed agent user accounts
  .\scripts\cleanup-duplicate-identities.ps1 -Force -DeleteUsers
#>

param(
    [switch]$Force,
    [switch]$DeleteAll,
    [switch]$DeleteUsers
)

$ErrorActionPreference = "Stop"

# ─── IDs from create-agent-identities.ps1 (DELETE these — old blueprint b47da287) ───
$duplicateIds = @(
    "a5f564eb-a812-4642-8535-398d5934dfd7"  # James Turner
    "7c028b1a-ff03-44f8-9a4a-76386b183531"  # Tyler Reed
    "6cb0e8d2-8273-4f42-910f-1d1afd7ff038"  # Daniel Ortiz
    "4a659eb1-8384-4cd0-8927-3fccd26fa60c"  # Nadia Okafor
    "f7a45fd1-b445-4b12-9f86-f1cdcc412d4c"  # Zara Petrov
    "d33570ea-4386-414b-bebf-a95950337455"  # Victoria Chase
    "c9731e05-bd52-4219-9e45-9b49a5ebb331"  # Jordan Hayes
    "67ab7e51-2315-4ff3-8e86-2cc3f8d9ef9c"  # Leo Vargas
    "7a0830a2-233e-4ae3-a7e6-11cde86a89fd"  # Lisa Chen
    "3eca72b5-1cfd-47e1-b01d-3d09fb9d12fb"  # Bob Finley
    "49bd5253-93fb-4a1d-9960-cdf5c1fa073d"  # Nathan Cole
    "006c3343-93ff-45af-937e-860068094526"  # Jasmine Rivera
    "34e09de7-e8e0-4578-8f12-f919d5972ccc"  # Daniel Okafor
    "da0ffbba-b3b9-40d7-82ef-e359b954f1b8"  # Alex Park
    "2e92b3ba-794d-427c-adcc-e72e49bba9f5"  # Ryan Park
    "53a1fea2-3d82-4b5c-824b-80979780972f"  # Sophia Lin
    "c9145652-24d2-45f4-8202-a2f6341dfd35"  # Mariana Solis
    "657dc09d-6b73-4ba1-be33-8bd6ae392be7"  # Grace Hwang
    "27051d6c-9673-4a0d-8adb-34364871b4f5"  # Amara Diallo
    "195bc0fb-0d7f-4d7f-bd30-abe2cf210975"  # Sam DeLuca
    "4d5f95e3-61ad-4885-bef0-12f0e89f6094"  # Marcus Reeves
    "55e71340-0965-4f16-8df2-4bdf89513ab8"  # Riya Mehta
    "a4785b64-b70e-416d-b658-f2aff1228d54"  # Ava Chen
    "55716a44-d8e4-4448-a05f-06ecb70145da"  # David Santos
    "8fe67e28-3073-48b0-aa5b-3c69feb587a9"  # Anna Park
    "58c67a12-5c9b-47b7-98bf-4c334116946e"  # Morgan Blake
    "e8c7a446-3c85-44be-8d0f-dcb716b91db3"  # Atlas Vega
    "6653e6d6-a1b7-4bd5-9972-485edd5a4b75"  # Rachel Kim
    "55c22fa8-1fdc-43a2-b1bf-2789c56144d8"  # Kai Nakamura
    "bacefc43-ef26-4bef-bbf8-ccd495ce0588"  # Adi Rose
    "26911c30-db45-4210-908d-2fa6c5c75cdb"  # Kai Johnson
    "19bd8970-40c2-4bde-9194-53b591cab396"  # Sofia Marchetti
    "691a7572-5c8d-49ca-bbbf-4d37f8ac9754"  # Lena Park
    "9ec2442a-30e6-4738-947a-70fe279ef15a"  # Omar Hassan
    "908866ae-f633-4e89-9fd1-f8639a81c668"  # Marcus Chen
    "3e801a11-ab13-450f-b121-46727598d3d4"  # Mia Tanaka
    "92e020d7-c1ef-4414-b7e5-9e9a0910bc5b"  # Priya Sharma
    "eaed3545-a12a-41c4-8bc6-a4875bccbd2d"  # Maya Brooks
    "85fb3934-911a-4133-a430-2941ec183bee"  # Ethan Morse
    "b35fb46e-d3a6-47c0-94e9-ab3fd18986b3"  # Elena Vasquez
    "482b5231-f5e2-476f-95fc-0d6336b95adf"  # Derek Owens
    "8c8b4597-288e-486f-a7c6-5bdfdb28c976"  # Emma Wright
    "8147358d-2192-4e61-a341-a162e5c809fe"  # Sarah Chen
    "c262efa0-9811-401f-bd8a-1cdddacb2b5c"  # Riley Morgan
)

# ─── IDs from create-agent-blueprint.ps1 (KEEP these — active blueprint 5604df3b) ───
$keepIds = @(
    "cfb2db61-d040-4a2c-8f99-c71f07167fac"  # Sam DeLuca (Quality Eng)
    "3ecb0671-b1a9-459b-ba6e-3a7680d76749"  # Grace Hwang (Data Audit)
    "2c46e6db-5296-4ba8-9265-ca2806769040"  # Nathan Cole (Account Research)
    "7d222283-c4c3-449d-abb6-3ba3f9179efb"  # James Turner (VP CS)
    "c56631c6-65ff-42fd-ab1e-c32624c3b47e"  # Elena Vasquez (CPO)
    "673855a3-1032-492d-9a49-9b564a31d3ee"  # Riya Mehta (AI Impact)
    "fe8379cf-70c1-4897-b9e0-4d7dd7990c87"  # Sophia Lin (VP Research)
    "c77e6d78-7e4f-4020-926d-424dcf74ba8f"  # Morgan Blake (Global Admin)
    "b84917d5-44c9-473d-bf6a-5f6d0845b7e7"  # Rachel Kim (VP Sales)
    "0d4b0680-36ae-488e-91cc-29d349a80192"  # Marcus Reeves (CTO)
    "83fc2283-a1b9-4b71-bdb9-04a91bee6596"  # Sarah Chen (CoS)
    "10705a18-f6df-4bec-947c-d76f222c2a05"  # Sofia Marchetti (Design Critic)
    "024d13af-f2e0-454e-8551-b53631c31fc7"  # Lena Park (Comp Research)
    "b95d776a-19c5-46a3-afcb-c0899da531e2"  # Emma Wright (Onboarding)
    "8232b4e4-1aa6-4ddd-9172-4b3c5565e432"  # Ava Chen (Frontend)
    "a1b84f92-491e-449e-b21d-12368d6b5968"  # Amara Diallo (Industry Research)
    "d6baf6b8-b60e-423a-b30f-0f7382828107"  # Victoria Chase (CLO)
    "1a582429-ab83-42da-b34e-fe43f9c0bffb"  # Kai Johnson (Social)
    "4989f327-1fc8-4f90-a56a-3fa8e4a1d3b5"  # Lisa Chen (SEO)
    "ec79451c-4c23-4148-a177-a31ad9192642"  # Riley Morgan (M365)
    "36818357-1854-435e-b203-94151b4a8a30"  # Derek Owens (Lead Gen)
    "385f20d0-ea15-4323-9ef0-769c15c67065"  # Mia Tanaka (VP Design)
    "13e67cdd-9715-4a10-a8bb-8585644a829f"  # Daniel Okafor (Market Research)
    "6a7fad64-7634-4492-935d-525a1cee076e"  # Omar Hassan (Cost)
    "f0fe9459-2685-446d-812f-1b0bd6b09239"  # Zara Petrov (Marketing Intel)
    "c96f3821-c7cd-4654-9968-3c4b1a1a501f"  # Mariana Solis (Tax Strategy)
    "6b591c9a-cf6a-4979-8835-a92cd43ab85d"  # Bob Finley (Tax)
    "20ad3545-c2a7-4448-857a-09ec83a2838c"  # Atlas Vega (Ops)
    "915bfec2-5277-4c75-ab52-9e62699a63a1"  # Marcus Chen (Org Analyst)
    "66c2b0e9-5a8c-4065-ad56-dadfe0d0bad5"  # Jasmine Rivera (HR)
    "58365116-ae46-490c-af29-38638a51ab8e"  # Kai Nakamura (Tech Research)
    "fd7c6ca8-c438-483e-8cce-b7dad91a994f"  # Nadia Okafor (CFO)
    "61683830-321d-47b0-89f2-404d94e56929"  # Leo Vargas (UI/UX)
    "d176b833-b68a-4674-b712-7b7d90ad3978"  # Maya Brooks (CMO)
    "5c2d9386-ff1f-4682-b778-ca407dece273"  # Alex Park (Platform Eng)
    "7021ad63-c158-43b1-b2b3-e413b453a0c7"  # Priya Sharma (User Research)
    "63aa1813-eff8-4ed3-8b72-f5aa61471406"  # Jordan Hayes (DevOps)
    "3d012799-cc13-4c42-a6f0-4771aa2a96b0"  # Ryan Park (Template Arch)
    "6366c2ec-3a41-46c6-8a94-bc9367c0fabf"  # Tyler Reed (Content)
    "c3a2d2d4-9360-4311-90dc-607d64f3e9d3"  # Anna Park (Revenue)
    "f8674dd8-d530-48a2-9863-041e7c4d17d0"  # Adi Rose (Exec Assistant)
    "535fed90-6eef-456c-af13-bb2fabac98c4"  # Ethan Morse (Enterprise)
    "91802f6b-e2e3-458d-87e3-e6580de9b8e3"  # Daniel Ortiz (Competitive Intel)
    "330b2c3f-3c87-4fd2-babf-8fc3970f3794"  # David Santos (Support)
)

# ─── Agent user UPNs to KEEP (have M365 licenses) ───
$keepUserUPNs = @(
    "morgan@glyphor.ai"   # Morgan Blake - Microsoft Agent 365 Frontier
    "riley@glyphor.ai"    # Riley Morgan - Microsoft Agent 365 Frontier
)

Write-Host "=== Glyphor Agent Identity Duplicate Cleanup ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Current state:" -ForegroundColor White
Write-Host "  88 Agent Identity SPs (should be 44)" -ForegroundColor Yellow
Write-Host "  47 Entra users (3 humans + 44 agent accounts)" -ForegroundColor Yellow
Write-Host "  44 App registrations (used by code — NOT touched)" -ForegroundColor Green
Write-Host ""

if (-not $Force) {
    Write-Host "[DRY RUN] No changes will be made. Use -Force to delete." -ForegroundColor Yellow
    Write-Host ""
}

# Ensure we have Graph access
Write-Host "Checking Microsoft Graph connection..." -ForegroundColor White
try {
    $ctx = Get-MgContext
    if (-not $ctx) { throw "not connected" }
    Write-Host "  Connected as: $($ctx.Account ?? $ctx.AppName)" -ForegroundColor Green
} catch {
    Write-Host "  Not connected. Connecting..." -ForegroundColor Yellow
    Connect-MgGraph -Scopes 'Application.ReadWrite.All' -TenantId '19ab7456-f160-416d-a503-57298ab192a2' -NoWelcome
    $ctx = Get-MgContext
    Write-Host "  Connected as: $($ctx.Account ?? $ctx.AppName)" -ForegroundColor Green
}
Write-Host ""

# ─── Phase 1: Delete duplicate Agent Identity SPs ───
if ($DeleteAll) {
    $idsToDelete = $duplicateIds + $keepIds
    Write-Host "Phase 1: Deleting ALL 88 Agent Identity SPs (-DeleteAll)" -ForegroundColor Cyan
} else {
    $idsToDelete = $duplicateIds
    Write-Host "Phase 1: Deleting 44 duplicate Agent Identity SPs (old blueprint)" -ForegroundColor Cyan
    Write-Host "  Keeping 44 from blueprint 5604df3b (a365.generated.config)" -ForegroundColor Gray
}

$deleted = 0; $notFound = 0; $errors = 0

foreach ($spId in $idsToDelete) {
    $label = $spId.Substring(0, 8)
    Write-Host "  $label... " -NoNewline

    if ($Force) {
        try {
            Invoke-MgGraphRequest -Method DELETE `
                -Uri "https://graph.microsoft.com/beta/servicePrincipals/$spId" `
                -ErrorAction Stop
            Write-Host "deleted" -ForegroundColor Green
            $deleted++
        } catch {
            $sc = 0
            if ($_.Exception.Response) { $sc = [int]$_.Exception.Response.StatusCode }
            if ($sc -eq 404) {
                Write-Host "not found (already gone)" -ForegroundColor Gray
                $notFound++
            } else {
                Write-Host "FAILED ($sc)" -ForegroundColor Red
                $errors++
            }
        }
        Start-Sleep -Milliseconds 200
    } else {
        Write-Host "would delete" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "  Agent Identity SPs: $deleted deleted, $notFound not found, $errors failed" -ForegroundColor $(if ($errors -gt 0) { "Red" } else { "Cyan" })
Write-Host ""

# ─── Phase 2: Delete unlicensed agent user accounts ───
if ($DeleteUsers) {
    Write-Host "Phase 2: Cleaning up unlicensed agent user accounts" -ForegroundColor Cyan
    Write-Host "  Keeping licensed users: $($keepUserUPNs -join ', ')" -ForegroundColor Gray

    # Get all users with "Is Agent" = Yes
    $agentUsers = Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/users?`$filter=companyName eq 'Glyphor AI'&`$select=id,displayName,userPrincipalName,assignedLicenses&`$top=100" `
        -ErrorAction Stop

    $userDeleted = 0; $userSkipped = 0; $userErrors = 0

    foreach ($user in $agentUsers.value) {
        $upn = $user.userPrincipalName
        if ($upn -in $keepUserUPNs) {
            Write-Host "  [KEEP] $($user.displayName) ($upn) — has M365 license" -ForegroundColor Green
            $userSkipped++
            continue
        }

        # Skip non-agent real humans
        if ($upn -match '^(Andrew|Kristina|andrew\.zwelling)') {
            Write-Host "  [KEEP] $($user.displayName) ($upn) — real human" -ForegroundColor Green
            $userSkipped++
            continue
        }

        Write-Host "  $($user.displayName) ($upn)... " -NoNewline

        if ($Force) {
            try {
                Invoke-MgGraphRequest -Method DELETE `
                    -Uri "https://graph.microsoft.com/v1.0/users/$($user.id)" `
                    -ErrorAction Stop
                Write-Host "deleted" -ForegroundColor Green
                $userDeleted++
            } catch {
                Write-Host "FAILED" -ForegroundColor Red
                $userErrors++
            }
            Start-Sleep -Milliseconds 200
        } else {
            Write-Host "would delete" -ForegroundColor Yellow
        }
    }

    Write-Host ""
    Write-Host "  Users: $userDeleted deleted, $userSkipped kept, $userErrors failed" -ForegroundColor $(if ($userErrors -gt 0) { "Red" } else { "Cyan" })
} else {
    Write-Host "Phase 2: Skipped (user cleanup). Use -DeleteUsers to also remove unlicensed agent user accounts." -ForegroundColor Gray
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan

if (-not $Force) {
    Write-Host ""
    Write-Host "To execute, run one of:" -ForegroundColor White
    Write-Host "  .\scripts\cleanup-duplicate-identities.ps1 -Force                        # Delete 44 duplicate Agent IDs only" -ForegroundColor Cyan
    Write-Host "  .\scripts\cleanup-duplicate-identities.ps1 -Force -DeleteAll              # Delete all 88 Agent IDs" -ForegroundColor Cyan
    Write-Host "  .\scripts\cleanup-duplicate-identities.ps1 -Force -DeleteUsers            # Delete 44 dupes + 42 unlicensed users" -ForegroundColor Cyan
    Write-Host "  .\scripts\cleanup-duplicate-identities.ps1 -Force -DeleteAll -DeleteUsers # Full cleanup" -ForegroundColor Cyan
}

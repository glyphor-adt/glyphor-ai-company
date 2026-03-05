# delete-old-agent-sps.ps1
# Deletes the 44 OLD regular Application-type SPs that are duplicates
# of the new real AgentIdentity SPs created on 03/05/26.
# These old SPs appear in Entra "Agent identities" view causing 88 entries instead of 44.

$ErrorActionPreference = "Continue"

# Connect as delegated user
Connect-MgGraph -Scopes "Application.ReadWrite.All" -TenantId "19ab7456-f160-416d-a503-57298ab192a2" -NoWelcome
$ctx = Get-MgContext
Write-Host "Connected as: $($ctx.Account)" -ForegroundColor Cyan

# Old SP IDs from agentIdentities.json (regular Application-type SPs, NOT real AgentIdentity SPs)
$oldSPs = @{
    "chief-of-staff"               = "44b8492e-6155-4a8f-9f84-2b889e50f2bb"
    "cto"                          = "c6088ead-8cf5-4615-ae90-62474f125d3a"
    "cfo"                          = "c25ac5e2-c10a-4beb-8d86-523fc791b46e"
    "cpo"                          = "585043cd-bbac-4407-8caf-40037f692156"
    "cmo"                          = "33981f3d-527b-4c83-9ad0-7368572b7a39"
    "clo"                          = "5fbfab98-1d23-4144-b9bd-a92ca182f7d5"
    "vp-customer-success"          = "dfaf6765-bb48-42bb-8369-37e9a263b103"
    "vp-sales"                     = "3dfb992c-9eb0-4715-a81d-442a8ea7fcbe"
    "vp-design"                    = "ff4e9b83-7034-44ed-8fca-b718bd5ebe1d"
    "platform-engineer"            = "ed683a9a-000c-4841-b568-a1c78d13c2a4"
    "quality-engineer"             = "aef76059-1ab1-4cfc-abec-7d0b5a0a9ea4"
    "devops-engineer"              = "c8c13acb-bd9c-4cd4-a525-81e0d45b4bfe"
    "m365-admin"                   = "695fea43-7f4f-4477-9c3d-8415aab64810"
    "user-researcher"              = "8202671d-9cbc-4e79-8802-244f7f1ad95a"
    "competitive-intel"            = "e2442dc6-9a90-446f-9203-3005fd45a4ed"
    "revenue-analyst"              = "2b10d2df-4da8-4c94-bffb-5f2daedc8e01"
    "cost-analyst"                 = "44c0f7f4-6117-4c3b-8456-e98d2bade30c"
    "content-creator"              = "0934b789-c910-48d2-b072-964e32b3be5d"
    "seo-analyst"                  = "3006a927-22aa-4202-81d9-2188936ed29e"
    "social-media-manager"         = "c2e78790-18ab-4bc9-966a-e091860c2717"
    "onboarding-specialist"        = "a09f8656-5514-4c9c-bace-0409ae76e5b7"
    "support-triage"               = "d4bcda8f-4271-498d-b731-6308907662ed"
    "account-research"             = "28ede25f-e6a6-47db-a739-bd1d45f0a44e"
    "ui-ux-designer"               = "88937a31-6ec9-493f-9cb0-5e2fad90fd88"
    "frontend-engineer"            = "0375672b-3bfc-44f7-8ce8-477e20908b0c"
    "design-critic"                = "c1514047-e4b8-4445-8b90-9bf389200f66"
    "template-architect"           = "2b612dae-2e36-45ab-8573-30e680c7fe2a"
    "ops"                          = "b5133bb4-4659-4411-baa5-652c526a3fd6"
    "global-admin"                 = "8064c3b2-813d-45e2-ba13-a1c21a6f88a1"
    "head-of-hr"                   = "4f56a638-0748-4ef0-b714-56df64bff988"
    "vp-research"                  = "d012bbe2-518d-4051-bc20-c40a36ee3a68"
    "competitive-research-analyst" = "0ec20f9b-7e5c-4ce4-9e1e-14c9329a3ab5"
    "market-research-analyst"      = "386fe230-5834-4508-a7b9-bfe634c546e2"
    "technical-research-analyst"   = "5d906c91-2eb6-429c-a615-795f665216db"
    "industry-research-analyst"    = "f8ac19c3-4067-4771-bddc-e1ed51d37e7e"
    "ai-impact-analyst"            = "4e36c8be-3e92-4088-ba6c-817b77467aba"
    "org-analyst"                  = "280560f7-34b3-44e5-9e72-950c66dada25"
    "enterprise-account-researcher"= "6513d81d-b4f3-49b8-a80b-52c0636221b9"
    "bob-the-tax-pro"              = "ca0b0510-8deb-4e66-adaa-e7e8165d0c89"
    "data-integrity-auditor"       = "ab889d4d-db76-40e4-a2ba-dda906734be4"
    "tax-strategy-specialist"      = "ad4575ee-4538-4c48-b8f0-bd43a178590a"
    "lead-gen-specialist"          = "e3f38e08-50ad-499d-8428-76c8e94a3c98"
    "marketing-intelligence-analyst"= "7d09e59d-b7f6-4a54-bdb8-b545c13aeb0b"
    "adi-rose"                     = "dc21c768-9166-487b-8d40-ddf362936f06"
}

Write-Host "`nDeleting $($oldSPs.Count) old regular Application-type SPs..." -ForegroundColor Yellow

$deleted = 0
$failed = 0

foreach ($entry in $oldSPs.GetEnumerator() | Sort-Object Key) {
    $role = $entry.Key
    $spId = $entry.Value
    try {
        Invoke-MgGraphRequest -Method DELETE -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$spId" | Out-Null
        Write-Host "  DELETED  $role ($spId)" -ForegroundColor Green
        $deleted++
    }
    catch {
        $err = $_.Exception.Message
        if ($err -match "does not exist|Not Found") {
            Write-Host "  SKIP     $role ($spId) - already gone" -ForegroundColor DarkGray
            $deleted++
        }
        else {
            Write-Host "  FAILED   $role ($spId) - $err" -ForegroundColor Red
            $failed++
        }
    }
}

Write-Host "`n=== RESULTS ===" -ForegroundColor Cyan
Write-Host "Deleted: $deleted" -ForegroundColor Green
Write-Host "Failed:  $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })

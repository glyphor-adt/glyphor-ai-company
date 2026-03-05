#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Migrates regular user accounts to agentUser type by deleting and recreating
  them with @odata.type = #microsoft.graph.agentUser and identityParentId
  linking to the agent identity SP.

.DESCRIPTION
  Per MS docs (POST /beta/users), an agentUser requires:
    - @odata.type: "#microsoft.graph.agentUser"
    - identityParentId: the object ID of the associated agent identity SP
    - No passwordProfile (agent users can't have passwords)

  This makes them show "Is Agent: Yes" in Entra.
#>

$ErrorActionPreference = 'Stop'
$TenantId = '19ab7456-f160-416d-a503-57298ab192a2'
$AgentLicenseSku = '304b93a3-b1f1-427f-aa02-da21e7c7d675'
$SponsorId = '88a731d1-3171-4279-aee1-34160898ab90'  # Kristina Denney

$ProtectedUpns = @(
    'kristina@glyphor.ai',
    'andrew@glyphor.ai',
    'andrew.zwelling_gmail.com#EXT#@glyphorai.onmicrosoft.com'
)

function Log { param([string]$m); Write-Host "$(Get-Date -Format 'HH:mm:ss') $m" }

# ─── Connect ──────────────────────────────────────────────────────
Log 'Connecting to Microsoft Graph...'
Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
$ctx = Get-MgContext -ErrorAction SilentlyContinue
if ($ctx -and $ctx.TenantId -eq $TenantId) {
    Log "  Already connected as $($ctx.Account)"
} else {
    Connect-MgGraph -Scopes 'User.ReadWrite.All','Directory.ReadWrite.All' -TenantId $TenantId -NoWelcome
    $ctx = Get-MgContext
    Log "  Connected as $($ctx.Account)"
}

function GBeta {
    param([string]$Method, [string]$Path, [string]$Body)
    $p = @{
        Method = $Method
        Uri    = "https://graph.microsoft.com/beta$Path"
    }
    if ($Body) {
        $p.Body = $Body
        $p.ContentType = 'application/json'
    }
    Invoke-MgGraphRequest @p
}

# ─── Agent mapping: UPN → (displayName, jobTitle, department, identityParentId) ───
# identityParentId = the SP object ID of the agent identity
$agentMap = @{
    'sarah@glyphor.ai'    = @{ dn='Sarah Chen';        jt='Chief of Staff';                  dept='Executive Office';        spId='44b8492e-6155-4a8f-9f84-2b889e50f2bb' }
    'marcus@glyphor.ai'   = @{ dn='Marcus Reeves';     jt='Chief Technology Officer';         dept='Engineering';             spId='c6088ead-8cf5-4615-ae90-62474f125d3a' }
    'nadia@glyphor.ai'    = @{ dn='Nadia Okafor';      jt='Chief Financial Officer';          dept='Finance';                 spId='c25ac5e2-c10a-4beb-8d86-523fc791b46e' }
    'elena@glyphor.ai'    = @{ dn='Elena Vasquez';     jt='Chief Product Officer';            dept='Product';                 spId='585043cd-bbac-4407-8caf-40037f692156' }
    'maya@glyphor.ai'     = @{ dn='Maya Brooks';       jt='Chief Marketing Officer';          dept='Marketing';               spId='33981f3d-527b-4c83-9ad0-7368572b7a39' }
    'victoria@glyphor.ai' = @{ dn='Victoria Chase';    jt='Chief Legal Officer';              dept='Legal';                   spId='5fbfab98-1d23-4144-b9bd-a92ca182f7d5' }
    'james@glyphor.ai'    = @{ dn='James Turner';      jt='VP Customer Success';              dept='Customer Success';        spId='dfaf6765-bb48-42bb-8369-37e9a263b103' }
    'rachel@glyphor.ai'   = @{ dn='Rachel Kim';        jt='VP Sales';                         dept='Sales';                   spId='3dfb992c-9eb0-4715-a81d-442a8ea7fcbe' }
    'mia@glyphor.ai'      = @{ dn='Mia Tanaka';        jt='VP Design & Frontend';             dept='Design & Frontend';       spId='ff4e9b83-7034-44ed-8fca-b718bd5ebe1d' }
    'alex@glyphor.ai'     = @{ dn='Alex Park';         jt='Platform Engineer';                dept='Engineering';             spId='ed683a9a-000c-4841-b568-a1c78d13c2a4' }
    'sam@glyphor.ai'      = @{ dn='Sam DeLuca';        jt='Quality Engineer';                 dept='Engineering';             spId='aef76059-1ab1-4cfc-abec-7d0b5a0a9ea4' }
    'jordan@glyphor.ai'   = @{ dn='Jordan Hayes';      jt='DevOps Engineer';                  dept='Engineering';             spId='c8c13acb-bd9c-4cd4-a525-81e0d45b4bfe' }
    'riley@glyphor.ai'    = @{ dn='Riley Morgan';      jt='M365 Administrator';               dept='Operations & IT';         spId='695fea43-7f4f-4477-9c3d-8415aab64810' }
    'priya@glyphor.ai'    = @{ dn='Priya Sharma';      jt='User Researcher';                  dept='Product';                 spId='8202671d-9cbc-4e79-8802-244f7f1ad95a' }
    'daniel@glyphor.ai'   = @{ dn='Daniel Ortiz';      jt='Competitive Intel Analyst';        dept='Product';                 spId='e2442dc6-9a90-446f-9203-3005fd45a4ed' }
    'anna@glyphor.ai'     = @{ dn='Anna Park';         jt='Revenue Analyst';                  dept='Finance';                 spId='2b10d2df-4da8-4c94-bffb-5f2daedc8e01' }
    'omar@glyphor.ai'     = @{ dn='Omar Hassan';       jt='Cost Analyst';                     dept='Finance';                 spId='44c0f7f4-6117-4c3b-8456-e98d2bade30c' }
    'tyler@glyphor.ai'    = @{ dn='Tyler Reed';        jt='Content Creator';                  dept='Marketing';               spId='0934b789-c910-48d2-b072-964e32b3be5d' }
    'lisa@glyphor.ai'     = @{ dn='Lisa Chen';         jt='SEO Analyst';                      dept='Marketing';               spId='3006a927-22aa-4202-81d9-2188936ed29e' }
    'kai@glyphor.ai'      = @{ dn='Kai Johnson';       jt='Social Media Manager';             dept='Marketing';               spId='c2e78790-18ab-4bc9-966a-e091860c2717' }
    'emma@glyphor.ai'     = @{ dn='Emma Wright';       jt='Onboarding Specialist';            dept='Customer Success';        spId='a09f8656-5514-4c9c-bace-0409ae76e5b7' }
    'david@glyphor.ai'    = @{ dn='David Santos';      jt='Support Triage';                   dept='Customer Success';        spId='d4bcda8f-4271-498d-b731-6308907662ed' }
    'nathan@glyphor.ai'   = @{ dn='Nathan Cole';       jt='Account Research';                 dept='Sales';                   spId='28ede25f-e6a6-47db-a739-bd1d45f0a44e' }
    'leo@glyphor.ai'      = @{ dn='Leo Vargas';        jt='UI/UX Designer';                   dept='Design & Frontend';       spId='88937a31-6ec9-493f-9cb0-5e2fad90fd88' }
    'ava@glyphor.ai'      = @{ dn='Ava Chen';          jt='Frontend Engineer';                dept='Design & Frontend';       spId='0375672b-3bfc-44f7-8ce8-477e20908b0c' }
    'sofia@glyphor.ai'    = @{ dn='Sofia Marchetti';   jt='Design Critic';                    dept='Design & Frontend';       spId='c1514047-e4b8-4445-8b90-9bf389200f66' }
    'ryan@glyphor.ai'     = @{ dn='Ryan Park';         jt='Template Architect';               dept='Design & Frontend';       spId='2b612dae-2e36-45ab-8573-30e680c7fe2a' }
    'atlas@glyphor.ai'    = @{ dn='Atlas Vega';        jt='Operations & System Intelligence'; dept='Operations';              spId='b5133bb4-4659-4411-baa5-652c526a3fd6' }
    'morgan@glyphor.ai'   = @{ dn='Morgan Blake';      jt='Global Administrator';             dept='Operations & IT';         spId='8064c3b2-813d-45e2-ba13-a1c21a6f88a1' }
    'jasmine@glyphor.ai'  = @{ dn='Jasmine Rivera';    jt='Head of People & Culture';         dept='People & Culture';        spId='4f56a638-0748-4ef0-b714-56df64bff988' }
    'sophia@glyphor.ai'   = @{ dn='Sophia Lin';        jt='VP Research & Intelligence';       dept='Research & Intelligence'; spId='d012bbe2-518d-4051-bc20-c40a36ee3a68' }
    'lena@glyphor.ai'     = @{ dn='Lena Park';         jt='Competitive Research Analyst';     dept='Research & Intelligence'; spId='0ec20f9b-7e5c-4ce4-9e1e-14c9329a3ab5' }
    'dokafor@glyphor.ai'  = @{ dn='Daniel Okafor';     jt='Market Research Analyst';          dept='Research & Intelligence'; spId='386fe230-5834-4508-a7b9-bfe634c546e2' }
    'kain@glyphor.ai'     = @{ dn='Kai Nakamura';      jt='Technical Research Analyst';       dept='Research & Intelligence'; spId='5d906c91-2eb6-429c-a615-795f665216db' }
    'amara@glyphor.ai'    = @{ dn='Amara Diallo';      jt='Industry Research Analyst';        dept='Research & Intelligence'; spId='f8ac19c3-4067-4771-bddc-e1ed51d37e7e' }
    'ethan@glyphor.ai'    = @{ dn='Ethan Morse';       jt='Enterprise Account Researcher';    dept='Sales';                   spId='6513d81d-b4f3-49b8-a80b-52c0636221b9' }
    'bob@glyphor.ai'      = @{ dn='Robert Finley';     jt='CPA & Tax Strategist';             dept='Legal';                   spId='ca0b0510-8deb-4e66-adaa-e7e8165d0c89' }
    'grace@glyphor.ai'    = @{ dn='Grace Hwang';       jt='Data Integrity Auditor';           dept='Legal';                   spId='ab889d4d-db76-40e4-a2ba-dda906734be4' }
    'mariana@glyphor.ai'  = @{ dn='Mariana Solis';     jt='Tax Strategy Specialist';          dept='Legal';                   spId='ad4575ee-4538-4c48-b8f0-bd43a178590a' }
    'derek@glyphor.ai'    = @{ dn='Derek Owens';       jt='Lead Generation Specialist';       dept='Sales';                   spId='e3f38e08-50ad-499d-8428-76c8e94a3c98' }
    'zara@glyphor.ai'     = @{ dn='Zara Petrov';       jt='Marketing Intelligence Analyst';   dept='Marketing';               spId='7d09e59d-b7f6-4a54-bdb8-b545c13aeb0b' }
    'riya@glyphor.ai'     = @{ dn='Riya Mehta';        jt='AI Impact Analyst';                dept='Strategy';                spId='4e36c8be-3e92-4088-ba6c-817b77467aba' }
    'marcusc@glyphor.ai'  = @{ dn='Marcus Chen';       jt='Organizational & Talent Analyst';  dept='Strategy';                spId='280560f7-34b3-44e5-9e72-950c66dada25' }
    'adi@glyphor.ai'      = @{ dn='Adi Rose';          jt='Executive Assistant to COO';       dept='Executive Office';        spId='dc21c768-9166-487b-8d40-ddf362936f06' }
}

Log "Agent map has $($agentMap.Count) entries"

# ─── Get all current users ───────────────────────────────────────
Log 'Loading current users...'
$allUsers = @()
$uri = "/users?`$select=id,displayName,userPrincipalName,usageLocation,assignedLicenses&`$top=100"
while ($uri) {
    $page = GBeta -Method GET -Path $uri
    $allUsers += $page.value
    $uri = $page.'@odata.nextLink'
    if ($uri) { $uri = $uri -replace 'https://graph.microsoft.com/beta','' }
}
Log "  Total users: $($allUsers.Count)"

# Filter to agents only
$agentUsers = $allUsers | Where-Object { $ProtectedUpns -notcontains $_.userPrincipalName }
Log "  Agent users to migrate: $($agentUsers.Count)"

# ─── Process each agent ─────────────────────────────────────────
$migrated = 0; $failed = 0; $skipped = 0

foreach ($user in $agentUsers) {
    $upn = $user.userPrincipalName.ToLower()
    $userId = $user.id
    $displayName = $user.displayName

    $info = $agentMap[$upn]
    if (-not $info) {
        Log "SKIP (no mapping): $displayName ($upn)"
        $skipped++
        continue
    }

    Log ''
    Log "─── $displayName ($upn) ───"

    try {
        # Step 1: Delete current regular user
        Log '  Deleting regular user...'
        GBeta -Method DELETE -Path "/users/$userId" | Out-Null
        Start-Sleep -Seconds 1

        # Step 2: Purge from recycle bin so UPN is reusable
        Log '  Purging from recycle bin...'
        try {
            GBeta -Method DELETE -Path "/directory/deletedItems/$userId" | Out-Null
        } catch {
            Start-Sleep -Seconds 3
            try {
                GBeta -Method DELETE -Path "/directory/deletedItems/$userId" | Out-Null
            } catch {
                Log "  WARN: Could not purge: $($_.Exception.Message)"
            }
        }
        Start-Sleep -Seconds 2

        # Step 3: Create as agentUser with identityParentId
        Log "  Creating agentUser (identityParentId=$($info.spId))..."
        $mailNickname = ($upn -split '@')[0]
        $body = @{
            '@odata.type'    = '#microsoft.graph.agentUser'
            accountEnabled   = $true
            displayName      = $info.dn
            mailNickname     = $mailNickname
            userPrincipalName = $upn
            identityParentId = $info.spId
        } | ConvertTo-Json -Depth 3

        $newUser = GBeta -Method POST -Path '/users' -Body $body
        $newId = $newUser.id
        Log "  Created: $newId"

        # Step 4: Set usageLocation (required for license)
        Log '  Setting usageLocation...'
        GBeta -Method PATCH -Path "/users/$newId" -Body (@{ usageLocation = 'US'; jobTitle = $info.jt; department = $info.dept; companyName = 'Glyphor AI' } | ConvertTo-Json) | Out-Null
        Start-Sleep -Seconds 1

        # Step 5: Assign license
        Log '  Assigning Agent 365 license...'
        $licBody = @{
            addLicenses    = @( @{ skuId = $AgentLicenseSku; disabledPlans = @() } )
            removeLicenses = @()
        } | ConvertTo-Json -Depth 3

        try {
            GBeta -Method POST -Path "/users/$newId/assignLicense" -Body $licBody | Out-Null
            Log '  License assigned'
        } catch {
            Log "  WARN: License failed: $($_.Exception.Message)"
        }

        $migrated++
        Log '  DONE'

    } catch {
        $failed++
        Log "  FAILED: $($_.Exception.Message)"
        try { Log "  Detail: $($_.ErrorDetails.Message)" } catch {}
    }

    Start-Sleep -Milliseconds 500
}

# ─── Summary ─────────────────────────────────────────────────────
Log ''
Log '═══════════════════════════════════════════════'
Log '  AgentUser Migration Complete'
Log "  Migrated: $migrated"
Log "  Failed:   $failed"
Log "  Skipped:  $skipped"
Log '═══════════════════════════════════════════════'

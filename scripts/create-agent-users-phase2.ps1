#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Phase 2: Delete current regular users and recreate as agentUser type
  using the real AgentIdentity SP IDs from Phase 1.
#>

$ErrorActionPreference = 'Stop'
$TenantId = '19ab7456-f160-416d-a503-57298ab192a2'
$AgentLicenseSku = '304b93a3-b1f1-427f-aa02-da21e7c7d675'

$ProtectedUpns = @(
    'kristina@glyphor.ai',
    'andrew@glyphor.ai',
    'andrew.zwelling_gmail.com#EXT#@glyphorai.onmicrosoft.com'
)

function Log { param([string]$m); Write-Host "$(Get-Date -Format 'HH:mm:ss') $m" }

# ─── Connect as user ─────────────────────────────────────────────
Log 'Connecting as user (delegated)...'
Disconnect-MgGraph -ErrorAction SilentlyContinue
Connect-MgGraph -Scopes 'User.ReadWrite.All','Directory.ReadWrite.All' `
    -TenantId $TenantId -NoWelcome -ContextScope Process
$ctx = Get-MgContext
if (-not $ctx -or $ctx.AuthType -ne 'Delegated') {
    Write-Error "Failed to connect as delegated user. AuthType: $($ctx.AuthType)"
    exit 1
}
Log "  Connected as $($ctx.Account) (Delegated)"

function GBeta {
    param([string]$Method, [string]$Path, [string]$Body)
    $p = @{ Method = $Method; Uri = "https://graph.microsoft.com/beta$Path" }
    if ($Body) { $p.Body = $Body; $p.ContentType = 'application/json' }
    Invoke-MgGraphRequest @p
}

# ─── Load real agent identity IDs from Phase 1 ──────────────────
$idsFile = Join-Path $PSScriptRoot 'agent-identity-real-ids.json'
$realIds = Get-Content $idsFile -Raw | ConvertFrom-Json

# ─── Agent mapping: role → (upn, displayName, jobTitle, department, identityParentId from real IDs) ─
$agentMap = @{
    'sarah@glyphor.ai'    = @{ key='chief-of-staff';    dn='Sarah Chen';        jt='Chief of Staff';                  dept='Executive Office' }
    'marcus@glyphor.ai'   = @{ key='cto';               dn='Marcus Reeves';     jt='Chief Technology Officer';         dept='Engineering' }
    'nadia@glyphor.ai'    = @{ key='cfo';               dn='Nadia Okafor';      jt='Chief Financial Officer';          dept='Finance' }
    'elena@glyphor.ai'    = @{ key='cpo';               dn='Elena Vasquez';     jt='Chief Product Officer';            dept='Product' }
    'maya@glyphor.ai'     = @{ key='cmo';               dn='Maya Brooks';       jt='Chief Marketing Officer';          dept='Marketing' }
    'victoria@glyphor.ai' = @{ key='clo';               dn='Victoria Chase';    jt='Chief Legal Officer';              dept='Legal' }
    'james@glyphor.ai'    = @{ key='vp-customer-success'; dn='James Turner';    jt='VP Customer Success';              dept='Customer Success' }
    'rachel@glyphor.ai'   = @{ key='vp-sales';          dn='Rachel Kim';        jt='VP Sales';                         dept='Sales' }
    'mia@glyphor.ai'      = @{ key='vp-design';         dn='Mia Tanaka';        jt='VP Design & Frontend';             dept='Design & Frontend' }
    'alex@glyphor.ai'     = @{ key='platform-engineer'; dn='Alex Park';         jt='Platform Engineer';                dept='Engineering' }
    'sam@glyphor.ai'      = @{ key='quality-engineer';  dn='Sam DeLuca';        jt='Quality Engineer';                 dept='Engineering' }
    'jordan@glyphor.ai'   = @{ key='devops-engineer';   dn='Jordan Hayes';      jt='DevOps Engineer';                  dept='Engineering' }
    'riley@glyphor.ai'    = @{ key='m365-admin';        dn='Riley Morgan';      jt='M365 Administrator';               dept='Operations & IT' }
    'priya@glyphor.ai'    = @{ key='user-researcher';   dn='Priya Sharma';      jt='User Researcher';                  dept='Product' }
    'daniel@glyphor.ai'   = @{ key='competitive-intel'; dn='Daniel Ortiz';      jt='Competitive Intel Analyst';        dept='Product' }
    'anna@glyphor.ai'     = @{ key='revenue-analyst';   dn='Anna Park';         jt='Revenue Analyst';                  dept='Finance' }
    'omar@glyphor.ai'     = @{ key='cost-analyst';      dn='Omar Hassan';       jt='Cost Analyst';                     dept='Finance' }
    'tyler@glyphor.ai'    = @{ key='content-creator';   dn='Tyler Reed';        jt='Content Creator';                  dept='Marketing' }
    'lisa@glyphor.ai'     = @{ key='seo-analyst';       dn='Lisa Chen';         jt='SEO Analyst';                      dept='Marketing' }
    'kai@glyphor.ai'      = @{ key='social-media-manager'; dn='Kai Johnson';    jt='Social Media Manager';             dept='Marketing' }
    'emma@glyphor.ai'     = @{ key='onboarding-specialist'; dn='Emma Wright';   jt='Onboarding Specialist';            dept='Customer Success' }
    'david@glyphor.ai'    = @{ key='support-triage';    dn='David Santos';      jt='Support Triage';                   dept='Customer Success' }
    'nathan@glyphor.ai'   = @{ key='account-research';  dn='Nathan Cole';       jt='Account Research';                 dept='Sales' }
    'leo@glyphor.ai'      = @{ key='ui-ux-designer';   dn='Leo Vargas';        jt='UI/UX Designer';                   dept='Design & Frontend' }
    'ava@glyphor.ai'      = @{ key='frontend-engineer'; dn='Ava Chen';          jt='Frontend Engineer';                dept='Design & Frontend' }
    'sofia@glyphor.ai'    = @{ key='design-critic';     dn='Sofia Marchetti';   jt='Design Critic';                    dept='Design & Frontend' }
    'ryan@glyphor.ai'     = @{ key='template-architect'; dn='Ryan Park';        jt='Template Architect';               dept='Design & Frontend' }
    'atlas@glyphor.ai'    = @{ key='ops';               dn='Atlas Vega';        jt='Operations & System Intelligence'; dept='Operations' }
    'morgan@glyphor.ai'   = @{ key='global-admin';      dn='Morgan Blake';      jt='Global Administrator';             dept='Operations & IT' }
    'jasmine@glyphor.ai'  = @{ key='head-of-hr';       dn='Jasmine Rivera';    jt='Head of People & Culture';         dept='People & Culture' }
    'sophia@glyphor.ai'   = @{ key='vp-research';       dn='Sophia Lin';        jt='VP Research & Intelligence';       dept='Research & Intelligence' }
    'lena@glyphor.ai'     = @{ key='competitive-research-analyst'; dn='Lena Park'; jt='Competitive Research Analyst';  dept='Research & Intelligence' }
    'dokafor@glyphor.ai'  = @{ key='market-research-analyst'; dn='Daniel Okafor'; jt='Market Research Analyst';        dept='Research & Intelligence' }
    'kain@glyphor.ai'     = @{ key='technical-research-analyst'; dn='Kai Nakamura'; jt='Technical Research Analyst';   dept='Research & Intelligence' }
    'amara@glyphor.ai'    = @{ key='industry-research-analyst'; dn='Amara Diallo'; jt='Industry Research Analyst';     dept='Research & Intelligence' }
    'riya@glyphor.ai'     = @{ key='ai-impact-analyst'; dn='Riya Mehta';        jt='AI Impact Analyst';                dept='Strategy' }
    'marcusc@glyphor.ai'  = @{ key='org-analyst';       dn='Marcus Chen';       jt='Organizational & Talent Analyst';  dept='Strategy' }
    'ethan@glyphor.ai'    = @{ key='enterprise-account-researcher'; dn='Ethan Morse'; jt='Enterprise Account Researcher'; dept='Sales' }
    'bob@glyphor.ai'      = @{ key='bob-the-tax-pro';  dn='Robert Finley';     jt='CPA & Tax Strategist';             dept='Legal' }
    'grace@glyphor.ai'    = @{ key='data-integrity-auditor'; dn='Grace Hwang';  jt='Data Integrity Auditor';           dept='Legal' }
    'mariana@glyphor.ai'  = @{ key='tax-strategy-specialist'; dn='Mariana Solis'; jt='Tax Strategy Specialist';        dept='Legal' }
    'derek@glyphor.ai'    = @{ key='lead-gen-specialist'; dn='Derek Owens';     jt='Lead Generation Specialist';       dept='Sales' }
    'zara@glyphor.ai'     = @{ key='marketing-intelligence-analyst'; dn='Zara Petrov'; jt='Marketing Intelligence Analyst'; dept='Marketing' }
    'adi@glyphor.ai'      = @{ key='adi-rose';          dn='Adi Rose';          jt='Executive Assistant to COO';       dept='Executive Office' }
}

# ─── Get current users ──────────────────────────────────────────
Log 'Loading current users...'
$allUsers = @()
$uri = "/users?`$select=id,displayName,userPrincipalName&`$top=100"
while ($uri) {
    $page = GBeta -Method GET -Path $uri
    $allUsers += $page.value
    $uri = $page.'@odata.nextLink'
    if ($uri) { $uri = $uri -replace 'https://graph.microsoft.com/beta','' }
}
Log "  Total: $($allUsers.Count) users"

$agentUsers = $allUsers | Where-Object { $ProtectedUpns -notcontains $_.userPrincipalName }
Log "  Agents to migrate: $($agentUsers.Count)"

# ─── Process ────────────────────────────────────────────────────
$migrated = 0; $failed = 0; $skipped = 0

foreach ($u in $agentUsers) {
    $upn = $u.userPrincipalName.ToLower()
    $userId = $u.id
    $info = $agentMap[$upn]
    if (-not $info) { Log "SKIP (no mapping): $upn"; $skipped++; continue }

    $identityParentId = $realIds.($info.key)
    if (-not $identityParentId) { Log "SKIP (no identity): $upn key=$($info.key)"; $skipped++; continue }

    Log ''
    Log "─── $($info.dn) ($upn) ───"
    Log "  identityParentId: $identityParentId"

    try {
        # Delete current user
        Log '  Deleting...'
        GBeta -Method DELETE -Path "/users/$userId" | Out-Null
        Start-Sleep -Seconds 1

        # Purge from recycle bin
        Log '  Purging...'
        try { GBeta -Method DELETE -Path "/directory/deletedItems/$userId" | Out-Null }
        catch { Start-Sleep 3; try { GBeta -Method DELETE -Path "/directory/deletedItems/$userId" | Out-Null } catch { Log "  WARN purge: $_" } }
        Start-Sleep -Seconds 2

        # Create agentUser
        Log '  Creating agentUser...'
        $mailNickname = ($upn -split '@')[0]
        $body = @{
            '@odata.type'     = '#microsoft.graph.agentUser'
            accountEnabled    = $true
            displayName       = $info.dn
            mailNickname      = $mailNickname
            userPrincipalName = $upn
            identityParentId  = $identityParentId
        } | ConvertTo-Json -Depth 3

        $newUser = GBeta -Method POST -Path '/users' -Body $body
        $newId = $newUser.id
        Log "  Created: $newId"

        # Set usageLocation + metadata
        Log '  Setting properties...'
        GBeta -Method PATCH -Path "/users/$newId" -Body (@{
            usageLocation = 'US'
            jobTitle      = $info.jt
            department    = $info.dept
            companyName   = 'Glyphor AI'
        } | ConvertTo-Json) | Out-Null
        Start-Sleep 1

        # License
        Log '  Licensing...'
        try {
            GBeta -Method POST -Path "/users/$newId/assignLicense" -Body (@{
                addLicenses    = @(@{ skuId = $AgentLicenseSku; disabledPlans = @() })
                removeLicenses = @()
            } | ConvertTo-Json -Depth 3) | Out-Null
            Log '  Licensed'
        } catch { Log "  WARN license: $($_.Exception.Message)" }

        $migrated++
        Log '  DONE'
    } catch {
        $failed++
        Log "  FAILED: $($_.Exception.Message)"
        try { Log "  Detail: $($_.ErrorDetails.Message)" } catch {}
    }

    Start-Sleep -Milliseconds 500
}

Log ''
Log '═══════════════════════════════════════════════'
Log "  Migrated: $migrated"
Log "  Failed:   $failed"
Log "  Skipped:  $skipped"
Log '═══════════════════════════════════════════════'

#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Recovers deleted agent user accounts (without agentIdentityBlueprintId since
  the Graph API treats it as read-only even on POST).
#>

$ErrorActionPreference = 'Stop'
$TenantId = '19ab7456-f160-416d-a503-57298ab192a2'
$AgentLicenseSku = '304b93a3-b1f1-427f-aa02-da21e7c7d675'

function Log { param([string]$m); Write-Host "$(Get-Date -Format 'HH:mm:ss') $m" }

Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
$ctx = Get-MgContext -ErrorAction SilentlyContinue
if ($ctx -and $ctx.TenantId -eq $TenantId) {
    Log "Already connected as $($ctx.Account)"
} else {
    Connect-MgGraph -Scopes 'User.ReadWrite.All','Directory.ReadWrite.All' -TenantId $TenantId -NoWelcome
    $ctx = Get-MgContext
    Log "Connected as $($ctx.Account)"
}

function GV1 {
    param([string]$Method, [string]$Path, [string]$Body)
    $p = @{ Method = $Method; Uri = "https://graph.microsoft.com/v1.0$Path" }
    if ($Body) { $p.Body = $Body; $p.ContentType = 'application/json' }
    Invoke-MgGraphRequest @p
}

# Users that still exist — skip these
$existing = @()
$uri = "/users?`$select=userPrincipalName&`$top=100"
while ($uri) {
    $page = GV1 -Method GET -Path $uri
    $existing += $page.value | ForEach-Object { $_.userPrincipalName.ToLower() }
    $uri = $page.'@odata.nextLink'
    if ($uri) { $uri = $uri -replace 'https://graph.microsoft.com/v1.0','' }
}
Log "Existing users: $($existing.Count)"

# Agent definitions: displayName, UPN, jobTitle, department
$agents = @(
    @{ dn='Adi Rose';          upn='adi@glyphor.ai';      jt='Executive Assistant to COO';  dept='Executive Office' }
    @{ dn='Alex Park';         upn='alex@glyphor.ai';     jt='Platform Engineer';           dept='Engineering' }
    @{ dn='Amara Diallo';      upn='amara@glyphor.ai';    jt='Industry Research Analyst';   dept='Research & Intelligence' }
    @{ dn='Anna Park';         upn='anna@glyphor.ai';     jt='Revenue Analyst';             dept='Finance' }
    @{ dn='Atlas Vega';        upn='atlas@glyphor.ai';    jt='Operations & System Intelligence'; dept='Operations' }
    @{ dn='Ava Chen';          upn='ava@glyphor.ai';      jt='Frontend Engineer';           dept='Design & Frontend' }
    @{ dn='Robert Finley';     upn='bob@glyphor.ai';      jt='CPA & Tax Strategist';        dept='Legal' }
    @{ dn='Daniel Ortiz';      upn='daniel@glyphor.ai';   jt='Competitive Intel Analyst';   dept='Product' }
    @{ dn='David Santos';      upn='david@glyphor.ai';    jt='Support Triage';              dept='Customer Success' }
    @{ dn='Derek Owens';       upn='derek@glyphor.ai';    jt='Lead Generation Specialist';  dept='Sales' }
    @{ dn='Daniel Okafor';     upn='dokafor@glyphor.ai';  jt='Market Research Analyst';     dept='Research & Intelligence' }
    @{ dn='Elena Vasquez';     upn='elena@glyphor.ai';    jt='Chief Product Officer';       dept='Product' }
    @{ dn='Emma Wright';       upn='emma@glyphor.ai';     jt='Onboarding Specialist';       dept='Customer Success' }
    @{ dn='Ethan Morse';       upn='ethan@glyphor.ai';    jt='Enterprise Account Researcher'; dept='Sales' }
    @{ dn='Grace Hwang';       upn='grace@glyphor.ai';    jt='Data Integrity Auditor';      dept='Legal' }
    @{ dn='James Turner';      upn='james@glyphor.ai';    jt='VP Customer Success';         dept='Customer Success' }
    @{ dn='Jasmine Rivera';    upn='jasmine@glyphor.ai';  jt='Head of People & Culture';    dept='People & Culture' }
    @{ dn='Jordan Hayes';      upn='jordan@glyphor.ai';   jt='DevOps Engineer';             dept='Engineering' }
    @{ dn='Kai Johnson';       upn='kai@glyphor.ai';      jt='Social Media Manager';        dept='Marketing' }
    @{ dn='Kai Nakamura';      upn='kain@glyphor.ai';     jt='Technical Research Analyst';  dept='Research & Intelligence' }
    @{ dn='Lena Park';         upn='lena@glyphor.ai';     jt='Competitive Research Analyst'; dept='Research & Intelligence' }
    @{ dn='Leo Vargas';        upn='leo@glyphor.ai';      jt='UI/UX Designer';              dept='Design & Frontend' }
    @{ dn='Lisa Chen';         upn='lisa@glyphor.ai';     jt='SEO Analyst';                 dept='Marketing' }
    @{ dn='Marcus Reeves';     upn='marcus@glyphor.ai';   jt='Chief Technology Officer';    dept='Engineering' }
    @{ dn='Marcus Chen';       upn='marcusc@glyphor.ai';  jt='Organizational & Talent Analyst'; dept='Strategy' }
    @{ dn='Mariana Solis';     upn='mariana@glyphor.ai';  jt='Tax Strategy Specialist';     dept='Legal' }
    @{ dn='Maya Brooks';       upn='maya@glyphor.ai';     jt='Chief Marketing Officer';     dept='Marketing' }
    @{ dn='Mia Tanaka';        upn='mia@glyphor.ai';      jt='VP Design & Frontend';        dept='Design & Frontend' }
    @{ dn='Nadia Okafor';      upn='nadia@glyphor.ai';    jt='Chief Financial Officer';     dept='Finance' }
    @{ dn='Nathan Cole';       upn='nathan@glyphor.ai';   jt='Account Research';            dept='Sales' }
    @{ dn='Omar Hassan';       upn='omar@glyphor.ai';     jt='Cost Analyst';                dept='Finance' }
    @{ dn='Priya Sharma';      upn='priya@glyphor.ai';    jt='User Researcher';             dept='Product' }
    @{ dn='Rachel Kim';        upn='rachel@glyphor.ai';   jt='VP Sales';                    dept='Sales' }
    @{ dn='Riya Mehta';        upn='riya@glyphor.ai';     jt='AI Impact Analyst';           dept='Strategy' }
    @{ dn='Ryan Park';         upn='ryan@glyphor.ai';     jt='Template Architect';          dept='Design & Frontend' }
    @{ dn='Sam DeLuca';        upn='sam@glyphor.ai';      jt='Quality Engineer';            dept='Engineering' }
    @{ dn='Sarah Chen';        upn='sarah@glyphor.ai';    jt='Chief of Staff';              dept='Executive Office' }
    @{ dn='Sofia Marchetti';   upn='sofia@glyphor.ai';    jt='Design Critic';               dept='Design & Frontend' }
    @{ dn='Sophia Lin';        upn='sophia@glyphor.ai';   jt='VP Research & Intelligence';  dept='Research & Intelligence' }
    @{ dn='Tyler Reed';        upn='tyler@glyphor.ai';    jt='Content Creator';             dept='Marketing' }
    @{ dn='Victoria Chase';    upn='victoria@glyphor.ai'; jt='Chief Legal Officer';         dept='Legal' }
    @{ dn='Zara Petrov';       upn='zara@glyphor.ai';     jt='Marketing Intelligence Analyst'; dept='Marketing' }
)

$created = 0; $skipped = 0; $failed = 0

foreach ($a in $agents) {
    if ($existing -contains $a.upn.ToLower()) {
        Log "SKIP (exists): $($a.dn) ($($a.upn))"
        $skipped++
        continue
    }

    Log "Creating $($a.dn) ($($a.upn))..."
    $mailNick = ($a.upn -split '@')[0]
    $body = @{
        accountEnabled    = $true
        displayName       = $a.dn
        mailNickname      = $mailNick
        userPrincipalName = $a.upn
        jobTitle          = $a.jt
        department        = $a.dept
        companyName       = 'Glyphor AI'
        passwordProfile   = @{
            forceChangePasswordNextSignIn = $false
            password = "Glyphor!Agent$(Get-Random -Minimum 100000 -Maximum 999999)"
        }
    } | ConvertTo-Json -Depth 3

    try {
        $newUser = GV1 -Method POST -Path '/users' -Body $body
        Log "  Created: $($newUser.id)"

        # Assign license
        Start-Sleep -Seconds 1
        $licBody = @{
            addLicenses    = @( @{ skuId = $AgentLicenseSku; disabledPlans = @() } )
            removeLicenses = @()
        } | ConvertTo-Json -Depth 3

        try {
            GV1 -Method POST -Path "/users/$($newUser.id)/assignLicense" -Body $licBody | Out-Null
            Log "  License assigned"
        } catch {
            Log "  WARN: License failed: $($_.Exception.Message)"
        }

        $created++
    } catch {
        $failed++
        Log "  FAILED: $($_.Exception.Message)"
        try { Log "  Detail: $($_.ErrorDetails.Message)" } catch {}
    }

    Start-Sleep -Milliseconds 300
}

Log ''
Log '═══════════════════════════════════════════════'
Log "  Created: $created"
Log "  Skipped: $skipped"
Log "  Failed:  $failed"
Log '═══════════════════════════════════════════════'

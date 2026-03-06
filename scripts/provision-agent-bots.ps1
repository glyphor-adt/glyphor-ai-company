<#
.SYNOPSIS
  Provisions Azure Bot Service registrations for all 42 Glyphor agents.
  Skips agents that already have bot registrations.
  Creates Entra apps, secrets, Azure Bot resources, Teams channels,
  and updates Teams manifest files.
.NOTES
  Must be run with az login'd session to the Glyphor tenant.
  Tenant: 19ab7456-f160-416d-a503-57298ab192a2
  Resource Group: glyphor-resources
#>

$ErrorActionPreference = "Stop"

$TenantId       = "19ab7456-f160-416d-a503-57298ab192a2"
$ResourceGroup  = "glyphor-resources"
$BotEndpoint    = "https://glyphor-scheduler-v55622rp6q-uc.a.run.app/api/teams/messages"
$TeamsAgentsDir = Join-Path $PSScriptRoot ".." "teams" "agents"

# Full mapping: directory-name → role-slug
$AgentRoleMap = @{
    "adi-rose"          = "adi-rose"
    "alex-park"         = "platform-engineer"
    "amara-diallo"      = "industry-research-analyst"
    "anna-park"         = "revenue-analyst"
    "atlas-vega"        = "ops"
    "ava-chen"          = "frontend-engineer"
    "bob-finley"        = "bob-the-tax-pro"
    "daniel-okafor"     = "market-research-analyst"
    "daniel-ortiz"      = "competitive-intel"
    "david-santos"      = "support-triage"
    "derek-owens"       = "lead-gen-specialist"
    "elena-vasquez"     = "cpo"
    "emma-wright"       = "onboarding-specialist"
    "ethan-morse"       = "enterprise-account-researcher"
    "grace-hwang"       = "data-integrity-auditor"
    "james-turner"      = "vp-customer-success"
    "jasmine-rivera"    = "head-of-hr"
    "jordan-hayes"      = "devops-engineer"
    "kai-johnson"       = "social-media-manager"
    "kai-nakamura"      = "technical-research-analyst"
    "lena-park"         = "competitive-research-analyst"
    "leo-vargas"        = "ui-ux-designer"
    "lisa-chen"         = "seo-analyst"
    "marcus-reeves"     = "cto"
    "mariana-solis"     = "tax-strategy-specialist"
    "maya-brooks"       = "cmo"
    "mia-tanaka"        = "vp-design"
    "morgan-blake"      = "global-admin"
    "nadia-okafor"      = "cfo"
    "nathan-cole"       = "account-research"
    "omar-hassan"       = "cost-analyst"
    "priya-sharma"      = "user-researcher"
    "rachel-kim"        = "vp-sales"
    "riley-morgan"      = "m365-admin"
    "ryan-park"         = "template-architect"
    "sam-deluca"        = "quality-engineer"
    "sarah-chen"        = "chief-of-staff"
    "sofia-marchetti"   = "design-critic"
    "sophia-lin"        = "vp-research"
    "tyler-reed"        = "content-creator"
    "victoria-chase"    = "clo"
    "zara-petrov"       = "marketing-intelligence-analyst"
}

# Human-readable names from manifest short names
$AgentNameMap = @{
    "adi-rose"          = "Adi Rose"
    "alex-park"         = "Alex Park"
    "amara-diallo"      = "Amara Diallo"
    "anna-park"         = "Anna Park"
    "atlas-vega"        = "Atlas Vega"
    "ava-chen"          = "Ava Chen"
    "bob-finley"        = "Bob Finley"
    "daniel-okafor"     = "Daniel Okafor"
    "daniel-ortiz"      = "Daniel Ortiz"
    "david-santos"      = "David Santos"
    "derek-owens"       = "Derek Owens"
    "elena-vasquez"     = "Elena Vasquez"
    "emma-wright"       = "Emma Wright"
    "ethan-morse"       = "Ethan Morse"
    "grace-hwang"       = "Grace Hwang"
    "james-turner"      = "James Turner"
    "jasmine-rivera"    = "Jasmine Rivera"
    "jordan-hayes"      = "Jordan Hayes"
    "kai-johnson"       = "Kai Johnson"
    "kai-nakamura"      = "Kai Nakamura"
    "lena-park"         = "Lena Park"
    "leo-vargas"        = "Leo Vargas"
    "lisa-chen"         = "Lisa Chen"
    "marcus-reeves"     = "Marcus Reeves"
    "mariana-solis"     = "Mariana Solis"
    "maya-brooks"       = "Maya Brooks"
    "mia-tanaka"        = "Mia Tanaka"
    "morgan-blake"      = "Morgan Blake"
    "nadia-okafor"      = "Nadia Okafor"
    "nathan-cole"       = "Nathan Cole"
    "omar-hassan"       = "Omar Hassan"
    "priya-sharma"      = "Priya Sharma"
    "rachel-kim"        = "Rachel Kim"
    "riley-morgan"      = "Riley Morgan"
    "ryan-park"         = "Ryan Park"
    "sam-deluca"        = "Sam DeLuca"
    "sarah-chen"        = "Sarah Chen"
    "sofia-marchetti"   = "Sofia Marchetti"
    "sophia-lin"        = "Sophia Lin"
    "tyler-reed"        = "Tyler Reed"
    "victoria-chase"    = "Victoria Chase"
    "zara-petrov"       = "Zara Petrov"
}

# ─── Discover existing bots ──────────────────────────────────────
Write-Host "`n=== Checking existing Azure Bot registrations ===" -ForegroundColor Cyan

$existingBots = az resource list --resource-type "Microsoft.BotService/botServices" --resource-group $ResourceGroup --query "[].name" -o json | ConvertFrom-Json
Write-Host "Found $($existingBots.Count) existing bots: $($existingBots -join ', ')"

# Build a set of agent directories that already have bots (by naming convention: glyphor-{dir-name})
$existingBotDirs = @{}
foreach ($botName in $existingBots) {
    if ($botName -match "^glyphor-(.+)$") {
        $existingBotDirs[$Matches[1]] = $true
    }
}

# ─── Provision missing bots ──────────────────────────────────────
$results = @()
$agentBotEntries = @()

# First, collect existing bot entries from the current AGENT_BOTS secret
Write-Host "`n=== Loading existing AGENT_BOTS secret ===" -ForegroundColor Cyan
$existingAgentBots = gcloud secrets versions access latest --secret=agent-bots --project=ai-glyphor-company 2>$null | ConvertFrom-Json
if ($existingAgentBots) {
    Write-Host "Loaded $($existingAgentBots.Count) existing entries"
    $agentBotEntries += $existingAgentBots
}

$toProvision = $AgentRoleMap.Keys | Where-Object { -not $existingBotDirs.ContainsKey($_) } | Sort-Object
Write-Host "`n=== Need to provision $($toProvision.Count) new bots ===" -ForegroundColor Yellow

foreach ($dirName in $toProvision) {
    $role = $AgentRoleMap[$dirName]
    $name = $AgentNameMap[$dirName]
    $botResourceName = "glyphor-$dirName"
    $appDisplayName = "Glyphor Bot - $name"

    Write-Host "`n--- Provisioning: $name ($role) ---" -ForegroundColor Green

    # Step 1: Create Entra app registration
    Write-Host "  Creating Entra app: $appDisplayName"
    $appJson = az ad app create `
        --display-name $appDisplayName `
        --sign-in-audience AzureADMyOrg `
        --query "{appId: appId, id: id}" `
        -o json 2>$null

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR creating Entra app" -ForegroundColor Red
        $results += [PSCustomObject]@{ Agent = $name; Status = "FAILED"; Step = "Entra app"; Error = "az ad app create failed" }
        continue
    }

    $appInfo = $appJson | ConvertFrom-Json
    $appId = $appInfo.appId
    Write-Host "  App ID: $appId"

    # Step 2: Create client secret
    Write-Host "  Creating client secret..."
    $credJson = az ad app credential reset `
        --id $appId `
        --display-name "bot-secret" `
        --years 2 `
        --query "{password: password}" `
        -o json 2>$null

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR creating secret" -ForegroundColor Red
        $results += [PSCustomObject]@{ Agent = $name; Status = "FAILED"; Step = "Secret"; Error = "credential reset failed" }
        continue
    }

    $credInfo = $credJson | ConvertFrom-Json
    $appSecret = $credInfo.password

    # Step 3: Create Azure Bot resource
    Write-Host "  Creating Azure Bot: $botResourceName"
    $botResult = az bot create `
        --name $botResourceName `
        --resource-group $ResourceGroup `
        --app-type SingleTenant `
        --appid $appId `
        --tenant-id $TenantId `
        --endpoint $BotEndpoint `
        --sku F0 `
        -o json 2>$null

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR creating bot" -ForegroundColor Red
        $results += [PSCustomObject]@{ Agent = $name; Status = "FAILED"; Step = "Bot"; Error = "az bot create failed" }
        continue
    }

    # Step 4: Enable Teams channel
    Write-Host "  Enabling Teams channel..."
    $teamsResult = az bot msteams create `
        --name $botResourceName `
        --resource-group $ResourceGroup `
        -o json 2>$null

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  WARNING: Teams channel may already exist: $teamsResult" -ForegroundColor Yellow
    }

    # Step 5: Update Teams manifest
    $manifestPath = Join-Path $TeamsAgentsDir $dirName "manifest.json"
    if (Test-Path $manifestPath) {
        Write-Host "  Updating manifest: $manifestPath"
        $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

        $manifest.id = $appId
        $manifest.bots[0].botId = $appId

        $manifest | ConvertTo-Json -Depth 10 | Set-Content $manifestPath -Encoding UTF8
        Write-Host "  Manifest updated with appId: $appId"

        # Step 6: Rebuild zip
        $zipPath = Join-Path $TeamsAgentsDir $dirName "$dirName.zip"
        $manifestDir = Join-Path $TeamsAgentsDir $dirName
        if (Test-Path $zipPath) { Remove-Item $zipPath }
        Compress-Archive -Path (Join-Path $manifestDir "*") -DestinationPath $zipPath
        Write-Host "  Rebuilt zip: $zipPath"
    } else {
        Write-Host "  WARNING: No manifest found at $manifestPath" -ForegroundColor Yellow
    }

    # Add to agent bots list
    $agentBotEntries += [PSCustomObject]@{
        appId     = $appId
        appSecret = $appSecret
        role      = $role
        name      = $name
    }

    $results += [PSCustomObject]@{ Agent = $name; Status = "OK"; AppId = $appId; Role = $role }
    Write-Host "  SUCCESS" -ForegroundColor Green
}

# ─── Update AGENT_BOTS secret ────────────────────────────────────
if ($toProvision.Count -gt 0) {
    Write-Host "`n=== Updating AGENT_BOTS GCP secret ===" -ForegroundColor Cyan
    Write-Host "Total entries: $($agentBotEntries.Count)"

    $secretJson = $agentBotEntries | ConvertTo-Json -Depth 5 -Compress
    $tempFile = [System.IO.Path]::GetTempFileName()
    $secretJson | Set-Content $tempFile -Encoding UTF8

    gcloud secrets versions add agent-bots --data-file=$tempFile --project=ai-glyphor-company
    Remove-Item $tempFile

    if ($LASTEXITCODE -eq 0) {
        Write-Host "AGENT_BOTS secret updated successfully" -ForegroundColor Green
    } else {
        Write-Host "ERROR updating AGENT_BOTS secret" -ForegroundColor Red
    }
}

# ─── Summary ─────────────────────────────────────────────────────
Write-Host "`n=== PROVISIONING SUMMARY ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize

$okCount = ($results | Where-Object { $_.Status -eq "OK" }).Count
$failCount = ($results | Where-Object { $_.Status -eq "FAILED" }).Count
Write-Host "Provisioned: $okCount | Failed: $failCount | Already existed: $($AgentRoleMap.Count - $toProvision.Count)"

if ($okCount -gt 0) {
    Write-Host "`n=== NEXT STEPS ===" -ForegroundColor Yellow
    Write-Host "1. Rebuild & deploy scheduler: gcloud builds submit --config=cloudbuild-scheduler.yaml"
    Write-Host "2. Re-sideload updated Teams app zips in Teams Admin Center"
    Write-Host "3. Update AGENT_DISPLAY and AGENT_ALIASES in bot.ts with new agents"
}

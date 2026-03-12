#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Phase 1: Authenticate as the Blueprint app and create real AgentIdentity SPs
  for all 44 agents. Output results to agentIdentitiesReal.json.
#>

$ErrorActionPreference = 'Stop'
$TenantId = '19ab7456-f160-416d-a503-57298ab192a2'
$BlueprintAppId = 'b47da287-6b05-4be3-9807-3f49047fbbb8'
$BlueprintSecret = $env:BLUEPRINT_CLIENT_SECRET
if (-not $BlueprintSecret) { throw "Set BLUEPRINT_CLIENT_SECRET env var before running this script" }
$SponsorId = '88a731d1-3171-4279-aee1-34160898ab90'

function Log { param([string]$m); Write-Host "$(Get-Date -Format 'HH:mm:ss') $m" }

# 44 agents
$agents = @(
    @{ key='chief-of-staff';               name='Sarah Chen' }
    @{ key='cto';                          name='Marcus Reeves' }
    @{ key='cfo';                          name='Nadia Okafor' }
    @{ key='cpo';                          name='Elena Vasquez' }
    @{ key='cmo';                          name='Maya Brooks' }
    @{ key='clo';                          name='Victoria Chase' }
    @{ key='vp-customer-success';          name='James Turner' }
    @{ key='vp-sales';                     name='Rachel Kim' }
    @{ key='vp-design';                    name='Mia Tanaka' }
    @{ key='platform-engineer';            name='Alex Park' }
    @{ key='quality-engineer';             name='Sam DeLuca' }
    @{ key='devops-engineer';              name='Jordan Hayes' }
    @{ key='m365-admin';                   name='Riley Morgan' }
    @{ key='user-researcher';              name='Priya Sharma' }
    @{ key='competitive-intel';            name='Daniel Ortiz' }
    @{ key='revenue-analyst';              name='Anna Park' }
    @{ key='cost-analyst';                 name='Omar Hassan' }
    @{ key='content-creator';              name='Tyler Reed' }
    @{ key='seo-analyst';                  name='Lisa Chen' }
    @{ key='social-media-manager';         name='Kai Johnson' }
    @{ key='onboarding-specialist';        name='Emma Wright' }
    @{ key='support-triage';               name='David Santos' }
    @{ key='account-research';             name='Nathan Cole' }
    @{ key='ui-ux-designer';              name='Leo Vargas' }
    @{ key='frontend-engineer';            name='Ava Chen' }
    @{ key='design-critic';               name='Sofia Marchetti' }
    @{ key='template-architect';           name='Ryan Park' }
    @{ key='ops';                          name='Atlas Vega' }
    @{ key='global-admin';                 name='Morgan Blake' }
    @{ key='head-of-hr';                  name='Jasmine Rivera' }
    @{ key='vp-research';                  name='Sophia Lin' }
    @{ key='competitive-research-analyst'; name='Lena Park' }
    @{ key='market-research-analyst';      name='Daniel Okafor' }
    @{ key='technical-research-analyst';   name='Kai Nakamura' }
    @{ key='industry-research-analyst';    name='Amara Diallo' }
    @{ key='ai-impact-analyst';            name='Riya Mehta' }
    @{ key='org-analyst';                  name='Marcus Chen' }
    @{ key='enterprise-account-researcher'; name='Ethan Morse' }
    @{ key='bob-the-tax-pro';              name='Robert Finley' }
    @{ key='data-integrity-auditor';       name='Grace Hwang' }
    @{ key='tax-strategy-specialist';      name='Mariana Solis' }
    @{ key='lead-gen-specialist';          name='Derek Owens' }
    @{ key='marketing-intelligence-analyst'; name='Zara Petrov' }
    @{ key='adi-rose';                     name='Adi Rose' }
)

# ─── Connect as Blueprint ───────────────────────────────────────
Log 'Connecting as Blueprint app...'
Disconnect-MgGraph -ErrorAction SilentlyContinue
$secSecret = ConvertTo-SecureString $BlueprintSecret -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($BlueprintAppId, $secSecret)
Connect-MgGraph -TenantId $TenantId -ClientSecretCredential $cred -NoWelcome
$ctx = Get-MgContext
Log "  Connected: $($ctx.AppName) Scopes=$($ctx.Scopes -join ',')"

# ─── Skip the test SP we already created ─────────────────────────
# 8147358d-2192-4e61-a341-a162e5c809fe was the test Sarah Chen identity

# ─── Create AgentIdentity SPs ───────────────────────────────────
$results = @{}
$created = 0; $failed = 0

# We already created Sarah Chen test identity: 8147358d-2192-4e61-a341-a162e5c809fe
# Include it in results and skip creating another one
$results['chief-of-staff'] = '8147358d-2192-4e61-a341-a162e5c809fe'
Log "SKIP chief-of-staff (already created): 8147358d-2192-4e61-a341-a162e5c809fe"

foreach ($agent in $agents) {
    if ($agent.key -eq 'chief-of-staff') { continue }

    $displayName = "Glyphor Agent Identity - $($agent.name)"
    Log "Creating: $displayName..."

    $body = @{
        '@odata.type'             = 'Microsoft.Graph.AgentIdentity'
        displayName               = $displayName
        agentIdentityBlueprintId  = $BlueprintAppId
        'sponsors@odata.bind'     = @("https://graph.microsoft.com/beta/users/$SponsorId")
    } | ConvertTo-Json -Depth 3

    try {
        $r = Invoke-MgGraphRequest -Method POST `
            -Uri 'https://graph.microsoft.com/beta/servicePrincipals/Microsoft.Graph.AgentIdentity' `
            -Body $body -ContentType 'application/json'
        $results[$agent.key] = $r.id
        $created++
        Log "  OK: $($r.id)"
    } catch {
        $failed++
        Log "  FAILED: $($_.Exception.Message)"
        try { Log "  Detail: $($_.ErrorDetails.Message)" } catch {}
    }

    Start-Sleep -Milliseconds 300
}

# ─── Save results ───────────────────────────────────────────────
$outFile = Join-Path $PSScriptRoot 'agent-identity-real-ids.json'
$results | ConvertTo-Json | Set-Content $outFile -Encoding UTF8
Log ''
Log '═══════════════════════════════════════════════'
Log "  Created: $created  (+ 1 pre-existing = $($created + 1) total)"
Log "  Failed:  $failed"
Log "  Saved:   $outFile"
Log '═══════════════════════════════════════════════'

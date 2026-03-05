# Upload agent avatar photos to Entra ID (shows in Teams, Outlook, etc.)
# Uses: PUT /users/{upn}/photo/$value via Microsoft Graph
#
# Requires: Connect-MgGraph -Scopes User.ReadWrite.All

$avatarDir = Join-Path $PSScriptRoot '..' 'packages' 'dashboard' 'public' 'avatars'

# role-key → UPN mapping (from create-agent-users-phase2.ps1)
$roleToUpn = @{
    'chief-of-staff'              = 'sarah@glyphor.ai'
    'cto'                         = 'marcus@glyphor.ai'
    'cfo'                         = 'nadia@glyphor.ai'
    'cpo'                         = 'elena@glyphor.ai'
    'cmo'                         = 'maya@glyphor.ai'
    'clo'                         = 'victoria@glyphor.ai'
    'vp-customer-success'         = 'james@glyphor.ai'
    'vp-sales'                    = 'rachel@glyphor.ai'
    'vp-design'                   = 'mia@glyphor.ai'
    'platform-engineer'           = 'alex@glyphor.ai'
    'quality-engineer'            = 'sam@glyphor.ai'
    'devops-engineer'             = 'jordan@glyphor.ai'
    'm365-admin'                  = 'riley@glyphor.ai'
    'user-researcher'             = 'priya@glyphor.ai'
    'competitive-intel'           = 'daniel@glyphor.ai'
    'revenue-analyst'             = 'anna@glyphor.ai'
    'cost-analyst'                = 'omar@glyphor.ai'
    'content-creator'             = 'tyler@glyphor.ai'
    'seo-analyst'                 = 'lisa@glyphor.ai'
    'social-media-manager'        = 'kai@glyphor.ai'
    'onboarding-specialist'       = 'emma@glyphor.ai'
    'support-triage'              = 'david@glyphor.ai'
    'account-research'            = 'nathan@glyphor.ai'
    'ui-ux-designer'              = 'leo@glyphor.ai'
    'frontend-engineer'           = 'ava@glyphor.ai'
    'design-critic'               = 'sofia@glyphor.ai'
    'template-architect'          = 'ryan@glyphor.ai'
    'ops'                         = 'atlas@glyphor.ai'
    'global-admin'                = 'morgan@glyphor.ai'
    'head-of-hr'                  = 'jasmine@glyphor.ai'
    'vp-research'                 = 'sophia@glyphor.ai'
    'competitive-research-analyst'= 'lena@glyphor.ai'
    'market-research-analyst'     = 'dokafor@glyphor.ai'
    'technical-research-analyst'  = 'kain@glyphor.ai'
    'industry-research-analyst'   = 'amara@glyphor.ai'
    'ai-impact-analyst'           = 'riya@glyphor.ai'
    'org-analyst'                 = 'marcusc@glyphor.ai'
    'enterprise-account-researcher'= 'ethan@glyphor.ai'
    'bob-the-tax-pro'             = 'bob@glyphor.ai'
    'data-integrity-auditor'      = 'grace@glyphor.ai'
    'tax-strategy-specialist'     = 'mariana@glyphor.ai'
    'lead-gen-specialist'         = 'derek@glyphor.ai'
    'marketing-intelligence-analyst'= 'zara@glyphor.ai'
    'adi-rose'                    = 'adi@glyphor.ai'
}

$uploaded = 0; $skipped = 0; $failed = 0

foreach ($entry in $roleToUpn.GetEnumerator()) {
    $role = $entry.Key
    $upn = $entry.Value
    $photoPath = Join-Path $avatarDir "$role.png"

    if (-not (Test-Path $photoPath)) {
        Write-Host "SKIP: $role (no avatar file)"
        $skipped++
        continue
    }

    try {
        $photoBytes = [System.IO.File]::ReadAllBytes($photoPath)
        Invoke-MgGraphRequest -Method PUT `
            -Uri "https://graph.microsoft.com/v1.0/users/$upn/photo/`$value" `
            -Body $photoBytes `
            -ContentType 'image/png' `
            -ErrorAction Stop
        Write-Host "OK: $role -> $upn"
        $uploaded++
    } catch {
        $msg = $_.Exception.Message
        if ($msg.Length -gt 120) { $msg = $msg.Substring(0, 120) }
        Write-Host "FAIL: $role -> $upn - $msg"
        $failed++
    }
}

Write-Host ""
Write-Host "=== DONE ==="
Write-Host "Uploaded: $uploaded"
Write-Host "Skipped: $skipped"
Write-Host "Failed: $failed"

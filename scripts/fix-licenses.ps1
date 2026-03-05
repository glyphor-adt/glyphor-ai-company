#!/usr/bin/env pwsh
$ErrorActionPreference = 'Continue'
Import-Module Microsoft.Graph.Authentication
$ctx = Get-MgContext -ErrorAction SilentlyContinue
if (-not $ctx -or $ctx.TenantId -ne '19ab7456-f160-416d-a503-57298ab192a2') {
    Connect-MgGraph -Scopes 'User.ReadWrite.All','Directory.ReadWrite.All' -TenantId '19ab7456-f160-416d-a503-57298ab192a2' -NoWelcome
}
$skip = @('kristina@glyphor.ai','andrew@glyphor.ai','andrew.zwelling_gmail.com#EXT#@glyphorai.onmicrosoft.com')
$sku = '304b93a3-b1f1-427f-aa02-da21e7c7d675'

$all = @(); $uri = "/users?`$select=id,displayName,userPrincipalName,usageLocation,assignedLicenses&`$top=100"
while ($uri) {
    $p = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0$uri"
    $all += $p.value
    $uri = $p.'@odata.nextLink'
    if ($uri) { $uri = $uri -replace 'https://graph.microsoft.com/v1.0','' }
}

$agents = $all | Where-Object { $skip -notcontains $_.userPrincipalName }
Write-Host "Agents to process: $($agents.Count)"

$ok = 0; $already = 0; $fail = 0
foreach ($a in $agents) {
    $uid = $a.id
    $name = $a.displayName

    # Check if already licensed
    $hasLic = $a.assignedLicenses | Where-Object { $_.skuId -eq $sku }
    if ($hasLic) {
        $already++
        continue
    }

    # Set usageLocation if missing
    if (-not $a.usageLocation) {
        try {
            Invoke-MgGraphRequest -Method PATCH -Uri "https://graph.microsoft.com/v1.0/users/$uid" -Body (@{usageLocation='US'} | ConvertTo-Json) -ContentType 'application/json'
        } catch {
            Write-Host "PATCH FAIL $name`: $_"
            $fail++
            continue
        }
    }

    # Assign license
    $licBody = @{ addLicenses = @(@{ skuId = $sku; disabledPlans = @() }); removeLicenses = @() } | ConvertTo-Json -Depth 3
    try {
        Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/v1.0/users/$uid/assignLicense" -Body $licBody -ContentType 'application/json' | Out-Null
        $ok++
        Write-Host "OK: $name"
    } catch {
        $fail++
        Write-Host "LIC FAIL $name`: $($_.ErrorDetails.Message)"
    }
    Start-Sleep -Milliseconds 300
}
Write-Host ""
Write-Host "Licensed: $ok  Already: $already  Failed: $fail"

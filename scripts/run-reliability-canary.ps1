[CmdletBinding(PositionalBinding = $false)]
param(
  [switch]$SkipMigrations,
  [switch]$SkipValidation,
  [string]$ValueRatioThreshold = '2.5',
  [string]$ConfidenceThreshold = '0.6',
  [string]$RetryCap = '3'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Step {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][scriptblock]$Action
  )

  Write-Host ""
  Write-Host "=== $Name ===" -ForegroundColor Cyan
  & $Action
}

function Invoke-CommandChecked {
  param(
    [Parameter(Mandatory)][string]$Command,
    [Parameter(Mandatory)][string[]]$Arguments
  )
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $Command $($Arguments -join ' ')"
  }
}

Invoke-Step -Name 'Resolve repository root' -Action {
  $scriptDir = Split-Path -Parent $PSCommandPath
  $repoRoot = Resolve-Path (Join-Path $scriptDir '..')
  Set-Location $repoRoot
  Write-Host "Repo root: $repoRoot"
}

Invoke-Step -Name 'Set canary environment flags' -Action {
  $env:AGENT_RUN_LEDGER_ENABLED = 'true'
  $env:TOOL_VALUE_GATE_RATIO_THRESHOLD = $ValueRatioThreshold
  $env:TOOL_VALUE_GATE_CONFIDENCE_THRESHOLD = $ConfidenceThreshold
  $env:TOOL_RETRY_CAP = $RetryCap

  Write-Host "AGENT_RUN_LEDGER_ENABLED=$env:AGENT_RUN_LEDGER_ENABLED"
  Write-Host "TOOL_VALUE_GATE_RATIO_THRESHOLD=$env:TOOL_VALUE_GATE_RATIO_THRESHOLD"
  Write-Host "TOOL_VALUE_GATE_CONFIDENCE_THRESHOLD=$env:TOOL_VALUE_GATE_CONFIDENCE_THRESHOLD"
  Write-Host "TOOL_RETRY_CAP=$env:TOOL_RETRY_CAP"
}

if (-not $SkipMigrations) {
  Invoke-Step -Name 'Apply pending migrations' -Action {
    Invoke-CommandChecked -Command 'npm' -Arguments @('run', 'db:apply-pending')
  }
} else {
  Write-Host ""
  Write-Host "=== Apply pending migrations ===" -ForegroundColor Cyan
  Write-Host "Skipped (-SkipMigrations)"
}

if (-not $SkipValidation) {
  Invoke-Step -Name 'Run reliability canary validation SQL bundle' -Action {
    Invoke-CommandChecked -Command 'npx' -Arguments @('tsx', 'scripts/reliability-canary-validate.ts')
  }
} else {
  Write-Host ""
  Write-Host "=== Run reliability canary validation SQL bundle ===" -ForegroundColor Cyan
  Write-Host "Skipped (-SkipValidation)"
}

Write-Host ""
Write-Host "Canary setup complete." -ForegroundColor Green
Write-Host "Next:"
Write-Host "  1) Run representative canary traffic."
Write-Host "  2) Replay samples: npm run run:replay -- --run-id <uuid>"
Write-Host "  3) Re-run this script (or validator) after traffic."

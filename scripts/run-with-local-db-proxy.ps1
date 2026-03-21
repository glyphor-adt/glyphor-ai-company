[CmdletBinding(PositionalBinding = $false)]
param(
  [ValidateSet('app', 'system')]
  [string]$DbRole = 'app',

  [string]$Project = 'ai-glyphor-company',

  [string]$Instance = 'ai-glyphor-company:us-central1:glyphor-db',

  [int]$Port = 15432,

  [string]$DbName = 'glyphor',

  [int]$SecretTimeoutSeconds = 20,

  [switch]$SkipProxyStart,

  [switch]$PrintEnv,

  [string]$Run,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RunArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-LocalPortListening {
  param([int]$LocalPort)

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect('127.0.0.1', $LocalPort, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(750)) {
      return $false
    }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Ensure-ProxyListening {
  param(
    [string]$ProxyBin,
    [string]$ConnectionName,
    [int]$LocalPort,
    [switch]$NoStart
  )

  if (Test-LocalPortListening -LocalPort $LocalPort) {
    return
  }

  if ($NoStart) {
    throw "No listener found on 127.0.0.1:$LocalPort and -SkipProxyStart was provided."
  }

  $args = @($ConnectionName, '--port', "$LocalPort")
  Start-Process -FilePath $ProxyBin -ArgumentList $args -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 2

  if (-not (Test-LocalPortListening -LocalPort $LocalPort)) {
    throw "cloud-sql-proxy did not start on port $LocalPort."
  }
}

function Resolve-DbIdentity {
  param([string]$Role)

  if ($Role -eq 'system') {
    return @{
      User = 'glyphor_system_user'
      SecretName = 'db-system-password'
    }
  }

  return @{
    User = 'glyphor_app'
    SecretName = 'db-password'
  }
}

function Resolve-DbPassword {
  param(
    [string]$SecretName,
    [string]$ProjectId,
    [int]$TimeoutSeconds
  )

  if ($env:DB_PASSWORD -and $env:DB_PASSWORD.Trim().Length -gt 0) {
    return $env:DB_PASSWORD.Trim()
  }

  $gcloud = Get-Command gcloud -ErrorAction SilentlyContinue
  if (-not $gcloud) {
    throw 'gcloud is not available in PATH.'
  }

  $job = Start-Job -ScriptBlock {
    param(
      [string]$GcloudPath,
      [string]$Secret,
      [string]$Project
    )

    $output = (& $GcloudPath secrets versions access latest "--secret=$Secret" "--project=$Project" --quiet 2>&1 | Out-String).Trim()
    [pscustomobject]@{
      ExitCode = $LASTEXITCODE
      Output = $output
    }
  } -ArgumentList $gcloud.Path, $SecretName, $ProjectId

  try {
    if (-not (Wait-Job -Job $job -Timeout $TimeoutSeconds)) {
      Stop-Job -Job $job -ErrorAction SilentlyContinue | Out-Null
      throw "Timed out after $TimeoutSeconds seconds reading secret '$SecretName' from project '$ProjectId'."
    }

    $result = Receive-Job -Job $job -ErrorAction SilentlyContinue
    $value = "$($result.Output)".Trim()
    if ($result.ExitCode -eq 0 -and $value) {
      return $value
    }

    if ($value) {
      throw "Failed to read secret '$SecretName' from project '$ProjectId': $value"
    }
  } finally {
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue | Out-Null
  }

  throw "Failed to read secret '$SecretName' from project '$ProjectId'. Set DB_PASSWORD in the shell to bypass secret lookup."
}

$proxy = Get-Command cloud-sql-proxy -ErrorAction SilentlyContinue
if (-not $proxy) {
  throw 'cloud-sql-proxy is not available in PATH.'
}

$identity = Resolve-DbIdentity -Role $DbRole
Ensure-ProxyListening -ProxyBin $proxy.Source -ConnectionName $Instance -LocalPort $Port -NoStart:$SkipProxyStart
$dbPassword = Resolve-DbPassword -SecretName $identity.SecretName -ProjectId $Project -TimeoutSeconds $SecretTimeoutSeconds

$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = "$Port"
$env:DB_NAME = $DbName
$env:DB_USER = $identity.User
$env:DB_PASSWORD = $dbPassword
$env:PGPASSWORD = $dbPassword
$env:PGHOST = $env:DB_HOST
$env:PGPORT = $env:DB_PORT
$env:PGDATABASE = $env:DB_NAME
$env:PGUSER = $env:DB_USER

$encodedUser = [System.Uri]::EscapeDataString($env:DB_USER)
$encodedPassword = [System.Uri]::EscapeDataString($dbPassword)
$encodedDbName = [System.Uri]::EscapeDataString($env:DB_NAME)
$env:DATABASE_URL = "postgresql://${encodedUser}:${encodedPassword}@127.0.0.1:$($env:DB_PORT)/${encodedDbName}"
$env:DB_AUTH_SOURCE = 'database_url'

if ($PrintEnv) {
  Write-Host "DB_HOST=$env:DB_HOST"
  Write-Host "DB_PORT=$env:DB_PORT"
  Write-Host "DB_NAME=$env:DB_NAME"
  Write-Host "DB_USER=$env:DB_USER"
  Write-Host "DB_PASSWORD=[set]"
  Write-Host "DATABASE_URL=[set]"
  Write-Host "DB_AUTH_SOURCE=$env:DB_AUTH_SOURCE"
}

if (-not $Run) {
  Write-Host "Local DB env ready (role=$DbRole, user=$($identity.User), port=$Port)."
  Write-Host 'Run your command in this same shell, or pass -Run <exe> <args...> to this script.'
  exit 0
}

& $Run @RunArgs
exit $LASTEXITCODE

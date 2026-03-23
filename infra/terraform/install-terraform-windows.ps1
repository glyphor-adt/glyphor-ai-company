# Install Terraform to your user profile (avoids broken winget portable / PATH issues).
# Run in PowerShell:  powershell -ExecutionPolicy Bypass -File infra/terraform/install-terraform-windows.ps1
# Then open a NEW terminal and run:  terraform version

$ErrorActionPreference = 'Stop'
$version = '1.14.7'
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\Terraform'
$zipUrl = "https://releases.hashicorp.com/terraform/$version/terraform_${version}_windows_amd64.zip"
$zipPath = Join-Path $env:TEMP "terraform_${version}_windows_amd64.zip"

Write-Host "Installing Terraform $version to $installDir"

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
Expand-Archive -Path $zipPath -DestinationPath $installDir -Force
Remove-Item $zipPath -Force

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$installDir*") {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$installDir", 'User')
  Write-Host "Added to user PATH: $installDir"
}

Write-Host "Done. Close and reopen Git Bash / VS Code / Cursor, then run: terraform version"
& (Join-Path $installDir 'terraform.exe') version

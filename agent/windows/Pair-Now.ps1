<#
.SYNOPSIS
  Runs the existing companion install after the owner pastes a pairing code.

.DESCRIPTION
  Does not change the signed agent files. Reads an optional two-line request
  written by the installer, otherwise asks for the code. Deletes that request
  after reading it. A missing Node or Kimi command is a warning, not a fake pair.
#>
[CmdletBinding()]
param(
  [string]$DashboardUrl = "",
  [string]$PairingCode = "",
  [switch]$EnableBuildJobs
)

$ErrorActionPreference = "Stop"
$RequestPath = Join-Path $PSScriptRoot "pair-request.txt"

if (Test-Path $RequestPath) {
  $lines = Get-Content -Path $RequestPath
  Remove-Item -Force $RequestPath
  if (-not $DashboardUrl -and $lines.Count -ge 1) { $DashboardUrl = [string]$lines[0] }
  if (-not $PairingCode -and $lines.Count -ge 2) { $PairingCode = [string]$lines[1] }
}

$DashboardUrl = $DashboardUrl.Trim()
$PairingCode = $PairingCode.Trim().ToUpperInvariant()
if (-not $DashboardUrl) { $DashboardUrl = "https://adrians-mind.vercel.app" }

if (-not $PairingCode) {
  Write-Host "On the signed-in site, open Build and press Mint pairing code. The code expires in five minutes."
  $PairingCode = (Read-Host "Pairing code").Trim().ToUpperInvariant()
}

if ($PairingCode -notmatch '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$') {
  throw "Pairing code must look like ABCD-EFGH from Mint pairing code. Nothing was paired."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is required to pair and run this Companion." }
foreach ($name in @("kimi")) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Warning "$name is not on PATH. Pairing can still finish. PC jobs stay off until $name is installed."
  }
}

& (Join-Path $PSScriptRoot "Install-MindAgent.ps1") -DashboardUrl $DashboardUrl -PairingCode $PairingCode -EnableBuildJobs:$EnableBuildJobs
exit $LASTEXITCODE

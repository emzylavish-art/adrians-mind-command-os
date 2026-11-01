<#
.SYNOPSIS
  Removes the Mind Command local companion agent for the current user.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = "Continue"
$AgentRoot = Join-Path $env:LOCALAPPDATA "MindCommandAgent"
$ConfigPath = Join-Path $AgentRoot "config.json"
$StartupName = "MindCommandLocalAgent"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

# Signal emergency stop / revoke if still configured
$stopScript = Join-Path $AgentRoot "Emergency-Stop.ps1"
if (Test-Path $stopScript) {
  try { & $stopScript } catch { Write-Warning $_.Exception.Message }
}

# Kill agent process tree by command line match
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ForEach-Object {
  if ($_.CommandLine -and $_.CommandLine -like "*MindAgent.ps1*") {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
}

Remove-ItemProperty -Path $runKey -Name $StartupName -ErrorAction SilentlyContinue
if (Test-Path $AgentRoot) {
  Remove-Item -Recurse -Force $AgentRoot
}
Write-Host "Mind Command Local Agent uninstalled (startup entry and $AgentRoot removed)."

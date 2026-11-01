<#
.SYNOPSIS
  Local emergency stop: revoke device token on the server and kill the agent process tree.
  Model / agent instructions cannot override this script.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = "Continue"
$AgentRoot = Join-Path $env:LOCALAPPDATA "MindCommandAgent"
$ConfigPath = Join-Path $AgentRoot "config.json"
$FlagPath = Join-Path $AgentRoot "EMERGENCY_STOP"

# Local flag checked before every model-driven step
Set-Content -Path $FlagPath -Value ((Get-Date).ToString("o")) -Encoding ascii

if (Test-Path $ConfigPath) {
  try {
    $cfg = Get-Content -Raw $ConfigPath | ConvertFrom-Json
    $uri = $cfg.dashboardUrl.TrimEnd("/") + "/api/mind/pairing/stop"
    $body = @{ token = $cfg.token } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri $uri -Body $body -ContentType "application/json" | Out-Null
  } catch {
    Write-Warning "Server revoke may have failed; local stop flag is still set. $($_.Exception.Message)"
  }
}

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ForEach-Object {
  if ($_.CommandLine -and $_.CommandLine -like "*MindAgent.ps1*" -and $_.ProcessId -ne $PID) {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
}
Write-Host "Emergency stop engaged. Clear it from the dashboard, then re-pair."

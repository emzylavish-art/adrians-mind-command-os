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
    $jobToken = if ($cfg.jobToken) { $cfg.jobToken } elseif (-not $cfg.tokenId) { $cfg.token } else { $null }
    if ($jobToken) {
      try {
        $revoke = $cfg.dashboardUrl.TrimEnd("/") + "/api/mind/pc/register?self=1"
        Invoke-RestMethod -TimeoutSec 5 -Method Delete -Uri $revoke -Headers @{ Authorization = "Bearer $jobToken" } | Out-Null
      } catch { Write-Warning "Build credential revocation was not confirmed. Revoke the enrollment from the owner account." }
    }
    $uri = $cfg.dashboardUrl.TrimEnd("/") + "/api/mind/pairing/stop"
    $body = @{ token = $cfg.token } | ConvertTo-Json
    Invoke-RestMethod -TimeoutSec 5 -Method Post -Uri $uri -Body $body -ContentType "application/json" | Out-Null
  } catch {
    Write-Warning "Server revoke may have failed; local stop flag is still set. $($_.Exception.Message)"
  }
}

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ForEach-Object {
  if ($_.CommandLine -and $_.CommandLine.IndexOf((Join-Path $AgentRoot "MindAgent.ps1"), [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.ProcessId -ne $PID) {
    # Stop the process tree, including a child Kimi/terminal worker.
    & taskkill.exe /PID $_.ProcessId /T /F | Out-Null
  }
}
Write-Host "Emergency stop engaged. Clear it from the dashboard, then re-pair."

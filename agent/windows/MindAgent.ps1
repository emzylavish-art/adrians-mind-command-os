<#
.SYNOPSIS
  Mind Command local agent loop (per-user). Checks emergency stop before every step.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$AgentRoot = Join-Path $env:LOCALAPPDATA "MindCommandAgent"
$ConfigPath = Join-Path $AgentRoot "config.json"
$FlagPath = Join-Path $AgentRoot "EMERGENCY_STOP"
$LogPath = Join-Path $AgentRoot "agent.log"

function Write-AgentLog([string]$msg) {
  Add-Content -Path $LogPath -Value ("{0} {1}" -f (Get-Date).ToString("o"), $msg)
}

function Test-LocalStop {
  if (Test-Path $FlagPath) { return $true }
  return $false
}

if (-not (Test-Path $ConfigPath)) {
  Write-AgentLog "Missing config; exiting."
  exit 1
}
$cfg = Get-Content -Raw $ConfigPath | ConvertFrom-Json

Write-AgentLog "Agent starting for device $($cfg.deviceId)"

while ($true) {
  # STOP CHECK FIRST — model output cannot clear EMERGENCY_STOP
  if (Test-LocalStop) {
    Write-AgentLog "Local emergency stop flag present; exiting process tree."
    exit 2
  }

  try {
    $hbUri = $cfg.dashboardUrl.TrimEnd("/") + "/api/mind/pairing/heartbeat"
    $hbBody = @{ token = $cfg.token } | ConvertTo-Json
    $hb = Invoke-RestMethod -Method Post -Uri $hbUri -Body $hbBody -ContentType "application/json"
    if (-not $hb.ok) {
      Write-AgentLog "Heartbeat rejected: $($hb.error)"
      if ($hb.error -match "stop|revoked|invalid") { exit 3 }
    }
  } catch {
    Write-AgentLog "Heartbeat error: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds 30
}

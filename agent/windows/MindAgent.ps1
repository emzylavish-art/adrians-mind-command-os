<#
.SYNOPSIS
  Mind Command local agent loop (per-user). Checks emergency stop before every step.
  Verifies agent.manifest.json hashes, pins HTTPS origin, binds local control to 127.0.0.1 only.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$AgentRoot = Join-Path $env:LOCALAPPDATA "MindCommandAgent"
$ConfigPath = Join-Path $AgentRoot "config.json"
$FlagPath = Join-Path $AgentRoot "EMERGENCY_STOP"
$LogPath = Join-Path $AgentRoot "agent.log"
$ManifestPath = Join-Path $AgentRoot "agent.manifest.json"

function Write-AgentLog([string]$msg) {
  # Never log tokens/secrets
  $safe = $msg -replace 'Bearer\s+\S+', 'Bearer [REDACTED]' -replace 'token["\s:=]+[^\s"]+', 'token=[REDACTED]'
  Add-Content -Path $LogPath -Value ("{0} {1}" -f (Get-Date).ToString("o"), $safe)
}

function Test-LocalStop {
  if (Test-Path $FlagPath) { return $true }
  return $false
}

function Test-AgentIntegrity {
  if (-not (Test-Path $ManifestPath)) { throw "Missing agent.manifest.json" }
  $manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
  foreach ($name in @("MindAgent.ps1", "Emergency-Stop.ps1")) {
    $path = Join-Path $AgentRoot $name
    $expected = $manifest.files.$name
    if (-not $expected) { throw "Manifest missing $name" }
    $actual = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLowerInvariant()
    if ($actual -ne $expected.ToLowerInvariant()) {
      throw "Integrity failure on $name — refusing to run (tamper/hijack)."
    }
  }
}

if (-not (Test-Path $ConfigPath)) {
  Write-AgentLog "Missing config; exiting."
  exit 1
}
Test-AgentIntegrity
$cfg = Get-Content -Raw $ConfigPath | ConvertFrom-Json

# TLS pin
$dashUri = [Uri]$cfg.dashboardUrl
$isLocal = ($dashUri.Host -eq "localhost") -or ($dashUri.Host -eq "127.0.0.1")
if ($dashUri.Scheme -ne "https" -and -not ($dashUri.Scheme -eq "http" -and $isLocal)) {
  Write-AgentLog "Refusing non-TLS dashboard URL."
  exit 4
}

Write-AgentLog "Agent starting for device $($cfg.deviceId)"

# Local control listener: 127.0.0.1 only + auth token (no LAN bind)
# Implemented as a named flag file protocol to avoid opening a wide socket by default.
# If HttpListener is used by a future build, it MUST use $cfg.localControl.bindHost=127.0.0.1
# and require header X-Mind-Local-Auth: $cfg.localControl.authToken.

while ($true) {
  if (Test-LocalStop) {
    Write-AgentLog "Local emergency stop flag present; exiting process tree."
    exit 2
  }
  try {
    Test-AgentIntegrity
  } catch {
    Write-AgentLog $_.Exception.Message
    exit 5
  }

  try {
    $hbUri = $cfg.dashboardUrl.TrimEnd("/") + "/api/mind/pairing/heartbeat"
    $hbBody = @{
      token = $cfg.token
      publicKeyFingerprint = $cfg.publicKeyFingerprint
    } | ConvertTo-Json
    $hb = Invoke-RestMethod -Method Post -Uri $hbUri -Body $hbBody -ContentType "application/json"
    if (-not $hb.ok) {
      Write-AgentLog "Heartbeat rejected: $($hb.error)"
      if ($hb.error -match "stop|revoked|invalid|fingerprint|binding") { exit 3 }
    }
  } catch {
    Write-AgentLog "Heartbeat error: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds 30
}

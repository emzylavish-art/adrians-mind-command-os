<#
.SYNOPSIS
  Mind Command local agent loop with a supervised Kimi Code ACP worker.
.DESCRIPTION
  Polls the authenticated dashboard for typed jobs. Kimi jobs are executed only
  from an approved workspace through KimiAcpClient.mjs; terminal reverse-RPC is
  denied until the owner approval bridge is enabled.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$AgentRoot = Join-Path $env:LOCALAPPDATA "MindCommandAgent"
$ConfigPath = Join-Path $AgentRoot "config.json"
$FlagPath = Join-Path $AgentRoot "EMERGENCY_STOP"
$LogPath = Join-Path $AgentRoot "agent.log"
$ManifestPath = Join-Path $AgentRoot "agent.manifest.json"
$KimiClientPath = Join-Path $AgentRoot "KimiAcpClient.mjs"

function Write-AgentLog([string]$msg) {
  $safe = $msg -replace 'Bearer\s+\S+', 'Bearer [REDACTED]' -replace 'token["\s:=]+[^\s"]+', 'token=[REDACTED]'
  Add-Content -Path $LogPath -Value ("{0} {1}" -f (Get-Date).ToString("o"), $safe)
}

function Test-LocalStop { return (Test-Path $FlagPath) }

function Test-AgentIntegrity {
  if (-not (Test-Path $ManifestPath)) { throw "Missing agent.manifest.json" }
  $manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
  foreach ($name in @("MindAgent.ps1", "Emergency-Stop.ps1", "KimiAcpClient.mjs")) {
    $path = Join-Path $AgentRoot $name
    $expected = $manifest.files.$name
    if (-not $expected) { throw "Manifest missing $name" }
    $actual = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLowerInvariant()
    if ($actual -ne $expected.ToLowerInvariant()) { throw "Integrity failure on $name — refusing to run." }
  }
}

function Send-JobResult($jobId, [bool]$ok, [string]$output, [string]$error) {
  $uri = $cfg.dashboardUrl.TrimEnd("/") + "/api/mind/pc/result"
  $body = @{ jobId = $jobId; ok = $ok; output = $output; error = $error } | ConvertTo-Json
  try { Invoke-RestMethod -Method Post -Uri $uri -Headers @{ Authorization = "Bearer $($cfg.token)" } -Body $body -ContentType "application/json" | Out-Null }
  catch { Write-AgentLog "Job result error: $($_.Exception.Message)" }
}

function Invoke-KimiJob($job) {
  if (Test-LocalStop) { Send-JobResult $job.id $false "" "Emergency stop is on."; return }
  $jobFile = Join-Path $AgentRoot ("kimi-job-" + $job.id + ".json")
  try {
    $job | ConvertTo-Json -Depth 12 | Set-Content -Path $jobFile -Encoding utf8
    $node = if ($cfg.nodePath) { [string]$cfg.nodePath } else { "node" }
    if ($cfg.kimiPath) { Write-AgentLog "Starting Kimi ACP via configured CLI $($cfg.kimiPath)" }
    Write-AgentLog "Starting Companion job $($job.id) ($($job.kind))"
    & $node $KimiClientPath --config $ConfigPath --job-json $jobFile 2>&1 | ForEach-Object { Write-AgentLog ([string]$_) }
    if ($LASTEXITCODE -ne 0) { Write-AgentLog "Kimi ACP worker exited with code $LASTEXITCODE; worker attempted to report the failure." }
  } catch {
    Write-AgentLog "Kimi ACP launch failed: $($_.Exception.Message)"
    Send-JobResult $job.id $false "" $_.Exception.Message
  } finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $jobFile
  }
}

if (-not (Test-Path $ConfigPath)) { Write-AgentLog "Missing config; exiting."; exit 1 }
Test-AgentIntegrity
$cfg = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$dashUri = [Uri]$cfg.dashboardUrl
$isLocal = ($dashUri.Host -eq "localhost") -or ($dashUri.Host -eq "127.0.0.1")
if ($dashUri.Scheme -ne "https" -and -not ($dashUri.Scheme -eq "http" -and $isLocal)) { Write-AgentLog "Refusing non-TLS dashboard URL."; exit 4 }
Write-AgentLog "Agent starting for device $($cfg.deviceId)"

while ($true) {
  if (Test-LocalStop) { Write-AgentLog "Local emergency stop flag present; exiting."; exit 2 }
  try { Test-AgentIntegrity } catch { Write-AgentLog $_.Exception.Message; exit 5 }

  try {
    $hbUri = $cfg.dashboardUrl.TrimEnd("/") + "/api/mind/pairing/heartbeat"
    $hbBody = @{ token = $cfg.token; publicKeyFingerprint = $cfg.publicKeyFingerprint } | ConvertTo-Json
    $hb = Invoke-RestMethod -Method Post -Uri $hbUri -Body $hbBody -ContentType "application/json"
    if (-not $hb.ok) {
      Write-AgentLog "Heartbeat rejected: $($hb.error)"
      if ($hb.error -match "stop|revoked|invalid|fingerprint|binding") { exit 3 }
    }
  } catch { Write-AgentLog "Heartbeat error: $($_.Exception.Message)" }

  try {
    $jobsUri = $cfg.dashboardUrl.TrimEnd("/") + "/api/mind/pc/jobs"
    $jobs = Invoke-RestMethod -Method Get -Uri $jobsUri -Headers @{ Authorization = "Bearer $($cfg.token)" }
    if ($jobs.ok -and $jobs.job) {
      if ($jobs.job.kind -eq "kimi-acp" -or $jobs.job.kind -eq "file-op") { Invoke-KimiJob $jobs.job }
      else { Send-JobResult $jobs.job.id $false "" "Unsupported Companion job kind." }
    }
  } catch { Write-AgentLog "Job poll error: $($_.Exception.Message)" }

  Start-Sleep -Seconds 5
}

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

function Invoke-PendingJob {
  $uri = $cfg.dashboardUrl.TrimEnd("/") + "/api/mind/pc/jobs"
  $headers = @{ Authorization = "Bearer $jobToken"; "X-Adrian-Build-Review" = "1" }
  if (-not (Test-Path $pendingFile)) {
    # An offer leaves the server record queued until our local receipt is durable.
    $offer = Invoke-RestMethod -Method Get -Uri ($uri + "?delivery=offer") -Headers $headers
    if (-not $offer.job) { return }
    if (-not $offer.offered) { throw "Dashboard does not support recoverable job delivery; update dashboard before running this Companion." }
    $job = $offer.job
    $job | Add-Member -NotePropertyName receiptId -NotePropertyValue ([guid]::NewGuid().ToString("N"))
    [IO.File]::WriteAllText(($pendingFile + ".new"), ($job | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
    [IO.File]::Move(($pendingFile + ".new"), $pendingFile)
  }
  $job = Get-Content -Raw -Encoding UTF8 $pendingFile | ConvertFrom-Json
  $body = @{jobId = $job.id; receiptId = $job.receiptId} | ConvertTo-Json
  $ack = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body -ContentType "application/json"
  if (-not $ack.ok) { throw "Job acceptance could not be confirmed." }
  if ($ack.accepted -and $ack.status -in @("running","cancel_requested")) {
    if (Test-LocalStop) { return }
    $node = if ($cfg.nodePath) { [string]$cfg.nodePath } else { "node" }
    & $node $KimiClientPath --config $ConfigPath --job-json $pendingFile 2>&1 | ForEach-Object { Write-AgentLog ([string]$_) }
    if ($LASTEXITCODE -ne 0) { return } # Keep receipt for reconciliation after reconnect.
  }
  Remove-Item -Force -ErrorAction SilentlyContinue ($pendingFile + ".result"), ($pendingFile + ".result.new"), ($pendingFile + ".started")
  Remove-Item -Force $pendingFile
}

if (-not (Test-Path $ConfigPath)) { Write-AgentLog "Missing config; exiting."; exit 1 }
Test-AgentIntegrity
$cfg = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$dashUri = [Uri]$cfg.dashboardUrl
$isLocal = ($dashUri.Host -eq "localhost") -or ($dashUri.Host -eq "127.0.0.1")
if ($dashUri.Scheme -ne "https" -and -not ($dashUri.Scheme -eq "http" -and $isLocal)) { Write-AgentLog "Refusing non-TLS dashboard URL."; exit 4 }
Write-AgentLog "Agent starting for device $($cfg.deviceId)"

# A second agent loop must never consume or remove the first loop's receipt.
$jobToken = if ($cfg.jobToken) { $cfg.jobToken } elseif (-not $cfg.tokenId) { $cfg.token } else { $null }
if (-not $jobToken) { Write-AgentLog "Signed device pairing is enabled. Build job polling requires separate owner enrollment." }
$receiptDir = Join-Path $AgentRoot ("delivery-" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$cfg.deviceId)).TrimEnd("=").Replace("/", "_").Replace("+", "-"))
[IO.Directory]::CreateDirectory($receiptDir) | Out-Null
$pendingFile = Join-Path $receiptDir "pending.json"
$loopLock = [IO.File]::Open((Join-Path $receiptDir "agent.lock"), "OpenOrCreate", "ReadWrite", "None")
try {
  while ($true) {
    if (Test-LocalStop) { Write-AgentLog "Local emergency stop flag present; exiting."; exit 2 }
    try { Test-AgentIntegrity } catch { Write-AgentLog $_.Exception.Message; exit 5 }

    if ($cfg.tokenId) {
      try {
        $hbUri = $cfg.dashboardUrl.TrimEnd("/") + "/api/mind/pairing/heartbeat"
        $hbBody = @{ token = $cfg.token; publicKeyFingerprint = $cfg.publicKeyFingerprint } | ConvertTo-Json
        $hb = Invoke-RestMethod -Method Post -Uri $hbUri -Body $hbBody -ContentType "application/json"
        if (-not $hb.ok) {
          Write-AgentLog "Heartbeat rejected: $($hb.error)"
          if ($hb.error -match "stop|revoked|invalid|fingerprint|binding") { exit 3 }
          Start-Sleep -Seconds 5
          continue
        }
      } catch { Write-AgentLog "Heartbeat error: $($_.Exception.Message)"; Start-Sleep -Seconds 5; continue }

    }
    try {
      if ($jobToken) { Invoke-PendingJob }
    } catch { Write-AgentLog "Job poll error: $($_.Exception.Message)" }

    Start-Sleep -Seconds 5
  }
} finally { $loopLock.Dispose() }

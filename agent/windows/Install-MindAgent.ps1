<#
.SYNOPSIS
  Installs the Mind Command local companion agent for the current Windows user (HP EliteBook).

.DESCRIPTION
  - Per-user only. Does NOT request admin elevation unless you pass -ForceAdmin (not required).
  - Does NOT disable Windows Defender, firewall, UAC, or any security setting.
  - Writes config + keypair under %LOCALAPPDATA%\MindCommandAgent\
  - Private key never leaves this machine.
  - Registers a clearly named current-user Startup entry (MindCommandLocalAgent) that uninstall removes.
  - Idempotent: re-running refreshes files and startup without duplicating entries.

.PARAMETER DashboardUrl
  Base URL of the Mind Command dashboard (e.g. https://mind.example.com).

.PARAMETER PairingCode
  One-time pairing code minted in the dashboard (expires quickly).

.PARAMETER DeviceName
  Friendly device name shown on the Build card.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DashboardUrl,
  [Parameter(Mandatory = $true)][string]$PairingCode,
  [string]$DeviceName = $env:COMPUTERNAME,
  [switch]$ForceAdmin
)

$ErrorActionPreference = "Stop"

# Transport: HTTPS only (localhost HTTP allowed for dev)
try {
  $dashUri = [Uri]$DashboardUrl
} catch { throw "DashboardUrl is not a valid URL." }
$isLocal = ($dashUri.Host -eq "localhost") -or ($dashUri.Host -eq "127.0.0.1")
if ($dashUri.Scheme -ne "https" -and -not ($dashUri.Scheme -eq "http" -and $isLocal)) {
  throw "DashboardUrl must use HTTPS (TLS). HTTP is only allowed for localhost."
}

$AgentRoot = Join-Path $env:LOCALAPPDATA "MindCommandAgent"
$KeyDir = Join-Path $AgentRoot "keys"
$ConfigPath = Join-Path $AgentRoot "config.json"
$LogPath = Join-Path $AgentRoot "agent.log"
$AgentScript = Join-Path $AgentRoot "MindAgent.ps1"
$StopScript = Join-Path $AgentRoot "Emergency-Stop.ps1"
$StartupName = "MindCommandLocalAgent"

if ($ForceAdmin) {
  Write-Warning "Admin is not required for this install. Continuing as current user only."
}

New-Item -ItemType Directory -Force -Path $AgentRoot | Out-Null
New-Item -ItemType Directory -Force -Path $KeyDir | Out-Null

# Generate RSA keypair locally if missing (private key stays on disk, never uploaded).
$PrivPath = Join-Path $KeyDir "device_private.pem"
$PubPath = Join-Path $KeyDir "device_public.pem"
if (-not (Test-Path $PrivPath)) {
  Write-Host "Generating device keypair in $KeyDir (private key never leaves this PC)..."
  $rsa = [System.Security.Cryptography.RSA]::Create(2048)
  try {
    $priv = $rsa.ExportRSAPrivateKeyPem()
    $pub = $rsa.ExportRSAPublicKeyPem()
    Set-Content -Path $PrivPath -Value $priv -Encoding ascii
    Set-Content -Path $PubPath -Value $pub -Encoding ascii
    # Restrict ACL to current user
    icacls $PrivPath /inheritance:r /grant:r "$env:USERNAME:(R,W)" | Out-Null
  } finally {
    $rsa.Dispose()
  }
}

$PublicKeyPem = Get-Content -Raw -Path $PubPath

# Handshake with dashboard
$HandshakeUri = ($DashboardUrl.TrimEnd("/") + "/api/mind/pairing/handshake")
$body = @{
  code = $PairingCode
  publicKeyPem = $PublicKeyPem
  deviceName = $DeviceName
} | ConvertTo-Json

Write-Host "Registering device with dashboard (public key + pairing code only)..."
try {
  $resp = Invoke-RestMethod -Method Post -Uri $HandshakeUri -Body $body -ContentType "application/json"
} catch {
  throw "Handshake failed. Check the pairing code and dashboard URL. $($_.Exception.Message)"
}

if (-not $resp.ok) { throw "Handshake rejected: $($resp.error)" }

$config = @{
  dashboardUrl = $DashboardUrl.TrimEnd("/")
  deviceId = $resp.deviceId
  tokenId = $resp.tokenId
  token = $resp.token
  publicKeyFingerprint = $resp.publicKeyFingerprint
  scopes = $resp.scopes
  expiresAt = $resp.expiresAt
  deviceName = $DeviceName
  allowedRoots = @((Join-Path $env:USERPROFILE "MindWorkspace"))
  installedAt = (Get-Date).ToString("o")
  localControl = @{
    bindHost = "127.0.0.1"
    port = 17355
    authToken = $localAuth
  }
  pinnedOrigin = $DashboardUrl.TrimEnd("/")
}
$config | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding utf8
icacls $ConfigPath /inheritance:r /grant:r "$env:USERNAME:(R,W)" | Out-Null

# Ensure workspace root exists (user-visible)
New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE "MindWorkspace") | Out-Null

# Copy agent + emergency-stop scripts next to config
Copy-Item -Force (Join-Path $PSScriptRoot "MindAgent.ps1") $AgentScript
Copy-Item -Force (Join-Path $PSScriptRoot "Emergency-Stop.ps1") $StopScript

# Integrity manifest (sha256 of agent scripts) — agent refuses to run if hashes drift
function Get-Sha256([string]$Path) {
  $hash = Get-FileHash -Algorithm SHA256 -Path $Path
  return $hash.Hash.ToLowerInvariant()
}
$manifest = @{
  version = "1"
  files = @{
    "MindAgent.ps1" = (Get-Sha256 $AgentScript)
    "Emergency-Stop.ps1" = (Get-Sha256 $StopScript)
  }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $AgentRoot "agent.manifest.json") -Encoding utf8

# Local control plane shared secret (localhost only). DLL/PATH: prefer absolute powershell path.
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
$localAuth = [Convert]::ToBase64String($bytes)


# User-visible Startup entry (CurrentUser Run key) — uninstall removes it
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$psFull = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$cmd = "`"$psFull`" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$AgentScript`""
Set-ItemProperty -Path $runKey -Name $StartupName -Value $cmd

Write-Host "Installed Mind Command Local Agent under $AgentRoot"
Write-Host "Startup entry: $StartupName (current user only)"
Write-Host "Emergency stop: powershell -File `"$StopScript`""
Write-Host "Uninstall: powershell -File `"$(Join-Path $PSScriptRoot 'Uninstall-MindAgent.ps1')`""

# Start now
Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile","-WindowStyle","Hidden","-ExecutionPolicy","Bypass","-File",$AgentScript) | Out-Null

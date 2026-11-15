# Desktop control for the paired Windows companion.
# The browser never calls this. It runs only on the owner's PC after the installer.
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [Parameter(Mandatory = $true)][string]$Exact,
  [string]$Approval = "",
  [switch]$Halted
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  Write-Output (@{ ok = $false; action = $Action; error = $Message } | ConvertTo-Json -Compress)
  exit 2
}

if ($Halted) { Fail "Emergency stop is on. Nothing ran." }
if ($Approval -ne $Exact) { Fail "Approve this exact desktop action first. Nothing ran." }
if ($Action -ne $Exact.Split(" ")[0]) { Fail "The action does not match the approved string. Nothing ran." }

if (-not [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)) {
  Fail "This is not Windows. Nothing ran."
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AdrianDesktop {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
"@

switch ($Action) {
  "mouse" {
    [AdrianDesktop]::SetCursorPos(0, 0) | Out-Null
    Write-Output (@{ ok = $true; action = "mouse"; detail = "Cursor moved to 0,0." } | ConvertTo-Json -Compress)
  }
  "keyboard" {
    $text = $Exact.Substring("keyboard type ".Length)
    [System.Windows.Forms.SendKeys]::SendWait($text)
    Write-Output (@{ ok = $true; action = "keyboard"; detail = "Typed the approved text." } | ConvertTo-Json -Compress)
  }
  "screen" {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    Write-Output (@{ ok = $true; action = "screen"; detail = "Primary screen is $($bounds.Width)x$($bounds.Height). No image was saved." } | ConvertTo-Json -Compress)
  }
  "pc_file" {
    $path = Join-Path $env:USERPROFILE "Desktop\adrian-proof.txt"
    if (-not (Test-Path -LiteralPath $path)) { Fail "The approved file is not on the Desktop. Nothing was read." }
    $text = Get-Content -LiteralPath $path -TotalCount 5 -Raw
    Write-Output (@{ ok = $true; action = "pc_file"; detail = "Read the approved Desktop file." } | ConvertTo-Json -Compress)
  }
  default { Fail "That desktop action is not supported. Nothing ran." }
}

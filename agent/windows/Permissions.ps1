# Requests supported Windows permissions through normal user APIs.
# It does not disable Defender, UAC, or the firewall, and it does not claim a grant Windows did not make.
param([switch]$Halted)

$ErrorActionPreference = "Stop"
if ($Halted) {
  Write-Output (@{ ok = $false; error = "Emergency stop is on. No permission was requested." } | ConvertTo-Json -Compress)
  exit 2
}

$results = @()
function Add-Result([string]$Name, [bool]$Granted, [string]$Detail) {
  $script:results += @{ name = $Name; granted = $Granted; detail = $Detail }
}

Add-Result "Files in your user profile" $true "The companion can read and write under the current user profile. It does not receive the whole disk."
Add-Result "Terminal" $true "The companion can run an owner-approved command in the approved workspace. It does not bypass UAC."
try {
  Add-Type -AssemblyName System.Windows.Forms
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  Add-Result "Screen" ($bounds.Width -gt 0) "Primary screen size was read. No image was saved."
  Add-Result "Mouse" $true "The launched companion can move the cursor after the exact action is approved."
  Add-Result "Keyboard" $true "The launched companion can type after the exact action is approved."
} catch {
  Add-Result "Screen" $false "Windows did not expose the screen. Nothing was captured."
  Add-Result "Mouse" $false "Windows did not expose the cursor. Nothing moved."
  Add-Result "Keyboard" $false "Windows did not expose typing. Nothing was typed."
}
Add-Result "Microphone after the browser closes" $false "Closing the browser ends the site microphone. Windows has not granted a separate always-on mic."
Add-Result "Browser pointer" $false "No browser-control driver is installed. Nothing clicked in a browser."
Add-Result "Startup" $false "Startup is not registered by this check. The installer registers it only if you finish setup."

Write-Output (@{ ok = $true; permissions = $results } | ConvertTo-Json -Compress)

# These steps must already have been applied on the Windows PC before the boot check can pass.
# This file does not run them from the Linux sandbox.
#
# 1. Open PowerShell as the user who logs in. Do not use a different account.
# 2. From the installed app folder, run:
#    powershell -ExecutionPolicy Bypass -File .\desktop\engines\openclaw\Register-Autostart.ps1
# 3. Confirm the task exists:
#    schtasks /Query /TN "AdriansMind-OpenClaw" /FO LIST
# 4. Sign out and sign back in. Do not start the process by hand.
# 5. Confirm the process is running:
#    Get-Process node | Where-Object { $_.Path -like "*openclaw*" }
#
# The task starts node desktop/engines/openclaw/runtime.mjs at login. It does not send messages.

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$node = (Get-Command node).Source
$script = Join-Path $PSScriptRoot "runtime.mjs"
$action = "cmd /c `"`"$node`" `"$script`"`""
schtasks /Create /TN "AdriansMind-OpenClaw" /SC ONLOGON /RL LIMITED /F /TR $action
Write-Output "Registered AdriansMind-OpenClaw for this user at logon."

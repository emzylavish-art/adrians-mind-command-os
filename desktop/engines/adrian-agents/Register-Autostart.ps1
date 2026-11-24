# These steps must already have been applied on the Windows PC before the boot check can pass.
# This file does not run them from the Linux sandbox.
#
# 1. Open PowerShell as the user who logs in. Do not use a different account.
# 2. From the installed app folder, run:
#    powershell -ExecutionPolicy Bypass -File .\desktop\engines\adrian-agents\Register-Autostart.ps1
# 3. Confirm the task exists:
#    schtasks /Query /TN "AdriansMind-Agents" /FO LIST
# 4. Sign out and sign back in. Do not start the process by hand.
# 5. Run Run-Windows-Acceptance.ps1 from this folder to inspect the task and runtime path.
#
# The task starts node desktop/engines/adrian-agents/runtime.mjs at login. It does not send messages.

$ErrorActionPreference = "Stop"
$node = (Get-Command node).Source
$script = Join-Path $PSScriptRoot "runtime.mjs"
$action = "cmd /c `"`"$node`" `"$script`"`""
schtasks /Create /TN "AdriansMind-Agents" /SC ONLOGON /RL LIMITED /F /TR $action
if ($LASTEXITCODE -ne 0) {
  throw "Task Scheduler did not register AdriansMind-Agents (exit $LASTEXITCODE)."
}
Write-Output "Registered AdriansMind-Agents for this user at logon."

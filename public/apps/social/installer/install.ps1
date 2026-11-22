$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$env:ADRIAN_ROOT = $Root
py -3 -m pip install -r requirements.txt
py -3 -m playwright install chromium
$action = New-ScheduledTaskAction -Execute "py.exe" -Argument "-3 -m adrian_social serve" -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "AdrianSocial" -Action $action -Trigger $trigger -Force | Out-Null
$backup = New-ScheduledTaskAction -Execute "py.exe" -Argument "-3 -m adrian_social backup" -WorkingDirectory $Root
$night = New-ScheduledTaskTrigger -Daily -At 2:00AM
Register-ScheduledTask -TaskName "AdrianSocialBackup" -Action $backup -Trigger $night -Force | Out-Null
Write-Output "Installed. First login is a headed window you type into. This script does not ask for a password."

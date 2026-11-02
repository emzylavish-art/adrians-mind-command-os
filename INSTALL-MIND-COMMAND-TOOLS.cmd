@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\bootstrap\Install-MindCommandTools.ps1"
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" echo Setup exited with code %EXITCODE%. Review the messages above.
pause
exit /b %EXITCODE%

@echo off
setlocal
cd /d "%~dp0"
set ADRIAN_ROOT=%~dp0
py -3 -m adrian_social serve
if errorlevel 1 python -m adrian_social serve

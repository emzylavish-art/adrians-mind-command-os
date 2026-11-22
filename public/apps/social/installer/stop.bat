@echo off
setlocal
cd /d "%~dp0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8765 ^| findstr LISTENING') do taskkill /PID %%p /F
echo Stopped the loopback service if it was listening.

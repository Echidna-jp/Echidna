@echo off
rem Antigravity localization: apply Japanese UI
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\agzh.ps1" -Command apply -Locale ja
echo.
pause

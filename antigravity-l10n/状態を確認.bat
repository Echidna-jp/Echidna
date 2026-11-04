@echo off
rem Antigravity localization: show current status
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\agzh.ps1" -Command status -Locale ja
echo.
pause

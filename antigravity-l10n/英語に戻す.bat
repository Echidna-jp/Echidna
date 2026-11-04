@echo off
rem Antigravity localization: restore the official English app.asar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\agzh.ps1" -Command restore -Locale ja
echo.
pause

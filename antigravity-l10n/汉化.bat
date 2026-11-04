@echo off
rem Antigravity localization: apply Simplified Chinese UI
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\agzh.ps1" -Command apply -Locale zh-CN
echo.
pause

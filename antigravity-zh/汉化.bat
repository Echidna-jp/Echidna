@echo off
rem Antigravity zh-CN patch: apply Simplified Chinese UI
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\agzh.ps1" -Command apply
echo.
pause

@echo off
rem Antigravity zh-CN patch: show current status
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\agzh.ps1" -Command status
echo.
pause

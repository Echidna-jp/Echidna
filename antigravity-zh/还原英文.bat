@echo off
rem Antigravity zh-CN patch: restore the official English app.asar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\agzh.ps1" -Command restore
echo.
pause

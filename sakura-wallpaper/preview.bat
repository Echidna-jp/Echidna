@echo off
rem Sakura Dream - preview in your browser with full WebGL effects.
rem Opening index.html directly (file://) works too, but in a reduced mode.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preview-server.ps1"
if errorlevel 1 (
  echo.
  echo PowerShell server failed to start. Trying Python instead...
  echo Open http://localhost:8765/index.html in your browser.
  python -m http.server 8765 --bind 127.0.0.1
)
pause

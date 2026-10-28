@echo off
REM Startet das Haushaltsbudget lokal unter Windows (benötigt Node.js 20 oder neuer)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ist nicht installiert. Bitte von https://nodejs.org die LTS-Version installieren.
  pause
  exit /b 1
)
start "" http://localhost:8080
node server\index.js
pause

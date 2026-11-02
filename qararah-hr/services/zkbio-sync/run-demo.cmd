@echo off
cd /d "%~dp0"
node src/index.mjs --once
if errorlevel 1 pause

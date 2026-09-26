@echo off
cd /d "%~dp0"
if not defined ASR_MODEL set ASR_MODEL=whisper-1
start "" /b node server.js
timeout /t 1 /nobreak >nul
start "" http://127.0.0.1:5173

@echo off
cd /d "%~dp0"
echo ============================================
echo   Hanbyul AI Backend - Starting
echo ============================================
echo.
echo Key is loaded automatically from key.txt
echo Keep this window open while using. Close to stop.
echo.
node server.js
echo.
echo (Server stopped. Check messages above if there was an error.)
pause

@echo off
cd /d "%~dp0"
if "%TALLYCALL_AUTH%"=="" set TALLYCALL_AUTH=off
node server.js
pause

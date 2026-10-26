@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Anchor 锚点 · 停止服务

echo.
set FOUND=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8787" ^| findstr "LISTENING"') do (
  echo   正在停止 PID %%p ...
  taskkill /f /pid %%p >nul 2>nul
  set FOUND=1
)

if "%FOUND%"=="1" (
  echo   Anchor 已停止。
) else (
  echo   8787 端口上没有在运行的服务，Anchor 本来就没开。
)
echo.
timeout /t 2 >nul

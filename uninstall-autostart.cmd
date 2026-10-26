@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Anchor 锚点 · 取消开机自启
echo.
node scripts\uninstall-autostart.mjs
echo.
pause

@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Anchor 锚点 · 前台模式（关掉这个窗口就停止服务）

echo.
echo   Anchor 启动中……这个窗口要一直开着。
echo   不想看到它的话，用 Anchor.vbs 双击启动（后台运行）。
echo   或者双击 install-autostart.cmd 设成开机自启。
echo.

node server\index.js

echo.
echo   Anchor 已停止。
pause

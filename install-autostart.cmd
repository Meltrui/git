@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Anchor 锚点 · 设置开机自启

echo.
echo   这一步会做两件事：
echo     1. 创建一个「登录 Windows 时自动运行」的计划任务（名为 Anchor）
echo     2. 在桌面放一个「Anchor 锚点」快捷方式
echo.
echo   不需要管理员权限。随时可以用 uninstall-autostart.cmd 撤销。
echo.
pause

node scripts\install-autostart.mjs --desktop --start

echo.
pause

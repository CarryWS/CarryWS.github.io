@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
echo 正在启动博客后台...
node "tools\blog-admin\server.js" %*

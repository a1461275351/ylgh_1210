@echo off
chcp 65001 >nul
title 1210 关务系统 · 全量测试
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 ( echo [错误] 未检测到 Node.js & pause & exit /b 1 )
if not exist server\node_modules (
  echo [1210] 首次运行,安装依赖...
  cd server & call npm install & cd ..
)
echo [1210] 运行全量自动化测试(全新数据库)...
echo.
node server\test\run-all.js --fresh
echo.
pause

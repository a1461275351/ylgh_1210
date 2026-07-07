@echo off
chcp 65001 >nul
title 1210 保税跨境电商关务系统
cd /d "%~dp0server"
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js,请先安装 Node.js 20 或更高版本:https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo [1210] 首次运行,正在安装依赖(需联网,约 1 分钟)...
  call npm install
  if errorlevel 1 ( echo [错误] 依赖安装失败 & pause & exit /b 1 )
)
echo.
echo ============================================================
echo   1210 关务系统已启动,请用浏览器打开:
echo   http://localhost:3010
echo   关闭本窗口即停止服务
echo ============================================================
echo.
node src/index.js
pause

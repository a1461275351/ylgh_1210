#!/usr/bin/env bash
# 1210 保税跨境电商关务系统 · 一键启动(Linux/Mac)
set -e
cd "$(dirname "$0")/server"
if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js,请先安装 Node.js 20+:https://nodejs.org"; exit 1
fi
if [ ! -d node_modules ]; then
  echo "[1210] 首次运行,正在安装依赖..."; npm install
fi
echo "============================================================"
echo "  1210 关务系统已启动,浏览器打开:http://localhost:3010"
echo "  Ctrl+C 停止服务"
echo "============================================================"
node src/index.js

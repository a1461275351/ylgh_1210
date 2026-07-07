#!/usr/bin/env bash
# 1210 关务系统 · 全量自动化测试(Linux/Mac)
set -e
cd "$(dirname "$0")"
if [ ! -d server/node_modules ]; then (cd server && npm install); fi
node server/test/run-all.js --fresh

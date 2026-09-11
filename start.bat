@echo off
chcp 65001 >nul
title NetWalk - 用网速和打字速度去散步
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] 未检测到 Node.js
  echo       请先安装 Node.js 18 或更高版本: https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo.
  echo   首次运行，正在安装依赖...
  echo.
  call npm install --no-audit --no-fund
)

echo.
node server\index.js
echo.
pause

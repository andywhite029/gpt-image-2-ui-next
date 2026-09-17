@echo off
chcp 65001 >nul
cd /d "%~dp0.."

rem 检查 Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 https://nodejs.org
    pause
    exit /b 1
)

rem 首次运行：安装依赖
if not exist node_modules (
    echo 首次运行，安装依赖...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络后重试。
        pause
        exit /b 1
    )
)

rem 首次运行：初始化数据库
if not exist data\app.db (
    echo 初始化数据库...
    if not exist data mkdir data
    call npx drizzle-kit push
    if errorlevel 1 (
        echo [错误] 数据库初始化失败。
        pause
        exit /b 1
    )
)

start "" http://127.0.0.1:8787
echo 启动 gpt-image-2 创作工作台...
echo 浏览器地址： http://127.0.0.1:8787
echo 按 Ctrl+C 或关闭窗口退出。
call npm run dev
pause

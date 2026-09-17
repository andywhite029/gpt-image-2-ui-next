#!/bin/bash
# gpt-image-2 创作工作台启动脚本（macOS / Linux）
cd "$(dirname "$0")/.."

# 检查 Node.js
if ! command -v node > /dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js，请先安装 https://nodejs.org"
  exit 1
fi

# 首次运行：安装依赖
if [ ! -d node_modules ]; then
  echo "首次运行，安装依赖..."
  npm install || { echo "[错误] 依赖安装失败，请检查网络后重试。"; exit 1; }
fi

# 首次运行：初始化数据库
if [ ! -f data/app.db ]; then
  echo "初始化数据库..."
  mkdir -p data
  npx drizzle-kit push || { echo "[错误] 数据库初始化失败。"; exit 1; }
fi

# 延时 2 秒后打开浏览器（等端口绑定完成）
( sleep 2; open http://127.0.0.1:8787 2>/dev/null || xdg-open http://127.0.0.1:8787 2>/dev/null ) &

echo "启动 gpt-image-2 创作工作台..."
echo "浏览器地址： http://127.0.0.1:8787"
echo "按 Ctrl+C 退出。"
npm run dev

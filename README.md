# gpt-image-2 创作工作台（Next.js 版）

本地网页版 AI 图片创作工作台：通过 NewAPI 兼容网关调用 `gpt-image-2` 模型生成图片。本项目是原 Flask 版（`gpt-image-2-ui`）的 Next.js 全栈重写版。

## 功能特性

- **多项目工作台** — 自由创作 / 视频项目两类工作区，项目归档与隐藏
- **分类管理** — 视频项目自动创建「角色参考 / 场景参考 / 分镜图 / 风格参考」分类
- **对话式生成** — 以对话为单元发起多轮生成请求，查看每轮请求 / 批次详情
- **参考图库** — 上传图片或从生成结果收藏为参考图，支持备注与标签
- **收藏与笔记** — 图片收藏、用户备注、标签管理
- **回收站** — 对话 / 图片 / 参考图软删除，可恢复或彻底删除
- **全局搜索** — 跨项目搜索对话、请求、图片、参考图
- **提示词模板** — 常用提示词保存为模板，一键填充
- **明暗主题** — 跟随系统或手动切换

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Next.js 15（App Router）+ React 19 |
| 语言 | TypeScript |
| 数据库 | SQLite + Drizzle ORM（@libsql/client 驱动） |
| 样式 | Tailwind CSS 4 |
| 数据层 | TanStack Query |
| 图像处理 | Sharp（缩略图 / 预览图） |

## 快速开始

要求 **Node.js ≥ 20**（含 npm）。

### 方式一：双击启动（Windows）

双击项目根目录的 `启动.bat`，首次运行会自动安装依赖、初始化数据库并打开浏览器。

### 方式二：命令行

```bash
npm install          # 安装依赖
npx drizzle-kit push # 初始化数据库（首次）
npm run dev          # 启动开发服务器
```

打开 <http://127.0.0.1:8787>。

macOS / Linux 可直接运行 `./scripts/start.command`。

## 环境变量

复制 `.env.example` 为 `.env.local` 按需修改：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LIGHTWHEEL_BASE_URL` | `https://ai.lightwheel.net:8086` | NewAPI 兼容网关地址 |
| `DATABASE_PATH` | `data/app.db` | SQLite 数据库路径（相对项目根目录） |
| `LIGHTWHEEL_TLS_VERIFY` | `true` | TLS 证书验证；自签名网关需设为 `false` |
| `GENERATION_TIMEOUT` | `300` | 生成超时（秒） |
| `OUTPUTS_DIR` | `public/outputs` | 图片输出目录（相对项目根目录） |

## API Key 说明

API Key 只保存在**浏览器 localStorage** 中，在「设置」弹窗里填写；服务端不留存、不落盘。每次生成请求由前端把 Key 传给服务端转发给网关。

## 从旧版迁移数据

如你之前使用 Flask 版（`gpt-image-2-ui`），可以把旧数据一次性迁移过来：

```bash
npx tsx data-migration/migrate.ts --source ../gpt-image-2-ui
```

- 迁移内容：项目、分类、对话、请求、批次、图片、参考图、回收站记录、幂等键、模板，以及全部图片二进制文件（复制到 `public/outputs/<projectId>/`）
- 幂等：重复运行会自动跳过已导入的项目，可安全多次执行
- 旧目录只读，不会被修改

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器（端口 8787） |
| `npm run build` | 生产构建 |
| `npm run start` | 启动生产服务器 |
| `npm run db:push` | 同步 Drizzle schema 到 SQLite（建表 / 加列） |
| `npm run db:studio` | 打开 Drizzle Studio 查看数据库 |
| `npm run db:migrate` | 从旧版迁移数据（等价于 `tsx data-migration/migrate.ts`） |

## 目录结构

```
├── data/                    # SQLite 数据库（app.db）
├── data-migration/          # 旧版数据迁移脚本
├── public/outputs/          # 生成的图片 / 缩略图 / 参考图（按项目分目录）
├── scripts/                 # 启动脚本（start.bat / start.command）
├── src/
│   ├── app/                 # Next.js App Router（页面 + API 路由）
│   ├── components/          # React 组件
│   ├── db/                  # Drizzle schema 与数据库连接
│   ├── hooks/               # React Query hooks
│   ├── lib/                 # 业务逻辑（网关、存储、配置等）
│   ├── store/               # 客户端状态
│   └── types/               # 实体类型定义
├── 启动.bat                  # Windows 双击启动
└── model_capabilities.json  # 模型能力配置（尺寸 / 参考图上限等）
```

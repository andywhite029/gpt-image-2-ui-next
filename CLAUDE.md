# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

本地网页版 AI 图片创作工作台：通过 NewAPI 兼容网关调用 `gpt-image-2` 模型生成图片。本项目是旧 Flask 版（`gpt-image-2-ui`）的 Next.js 全栈重写，用户界面、注释、错误信息均为中文。

## 常用命令

```bash
npm run dev          # 开发服务器（端口 8787）
npm run build        # 生产构建
npm run start        # 生产服务器（端口 8787）
npm run db:push      # 同步 Drizzle schema 到 SQLite（建表/加列，无迁移文件，schema 即真相）
npm run db:studio    # 打开 Drizzle Studio 查看数据库
npm run db:migrate   # 从旧 Flask 版迁移数据（tsx data-migration/migrate.ts，幂等可重复执行）
npx tsc --noEmit     # 类型检查（无测试、无 ESLint 配置）
```

首次运行需 `npm install` + `npx drizzle-kit push`（或直接双击 Windows 的 `启动.bat`）。

## 架构

### 分层结构

```
前端组件 (src/app/(app)/** 页面 + src/components/**)
  → TanStack Query hooks (src/hooks/**)
    → endpoints 封装 (src/lib/api-client.ts，fetch {success,...} 格式)
      → API 路由 (src/app/api/**/route.ts，薄层：校验 ID + 调业务 + errorResponse)
        → 业务逻辑 (src/lib/generation.ts / trash.ts / storage.ts ...)
          → Drizzle ORM (src/db/schema.ts + src/db/index.ts，@libsql/client 驱动 SQLite)
```

- 业务逻辑集中在 `src/lib/`，API 路由只做参数校验和错误转换，不要在 route.ts 里写业务。
- `src/lib/api-helpers.ts` 提供 `errorResponse`、`requireProject`、`locateImage` 等路由公共辅助；所有 route handler 用 `try { ... } catch (e) { return errorResponse(e); }` 包裹。
- Next.js 15：route handler 的 `params` 是 Promise，必须 `await params`。

### 生成流水线（核心，src/lib/generation.ts）

`submitGenerate` 在**一个事务内**完成 12 步校验（项目/对话/分类/prompt/能力/n/size/quality/幂等/参考图≤16/同对话仅一个 generating batch）并持久化 request + batch + 幂等记录，返回 202 后 **fire-and-forget** 执行 `executeGeneration`：

- 网关调用（`src/lib/gateway.ts`）：无参考图走 JSON 的 `/v1/images/generations`，有参考图走 multipart 的 `/v1/images/edits`；响应条目支持 `b64_json` 或 `url`（url 会下载，3 次退避重试，401/403 时带 Authorization 重试）。
- 结果落盘 `processEntries`：写文件 + 缩略图（Sharp，512px JPEG）在事务外，DB 写入在事务内；期间请求被删则回滚文件。saved==target → success，否则 failed。
- 状态机：`generating → success | failed | unknown`。超时/连接失败 → `unknown`（GatewayTimeoutUnknown），其余错误 → `failed`。
- 补齐（completeBatch）：失败批次若 0 < saved < target，可对缺失数量发起新请求，新图并入原批次（原批次 status 保持 failed，`isCompleted` 置位）。
- 锁纪律：SQLite 事务天然序列化写，无需进程内锁；**网关调用绝不能在事务内**（长 IO）。
- 服务重启恢复：`src/lib/init.ts` 的 `ensureInit()`（每个 API route 首行调用）把遗留 generating 置为 unknown；故意用裸 SQL 避免循环依赖。
- Mock 网关：`base_url` 以 `mock` 开头时走本地模拟（prompt 含 `mock-fail`/`mock-timeout`/`mock-partial` 触发对应场景），用于无网关开发调试。

### 数据模型（src/db/schema.ts，9 张表）

层级：`projects → categories → conversations → requests → batches → image_assets`，旁挂 `reference_assets`、`trash_records`、`idempotency`、`templates`。

- **实体 ID**：前缀 + 32 位 hex（`proj_`/`cat_`/`conv_`/`req_`/`batch_`/`img_`/`ref_`/`trash_`），用 `src/lib/id.ts` 的 `newId`/`validEntityId` 校验，路由层先校验格式再查库。
- **JSON-in-TEXT 列**（referenceAssetIds、parameters、requestSnapshot、tags 等）：`src/lib/serialize.ts` 负责 DB 行（snake_case 列 + JSON 字符串）↔ 实体对象（camelCase）互转，parse 均有 try/catch 兜底。改 schema 时记得同步改 serialize.ts。
- **软删除**：conversations/requests/imageAssets/referenceAssets 有 `isDeleted`/`deletedAt`；查询一律过滤 `isDeleted = 0`。
- **requestSnapshot**：发起时冻结的完整参数快照，重试/补齐均从快照重建 payload。
- **幂等**：`idempotency` 表按 (projectId, clientRequestId) 唯一索引；同键同 content hash（规范化 payload 的 sha256）返回既有请求，同键异 hash 409。

### 回收站（src/lib/trash.ts）

两阶段删除：软删写 `trash_records` → purge 前做引用检查（图片被 sourceImageIds 引用、参考图被 request 引用 → 409）→ 物理删 DB 记录 + 文件。`@legacy/` 前缀文件（旧版迁移来的）与 from_generation 参考图共享的文件一律不删。restore 级联恢复。

### 文件存储

- 输出目录 `public/outputs/<projectId>/`，路径统一 POSIX 分隔符存 JSON（`outputs/<uuid>.<ext>`、`thumbnails/<assetId>.jpg`）。
- `@legacy/` 前缀路径指向迁移过来的旧文件（相对 outputs 根目录而非项目子目录）。
- 图片二进制不走 Next 静态服务，统一走 `/api/images/[iid]/file|thumbnail|preview` 路由。

### API 约定

- 所有响应：`{success: true, ...data}` 或 `{success: false, error, code, detail, traceable_id}`。服务端用 `src/lib/errors.ts` 的 `ok()` / `ServiceError`（`badRequest`/`notFound`/`conflict`/`validationError`）；客户端 `api-client.ts` 的 `api()` 解析并抛 `ApiError`。
- 前端轮询：生成中 batch 每 2s 轮询 `/api/batches/[bid]`，到终态自动停止并 invalidate 对话（`usePollBatch`）。
- queryKeys 集中定义在 `src/hooks/use-projects.ts`，invalidate 时保持 key 前缀一致。

### API Key（安全边界）

Key 只存**浏览器 localStorage**（key `gpt_image2_settings`，见 `src/hooks/use-settings.ts`），每次生成由前端把 Key 放进请求体传给服务端转发，**服务端不落盘**。不要把 Key 写进任何服务端存储或日志。

### 模型能力配置

`model_capabilities.json`（项目根目录）为静态配置，`src/lib/config.ts` 读取并与内置默认合并（进程内缓存一次）。size/quality/参考图上限均以此校验；网关无能力发现接口。该文件记录了实测的网关出图分辨率分档规则（详见文件内 notes）。

## 环境变量（.env.local）

| 变量 | 说明 |
|------|------|
| `LIGHTWHEEL_BASE_URL` | 网关地址（默认 `https://ai.lightwheel.net:8086`） |
| `DATABASE_PATH` | SQLite 路径（默认 `data/app.db`） |
| `LIGHTWHEEL_TLS_VERIFY` | 自签名网关需设 `false` |
| `GENERATION_TIMEOUT` | 生成超时秒数（默认 300） |
| `OUTPUTS_DIR` | 图片输出目录（默认 `public/outputs`） |

## 其他约定

- TypeScript strict + `noUncheckedIndexedAccess`；路径别名 `@/*` → `src/*`。
- Tailwind CSS 4（`@tailwindcss/postcss`，无 tailwind.config）；明暗主题通过 `<html data-theme>` + globals.css 切换，layout.tsx 有防闪烁内联脚本。
- UI 弹窗统一走 `src/components/ui/modal.tsx` 的 `useModal`；toast 用 sonner。
- 旧版数据迁移脚本 `data-migration/migrate.ts` 是独立进程（tsx 直跑），不 import src/ 下代码，用裸 SQL。

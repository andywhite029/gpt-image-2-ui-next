import { client } from "@/db";

/**
 * 应用初始化单例。
 *
 * 在首次 API 请求（或服务启动）时调用一次：
 * recoverStale —— 把上次进程退出时遗留的 generating 状态的
 * request/batch 置为 unknown（与旧版 workbench.generation.recover_stale 语义一致）。
 *
 * 故意不依赖 generation.ts，避免循环依赖；直接用裸 SQL。
 */

let initialized = false;
let initPromise: Promise<void> | null = null;

async function recoverStale(): Promise<void> {
  const endedAt = Date.now();
  await client.execute({
    sql: "UPDATE requests SET status = 'unknown', unknown_reason = ?, ended_at = ? WHERE status = 'generating' AND is_deleted = 0",
    args: ["服务重启，结果未知", endedAt],
  });
  await client.execute({
    sql: "UPDATE batches SET status = 'unknown', ended_at = ? WHERE status = 'generating'",
    args: [endedAt],
  });
}

export async function ensureInit(): Promise<void> {
  if (initialized) return;
  if (!initPromise) {
    initPromise = recoverStale()
      .then(() => {
        initialized = true;
      })
      .catch((err) => {
        // 失败允许下次重试
        initPromise = null;
        throw err;
      });
  }
  await initPromise;
}

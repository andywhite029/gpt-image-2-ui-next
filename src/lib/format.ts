// 时间/字节/文本格式化工具

/** "MM-DD HH:mm"，非法值返回 "" */
export function fmtTime(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

/** "YYYY-MM-DD HH:mm"，用于详情面板等需要完整时间的场景 */
export function fmtFullTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 字节格式化：1.2 KB / 3.4 MB */
export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** 截断文本 */
export function truncate(text: string | null | undefined, n: number): string {
  if (!text) return "";
  return text.length > n ? text.slice(0, n) + "…" : text;
}

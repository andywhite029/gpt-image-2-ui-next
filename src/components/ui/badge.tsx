// 状态徽章：generating/success/failed/partial/unknown 配色

export type BadgeStatus = "generating" | "success" | "failed" | "partial" | "unknown";

const STATUS_LABEL: Record<BadgeStatus, string> = {
  generating: "生成中",
  success: "成功",
  failed: "失败",
  partial: "部分成功",
  unknown: "未知",
};

const STATUS_CLS: Record<BadgeStatus, string> = {
  generating:
    "border-[rgba(0,158,250,0.35)] bg-[rgba(0,158,250,0.14)] text-accent",
  success:
    "border-[rgba(0,190,147,0.3)] bg-[rgba(0,190,147,0.12)] text-ok",
  failed:
    "border-[rgba(245,63,63,0.3)] bg-[rgba(245,63,63,0.12)] text-err",
  partial:
    "border-[rgba(255,146,46,0.3)] bg-[rgba(255,146,46,0.12)] text-warn",
  unknown:
    "border-[rgba(138,92,255,0.3)] bg-[rgba(138,92,255,0.12)] text-unknown",
};

export function Badge({
  status,
  label,
  className = "",
}: {
  status: BadgeStatus;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] " +
        STATUS_CLS[status] +
        " " +
        className
      }
    >
      {status === "generating" && (
        <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-[rgba(0,158,250,0.3)] border-t-accent" />
      )}
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

/** 通用小标签（tag） */
export function Tag({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant?: "video" | "free";
}) {
  const cls =
    variant === "video"
      ? "tag tag-video"
      : variant === "free"
        ? "tag tag-free"
        : "tag";
  return <span className={cls}>{children}</span>;
}

/** 项目类型 tag */
export function ProjectTypeTag({ type }: { type: string }) {
  return type === "video_project" ? (
    <Tag variant="video">视频工程</Tag>
  ) : (
    <Tag variant="free">自由创作</Tag>
  );
}

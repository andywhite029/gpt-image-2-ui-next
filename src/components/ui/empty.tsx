// 空状态 / 加载中 / 错误状态组件

export function Empty({
  text,
  children,
}: {
  text?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      {text && <div>{text}</div>}
      {children}
    </div>
  );
}

export function Loading({ text = "加载中…" }: { text?: string }) {
  return (
    <div className="loading">
      <span className="spinner" />
      <span>{text}</span>
    </div>
  );
}

export function ErrorBox({
  message,
  children,
}: {
  message: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty !border-[rgba(245,63,63,0.4)] !bg-[rgba(245,63,63,0.05)] text-err">
      <div className="whitespace-pre-wrap break-words">{message}</div>
      {children}
    </div>
  );
}

/** 视图头部（标题 + 描述 + 右侧操作） */
export function ViewHeader({
  title,
  desc,
  actions,
  tags,
}: {
  title: React.ReactNode;
  desc?: string;
  actions?: React.ReactNode;
  tags?: React.ReactNode;
}) {
  return (
    <div className="mb-4.5 flex flex-wrap items-start gap-3.5">
      <div className="min-w-0">
        <h1 className="m-0 flex flex-wrap items-center gap-2.5 text-[19px] font-bold">
          {title}
          {tags}
        </h1>
        {desc && <div className="mt-1.5 text-[13px] leading-relaxed text-muted">{desc}</div>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

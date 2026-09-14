"use client";

// 轻量 Modal：backdrop + dialog + Escape 关闭 + 点击遮罩关闭
// 函数式 API：openModal / confirmModal / promptModal

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ModalKind = "primary" | "danger" | "ghost";

export interface ModalAction {
  label: string;
  kind?: ModalKind;
  onClick?: () => void | boolean | Promise<void | boolean>;
}

interface ModalRequest {
  title: string;
  body: ReactNode;
  actions: ModalAction[];
  wide?: boolean;
}

interface PromptModalOptions {
  title: string;
  label?: string;
  value?: string;
  textarea?: boolean;
  placeholder?: string;
}

// ---------------------------------------------------------------------------
// Context：函数式打开弹窗
// ---------------------------------------------------------------------------

interface ModalAPI {
  openModal: (req: ModalRequest) => void;
  confirmModal: (opts: {
    title?: string;
    message: string;
    danger?: boolean;
    confirmText?: string;
    cancelText?: string;
  }) => Promise<boolean>;
  promptModal: (opts: PromptModalOptions) => Promise<string | null>;
}

const ModalContext = createContext<ModalAPI | null>(null);

export function useModal(): ModalAPI {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal 必须在 ModalProvider 内使用");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider（挂在应用根部，渲染当前弹窗栈）
// ---------------------------------------------------------------------------

interface StackEntry extends ModalRequest {
  id: number;
  close: () => void;
}

let nextId = 1;

export function ModalProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<StackEntry[]>([]);

  const remove = useCallback((id: number) => {
    setStack((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const openModal = useCallback(
    (req: ModalRequest) => {
      const id = nextId++;
      setStack((prev) => [...prev, { ...req, id, close: () => remove(id) }]);
    },
    [remove]
  );

  const confirmModal = useCallback(
    (opts: {
      title?: string;
      message: string;
      danger?: boolean;
      confirmText?: string;
      cancelText?: string;
    }): Promise<boolean> =>
      new Promise((resolve) => {
        let settled = false;
        const done = (v: boolean) => {
          if (!settled) {
            settled = true;
            resolve(v);
          }
        };
        const id = nextId++;
        const close = () => remove(id);
        setStack((prev) => [
          ...prev,
          {
            id,
            close,
            title: opts.title ?? "确认操作",
            body: <p className="text-[13px] leading-relaxed text-muted">{opts.message}</p>,
            actions: [
              {
                label: opts.cancelText ?? "取消",
                kind: "ghost",
                onClick: () => {
                  done(false);
                  return true;
                },
              },
              {
                label: opts.confirmText ?? "确定",
                kind: opts.danger ? "danger" : "primary",
                onClick: () => {
                  done(true);
                  return true;
                },
              },
            ],
          },
        ]);
      }),
    [remove]
  );

  const promptModal = useCallback(
    (opts: PromptModalOptions): Promise<string | null> =>
      new Promise((resolve) => {
        let settled = false;
        const done = (v: string | null) => {
          if (!settled) {
            settled = true;
            resolve(v);
          }
        };
        const id = nextId++;
        const close = () => {
          done(null);
          remove(id);
        };
        const content = (
          <PromptBody
            opts={opts}
            onDone={(v) => {
              done(v);
              remove(id);
            }}
          />
        );
        setStack((prev) => [
          ...prev,
          {
            id,
            close,
            title: opts.title,
            body: content,
            actions: [
              {
                label: "取消",
                kind: "ghost",
                onClick: () => {
                  done(null);
                  return true;
                },
              },
              {
                label: "确定",
                kind: "primary",
                onClick: () => {
                  // 由 PromptBody 通过 DOM 事件桥接提交
                  const event = new CustomEvent("modal-prompt-submit", { detail: id });
                  window.dispatchEvent(event);
                  return false; // 不自动关闭，等 PromptBody 完成后关闭
                },
              },
            ],
          },
        ]);
      }),
    [remove]
  );

  // Escape 关闭最上层
  useEffect(() => {
    if (!stack.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        const top = stack[stack.length - 1];
        if (top) top.close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack]);

  const api: ModalAPI = { openModal, confirmModal, promptModal };

  return (
    <ModalContext.Provider value={api}>
      {children}
      {stack.map((entry, i) => (
        <ModalDialog
          key={entry.id}
          entry={entry}
          onBackdrop={() => {
            // 仅最上层弹窗响应遮罩点击
            if (i === stack.length - 1) entry.close();
          }}
        />
      ))}
    </ModalContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// 受控 Modal 组件（也可作为声明式组件使用）
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(5,7,10,0.72)] p-5 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={
          "max-h-[calc(100vh-40px)] w-full overflow-y-auto rounded-2xl border border-border bg-panel p-5 shadow-2xl " +
          (wide ? "max-w-[720px]" : "max-w-[520px]")
        }
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="m-0 text-base">{title}</h2>
          <button
            type="button"
            aria-label="关闭"
            className="flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-panel2 text-lg text-muted transition-colors hover:border-accent hover:text-text"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div>{children}</div>
        {footer != null && (
          <div className="mt-5 flex flex-wrap justify-end gap-2.5">{footer}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 内部：Provider 栈用对话框
// ---------------------------------------------------------------------------

function ModalDialog({ entry, onBackdrop }: { entry: StackEntry; onBackdrop: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("input, textarea, select");
    (first ?? el.querySelector<HTMLButtonElement>("button"))?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(5,7,10,0.72)] p-5 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onBackdrop();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className={
          "max-h-[calc(100vh-40px)] w-full overflow-y-auto rounded-2xl border border-border bg-panel p-5 shadow-2xl " +
          (entry.wide ? "max-w-[720px]" : "max-w-[520px]")
        }
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="m-0 text-base">{entry.title}</h2>
          <button
            type="button"
            aria-label="关闭"
            className="flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-panel2 text-lg text-muted transition-colors hover:border-accent hover:text-text"
            onClick={entry.close}
          >
            ×
          </button>
        </div>
        <div>{entry.body}</div>
        {entry.actions.length > 0 && (
          <div className="mt-5 flex flex-wrap justify-end gap-2.5">
            {entry.actions.map((action, idx) => (
              <ModalActionButton key={idx} action={action} close={entry.close} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ModalActionButton({ action, close }: { action: ModalAction; close: () => void }) {
  const [busy, setBusy] = useState(false);
  const cls =
    action.kind === "primary"
      ? "btn-primary px-3 py-1.5 text-xs"
      : action.kind === "danger"
        ? "btn-danger px-3 py-1.5 text-xs"
        : "btn-ghost px-3 py-1.5 text-xs";

  return (
    <button
      type="button"
      className={cls}
      disabled={busy}
      onClick={async () => {
        if (!action.onClick) {
          close();
          return;
        }
        setBusy(true);
        try {
          const result = await action.onClick();
          if (result !== false) close();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "处理中…" : action.label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 内部：promptModal 的表单体
// ---------------------------------------------------------------------------

function PromptBody({
  opts,
  onDone,
}: {
  opts: PromptModalOptions;
  onDone: (v: string | null) => void;
}) {
  const [value, setValue] = useState(opts.value ?? "");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (inputRef.current instanceof HTMLInputElement) inputRef.current.select();
  }, []);

  // 监听确定按钮派发的提交事件
  useEffect(() => {
    const onSubmit = () => onDone(value);
    window.addEventListener("modal-prompt-submit", onSubmit);
    return () => window.removeEventListener("modal-prompt-submit", onSubmit);
  }, [value, onDone]);

  const common = {
    className: "input-text",
    value,
    placeholder: opts.placeholder,
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => setValue(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !opts.textarea) {
        e.preventDefault();
        onDone(value);
      }
    },
  };

  return (
    <div className="field">
      {opts.label && <label className="field-label">{opts.label}</label>}
      {opts.textarea ? (
        <textarea ref={inputRef as React.RefObject<HTMLTextAreaElement>} rows={5} {...common} />
      ) : (
        <input ref={inputRef as React.RefObject<HTMLInputElement>} type="text" {...common} />
      )}
    </div>
  );
}

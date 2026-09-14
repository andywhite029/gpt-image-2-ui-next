"use client";

// 受控右键菜单：fixed 定位、视口防溢出翻转、Escape / 点击外部 / 滚动 / 窗口缩放关闭、进场动画
// 用法：const { menu, openMenu, closeMenu } = useContextMenu();
//       行上 onContextMenu={(e) => openMenu(e, items)}，树里挂 <ContextMenu menu={menu} onClose={closeMenu} />

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

/** 菜单动作项 */
export interface ContextMenuAction {
  label: string;
  icon?: LucideIcon; // lucide 图标组件
  danger?: boolean; // 危险操作（红色，用于删除）
  disabled?: boolean;
  onSelect?: () => void;
}

/** 菜单项：动作或分隔符（用 "separator" in item 区分） */
export type ContextMenuItem = { separator: true } | ContextMenuAction;

/** 分隔符项（也可直接内联 { separator: true }） */
export const separator: ContextMenuItem = { separator: true };

export interface ContextMenuState {
  open: boolean;
  x: number; // 视口坐标
  y: number;
  items: ContextMenuItem[];
}

// ---------------------------------------------------------------------------
// 状态 hook：调用方持有菜单状态
// ---------------------------------------------------------------------------

/** 便捷打开方式：包一层 hook 供调用方管理状态 */
export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState>({ open: false, x: 0, y: 0, items: [] });
  const openMenu = (e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ open: true, x: e.clientX, y: e.clientY, items });
  };
  const closeMenu = () => setMenu((m) => (m.open ? { ...m, open: false } : m));
  return { menu, openMenu, closeMenu };
}

// ---------------------------------------------------------------------------
// 受控右键菜单组件
// ---------------------------------------------------------------------------

export function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  // 关闭即卸载（下次打开重新挂载，进场动画重放）；
  // portal 到 body，避免被侧栏 overflow 裁剪。初始 open 恒为 false，SSR 不触达 document
  if (!menu.open) return null;
  return createPortal(
    <MenuPanel x={menu.x} y={menu.y} items={menu.items} onClose={onClose} />,
    document.body
  );
}

// ---------------------------------------------------------------------------
// 内部：菜单面板
// ---------------------------------------------------------------------------

function MenuPanel({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // 防溢出翻转后的最终位置（初始为光标原始坐标，绘制前修正，无闪烁）
  const [pos, setPos] = useState({ x, y });

  // 渲染后测量尺寸：超出视口则向左/上收（留 8px 边距，最小 0）
  // 用 offsetWidth/offsetHeight：布局尺寸，不受进场动画 transform 的影响
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let nx = x;
    let ny = y;
    if (x + w > window.innerWidth) nx = Math.max(0, window.innerWidth - w - 8);
    if (y + h > window.innerHeight) ny = Math.max(0, window.innerHeight - h - 8);
    setPos((prev) => (prev.x === nx && prev.y === ny ? prev : { x: nx, y: ny }));
  }, [x, y, items]);

  // 点击外部（捕获阶段，先于行内 handler）/ Escape / 任意滚动 / 窗口缩放 → 关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      role="menu"
      className="anim-menu-in fixed z-[80] min-w-[160px] rounded-lg border border-border bg-panel py-1 shadow-xl"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) =>
        "separator" in item ? (
          <div key={i} className="mx-2 my-1 border-t border-border" />
        ) : (
          <MenuItemButton key={i} item={item} onClose={onClose} />
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 内部：动作项按钮
// ---------------------------------------------------------------------------

function MenuItemButton({ item, onClose }: { item: ContextMenuAction; onClose: () => void }) {
  const Icon = item.icon;
  const cls =
    "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors " +
    (item.disabled
      ? "cursor-not-allowed text-faint hover:bg-transparent"
      : item.danger
        ? "cursor-pointer text-err hover:bg-[rgba(245,63,63,0.08)]"
        : "cursor-pointer text-text hover:bg-panel2");

  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      className={cls}
      onClick={(e) => {
        e.stopPropagation();
        item.onSelect?.();
        onClose(); // 触发动作后随即关闭菜单
      }}
    >
      {Icon && <Icon size={14} strokeWidth={1.8} className="shrink-0" />}
      <span className="truncate">{item.label}</span>
    </button>
  );
}

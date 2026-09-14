"use client";

// 顶栏 52px：sidebar 切换、logo、全局搜索、主题切换、设置

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUI } from "@/app/providers";

const THEME_ORDER = ["dark", "light", "system"] as const;
const THEME_ICON: Record<string, string> = {
  dark: "🌙",
  light: "☀️",
  system: "🖥",
};

export function TopNav() {
  const router = useRouter();
  const { theme, setTheme, toggleSidebar, setSettingsOpen } = useUI();
  const [search, setSearch] = useState("");

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  const cycleTheme = () => {
    const idx = Math.max(0, THEME_ORDER.indexOf(theme));
    const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length]!;
    setTheme(next);
  };

  const themeLabel =
    theme === "system" ? "跟随系统" : theme === "dark" ? "深色" : "浅色";

  return (
    <header className="relative z-30 flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-panel px-3.5">
      <button
        type="button"
        className="btn-icon"
        title="折叠/展开侧栏"
        aria-label="折叠或展开侧栏"
        onClick={toggleSidebar}
      >
        ☰
      </button>
      <a className="flex items-center gap-2 whitespace-nowrap text-[15px] font-bold text-text hover:no-underline hover:opacity-90" href="/">
        <span aria-hidden="true">🎨</span>
        <span className="max-[560px]:hidden">gpt-image-2 工作台</span>
      </a>
      <form className="relative mx-auto w-full max-w-[520px]" role="search" onSubmit={onSearchSubmit}>
        <input
          type="search"
          className="w-full rounded-lg border border-border bg-panel2 py-2 pr-3 pl-9 text-[13px] text-text outline-none transition-colors focus:border-accent"
          placeholder="搜索项目、对话、Prompt、标签、参考图…"
          autoComplete="off"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px] opacity-60">
          🔍
        </span>
      </form>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          className="btn-icon"
          title={`主题：${themeLabel}（点击切换）`}
          aria-label={`切换主题（当前${themeLabel}）`}
          onClick={cycleTheme}
        >
          {THEME_ICON[theme] ?? "🖥"}
        </button>
        <button type="button" className="btn-ghost btn-ghost-sm" onClick={() => setSettingsOpen(true)}>
          <span aria-hidden="true">⚙</span> 设置
        </button>
      </div>
    </header>
  );
}

"use client";

// 全局 Providers：TanStack Query + 本地 UI 状态 Context（主题等）

import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { loadSettings, saveSettings, type Settings } from "@/hooks/use-settings";

// ---------------------------------------------------------------------------
// UI 状态 Context
// ---------------------------------------------------------------------------

type Theme = "system" | "light" | "dark";

interface UIState {
  /** 用户选择的 theme（system/light/dark） */
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** 侧栏折叠（桌面端持久化） */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** 移动端侧栏打开 */
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  /** 设置弹窗打开 */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** 生成中的对话 id 集合（侧栏呼吸点） */
  generatingConversationIds: Set<string>;
  setConversationGenerating: (cid: string, generating: boolean) => void;
}

const UIContext = createContext<UIState | null>(null);

export function useUI(): UIState {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI 必须在 Providers 内使用");
  return ctx;
}

function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme === "dark" || theme === "light") return theme;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export function Providers({ children }: { children: ReactNode }) {
  const client = useRef(
    new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 5_000,
          retry: 1,
          refetchOnWindowFocus: false,
        },
      },
    })
  ).current;

  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());

  // 首次挂载后读取 settings（layout 里的防闪烁脚本已先行设置 data-theme）
  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const applyTheme = useCallback((theme: Theme) => {
    document.documentElement.setAttribute("data-theme", resolveTheme(theme));
  }, []);

  // 监听系统主题变化（仅 system 模式生效）
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const current = loadSettings().theme;
      if (current === "system") applyTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [applyTheme]);

  const setTheme = useCallback(
    (t: Theme) => {
      setSettings((prev) => {
        const next = { ...prev, theme: t };
        saveSettings(next);
        return next;
      });
      applyTheme(t);
    },
    [applyTheme]
  );

  const toggleSidebar = useCallback(() => {
    if (window.innerWidth < 900) {
      setMobileSidebarOpen((v) => !v);
      return;
    }
    setSidebarCollapsed((v) => {
      const next = !v;
      setSettings((prev) => {
        const s = { ...prev, sidebarCollapsed: next };
        saveSettings(s);
        return s;
      });
      return next;
    });
  }, []);

  const setConversationGenerating = useCallback((cid: string, generating: boolean) => {
    setGeneratingIds((prev) => {
      const next = new Set(prev);
      if (generating) next.add(cid);
      else next.delete(cid);
      return next;
    });
  }, []);

  const value = useMemo<UIState>(
    () => ({
      theme: settings.theme,
      setTheme,
      sidebarCollapsed,
      toggleSidebar,
      mobileSidebarOpen,
      setMobileSidebarOpen,
      settingsOpen,
      setSettingsOpen,
      generatingConversationIds: generatingIds,
      setConversationGenerating,
    }),
    [settings.theme, setTheme, sidebarCollapsed, toggleSidebar, mobileSidebarOpen, settingsOpen, generatingIds, setConversationGenerating]
  );

  // 初始侧栏折叠状态来自 localStorage
  useEffect(() => {
    setSidebarCollapsed(loadSettings().sidebarCollapsed);
  }, []);

  return (
    <QueryClientProvider client={client}>
      <UIContext.Provider value={value}>{children}</UIContext.Provider>
    </QueryClientProvider>
  );
}

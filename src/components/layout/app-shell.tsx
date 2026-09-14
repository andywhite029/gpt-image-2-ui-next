"use client";

// 应用外壳：TopNav + Sidebar + Breadcrumb + 页面内容 + 全局设置弹窗
// 由 src/app/(app)/layout.tsx 使用

import { useUI } from "@/app/providers";
import { TopNav } from "@/components/layout/topnav";
import { Sidebar } from "@/components/layout/sidebar";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { SettingsModal } from "@/components/layout/settings-modal";
import { ModalProvider } from "@/components/ui/modal";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed } = useUI();

  return (
    <ModalProvider>
      <div className="flex h-screen flex-col overflow-hidden">
        <TopNav />
        <div className="relative flex min-h-0 flex-1">
          {/* 桌面端：折叠用负 margin 收起；移动端：Sidebar 内部用 fixed overlay */}
          <div
            className={
              "min-h-0 shrink-0 transition-[margin] duration-200 max-[900px]:hidden " +
              (sidebarCollapsed ? "md:-ml-[240px]" : "")
            }
          >
            <Sidebar />
          </div>
          {/* 移动端侧栏单独挂载（fixed overlay + scrim，受折叠状态控制） */}
          <div className="hidden max-[900px]:block">
            <Sidebar mobileOnly />
          </div>
          <main className="flex min-w-0 flex-1 flex-col bg-bg">
            <Breadcrumb />
            <div className="flex-1 overflow-y-auto p-5 pb-15 max-[900px]:p-3.5 max-[900px]:pb-12">
              {children}
            </div>
          </main>
        </div>
      </div>
      <SettingsModal />
    </ModalProvider>
  );
}

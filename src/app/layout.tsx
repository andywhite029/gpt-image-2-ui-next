import type { Metadata } from "next";
import { Toaster } from "sonner";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "gpt-image-2 创作工作台",
  description: "gpt-image-2 AI 图片创作工作台",
};

// 防闪烁脚本：在任何渲染前按 localStorage 设置 data-theme
const themeInitScript = `(function () {
  var t = "system";
  try {
    var raw = localStorage.getItem("gpt_image2_settings");
    if (raw) t = (JSON.parse(raw).theme) || "system";
    if (t === "system") {
      t = (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }
  } catch (e) { t = "light"; }
  document.documentElement.setAttribute("data-theme", t === "dark" ? "dark" : "light");
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
        <Toaster
          position="top-right"
          richColors
          toastOptions={{
            style: {
              fontSize: "13px",
              maxWidth: "420px",
            },
          }}
        />
      </body>
    </html>
  );
}

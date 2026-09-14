"use client";

// 设置弹窗：baseUrl / apiKey（显示切换）/ model / theme / 记住设置

import { useState } from "react";
import { toast } from "sonner";
import { useUI } from "@/app/providers";
import { Modal } from "@/components/ui/modal";
import { useSettings } from "@/hooks/use-settings";
import { useConfig } from "@/hooks/use-projects";

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen } = useUI();
  const { settings, update } = useSettings();
  const { data: config } = useConfig();

  // 本地编辑态（打开时从 settings 初始化）
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-image-2");
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [saveLocal, setSaveLocal] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // 弹窗打开时同步表单
  if (settingsOpen && !initialized) {
    setBaseUrl(settings.baseUrl || config?.baseUrl || "");
    setApiKey(settings.apiKey || "");
    setModel(settings.model || config?.model || "gpt-image-2");
    setTheme(settings.theme);
    setSaveLocal(settings.saveLocal);
    setInitialized(true);
  }
  if (!settingsOpen && initialized) {
    setInitialized(false);
  }

  const { setTheme: applyTheme } = useUI();

  const onSave = () => {
    update({
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: model.trim() || "gpt-image-2",
      saveLocal,
      theme,
    });
    applyTheme(theme);
    toast.success("设置已保存");
    setSettingsOpen(false);
  };

  return (
    <Modal
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      title="连接与模型设置"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={() => setSettingsOpen(false)}>
            取消
          </button>
          <button type="button" className="btn-primary" onClick={onSave}>
            保存
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label">API Base URL</label>
        <input
          type="text"
          className="input-text"
          value={baseUrl}
          autoComplete="url"
          placeholder="https://ai.lightwheel.net:8086"
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label">API Key</label>
        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            className="input-text pr-14"
            value={apiKey}
            autoComplete="off"
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button
            type="button"
            className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer border-none bg-transparent text-xs text-accent"
            onClick={() => setShowKey((v) => !v)}
          >
            {showKey ? "隐藏" : "显示"}
          </button>
        </div>
      </div>
      <div className="field">
        <label className="field-label">模型</label>
        <input
          type="text"
          className="input-text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label">主题</label>
        <select
          className="input-select"
          value={theme}
          onChange={(e) => setTheme(e.target.value as typeof theme)}
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={saveLocal}
          onChange={(e) => setSaveLocal(e.target.checked)}
        />
        在浏览器中记住设置（含 API Key）
      </label>
      <div className="mt-2.5 text-[11px] leading-relaxed text-muted">
        设置保存在浏览器 localStorage；生成请求由后端转发，不经过其他服务。
      </div>
    </Modal>
  );
}

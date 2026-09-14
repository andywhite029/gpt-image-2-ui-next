"use client";

// localStorage 设置（key: gpt_image2_settings，与旧版一致）

export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  saveLocal: boolean;
  sidebarCollapsed: boolean;
  theme: "system" | "light" | "dark";
  lastSize: string;
}

const SETTINGS_KEY = "gpt_image2_settings";
const LEGACY_KEYS = ["gpt-image2-settings", "gptimage2_settings"];

const DEFAULT_SETTINGS: Settings = {
  baseUrl: "",
  apiKey: "",
  model: "gpt-image-2",
  saveLocal: true,
  sidebarCollapsed: false,
  theme: "system",
  lastSize: "",
};

export function loadSettings(): Settings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  let raw: unknown = null;
  for (const key of [SETTINGS_KEY, ...LEGACY_KEYS]) {
    const text = window.localStorage.getItem(key);
    if (!text) continue;
    try {
      raw = JSON.parse(text);
      break;
    } catch {
      /* 损坏数据，尝试下一个键 */
    }
  }
  return normalizeSettings(raw);
}

export function saveSettings(s: Settings): void {
  if (typeof window === "undefined") return;
  if (!s.saveLocal) {
    window.localStorage.removeItem(SETTINGS_KEY);
    for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function normalizeSettings(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return s;
  const r = raw as Record<string, unknown>;
  s.baseUrl = (r.baseUrl as string) ?? (r.base_url as string) ?? s.baseUrl;
  s.apiKey = (r.apiKey as string) ?? (r.api_key as string) ?? s.apiKey;
  s.model = (r.model as string) ?? s.model;
  s.saveLocal = (r.saveLocal as boolean) ?? (r.save_local as boolean) ?? s.saveLocal;
  s.sidebarCollapsed =
    (r.sidebarCollapsed as boolean) ?? (r.sidebar_collapsed as boolean) ?? s.sidebarCollapsed;
  const theme = (r.theme as Settings["theme"]) ?? s.theme;
  s.theme = theme === "dark" || theme === "light" ? theme : "system";
  s.lastSize = (r.lastSize as string) ?? (r.last_size as string) ?? s.lastSize;
  return s;
}

import { useCallback, useEffect, useState } from "react";

/**
 * 设置读写 hook。update 会立即写 localStorage 并触发重渲染。
 */
export function useSettings() {
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings());

  useEffect(() => {
    setSettingsState(loadSettings());
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  return { settings, update };
}

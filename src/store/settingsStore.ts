import { create } from "zustand";
import type { Theme } from "@/store/appStore";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ShortcutStats {
  used: Record<string, number>;
  mouse: number;
}

export interface GuideHint {
  shortcut: string;
  label: string;
}

export interface GlobalConfig {
  language: string;
  theme: Theme;
  fontSize: number;
  autoSave: boolean;
  customShortcuts: Record<string, string>;
  guideMode: boolean;
  shortcutStats: ShortcutStats;
}

interface SettingsState extends GlobalConfig {
  guideHint: GuideHint | null;
  resolvedTheme: "paper" | "ink";
  loaded: boolean;

  loadSettings: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  setResolvedTheme: (resolved: "paper" | "ink") => void;
  setFontSize: (size: number) => void;
  setAutoSave: (enabled: boolean) => void;
  setCustomShortcut: (id: string, combo: string) => void;
  resetCustomShortcut: (id: string) => void;
  toggleGuideMode: () => void;
  recordShortcutUse: (id: string) => void;
  recordMouseAction: (shortcut: string, label: string) => void;
  clearGuideHint: () => void;
}

// ── Defaults (localStorage fallback for browser dev mode) ─────────────────────

function getDefaults(): GlobalConfig {
  return {
    language: localStorage.getItem("tybre-lang") ?? "en",
    theme: (localStorage.getItem("tybre:theme") as Theme) ?? "system",
    fontSize: parseInt(localStorage.getItem("tybre:fontSize") ?? "16", 10),
    autoSave: JSON.parse(localStorage.getItem("tybre:autoSave") ?? "true"),
    customShortcuts: JSON.parse(localStorage.getItem("tybre:customShortcuts") ?? "{}"),
    guideMode: JSON.parse(localStorage.getItem("tybre:guideMode") ?? "false"),
    shortcutStats: (() => {
      const raw = JSON.parse(
        localStorage.getItem("tybre:shortcutStats") ?? '{"used":{},"mouse":0}'
      );
      if (typeof raw.used === "number") return { used: {}, mouse: raw.mouse ?? 0 };
      return raw;
    })(),
  };
}

// ── Debounced file save ───────────────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function persistConfig(cfg: GlobalConfig) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_global_config", {
      config: {
        language: cfg.language,
        theme: cfg.theme,
        font_size: cfg.fontSize,
        auto_save: cfg.autoSave,
        custom_shortcuts: cfg.customShortcuts,
        guide_mode: cfg.guideMode,
        shortcut_stats: { used: cfg.shortcutStats.used, mouse: cfg.shortcutStats.mouse },
      },
    });
  } catch {
    // browser dev mode — silent
  }
}

function schedSave(getState: () => SettingsState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistConfig(getState()), 500);
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...getDefaults(),
  guideHint: null,
  resolvedTheme: "paper",
  loaded: false,

  loadSettings: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const cfg = await invoke<{
        language: string;
        theme: string;
        font_size: number;
        auto_save: boolean;
        custom_shortcuts: Record<string, string>;
        guide_mode: boolean;
        shortcut_stats: { used: Record<string, number>; mouse: number };
      }>("load_global_config");

      set({
        language: cfg.language,
        theme: cfg.theme as Theme,
        fontSize: cfg.font_size,
        autoSave: cfg.auto_save,
        customShortcuts: cfg.custom_shortcuts,
        guideMode: cfg.guide_mode,
        shortcutStats: cfg.shortcut_stats,
        loaded: true,
      });

      document.documentElement.style.setProperty("--font-size-base", `${cfg.font_size}px`);
    } catch {
      // browser dev mode — keep localStorage defaults
      set({ loaded: true });
    }
  },

  setTheme: (theme) => {
    set({ theme });
    schedSave(get);
  },

  setResolvedTheme: (resolvedTheme) => {
    const root = document.documentElement;
    if (resolvedTheme === "ink") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.add("light");
      root.classList.remove("dark");
    }
    set({ resolvedTheme });
  },

  setFontSize: (size) => {
    const clamped = Math.min(24, Math.max(14, size));
    document.documentElement.style.setProperty("--font-size-base", `${clamped}px`);
    set({ fontSize: clamped });
    schedSave(get);
  },

  setAutoSave: (autoSave) => {
    set({ autoSave });
    schedSave(get);
  },

  setCustomShortcut: (id, combo) => {
    set((s) => ({ customShortcuts: { ...s.customShortcuts, [id]: combo } }));
    schedSave(get);
  },

  resetCustomShortcut: (id) => {
    set((s) => {
      const next = { ...s.customShortcuts };
      delete next[id];
      return { customShortcuts: next };
    });
    schedSave(get);
  },

  toggleGuideMode: () => {
    set((s) => ({ guideMode: !s.guideMode }));
    schedSave(get);
  },

  recordShortcutUse: (id) => {
    set((s) => {
      const prev = s.shortcutStats.used ?? {};
      return {
        shortcutStats: {
          ...s.shortcutStats,
          used: { ...prev, [id]: (prev[id] ?? 0) + 1 },
        },
      };
    });
    schedSave(get);
  },

  recordMouseAction: (shortcut, label) => {
    set((s) => ({
      shortcutStats: { ...s.shortcutStats, mouse: s.shortcutStats.mouse + 1 },
      guideHint: { shortcut, label },
    }));
    schedSave(get);
  },

  clearGuideHint: () => {
    set({ guideHint: null });
  },
}));

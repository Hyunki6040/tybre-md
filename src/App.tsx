import { useEffect, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore, type Tab } from "@/store/appStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useWorkspaceStore } from "@/store/workspaceStore";

import { TabBar } from "@/components/TabBar";
import { Sidebar } from "@/components/Sidebar";
import { QuickOpen } from "@/components/QuickOpen";
import { Settings } from "@/components/Settings";
import { FindBar } from "@/components/FindBar";
import { ProjectSearch } from "@/components/ProjectSearch";
import { ExportModal } from "@/components/ExportModal";
import { SHORTCUT_DEFS, matchesCombo } from "@/lib/shortcuts";
import { StatusBar } from "@/components/StatusBar";
import { MilkdownEditor } from "@/editor/MilkdownEditor";
import { CodeEditor } from "@/editor/CodeEditor";
import { TerminalView } from "@/components/TerminalView";
import { LanguageModal } from "@/components/LanguageModal";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSwitchProject, getOpenProjects } from "@/hooks/useSwitchProject";
import { IMAGE_EXTS, CODE_EXTS, getFileExt } from "@/lib/fileTypes";

function ImageViewer({ filePath }: { filePath: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    import("@tauri-apps/api/core").then(({ convertFileSrc }) => {
      setSrc(convertFileSrc(filePath));
    });
  }, [filePath]);
  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto p-4">
      {src && (
        <img
          src={src}
          alt={filePath.split("/").pop()}
          className="max-h-full max-w-full object-contain"
        />
      )}
    </div>
  );
}

function PdfViewer({ filePath }: { filePath: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    import("@tauri-apps/api/core").then(({ convertFileSrc }) => {
      setSrc(convertFileSrc(filePath));
    });
  }, [filePath]);
  return (
    <div className="flex h-full w-full">
      {src && (
        <iframe
          src={src}
          className="flex-1 w-full border-0"
          title={filePath.split("/").pop()}
        />
      )}
    </div>
  );
}

function TxtViewer({ content }: { content: string }) {
  return (
    <div className="h-full w-full overflow-auto p-6">
      <pre className="min-w-0 whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground">
        {content}
      </pre>
    </div>
  );
}

export default function App() {
  const { t } = useTranslation();
  const {
    tabs,
    activeTabId,
    updateTabContent,
    markTabSaved,
    restoreLastTab,
    setActiveTab,
    setQuickOpenVisible,
    setFileTree,
    addRecentDir,
    fileTree,
    settingsVisible, setSettingsVisible,
    findBarVisible, setFindBarVisible,
    projectSearchVisible, setProjectSearchVisible,
    exportVisible, setExportVisible,
    setPendingTerminalCommand,
  } = useAppStore();

  const {
    theme,
    resolvedTheme,
    setResolvedTheme,
    fontSize,
    setFontSize,
    autoSave,
    customShortcuts,
    guideMode,
    recordShortcutUse,
    loadSettings,
  } = useSettingsStore();

  const { toggleSidebar, loadWorkspace, terminalOpen, toggleTerminal, setTerminalOpen } = useWorkspaceStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const switchProject = useSwitchProject();

  // ── Claude CLI install banner ────────────────────────────────────────────
  const [claudeInstalled, setClaudeInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke<boolean>("check_claude_installed")
          .then((ok) => setClaudeInstalled(ok))
          .catch(() => setClaudeInstalled(true))
      )
      .catch(() => setClaudeInstalled(true));
  }, []);

  // ── App auto-update banner ────────────────────────────────────────────────
  type UpdatePhase = "idle" | "downloading" | "ready";
  interface UpdateInfo { version: string; body: string | null }

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>("idle");
  const [downloadPct, setDownloadPct] = useState(0);
  const pendingUpdateRef = useRef<import("@tauri-apps/plugin-updater").Update | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function checkUpdate() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      if (getCurrentWindow().label !== "main") return;
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (cancelled || !update) return;
      pendingUpdateRef.current = update;
      setUpdateInfo({ version: update.version, body: update.body ?? null });
    }
    checkUpdate().catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function handleInstallUpdate() {
    const update = pendingUpdateRef.current;
    if (!update) return;
    setUpdatePhase("downloading");
    setDownloadPct(0);
    let received = 0;
    let total = 0;
    try {
      await update.downloadAndInstall((evt) => {
        if (evt.event === "Started" && evt.data.contentLength) {
          total = evt.data.contentLength;
        } else if (evt.event === "Progress") {
          received += evt.data.chunkLength;
          if (total > 0) setDownloadPct(Math.round((received / total) * 100));
        } else if (evt.event === "Finished") {
          setUpdatePhase("ready");
        }
      });
      setUpdatePhase("ready");
    } catch {
      setUpdatePhase("idle");
    }
  }

  async function handleRelaunch() {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch { /* noop */ }
  }

  // Resolve effective shortcut combo (custom overrides default)
  function key(id: string): string {
    return customShortcuts[id] ?? SHORTCUT_DEFS.find((s) => s.id === id)?.defaultKey ?? "";
  }
  function matches(id: string, e: KeyboardEvent): boolean {
    return matchesCombo(e, key(id));
  }

  // Auto-save timer ref
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Terminal focus ref — TerminalView registers its focus function here
  const terminalFocusRef = useRef<(() => void) | null>(null);

  // ── Apply persisted font size on mount ───────────────────────────────────
  useEffect(() => {
    document.documentElement.style.setProperty("--font-size-base", `${fontSize}px`);
  }, [fontSize]);

  // ── File watcher: auto-reload open tabs when external tools change files ────
  useEffect(() => {
    if (!fileTree) return;

    let unlisten: (() => void) | null = null;

    async function setup() {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");

      invoke("start_watching", { path: fileTree!.path }).catch(console.error);

      unlisten = await listen<string>("file-changed", async (event) => {
        const changedPath = event.payload;
        const { tabs } = useAppStore.getState();
        const tab = tabs.find((t) => t.filePath === changedPath);
        // Don't overwrite unsaved user edits or binary files
        if (!tab || tab.isDirty) return;
        const ext = getFileExt(changedPath);
        if (IMAGE_EXTS.has(ext) || ext === "pdf") return;

        try {
          const content = await invoke<string>("read_file", { path: changedPath });
          useAppStore.setState((s) => ({
            tabs: s.tabs.map((t) =>
              t.id === tab.id ? { ...t, content } : t
            ),
          }));
        } catch { /* file briefly locked during write, skip */ }
      });
    }

    setup().catch(console.error);

    return () => {
      unlisten?.();
      import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("stop_watching").catch(() => {}))
        .catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileTree?.path]);

  // ── Session restore + project open ──────────────────────────────────────────
  // Runs once on mount. Handles two cases:
  //   • Main window (label "main"): reads all sessions, applies own, spawns child windows
  //   • Project window (?project=<path>): opens project + restores its saved tabs
  const sessionRestoredRef = useRef(false);
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;

    async function restoreOrOpen() {
      // Load global settings (non-blocking; applies theme/fontSize/etc.)
      loadSettings().catch(console.error);

      try {
        const { invoke } = await import("@tauri-apps/api/core");

        // Load last session: list of open project paths + which was active
        const lastSession = await invoke<{
          open_projects: string[];
          active_project: string | null;
        }>("load_last_session").catch(() => ({ open_projects: [] as string[], active_project: null }));

        const { open_projects, active_project } = lastSession;
        if (open_projects.length === 0) return; // first launch — show welcome screen

        const activeProj = active_project ?? open_projects[0];

        // Load each project's saved tabs concurrently
        const results = await Promise.allSettled(
          open_projects.map(async (projPath) => {
            const saved = await invoke<{
              open_tabs: string[];
              active_tab: string | null;
            }>("load_project_tabs", { projectPath: projPath }).catch(
              () => ({ open_tabs: [] as string[], active_tab: null })
            );

            const tabResults = await Promise.all(
              saved.open_tabs.map(async (filePath) => {
                try {
                  const content = await invoke<string>("read_file", { path: filePath });
                  return {
                    id: `tab-r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    filePath,
                    projectPath: projPath,
                    title: filePath.split("/").pop() ?? filePath,
                    content,
                    isDirty: false,
                  } as Tab;
                } catch {
                  return null; // file deleted — skip
                }
              })
            );

            return {
              projPath,
              tabs: tabResults.filter((t): t is Tab => t !== null),
              activeTabFile: saved.active_tab,
            };
          })
        );

        // Accumulate tabs from all projects
        const allTabs: Tab[] = [];
        let activeTabId: string | null = null;

        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          const { projPath, tabs, activeTabFile } = r.value;
          allTabs.push(...tabs);
          if (projPath === activeProj && activeTabFile) {
            const found = tabs.find((t) => t.filePath === activeTabFile);
            if (found) activeTabId = found.id;
          }
        }

        if (allTabs.length > 0) {
          activeTabId ??= allTabs[0].id;
          useAppStore.setState({ tabs: allTabs, activeTabId, closedTabs: [] });
        }

        // Open active project file tree + workspace state
        try {
          const [tree] = await Promise.all([
            invoke<import("@/store/appStore").FileEntry>("open_folder", { path: activeProj }),
            loadWorkspace(activeProj),
          ]);
          setFileTree(tree);
          addRecentDir(activeProj);
          invoke("add_recent_project", {
            path: activeProj,
            name: activeProj.split("/").pop() ?? activeProj,
          }).catch(console.error);
        } catch { /* project folder removed since last session */ }

      } catch { /* browser dev mode */ }
    }

    restoreOrOpen().catch(console.error);
  }, []);

  // ── Session save (debounced) ──────────────────────────────────────────────
  // Saves per-project tabs to .tybre/tabs.json and the global open-project
  // list to ~/Library/Application Support/Tybre/last-session.json so that
  // the next launch can restore all projects and their tabs.
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function schedSave() {
      if (sessionSaveTimerRef.current) clearTimeout(sessionSaveTimerRef.current);
      sessionSaveTimerRef.current = setTimeout(async () => {
        const { fileTree, tabs, activeTabId } = useAppStore.getState();
        if (!fileTree) return;

        try {
          const { invoke } = await import("@tauri-apps/api/core");

          // Group tabs by project (skip unsaved/untitled and non-project tabs)
          const byProject = new Map<string, { files: string[]; activeFile: string | null }>();
          for (const tab of tabs) {
            if (!tab.filePath || !tab.projectPath) continue;
            if (!byProject.has(tab.projectPath)) {
              byProject.set(tab.projectPath, { files: [], activeFile: null });
            }
            byProject.get(tab.projectPath)!.files.push(tab.filePath);
          }

          // Mark active tab's file for its project
          const activeTab = tabs.find((t) => t.id === activeTabId);
          if (activeTab?.filePath && activeTab.projectPath && byProject.has(activeTab.projectPath)) {
            byProject.get(activeTab.projectPath)!.activeFile = activeTab.filePath;
          }

          // Save each project's tab list to .tybre/tabs.json
          await Promise.all(
            Array.from(byProject.entries()).map(([projPath, { files, activeFile }]) =>
              invoke("save_project_tabs", {
                projectPath: projPath,
                tabs: { open_tabs: files, active_tab: activeFile, terminal_session_names: [] },
              })
            )
          );

          // Save global last session (which projects were open + which was active)
          await invoke("save_last_session", {
            openProjects: Array.from(byProject.keys()),
            activeProject: fileTree.path,
          });
        } catch { /* browser mode */ }
      }, 1500);
    }

    // Re-save whenever project, tabs, or active tab changes
    const unsub = useAppStore.subscribe((s, prev) => {
      if (
        s.fileTree !== prev.fileTree ||
        s.tabs !== prev.tabs ||
        s.activeTabId !== prev.activeTabId
      ) {
        schedSave();
      }
    });

    return () => {
      unsub();
      if (sessionSaveTimerRef.current) clearTimeout(sessionSaveTimerRef.current);
    };
  }, []);

  // ── Theme resolution ──────────────────────────────────────────────────────
  useEffect(() => {
    function resolveTheme() {
      if (theme === "system") {
        const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        setResolvedTheme(isDark ? "ink" : "paper");
      } else {
        setResolvedTheme(theme === "ink" ? "ink" : "paper");
      }
    }

    resolveTheme();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", resolveTheme);
    return () => mq.removeEventListener("change", resolveTheme);
  }, [theme, setResolvedTheme]);

  // ── Open new window ──────────────────────────────────────────────────────
  async function openNewWindow() {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const label = `window-${Date.now()}`;
      new WebviewWindow(label, {
        url: "/",
        title: "Tybre.md",
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 600,
      });
    } catch (err) {
      console.error("Failed to open new window:", err);
    }
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // New window
      if (matches("new-window", e)) {
        e.preventDefault();
        openNewWindow();
        return;
      }
      // Sidebar toggle
      if (matches("sidebar", e)) {
        e.preventDefault();
        if (guideMode) recordShortcutUse("sidebar");
        toggleSidebar();
        return;
      }
      // Terminal toggle
      if (matches("terminal", e)) {
        e.preventDefault();
        if (guideMode) recordShortcutUse("terminal");
        toggleTerminal();
        return;
      }
      // Ctrl+N — new file (if project open) or new tab
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        const { fileTree } = useAppStore.getState();
        if (fileTree) {
          useAppStore.getState().requestNewFile();
        } else {
          const { fileTree: ft } = useAppStore.getState();
          useAppStore.getState().addTab({
            id: `tab-${Date.now()}`, filePath: null, projectPath: ft?.path ?? null, title: "Untitled", content: "", isDirty: false,
          });
        }
        return;
      }
      // Ctrl+T — QuickOpen (if project open) or new tab
      if (matches("new-tab", e)) {
        e.preventDefault();
        if (guideMode) recordShortcutUse("new-tab");
        const { fileTree } = useAppStore.getState();
        if (fileTree) {
          setQuickOpenVisible(true);
        } else {
          useAppStore.getState().addTab({
            id: `tab-${Date.now()}`, filePath: null, projectPath: null, title: "Untitled", content: "", isDirty: false,
          });
        }
        return;
      }
      // Close tab
      if (matches("close-tab", e)) {
        e.preventDefault();
        if (guideMode) recordShortcutUse("close-tab");
        const { activeTabId } = useAppStore.getState();
        if (activeTabId) useAppStore.getState().closeTab(activeTabId);
        return;
      }
      // Restore closed tab
      if (matches("restore-tab", e)) {
        e.preventDefault();
        if (guideMode) recordShortcutUse("restore-tab");
        restoreLastTab();
        return;
      }
      // Quick open
      if (matches("quick-open", e)) {
        e.preventDefault();
        if (guideMode) recordShortcutUse("quick-open");
        setQuickOpenVisible(true);
        return;
      }
      // Save
      if (matches("save", e)) {
        e.preventDefault();
        if (guideMode) recordShortcutUse("save");
        saveActiveTab();
        return;
      }
      // Find in document
      if (matches("find", e)) {
        e.preventDefault();
        if (guideMode) recordShortcutUse("find");
        setFindBarVisible(!findBarVisible);
        return;
      }
      // Project search
      if (matches("project-search", e)) {
        e.preventDefault();
        if (guideMode) recordShortcutUse("project-search");
        setProjectSearchVisible(true);
        return;
      }
      // Export
      if (matches("export", e)) {
        e.preventDefault();
        if (guideMode) recordShortcutUse("export");
        setExportVisible(true);
        return;
      }
      // Settings
      if (matches("settings", e)) {
        e.preventDefault();
        if (guideMode) recordShortcutUse("settings");
        setSettingsVisible(true);
        return;
      }
      // Font size
      if (matches("font-size-increase", e)) {
        e.preventDefault();
        setFontSize(useSettingsStore.getState().fontSize + 1);
        return;
      }
      if (matches("font-size-decrease", e)) {
        e.preventDefault();
        setFontSize(useSettingsStore.getState().fontSize - 1);
        return;
      }
      if (matches("font-size-reset", e)) {
        e.preventDefault();
        setFontSize(16);
        return;
      }
      // Focus editor area
      if (matches("focus-editor", e)) {
        e.preventDefault();
        const el =
          (document.querySelector(".ProseMirror") as HTMLElement | null) ??
          (document.querySelector(".cm-content") as HTMLElement | null);
        el?.focus();
        return;
      }
      // Focus terminal area (open if closed, then focus)
      if (matches("focus-terminal", e)) {
        e.preventDefault();
        if (!terminalOpen) {
          setTerminalOpen(true);
          setTimeout(() => terminalFocusRef.current?.(), 200);
        } else {
          terminalFocusRef.current?.();
        }
        return;
      }
      // ⌘1-9: switch tab (metaKey only, no ctrlKey)
      if (e.metaKey && !e.ctrlKey && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        const { tabs } = useAppStore.getState();
        if (tabs[idx]) {
          e.preventDefault();
          if (guideMode) recordShortcutUse("tab-switch");
          setActiveTab(tabs[idx].id);
        }
        return;
      }
      // Ctrl+1-9: switch project (ctrlKey only, no metaKey)
      if (e.ctrlKey && !e.metaKey && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        const { tabs } = useAppStore.getState();
        const projects = getOpenProjects(tabs);
        if (projects[idx]) {
          e.preventDefault();
          switchProject(projects[idx].path).catch(console.error);
        }
        return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toggleSidebar, toggleTerminal, setTerminalOpen, terminalOpen,
     restoreLastTab, setActiveTab, setQuickOpenVisible,
     setSettingsVisible, setFindBarVisible, setProjectSearchVisible, setExportVisible,
     guideMode, recordShortcutUse, customShortcuts, switchProject, setFontSize]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // ── Save helper ───────────────────────────────────────────────────────────
  function saveActiveTab() {
    const { tabs, activeTabId } = useAppStore.getState();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    // Only save text-based file types — never overwrite binary files (images, pdf)
    const ext = getFileExt(tab.filePath);
    const isTextFile = ext === "md" || ext === "txt" || CODE_EXTS.has(ext);
    if (!isTextFile && tab.filePath !== null) return;

    if (!tab.filePath) {
      // No path yet — show native Save As dialog
      import("@tauri-apps/api/core").then(async ({ invoke }) => {
        const path = await invoke<string | null>("pick_save_path", {
          defaultName: tab.title.endsWith(".md") ? tab.title : `${tab.title}.md`,
        });
        if (!path) return;
        await invoke("write_file", { path, content: tab.content });
        useAppStore.setState((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tab.id
              ? { ...t, filePath: path, title: path.split("/").pop() ?? tab.title, isDirty: false }
              : t
          ),
        }));
      }).catch(console.error);
      return;
    }

    import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke("write_file", { path: tab.filePath, content: tab.content })
      )
      .then(() => markTabSaved(tab.id))
      .catch(console.error);
  }

  // ── Editor change + auto-save ─────────────────────────────────────────────
  function handleEditorChange(markdown: string) {
    if (!activeTabId) return;
    updateTabContent(activeTabId, markdown);

    // 1s debounce auto-save — only for files with a path
    if (!autoSave) return;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => {
      const { tabs } = useAppStore.getState();
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab?.filePath) return;
      const ext = getFileExt(tab.filePath);
      if (ext !== "md" && ext !== "txt" && !CODE_EXTS.has(ext)) return;

      import("@tauri-apps/api/core")
        .then(({ invoke }) =>
          invoke("write_file", { path: tab.filePath!, content: markdown })
        )
        .then(() => markTabSaved(activeTabId))
        .catch(console.error);
    }, 1000);
  }

  // Cleanup auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    };
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <TooltipProvider delayDuration={400}>
      <div
        className={cn("app-layout", resolvedTheme === "ink" ? "dark" : "light")}
        data-theme={resolvedTheme}
      >
        <Sidebar />

        <div className="main-area">
          {claudeInstalled === false && (
            <div className="flex items-center gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[12px] shrink-0">
              <span className="flex-1" style={{ color: "var(--foreground)" }}>
                <span className="font-semibold">{t("app.claudeNotFound")}</span>{" "}
                <span style={{ color: "var(--muted-foreground)" }}>{t("app.claudeInstallHint")}</span>
              </span>
              <button
                onClick={() => {
                  setPendingTerminalCommand("curl -fsSL https://claude.ai/install.sh | bash");
                  setClaudeInstalled(null);
                  if (!terminalOpen) setTerminalOpen(true);
                }}
                className="px-2.5 py-1 rounded text-[11px] font-medium transition-colors"
                style={{
                  background: "rgba(245,158,11,0.15)",
                  color: "var(--primary)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(245,158,11,0.25)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(245,158,11,0.15)")}
              >
                {t("app.installInTerminal")}
              </button>
              <button
                onClick={() => setClaudeInstalled(null)}
                className="opacity-40 hover:opacity-70 transition-opacity text-[14px] leading-none"
                style={{ color: "var(--foreground)" }}
              >
                ✕
              </button>
            </div>
          )}
          {updateInfo && (
            <div
              className="flex items-center gap-3 px-4 py-2 shrink-0"
              style={{ background: "rgba(59,130,246,0.08)", borderBottom: "1px solid rgba(59,130,246,0.15)", fontSize: 12 }}
            >
              <span className="flex-1" style={{ color: "var(--foreground)" }}>
                {updatePhase === "ready" ? (
                  <>
                    <span className="font-semibold">{t("app.updateDone")}</span>{" "}
                    <span style={{ color: "var(--muted-foreground)" }}>{t("app.updateRestartHint")}</span>
                  </>
                ) : updatePhase === "downloading" ? (
                  <span className="font-semibold" style={{ color: "var(--muted-foreground)" }}>
                    {t("app.downloading", { pct: downloadPct > 0 ? `${downloadPct}%` : "" })}
                  </span>
                ) : (
                  <>
                    <span className="font-semibold">{t("app.updateAvailable", { version: updateInfo.version })}</span>
                    {updateInfo.body && (
                      <span style={{ color: "var(--muted-foreground)" }}>
                        {" "}{updateInfo.body.split("\n")[0].slice(0, 80)}
                      </span>
                    )}
                  </>
                )}
              </span>

              {updatePhase === "downloading" && downloadPct > 0 && (
                <div className="h-1 rounded-full overflow-hidden shrink-0" style={{ width: 80, background: "rgba(59,130,246,0.15)" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${downloadPct}%`, background: "rgba(59,130,246,0.6)" }} />
                </div>
              )}

              {updatePhase === "ready" ? (
                <button
                  onClick={handleRelaunch}
                  className="px-2.5 py-1 rounded text-[11px] font-medium transition-colors shrink-0"
                  style={{ background: "rgba(59,130,246,0.15)", color: "var(--primary)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(59,130,246,0.25)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(59,130,246,0.15)")}
                >
                  {t("app.restartNow")}
                </button>
              ) : updatePhase === "idle" ? (
                <button
                  onClick={handleInstallUpdate}
                  className="px-2.5 py-1 rounded text-[11px] font-medium transition-colors shrink-0"
                  style={{ background: "rgba(59,130,246,0.12)", color: "var(--primary)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(59,130,246,0.22)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(59,130,246,0.12)")}
                >
                  {t("app.updateNow")}
                </button>
              ) : null}

              {updatePhase !== "downloading" && (
                <button
                  onClick={() => { setUpdateInfo(null); setUpdatePhase("idle"); }}
                  className="opacity-40 hover:opacity-70 transition-opacity text-[14px] leading-none shrink-0"
                  style={{ color: "var(--foreground)" }}
                >
                  ✕
                </button>
              )}
            </div>
          )}
          <TabBar />

          {/* Find bar */}
          {findBarVisible && <FindBar />}

          {/* Editor / viewer area — always visible in split-pane */}
          <div className="editor-container">
            {activeTab ? (() => {
              const ext = getFileExt(activeTab.filePath);
              if (IMAGE_EXTS.has(ext)) {
                return <ImageViewer key={activeTab.id} filePath={activeTab.filePath!} />;
              }
              if (ext === "pdf") {
                return <PdfViewer key={activeTab.id} filePath={activeTab.filePath!} />;
              }
              if (ext === "txt") {
                return <TxtViewer key={activeTab.id} content={activeTab.content} />;
              }
              if (CODE_EXTS.has(ext)) {
                return (
                  <CodeEditor
                    key={activeTab.id}
                    filePath={activeTab.filePath}
                    initialContent={activeTab.content}
                    onChange={handleEditorChange}
                  />
                );
              }
              return (
                <MilkdownEditor
                  key={activeTab.id}
                  initialContent={activeTab.content}
                  onChange={handleEditorChange}
                />
              );
            })() : (
              <div className="flex h-full flex-col items-center justify-center gap-2" style={{ color: "var(--status-text)" }}>
                <p className="text-sm font-medium">No file open</p>
                <p className="text-xs">
                  Press{" "}
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">
                    ⌘T
                  </kbd>{" "}
                  to create a new tab
                </p>
              </div>
            )}
            {activeTab && getFileExt(activeTab.filePath) === "md" && (
              <StatusBar content={activeTab.content} onToggleTerminal={toggleTerminal} />
            )}
          </div>

          {/* Terminal — xterm.js + portable-pty */}
          <TerminalView
            visible={terminalOpen}
            projectPath={fileTree?.path ?? null}
            focusRef={terminalFocusRef}
            onProjectChange={async (path) => {
              const { invoke } = await import("@tauri-apps/api/core");

              // Save current project's last active tab
              const state = useAppStore.getState();
              if (state.fileTree) {
                const curTab = state.tabs.find((t) => t.id === state.activeTabId);
                if (curTab?.filePath) {
                  state.setProjectLastTab(state.fileTree.path, curTab.filePath);
                }
              }

              // Load project tree and workspace concurrently;
              // setFileTree only after loadWorkspace resolves so that
              // terminalOpen is already correct when projectPath prop changes.
              const [tree] = await Promise.all([
                invoke<import("@/store/appStore").FileEntry>("open_folder", { path }),
                loadWorkspace(path),
              ]);
              setFileTree(tree);
              addRecentDir(path);
              const pName = path.split("/").pop() ?? path;
              invoke("add_recent_project", { path, name: pName }).catch(console.error);

              // Restore last tab for the new project
              const { projectLastTab, tabs } = useAppStore.getState();
              const lastFile = projectLastTab[path];
              if (lastFile) {
                const existing = tabs.find((t) => t.filePath === lastFile);
                if (existing) {
                  setActiveTab(existing.id);
                } else {
                  try {
                    const content = await invoke<string>("read_file", { path: lastFile });
                    const id = `tab-${Date.now()}`;
                    useAppStore.getState().addTab({
                      id, filePath: lastFile,
                      projectPath: path,
                      title: lastFile.split("/").pop() ?? "file",
                      content, isDirty: false,
                    });
                  } catch { /* file deleted — skip */ }
                }
              }
            }}
          />
        </div>

        {/* Global overlays */}
        <QuickOpen />
        {settingsVisible && <Settings />}
        {projectSearchVisible && <ProjectSearch />}
        {exportVisible && <ExportModal />}
        <LanguageModal />
        <ProjectSwitcher />
      </div>
    </TooltipProvider>
  );
}

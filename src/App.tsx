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
import { TerminalView, clearTerminalSessionRegistry } from "@/components/TerminalView";
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
    reloadTabFromDisk,
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

  const { toggleSidebar, loadWorkspace, terminalOpen, toggleTerminal, setTerminalOpen, setTerminalWidth } = useWorkspaceStore();

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

  // Per-tab editor state cache (preserves undo history across tab switches)
  const tabEditorStatesRef = useRef<Map<string, import("prosemirror-state").EditorState>>(new Map());

  // External file change apply callback (avoids remount, keeps undo history)
  const applyExternalRef = useRef<((content: string) => void) | null>(null);

  // ── Apply persisted font size on mount ───────────────────────────────────
  useEffect(() => {
    document.documentElement.style.setProperty("--font-size-base", `${fontSize}px`);
  }, [fontSize]);

  // Track paths we just wrote ourselves so watcher events from our own saves are ignored
  const recentlySavedRef = useRef<Map<string, number>>(new Map());

  // ── File watcher: auto-reload open tabs when external tools change files ────
  useEffect(() => {
    if (!fileTree) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    async function setup() {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");

      invoke("start_watching", { path: fileTree!.path }).catch(console.error);

      const unlistenFn = await listen<string>("file-changed", async (event) => {
        const changedPath = event.payload;

        // Skip if we saved this file ourselves within the last 2s
        const savedAt = recentlySavedRef.current.get(changedPath);
        if (savedAt && Date.now() - savedAt < 2000) return;

        // Prune stale entries (older than 5s) to prevent unbounded growth
        const now = Date.now();
        for (const [path, ts] of recentlySavedRef.current) {
          if (now - ts > 5000) recentlySavedRef.current.delete(path);
        }

        const { tabs, activeTabId } = useAppStore.getState();
        const tab = tabs.find((t) => t.filePath === changedPath);
        // Don't overwrite unsaved user edits or binary files
        if (!tab || tab.isDirty) return;
        const ext = getFileExt(changedPath);
        if (IMAGE_EXTS.has(ext) || ext === "pdf") return;

        try {
          const content = await invoke<string>("read_file", { path: changedPath });
          // For the active markdown tab, apply via transaction (preserves undo history)
          if (tab.id === activeTabId && ext === "md" && applyExternalRef.current) {
            applyExternalRef.current(content);
            // Also update the store content so isDirty tracking stays accurate
            reloadTabFromDisk(tab.id, content);
          } else {
            reloadTabFromDisk(tab.id, content);
          }
        } catch { /* file briefly locked during write, skip */ }
      });
      // If cleanup ran before this resolved, immediately unsubscribe
      if (cancelled) unlistenFn();
      else unlisten = unlistenFn;
    }

    setup().catch(console.error);

    return () => {
      cancelled = true;
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

        // Check if the app was launched by opening a .md file (file association / double-click)
        const startupPath = await invoke<string | null>("get_startup_file").catch(() => null);
        if (startupPath) {
          const content = await invoke<string>("read_file", { path: startupPath }).catch(() => null);
          if (content !== null) {
            const parentDir = startupPath.includes("/")
              ? startupPath.substring(0, startupPath.lastIndexOf("/"))
              : startupPath.substring(0, startupPath.lastIndexOf("\\"));
            try {
              const tree = await invoke<import("@/store/appStore").FileEntry>("open_folder", { path: parentDir });
              setFileTree(tree);
              addRecentDir(parentDir);
              invoke("add_recent_project", {
                path: parentDir,
                name: parentDir.split("/").pop() ?? parentDir,
              }).catch(console.error);
            } catch { /* ignore */ }
            const tabId = `tab-startup-${Date.now()}`;
            useAppStore.setState({
              tabs: [{
                id: tabId,
                filePath: startupPath,
                projectPath: parentDir,
                title: startupPath.split("/").pop() ?? startupPath,
                content,
                isDirty: false,
                externalVersion: 0,
              }],
              activeTabId: tabId,
              closedTabs: [],
            });
            return; // skip normal session restore
          }
        }

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
                    externalVersion: 0,
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

  // ── File association: handle "open with Tybre.md" when app is already running ──
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<string[]>("open-files", async (event) => {
        const [filePath] = event.payload;
        if (!filePath) return;
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const { tabs, addTab, setActiveTab } = useAppStore.getState();
          // If already open in a tab, just focus it
          const existing = tabs.find((t) => t.filePath === filePath);
          if (existing) {
            setActiveTab(existing.id);
            return;
          }
          const content = await invoke<string>("read_file", { path: filePath });
          const parentDir = filePath.includes("/")
            ? filePath.substring(0, filePath.lastIndexOf("/"))
            : filePath.substring(0, filePath.lastIndexOf("\\"));
          // Open parent dir if no project is loaded yet
          if (!useAppStore.getState().fileTree) {
            try {
              const tree = await invoke<import("@/store/appStore").FileEntry>("open_folder", { path: parentDir });
              setFileTree(tree);
              addRecentDir(parentDir);
              invoke("add_recent_project", {
                path: parentDir,
                name: parentDir.split("/").pop() ?? parentDir,
              }).catch(console.error);
            } catch { /* ignore */ }
          }
          addTab({
            id: `tab-open-${Date.now()}`,
            filePath,
            projectPath: parentDir,
            title: filePath.split("/").pop() ?? filePath,
            content,
            isDirty: false,
            externalVersion: 0,
          });
        } catch (err) {
          console.error("Failed to open file from open-files event:", err);
        }
      }).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
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
      // Terminal toggle — auto-focus terminal when opening, editor when closing
      if (matches("terminal", e)) {
        e.preventDefault();
        if (guideMode) recordShortcutUse("terminal");
        const nextOpen = !terminalOpen;
        toggleTerminal();
        if (nextOpen) {
          setTimeout(() => terminalFocusRef.current?.(), 150);
        } else {
          const editorEl =
            (document.querySelector(".ProseMirror") as HTMLElement | null) ??
            (document.querySelector(".cm-content") as HTMLElement | null);
          editorEl?.focus();
        }
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
            id: `tab-${Date.now()}`, filePath: null, projectPath: ft?.path ?? null, title: "Untitled", content: "", isDirty: false, externalVersion: 0,
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
            id: `tab-${Date.now()}`, filePath: null, projectPath: null, title: "Untitled", content: "", isDirty: false, externalVersion: 0,
          });
        }
        return;
      }
      // Close tab — skip if focus is inside the terminal area (terminal handles its own Ctrl/Cmd+W)
      if (matches("close-tab", e)) {
        if (document.activeElement?.closest(".terminal-view-container")) return;
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
      // Find in document — skip if focus is in terminal (let terminal handle ctrl+f)
      if (matches("find", e)) {
        if (document.activeElement?.closest(".terminal-view-container")) return;
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
    [toggleSidebar, toggleTerminal, setTerminalOpen, setTerminalWidth, terminalOpen,
     restoreLastTab, setActiveTab, setQuickOpenVisible,
     setSettingsVisible, setFindBarVisible, setProjectSearchVisible, setExportVisible,
     guideMode, recordShortcutUse, customShortcuts, switchProject, setFontSize]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Prevent macOS native ⌘W from closing the window when focus is inside the
  // terminal. Must use capture=true so this fires before xterm's internal handlers
  // and before the native WKWebView window-close shortcut is processed.
  useEffect(() => {
    function interceptTerminalClose(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "w" || e.key === "W")) {
        if (document.activeElement?.closest(".terminal-view-container")) {
          e.preventDefault();
        }
      }
    }
    window.addEventListener("keydown", interceptTerminalClose, true);
    return () => window.removeEventListener("keydown", interceptTerminalClose, true);
  }, []);

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

    if (tab.filePath) recentlySavedRef.current.set(tab.filePath, Date.now());
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

      recentlySavedRef.current.set(tab.filePath!, Date.now());
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

  // Purge EditorState cache for tabs no longer in `tabs` or `closedTabs`
  useEffect(() => {
    const unsub = useAppStore.subscribe((s) => {
      if (tabEditorStatesRef.current.size === 0) return;
      const live = new Set([
        ...s.tabs.map((t) => t.id),
        ...s.closedTabs.map((t) => t.id),
      ]);
      for (const id of tabEditorStatesRef.current.keys()) {
        if (!live.has(id)) tabEditorStatesRef.current.delete(id);
      }
    });
    return unsub;
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
          {findBarVisible && <FindBar editorApplyRef={applyExternalRef} />}

          {/* Horizontal split: editor (left) + terminal (right) */}
          <div className="split-area">
            {/* Editor / viewer area */}
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
                      key={`${activeTab.id}_${activeTab.externalVersion ?? 0}`}
                      filePath={activeTab.filePath}
                      initialContent={activeTab.content}
                      onChange={handleEditorChange}
                    />
                  );
                }
                return (
                  <MilkdownEditor
                    key={activeTab.id}
                    tabId={activeTab.id}
                    initialContent={activeTab.content}
                    onChange={handleEditorChange}
                    savedEditorState={tabEditorStatesRef.current.get(activeTab.id)}
                    onViewUnmount={(state, tid) => {
                      tabEditorStatesRef.current.set(tid, state);
                    }}
                    onEditorApplyExternal={(apply) => {
                      applyExternalRef.current = apply;
                    }}
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
                <StatusBar content={activeTab.content} />
              )}
            </div>

            {/* Resize divider — drag to adjust terminal width */}
            {terminalOpen && (
              <div
                className="group"
                style={{
                  width: 4,
                  flexShrink: 0,
                  cursor: "ew-resize",
                  background: "hsl(var(--border))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const startX = e.clientX;
                  const saved = useWorkspaceStore.getState().terminalWidth;
                  const startWidth = saved > 0
                    ? saved
                    : (document.querySelector(".terminal-view-container") as HTMLElement | null)?.offsetWidth
                      ?? Math.floor(window.innerWidth * 0.4);
                  document.body.style.userSelect = "none";
                  document.body.style.cursor = "ew-resize";
                  function onMove(ev: MouseEvent) {
                    const delta = ev.clientX - startX;
                    const next = Math.max(200, Math.min(window.innerWidth * 0.6, startWidth - delta));
                    setTerminalWidth(next);
                  }
                  function onUp() {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    document.body.style.userSelect = "";
                    document.body.style.cursor = "";
                  }
                  document.addEventListener("mousemove", onMove);
                  document.addEventListener("mouseup", onUp);
                }}
              />
            )}

            {/* Terminal — xterm.js + portable-pty */}
            <TerminalView
              visible={terminalOpen}
              projectPath={fileTree?.path ?? null}
              focusRef={terminalFocusRef}
              onProjectChange={async (path) => {
              const { invoke } = await import("@tauri-apps/api/core");

              // Clean up previous project's terminal session registry entry
              const prevPath = useAppStore.getState().fileTree?.path;
              if (prevPath) clearTerminalSessionRegistry(prevPath);

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
                      content, isDirty: false, externalVersion: 0,
                    });
                  } catch { /* file deleted — skip */ }
                }
              }
            }}
          />
          </div>{/* end split-area */}
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

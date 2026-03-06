import { useEffect, useCallback, useRef, useState } from "react";
import { useAppStore, type Tab } from "@/store/appStore";

// ── Session types (must match Rust WindowSession struct) ─────────────────────
interface WindowSession {
  is_main: boolean;
  project_path: string | null;
  open_files: string[];
  active_file: string | null;
}

/** Load file content for each path, skip missing files, bulk-replace store tabs. */
async function restoreTabsFromSession(
  session: Pick<WindowSession, "open_files" | "active_file">,
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
) {
  const results = await Promise.all(
    session.open_files.map(async (filePath) => {
      try {
        const content = await invoke<string>("read_file", { path: filePath });
        const tab: Tab = {
          id: `tab-restore-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          filePath,
          title: filePath.split("/").pop() ?? filePath,
          content,
          isDirty: false,
        };
        return tab;
      } catch {
        return null; // file deleted — skip
      }
    })
  );

  const tabs = results.filter((t): t is Tab => t !== null);
  if (tabs.length === 0) return;

  const activeTabId =
    tabs.find((t) => t.filePath === session.active_file)?.id ??
    tabs[tabs.length - 1].id;

  useAppStore.setState({ tabs, activeTabId, closedTabs: [] });
}
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
import { TerminalView } from "@/components/TerminalView";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ── File type helpers ─────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

function getFileExt(filePath: string | null): string {
  if (!filePath) return "md";
  return filePath.split(".").pop()?.toLowerCase() ?? "md";
}

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
  const {
    tabs,
    activeTabId,
    view,
    theme,
    resolvedTheme,
    toggleSidebar,
    toggleView,
    setResolvedTheme,
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
    fontSize,
    autoSave,
    customShortcuts,
    guideMode,
    recordShortcutUse,
  } = useAppStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Resolve effective shortcut combo (custom overrides default)
  function key(id: string): string {
    return customShortcuts[id] ?? SHORTCUT_DEFS.find((s) => s.id === id)?.defaultKey ?? "";
  }
  function matches(id: string, e: KeyboardEvent): boolean {
    return matchesCombo(e, key(id));
  }

  // Auto-save timer ref
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        if (!["md", "txt"].includes(ext)) return;

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
      const { invoke } = await import("@tauri-apps/api/core");
      const { getCurrentWindow } = await import("@tauri-apps/api/window");

      const windowLabel = getCurrentWindow().label;
      const isMainWindow = windowLabel === "main";
      const params = new URLSearchParams(window.location.search);
      const projectPathParam = params.get("project");

      // Load persisted sessions (no-op outside Tauri / first launch)
      let sessions: WindowSession[] = [];
      try {
        sessions = await invoke<WindowSession[]>("load_session");
      } catch { /* browser dev mode or first launch */ }

      // Find this window's matching session
      const mySession: WindowSession | undefined = isMainWindow
        ? sessions.find((s) => s.is_main)
        : sessions.find((s) => !s.is_main && s.project_path === projectPathParam);

      // Project to open: prefer saved session path, fall back to URL param
      const projectToOpen = mySession?.project_path ?? projectPathParam ?? null;

      if (projectToOpen) {
        try {
          const tree = await invoke<import("@/store/appStore").FileEntry>(
            "open_folder", { path: projectToOpen }
          );
          setFileTree(tree);
          addRecentDir(projectToOpen);
        } catch { /* project folder removed since last session */ }
      }

      // Restore open tabs for this window
      if (mySession && mySession.open_files.length > 0) {
        await restoreTabsFromSession(mySession, invoke as Parameters<typeof restoreTabsFromSession>[1]);
      }

      // ── Main window only: spawn child windows for saved project sessions ──
      if (!isMainWindow) return;

      const childSessions = sessions.filter(
        (s) => !s.is_main && s.project_path && s.project_path !== projectToOpen
      );
      if (childSessions.length === 0) return;

      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      for (const session of childSessions) {
        const projectName = session.project_path!.split("/").pop() ?? "Project";
        const label = `restore-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        new WebviewWindow(label, {
          url: `/?project=${encodeURIComponent(session.project_path!)}`,
          title: `${projectName} — Tybre.md`,
          width: 1280,
          height: 800,
          minWidth: 800,
          minHeight: 600,
        });
        // Small stagger to avoid resource contention
        await new Promise<void>((r) => setTimeout(r, 120));
      }
    }

    restoreOrOpen().catch(console.error);
  }, []);

  // ── Session save (debounced) ──────────────────────────────────────────────
  // Subscribes to store; whenever project/tabs/activeTab change, persists session.
  const windowLabelRef = useRef<string>("main");
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Cache window label synchronously (getCurrentWindow is sync in Tauri v2)
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        windowLabelRef.current = getCurrentWindow().label;
      })
      .catch(() => { windowLabelRef.current = "main"; });

    function schedSave() {
      if (sessionSaveTimerRef.current) clearTimeout(sessionSaveTimerRef.current);
      sessionSaveTimerRef.current = setTimeout(async () => {
        const { fileTree, tabs, activeTabId } = useAppStore.getState();
        const isMain = windowLabelRef.current === "main";
        const openFiles = tabs.filter((t) => t.filePath).map((t) => t.filePath as string);
        const activeFile = tabs.find((t) => t.id === activeTabId)?.filePath ?? null;
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("update_window_session", {
            isMain,
            projectPath: fileTree?.path ?? null,
            openFiles,
            activeFile,
          });
        } catch { /* browser / not Tauri */ }
      }, 1500);
    }

    // Only re-save when project, tabs, or active tab actually change
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

  // ── Remove session when window is explicitly closed by the user ───────────
  // onCloseRequested fires for individual close (X button).
  // When Cmd+Q / Ctrl+Q is used the user expects full restore, so we DON'T
  // delete sessions in that path. We detect that via a flag set on keydown.
  useEffect(() => {
    let isAppQuitting = false;
    let unlistenClose: (() => void) | null = null;

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "q" || e.key === "Q")) {
        isAppQuitting = true;
      }
    };
    window.addEventListener("keydown", onKeyDown);

    import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      unlistenClose = await win.onCloseRequested(async () => {
        // If the user is quitting the whole app, preserve sessions so they
        // can be restored on next launch.
        if (isAppQuitting) return;
        // Individual window close — remove its session entry.
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const isMain = windowLabelRef.current === "main";
          const projectPath = useAppStore.getState().fileTree?.path ?? null;
          await invoke("remove_window_session", { isMain, projectPath });
        } catch { /* noop */ }
      });
    }).catch(() => {});

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unlistenClose?.();
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
        toggleView();
        return;
      }
      // New tab
      if (matches("new-tab", e) || ((e.metaKey || e.ctrlKey) && (e.key === "n" || e.key === "N"))) {
        e.preventDefault();
        if (guideMode) recordShortcutUse("new-tab");
        useAppStore.getState().addTab({
          id: `tab-${Date.now()}`,
          filePath: null,
          title: "Untitled",
          content: "",
          isDirty: false,
        });
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
      // Tab switch Cmd+1~9
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        const { tabs } = useAppStore.getState();
        if (tabs[idx]) {
          e.preventDefault();
          if (guideMode) recordShortcutUse("tab-switch");
          setActiveTab(tabs[idx].id);
        }
        return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toggleSidebar, toggleView, restoreLastTab, setActiveTab, setQuickOpenVisible,
     setSettingsVisible, setFindBarVisible, setProjectSearchVisible, setExportVisible,
     guideMode, recordShortcutUse, customShortcuts]
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
    if (!["md", "txt"].includes(ext) && tab.filePath !== null) return;

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
          <TabBar />

          {/* Find bar */}
          {findBarVisible && <FindBar />}

          {/* Editor / viewer area */}
          <div className={cn("editor-container", view !== "editor" && "hidden")}>
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
              <StatusBar content={activeTab.content} />
            )}
          </div>

          {/* Terminal — xterm.js + portable-pty */}
          <TerminalView
            visible={view === "terminal"}
            projectPath={fileTree?.path ?? null}
            onProjectChange={async (path) => {
              const { invoke } = await import("@tauri-apps/api/core");
              const tree = await invoke<import("@/store/appStore").FileEntry>(
                "open_folder", { path }
              );
              setFileTree(tree);
              addRecentDir(path);
            }}
          />
        </div>

        {/* Global overlays */}
        <QuickOpen />
        {settingsVisible && <Settings />}
        {projectSearchVisible && <ProjectSearch />}
        {exportVisible && <ExportModal />}
      </div>
    </TooltipProvider>
  );
}

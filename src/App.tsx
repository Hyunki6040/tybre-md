import { useEffect, useCallback, useRef } from "react";
import { useAppStore } from "@/store/appStore";
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
        // Don't overwrite unsaved user edits
        if (!tab || tab.isDirty) return;

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

  // ── Open project from URL param (?project=<path>) ─────────────────────────
  // Used when the app is launched in a new window via QuickOpen "open project"
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projectPath = params.get("project");
    if (!projectPath) return;
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<import("@/store/appStore").FileEntry>("open_folder", { path: projectPath }))
      .then((tree) => {
        setFileTree(tree);
        addRecentDir(projectPath);
      })
      .catch(console.error);
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

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
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

          {/* Editor view */}
          <div className={cn("editor-container", view !== "editor" && "hidden")}>
            {activeTab ? (
              <MilkdownEditor
                key={activeTab.id}
                initialContent={activeTab.content}
                onChange={handleEditorChange}
              />
            ) : (
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
            {activeTab && <StatusBar content={activeTab.content} />}
          </div>

          {/* Terminal — xterm.js + portable-pty */}
          <TerminalView visible={view === "terminal"} />
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

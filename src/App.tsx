import { useEffect, useCallback, useRef } from "react";
import { useAppStore } from "@/store/appStore";
import { TabBar } from "@/components/TabBar";
import { Sidebar } from "@/components/Sidebar";
import { QuickOpen } from "@/components/QuickOpen";
import { StatusBar } from "@/components/StatusBar";
import { MilkdownEditor } from "@/editor/MilkdownEditor";
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
  } = useAppStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Auto-save timer ref
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const meta = e.metaKey || e.ctrlKey;

      // Cmd+B — sidebar toggle
      if (meta && !e.shiftKey && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Cmd+` — editor ↔ terminal
      if (meta && e.key === "`") {
        e.preventDefault();
        toggleView();
        return;
      }

      // Cmd+T or Cmd+N — new tab
      if (meta && !e.shiftKey && (e.key === "t" || e.key === "n")) {
        e.preventDefault();
        useAppStore.getState().addTab({
          id: `tab-${Date.now()}`,
          filePath: null,
          title: "Untitled",
          content: "",
          isDirty: false,
        });
        return;
      }

      // Cmd+W — close active tab
      if (meta && !e.shiftKey && e.key === "w") {
        e.preventDefault();
        const { activeTabId } = useAppStore.getState();
        if (activeTabId) useAppStore.getState().closeTab(activeTabId);
        return;
      }

      // Cmd+Shift+T — restore last closed tab
      if (meta && e.shiftKey && e.key === "T") {
        e.preventDefault();
        restoreLastTab();
        return;
      }

      // Cmd+P — quick open
      if (meta && !e.shiftKey && e.key === "p") {
        e.preventDefault();
        setQuickOpenVisible(true);
        return;
      }

      // Cmd+S — save current tab to file
      if (meta && !e.shiftKey && e.key === "s") {
        e.preventDefault();
        saveActiveTab();
        return;
      }

      // Cmd+1~9 — switch to tab by index
      if (meta && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        const { tabs } = useAppStore.getState();
        if (tabs[idx]) {
          e.preventDefault();
          setActiveTab(tabs[idx].id);
        }
        return;
      }
    },
    [toggleSidebar, toggleView, restoreLastTab, setActiveTab, setQuickOpenVisible]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // ── Save helper ───────────────────────────────────────────────────────────
  function saveActiveTab() {
    const { tabs, activeTabId } = useAppStore.getState();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab?.filePath) return; // untitled — needs Save As (future)

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

          {/* Terminal placeholder — xterm.js in Phase 1 Week 7-8 */}
          <div
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-2 bg-background text-sm text-muted-foreground",
              view !== "terminal" && "hidden"
            )}
          >
            <p>Terminal — coming in Phase 1 Week 7</p>
            <p className="text-xs">
              Press{" "}
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">
                ⌘`
              </kbd>{" "}
              to return to editor
            </p>
          </div>
        </div>

        {/* Global overlays */}
        <QuickOpen />
      </div>
    </TooltipProvider>
  );
}

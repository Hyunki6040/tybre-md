import { useEffect, useCallback } from "react";
import { useAppStore } from "./store/appStore";
import { TabBar } from "./components/TabBar";
import { Sidebar } from "./components/Sidebar";
import { MilkdownEditor } from "./editor/MilkdownEditor";
import "./styles/components.css";

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
  } = useAppStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Resolve theme based on system preference or manual setting
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

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", resolveTheme);
    return () => mediaQuery.removeEventListener("change", resolveTheme);
  }, [theme, setResolvedTheme]);

  // Global keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      }

      if (meta && e.key === "`") {
        e.preventDefault();
        toggleView();
      }

      if (meta && e.key === "t") {
        e.preventDefault();
        const id = `tab-${Date.now()}`;
        useAppStore.getState().addTab({
          id,
          filePath: null,
          title: "Untitled",
          content: "",
          isDirty: false,
        });
      }

      if (meta && e.key === "w") {
        e.preventDefault();
        if (activeTabId) {
          useAppStore.getState().closeTab(activeTabId);
        }
      }
    },
    [toggleSidebar, toggleView, activeTabId]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  function handleEditorChange(markdown: string) {
    if (activeTabId) {
      updateTabContent(activeTabId, markdown);
    }
  }

  return (
    <div
      className={`app-layout ${resolvedTheme === "ink" ? "dark" : "light"}`}
      data-theme={resolvedTheme}
    >
      {/* Left Sidebar */}
      <Sidebar />

      {/* Main Area */}
      <div className="main-area">
        {/* Tab Bar */}
        <TabBar />

        {/* Editor / Terminal Area */}
        <div
          className="editor-container"
          style={{ display: view === "editor" ? "block" : "none" }}
        >
          {activeTab ? (
            <MilkdownEditor
              key={activeTab.id}
              initialContent={activeTab.content}
              onChange={handleEditorChange}
            />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--text-muted)",
                fontSize: "14px",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <p style={{ marginBottom: "8px" }}>No file open</p>
                <p style={{ fontSize: "12px" }}>
                  Press <kbd>⌘T</kbd> to create a new tab
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Terminal placeholder */}
        <div
          style={{
            display: view === "terminal" ? "flex" : "none",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            background: "var(--bg)",
            color: "var(--text-muted)",
            fontSize: "14px",
          }}
        >
          Terminal — coming soon (press ⌘` to switch back)
        </div>
      </div>
    </div>
  );
}

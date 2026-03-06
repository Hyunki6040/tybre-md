import { useState, useEffect, useRef, useCallback } from "react";
import { Search, FileText, FolderOpen, ExternalLink } from "lucide-react";
import { useAppStore, type FileEntry } from "@/store/appStore";
import { cn } from "@/lib/utils";

interface QuickItem {
  id: string;
  type: "tab" | "file" | "project";
  title: string;
  subtitle: string;
  badge?: string;
  tabId?: string;
  filePath?: string;
  projectPath?: string;
}

function collectMarkdownFiles(entry: FileEntry, openPaths: Set<string>, out: QuickItem[]) {
  if (!entry.is_dir) {
    if (entry.name.endsWith(".md") && !openPaths.has(entry.path)) {
      out.push({
        id: `file-${entry.path}`,
        type: "file",
        title: entry.name,
        subtitle: entry.path,
        filePath: entry.path,
      });
    }
    return;
  }
  entry.children?.forEach((child) => collectMarkdownFiles(child, openPaths, out));
}

async function openProjectInNewWindow(projectPath: string) {
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const projectName = projectPath.split("/").pop() ?? "Project";
    const label = `project-${Date.now()}`;
    new WebviewWindow(label, {
      url: `/?project=${encodeURIComponent(projectPath)}`,
      title: `${projectName} — Tybre.md`,
      width: 1280,
      height: 800,
      minWidth: 800,
      minHeight: 600,
    });
  } catch {
    // Browser / fallback: can't open new window
    console.warn("WebviewWindow not available");
  }
}

export function QuickOpen() {
  const { quickOpenVisible, setQuickOpenVisible, tabs, fileTree, addTab, setActiveTab } =
    useAppStore();

  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [projects, setProjects] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load cached project list when panel opens
  useEffect(() => {
    if (!quickOpenVisible) return;
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<string[]>("load_cached_projects"))
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [quickOpenVisible]);

  // Build candidate list: open tabs → unopen files → projects
  const items: QuickItem[] = (() => {
    const openPaths = new Set(tabs.map((t) => t.filePath).filter(Boolean) as string[]);
    const result: QuickItem[] = tabs.map((t) => ({
      id: `tab-${t.id}`,
      type: "tab" as const,
      title: t.title,
      subtitle: t.filePath ?? "New file",
      badge: "open",
      tabId: t.id,
    }));
    if (fileTree) {
      collectMarkdownFiles(fileTree, openPaths, result);
    }
    // Projects section (exclude current open project to avoid duplicate)
    const currentRoot = fileTree?.path;
    projects
      .filter((p) => p !== currentRoot)
      .forEach((p) => {
        result.push({
          id: `project-${p}`,
          type: "project",
          title: p.split("/").pop() ?? p,
          subtitle: p,
          projectPath: p,
        });
      });
    return result;
  })();

  const filtered = query.trim()
    ? items.filter(
        (i) =>
          i.title.toLowerCase().includes(query.toLowerCase()) ||
          i.subtitle.toLowerCase().includes(query.toLowerCase())
      )
    : items;

  // Reset selection when results change
  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  // Focus input when opened
  useEffect(() => {
    if (quickOpenVisible) {
      setQuery("");
      setSelectedIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [quickOpenVisible]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  async function handleSelect(item: QuickItem) {
    setQuickOpenVisible(false);
    if (item.type === "tab" && item.tabId) {
      setActiveTab(item.tabId);
    } else if (item.type === "file" && item.filePath) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const content = await invoke<string>("read_file", { path: item.filePath });
        const id = `tab-${Date.now()}`;
        addTab({ id, filePath: item.filePath, projectPath: fileTree?.path ?? null, title: item.title, content, isDirty: false });
      } catch {
        const id = `tab-${Date.now()}`;
        addTab({ id, filePath: item.filePath!, projectPath: fileTree?.path ?? null, title: item.title, content: "", isDirty: false });
      }
    } else if (item.type === "project" && item.projectPath) {
      await openProjectInNewWindow(item.projectPath);
    }
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setQuickOpenVisible(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" && filtered[selectedIdx]) {
        e.preventDefault();
        handleSelect(filtered[selectedIdx]);
      }
    },
    [filtered, selectedIdx]
  );

  if (!quickOpenVisible) return null;

  // Group filtered results by type for rendering section headers
  const fileLike = filtered.filter((i) => i.type !== "project");
  const projectItems = filtered.filter((i) => i.type === "project");

  let flatIdx = 0;

  function renderItem(item: QuickItem, absoluteIdx: number) {
    const isSelected = absoluteIdx === selectedIdx;
    return (
      <button
        key={item.id}
        data-idx={absoluteIdx}
        className={cn(
          "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
          isSelected ? "bg-muted" : "hover:bg-muted/50"
        )}
        onClick={() => handleSelect(item)}
        onMouseEnter={() => setSelectedIdx(absoluteIdx)}
      >
        {item.type === "project" ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-foreground">{item.title}</div>
          <div className="truncate text-xs text-muted-foreground">{item.subtitle}</div>
        </div>
        {item.type === "project" ? (
          <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/50" />
        ) : item.badge ? (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {item.badge}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ paddingTop: "20vh", background: "rgba(0,0,0,0.45)" }}
      onClick={() => setQuickOpenVisible(false)}
    >
      <div
        className="w-[480px] overflow-hidden rounded-lg border border-border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center border-b border-border px-3">
          <Search className="mr-2.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Go to file or project…"
            className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="ml-2 shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[360px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No matching files or projects
            </div>
          ) : (
            <>
              {/* Files / tabs section */}
              {fileLike.length > 0 && (
                <div>
                  {fileLike.map((item) => {
                    const idx = flatIdx++;
                    return renderItem(item, idx);
                  })}
                </div>
              )}

              {/* Projects section */}
              {projectItems.length > 0 && (
                <div>
                  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    프로젝트 — 새 창으로 열기
                  </div>
                  {projectItems.map((item) => {
                    const idx = flatIdx++;
                    return renderItem(item, idx);
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer hint */}
        {projectItems.length > 0 && !query && (
          <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground/60">
            <ExternalLink className="mr-1 inline h-3 w-3" />
            프로젝트 선택 시 새 창으로 열립니다
          </div>
        )}
      </div>
    </div>
  );
}

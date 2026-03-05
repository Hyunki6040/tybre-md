import { useState, useEffect, useRef, useCallback } from "react";
import { Search, FileText } from "lucide-react";
import { useAppStore, type FileEntry } from "@/store/appStore";
import { cn } from "@/lib/utils";

interface QuickItem {
  id: string;
  title: string;
  subtitle: string;
  badge?: string;
  tabId?: string;
  filePath?: string;
}

function collectMarkdownFiles(entry: FileEntry, openPaths: Set<string>, out: QuickItem[]) {
  if (!entry.is_dir) {
    if (entry.name.endsWith(".md") && !openPaths.has(entry.path)) {
      out.push({
        id: `file-${entry.path}`,
        title: entry.name,
        subtitle: entry.path,
        filePath: entry.path,
      });
    }
    return;
  }
  entry.children?.forEach((child) => collectMarkdownFiles(child, openPaths, out));
}

export function QuickOpen() {
  const { quickOpenVisible, setQuickOpenVisible, tabs, fileTree, addTab, setActiveTab } =
    useAppStore();

  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build candidate list: open tabs first, then unopen files from tree
  const items: QuickItem[] = (() => {
    const openPaths = new Set(tabs.map((t) => t.filePath).filter(Boolean) as string[]);
    const result: QuickItem[] = tabs.map((t) => ({
      id: `tab-${t.id}`,
      title: t.title,
      subtitle: t.filePath ?? "New file",
      badge: "open",
      tabId: t.id,
    }));
    if (fileTree) {
      collectMarkdownFiles(fileTree, openPaths, result);
    }
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
      // Tiny defer so the DOM is painted
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
    if (item.tabId) {
      setActiveTab(item.tabId);
    } else if (item.filePath) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const content = await invoke<string>("read_file", { path: item.filePath });
        const id = `tab-${Date.now()}`;
        addTab({ id, filePath: item.filePath, title: item.title, content, isDirty: false });
      } catch {
        // Browser mode: just open empty tab with the title
        const id = `tab-${Date.now()}`;
        addTab({ id, filePath: item.filePath!, title: item.title, content: "", isDirty: false });
      }
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
            placeholder="Go to file…"
            className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="ml-2 shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No matching files
            </div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.id}
                data-idx={i}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                  i === selectedIdx ? "bg-muted" : "hover:bg-muted/50"
                )}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelectedIdx(i)}
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-foreground">{item.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{item.subtitle}</div>
                </div>
                {item.badge && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {item.badge}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

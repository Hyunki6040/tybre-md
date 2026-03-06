import { useState, useEffect, useRef, useCallback } from "react";
import { Search, FileText, X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/utils";

interface SearchMatch {
  path: string;
  relative_path: string;
  line_num: number;
  line_text: string;
}

export function ProjectSearch() {
  const { setProjectSearchVisible, fileTree, addTab, setActiveTab, tabs } = useAppStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [results]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || !fileTree) { setResults([]); return; }
    setLoading(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const matches = await invoke<SearchMatch[]>("search_files", {
        root: fileTree.path,
        query: q,
      });
      setResults(matches);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [fileTree]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  }

  async function handleSelect(match: SearchMatch) {
    setProjectSearchVisible(false);
    // Check if already open
    const existing = tabs.find((t) => t.filePath === match.path);
    if (existing) { setActiveTab(existing.id); return; }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const content = await invoke<string>("read_file", { path: match.path });
      const id = `tab-${Date.now()}`;
      const title = match.path.split("/").pop() ?? match.relative_path;
      addTab({ id, filePath: match.path, projectPath: fileTree?.path ?? null, title, content, isDirty: false });
    } catch { /* noop */ }
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setProjectSearchVisible(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && results[selectedIdx]) { e.preventDefault(); handleSelect(results[selectedIdx]); }
  }, [results, selectedIdx]);

  // Group results by file
  const grouped = results.reduce<Record<string, SearchMatch[]>>((acc, m) => {
    (acc[m.relative_path] = acc[m.relative_path] ?? []).push(m);
    return acc;
  }, {});

  let flatIdx = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ paddingTop: "15vh", background: "rgba(0,0,0,0.45)" }}
      onClick={() => setProjectSearchVisible(false)}
    >
      <div
        className="w-[560px] overflow-hidden rounded-lg border border-border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center border-b border-border px-3">
          <Search className="mr-2.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={handleChange}
            placeholder="프로젝트 전체 검색…"
            className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          {loading && <span className="text-xs text-muted-foreground">검색 중…</span>}
          <button
            onClick={() => setProjectSearchVisible(false)}
            className="ml-2 rounded p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[400px] overflow-y-auto py-1">
          {!fileTree && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              프로젝트 폴더를 먼저 열어주세요
            </div>
          )}
          {fileTree && !query && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              검색어를 입력하세요
            </div>
          )}
          {fileTree && query && !loading && results.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              결과 없음
            </div>
          )}
          {Object.entries(grouped).map(([relPath, matches]) => (
            <div key={relPath}>
              <div className="flex items-center gap-2 bg-muted/40 px-3 py-1">
                <FileText className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                <span className="text-[11px] font-medium text-muted-foreground">{relPath}</span>
              </div>
              {matches.map((m) => {
                const idx = flatIdx++;
                const isSelected = idx === selectedIdx;
                const before = m.line_text.toLowerCase().indexOf(query.toLowerCase());
                const highlighted = before >= 0
                  ? <>
                      {m.line_text.slice(0, before)}
                      <mark className="bg-primary/20 text-foreground">
                        {m.line_text.slice(before, before + query.length)}
                      </mark>
                      {m.line_text.slice(before + query.length)}
                    </>
                  : m.line_text;

                return (
                  <button
                    key={idx}
                    data-idx={idx}
                    className={cn(
                      "flex w-full items-start gap-3 px-3 py-1.5 text-left text-sm transition-colors",
                      isSelected ? "bg-muted" : "hover:bg-muted/50"
                    )}
                    onClick={() => handleSelect(m)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <span className="mt-0.5 w-8 shrink-0 text-right font-mono text-[10px] text-muted-foreground/50">
                      {m.line_num}
                    </span>
                    <span className="flex-1 truncate text-xs text-foreground/80">{highlighted}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {results.length === 200 && (
            <div className="border-t border-border px-3 py-1.5 text-center text-[11px] text-muted-foreground">
              상위 200개 결과만 표시됩니다
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

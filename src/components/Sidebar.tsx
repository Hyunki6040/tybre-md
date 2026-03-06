import { useState, useEffect, useRef } from "react";
import {
  ChevronRight,
  ChevronUp,
  FileText,
  FilePlus,
  FileImage,
  File,
  Folder,
  FolderOpen,
  HardDrive,
  Clock,
  Search,
  RefreshCw,
  X,
} from "lucide-react";
import { useAppStore, type FileEntry } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Sidebar root
// ─────────────────────────────────────────────────────────────
export function Sidebar() {
  const { sidebarVisible, fileTree, setFileTree, addTab, recentDirs, addRecentDir } =
    useAppStore();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [claudeDirs, setClaudeDirs] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Two-phase load: cache (instant) → fresh scan (background)
  useEffect(() => {
    async function loadProjects() {
      const { invoke } = await import("@tauri-apps/api/core");
      // Phase 1: load cached projects immediately
      const cached = await invoke<string[]>("load_cached_projects").catch(() => []);
      if (cached.length > 0) setClaudeDirs(cached);

      // Phase 2: fresh scan in background
      setScanning(true);
      const fresh = await invoke<string[]>("scan_claude_projects").catch(() => []);
      setClaudeDirs(fresh);
      setScanning(false);
    }
    loadProjects();
  }, []);

  // Focus search when menu opens; clear when it closes
  useEffect(() => {
    if (folderMenuOpen) {
      const t = setTimeout(() => searchRef.current?.focus(), 60);
      return () => clearTimeout(t);
    } else {
      setSearchQuery("");
    }
  }, [folderMenuOpen]);

  // Close menu on outside click
  useEffect(() => {
    if (!folderMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setFolderMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [folderMenuOpen]);

  async function openDir(path: string) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const tree = await invoke<FileEntry>("open_folder", { path });
      setFileTree(tree);
      addRecentDir(path);
      setExpandedDirs(new Set([path]));
      setFolderMenuOpen(false);
    } catch (err) {
      console.error("open_folder failed:", err);
    }
  }

  async function browseFolder() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string | null>("pick_folder");
      if (path) await openDir(path);
    } catch (err) {
      console.error("pick_folder failed:", err);
    }
    setFolderMenuOpen(false);
  }

  async function handleNewFile() {
    if (!fileTree) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: fileTree.path,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (typeof path === "string") {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("create_file", { path });
        const name = path.split("/").pop() ?? "Untitled.md";
        const id = `tab-${Date.now()}`;
        addTab({ id, filePath: path, title: name, content: "", isDirty: false });
        const tree = await invoke<FileEntry>("open_folder", { path: fileTree.path });
        setFileTree(tree);
      }
    } catch {
      addTab({
        id: `tab-${Date.now()}`,
        filePath: null,
        title: "Untitled.md",
        content: "",
        isDirty: false,
      });
    }
  }

  function toggleDir(path: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  // ── Filter logic ────────────────────────────────────────────
  const query = searchQuery.toLowerCase();
  const recentSet = new Set(recentDirs);
  const extraClaudeDirs = claudeDirs.filter((d) => !recentSet.has(d));

  const filteredRecent = query
    ? recentDirs.filter((d) => d.toLowerCase().includes(query))
    : recentDirs;
  const filteredExtra = query
    ? extraClaudeDirs.filter((d) => d.toLowerCase().includes(query))
    : extraClaudeDirs;
  const hasResults = filteredRecent.length > 0 || filteredExtra.length > 0;

  const currentDirName = fileTree ? fileTree.name : "No folder open";

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden border-r border-border bg-muted",
        "transition-all duration-200 ease-out",
        sidebarVisible ? "w-[240px] opacity-100" : "w-0 opacity-0 pointer-events-none"
      )}
      aria-hidden={!sidebarVisible}
    >
      {/* Header */}
      <div className="flex h-[36px] shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Explorer
        </span>
        <div className="flex items-center gap-0.5">
          {fileTree && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={handleNewFile}
              title="New File"
            >
              <FilePlus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <Separator />

      {/* File tree */}
      <ScrollArea className="flex-1">
        {fileTree ? (
          <div className="py-1">
            <FileTreeNode
              entry={fileTree}
              expandedDirs={expandedDirs}
              onToggleDir={toggleDir}
              depth={0}
              isRoot
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
            <FolderOpen className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm" style={{ color: "var(--status-text)" }}>
              No folder open
            </p>
          </div>
        )}
      </ScrollArea>

      {/* ── Bottom: folder dropup ── */}
      <div ref={menuRef} className="relative shrink-0">
        <Separator />

        {/* Dropup menu — always in DOM for smooth CSS transition */}
        <div
          className={cn(
            "absolute bottom-full left-0 right-0 z-50",
            "flex flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-lg",
            "transition-all duration-200 ease-out origin-bottom",
            folderMenuOpen
              ? "opacity-100 translate-y-0 scale-100 pointer-events-auto"
              : "opacity-0 translate-y-2 scale-[0.98] pointer-events-none"
          )}
          aria-hidden={!folderMenuOpen}
        >
          {/* Search bar */}
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search projects…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            />
            {searchQuery ? (
              <button
                onClick={() => setSearchQuery("")}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            ) : scanning ? (
              <RefreshCw className="h-3 w-3 text-muted-foreground animate-spin" />
            ) : null}
          </div>

          {/* Scrollable results */}
          <div className="max-h-[280px] overflow-y-auto">
            {/* Recent dirs */}
            {filteredRecent.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-3 py-1.5">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Recent
                  </span>
                </div>
                {filteredRecent.map((dir) => (
                  <FolderItem
                    key={dir}
                    path={dir}
                    query={query}
                    isCurrent={fileTree?.path === dir}
                    onClick={() => openDir(dir)}
                  />
                ))}
                {filteredExtra.length > 0 && <Separator />}
              </>
            )}

            {/* .claude project dirs */}
            {filteredExtra.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-3 py-1.5">
                  <Search className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Projects
                  </span>
                </div>
                {filteredExtra.map((dir) => (
                  <FolderItem
                    key={dir}
                    path={dir}
                    query={query}
                    isCurrent={fileTree?.path === dir}
                    onClick={() => openDir(dir)}
                  />
                ))}
                <Separator />
              </>
            )}

            {/* No results */}
            {query && !hasResults && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                No projects found
              </div>
            )}

            {/* Browse */}
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              onClick={browseFolder}
            >
              <HardDrive className="h-3.5 w-3.5 shrink-0" />
              <span>Browse…</span>
            </button>
          </div>
        </div>

        {/* Trigger button */}
        <button
          className={cn(
            "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors",
            "hover:bg-accent/50 hover:text-foreground",
            folderMenuOpen ? "bg-accent/50 text-foreground" : "text-muted-foreground"
          )}
          onClick={() => setFolderMenuOpen((v) => !v)}
          title="Open or switch folder"
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate">{currentDirName}</span>
          <ChevronUp
            className={cn(
              "h-3 w-3 shrink-0 transition-transform duration-200",
              folderMenuOpen && "rotate-180"
            )}
          />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Folder list item in the dropup (with search highlight)
// ─────────────────────────────────────────────────────────────
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-primary/20 text-primary font-medium">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

function FolderItem({
  path,
  isCurrent,
  query,
  onClick,
}: {
  path: string;
  isCurrent: boolean;
  query: string;
  onClick: () => void;
}) {
  const name = path.split("/").pop() ?? path;
  const parent = path.split("/").slice(-2, -1)[0] ?? "";
  return (
    <button
      className={cn(
        "flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground",
        isCurrent && "bg-primary/10 text-primary"
      )}
      onClick={onClick}
    >
      <Folder className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          <HighlightMatch text={name} query={query} />
        </div>
        {parent && (
          <div className="truncate text-[10px] text-muted-foreground">…/{parent}</div>
        )}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// File tree node — animated expand/collapse via CSS grid
// ─────────────────────────────────────────────────────────────
interface FileTreeNodeProps {
  entry: FileEntry;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  depth: number;
  isRoot?: boolean;
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const OPENABLE_EXTS = new Set(["md", "txt", "pdf", ...IMAGE_EXTS]);

function fileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function FileTreeNode({ entry, expandedDirs, onToggleDir, depth, isRoot }: FileTreeNodeProps) {
  const { addTab, setActiveTab, tabs } = useAppStore();
  const isExpanded = expandedDirs.has(entry.path);

  const ext = fileExt(entry.name);
  const isMarkdown = ext === "md";
  const isImage = IMAGE_EXTS.has(ext);
  const isPdf = ext === "pdf";
  const isOpenable = !entry.is_dir && OPENABLE_EXTS.has(ext);
  const isActiveFile = tabs.some((t) => t.filePath === entry.path);

  // Lazy render: children only render after first expansion
  const [hasBeenExpanded, setHasBeenExpanded] = useState(isExpanded);
  useEffect(() => {
    if (isExpanded) setHasBeenExpanded(true);
  }, [isExpanded]);

  async function handleFileClick() {
    if (entry.is_dir) {
      onToggleDir(entry.path);
      return;
    }
    if (!isOpenable) return;

    const existing = tabs.find((t) => t.filePath === entry.path);
    if (existing) {
      setActiveTab(existing.id);
      return;
    }

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const id = `tab-${Date.now()}`;
      if (isImage || isPdf) {
        // Binary — don't read content, viewer uses convertFileSrc on the path
        addTab({ id, filePath: entry.path, title: entry.name, content: "", isDirty: false });
      } else {
        const content = await invoke<string>("read_file", { path: entry.path });
        addTab({ id, filePath: entry.path, title: entry.name, content, isDirty: false });
      }
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }

  const Icon = entry.is_dir
    ? (isExpanded ? FolderOpen : Folder)
    : isImage ? FileImage
    : isPdf ? File
    : FileText;

  // ── Root directory header ──
  if (isRoot && entry.is_dir) {
    return (
      <div>
        <div
          className="flex cursor-pointer items-center gap-1.5 px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/50 transition-colors"
          onClick={() => onToggleDir(entry.path)}
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 transition-transform duration-200",
              isExpanded && "rotate-90"
            )}
          />
          <span className="truncate">{entry.name}</span>
        </div>

        {/* Animated children */}
        {hasBeenExpanded && entry.children && (
          <div
            style={{
              display: "grid",
              gridTemplateRows: isExpanded ? "1fr" : "0fr",
              transition: "grid-template-rows 200ms ease-out",
            }}
          >
            <div style={{ overflow: "hidden", minHeight: 0 }}>
              {entry.children.map((child) => (
                <FileTreeNode
                  key={child.path}
                  entry={child}
                  expandedDirs={expandedDirs}
                  onToggleDir={onToggleDir}
                  depth={depth + 1}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Regular node ──
  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 py-[3px] pr-2 text-sm transition-colors",
          isOpenable || entry.is_dir ? "cursor-pointer hover:bg-accent hover:text-accent-foreground" : "cursor-default opacity-40",
          isActiveFile && "text-primary font-medium",
          !isActiveFile && entry.is_dir && "text-foreground",
          !isActiveFile && isOpenable && "text-foreground",
          !isOpenable && !entry.is_dir && "text-muted-foreground",
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={handleFileClick}
        role={entry.is_dir ? "button" : "treeitem"}
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && handleFileClick()}
      >
        {entry.is_dir ? (
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200",
              isExpanded && "rotate-90"
            )}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            entry.is_dir
              ? "text-muted-foreground"
              : isActiveFile
                ? "text-primary"
                : isMarkdown
                  ? "text-primary/60"
                  : isImage
                    ? "text-violet-500/70"
                    : isPdf
                      ? "text-red-500/70"
                      : "text-muted-foreground/60"
          )}
        />
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px]">
          {entry.name}
        </span>
      </div>

      {/* Animated children */}
      {entry.is_dir && hasBeenExpanded && entry.children && (
        <div
          style={{
            display: "grid",
            gridTemplateRows: isExpanded ? "1fr" : "0fr",
            transition: "grid-template-rows 200ms ease-out",
          }}
        >
          <div style={{ overflow: "hidden", minHeight: 0 }}>
            {entry.children.map((child) => (
              <FileTreeNode
                key={child.path}
                entry={child}
                expandedDirs={expandedDirs}
                onToggleDir={onToggleDir}
                depth={depth + 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

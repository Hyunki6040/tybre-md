import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  ChevronUp,
  FileText,
  BookOpen,
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
import { useWorkspaceStore } from "@/store/workspaceStore";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useSwitchProject, getOpenProjects, GROUP_HUES, type OpenProject } from "@/hooks/useSwitchProject";
import { FilePreviewPopup } from "@/components/FilePreviewPopup";

// ── FEATURE: Explorer hover file preview (DO NOT REMOVE) ───────────────────
// FilePreviewPopup is rendered via createPortal in FileTreeNode on mouse hover.
// The following are intentionally added to FileTreeNode:
//   - previewAnchor state, rowRef, hoverTimer, hideTimer refs
//   - handleMouseEnter / handleMouseLeave functions
//   - ref={rowRef}, onMouseEnter, onMouseLeave props on the row div
//   - createPortal(<FilePreviewPopup ... />, document.body) at the return
// ──────────────────────────────────────────────────────────────────────────
import { IMAGE_EXTS, OPENABLE_EXTS } from "@/lib/fileTypes";

// ── Helpers ───────────────────────────────────────────────────

function findEntry(root: FileEntry, path: string): FileEntry | null {
  if (root.path === path) return root;
  for (const child of root.children ?? []) {
    const found = findEntry(child, path);
    if (found) return found;
  }
  return null;
}

function collectChildNames(root: FileEntry, dir: string): Set<string> {
  const found = findEntry(root, dir);
  if (!found?.children) return new Set();
  return new Set(found.children.map((c) => c.name));
}

// ─────────────────────────────────────────────────────────────
// Sidebar root
// ─────────────────────────────────────────────────────────────
export function Sidebar() {
  const { t } = useTranslation();
  const { sidebarOpen: sidebarVisible } = useWorkspaceStore();
  const {
    fileTree, setFileTree, addTab,
    recentDirs, addRecentDir, newFileRequestedAt,
    tabs,
    requestCloseTerminalSessions,
    revealPathSignal,
  } = useAppStore();
  const switchProject = useSwitchProject();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);

  // ── Reveal path from terminal click ──────────────────────────────────────
  const [highlightedPath, setHighlightedPath] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!revealPathSignal) return;
    const { path } = revealPathSignal;

    // Expand all ancestor directories (not the target itself)
    const parts = path.split("/").filter(Boolean);
    const ancestors: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      ancestors.push("/" + parts.slice(0, i).join("/"));
    }

    setExpandedDirs((prev) => {
      const next = new Set(prev);
      ancestors.forEach((a) => next.add(a));
      return next;
    });

    // Reset and start heartbeat
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightedPath(path);
    highlightTimerRef.current = setTimeout(() => setHighlightedPath(null), 3100);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealPathSignal]);

  // Auto-expand root dir when project loads (startup restore or project switch)
  useEffect(() => {
    if (!fileTree?.path) return;
    setExpandedDirs((prev) => {
      if (prev.has(fileTree.path)) return prev;
      const next = new Set(prev);
      next.add(fileTree.path);
      return next;
    });
  }, [fileTree?.path]);

  // ── File tree auto-refresh on create/delete ────────────────────────────────
  useEffect(() => {
    if (!fileTree) return;

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    async function setup() {
      const { listen } = await import("@tauri-apps/api/event");
      const { invoke } = await import("@tauri-apps/api/core");

      const unlistenFn = await listen("file-tree-changed", async () => {
        if (!fileTree) return;
        try {
          // Refresh file tree while preserving expanded directories
          const tree = await invoke<FileEntry>("open_folder", { path: fileTree.path });
          setFileTree(tree);
        } catch (err) {
          console.error("Failed to refresh file tree:", err);
        }
      });

      if (cancelled) unlistenFn();
      else unlisten = unlistenFn;
    }

    setup().catch(console.error);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [fileTree?.path, setFileTree]);
  const [claudeDirs, setClaudeDirs] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dropupFocusIdx, setDropupFocusIdx] = useState(-1);

  // Rename / new-file state
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameExt, setRenameExt] = useState("");
  const [isNewFile, setIsNewFile] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number; path: string; isDir: boolean; name: string;
  } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Two-phase load: cache (instant) → fresh scan (background)
  useEffect(() => {
    async function loadProjects() {
      const { invoke } = await import("@tauri-apps/api/core");
      const cached = await invoke<string[]>("load_cached_projects").catch(() => []);
      if (cached.length > 0) setClaudeDirs(cached);
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
      setDropupFocusIdx(-1);
      const t = setTimeout(() => searchRef.current?.focus(), 60);
      return () => clearTimeout(t);
    } else {
      setSearchQuery("");
      setDropupFocusIdx(-1);
    }
  }, [folderMenuOpen]);

  // Global shortcut: ⌘⇧O to toggle folder dropup
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        if (!sidebarVisible) return;
        e.preventDefault();
        setFolderMenuOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarVisible]);

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

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    function onDown(e: MouseEvent) {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ctxMenu]);

  // React to Ctrl+N from App.tsx via counter increment
  useEffect(() => {
    if (newFileRequestedAt === 0 || !fileTree) return;
    handleNewFile();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newFileRequestedAt]);

  async function openDir(path: string) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const tree = await invoke<FileEntry>("open_folder", { path });
      setFileTree(tree);
      addRecentDir(path);
      setExpandedDirs(new Set([path]));
      setFolderMenuOpen(false);

      // Load workspace settings (sidebar, terminal, etc.)
      await useWorkspaceStore.getState().loadWorkspace(path);

      // Restore saved editor tabs + terminal session names from tabs.json
      const savedTabs = await invoke<{
        open_tabs: string[];
        active_tab: string | null;
        terminal_session_names: string[];
      }>("load_project_tabs", { projectPath: path }).catch(() => null);

      if (savedTabs && savedTabs.open_tabs.length > 0) {
        // Set pending terminal session names for TerminalView to consume
        if (savedTabs.terminal_session_names.length > 0) {
          useWorkspaceStore.getState().setPendingTerminalSessionNames(
            savedTabs.terminal_session_names
          );
        }

        // Restore editor tabs
        let activeTabId: string | null = null;
        for (const filePath of savedTabs.open_tabs) {
          const existing = useAppStore.getState().tabs.find(
            (t) => t.filePath === filePath && t.projectPath === path
          );
          if (existing) {
            if (filePath === savedTabs.active_tab) activeTabId = existing.id;
            continue;
          }
          try {
            const fileContent = await invoke<string>("read_file", { path: filePath });
            const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            useAppStore.getState().addTab({
              id,
              filePath,
              projectPath: path,
              title: filePath.split("/").pop() ?? "file",
              content: fileContent,
              isDirty: false,
              externalVersion: 0,
            });
            if (filePath === savedTabs.active_tab || !activeTabId) activeTabId = id;
          } catch {
            // File deleted — skip
          }
        }

        // Activate the saved active tab
        if (activeTabId) {
          useAppStore.getState().setActiveTab(activeTabId);
        }
      }
    } catch (err) {
      console.error("open_folder failed:", err);
    }
  }

  async function handleOpenProjectClick(path: string) {
    await switchProject(path);
    setExpandedDirs(new Set([path]));
  }

  async function handleCloseProject(projectPath: string) {

    // 1. Collect open editor tabs for this project
    const { tabs: currentTabs, activeTabId } = useAppStore.getState();
    const projectTabs = currentTabs.filter((t) => t.projectPath === projectPath);
    const openTabPaths = projectTabs
      .map((t) => t.filePath)
      .filter((p): p is string => p !== null);
    const activeTabFilePath =
      currentTabs.find((t) => t.id === activeTabId && t.projectPath === projectPath)
        ?.filePath ?? null;

    // 2. Collect terminal session names from the registry
    const { getTerminalSessionNames } = await import("@/components/TerminalView");
    const sessionNames = getTerminalSessionNames(projectPath);

    // 3. Save to tabs.json
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_project_tabs", {
        projectPath,
        tabs: {
          open_tabs: openTabPaths,
          active_tab: activeTabFilePath,
          terminal_session_names: sessionNames,
        },
      });
    } catch (err) {
      console.error("Failed to save project tabs:", err);
    }

    // 4. Close all editor tabs for this project
    const snap = useAppStore.getState();
    snap.tabs
      .filter((t) => t.projectPath === projectPath)
      .forEach((t) => useAppStore.getState().closeTab(t.id));

    // 5. Signal TerminalView to close all sessions for this project
    requestCloseTerminalSessions(projectPath);

    // 6. Clear the file tree
    setFileTree(null);
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

  async function handleNewFile(overrideDir?: string) {
    if (!fileTree) return;

    // 1. Determine target directory
    let targetDir = fileTree.path;
    if (typeof overrideDir === "string") {
      targetDir = overrideDir;
    } else if (selectedPath) {
      const entry = findEntry(fileTree, selectedPath);
      if (entry) {
        targetDir = entry.is_dir
          ? entry.path
          : entry.path.split("/").slice(0, -1).join("/");
      }
    }

    const { invoke } = await import("@tauri-apps/api/core");

    // 2. Find a non-conflicting filename
    const freshTree = await invoke<FileEntry>("open_folder", { path: fileTree.path }).catch(() => fileTree);
    const existingNames = collectChildNames(freshTree, targetDir);
    let candidate = "Untitled.md";
    let n = 2;
    while (existingNames.has(candidate)) {
      candidate = `Untitled ${n}.md`;
      n++;
    }

    // 3. Create file
    const newPath = `${targetDir}/${candidate}`;
    await invoke("create_file", { path: newPath });

    // 4. Add tab + refresh tree
    const id = `tab-${Date.now()}`;
    addTab({ id, filePath: newPath, projectPath: fileTree.path, title: candidate, content: "", isDirty: false, externalVersion: 0 });
    const tree2 = await invoke<FileEntry>("open_folder", { path: fileTree.path });
    setFileTree(tree2);

    // 5. Expand parent dirs
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      next.add(targetDir);
      next.add(fileTree.path);
      return next;
    });

    // 6. Start inline rename (show full filename with extension; select name part only)
    setIsNewFile(true);
    setRenamingPath(newPath);
    setRenameValue(candidate);
    setRenameExt("");
    setTimeout(() => {
      const input = renameInputRef.current;
      if (!input) return;
      input.focus();
      const dotIdx = input.value.lastIndexOf(".");
      if (dotIdx > 0) {
        input.setSelectionRange(0, dotIdx);
      } else {
        input.select();
      }
    }, 60);
  }

  async function commitRename(oldPath: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) { await cancelRename(oldPath); return; }

    const dir = oldPath.split("/").slice(0, -1).join("/");
    const newName = isNewFile
      ? trimmed
      : `${trimmed}${renameExt}`;
    const newPath = `${dir}/${newName}`;

    if (newPath !== oldPath) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("rename_file", { oldPath, newPath });
        useAppStore.setState((s) => ({
          tabs: s.tabs.map((t) =>
            t.filePath === oldPath ? { ...t, filePath: newPath, title: newName, isDirty: false } : t
          ),
        }));
        const tree = await invoke<FileEntry>("open_folder", { path: fileTree!.path });
        setFileTree(tree);
      } catch { /* conflict or error — ignore */ }
    }

    setRenamingPath(null);
    setIsNewFile(false);
  }

  async function cancelRename(oldPath: string) {
    if (isNewFile) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("delete_file", { path: oldPath });
        const tab = useAppStore.getState().tabs.find((t) => t.filePath === oldPath);
        if (tab) useAppStore.getState().closeTab(tab.id);
        const tree = await invoke<FileEntry>("open_folder", { path: fileTree!.path });
        setFileTree(tree);
      } catch { /* ignore */ }
    }
    setRenamingPath(null);
    setIsNewFile(false);
  }

  function toggleDir(path: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  // ── Filter logic (declared early so handleDropupKey can reference) ──
  const _query = searchQuery.toLowerCase();
  const _recentSet = new Set(recentDirs);
  const _extraClaudeDirs = claudeDirs.filter((d) => !_recentSet.has(d));
  const _filteredRecent = _query
    ? recentDirs.filter((d) => d.toLowerCase().includes(_query))
    : recentDirs;
  const _filteredExtra = _query
    ? _extraClaudeDirs.filter((d) => d.toLowerCase().includes(_query))
    : _extraClaudeDirs;
  const _allDirItems = [..._filteredRecent, ..._filteredExtra];

  function handleDropupKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setFolderMenuOpen(false); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setDropupFocusIdx((i) => Math.min(i + 1, _allDirItems.length));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (dropupFocusIdx <= 0) {
        setDropupFocusIdx(-1);
        searchRef.current?.focus();
      } else {
        setDropupFocusIdx((i) => i - 1);
      }
      return;
    }
    if (e.key === "Enter" && dropupFocusIdx >= 0) {
      e.preventDefault();
      if (dropupFocusIdx < _allDirItems.length) {
        openDir(_allDirItems[dropupFocusIdx]);
      } else {
        browseFolder();
      }
    }
  }

  // ── Filter logic aliases ──
  const query = _query;
  const filteredRecent = _filteredRecent;
  const filteredExtra = _filteredExtra;
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
              onClick={() => handleNewFile()}
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
              renamingPath={renamingPath}
              renameValue={renameValue}
              renameExt={renameExt}
              renameInputRef={renameInputRef}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
              highlightedPath={highlightedPath}
              onStartRename={(path, name) => {
                setIsNewFile(false);
                setRenamingPath(path);
                const dotIdx = name.lastIndexOf(".");
                if (dotIdx > 0) {
                  setRenameValue(name.slice(0, dotIdx));
                  setRenameExt(name.slice(dotIdx));
                } else {
                  setRenameValue(name);
                  setRenameExt("");
                }
                setTimeout(() => {
                  renameInputRef.current?.focus();
                  renameInputRef.current?.select();
                }, 50);
              }}
              onRenameChange={setRenameValue}
              onCommitRename={commitRename}
              onCancelRename={cancelRename}
              onContextMenu={(e, path, isDir, name) =>
                setCtxMenu({ x: e.clientX, y: e.clientY, path, isDir, name })
              }
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

      {/* ── Context menu ── */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-[300] w-48 overflow-hidden rounded-lg border border-border bg-popover shadow-xl py-1 text-[13px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-accent transition-colors text-left"
            onClick={async () => {
              const { invoke } = await import("@tauri-apps/api/core");
              await invoke("reveal_in_finder", { path: ctxMenu.path }).catch(() => {});
              setCtxMenu(null);
            }}
          >
            {t("sidebar.menu.showInFinder")}
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-accent transition-colors text-left"
            onClick={() => {
              navigator.clipboard.writeText(ctxMenu.path).catch(() => {});
              setCtxMenu(null);
            }}
          >
            {t("sidebar.menu.copyPath")}
          </button>
          <div className="my-1 border-t border-border" />
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-accent transition-colors text-left"
            onClick={() => {
              const { path, name } = ctxMenu;
              setCtxMenu(null);
              setIsNewFile(false);
              setRenamingPath(path);
              const dotIdx = name.lastIndexOf(".");
              if (dotIdx > 0) {
                setRenameValue(name.slice(0, dotIdx));
                setRenameExt(name.slice(dotIdx));
              } else {
                setRenameValue(name);
                setRenameExt("");
              }
              setTimeout(() => {
                renameInputRef.current?.focus();
                renameInputRef.current?.select();
              }, 60);
            }}
          >
            {t("sidebar.menu.rename")}
          </button>
          {ctxMenu.isDir && (
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-accent transition-colors text-left"
              onClick={() => {
                const dirPath = ctxMenu.path;
                setCtxMenu(null);
                handleNewFile(dirPath);
              }}
            >
              {t("sidebar.menu.newFile")}
            </button>
          )}
          <div className="my-1 border-t border-border" />
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-accent transition-colors text-left text-destructive"
            onClick={async () => {
              const { path } = ctxMenu;
              setCtxMenu(null);
              const { invoke } = await import("@tauri-apps/api/core");
              await invoke("delete_file", { path }).catch(() => {});
              // Close any open tab for this path
              const { tabs: currentTabs } = useAppStore.getState();
              currentTabs.forEach((t) => {
                if (t.filePath === path || t.filePath?.startsWith(path + "/")) {
                  useAppStore.getState().closeTab(t.id);
                }
              });
              // Refresh tree
              if (fileTree) {
                const tree = await invoke<FileEntry>("open_folder", { path: fileTree.path }).catch(() => null);
                if (tree) setFileTree(tree);
              }
            }}
          >
            {t("sidebar.menu.delete")}
          </button>
        </div>
      )}

      {/* ── Open projects panel ── */}
      <OpenProjectsPanel
        projects={getOpenProjects(tabs)}
        activePath={fileTree?.path ?? null}
        onSwitch={handleOpenProjectClick}
        onClose={handleCloseProject}
      />

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
          onKeyDown={handleDropupKey}
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
                {filteredRecent.map((dir, idx) => (
                  <FolderItem
                    key={dir}
                    path={dir}
                    query={query}
                    isCurrent={fileTree?.path === dir}
                    focused={dropupFocusIdx === idx}
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
                {filteredExtra.map((dir, idx) => (
                  <FolderItem
                    key={dir}
                    path={dir}
                    query={query}
                    isCurrent={fileTree?.path === dir}
                    focused={dropupFocusIdx === filteredRecent.length + idx}
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
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
                dropupFocusIdx === _allDirItems.length && "bg-accent text-accent-foreground"
              )}
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
// Open projects panel (above folder dropup)
// ─────────────────────────────────────────────────────────────
function OpenProjectsPanel({
  projects,
  activePath,
  onSwitch,
  onClose,
}: {
  projects: OpenProject[];
  activePath: string | null;
  onSwitch: (path: string) => void;
  onClose: (path: string) => void;
}) {
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const terminalDoneProjects = useAppStore((s) => s.terminalDoneProjects);

  if (projects.length === 0) return null;
  return (
    <div className="shrink-0">
      <Separator />
      <div className="px-3 pt-1.5 pb-0.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 select-none">
          열린 프로젝트
        </span>
      </div>
      {projects.map((project, idx) => {
        const hue = GROUP_HUES[idx % GROUP_HUES.length];
        const isActive = project.path === activePath;
        const isHovered = hoveredPath === project.path;
        return (
          <div
            key={project.key}
            className={cn(
              "group flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition-colors",
              "hover:bg-accent/50",
              isActive ? "text-foreground font-medium" : "text-muted-foreground"
            )}
            style={{
              background: isActive ? `hsl(${hue} 55% 52% / 0.1)` : undefined,
              borderLeft: `2px solid hsl(${hue} 55% 52% / ${isActive ? 0.7 : 0.3})`,
            }}
            onMouseEnter={() => setHoveredPath(project.path)}
            onMouseLeave={() => setHoveredPath(null)}
          >
            {/* Click area for switching */}
            <button
              className="flex flex-1 min-w-0 items-center gap-2 text-left"
              onClick={() => onSwitch(project.path)}
              title={project.path}
            >
              <FolderOpen
                className="h-3.5 w-3.5 shrink-0"
                style={{ color: `hsl(${hue} 55% 45%)` }}
              />
              <span className="flex-1 truncate">{project.name}</span>
            </button>
            {/* Shortcut badge ↔ close button ↔ green done dot */}
            {(() => {
              const hasDone = !isActive && terminalDoneProjects.has(project.path);
              if (isHovered) {
                return (
                  <button
                    className="shrink-0 flex items-center justify-center w-4 h-4 rounded hover:text-foreground transition-colors"
                    style={{ color: `hsl(${hue} 40% 50%)` }}
                    onClick={(e) => { e.stopPropagation(); onClose(project.path); }}
                    title="Close project"
                  >
                    <X className="h-3 w-3" />
                  </button>
                );
              }
              if (hasDone) {
                return (
                  <span
                    className="shrink-0 w-2 h-2 rounded-full bg-green-500"
                    title="Terminal task completed"
                  />
                );
              }
              return (
                <span
                  className="shrink-0 font-mono text-[9px] opacity-70 select-none w-4 text-center"
                  style={{ color: `hsl(${hue} 40% 50%)` }}
                >
                  ⌃{idx + 1}
                </span>
              );
            })()}
          </div>
        );
      })}
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
  focused,
  query,
  onClick,
}: {
  path: string;
  isCurrent: boolean;
  focused?: boolean;
  query: string;
  onClick: () => void;
}) {
  const name = path.split("/").pop() ?? path;
  const parent = path.split("/").slice(-2, -1)[0] ?? "";
  return (
    <button
      className={cn(
        "flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground",
        isCurrent && "bg-primary/10 text-primary",
        focused && !isCurrent && "bg-accent text-accent-foreground"
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
  renamingPath?: string | null;
  renameValue?: string;
  renameExt?: string;
  renameInputRef?: React.RefObject<HTMLInputElement | null>;
  selectedPath?: string | null;
  onSelect?: (path: string) => void;
  onStartRename?: (path: string, name: string) => void;
  onRenameChange?: (v: string) => void;
  onCommitRename?: (path: string) => void;
  onCancelRename?: (path: string) => void;
  onContextMenu?: (e: React.MouseEvent, path: string, isDir: boolean, name: string) => void;
  highlightedPath?: string | null;
}


function fileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function FileTreeNode({
  entry, expandedDirs, onToggleDir, depth, isRoot,
  renamingPath, renameValue, renameExt, renameInputRef,
  selectedPath, onSelect, onStartRename, onRenameChange, onCommitRename, onCancelRename,
  onContextMenu, highlightedPath,
}: FileTreeNodeProps) {
  const { addTab, setActiveTab, tabs, fileTree, activeTabId } = useAppStore();
  const isExpanded = expandedDirs.has(entry.path);

  const ext = fileExt(entry.name);
  const isMarkdown = ext === "md";
  const isImage = IMAGE_EXTS.has(ext);
  const isPdf = ext === "pdf";
  const isOpenable = !entry.is_dir && OPENABLE_EXTS.has(ext);
  const isActiveFile = tabs.find((t) => t.id === activeTabId)?.filePath === entry.path;

  // Lazy render: children only render after first expansion
  const [hasBeenExpanded, setHasBeenExpanded] = useState(isExpanded);
  useEffect(() => {
    if (isExpanded) setHasBeenExpanded(true);
  }, [isExpanded]);


  // ── Hover preview ──────────────────────────────────────────────────────────
  const [previewAnchor, setPreviewAnchor] = useState<DOMRect | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  // Scroll highlighted item into view after directory expand animation
  useEffect(() => {
    if (entry.path !== highlightedPath) return;
    const t = setTimeout(() => {
      rowRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 250);
    return () => clearTimeout(t);
  }, [entry.path, highlightedPath]);

  function handleMouseEnter() {
    if (entry.is_dir) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hoverTimer.current = setTimeout(() => {
      const rect = rowRef.current?.getBoundingClientRect();
      if (rect) {
        setPreviewAnchor(rect);
        setPreviewVisible(true);
      }
    }, 500);
  }

  function handleMouseLeave() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hideTimer.current = setTimeout(() => setPreviewVisible(false), 100);
  }

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
        addTab({ id, filePath: entry.path, projectPath: fileTree?.path ?? null, title: entry.name, content: "", isDirty: false, externalVersion: 0 });
      } else {
        const content = await invoke<string>("read_file", { path: entry.path });
        addTab({ id, filePath: entry.path, projectPath: fileTree?.path ?? null, title: entry.name, content, isDirty: false, externalVersion: 0 });
      }
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }

  const Icon = entry.is_dir
    ? (isExpanded ? FolderOpen : Folder)
    : isImage ? FileImage
    : isPdf ? File
    : isMarkdown ? BookOpen
    : FileText;

  // Props forwarded to child nodes
  const childProps = {
    expandedDirs, onToggleDir,
    renamingPath, renameValue, renameExt, renameInputRef,
    selectedPath, onSelect, onStartRename, onRenameChange, onCommitRename, onCancelRename,
    onContextMenu, highlightedPath,
  };

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
                  depth={depth + 1}
                  {...childProps}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Regular node ──
  const isRenaming = renamingPath === entry.path;

  return (
    <div>
      <div
        ref={rowRef}
        className={cn(
          "flex items-center gap-1.5 py-[3px] pr-2 text-sm transition-colors",
          isOpenable || entry.is_dir ? "cursor-pointer hover:bg-accent hover:text-accent-foreground" : "cursor-default opacity-40",
          isActiveFile && "text-primary font-medium",
          !isActiveFile && entry.is_dir && "text-foreground",
          !isActiveFile && isOpenable && "text-foreground",
          !isOpenable && !entry.is_dir && "text-muted-foreground",
          selectedPath === entry.path && !isActiveFile && "bg-accent/20",
          entry.path === highlightedPath && "sidebar-heartbeat",
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => {
          onSelect?.(entry.path);
          handleFileClick();
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu?.(e, entry.path, entry.is_dir, entry.name);
        }}
        role={entry.is_dir ? "button" : "treeitem"}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (entry.is_dir) {
              onToggleDir(entry.path);
            } else {
              onStartRename?.(entry.path, entry.name);
            }
          }
        }}
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
                : isImage
                  ? "text-violet-500/70"
                  : isPdf
                    ? "text-red-500/70"
                    : "text-muted-foreground/60"
          )}
        />
        {isRenaming ? (
          <div className="flex items-baseline gap-0 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <input
              ref={renameInputRef}
              value={renameValue ?? ""}
              onChange={(e) => onRenameChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")  { e.preventDefault(); e.stopPropagation(); onCommitRename?.(entry.path); }
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancelRename?.(entry.path); }
              }}
              onBlur={() => onCommitRename?.(entry.path)}
              className="min-w-0 bg-transparent outline-none text-[13px] border-b border-primary"
              style={{
                color: "var(--foreground)",
                caretColor: "var(--primary)",
                width: `${Math.max((renameValue?.length ?? 0) + 1, 4)}ch`,
              }}
            />
            {renameExt && (
              <span className="text-[13px] shrink-0" style={{ color: "var(--muted-foreground)" }}>
                {renameExt}
              </span>
            )}
          </div>
        ) : (
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px]">
            {entry.name}
          </span>
        )}
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
                depth={depth + 1}
                {...childProps}
              />
            ))}
          </div>
        </div>
      )}

      {/* Hover preview popup — portal renders outside ScrollArea to avoid overflow clipping */}
      {previewAnchor && !entry.is_dir && createPortal(
        <FilePreviewPopup
          path={entry.path}
          ext={ext}
          anchorRect={previewAnchor}
          visible={previewVisible}
          onHidden={() => setPreviewAnchor(null)}
        />,
        document.body
      )}
    </div>
  );
}

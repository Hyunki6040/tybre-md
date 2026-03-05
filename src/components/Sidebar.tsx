import { useState } from "react";
import { ChevronRight, ChevronDown, FileText, FilePlus, Folder, FolderOpen } from "lucide-react";
import { useAppStore, type FileEntry } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const { sidebarVisible, fileTree, setFileTree, addTab } = useAppStore();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  async function handleOpenFolder() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        const { invoke } = await import("@tauri-apps/api/core");
        const tree = await invoke<FileEntry>("open_folder", { path: selected });
        setFileTree(tree);
        // Auto-expand root
        setExpandedDirs(new Set([selected]));
      }
    } catch (err) {
      console.warn("open_folder not available in browser mode:", err);
    }
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
        // Refresh tree
        const tree = await invoke<FileEntry>("open_folder", { path: fileTree.path });
        setFileTree(tree);
      }
    } catch (_err) {
      // Browser mode — just open a new untitled tab
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
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden border-r border-border bg-muted transition-all duration-200",
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
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={handleOpenFolder}
            title={fileTree ? "Change Folder" : "Open Folder (⌘B to toggle)"}
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Separator />

      {/* Content */}
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
            <p className="text-sm text-muted-foreground">No folder open</p>
            <Button size="sm" onClick={handleOpenFolder} className="text-xs">
              Open Folder
            </Button>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface FileTreeNodeProps {
  entry: FileEntry;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  depth: number;
  isRoot?: boolean;
}

function FileTreeNode({ entry, expandedDirs, onToggleDir, depth, isRoot }: FileTreeNodeProps) {
  const { addTab, setActiveTab, tabs } = useAppStore();
  const isExpanded = expandedDirs.has(entry.path);
  const isMarkdown = entry.name.endsWith(".md");
  const isActiveFile = tabs.some((t) => t.filePath === entry.path);

  async function handleFileClick() {
    if (entry.is_dir) {
      onToggleDir(entry.path);
      return;
    }
    if (!isMarkdown) return;

    // If already open, just activate
    const existing = tabs.find((t) => t.filePath === entry.path);
    if (existing) {
      setActiveTab(existing.id);
      return;
    }

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const content = await invoke<string>("read_file", { path: entry.path });
      const id = `tab-${Date.now()}`;
      addTab({ id, filePath: entry.path, title: entry.name, content, isDirty: false });
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }

  const Icon = entry.is_dir ? (isExpanded ? FolderOpen : Folder) : FileText;
  const Chevron = entry.is_dir ? (isExpanded ? ChevronDown : ChevronRight) : null;

  // Root dir: show folder name as section header
  if (isRoot && entry.is_dir) {
    return (
      <div>
        <div
          className="flex cursor-pointer items-center gap-1.5 px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/50 transition-colors"
          onClick={() => onToggleDir(entry.path)}
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">{entry.name}</span>
        </div>
        {isExpanded &&
          entry.children?.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              depth={depth + 1}
            />
          ))}
      </div>
    );
  }

  return (
    <div>
      <div
        className={cn(
          "flex cursor-pointer items-center gap-1.5 py-[3px] pr-2 text-sm transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          isActiveFile && "text-primary font-medium",
          !entry.is_dir && !isMarkdown && "text-muted-foreground",
          !isActiveFile && entry.is_dir && "text-foreground",
          !isActiveFile && isMarkdown && "text-foreground"
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={handleFileClick}
        role={entry.is_dir ? "button" : "treeitem"}
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && handleFileClick()}
      >
        {Chevron && <Chevron className="h-3 w-3 shrink-0 text-muted-foreground" />}
        {!Chevron && <span className="w-3 shrink-0" />}
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            entry.is_dir
              ? "text-muted-foreground"
              : isActiveFile
                ? "text-primary"
                : isMarkdown
                  ? "text-primary/60"
                  : "text-muted-foreground/60"
          )}
        />
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px]">
          {entry.name}
        </span>
      </div>

      {entry.is_dir &&
        isExpanded &&
        entry.children?.map((child) => (
          <FileTreeNode
            key={child.path}
            entry={child}
            expandedDirs={expandedDirs}
            onToggleDir={onToggleDir}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

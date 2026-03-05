import { useState } from "react";
import { useAppStore } from "../store/appStore";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

export function Sidebar() {
  const { sidebarVisible } = useAppStore();
  const [fileTree, setFileTree] = useState<FileEntry | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  async function handleOpenFolder() {
    try {
      // In Tauri, use dialog to pick folder
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        const { invoke } = await import("@tauri-apps/api/core");
        const tree = await invoke<FileEntry>("open_folder", { path: selected });
        setFileTree(tree);
      }
    } catch (err) {
      // Fallback for non-Tauri (browser dev mode)
      console.warn("open_folder not available in browser mode:", err);
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
      className={`sidebar ${sidebarVisible ? "" : "collapsed"}`}
      aria-hidden={!sidebarVisible}
    >
      <div className="sidebar-header">
        <span>Explorer</span>
      </div>
      <div className="sidebar-content">
        {fileTree ? (
          <FileTreeNode
            entry={fileTree}
            expandedDirs={expandedDirs}
            onToggleDir={toggleDir}
            depth={0}
          />
        ) : (
          <div className="sidebar-empty">
            <p>No folder open</p>
            <button className="open-folder-btn" onClick={handleOpenFolder}>
              Open Folder
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface FileTreeNodeProps {
  entry: FileEntry;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  depth: number;
}

function FileTreeNode({
  entry,
  expandedDirs,
  onToggleDir,
  depth,
}: FileTreeNodeProps) {
  const { addTab, setActiveTab } = useAppStore();
  const isExpanded = expandedDirs.has(entry.path);

  async function handleFileClick() {
    if (entry.is_dir) {
      onToggleDir(entry.path);
      return;
    }

    // Only open .md files in the editor
    if (!entry.name.endsWith(".md")) return;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const content = await invoke<string>("read_file", { path: entry.path });
      const id = `tab-${Date.now()}`;
      addTab({
        id,
        filePath: entry.path,
        title: entry.name,
        content,
        isDirty: false,
      });
      setActiveTab(id);
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }

  const icon = entry.is_dir
    ? isExpanded
      ? "▾"
      : "▸"
    : entry.name.endsWith(".md")
      ? "📄"
      : "📃";

  return (
    <div>
      <div
        className="file-tree-item"
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleFileClick}
        role={entry.is_dir ? "button" : "treeitem"}
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && handleFileClick()}
      >
        <span className="file-tree-icon">{icon}</span>
        <span>{entry.name}</span>
      </div>
      {entry.is_dir && isExpanded && entry.children?.map((child) => (
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

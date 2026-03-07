import { useCallback } from "react";
import { useAppStore, type Tab, type FileEntry } from "@/store/appStore";
import { useWorkspaceStore } from "@/store/workspaceStore";

export const GROUP_HUES = [210, 262, 152, 38, 355];

export interface OpenProject {
  key: string;
  name: string;
  path: string;
}

/** Derive open projects (real paths only) from tabs, in stable creation order. */
export function getOpenProjects(tabs: Tab[]): OpenProject[] {
  const seen = new Set<string>();
  const result: OpenProject[] = [];
  for (const tab of tabs) {
    if (!tab.projectPath || seen.has(tab.projectPath)) continue;
    seen.add(tab.projectPath);
    result.push({
      key: tab.projectPath,
      name: tab.projectPath.split("/").pop() ?? tab.projectPath,
      path: tab.projectPath,
    });
  }
  return result;
}

/**
 * Returns an async function that switches to a project:
 * saves current project's last active tab, loads the new tree,
 * and restores the new project's last tab.
 */
export function useSwitchProject() {
  const { setFileTree, addRecentDir, setActiveTab, setProjectLastTab } = useAppStore();
  const { loadWorkspace } = useWorkspaceStore();

  return useCallback(
    async (path: string) => {
      const state = useAppStore.getState();
      if (state.fileTree?.path === path) return; // already active

      // 1. Save current project's active tab
      if (state.fileTree?.path) {
        const curTab = state.tabs.find((t) => t.id === state.activeTabId);
        if (curTab?.filePath) {
          setProjectLastTab(state.fileTree.path, curTab.filePath);
        }
      }

      // 2. Load new project tree + workspace in parallel so setFileTree fires
      //    only after workspace state (terminalOpen etc.) is already updated,
      //    preventing spurious terminal tab creation in TerminalView Effect #2.
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const [tree] = await Promise.all([
          invoke<FileEntry>("open_folder", { path }),
          loadWorkspace(path), // flushes previous project's save before overwriting state
        ]);
        setFileTree(tree);
        addRecentDir(path);

        // 3. Restore last tab for new project
        const { projectLastTab, tabs } = useAppStore.getState();
        const lastFile = projectLastTab[path];
        if (lastFile) {
          const existing = tabs.find(
            (t) => t.filePath === lastFile && t.projectPath === path
          );
          if (existing) {
            setActiveTab(existing.id);
          } else {
            try {
              const content = await invoke<string>("read_file", { path: lastFile });
              const id = `tab-${Date.now()}`;
              useAppStore.getState().addTab({
                id,
                filePath: lastFile,
                projectPath: path,
                title: lastFile.split("/").pop() ?? "file",
                content,
                isDirty: false,
              });
            } catch {
              /* file deleted — skip */
            }
          }
        }
      } catch {
        console.error("Failed to switch project:", path);
      }
    },
    [setFileTree, addRecentDir, setActiveTab, setProjectLastTab, loadWorkspace]
  );
}

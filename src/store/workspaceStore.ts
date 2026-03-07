import { create } from "zustand";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkspaceData {
  sidebarOpen: boolean;
  sidebarWidth: number;
  memoOpen: boolean;
  memoWidth: number;
}

interface WorkspaceState extends WorkspaceData {
  projectPath: string | null;

  loadWorkspace: (projectPath: string) => Promise<void>;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setMemoOpen: (open: boolean) => void;
  setMemoWidth: (width: number) => void;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

function defaultWorkspace(): WorkspaceData {
  return { sidebarOpen: true, sidebarWidth: 240, memoOpen: false, memoWidth: 280 };
}

// ── Debounced file save ───────────────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function schedSave(getState: () => WorkspaceState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { projectPath, sidebarOpen, sidebarWidth, memoOpen, memoWidth } = getState();
    if (!projectPath) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_workspace", {
        projectPath,
        workspace: {
          sidebar_open: sidebarOpen,
          sidebar_width: sidebarWidth,
          memo_open: memoOpen,
          memo_width: memoWidth,
        },
      });
    } catch {
      // browser dev mode — silent
    }
  }, 500);
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...defaultWorkspace(),
  projectPath: null,

  loadWorkspace: async (projectPath) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const ws = await invoke<{
        sidebar_open: boolean;
        sidebar_width: number;
        memo_open: boolean;
        memo_width: number;
      }>("load_workspace", { projectPath });
      set({
        projectPath,
        sidebarOpen: ws.sidebar_open,
        sidebarWidth: ws.sidebar_width,
        memoOpen: ws.memo_open,
        memoWidth: ws.memo_width,
      });
    } catch {
      set({ projectPath, ...defaultWorkspace() });
    }
  },

  toggleSidebar: () => {
    set((s) => ({ sidebarOpen: !s.sidebarOpen }));
    schedSave(get);
  },

  setSidebarWidth: (width) => {
    set({ sidebarWidth: width });
    schedSave(get);
  },

  setMemoOpen: (open) => {
    set({ memoOpen: open });
    schedSave(get);
  },

  setMemoWidth: (width) => {
    set({ memoWidth: width });
    schedSave(get);
  },
}));

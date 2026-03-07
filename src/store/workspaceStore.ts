import { create } from "zustand";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkspaceData {
  sidebarOpen: boolean;
  sidebarWidth: number;
  memoOpen: boolean;
  memoWidth: number;
  termAutoClaude: boolean;
  termYoloMode: boolean;
  terminalOpen: boolean;
}

interface WorkspaceState extends WorkspaceData {
  projectPath: string | null;

  loadWorkspace: (projectPath: string) => Promise<void>;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setMemoOpen: (open: boolean) => void;
  setMemoWidth: (width: number) => void;
  setTermAutoClaude: (v: boolean) => void;
  setTermYoloMode: (v: boolean) => void;
  toggleTerminal: () => void;
  setTerminalOpen: (open: boolean) => void;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

function defaultWorkspace(): WorkspaceData {
  return {
    sidebarOpen: true,
    sidebarWidth: 240,
    memoOpen: false,
    memoWidth: 280,
    termAutoClaude: false,
    termYoloMode: false,
    terminalOpen: false,
  };
}

// ── Debounced file save ───────────────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function schedSave(getState: () => WorkspaceState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { projectPath, sidebarOpen, sidebarWidth, memoOpen, memoWidth, termAutoClaude, termYoloMode, terminalOpen } = getState();
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
          term_auto_claude: termAutoClaude,
          term_yolo_mode: termYoloMode,
          terminal_open: terminalOpen,
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
        term_auto_claude: boolean;
        term_yolo_mode: boolean;
        terminal_open: boolean;
      }>("load_workspace", { projectPath });
      set({
        projectPath,
        sidebarOpen: ws.sidebar_open,
        sidebarWidth: ws.sidebar_width,
        memoOpen: ws.memo_open,
        memoWidth: ws.memo_width,
        termAutoClaude: ws.term_auto_claude,
        termYoloMode: ws.term_yolo_mode,
        terminalOpen: ws.terminal_open,
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

  setTermAutoClaude: (v) => {
    set({ termAutoClaude: v });
    schedSave(get);
  },

  setTermYoloMode: (v) => {
    set({ termYoloMode: v });
    schedSave(get);
  },

  toggleTerminal: () => {
    set((s) => ({ terminalOpen: !s.terminalOpen }));
    schedSave(get);
  },

  setTerminalOpen: (open) => {
    set({ terminalOpen: open });
    schedSave(get);
  },
}));

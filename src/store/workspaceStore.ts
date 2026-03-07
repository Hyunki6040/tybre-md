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

// ── Save helpers ──────────────────────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function buildPayload(s: WorkspaceData) {
  return {
    sidebar_open: s.sidebarOpen,
    sidebar_width: s.sidebarWidth,
    memo_open: s.memoOpen,
    memo_width: s.memoWidth,
    term_auto_claude: s.termAutoClaude,
    term_yolo_mode: s.termYoloMode,
    terminal_open: s.terminalOpen,
  };
}

async function persistWorkspace(projectPath: string, data: WorkspaceData) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_workspace", { projectPath, workspace: buildPayload(data) });
  } catch {
    // browser dev mode — silent
  }
}

function schedSave(getState: () => WorkspaceState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = getState();
    if (!s.projectPath) return;
    persistWorkspace(s.projectPath, s);
  }, 500);
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...defaultWorkspace(),
  projectPath: null,

  loadWorkspace: async (newProjectPath) => {
    const current = get();

    // Flush any pending debounce save for the *current* project before switching,
    // so its state is not lost or written to the wrong project.
    if (saveTimer && current.projectPath && current.projectPath !== newProjectPath) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await persistWorkspace(current.projectPath, current);
    }

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
      }>("load_workspace", { projectPath: newProjectPath });
      set({
        projectPath: newProjectPath,
        sidebarOpen: ws.sidebar_open,
        sidebarWidth: ws.sidebar_width,
        memoOpen: ws.memo_open,
        memoWidth: ws.memo_width,
        termAutoClaude: ws.term_auto_claude,
        termYoloMode: ws.term_yolo_mode,
        terminalOpen: ws.terminal_open,
      });
    } catch {
      set({ projectPath: newProjectPath, ...defaultWorkspace() });
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

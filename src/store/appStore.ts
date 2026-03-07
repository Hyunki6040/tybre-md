import { create } from "zustand";

export interface Tab {
  id: string;
  filePath: string | null;
  projectPath: string | null;
  title: string;
  content: string;
  isDirty: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

// Theme is exported here so existing imports keep working;
// settingsStore is the runtime owner of this value.
export type Theme = "paper" | "ink" | "system";
interface AppState {
  tabs: Tab[];
  activeTabId: string | null;
  closedTabs: Tab[]; // Cmd+Shift+T restore stack (max 10)
  groupOrder: string[]; // MRU order of group keys (projectPath | "__none__")

  fileTree: FileEntry | null; // shared for QuickOpen access
  recentDirs: string[];       // recently opened directories (max 8)

  quickOpenVisible: boolean;
  settingsVisible: boolean;
  findBarVisible: boolean;
  projectSearchVisible: boolean;
  exportVisible: boolean;

  addTab: (tab: Tab) => void;
  closeTab: (tabId: string) => void;
  restoreLastTab: () => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  markTabSaved: (tabId: string) => void;

  setFileTree: (tree: FileEntry | null) => void;
  addRecentDir: (path: string) => void;
  setQuickOpenVisible: (visible: boolean) => void;
  setSettingsVisible: (visible: boolean) => void;
  setFindBarVisible: (visible: boolean) => void;
  setProjectSearchVisible: (visible: boolean) => void;
  setExportVisible: (visible: boolean) => void;

  newFileRequestedAt: number;
  projectLastTab: Record<string, string>;
  requestNewFile: () => void;
  setProjectLastTab: (projectPath: string, filePath: string) => void;

  pendingTerminalCommand: string | null;
  setPendingTerminalCommand: (cmd: string | null) => void;
}

let tabCounter = 0;

function generateTabId(): string {
  return `tab-${++tabCounter}`;
}

export const useAppStore = create<AppState>((set) => ({
  tabs: [
    {
      id: generateTabId(),
      filePath: null,
      projectPath: null,
      title: "Untitled",
      content: "# Welcome to Tybre.md\n\nStart typing your markdown here...\n\nThis is a **WYSIWYG** markdown editor. Try:\n- `## Heading` — cursor inside reveals the `##` prefix\n- `**bold**` — cursor reveals the `**` markers\n- `*italic*` — same syntax-reveal behavior\n",
      isDirty: false,
    },
  ],
  activeTabId: null,
  closedTabs: [],
  groupOrder: [],

  fileTree: null,
  recentDirs: JSON.parse(localStorage.getItem("tybre:recentDirs") ?? "[]"),

  quickOpenVisible: false,
  settingsVisible: false,
  findBarVisible: false,
  projectSearchVisible: false,
  exportVisible: false,

  newFileRequestedAt: 0,
  projectLastTab: JSON.parse(localStorage.getItem("tybre:projectLastTab") ?? "{}"),

  addTab: (tab) => {
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
  },

  closeTab: (tabId) => {
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === tabId);
      const closing = state.tabs[idx];
      const newTabs = state.tabs.filter((t) => t.id !== tabId);
      let newActiveId = state.activeTabId;

      if (state.activeTabId === tabId) {
        newActiveId = newTabs.length > 0 ? newTabs[Math.max(0, idx - 1)].id : null;
      }

      // Push to closed stack (max 10)
      const newClosed = closing
        ? [closing, ...state.closedTabs].slice(0, 10)
        : state.closedTabs;

      return { tabs: newTabs, activeTabId: newActiveId, closedTabs: newClosed };
    });
  },

  restoreLastTab: () => {
    set((state) => {
      if (state.closedTabs.length === 0) return state;
      const [last, ...rest] = state.closedTabs;
      // Give it a fresh ID to avoid collision
      const restored = { ...last, id: `tab-${Date.now()}` };
      return {
        tabs: [...state.tabs, restored],
        activeTabId: restored.id,
        closedTabs: rest,
      };
    });
  },

  setActiveTab: (tabId) => {
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      const key = tab?.projectPath ?? "__none__";
      const order = [key, ...state.groupOrder.filter((k) => k !== key)];
      return { activeTabId: tabId, groupOrder: order };
    });
  },

  updateTabContent: (tabId, content) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, content, isDirty: true } : t
      ),
    }));
  },

  markTabSaved: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isDirty: false } : t
      ),
    }));
  },

  setFileTree: (tree) => {
    set({ fileTree: tree });
  },

  addRecentDir: (path) => {
    set((state) => {
      const next = [path, ...state.recentDirs.filter((d) => d !== path)].slice(0, 8);
      localStorage.setItem("tybre:recentDirs", JSON.stringify(next));
      return { recentDirs: next };
    });
  },

  setQuickOpenVisible: (visible) => {
    set({ quickOpenVisible: visible });
  },

  setSettingsVisible: (visible) => {
    set({ settingsVisible: visible });
  },

  setFindBarVisible: (visible) => { set({ findBarVisible: visible }); },
  setProjectSearchVisible: (visible) => { set({ projectSearchVisible: visible }); },
  setExportVisible: (visible) => { set({ exportVisible: visible }); },

  requestNewFile: () => set((s) => ({ newFileRequestedAt: s.newFileRequestedAt + 1 })),

  setProjectLastTab: (projectPath, filePath) =>
    set((state) => {
      const next = { ...state.projectLastTab, [projectPath]: filePath };
      localStorage.setItem("tybre:projectLastTab", JSON.stringify(next)); // fallback
      return { projectLastTab: next };
    }),

  pendingTerminalCommand: null,
  setPendingTerminalCommand: (cmd) => set({ pendingTerminalCommand: cmd }),
}));

// Initialize active tab
const { tabs } = useAppStore.getState();
if (tabs.length > 0) {
  useAppStore.setState({ activeTabId: tabs[0].id });
}

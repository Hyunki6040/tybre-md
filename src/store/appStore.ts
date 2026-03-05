import { create } from "zustand";

export interface Tab {
  id: string;
  filePath: string | null;
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

export type Theme = "paper" | "ink" | "system";
export type View = "editor" | "terminal";

interface AppState {
  tabs: Tab[];
  activeTabId: string | null;
  closedTabs: Tab[]; // Cmd+Shift+T restore stack (max 10)

  sidebarVisible: boolean;
  sidebarWidth: number;
  fileTree: FileEntry | null; // shared for QuickOpen access

  theme: Theme;
  resolvedTheme: "paper" | "ink";

  view: View;
  quickOpenVisible: boolean;

  addTab: (tab: Tab) => void;
  closeTab: (tabId: string) => void;
  restoreLastTab: () => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  markTabSaved: (tabId: string) => void;

  toggleSidebar: () => void;
  setFileTree: (tree: FileEntry | null) => void;
  setTheme: (theme: Theme) => void;
  setResolvedTheme: (theme: "paper" | "ink") => void;
  toggleView: () => void;
  setQuickOpenVisible: (visible: boolean) => void;
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
      title: "Untitled",
      content: "# Welcome to Tybre.md\n\nStart typing your markdown here...\n\nThis is a **WYSIWYG** markdown editor. Try:\n- `## Heading` — cursor inside reveals the `##` prefix\n- `**bold**` — cursor reveals the `**` markers\n- `*italic*` — same syntax-reveal behavior\n",
      isDirty: false,
    },
  ],
  activeTabId: null,
  closedTabs: [],

  sidebarVisible: true,
  sidebarWidth: 240,
  fileTree: null,

  theme: "system",
  resolvedTheme: "paper",

  view: "editor",
  quickOpenVisible: false,

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
    set({ activeTabId: tabId });
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

  toggleSidebar: () => {
    set((state) => ({ sidebarVisible: !state.sidebarVisible }));
  },

  setFileTree: (tree) => {
    set({ fileTree: tree });
  },

  setTheme: (theme) => {
    set({ theme });
  },

  setResolvedTheme: (resolvedTheme) => {
    const root = document.documentElement;
    if (resolvedTheme === "ink") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.add("light");
      root.classList.remove("dark");
    }
    set({ resolvedTheme });
  },

  toggleView: () => {
    set((state) => ({
      view: state.view === "editor" ? "terminal" : "editor",
    }));
  },

  setQuickOpenVisible: (visible) => {
    set({ quickOpenVisible: visible });
  },
}));

// Initialize active tab
const { tabs } = useAppStore.getState();
if (tabs.length > 0) {
  useAppStore.setState({ activeTabId: tabs[0].id });
}

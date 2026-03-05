import { create } from "zustand";

export interface Tab {
  id: string;
  filePath: string | null;
  title: string;
  content: string;
  isDirty: boolean;
}

export type Theme = "paper" | "ink" | "system";
export type View = "editor" | "terminal";

interface AppState {
  // Tabs
  tabs: Tab[];
  activeTabId: string | null;

  // Sidebar
  sidebarVisible: boolean;
  sidebarWidth: number;

  // Theme
  theme: Theme;
  resolvedTheme: "paper" | "ink";

  // View
  view: View;

  // Quick open
  quickOpenVisible: boolean;

  // Actions
  addTab: (tab: Tab) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  markTabSaved: (tabId: string) => void;

  toggleSidebar: () => void;
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
  // Initial state
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

  sidebarVisible: true,
  sidebarWidth: 240,

  theme: "system",
  resolvedTheme: "paper",

  view: "editor",

  quickOpenVisible: false,

  // Tab actions
  addTab: (tab) => {
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
  },

  closeTab: (tabId) => {
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === tabId);
      const newTabs = state.tabs.filter((t) => t.id !== tabId);
      let newActiveId = state.activeTabId;

      if (state.activeTabId === tabId) {
        if (newTabs.length > 0) {
          // Activate previous tab or next if at start
          newActiveId = newTabs[Math.max(0, idx - 1)].id;
        } else {
          newActiveId = null;
        }
      }

      return { tabs: newTabs, activeTabId: newActiveId };
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

  // Sidebar
  toggleSidebar: () => {
    set((state) => ({ sidebarVisible: !state.sidebarVisible }));
  },

  // Theme
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

  // View toggle (editor ↔ terminal)
  toggleView: () => {
    set((state) => ({
      view: state.view === "editor" ? "terminal" : "editor",
    }));
  },

  // Quick open
  setQuickOpenVisible: (visible) => {
    set({ quickOpenVisible: visible });
  },
}));

// Initialize active tab
const { tabs } = useAppStore.getState();
if (tabs.length > 0) {
  useAppStore.setState({ activeTabId: tabs[0].id });
}

import { useAppStore, Tab } from "../store/appStore";

export function TabBar() {
  const { tabs, activeTabId, closeTab, setActiveTab, addTab } = useAppStore();

  function handleNewTab() {
    const id = `tab-${Date.now()}`;
    addTab({
      id,
      filePath: null,
      title: "Untitled",
      content: "",
      isDirty: false,
    });
  }

  function handleCloseTab(e: React.MouseEvent, tabId: string) {
    e.stopPropagation();
    closeTab(tabId);
  }

  function handleMiddleClick(e: React.MouseEvent, tabId: string) {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(tabId);
    }
  }

  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onClick={() => setActiveTab(tab.id)}
          onClose={(e) => handleCloseTab(e, tab.id)}
          onMiddleClick={(e) => handleMiddleClick(e, tab.id)}
        />
      ))}
      <button
        className="tab-new-btn"
        onClick={handleNewTab}
        title="New Tab (⌘T)"
        aria-label="New tab"
      >
        +
      </button>
    </div>
  );
}

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
  onMiddleClick: (e: React.MouseEvent) => void;
}

function TabItem({ tab, isActive, onClick, onClose, onMiddleClick }: TabItemProps) {
  return (
    <div
      className={`tab-item ${isActive ? "tab-item--active" : ""} ${tab.isDirty ? "tab-item--dirty" : ""}`}
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      onAuxClick={onMiddleClick}
      title={tab.filePath ?? tab.title}
    >
      {tab.isDirty && <span className="tab-dirty-indicator" aria-label="Unsaved changes">●</span>}
      <span className="tab-title">{tab.title}</span>
      <button
        className="tab-close-btn"
        onClick={onClose}
        aria-label={`Close ${tab.title}`}
        title="Close tab"
      >
        ×
      </button>
    </div>
  );
}

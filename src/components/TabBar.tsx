import { Plus, X } from "lucide-react";
import { useAppStore, type Tab } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function TabBar() {
  const { tabs, activeTabId, closeTab, setActiveTab, addTab } = useAppStore();

  function handleNewTab() {
    addTab({
      id: `tab-${Date.now()}`,
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
    /* spec: tabbar height 36px */
    <div className="flex h-[36px] items-stretch border-b border-border bg-muted">
      <ScrollArea className="flex-1">
        <div className="flex h-[36px] items-stretch" role="tablist">
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
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="mx-1 my-auto shrink-0 text-muted-foreground hover:text-foreground"
            onClick={handleNewTab}
            aria-label="New tab"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          New Tab <kbd className="ml-1 rounded bg-muted px-1 text-[10px]">⌘T</kbd>
        </TooltipContent>
      </Tooltip>
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
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      onAuxClick={onMiddleClick}
      title={tab.filePath ?? tab.title}
      className={cn(
        "group relative flex h-full min-w-[80px] max-w-[200px] cursor-pointer items-center gap-1.5 border-r border-border px-3 text-sm transition-colors select-none",
        isActive
          ? "bg-background text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-primary"
          : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
      )}
    >
      {/* Dirty indicator: amber per spec, not primary blue */}
      {tab.isDirty && (
        <span
          className="shrink-0 text-[10px] text-warning"
          aria-label="Unsaved changes"
        >
          ●
        </span>
      )}
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {tab.title}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(
          "h-5 w-5 shrink-0 rounded p-0 text-muted-foreground opacity-0 transition-opacity hover:bg-border hover:text-foreground group-hover:opacity-100",
          isActive && "opacity-100"
        )}
        onClick={onClose}
        aria-label={`Close ${tab.title}`}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

import { useState, useRef, useEffect, useMemo } from "react";
import { Plus, X, PanelLeft, Keyboard, ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { useAppStore, type Tab } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// ── All tracked shortcuts ─────────────────────────────────────────────────────
const ALL_SHORTCUTS = [
  { id: "new-tab",        key: "⌘T",    label: "새 탭" },
  { id: "close-tab",      key: "⌘W",    label: "탭 닫기" },
  { id: "restore-tab",    key: "⌘⇧T",  label: "닫힌 탭 복원" },
  { id: "tab-switch",     key: "⌘1–9", label: "탭 번호 이동" },
  { id: "save",           key: "⌘S",    label: "저장" },
  { id: "quick-open",     key: "⌘P",    label: "빠른 열기" },
  { id: "sidebar",        key: "⌘\\",  label: "사이드바 토글" },
  { id: "terminal",       key: "⌘`",    label: "터미널 전환" },
  { id: "settings",       key: "⌘,",    label: "설정" },
  { id: "undo",           key: "⌘Z",    label: "실행 취소" },
  { id: "project-search", key: "⌘⇧F",  label: "전체 검색" },
  { id: "export",         key: "⌘E",    label: "내보내기" },
  { id: "slash",          key: "/",       label: "슬래시 명령" },
  { id: "new-file",          key: "⌘N",      label: "새 파일 만들기" },
  { id: "find",              key: "⌘F",      label: "찾기" },
  { id: "new-window",        key: "⌘⇧N",     label: "새 창 열기" },
  { id: "open-folder",       key: "⌘⇧O",     label: "폴더 열기" },
  { id: "term-prev-session", key: "Ctrl+[",  label: "이전 터미널 세션" },
  { id: "term-next-session", key: "Ctrl+]",  label: "다음 터미널 세션" },
  { id: "term-queue",        key: "Ctrl+⇧L", label: "프롬프트 대기열" },
];

// ── Signal bars (4-bar cellular style) ───────────────────────────────────────
function SignalBars({ level }: { level: 0 | 1 | 2 | 3 | 4 }) {
  const color =
    level >= 4 ? "bg-emerald-500"
    : level >= 3 ? "bg-primary"
    : level >= 2 ? "bg-primary/70"
    : "bg-primary/50";

  return (
    <div className="flex items-end gap-[2px]" aria-hidden>
      {[4, 6, 9, 12].map((h, i) => (
        <div
          key={i}
          style={{ height: `${h}px`, width: "3px" }}
          className={cn(
            "rounded-sm transition-all duration-500",
            i < level ? color : "bg-muted-foreground/20"
          )}
        />
      ))}
    </div>
  );
}

function skillLevel(used: Record<string, number>, mouse: number): 0 | 1 | 2 | 3 | 4 {
  const totalUsed = Object.values(used).reduce((a, b) => a + b, 0);
  const total = totalUsed + mouse;
  if (total === 0) return 0;
  const ratio = totalUsed / total;
  if (ratio >= 0.8) return 4;
  if (ratio >= 0.6) return 3;
  if (ratio >= 0.35) return 2;
  if (ratio >= 0.15) return 1;
  return 0;
}

// ── Guide hint toast ──────────────────────────────────────────────────────────
function GuideHintToast() {
  const { guideHint, clearGuideHint } = useAppStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!guideHint) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(clearGuideHint, 2800);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [guideHint, clearGuideHint]);

  return (
    <div
      className={cn(
        "fixed right-3 top-[44px] z-50 flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 shadow-md",
        "transition-all duration-200 pointer-events-none",
        guideHint ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
      )}
    >
      <kbd className="min-w-[36px] rounded bg-muted px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold text-foreground">
        {guideHint?.shortcut}
      </kbd>
      <span className="text-[12px] text-muted-foreground">{guideHint?.label}</span>
    </div>
  );
}

// ── Guide hover panel ─────────────────────────────────────────────────────────
function GuidePanel({
  open,
  onMouseEnter,
  onMouseLeave,
  shortcutUsed,
}: {
  open: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  shortcutUsed: Record<string, number>;
}) {
  const [usedExpanded, setUsedExpanded] = useState(false);

  const unused = ALL_SHORTCUTS.filter((s) => !(shortcutUsed[s.id] > 0));
  const used   = ALL_SHORTCUTS.filter((s) =>   shortcutUsed[s.id] > 0);

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "fixed right-2 top-[44px] z-[200] w-56",
        "rounded-lg border border-border bg-background shadow-xl",
        "transition-all duration-150 origin-top-right",
        open
          ? "opacity-100 scale-100 pointer-events-auto"
          : "opacity-0 scale-95 pointer-events-none"
      )}
    >
      {/* Header */}
      <div className="border-b border-border px-3 py-2">
        <p className="text-[11px] font-semibold text-foreground">단축키 가이드</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          마우스 대신 키보드를 사용해보세요
        </p>
      </div>

      <ScrollArea className="max-h-[320px]">
        {/* Unused shortcuts — active, shown at top */}
        <div className="py-1">
          {unused.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              모든 단축키를 사용해봤어요 🎉
            </p>
          )}
          {unused.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between px-3 py-1.5 hover:bg-accent/50 transition-colors"
            >
              <span className="text-[12px] text-foreground">{s.label}</span>
              <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>

        {/* Used shortcuts — gray, collapsed */}
        {used.length > 0 && (
          <div className="border-t border-border">
            <button
              onClick={() => setUsedExpanded((v) => !v)}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left transition-colors hover:bg-accent/30"
            >
              {usedExpanded
                ? <ChevronDown className="h-3 w-3 text-muted-foreground/60" />
                : <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
              }
              <span className="text-[10px] text-muted-foreground/60">
                이미 써본 단축키 ({used.length})
              </span>
            </button>
            {usedExpanded && (
              <div className="pb-1">
                {used.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between px-3 py-1.5"
                  >
                    <span className="text-[12px] text-muted-foreground/50">{s.label}</span>
                    <kbd className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground/50">
                      {s.key}
                    </kbd>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ── Group types & helpers ─────────────────────────────────────────────────────
interface TabGroup {
  key: string;
  projectName: string;
  projectPath: string | null;
  tabs: Tab[];
}

function computeGroups(tabs: Tab[], groupOrder: string[]): TabGroup[] {
  const groupMap = new Map<string, Tab[]>();
  for (const tab of tabs) {
    const key = tab.projectPath ?? "__none__";
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(tab);
  }

  const keys = [...groupMap.keys()];
  keys.sort((a, b) => {
    if (a === "__none__") return 1;
    if (b === "__none__") return -1;
    const ai = groupOrder.indexOf(a);
    const bi = groupOrder.indexOf(b);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return keys.map((key) => ({
    key,
    projectName: key === "__none__" ? "Untitled" : (key.split("/").pop() ?? key),
    projectPath: key === "__none__" ? null : key,
    tabs: groupMap.get(key)!,
  }));
}

// Group color hues (blue, violet, emerald, amber, rose)
const GROUP_HUES = [210, 262, 152, 38, 355];

// Layout constants
const GROUP_HEADER_PX = 88;
const TAB_MIN_PX = 72;
const TAB_MAX_PX = 160;
const TOOLS_BASE_PX = 112; // New Tab + Guide + Sidebar buttons
const OVERFLOW_BTN_PX = 40;

// ── TabBar ────────────────────────────────────────────────────────────────────
export function TabBar() {
  const {
    tabs, activeTabId, closeTab, setActiveTab, addTab, toggleSidebar, fileTree,
    sidebarVisible, guideMode, toggleGuideMode, shortcutStats, recordMouseAction,
    groupOrder, projectLastTab, setProjectLastTab,
  } = useAppStore();

  const [guidePanelOpen, setGuidePanelOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Overflow dropdown
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Container width measurement
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

  // Group expanded state — initially expand the active tab's group
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    return new Set([activeTab?.projectPath ?? "__none__"]);
  });

  const level = skillLevel(shortcutStats.used ?? {}, shortcutStats.mouse);

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerWidth(el.offsetWidth);
    });
    ro.observe(el);
    setContainerWidth(el.offsetWidth);
    return () => ro.disconnect();
  }, []);

  // Auto-expand only the active tab's group, collapse all others
  useEffect(() => {
    if (!activeTabId) return;
    const tab = tabs.find((t) => t.id === activeTabId);
    const key = tab?.projectPath ?? "__none__";
    setExpandedGroups((prev) => {
      if (prev.size === 1 && prev.has(key)) return prev;
      return new Set([key]);
    });
  }, [activeTabId, tabs]);

  // Close overflow dropdown on outside click
  useEffect(() => {
    if (!overflowOpen) return;
    function onDown(e: MouseEvent) {
      if (!overflowRef.current?.contains(e.target as Node)) setOverflowOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [overflowOpen]);

  // Computed groups
  const groups = useMemo(() => computeGroups(tabs, groupOrder), [tabs, groupOrder]);
  const showHeaders = groups.length > 1;

  // Layout calculation (two-pass to handle overflow button appearing)
  const fixedHeadersPx = showHeaders ? groups.length * GROUP_HEADER_PX : 0;
  const allExpandedTabs = groups.flatMap((g) =>
    expandedGroups.has(g.key) ? g.tabs : []
  );
  const totalTabCount = allExpandedTabs.length;

  // Pass 1: check if overflow exists without overflow button
  const avail1 = Math.max(0, containerWidth - TOOLS_BASE_PX - fixedHeadersPx);
  const fit1 = Math.floor(avail1 / TAB_MIN_PX);
  const hasOverflow = totalTabCount > fit1;

  // Pass 2: recalculate with overflow button reserved if needed
  const toolsPx = TOOLS_BASE_PX + (hasOverflow ? OVERFLOW_BTN_PX : 0);
  const available = Math.max(0, containerWidth - toolsPx - fixedHeadersPx);
  const fittingCount = Math.floor(available / TAB_MIN_PX);
  const tabMaxWidth = totalTabCount > 0
    ? Math.min(TAB_MAX_PX, Math.max(TAB_MIN_PX, available / totalTabCount))
    : TAB_MAX_PX;

  const overflowTabs = allExpandedTabs.slice(fittingCount);
  const overflowTabIds = new Set(overflowTabs.map((t) => t.id));

  function openPanel() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setGuidePanelOpen(true);
  }
  function closePanel() {
    closeTimerRef.current = setTimeout(() => setGuidePanelOpen(false), 180);
  }

  function handleNewTab() {
    if (guideMode) recordMouseAction("⌘T", "새 탭");
    addTab({
      id: `tab-${Date.now()}`,
      filePath: null,
      projectPath: fileTree?.path ?? null,
      title: "Untitled",
      content: "",
      isDirty: false,
    });
  }

  function handleToggleSidebar() {
    if (guideMode) recordMouseAction("⌘\\", "사이드바 토글");
    toggleSidebar();
  }

  function handleTabClick(tab: Tab) {
    if (tab.filePath) setProjectLastTab(tab.projectPath ?? "__none__", tab.filePath);
    setActiveTab(tab.id);
  }

  function handleCloseTab(e: React.MouseEvent, tabId: string) {
    e.stopPropagation();
    if (guideMode) recordMouseAction("⌘W", "탭 닫기");
    closeTab(tabId);
  }

  function handleMiddleClick(e: React.MouseEvent, tabId: string) {
    if (e.button === 1) { e.preventDefault(); closeTab(tabId); }
  }

  function toggleGroup(key: string) {
    const isExpanded = expandedGroups.has(key);
    if (isExpanded) {
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    } else {
      // Activate last used tab in this group
      const group = groups.find((g) => g.key === key);
      const lastFilePath = projectLastTab[key];
      const target =
        (lastFilePath && group?.tabs.find((t) => t.filePath === lastFilePath)) ??
        group?.tabs[group.tabs.length - 1];
      if (target) setActiveTab(target.id);
      // Collapse all others, expand only this group
      setExpandedGroups(new Set([key]));
    }
  }

  const skillLabels = ["단축키 입문자", "조금 활용 중", "절반은 활용!", "능숙한 편", "단축키 마스터"];

  return (
    <>
      <div
        ref={containerRef}
        className="flex h-[36px] items-stretch border-b border-border bg-muted overflow-hidden"
      >
        {/* Groups + tabs area */}
        <div className="flex flex-1 items-stretch overflow-hidden min-w-0">
          {groups.map((group, groupIdx) => {
            const isExpanded = expandedGroups.has(group.key);
            const hue = GROUP_HUES[groupIdx % GROUP_HUES.length];
            const groupVisibleTabs = isExpanded
              ? group.tabs.filter((t) => !overflowTabIds.has(t.id))
              : [];

            return (
              <div key={group.key} className="flex items-stretch shrink-0">
                {/* Group header — only when multiple groups exist */}
                {showHeaders && (
                  <button
                    onClick={() => toggleGroup(group.key)}
                    title={group.projectPath ?? "Untitled"}
                    style={{
                      maxWidth: GROUP_HEADER_PX,
                      background: isExpanded
                        ? `hsl(${hue} 60% 50% / 0.18)`
                        : `hsl(${hue} 60% 50% / 0.07)`,
                      borderRight: `2px solid hsl(${hue} 60% 50% / ${isExpanded ? "0.5" : "0.2"})`,
                    }}
                    className={cn(
                      "flex items-center gap-1 px-2 shrink-0 select-none transition-all",
                      "text-[11px] font-semibold hover:brightness-110"
                    )}
                  >
                    {isExpanded
                      ? <ChevronRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                      : <ChevronLeft className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                    }
                    <span className="truncate text-foreground/70">{group.projectName}</span>
                  </button>
                )}

                {/* Visible tabs in this group */}
                {groupVisibleTabs.map((tab) => (
                  <TabItem
                    key={tab.id}
                    tab={tab}
                    isActive={tab.id === activeTabId}
                    maxWidth={Math.floor(tabMaxWidth)}
                    groupHue={showHeaders ? hue : undefined}
                    onClick={() => handleTabClick(tab)}
                    onClose={(e) => handleCloseTab(e, tab.id)}
                    onMiddleClick={(e) => handleMiddleClick(e, tab.id)}
                  />
                ))}
              </div>
            );
          })}
        </div>

        {/* Tools area */}
        <div className="flex items-center shrink-0">
          {/* Overflow dropdown */}
          {overflowTabs.length > 0 && (
            <div className="relative" ref={overflowRef}>
              <button
                onClick={() => setOverflowOpen((o) => !o)}
                title={`${overflowTabs.length}개 탭 더 보기`}
                className={cn(
                  "flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-mono font-medium shrink-0 transition-colors",
                  overflowOpen
                    ? "bg-background/80 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/60"
                )}
              >
                <MoreHorizontal className="h-3 w-3" />
                <span>{overflowTabs.length}</span>
              </button>

              {overflowOpen && (
                <div className="absolute right-0 top-full z-50 mt-0.5 w-52 rounded-md border border-border bg-popover shadow-lg overflow-hidden">
                  {overflowTabs.map((tab) => (
                    <button
                      key={tab.id}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors hover:bg-accent",
                        tab.id === activeTabId && "bg-accent/50 text-foreground"
                      )}
                      onClick={() => {
                        handleTabClick(tab);
                        setOverflowOpen(false);
                      }}
                    >
                      {tab.isDirty && (
                        <span className="text-[10px] text-warning shrink-0">●</span>
                      )}
                      <span className="flex-1 truncate">{tab.title}</span>
                      {showHeaders && tab.projectPath && (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {tab.projectPath.split("/").pop()}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* New Tab */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost" size="icon-sm"
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

          {/* Guide Mode */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleGuideMode}
                onMouseEnter={() => { if (guideMode) openPanel(); }}
                onMouseLeave={closePanel}
                aria-label={guideMode ? "단축키 가이드 켜짐" : "단축키 가이드 꺼짐"}
                className={cn(
                  "mx-0.5 my-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 transition-colors",
                  guideMode
                    ? "text-primary hover:text-primary/80"
                    : "text-muted-foreground/40 hover:text-muted-foreground"
                )}
              >
                <Keyboard className="h-3.5 w-3.5" />
                {guideMode && <SignalBars level={level} />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[200px] text-center">
              {guideMode ? (
                <>
                  <div className="font-medium">단축키 가이드 ON</div>
                  <div className="text-[11px] text-muted-foreground">{skillLabels[level]}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground/70">hover → 단축키 목록 / click → 끄기</div>
                </>
              ) : (
                <>
                  <div className="font-medium">단축키 가이드</div>
                  <div className="text-[11px] text-muted-foreground">click → 켜기</div>
                </>
              )}
            </TooltipContent>
          </Tooltip>

          {/* Sidebar Toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost" size="icon-sm"
                className={cn(
                  "mr-1 my-auto shrink-0 transition-colors",
                  sidebarVisible ? "text-primary hover:text-primary/80" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={handleToggleSidebar}
                aria-label="Toggle sidebar"
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Sidebar <kbd className="ml-1 rounded bg-muted px-1 text-[10px]">⌘\</kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Guide panel (hover) */}
      <GuidePanel
        open={guidePanelOpen}
        onMouseEnter={openPanel}
        onMouseLeave={closePanel}
        shortcutUsed={shortcutStats.used ?? {}}
      />

      {/* Guide hint toast */}
      <GuideHintToast />
    </>
  );
}

// ── Tab item ──────────────────────────────────────────────────────────────────
interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  maxWidth: number;
  groupHue?: number;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
  onMiddleClick: (e: React.MouseEvent) => void;
}

function TabItem({ tab, isActive, maxWidth, groupHue, onClick, onClose, onMiddleClick }: TabItemProps) {
  const activeStyle = isActive && groupHue !== undefined
    ? {
        background: `hsl(${groupHue} 60% 50% / 0.13)`,
        borderTop: `2px solid hsl(${groupHue} 60% 50% / 0.8)`,
      }
    : isActive
    ? { borderTop: "2px solid hsl(var(--primary))" }
    : {};

  return (
    <div
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      onAuxClick={onMiddleClick}
      title={tab.filePath ?? tab.title}
      style={{ maxWidth, ...activeStyle }}
      className={cn(
        "group relative flex h-full min-w-[72px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 text-sm transition-all select-none",
        isActive
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground/70 hover:bg-background/50 hover:text-foreground"
      )}
    >
      {tab.isDirty && (
        <span className="shrink-0 text-[10px] text-warning" aria-label="Unsaved changes">●</span>
      )}
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{tab.title}</span>
      <Button
        variant="ghost" size="icon-sm"
        className={cn(
          "h-5 w-5 shrink-0 rounded p-0 text-muted-foreground opacity-0 transition-opacity hover:bg-border hover:text-foreground group-hover:opacity-100",
          isActive && "opacity-60 hover:opacity-100"
        )}
        onClick={onClose}
        aria-label={`Close ${tab.title}`}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

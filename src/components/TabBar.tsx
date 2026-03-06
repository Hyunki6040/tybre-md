import { useState, useRef, useEffect } from "react";
import { Plus, X, PanelLeft, Keyboard, ChevronDown, ChevronRight } from "lucide-react";
import { useAppStore, type Tab } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
    </div>
  );
}

// ── TabBar ────────────────────────────────────────────────────────────────────
export function TabBar() {
  const {
    tabs, activeTabId, closeTab, setActiveTab, addTab, toggleSidebar,
    sidebarVisible, guideMode, toggleGuideMode, shortcutStats, recordMouseAction,
  } = useAppStore();

  const [guidePanelOpen, setGuidePanelOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const level = skillLevel(shortcutStats.used ?? {}, shortcutStats.mouse);

  function openPanel() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setGuidePanelOpen(true);
  }
  function closePanel() {
    closeTimerRef.current = setTimeout(() => setGuidePanelOpen(false), 180);
  }

  function handleNewTab() {
    if (guideMode) recordMouseAction("⌘T", "새 탭");
    addTab({ id: `tab-${Date.now()}`, filePath: null, title: "Untitled", content: "", isDirty: false });
  }

  function handleToggleSidebar() {
    if (guideMode) recordMouseAction("⌘\\", "사이드바 토글");
    toggleSidebar();
  }

  function handleCloseTab(e: React.MouseEvent, tabId: string) {
    e.stopPropagation();
    if (guideMode) recordMouseAction("⌘W", "탭 닫기");
    closeTab(tabId);
  }

  function handleMiddleClick(e: React.MouseEvent, tabId: string) {
    if (e.button === 1) { e.preventDefault(); closeTab(tabId); }
  }

  const skillLabels = ["단축키 입문자", "조금 활용 중", "절반은 활용!", "능숙한 편", "단축키 마스터"];

  return (
    <>
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

        {/* Guide Mode — hover shows panel, click toggles on/off */}
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
      {tab.isDirty && (
        <span className="shrink-0 text-[10px] text-warning" aria-label="Unsaved changes">●</span>
      )}
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{tab.title}</span>
      <Button
        variant="ghost" size="icon-sm"
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

import { useMemo } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface StatusBarProps {
  content: string;
  className?: string;
}

export function StatusBar({ content, className }: StatusBarProps) {
  const stats = useMemo(() => {
    const text = content
      .replace(/^#+\s/gm, "") // strip heading markers
      .replace(/\*\*|__|\*|_|~~|`/g, "") // strip inline markers
      .trim();

    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const chars = text.length;

    return { words, chars };
  }, [content]);

  return (
    <div
      className={cn(
        "flex h-[24px] shrink-0 items-center border-t border-border bg-background px-4",
        "text-[11px] select-none",
        className
      )}
      style={{ color: "var(--status-text)" }}
    >
      <span>
        words: {stats.words.toLocaleString()}
        {" · "}
        chars: {stats.chars.toLocaleString()}
      </span>

      <span className="flex-1" />

      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex cursor-default items-center gap-1 opacity-30 hover:opacity-70 transition-opacity">
            <TerminalIcon size={10} />
            <span>term</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="end" className="max-w-[200px]">
          <p className="font-semibold mb-1.5">터미널 단축키</p>
          <div className="space-y-0.5">
            <div>⌘` — 터미널 열기/닫기</div>
            <div>Ctrl+] / Ctrl+[ — 세션 이동</div>
            <div>Ctrl+⇧Q — 대기열 패널</div>
            <div>더블클릭 탭 — 이름 변경</div>
            <div>+ — 새 세션</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

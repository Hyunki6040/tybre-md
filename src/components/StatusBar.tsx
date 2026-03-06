import { useMemo, useState, useEffect } from "react";
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
  onToggleTerminal?: () => void;
}

export function StatusBar({ content, className, onToggleTerminal }: StatusBarProps) {
  const stats = useMemo(() => {
    const text = content
      .replace(/^#+\s/gm, "") // strip heading markers
      .replace(/\*\*|__|\*|_|~~|`/g, "") // strip inline markers
      .trim();

    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const chars = text.length;

    return { words, chars };
  }, [content]);

  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const onOnline  = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

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

      {!isOnline && (
        <span className="flex items-center gap-1 text-[10px] text-amber-500/80 mr-2 select-none">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500/80 shrink-0" />
          offline
        </span>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onToggleTerminal}
            className="flex items-center gap-1 opacity-30 hover:opacity-70 transition-opacity select-none cursor-pointer"
          >
            <TerminalIcon size={10} />
            <span>term</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="end">
          <span>⌘` — 터미널 열기/닫기</span>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

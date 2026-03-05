import { useMemo } from "react";
import { cn } from "@/lib/utils";

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
    </div>
  );
}

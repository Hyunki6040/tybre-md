/**
 * TerminalView — xterm.js terminal backed by portable-pty (Tauri).
 *
 * Features:
 *  - Paper / Ink theme-aware colors
 *  - Auto-cd when project folder changes
 *  - Optional auto-launch of Claude Code (persisted setting)
 *  - Shell exit detection with one-keypress restart
 *  - Settings toolbar in the header
 */

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Settings2, Check } from "lucide-react";
import { useAppStore } from "@/store/appStore";

// ── Terminal color palettes ──────────────────────────────────────────────────

const TERM_THEME_INK = {
  background: "#1C1C1E",
  foreground: "#D4D4D6",
  cursor: "#6BA3D6",
  cursorAccent: "#1C1C1E",
  selectionBackground: "rgba(107,163,214,0.25)",
  black: "#3C3C3E",
  red: "#FF6B6B",
  green: "#86D9A0",
  yellow: "#E5C07B",
  blue: "#6BA3D6",
  magenta: "#C678DD",
  cyan: "#56B6C2",
  white: "#AEAEB2",
  brightBlack: "#636366",
  brightRed: "#FF8888",
  brightGreen: "#98D9B8",
  brightYellow: "#F0D080",
  brightBlue: "#80B8E8",
  brightMagenta: "#D090E0",
  brightCyan: "#70C8D4",
  brightWhite: "#E4E4E4",
};

const TERM_THEME_PAPER = {
  background: "#FAFAF8",
  foreground: "#2C2C2E",
  cursor: "#4A7FBF",
  cursorAccent: "#FAFAF8",
  selectionBackground: "rgba(74,127,191,0.2)",
  black: "#2C2C2E",
  red: "#BE0000",
  green: "#1A7100",
  yellow: "#956800",
  blue: "#2157A3",
  magenta: "#7B2CA6",
  cyan: "#007070",
  white: "#666770",
  brightBlack: "#909090",
  brightRed: "#D73A49",
  brightGreen: "#22863A",
  brightYellow: "#B08800",
  brightBlue: "#4A7FBF",
  brightMagenta: "#9E45AD",
  brightCyan: "#0E7490",
  brightWhite: "#FAFAF8",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** POSIX single-quote escape for safe shell path arguments. */
function shellQuote(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

function termFitDims(fit: FitAddon): { cols: number; rows: number } {
  const proposed = (fit as unknown as { proposeDimensions?: () => { cols: number; rows: number } | undefined }).proposeDimensions?.();
  return {
    cols: Number.isFinite(proposed?.cols) ? Math.max(2, proposed!.cols) : 80,
    rows: Number.isFinite(proposed?.rows) ? Math.max(1, proposed!.rows) : 24,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

interface TerminalViewProps {
  visible: boolean;
  projectPath: string | null;
}

export function TerminalView({ visible, projectPath }: TerminalViewProps) {
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);
  const unlistenDataRef = useRef<(() => void) | null>(null);
  const unlistenExitRef = useRef<(() => void) | null>(null);

  // Always-current projectPath (no stale closure in callbacks)
  const projectPathRef = useRef(projectPath);
  projectPathRef.current = projectPath;

  // Track previous project to detect changes
  const prevProjectRef = useRef<string | null>(null);

  // Auto-Claude setting
  const [autoClaude, setAutoClaude] = useState<boolean>(
    () => JSON.parse(localStorage.getItem("tybre:autoClaude") ?? "false")
  );
  const autoClaudeRef = useRef(autoClaude);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function sendText(text: string) {
    import("@tauri-apps/api/core").then(({ invoke }) => {
      const encoder = new TextEncoder();
      invoke("terminal_write", { data: Array.from(encoder.encode(text)) }).catch(() => {});
    });
  }

  function syncSize() {
    if (!fitRef.current) return;
    const { cols, rows } = termFitDims(fitRef.current);
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("terminal_resize", { cols, rows }).catch(() => {});
    });
  }

  function toggleAutoClaude() {
    const next = !autoClaude;
    autoClaudeRef.current = next;
    setAutoClaude(next);
    localStorage.setItem("tybre:autoClaude", JSON.stringify(next));
  }

  // ── Spawn PTY ────────────────────────────────────────────────────────────

  function spawnPty(term: Terminal, fit: FitAddon) {
    if (spawnedRef.current) return;
    spawnedRef.current = true;

    const { cols, rows } = termFitDims(fit);
    const cwd = projectPathRef.current ?? undefined;

    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("terminal_spawn", { cols, rows, cwd: cwd ?? null })
        .then(() => {
          // After shell initialises (~700ms), run claude if enabled
          if (cwd && autoClaudeRef.current) {
            setTimeout(() => sendText("claude\r"), 700);
          }
        })
        .catch((err: unknown) => {
          spawnedRef.current = false;
          term.writeln(`\r\n\x1b[31m[tybre] Failed to start terminal: ${String(err)}\x1b[0m`);
        });
    });
  }

  // ── xterm initialisation (once on mount) ────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const initialTheme = useAppStore.getState().resolvedTheme;
    const theme = initialTheme === "ink" ? TERM_THEME_INK : TERM_THEME_PAPER;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
      theme,
      allowTransparency: false,
      scrollback: 5000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Pipe keystrokes → PTY
    term.onData((data) => {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        const encoder = new TextEncoder();
        invoke("terminal_write", { data: Array.from(encoder.encode(data)) }).catch(() => {});
      });
    });

    spawnPty(term, fit);

    import("@tauri-apps/api/event").then(({ listen }) => {
      // PTY output → xterm
      listen<string>("terminal-data", (event) => {
        const binary = atob(event.payload);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        term.write(bytes);
      }).then((ul) => { unlistenDataRef.current = ul; });

      // PTY process exited → offer restart
      listen<void>("terminal-exit", () => {
        spawnedRef.current = false;
        term.writeln(
          "\r\n\x1b[33m─────────────────────────────────────────\x1b[0m\r\n" +
          "\x1b[33m  Shell 종료  —  아무 키나 누르면 재시작\x1b[0m\r\n" +
          "\x1b[33m─────────────────────────────────────────\x1b[0m"
        );
        const d = term.onKey(() => {
          d.dispose();
          if (fitRef.current) spawnPty(term, fitRef.current);
        });
      }).then((ul) => { unlistenExitRef.current = ul; });
    });

    return () => {
      unlistenDataRef.current?.();
      unlistenExitRef.current?.();
      unlistenDataRef.current = null;
      unlistenExitRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      spawnedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync terminal colour theme with app theme ────────────────────────────

  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme =
      resolvedTheme === "ink" ? TERM_THEME_INK : TERM_THEME_PAPER;
  }, [resolvedTheme]);

  // ── Auto-cd when project folder changes ─────────────────────────────────

  useEffect(() => {
    const prev = prevProjectRef.current;
    prevProjectRef.current = projectPath;

    if (!projectPath || projectPath === prev || !spawnedRef.current) return;

    // Small delay so the shell is ready if this fires just after spawn
    const t = setTimeout(() => {
      sendText(`cd ${shellQuote(projectPath)}\r`);
      if (autoClaudeRef.current) {
        setTimeout(() => sendText("claude\r"), 400);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [projectPath]);

  // ── Refit on visibility change ───────────────────────────────────────────

  useEffect(() => {
    if (!visible || !fitRef.current) return;
    const t = setTimeout(() => {
      fitRef.current?.fit();
      syncSize();
    }, 220);
    return () => clearTimeout(t);
  }, [visible]);

  // ── ResizeObserver ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (visible) {
        fitRef.current?.fit();
        syncSize();
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [visible]);

  // ── Close settings dropdown on outside click ─────────────────────────────

  useEffect(() => {
    if (!settingsOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (!settingsRef.current?.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [settingsOpen]);

  // ── Render ───────────────────────────────────────────────────────────────

  const termBg = resolvedTheme === "ink" ? "#1C1C1E" : "#FAFAF8";
  const projectName = projectPath?.split("/").pop() ?? null;

  return (
    <div
      style={{
        display: visible ? "flex" : "none",
        flex: 1,
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* ── Header ── */}
      <div
        className="flex shrink-0 items-center justify-between border-b border-border px-3"
        style={{ height: 32, background: "var(--muted)" }}
      >
        {/* Left: project name */}
        <span className="font-mono text-xs text-muted-foreground">
          {projectName ? (
            <>
              <span className="opacity-50">~/</span>
              <span>{projectName}</span>
            </>
          ) : (
            "Terminal"
          )}
        </span>

        {/* Right: settings button + dropdown */}
        <div className="relative" ref={settingsRef}>
          <button
            onClick={() => setSettingsOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            title="터미널 설정"
          >
            <Settings2 size={12} />
            <span>설정</span>
          </button>

          {settingsOpen && (
            <div
              className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
              role="menu"
            >
              {/* Dropdown header */}
              <div className="border-b border-border px-3 py-2">
                <p className="text-xs font-semibold text-muted-foreground">터미널 설정</p>
              </div>

              {/* Auto-Claude toggle */}
              <div className="p-1.5">
                <label
                  className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted"
                  role="menuitem"
                >
                  <div className="mt-0.5 flex-none">
                    {/* Custom checkbox */}
                    <span
                      className="flex h-4 w-4 items-center justify-center rounded border transition-colors"
                      style={{
                        background: autoClaude ? "var(--primary)" : "transparent",
                        borderColor: autoClaude ? "var(--primary)" : "var(--border)",
                      }}
                    >
                      {autoClaude && (
                        <Check size={10} style={{ color: "var(--primary-foreground)" }} strokeWidth={3} />
                      )}
                    </span>
                    <input
                      type="checkbox"
                      checked={autoClaude}
                      onChange={toggleAutoClaude}
                      className="sr-only"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">Claude Code 자동 실행</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      프로젝트를 열 때 자동으로 <code className="rounded bg-muted px-1 py-px font-mono">claude</code> 명령을 실행합니다
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── xterm canvas ── */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          padding: "8px",
          overflow: "hidden",
          background: termBg,
        }}
      />
    </div>
  );
}

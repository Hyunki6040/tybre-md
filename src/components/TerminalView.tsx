/**
 * TerminalView — xterm.js terminal backed by portable-pty (Tauri).
 *
 * Key correctness rules:
 *  1. term.open() is called ONLY when the container is visible (display:flex),
 *     because xterm.js measures font metrics on open — a display:none element
 *     returns 0 sizes and breaks the renderer permanently.
 *  2. Tauri event listeners are registered BEFORE terminal_spawn is invoked,
 *     so no early PTY output (shell prompt) is lost.
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
  black: "#3C3C3E",   red: "#FF6B6B",    green: "#86D9A0",
  yellow: "#E5C07B",  blue: "#6BA3D6",   magenta: "#C678DD",
  cyan: "#56B6C2",    white: "#AEAEB2",
  brightBlack: "#636366", brightRed: "#FF8888",   brightGreen: "#98D9B8",
  brightYellow: "#F0D080",brightBlue: "#80B8E8",  brightMagenta: "#D090E0",
  brightCyan: "#70C8D4",  brightWhite: "#E4E4E4",
};

const TERM_THEME_PAPER = {
  background: "#FAFAF8",
  foreground: "#2C2C2E",
  cursor: "#4A7FBF",
  cursorAccent: "#FAFAF8",
  selectionBackground: "rgba(74,127,191,0.2)",
  black: "#2C2C2E",   red: "#BE0000",    green: "#1A7100",
  yellow: "#956800",  blue: "#2157A3",   magenta: "#7B2CA6",
  cyan: "#007070",    white: "#666770",
  brightBlack: "#909090", brightRed: "#D73A49",   brightGreen: "#22863A",
  brightYellow: "#B08800",brightBlue: "#4A7FBF",  brightMagenta: "#9E45AD",
  brightCyan: "#0E7490",  brightWhite: "#FAFAF8",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function shellQuote(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

function termFitDims(fit: FitAddon): { cols: number; rows: number } {
  const proposed = (fit as unknown as {
    proposeDimensions?: () => { cols: number; rows: number } | undefined;
  }).proposeDimensions?.();
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

  const containerRef   = useRef<HTMLDivElement>(null);
  const termRef        = useRef<Terminal | null>(null);
  const fitRef         = useRef<FitAddon | null>(null);
  const spawnedRef     = useRef(false);
  const initializedRef = useRef(false);           // guards one-time setup
  const unlistenData   = useRef<(() => void) | null>(null);
  const unlistenExit   = useRef<(() => void) | null>(null);

  // Always-current refs — no stale closures in callbacks
  const projectPathRef = useRef(projectPath);
  projectPathRef.current = projectPath;
  const prevProjectRef = useRef<string | null>(null);

  // Auto-Claude setting
  const [autoClaude, setAutoClaude] = useState<boolean>(
    () => JSON.parse(localStorage.getItem("tybre:autoClaude") ?? "false")
  );
  const autoClaudeRef = useRef(autoClaude);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // ── Low-level helpers ───────────────────────────────────────────────────

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

  // ── Spawn PTY (must be called after listeners are registered) ───────────

  function spawnPty(term: Terminal, fit: FitAddon) {
    if (spawnedRef.current) return;
    spawnedRef.current = true;

    const { cols, rows } = termFitDims(fit);
    const cwd = projectPathRef.current ?? null;

    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("terminal_spawn", { cols, rows, cwd })
        .then(() => {
          if (cwd && autoClaudeRef.current) {
            setTimeout(() => sendText("claude\r"), 700);
          }
        })
        .catch((err: unknown) => {
          spawnedRef.current = false;
          term.writeln(
            `\r\n\x1b[31m[tybre] 터미널 시작 실패: ${String(err)}\x1b[0m`
          );
        });
    });
  }

  // ── Unmount cleanup ─────────────────────────────────────────────────────
  // The component is intentionally kept alive (display:none, never unmounted).
  // This effect only cleans up if the whole app unmounts.

  useEffect(() => {
    return () => {
      unlistenData.current?.();
      unlistenExit.current?.();
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      spawnedRef.current = false;
      initializedRef.current = false;
    };
  }, []);

  // ── Main lifecycle: initialize once on first visible, refit on re-show ──

  useEffect(() => {
    if (!visible) return;

    // ── First time visible: full init ────────────────────────────────────
    if (!initializedRef.current && containerRef.current) {
      initializedRef.current = true;

      const theme =
        useAppStore.getState().resolvedTheme === "ink"
          ? TERM_THEME_INK
          : TERM_THEME_PAPER;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily:
          "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
        theme,
        allowTransparency: false,
        scrollback: 5000,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);

      // Element is visible NOW — safe to open
      term.open(containerRef.current);
      fit.fit();

      termRef.current = term;
      fitRef.current = fit;

      // Pipe keystrokes → PTY
      term.onData((data) => {
        import("@tauri-apps/api/core").then(({ invoke }) => {
          const encoder = new TextEncoder();
          invoke("terminal_write", {
            data: Array.from(encoder.encode(data)),
          }).catch(() => {});
        });
      });

      // Register Tauri event listeners FIRST, spawn PTY only after both are ready.
      // cancelled flag prevents StrictMode double-invoke race: if the cleanup effect
      // runs before this async block resolves, we abandon the init so mount-2 can
      // build the correct listeners bound to its own terminal instance.
      let cancelled = false;
      import("@tauri-apps/api/event")
        .then(async ({ listen }) => {
          if (cancelled) return;
          const [ul1, ul2] = await Promise.all([
            // PTY output → xterm display
            listen<string>("terminal-data", (event) => {
              const binary = atob(event.payload);
              const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
              term.write(bytes);
            }),
            // Shell exited → prompt restart
            listen<void>("terminal-exit", () => {
              spawnedRef.current = false;
              term.writeln(
                "\r\n\x1b[33m──────────────────────────────────────\x1b[0m\r\n" +
                "\x1b[33m  Shell 종료 — 아무 키나 누르면 재시작\x1b[0m\r\n" +
                "\x1b[33m──────────────────────────────────────\x1b[0m"
              );
              const d = term.onKey(() => {
                d.dispose();
                if (fitRef.current) spawnPty(term, fitRef.current);
              });
            }),
          ]);

          // Check again after the two awaits — cleanup may have run during them
          if (cancelled) { ul1(); ul2(); return; }

          unlistenData.current = ul1;
          unlistenExit.current = ul2;

          // PTY spawned after listeners are ready — no output will be missed
          spawnPty(term, fit);
        })
        .catch(console.error);

      return () => { cancelled = true; }; // cancel pending async if effect is torn down
    }

    // ── Already initialized: refit to current dimensions ─────────────────
    const t = setTimeout(() => {
      fitRef.current?.fit();
      syncSize();
    }, 220);
    return () => clearTimeout(t);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync terminal colour palette when app theme changes ─────────────────

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

    const t = setTimeout(() => {
      sendText(`cd ${shellQuote(projectPath)}\r`);
      if (autoClaudeRef.current) {
        setTimeout(() => sendText("claude\r"), 400);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [projectPath]);

  // ── ResizeObserver ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (visible && fitRef.current) {
        fitRef.current.fit();
        syncSize();
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [visible]);

  // ── Close settings dropdown on outside click ─────────────────────────────

  useEffect(() => {
    if (!settingsOpen) return;
    function onDown(e: MouseEvent) {
      if (!settingsRef.current?.contains(e.target as Node)) setSettingsOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
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
      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center justify-between border-b border-border px-3"
        style={{ height: 32, background: "var(--muted)" }}
      >
        <span className="font-mono text-xs text-muted-foreground">
          {projectName ? (
            <><span className="opacity-40">~/</span>{projectName}</>
          ) : (
            "Terminal"
          )}
        </span>

        {/* Settings */}
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
              <div className="border-b border-border px-3 py-2">
                <p className="text-xs font-semibold text-muted-foreground">터미널 설정</p>
              </div>
              <div className="p-1.5">
                <label
                  className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted"
                  role="menuitem"
                >
                  <div className="mt-0.5 flex-none">
                    <span
                      className="flex h-4 w-4 items-center justify-center rounded border transition-colors"
                      style={{
                        background: autoClaude ? "var(--primary)" : "transparent",
                        borderColor: autoClaude ? "var(--primary)" : "var(--border)",
                      }}
                    >
                      {autoClaude && (
                        <Check
                          size={10}
                          strokeWidth={3}
                          style={{ color: "var(--primary-foreground)" }}
                        />
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
                    <p className="text-sm font-medium text-foreground">
                      Claude Code 자동 실행
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      프로젝트를 열 때 자동으로{" "}
                      <code className="rounded bg-muted px-1 py-px font-mono">
                        claude
                      </code>{" "}
                      명령을 실행합니다
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── xterm canvas ─────────────────────────────────────────────────── */}
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

/**
 * TerminalView — xterm.js terminal backed by portable-pty (Tauri).
 * Supports multiple PTY sessions with a tabbed UI.
 *
 * Key correctness rules:
 *  1. term.open() is called ONLY when the container div has display:flex.
 *     Non-active sessions use display:none to keep all divs in the DOM
 *     without triggering xterm layout measurement on hidden elements.
 *  2. A new session's div becomes active (display:flex) BEFORE initXterm
 *     is called, ensuring font metrics measurement succeeds.
 *  3. PTY streaming uses the Tauri v2 Channel API — no async listener
 *     registration, no race conditions.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Settings2, Check, Plus, X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/utils";

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

// ── Types ────────────────────────────────────────────────────────────────────

interface TermSession {
  id: string;
  name: string;
  projectPath: string | null;
  busy: boolean;
}

interface TermInstance {
  term: Terminal;
  fit: FitAddon;
  spawned: boolean;
}

interface TerminalViewProps {
  visible: boolean;
  projectPath: string | null;
  onProjectChange?: (path: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function genId(): string {
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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

export function TerminalView({ visible, projectPath, onProjectChange }: TerminalViewProps) {
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);

  // Session list & active selection
  const [sessions, setSessions] = useState<TermSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Stable ref to active id for use inside callbacks/closures
  const activeSessionIdRef = useRef<string | null>(null);
  activeSessionIdRef.current = activeSessionId;

  // Stable ref to sessions for use inside effects without adding to deps
  const sessionsRef = useRef<TermSession[]>([]);
  sessionsRef.current = sessions;

  // xterm instances — NOT React state (avoids re-renders on every PTY chunk)
  const termInstancesRef = useRef<Map<string, TermInstance>>(new Map());
  const termDivsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const busyTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Settings dropdown
  const [autoClaude, setAutoClaude] = useState<boolean>(
    () => JSON.parse(localStorage.getItem("tybre:autoClaude") ?? "false")
  );
  const autoClaudeRef = useRef(autoClaude);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Track projectPath to detect genuine changes
  const prevProjectRef = useRef<string | null>(null);
  const projectPathRef = useRef(projectPath);
  projectPathRef.current = projectPath;

  // Outer container ref for ResizeObserver
  const outerRef = useRef<HTMLDivElement>(null);

  // ── Session management ──────────────────────────────────────────────────

  const addSession = useCallback((projPath: string | null) => {
    const id = genId();
    setSessions((prev) => {
      const name = `shell ${prev.length + 1}`;
      return [...prev, { id, name, projectPath: projPath, busy: false }];
    });
    setActiveSessionId(id);
  }, []);

  const closeSession = useCallback((sessionId: string) => {
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("terminal_kill", { sessionId }).catch(() => {});
    });

    const inst = termInstancesRef.current.get(sessionId);
    inst?.term.dispose();
    termInstancesRef.current.delete(sessionId);

    const timer = busyTimersRef.current.get(sessionId);
    if (timer) clearTimeout(timer);
    busyTimersRef.current.delete(sessionId);

    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== sessionId);
      if (activeSessionIdRef.current === sessionId) {
        setActiveSessionId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
      }
      return remaining;
    });
  }, []);

  // ── Low-level PTY helpers ────────────────────────────────────────────────

  function sendText(sessionId: string, text: string) {
    import("@tauri-apps/api/core").then(({ invoke }) => {
      const encoder = new TextEncoder();
      invoke("terminal_write", {
        sessionId,
        data: Array.from(encoder.encode(text)),
      }).catch(() => {});
    });
  }

  function syncSize(sessionId: string, fit: FitAddon) {
    const { cols, rows } = termFitDims(fit);
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("terminal_resize", { sessionId, cols, rows }).catch(() => {});
    });
  }

  // ── PTY spawning ─────────────────────────────────────────────────────────

  function spawnPty(
    sessionId: string,
    projPath: string | null,
    term: Terminal,
    fit: FitAddon
  ) {
    const inst = termInstancesRef.current.get(sessionId);
    if (!inst || inst.spawned) return;
    inst.spawned = true;

    const thisTerminal = term;
    const { cols, rows } = termFitDims(fit);

    import("@tauri-apps/api/core").then(({ invoke, Channel }) => {
      const channel = new Channel<string | null>();

      channel.onmessage = (msg) => {
        // Validate instance identity — handles StrictMode double-invoke
        const currentInst = termInstancesRef.current.get(sessionId);
        if (!currentInst || currentInst.term !== thisTerminal) return;

        if (msg === null) {
          // Shell exited
          currentInst.spawned = false;
          term.writeln(
            "\r\n\x1b[33m──────────────────────────────────────\x1b[0m\r\n" +
            "\x1b[33m  Shell 종료 — 아무 키나 누르면 재시작\x1b[0m\r\n" +
            "\x1b[33m──────────────────────────────────────\x1b[0m"
          );
          const d = term.onKey(() => {
            d.dispose();
            const inst2 = termInstancesRef.current.get(sessionId);
            if (inst2) spawnPty(sessionId, projPath, inst2.term, inst2.fit);
          });
          return;
        }

        // Busy indicator — only trigger setSessions when transitioning idle→busy
        const hadTimer = busyTimersRef.current.has(sessionId);
        clearTimeout(busyTimersRef.current.get(sessionId));
        if (!hadTimer) {
          setSessions((prev) =>
            prev.map((s) => (s.id === sessionId ? { ...s, busy: true } : s))
          );
        }
        busyTimersRef.current.set(
          sessionId,
          setTimeout(() => {
            busyTimersRef.current.delete(sessionId);
            setSessions((prev) =>
              prev.map((s) => (s.id === sessionId ? { ...s, busy: false } : s))
            );
          }, 1200)
        );

        // Write PTY data to xterm
        const binary = atob(msg);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        term.write(bytes);
      };

      invoke("terminal_spawn", { sessionId, cols, rows, cwd: projPath, onEvent: channel })
        .then(() => {
          if (projPath && autoClaudeRef.current) {
            setTimeout(() => sendText(sessionId, "claude\r"), 700);
          }
        })
        .catch((err: unknown) => {
          if (inst) inst.spawned = false;
          term.writeln(`\r\n\x1b[31m[tybre] 터미널 시작 실패: ${String(err)}\x1b[0m`);
        });
    });
  }

  // ── xterm initialization ─────────────────────────────────────────────────

  function initXterm(sessionId: string, projPath: string | null) {
    const el = termDivsRef.current.get(sessionId);
    if (!el || termInstancesRef.current.has(sessionId)) return;

    const theme =
      useAppStore.getState().resolvedTheme === "ink"
        ? TERM_THEME_INK
        : TERM_THEME_PAPER;

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
    term.open(el);
    fit.fit();

    const inst: TermInstance = { term, fit, spawned: false };
    termInstancesRef.current.set(sessionId, inst);

    term.onData((data) => {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        const encoder = new TextEncoder();
        invoke("terminal_write", {
          sessionId,
          data: Array.from(encoder.encode(data)),
        }).catch(() => {});
      });
    });

    spawnPty(sessionId, projPath, term, fit);
  }

  // ── Lifecycle effects ────────────────────────────────────────────────────

  // Create the first session when the terminal becomes visible (or when
  // all sessions have been manually closed).
  useEffect(() => {
    if (!visible) return;
    if (sessionsRef.current.length === 0) {
      prevProjectRef.current = projectPathRef.current;
      addSession(projectPathRef.current);
    }
  }, [visible, sessions.length, addSession]);

  // Init xterm for a new active session, or refit an existing one.
  // The active session's div is display:flex at this point, so xterm
  // font-metric measurement succeeds.
  useEffect(() => {
    if (!visible || !activeSessionId) return;

    const session = sessionsRef.current.find((s) => s.id === activeSessionId);
    if (!session) return;

    if (!termInstancesRef.current.has(activeSessionId)) {
      // New session — small delay to let the browser lay out the div
      const t = setTimeout(() => initXterm(activeSessionId, session.projectPath), 30);
      return () => clearTimeout(t);
    }

    // Already initialized — refit to current dimensions
    const t = setTimeout(() => {
      const inst = termInstancesRef.current.get(activeSessionId);
      if (inst) {
        inst.fit.fit();
        syncSize(activeSessionId, inst.fit);
      }
    }, 220);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, visible]);

  // Handle project path changes: add a new session for the new project
  // if none exists, or switch to an existing one.
  useEffect(() => {
    if (!projectPath || projectPath === prevProjectRef.current) return;
    prevProjectRef.current = projectPath;
    if (!visible || sessionsRef.current.length === 0) return;

    const existing = sessionsRef.current.find((s) => s.projectPath === projectPath);
    if (!existing) {
      addSession(projectPath);
    } else {
      setActiveSessionId(existing.id);
    }
  }, [projectPath, visible, sessions, addSession]);

  // Sync xterm colour palette when app theme changes
  useEffect(() => {
    const newTheme = resolvedTheme === "ink" ? TERM_THEME_INK : TERM_THEME_PAPER;
    termInstancesRef.current.forEach(({ term }) => {
      term.options.theme = newTheme;
    });
  }, [resolvedTheme]);

  // ResizeObserver — refit active session when the panel resizes
  useEffect(() => {
    if (!outerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!visible) return;
      const id = activeSessionIdRef.current;
      if (!id) return;
      const inst = termInstancesRef.current.get(id);
      if (inst) {
        inst.fit.fit();
        syncSize(id, inst.fit);
      }
    });
    ro.observe(outerRef.current);
    return () => ro.disconnect();
  }, [visible]);

  // Close settings dropdown on outside click
  useEffect(() => {
    if (!settingsOpen) return;
    function onDown(e: MouseEvent) {
      if (!settingsRef.current?.contains(e.target as Node)) setSettingsOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [settingsOpen]);

  // Auto-focus & select text in rename input
  useEffect(() => {
    if (renamingId) {
      setTimeout(() => renameInputRef.current?.select(), 10);
    }
  }, [renamingId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      termInstancesRef.current.forEach(({ term }) => term.dispose());
      termInstancesRef.current.clear();
      busyTimersRef.current.forEach((t) => clearTimeout(t));
      busyTimersRef.current.clear();
    };
  }, []);

  // ── Rename handlers ──────────────────────────────────────────────────────

  function startRename(session: TermSession) {
    setRenamingId(session.id);
    setRenameValue(session.name);
  }

  function commitRename() {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (trimmed) {
      setSessions((prev) =>
        prev.map((s) => (s.id === renamingId ? { ...s, name: trimmed } : s))
      );
    }
    setRenamingId(null);
  }

  // ── Session tab click ────────────────────────────────────────────────────

  function handleSessionClick(session: TermSession) {
    setActiveSessionId(session.id);
    // Cross-project switch: notify parent to update the file tree
    if (session.projectPath && session.projectPath !== projectPathRef.current) {
      onProjectChange?.(session.projectPath);
    }
  }

  // ── Auto-claude toggle ───────────────────────────────────────────────────

  function toggleAutoClaude() {
    const next = !autoClaude;
    autoClaudeRef.current = next;
    setAutoClaude(next);
    localStorage.setItem("tybre:autoClaude", JSON.stringify(next));
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const termBg = resolvedTheme === "ink" ? "#1C1C1E" : "#FAFAF8";

  return (
    <div
      ref={outerRef}
      style={{
        display: visible ? "flex" : "none",
        flex: 1,
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* ── Session tab bar ───────────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-stretch border-b border-border"
        style={{ height: 32, background: "var(--muted)" }}
      >
        {/* Scrollable session tabs */}
        <div className="flex flex-1 items-stretch overflow-x-auto">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                "flex items-center gap-1.5 shrink-0 px-2 border-r border-border cursor-pointer select-none transition-colors",
                session.id === activeSessionId
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
              )}
              onClick={() => handleSessionClick(session)}
            >
              {/* Busy pulse dot */}
              {session.busy && (
                <span
                  className="shrink-0 w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: "var(--primary)" }}
                />
              )}

              {/* Session name — inline rename on double-click */}
              {renamingId === session.id ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenamingId(null);
                    e.stopPropagation();
                  }}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  className="font-mono text-xs bg-transparent border-none outline-none w-20 text-foreground"
                />
              ) : (
                <span
                  className="font-mono text-xs"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRename(session);
                  }}
                >
                  {session.name}
                </span>
              )}

              {/* Project label (small, dimmed) */}
              {session.projectPath && (
                <span className="font-mono text-[10px] text-muted-foreground/60 hidden sm:inline">
                  {session.projectPath.split("/").pop()}
                </span>
              )}

              {/* Close button — only shown when multiple sessions exist */}
              {sessions.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeSession(session.id);
                  }}
                  className="flex items-center justify-center rounded hover:bg-muted/80 p-0.5 ml-0.5 text-muted-foreground hover:text-foreground"
                  title="세션 닫기"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}

          {/* Add new session */}
          <button
            onClick={() => addSession(projectPathRef.current)}
            className="flex items-center justify-center px-2.5 text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors"
            title="새 터미널 세션"
          >
            <Plus size={12} />
          </button>
        </div>

        {/* Settings dropdown */}
        <div className="relative shrink-0 flex items-center px-1" ref={settingsRef}>
          <button
            onClick={() => setSettingsOpen((o) => !o)}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
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

      {/* ── Terminal canvases — all in DOM, display toggled ───────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {sessions.map((session) => (
          <div
            key={session.id}
            ref={(el) => {
              if (el) termDivsRef.current.set(session.id, el);
              else termDivsRef.current.delete(session.id);
            }}
            style={{
              position: "absolute",
              inset: 0,
              padding: 8,
              background: termBg,
              display: session.id === activeSessionId ? "flex" : "none",
              flexDirection: "column",
            }}
          />
        ))}

        {sessions.length === 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: termBg,
            }}
          >
            <span
              className="font-mono text-xs"
              style={{ color: "var(--muted-foreground)" }}
            >
              터미널 로딩 중…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

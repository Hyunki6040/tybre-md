/**
 * TerminalView — full-screen xterm.js terminal backed by portable-pty (Tauri).
 *
 * The component keeps the PTY session alive across editor ↔ terminal toggles.
 * It mounts once and is hidden/shown via CSS, never unmounted.
 */

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  visible: boolean;
}

export function TerminalView({ visible }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Initialize xterm once on mount
  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
      theme: {
        background: "#1C1C1E",
        foreground: "#E4E4E4",
        cursor: "#6BA3D6",
        selectionBackground: "#6BA3D620",
        black: "#1C1C1E",
        red: "#FF6B6B",
        green: "#98C379",
        yellow: "#E5C07B",
        blue: "#61AFEF",
        magenta: "#C678DD",
        cyan: "#56B6C2",
        white: "#E4E4E4",
        brightBlack: "#5C5C5E",
        brightRed: "#FF6B6B",
        brightGreen: "#98C379",
        brightYellow: "#E5C07B",
        brightBlue: "#61AFEF",
        brightMagenta: "#C678DD",
        brightCyan: "#56B6C2",
        brightWhite: "#FAFAF8",
      },
      allowTransparency: false,
      scrollback: 5000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Send keystrokes to PTY
    term.onData((data) => {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        const encoder = new TextEncoder();
        invoke("terminal_write", { data: Array.from(encoder.encode(data)) }).catch(() => {});
      });
    });

    // Spawn PTY on first mount
    spawnPty(term, fit);

    // Listen for output events from Rust
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<string>("terminal-data", (event) => {
        const b64 = event.payload;
        const binary = atob(b64);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        term.write(bytes);
      }).then((unlisten) => {
        unlistenRef.current = unlisten;
      });
    });

    return () => {
      unlistenRef.current?.();
      unlistenRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      spawnedRef.current = false;
    };
  }, []);

  // Refit when visibility changes to "visible"
  useEffect(() => {
    if (visible && fitRef.current) {
      // Small delay so CSS transition finishes before we measure dimensions
      const t = setTimeout(() => {
        fitRef.current?.fit();
        syncSize();
      }, 220);
      return () => clearTimeout(t);
    }
  }, [visible]);

  // ResizeObserver: keep terminal sized to container
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

  function spawnPty(term: Terminal, fit: FitAddon) {
    if (spawnedRef.current) return;
    spawnedRef.current = true;

    const { cols, rows } = termFitDims(fit);

    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("terminal_spawn", { cols, rows }).catch((err: unknown) => {
        term.writeln(`\x1b[31m[tybre] Failed to start terminal: ${String(err)}\x1b[0m`);
      });
    });
  }

  function syncSize() {
    if (!fitRef.current || !termRef.current) return;
    const { cols, rows } = termFitDims(fitRef.current);
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("terminal_resize", { cols, rows }).catch(() => {});
    });
  }

  return (
    <div
      style={{
        display: visible ? "flex" : "none",
        flex: 1,
        flexDirection: "column",
        background: "#1C1C1E",
        overflow: "hidden",
      }}
    >
      <div
        ref={containerRef}
        style={{
          flex: 1,
          padding: "8px",
          overflow: "hidden",
        }}
      />
    </div>
  );
}

function termFitDims(fit: FitAddon): { cols: number; rows: number } {
  const proposed = (fit as any).proposeDimensions?.();
  // proposeDimensions() can return NaN when the container is display:none
  // (parseInt on empty computed style → NaN, Math.max(2, NaN) → NaN).
  // NaN serialises to JSON null, which Tauri rejects as invalid u16.
  // Number.isFinite guards against null / undefined / NaN simultaneously.
  return {
    cols: Number.isFinite(proposed?.cols) ? Math.max(2, proposed.cols) : 80,
    rows: Number.isFinite(proposed?.rows) ? Math.max(1, proposed.rows) : 24,
  };
}

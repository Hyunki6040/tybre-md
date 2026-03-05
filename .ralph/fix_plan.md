# Ralph Fix Plan — Tybre.md

## High Priority (P0 — MVP Core, Week 1-4)

### [GATE] PoC: Milkdown Syntax-Reveal NodeView ✅ PASSED
- [x] Bootstrap Tauri v2 + React 19 + TypeScript + Vite project (manual scaffold, build verified)
- [x] Install and configure Milkdown with `@milkdown/preset-gfm`
- [x] Implement custom ProseMirror NodeView for HeadingView with `focused`/`unfocused` states
- [x] Syntax tokens (e.g. `##`) display in `--text-muted` color when cursor is inside block
- [x] Syntax tokens hide with 150ms ease-out CSS transition when cursor leaves
- [x] PoC verdict: PROCEED — Milkdown + custom NodeView approach works; TypeScript build clean
- [x] Paper/Ink design system CSS variables implemented (globals.css)

### Editor Core (ED-001, ED-002, ED-003)
- [ ] GFM full support: headings H1-H6, bold, italic, strikethrough, links, blockquotes, HR
- [ ] Checkboxes (GFM task lists) with toggle interaction
- [ ] Inline code (backtick) — display with `--code-bg` background
- [ ] Fenced code blocks with Shiki syntax highlighting (language-specific)
- [ ] Table editing: Tab-to-next-cell, add/delete rows and columns, alignment (L/C/R)
- [ ] Image rendering: unfocused = rendered image, focused = `![alt](url)` source in muted color
- [ ] Auto-save: 1 second debounce after last keystroke (SY-001)
- [ ] Cmd+S manual save (habit compatibility)
- [ ] Undo/Redo (Cmd+Z / Cmd+Shift+Z)

### File System — Sidebar & Tabs (FS-001, FS-002)
- [ ] Tauri IPC command: `open_folder` — load project root, return directory tree
- [ ] Tauri IPC command: `read_file` / `write_file` / `create_file` / `delete_file` / `rename_file`
- [ ] Left sidebar FileTree component: expand/collapse folders, highlight active file
- [ ] Cmd+B toggles sidebar (150ms slide animation)
- [ ] Right-click context menu: New File, New Folder, Rename, Delete, Copy Path
- [ ] Drag-and-drop file/folder reordering in sidebar
- [ ] Multi-tab system: open multiple .md files simultaneously
- [ ] Tab visual states: active (accent underline), modified (● prefix, warning color)
- [ ] Cmd+T new tab, Cmd+W close tab, Cmd+Shift+T restore last closed tab
- [ ] Cmd+1~9 switch to tab by index
- [ ] Tab drag-to-reorder, middle-click to close

### Quick Open (FS-003)
- [ ] Cmd+P opens QuickOpen overlay with dimmed background
- [ ] File list sorted by recent-access-first
- [ ] Fuzzy match filtering as user types (debounced, <100ms)
- [ ] Arrow keys to navigate, Enter to open, Escape to close

### Terminal Integration (TM-001)
- [ ] Rust backend: `portable-pty` crate — spawn PTY for system shell (bash/zsh/powershell)
- [ ] Tauri IPC: `terminal_write` (send input), `terminal_resize`, streaming output events
- [ ] Frontend: xterm.js TerminalView component, full-screen layout
- [ ] Cmd+` toggles editor ↔ terminal (200ms crossfade, opacity 0↔1)
- [ ] Terminal session persists across toggles (process is NOT killed)
- [ ] On return to editor: notify crate detects any file changes → auto-reload affected tabs

### Themes & Design (SY-002)
- [ ] CSS variables for Paper (light) and Ink (dark) tokens as specified in PRD
- [ ] System preference auto-detection (`prefers-color-scheme`)
- [ ] Manual theme toggle in settings
- [ ] Body font: system-ui stack with Pretendard as Korean fallback
- [ ] Editor content max-width 800px centered, 32px horizontal padding
- [ ] All transitions ≤ 200ms; no bounce/spring animations

## Medium Priority (P1 — Post-Launch, Week 5-8)

### Project-Wide Search (FS-004)
- [ ] Rust backend: ripgrep library or grep-rs for full-text search across project
- [ ] Cmd+Shift+F opens search panel
- [ ] Results list with file path, line number, context snippet
- [ ] Click result to open file and jump to match

### Table of Contents (NA-001)
- [ ] Parse H1-H4 headings from current document
- [ ] TOC slides in (180px) from right edge when mouse enters right 20px zone
- [ ] Highlight current heading position (accent left border)
- [ ] Click heading → smooth scroll to section
- [ ] Auto-hide 300ms after mouse leaves

### Image Support (ED-004)
- [ ] Drag-and-drop image into editor: copy file to project assets folder, insert relative-path markdown
- [ ] Clipboard paste image: same behavior
- [ ] Render images inline when unfocused, show source when focused

### Mermaid Diagrams (ED-005)
- [ ] Fenced code block with `mermaid` language tag renders as diagram when unfocused
- [ ] Focus reveals source code for editing

### Export (EX-001)
- [ ] Cmd+E opens export dialog: PDF or HTML
- [ ] PDF: comrak → HTML → wkhtmltopdf (or headless chromium via Tauri)
- [ ] HTML: comrak render with theme CSS inlined

### Settings Panel (SY-003)
- [ ] Cmd+, opens settings modal
- [ ] Font size slider: 14–20px (live preview)
- [ ] Theme selector: Paper / Ink / System
- [ ] Auto-save toggle
- [ ] Custom CSS theme import (advanced)

### SQLite File Index (performance)
- [ ] rusqlite: index file paths, last-modified, word count for fast QuickOpen and search
- [ ] Rebuild index on `open_folder`; incremental updates via notify watcher

## Low Priority (P2 — Claude Code Special, Phase 2)

### CLAUDE.md Mode (CC-001)
- [ ] Auto-detect when opened file is named `CLAUDE.md`
- [ ] Show recommended section structure as ghost UI overlay
- [ ] Lint warnings: file too long (>500 lines), missing key sections

### Agent Output Detection (CC-002)
- [ ] fs notify: detect external writes to open files
- [ ] Toast notification: "Modified externally" with diff button
- [ ] Side-by-side diff viewer (before/after comparison)

### Slash Command Editor (CC-003)
- [ ] Browse `.claude/commands/` folder contents in sidebar
- [ ] GUI editor for `.md` command files
- [ ] New command creation wizard with template

## Completed
- [x] Project initialization (Tauri v2 scaffold exists)
- [x] PRD analysis and Ralph task planning

## Notes
- **PoC is Go/No-Go**: Week 1 must validate Milkdown NodeView syntax-reveal. If Milkdown cannot do this cleanly, switch to custom ProseMirror wrapper before writing any other code.
- **App size budget**: Monitor with `du -sh src-tauri/target/release/tybre` regularly. Target <15MB for macOS universal binary.
- **WebView CSS compat**: Test on both macOS WebKit and Windows WebView2. Avoid cutting-edge CSS.
- **Korean/CJK**: Ensure Pretendard font fallback works. Test with Korean text in headings and body.
- **No Electron**: Do not suggest or introduce Electron at any point.
- **Commit frequently**: Each completed checkbox = one commit minimum.

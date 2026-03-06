/**
 * Shortcut registry — single source of truth for all keyboard shortcuts.
 * Shared between App.tsx (key matching) and Settings (display + customization).
 */

export interface ShortcutDef {
  id: string;
  group: string;
  label: string;
  /** Internal key combo: "meta+t", "meta+shift+f", ",", "/" etc. */
  defaultKey: string;
  /** Display string for macOS: "⌘T", "⌘⇧F" */
  display: string;
  /** If true, not yet implemented (shown with badge in Settings) */
  soon?: boolean;
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  // Window
  { id: "new-window",     group: "창",      label: "새 창",          defaultKey: "meta+shift+n",   display: "⌘⇧N" },
  // Tabs
  { id: "new-tab",        group: "탭",      label: "새 탭",          defaultKey: "meta+t",         display: "⌘T" },
  { id: "close-tab",      group: "탭",      label: "탭 닫기",        defaultKey: "meta+w",         display: "⌘W" },
  { id: "restore-tab",    group: "탭",      label: "닫힌 탭 복원",   defaultKey: "meta+shift+t",   display: "⌘⇧T" },
  { id: "tab-switch",     group: "탭",      label: "탭 번호 이동",   defaultKey: "meta+1",         display: "⌘1–9" },
  // Files
  { id: "save",           group: "파일",    label: "저장",           defaultKey: "meta+s",         display: "⌘S" },
  { id: "quick-open",     group: "파일",    label: "빠른 열기",      defaultKey: "meta+p",         display: "⌘P" },
  { id: "find",           group: "파일",    label: "문서 내 검색",   defaultKey: "meta+f",         display: "⌘F" },
  { id: "project-search", group: "파일",    label: "전체 검색",      defaultKey: "meta+shift+f",   display: "⌘⇧F" },
  { id: "export",         group: "파일",    label: "내보내기",       defaultKey: "meta+e",         display: "⌘E" },
  // Layout
  { id: "sidebar",        group: "레이아웃", label: "사이드바 토글", defaultKey: "meta+\\",        display: "⌘\\" },
  { id: "terminal",       group: "레이아웃", label: "터미널 전환",   defaultKey: "meta+`",         display: "⌘`" },
  { id: "settings",       group: "레이아웃", label: "설정",          defaultKey: "meta+,",         display: "⌘," },
  // Edit
  { id: "undo",           group: "편집",    label: "실행 취소",      defaultKey: "meta+z",         display: "⌘Z" },
  { id: "slash",          group: "편집",    label: "슬래시 명령",    defaultKey: "/",              display: "/" },
  // Terminal
  { id: "open-folder",        group: "레이아웃", label: "폴더 열기",         defaultKey: "meta+shift+o",   display: "⌘⇧O" },
  { id: "term-prev-session",  group: "터미널",   label: "이전 터미널 세션",   defaultKey: "ctrl+[",         display: "Ctrl+[" },
  { id: "term-next-session",  group: "터미널",   label: "다음 터미널 세션",   defaultKey: "ctrl+]",         display: "Ctrl+]" },
  { id: "term-queue",         group: "터미널",   label: "대기열 패널 토글",   defaultKey: "ctrl+shift+l",   display: "Ctrl+⇧L" },
];

/** Parse a combo string like "meta+shift+f" into its parts */
export interface KeySpec {
  meta: boolean;
  shift: boolean;
  alt: boolean;
  key: string; // the actual key, e.g. "f", ",", "\", "`"
}

export function parseCombo(combo: string): KeySpec {
  const parts = combo.split("+");
  // The key is the last part (could contain special chars)
  const key = parts[parts.length - 1];
  return {
    meta: parts.includes("meta"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    key,
  };
}

/** Check if a KeyboardEvent matches a combo string */
export function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false;
  const spec = parseCombo(combo);
  const modOk = (e.metaKey || e.ctrlKey) === spec.meta;
  const shiftOk = e.shiftKey === spec.shift;
  const altOk = e.altKey === spec.alt;
  const keyOk = e.key.toLowerCase() === spec.key.toLowerCase();
  return modOk && shiftOk && altOk && keyOk;
}

/** Convert a combo string to a display string like "⌘⇧F" */
export function comboToDisplay(combo: string): string {
  if (!combo) return "";
  const spec = parseCombo(combo);
  let s = "";
  if (spec.meta) s += "⌘";
  if (spec.shift) s += "⇧";
  if (spec.alt) s += "⌥";
  // Special key display
  const key = spec.key;
  if (key === "\\") s += "\\";
  else if (key === "`") s += "`";
  else if (key === ",") s += ",";
  else s += key.toUpperCase();
  return s;
}

/** Capture a KeyboardEvent and convert it to a combo string */
export function eventToCombo(e: KeyboardEvent): string | null {
  // Ignore pure modifier presses
  if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("meta");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  parts.push(e.key.toLowerCase());
  return parts.join("+");
}

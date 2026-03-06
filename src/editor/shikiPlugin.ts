/**
 * shikiPlugin.ts
 *
 * ProseMirror plugin that applies Shiki syntax highlighting to code blocks
 * via Decoration.inline (color style injection). Supports light/dark themes
 * via CSS class on <html>.
 *
 * Strategy:
 *  - Shiki is initialized once (async singleton)
 *  - On doc change, recompute decorations for all code_block / fence nodes
 *  - After async init, dispatch a meta transaction to force decoration refresh
 */

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PmNode } from "prosemirror-model";
import type { Transaction, EditorState } from "prosemirror-state";
import { createHighlighter, type Highlighter } from "shiki";

// ─── Config ────────────────────────────────────────────────────────────────

const SUPPORTED_LANGS = [
  "typescript", "javascript", "tsx", "jsx",
  "python", "rust", "go", "bash",
  "json", "yaml", "toml",
  "css", "html", "markdown",
  "sql", "swift", "kotlin",
  "c", "cpp",
] as const;

const THEME_LIGHT = "github-light";
const THEME_DARK = "github-dark-dimmed";

// ─── Types ─────────────────────────────────────────────────────────────────

type SupportedLang = (typeof SUPPORTED_LANGS)[number];

interface PluginState {
  decorations: DecorationSet;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

function normalizeLang(raw: string | null | undefined): SupportedLang | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  // Common aliases
  const aliases: Record<string, string> = {
    ts: "typescript", js: "javascript",
    py: "python", sh: "bash",
    shell: "bash", zsh: "bash",
    rs: "rust", yml: "yaml",
  };
  const resolved = aliases[lower] ?? lower;
  return (SUPPORTED_LANGS as readonly string[]).includes(resolved)
    ? (resolved as SupportedLang)
    : null;
}

/**
 * Build Decoration.inline array for a single code block node.
 * `nodePos` is the position BEFORE the node (exclusive start of content = nodePos+1).
 */
function decorateNode(
  node: PmNode,
  nodePos: number,
  highlighter: Highlighter,
  theme: string
): Decoration[] {
  const lang = normalizeLang(node.attrs?.language ?? node.attrs?.params);
  if (!lang) return [];

  const code = node.textContent;
  if (!code.trim()) return [];

  let tokenLines;
  try {
    const result = highlighter.codeToTokens(code, { lang, theme });
    tokenLines = result.tokens;
  } catch {
    return [];
  }

  const decorations: Decoration[] = [];
  // nodePos+1 is the start of text content inside the code_block node
  const contentStart = nodePos + 1;

  // Walk lines, tracking char offset within node text
  let charOffset = 0;
  for (const line of tokenLines) {
    for (const token of line) {
      if (token.color && token.color !== "inherit") {
        const start = contentStart + charOffset;
        const end = start + token.content.length;
        decorations.push(
          Decoration.inline(start, end, { style: `color: ${token.color}` })
        );
      }
      charOffset += token.content.length;
    }
    // +1 for the newline between lines (Shiki splits on \n)
    charOffset += 1;
  }

  return decorations;
}

/**
 * Walk the entire doc and collect decorations for every code block.
 */
function buildDecorations(
  doc: PmNode,
  highlighter: Highlighter
): DecorationSet {
  const theme = isDarkMode() ? THEME_DARK : THEME_LIGHT;
  const decos: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === "code_block" || node.type.name === "fence") {
      decos.push(...decorateNode(node, pos, highlighter, theme));
      return false; // don't recurse into code block children
    }
    return true;
  });

  return DecorationSet.create(doc, decos);
}

// ─── Plugin ────────────────────────────────────────────────────────────────

const shikiKey = new PluginKey<PluginState>("shiki");

/** Meta key used to trigger a full decoration refresh after async init. */
const REFRESH_META = "shiki-refresh";

export function createShikiPlugin(): Plugin<PluginState> {
  let highlighter: Highlighter | null = null;
  // Will hold a reference to the view.dispatch once the editor is mounted
  let pendingDispatch: ((tr: Transaction) => void) | null = null;
  let pendingState: EditorState | null = null;

  // Kick off async init immediately
  createHighlighter({
    themes: [THEME_LIGHT, THEME_DARK],
    langs: [...SUPPORTED_LANGS],
  }).then((h) => {
    highlighter = h;
    // If the editor is already mounted, trigger a refresh
    if (pendingDispatch && pendingState) {
      const tr = pendingState.tr.setMeta(REFRESH_META, true);
      pendingDispatch(tr);
      pendingDispatch = null;
      pendingState = null;
    }
  }).catch((err) => {
    console.warn("[shikiPlugin] init failed:", err);
  });

  return new Plugin<PluginState>({
    key: shikiKey,

    state: {
      init() {
        return { decorations: DecorationSet.empty };
      },
      apply(tr, prev, _oldState, newState) {
        const isRefresh = tr.getMeta(REFRESH_META) === true;

        if (!highlighter) return prev;
        if (!tr.docChanged && !isRefresh) {
          return { decorations: prev.decorations.map(tr.mapping, tr.doc) };
        }

        return { decorations: buildDecorations(newState.doc, highlighter) };
      },
    },

    view(editorView) {
      // If highlighter not ready yet, stash dispatch/state for later
      if (!highlighter) {
        pendingDispatch = (tr) => editorView.dispatch(tr);
        pendingState = editorView.state;
      }
      return {
        update(view) {
          // Keep pendingState in sync (in case init fires before first doc change)
          if (!highlighter) {
            pendingState = view.state;
          }
        },
      };
    },

    props: {
      decorations(editorState) {
        return shikiKey.getState(editorState)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

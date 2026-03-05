/**
 * SyntaxRevealNodeView
 *
 * A ProseMirror NodeView that implements the core "syntax-reveal" behavior:
 * - When the cursor is inside a heading block, markdown syntax tokens
 *   (##, ###, etc.) appear in --text-muted color.
 * - When the cursor leaves, they disappear with a 150ms ease-out CSS transition.
 *
 * This is the critical PoC gate for the entire Tybre.md project.
 */

import type { Node as PmNode } from "prosemirror-model";
import type { EditorView, NodeView, ViewMutationRecord } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";

type GetPos = () => number | undefined;

/** Heading level to markdown prefix mapping */
const HEADING_PREFIXES: Record<number, string> = {
  1: "#",
  2: "##",
  3: "###",
  4: "####",
  5: "#####",
  6: "######",
};

/**
 * Creates a syntax token span element.
 * The CSS class `syntax-token` drives the visibility transition.
 * contentEditable=false prevents the user from accidentally editing the token.
 */
function createSyntaxToken(text: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "syntax-token";
  span.contentEditable = "false";
  span.setAttribute("aria-hidden", "true");
  span.textContent = text;
  return span;
}

/**
 * HeadingNodeView — implements syntax-reveal for heading nodes.
 *
 * The node renders as:
 *   <h2 class="heading-node [is-focused]">
 *     <span class="syntax-token" aria-hidden="true" contenteditable="false">## </span>
 *     <span class="heading-content">...actual content...</span>
 *   </h2>
 *
 * CSS drives the visibility:
 *   .heading-node.is-focused .syntax-token  → opacity: 1; color: --text-muted
 *   .heading-node:not(.is-focused) .syntax-token → opacity: 0; color: transparent
 */
export class HeadingNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private tokenSpan: HTMLElement;
  private level: number;
  private view: EditorView;
  private getPos: GetPos;

  constructor(node: PmNode, view: EditorView, getPos: GetPos) {
    this.view = view;
    this.getPos = getPos;
    this.level = (node.attrs as { level: number }).level ?? 1;

    // Container: h1-h6 element with heading-node class
    const heading = document.createElement(`h${this.level}`);
    heading.className = "heading-node";
    heading.setAttribute("data-level", String(this.level));

    // Syntax token (e.g. "## ")
    const prefix = HEADING_PREFIXES[this.level] ?? "#";
    this.tokenSpan = createSyntaxToken(prefix + " ");
    heading.appendChild(this.tokenSpan);

    // Content area — ProseMirror manages this span
    const content = document.createElement("span");
    content.className = "heading-content";
    heading.appendChild(content);

    this.dom = heading;
    this.contentDOM = content;

    // Set initial focus state based on current cursor position
    this.updateFocusState();
  }

  /**
   * Called by ProseMirror when the node is updated.
   * Must return true if we handled the update, false to trigger full re-render.
   */
  update(node: PmNode): boolean {
    // Reject if type doesn't match
    if (node.type.name !== "heading") {
      return false;
    }

    const newLevel = (node.attrs as { level: number }).level ?? 1;
    if (newLevel !== this.level) {
      this.level = newLevel;
      this.dom.setAttribute("data-level", String(newLevel));
      const prefix = HEADING_PREFIXES[newLevel] ?? "#";
      this.tokenSpan.textContent = prefix + " ";
    }

    this.updateFocusState();
    return true;
  }

  /**
   * Checks whether the cursor is currently inside this heading node
   * and toggles the `is-focused` CSS class.
   */
  private updateFocusState(): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { selection } = this.view.state;
    const nodeStart = pos;
    const nodeSize = this.view.state.doc.nodeAt(pos)?.nodeSize ?? 2;
    const nodeEnd = nodeStart + nodeSize;

    let isFocused = false;
    if (selection instanceof TextSelection) {
      const { from, to } = selection;
      // Cursor/selection overlaps with this heading's content range
      isFocused = from > nodeStart && to <= nodeEnd;
    }

    if (isFocused) {
      this.dom.classList.add("is-focused");
    } else {
      this.dom.classList.remove("is-focused");
    }
  }

  /**
   * Tell ProseMirror to ignore mutations in the token span
   * (it's decorative and not part of the document model).
   */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === "selection") return false;
    // Ignore mutations inside the syntax token span
    const target = mutation.target;
    return this.tokenSpan === target || this.tokenSpan.contains(target);
  }

  destroy(): void {
    // No cleanup needed
  }
}

/**
 * Factory function compatible with ProseMirror's NodeViewConstructor.
 */
export function headingNodeViewFactory(
  node: PmNode,
  view: EditorView,
  getPos: GetPos
): HeadingNodeView {
  return new HeadingNodeView(node, view, getPos);
}

/**
 * Scans all .heading-node elements in the view's DOM and updates
 * their `is-focused` class based on the current selection.
 *
 * Must be called after every state update (including selection-only
 * transactions) because NodeView.update() only fires on content changes.
 */
export function updateAllHeadingFocus(view: EditorView): void {
  const { from, to } = view.state.selection;

  view.dom.querySelectorAll<HTMLElement>(".heading-node").forEach((el) => {
    try {
      // posAtDOM returns position at start of node's content; -1 gives node start
      const domPos = view.posAtDOM(el, 0);
      if (domPos < 0) return;
      const nodeStart = domPos - 1;
      const node = view.state.doc.nodeAt(nodeStart);
      if (!node) return;
      const nodeEnd = nodeStart + node.nodeSize;
      const isFocused = from > nodeStart && to <= nodeEnd;
      el.classList.toggle("is-focused", isFocused);
    } catch {
      // posAtDOM can throw if el is outside the mounted view
    }
  });
}

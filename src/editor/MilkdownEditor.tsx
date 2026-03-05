/**
 * MilkdownEditor component
 *
 * Sets up Milkdown with GFM preset + custom HeadingNodeView (syntax-reveal PoC).
 *
 * Key fix: React StrictMode in dev mode runs effects twice (mount→unmount→mount).
 * We guard against this with a `destroyed` flag and a microtask defer so the
 * cleanup from the first run completes before the second init starts.
 */

import { useEffect, useRef } from "react";
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { headingNodeViewFactory, updateAllHeadingFocus } from "./SyntaxRevealNodeView";

interface MilkdownEditorProps {
  initialContent: string;
  onChange?: (markdown: string) => void;
  className?: string;
}

export function MilkdownEditor({
  initialContent,
  onChange,
  className,
}: MilkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Capture initial content only once (key prop handles tab switching)
  const initialContentRef = useRef(initialContent);

  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;
    let editor: Editor | null = null;

    async function init() {
      // Defer one microtask — lets StrictMode's cleanup from the first
      // invocation complete before we start the real initialization.
      await Promise.resolve();
      if (destroyed || !containerRef.current) return;

      try {
        editor = await Editor.make()
          .use(commonmark)
          .use(gfm)
          .use(listener)
          .config((ctx) => {
            ctx.set(rootCtx, containerRef.current!);
            ctx.set(defaultValueCtx, initialContentRef.current);
            ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
              if (!destroyed) onChangeRef.current?.(markdown);
            });
          })
          .create();

        if (destroyed) {
          editor.destroy();
          editor = null;
          return;
        }

        // Inject HeadingNodeView for syntax-reveal after editor is live.
        // Also patch dispatchTransaction so selection-only transactions
        // (cursor moves without content changes) also update focus state —
        // NodeView.update() only fires on content/attr changes, not on
        // cursor movement alone.
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          view.setProps({
            nodeViews: {
              ...view.props.nodeViews,
              heading: headingNodeViewFactory,
            },
            dispatchTransaction(tr) {
              const nextState = view.state.apply(tr);
              view.updateState(nextState);
              updateAllHeadingFocus(view);
            },
          });
        });
      } catch (err) {
        if (!destroyed) console.error("Milkdown init failed:", err);
      }
    }

    init();

    return () => {
      destroyed = true;
      editor?.destroy();
      editor = null;
    };
  }, []); // Empty deps — key prop handles remount per tab

  return (
    <div
      ref={containerRef}
      className={`milkdown-wrapper editor-area ${className ?? ""}`}
    />
  );
}

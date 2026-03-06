/**
 * MilkdownEditor component
 *
 * Sets up Milkdown with GFM preset + custom HeadingNodeView (syntax-reveal PoC)
 * + Slash command palette ("/") for markdown-unaware users.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  prosePluginsCtx,
} from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { keymap } from "prosemirror-keymap";
import { undo, redo } from "prosemirror-history";
import { headingNodeViewFactory, updateAllHeadingFocus } from "./SyntaxRevealNodeView";
import {
  createSlashPlugin,
  executeSlashCommand,
  SlashMenu,
  type SlashPluginState,
} from "./SlashCommand";
import { createShikiPlugin } from "./shikiPlugin";
import type { EditorView } from "prosemirror-view";

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
  const initialContentRef = useRef(initialContent);

  // Slash command state
  const [slashState, setSlashState] = useState<SlashPluginState | null>(null);
  const [slashCoords, setSlashCoords] = useState<{ top: number; left: number } | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Stable callback for slash plugin (no re-render dependency)
  const onSlashUpdate = useRef(
    (state: SlashPluginState | null, coords: { top: number; left: number } | null) => {
      setSlashState(state?.active ? state : null);
      setSlashCoords(coords);
    }
  );

  // Slash plugin instance — created once
  const slashPlugin = useMemo(
    () => createSlashPlugin((s, c) => onSlashUpdate.current(s, c)),
    []
  );

  // Shiki syntax highlighting plugin — created once
  const shikiPlugin = useMemo(() => createShikiPlugin(), []);

  const handleSlashSelect = useCallback(
    (commandId: string) => {
      if (!viewRef.current || !slashState) return;
      executeSlashCommand(viewRef.current, commandId, slashState.from, slashState.replaceFrom);
      // Tell the plugin to close
      try {
        viewRef.current.dispatch(
          viewRef.current.state.tr.setMeta("slash-close", true)
        );
      } catch { /* view might be mid-update */ }
      setSlashState(null);
    },
    [slashState]
  );

  const handleSlashClose = useCallback(() => {
    try {
      viewRef.current?.dispatch(
        viewRef.current.state.tr.setMeta("slash-close", true)
      );
    } catch { /* noop */ }
    setSlashState(null);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;
    let editor: Editor | null = null;

    async function init() {
      await Promise.resolve(); // let StrictMode cleanup finish
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
            // Register the slash plugin + Ctrl+Z undo (Mac: Cmd+Z is default, add Ctrl as alias)
            ctx.update(prosePluginsCtx, (plugins) => [
              ...plugins,
              slashPlugin,
              shikiPlugin,
              keymap({
                "Ctrl-z": undo,
                "Ctrl-y": redo,
                "Ctrl-Shift-z": redo,
              }),
            ]);
          })
          .create();

        if (destroyed) {
          editor.destroy();
          editor = null;
          return;
        }

        // Inject HeadingNodeView + patch dispatchTransaction for selection tracking
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          viewRef.current = view;
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
      viewRef.current = null;
      editor?.destroy();
      editor = null;
    };
  }, []); // key prop handles tab switching

  return (
    <>
      <div
        ref={containerRef}
        className={`milkdown-wrapper editor-area ${className ?? ""}`}
      />
      {slashState && slashCoords && (
        <SlashMenu
          state={slashState}
          coords={slashCoords}
          onSelect={handleSlashSelect}
          onClose={handleSlashClose}
        />
      )}
    </>
  );
}

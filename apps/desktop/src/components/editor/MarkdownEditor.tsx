import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Matches the app's dark surfaces; the data-free editor chrome stays recessive.
const theme = EditorView.theme(
    {
        "&": { height: "100%", fontSize: "13px", backgroundColor: "transparent", color: "#e4e4e7" },
        "&.cm-focused": { outline: "none" },
        ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.6" },
        ".cm-content": { padding: "12px 0", caretColor: "#8fb0de" },
        ".cm-line": { padding: "0 16px" },
        ".cm-gutters": { backgroundColor: "transparent", color: "#52525b", border: "none" },
        ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#a1a1aa" },
        ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.03)" },
        ".cm-cursor": { borderLeftColor: "#8fb0de" },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "rgba(101,140,194,0.35) !important" },
        ".cm-selectionMatch": { backgroundColor: "rgba(101,140,194,0.18)" },
        ".cm-foldPlaceholder": { backgroundColor: "#27272a", border: "none", color: "#a1a1aa" },
        ".cm-panels": { backgroundColor: "#18181b", color: "#e4e4e7", borderTop: "1px solid rgba(255,255,255,0.08)" },
        ".cm-panels input, .cm-panels button": { color: "#e4e4e7" },
        ".cm-textfield": { backgroundColor: "#09090b", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "4px" },
        ".cm-button": { backgroundImage: "none", backgroundColor: "#27272a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "4px" },
        ".cm-tooltip": { backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)" },
    },
    { dark: true },
);

const highlight = HighlightStyle.define([
    { tag: t.heading1, color: "#ffffff", fontWeight: "700", fontSize: "1.15em" },
    { tag: [t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: "#ffffff", fontWeight: "600" },
    { tag: t.strong, color: "#fafafa", fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: [t.link, t.url], color: "#8fb0de" },
    { tag: t.monospace, color: "#e8b36a" },
    { tag: t.quote, color: "#a1a1aa", fontStyle: "italic" },
    { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "#71717a" },
    { tag: t.list, color: "#d4d4d8" },
]);

interface Props {
    value: string;
    onChange: (value: string) => void;
    onSave?: () => void;
    readOnly?: boolean;
    autoFocus?: boolean;
}

/**
 * Plain-text Markdown editor: line numbers, undo history, search (⌘F),
 * bracket matching and ⌘S to save. `value` is controlled; outside changes
 * (a reload from disk) replace the document without losing focus.
 */
export function MarkdownEditor({ value, onChange, onSave, readOnly = false, autoFocus = false }: Props) {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    // Latest callbacks, so the editor is created once.
    const cb = useRef({ onChange, onSave });
    cb.current = { onChange, onSave };

    useEffect(() => {
        if (!host.current) return;
        const v = new EditorView({
            parent: host.current,
            state: EditorState.create({
                doc: value,
                extensions: [
                    keymap.of([{ key: "Mod-s", preventDefault: true, run: () => { cb.current.onSave?.(); return true; } }]),
                    basicSetup,
                    markdown(),
                    EditorView.lineWrapping,
                    theme,
                    syntaxHighlighting(highlight),
                    EditorState.readOnly.of(readOnly),
                    EditorView.updateListener.of(u => {
                        if (u.docChanged) cb.current.onChange(u.state.doc.toString());
                    }),
                ],
            }),
        });
        view.current = v;
        if (autoFocus) v.focus();
        return () => { v.destroy(); view.current = null; };
        // Created once per mount; readOnly changes remount via `key` in the parent.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const v = view.current;
        if (v && v.state.doc.toString() !== value) {
            v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
        }
    }, [value]);

    return <div ref={host} className="h-full overflow-hidden [&_.cm-editor]:h-full" />;
}

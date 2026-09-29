import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Check, Copy, ExternalLink, FolderOpen, Loader2, Lock, Pencil, Save, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { AppMarkdown } from "@/components/markdown/AppMarkdown";
import { MarkdownEditor } from "@/components/editor/MarkdownEditor";
import { AgentChip, Segmented } from "@/components/agents/AgentBits";
import { MemoryItem, fmtBytes, projectName, shortPath, timeAgo } from "@/lib/agents";
import { usePref } from "@/lib/prefs";
import { track } from "@/lib/telemetry";

interface MemoryDoc {
    content: string;
    modified_at: number;
    editable: boolean;
    reason: string | null;
}

type Mode = "preview" | "edit";

const KIND_LABEL: Record<MemoryItem["kind"], string> = {
    memory: "Memory",
    index: "Memory index",
    instructions: "Instructions",
    rules: "Rules",
    knowledge: "Knowledge",
};

// Unsaved edits survive switching files or tabs for the rest of the session.
const drafts = new Map<string, string>();
export const hasDraft = (id: string) => drafts.has(id);

const CONFLICT = "conflict:";

interface Props {
    item: MemoryItem;
    editor: string;
    onSaved: () => void;
    onForget: () => void;
    onDirtyChange: (id: string, dirty: boolean) => void;
}

export function MemoryPane({ item, editor, onSaved, onForget, onDirtyChange }: Props) {
    const { toast } = useToast();
    const [doc, setDoc] = useState<MemoryDoc | null>(null);
    const [draft, setDraft] = useState<string>("");
    const [error, setError] = useState<string | null>(null);
    const [mode, setMode] = usePref<Mode>("devian_memory_mode", "preview");
    const [saving, setSaving] = useState(false);
    const [conflict, setConflict] = useState(false);
    const [copied, setCopied] = useState(false);

    const dirty = !!doc && draft !== doc.content;

    const openDoc = useCallback((keepDraft: boolean) => {
        return invoke<MemoryDoc>("agents_open_memory", { id: item.id })
            .then(d => {
                setDoc(d);
                setDraft(keepDraft && drafts.has(item.id) ? drafts.get(item.id)! : d.content);
                setError(null);
            })
            .catch(e => setError(String(e)));
    }, [item.id]);

    useEffect(() => { openDoc(true); }, [openDoc]);

    // Pick up changes an agent made while Devian was in the background, unless
    // there are unsaved edits (those are resolved on save instead).
    useEffect(() => {
        const onFocus = () => { if (!drafts.has(item.id)) openDoc(false); };
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, [item.id, openDoc]);

    useEffect(() => {
        if (!doc) return;
        if (dirty) drafts.set(item.id, draft);
        else drafts.delete(item.id);
        onDirtyChange(item.id, dirty);
    }, [draft, doc, dirty, item.id, onDirtyChange]);

    const save = useCallback(async (force = false) => {
        if (!doc || !doc.editable || saving || (!dirty && !force)) return;
        const previous = doc.content;
        const content = draft;
        setSaving(true);
        try {
            const modified = await invoke<number>("agents_save_memory", { id: item.id, content, expectedModified: doc.modified_at, force });
            setDoc({ ...doc, content, modified_at: modified });
            setConflict(false);
            track("memory_saved", { forced: force });
            drafts.delete(item.id);
            onSaved();
            toast({
                title: "Saved",
                description: "Agents pick this up in their next session.",
                action: (
                    <ToastAction altText="Undo save" onClick={async () => {
                        try {
                            const m = await invoke<number>("agents_save_memory", { id: item.id, content: previous, expectedModified: modified, force: false });
                            setDoc(d => (d ? { ...d, content: previous, modified_at: m } : d));
                            setDraft(previous);
                            onSaved();
                        } catch (e) {
                            toast({ variant: "destructive", title: "Couldn't undo", description: String(e).replace(CONFLICT, "") });
                        }
                    }}>Undo</ToastAction>
                ),
            });
        } catch (e) {
            const msg = String(e);
            if (msg.startsWith(CONFLICT)) setConflict(true);
            else toast({ variant: "destructive", title: "Couldn't save", description: msg });
        } finally {
            setSaving(false);
        }
    }, [doc, draft, dirty, item.id, saving, onSaved, toast]);

    // ⌘E switches between preview and editing.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e" && doc?.editable) {
                e.preventDefault();
                setMode(mode === "edit" ? "preview" : "edit");
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [doc?.editable, mode, setMode]);

    const external = (cmd: string, path: string) =>
        invoke(cmd, cmd === "open_in_editor" ? { path, editor } : { path }).catch(e => toast({ variant: "destructive", title: "Couldn't open", description: String(e) }));

    const copyDraft = async () => {
        try {
            await navigator.clipboard.writeText(draft);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard unavailable */ }
    };

    const editing = mode === "edit" && !!doc?.editable;

    return (
        <div className="flex-1 overflow-hidden flex flex-col">
            <div className="shrink-0 px-6 py-4 border-b border-white/5">
                <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                        <h3 className="text-base font-semibold text-white flex items-center gap-2">
                            {item.title}
                            {dirty && <span className="text-[10px] font-medium uppercase tracking-wide text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-1.5">Unsaved</span>}
                        </h3>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-zinc-500">
                            {item.agents.map(a => <AgentChip key={a} agent={a} />)}
                            <span>{KIND_LABEL[item.kind]}</span>
                            <span>{item.scope === "global" ? "Loaded in every project" : `Loaded in ${projectName(item.project_path)}`}</span>
                            <span>{fmtBytes(item.size_bytes)} · updated {timeAgo(doc?.modified_at ?? item.modified_at)}</span>
                        </div>
                        {item.path && <p className="text-[11px] font-mono text-zinc-600 mt-1 truncate" title={item.path}>{shortPath(item.path)}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        {item.path && (
                            <>
                                <Button size="sm" variant="ghost" className="text-zinc-500" title={`Open in ${editor}`} onClick={() => external("open_in_editor", item.path!)}><ExternalLink /></Button>
                                <Button size="sm" variant="ghost" className="text-zinc-500" title="Reveal in folder" onClick={() => external("open_in_finder", item.path!.replace(/[\\/][^\\/]*$/, ""))}><FolderOpen /></Button>
                            </>
                        )}
                        {item.deletable && (
                            <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={onForget}><Trash2 /> Forget</Button>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-3 mt-3">
                    {doc?.editable ? (
                        <Segmented<Mode>
                            value={mode}
                            onChange={setMode}
                            options={[{ value: "preview", label: "Preview" }, { value: "edit", label: "Edit" }]}
                        />
                    ) : doc ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500"><Lock className="h-3.5 w-3.5" /> {doc.reason}</span>
                    ) : null}
                    {doc?.editable && (
                        <div className="ml-auto flex items-center gap-2">
                            {dirty && (
                                <Button size="sm" variant="ghost" className="text-zinc-400" onClick={() => setDraft(doc.content)}>
                                    <Undo2 /> Discard
                                </Button>
                            )}
                            <Button size="sm" disabled={!dirty || saving} onClick={() => save()} title="Save (⌘S)">
                                {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
                            </Button>
                        </div>
                    )}
                </div>

                {conflict && (
                    <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 flex items-center gap-3">
                        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                        <p className="flex-1 text-xs text-zinc-300">This file changed on disk while you were editing it, probably because an agent updated it.</p>
                        <Button size="sm" variant="ghost" className="h-7 text-zinc-300" onClick={copyDraft}>
                            {copied ? <Check /> : <Copy />} Copy mine
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-zinc-300" onClick={() => { setConflict(false); drafts.delete(item.id); openDoc(false); }}>
                            Load theirs
                        </Button>
                        <Button size="sm" variant="secondary" className="h-7" onClick={() => save(true)}>Keep mine</Button>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-hidden">
                {error ? (
                    <p className="px-6 py-4 text-sm text-red-400">{error}</p>
                ) : !doc ? (
                    <div className="flex items-center gap-2 px-6 py-4 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
                ) : editing ? (
                    <MarkdownEditor key={item.id} value={draft} onChange={setDraft} onSave={() => save()} autoFocus />
                ) : (
                    <div className="h-full overflow-y-auto px-6 py-4">
                        {draft.trim() ? (
                            <AppMarkdown content={draft.replace(/^---[\s\S]*?\n---\n?/, "")} className="text-sm text-zinc-300 max-w-3xl" />
                        ) : (
                            <p className="text-sm text-zinc-600">This file is empty.</p>
                        )}
                        {doc.editable && (
                            <button onClick={() => setMode("edit")} className="mt-6 inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white">
                                <Pencil className="h-3.5 w-3.5" /> Edit here <kbd className="text-[10px] text-zinc-600">⌘E</kbd>
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

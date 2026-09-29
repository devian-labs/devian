import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Brain, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AgentDot, AgentFilter, Empty, Segmented, TabHeader } from "@/components/agents/AgentBits";
import { MemoryPane, hasDraft } from "./MemoryPane";
import { AGENT_IDS, MemoryItem, agentMeta, projectName, shortPath } from "@/lib/agents";
import { track } from "@/lib/telemetry";

type KindFilter = "all" | "memory" | "instructions" | "rules";

const KIND_LABEL: Record<MemoryItem["kind"], string> = {
    memory: "Memory",
    index: "Memory index",
    instructions: "Instructions",
    rules: "Rules",
    knowledge: "Knowledge",
};

export function MemoryTab({ editor }: { editor: string }) {
    const { toast } = useToast();
    const [items, setItems] = useState<MemoryItem[] | null>(null);
    const [agent, setAgent] = useState<string | null>(null);
    const [kind, setKind] = useState<KindFilter>("all");
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<string | null>(null);
    // Files with unsaved edits, for the marker in the list.
    const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
    const onDirtyChange = useCallback((id: string, dirty: boolean) => {
        setDirtyIds(prev => {
            if (prev.has(id) === dirty) return prev;
            const next = new Set(prev);
            if (dirty) next.add(id); else next.delete(id);
            return next;
        });
    }, []);
    const [confirmDelete, setConfirmDelete] = useState<MemoryItem | null>(null);

    const load = useCallback(() => {
        invoke<MemoryItem[]>("agents_list_memories")
            .then(list => {
                setItems(list);
                setSelected(prev => prev ?? list.find(i => i.kind === "memory")?.id ?? list[0]?.id ?? null);
            })
            .catch(e => {
                setItems([]);
                toast({ variant: "destructive", title: "Couldn't read agent memory", description: String(e) });
            });
    }, [toast]);

    useEffect(load, [load]);

    const current = items?.find(i => i.id === selected) ?? null;

    const present = useMemo(() => AGENT_IDS.filter(a => items?.some(i => i.agents.includes(a))), [items]);

    const groups = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = (items ?? []).filter(i =>
            (!agent || i.agents.includes(agent as MemoryItem["agents"][number])) &&
            (kind === "all" || (kind === "memory" ? ["memory", "index", "knowledge"].includes(i.kind) : i.kind === kind)) &&
            (!q || i.title.toLowerCase().includes(q) || i.preview.toLowerCase().includes(q) || (i.project_path ?? "").toLowerCase().includes(q))
        );
        const map = new Map<string, MemoryItem[]>();
        for (const i of list) {
            const g = i.scope === "global" ? "Global (all projects)" : i.project_path ?? "Unknown project";
            if (!map.has(g)) map.set(g, []);
            map.get(g)!.push(i);
        }
        return [...map.entries()].sort(([a], [b]) => (a.startsWith("Global") ? -1 : b.startsWith("Global") ? 1 : 0));
    }, [items, agent, kind, query]);

    const counts = useMemo(() => {
        const all = items ?? [];
        return {
            memories: all.filter(i => i.kind === "memory" || i.kind === "knowledge").length,
            instructions: all.filter(i => i.kind === "instructions" || i.kind === "rules").length,
        };
    }, [items]);

    const remove = async (item: MemoryItem) => {
        try {
            await invoke("agents_delete_memory", { id: item.id });
            track("memory_forgotten", { agents: item.agents });
            toast({ title: "Moved to the Trash", description: `${item.title} will no longer be loaded by ${item.agents.length === 1 ? "the agent" : "your agents"}.` });
            setSelected(null);
            load();
        } catch (e) {
            toast({ variant: "destructive", title: "Couldn't remove", description: String(e) });
        } finally {
            setConfirmDelete(null);
        }
    };

    return (
        <div className="flex flex-col h-full animate-in fade-in duration-200">
            <TabHeader
                title="Memory"
                subtitle={items ? `${counts.memories} things your agents remember and ${counts.instructions} instruction files they load into every session.` : "What your agents remember about you and your projects."}
                actions={<Button size="sm" variant="ghost" className="text-zinc-400" onClick={load}><RefreshCw /> Refresh</Button>}
            >
                <div className="flex flex-wrap items-center gap-3 mt-3">
                    <AgentFilter value={agent} agents={present} onChange={setAgent} />
                    <Segmented<KindFilter>
                        value={kind}
                        onChange={setKind}
                        options={[
                            { value: "all", label: "All" },
                            { value: "memory", label: "Memories" },
                            { value: "instructions", label: "Instructions" },
                            { value: "rules", label: "Rules" },
                        ]}
                    />
                    <div className="relative ml-auto">
                        <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search memory"
                            className="h-8 w-52 rounded-lg bg-zinc-900 border border-white/10 pl-8 pr-3 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-white/20"
                        />
                    </div>
                </div>
            </TabHeader>

            <div className="flex-1 flex overflow-hidden">
                <div className="w-[340px] shrink-0 border-r border-white/5 overflow-y-auto">
                    {items === null ? (
                        <div className="flex items-center gap-2 p-4 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Looking for memory files…</div>
                    ) : groups.length === 0 ? (
                        <Empty icon={<Brain className="h-6 w-6" />} title="No memory found" body="Agents write memory and instruction files as you work with them. They'll show up here." />
                    ) : (
                        groups.map(([group, list]) => (
                            <div key={group}>
                                <p className="sticky top-0 z-[1] bg-background/95 backdrop-blur px-4 py-1.5 text-[11px] font-medium text-zinc-500 border-b border-white/5 truncate" title={group}>
                                    {group.startsWith("Global") ? group : `${projectName(group)} · ${shortPath(group)}`}
                                </p>
                                {list.map(i => (
                                    <button
                                        key={i.id}
                                        onClick={() => setSelected(i.id)}
                                        className={`w-full text-left px-4 py-2.5 border-b border-white/5 ${i.id === selected ? "bg-white/6" : "hover:bg-white/3"}`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="flex gap-0.5">{i.agents.map(a => <AgentDot key={a} agent={a} size={7} />)}</span>
                                            <span className="text-sm text-white truncate flex-1">{i.title}</span>
                                            {(dirtyIds.has(i.id) || hasDraft(i.id)) && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" title="Unsaved changes" />}
                                            <span className="text-[10px] uppercase tracking-wide text-zinc-600">{KIND_LABEL[i.kind]}</span>
                                        </div>
                                        <p className="text-xs text-zinc-500 line-clamp-2 mt-1">{i.description || i.preview}</p>
                                    </button>
                                ))}
                            </div>
                        ))
                    )}
                </div>

                {!current ? (
                    <div className="flex-1">
                        <Empty icon={<Brain className="h-6 w-6" />} title="Pick a memory" body="Read and edit exactly what gets loaded into your agents' context, and remove what's wrong or stale." />
                    </div>
                ) : (
                    <MemoryPane
                        key={current.id}
                        item={current}
                        editor={editor}
                        onSaved={load}
                        onForget={() => setConfirmDelete(current)}
                        onDirtyChange={onDirtyChange}
                    />
                )}
            </div>

            <Dialog open={!!confirmDelete} onOpenChange={o => !o && setConfirmDelete(null)}>
                <DialogContent className="bg-zinc-950 border-white/10">
                    <DialogHeader>
                        <DialogTitle className="text-white">Forget "{confirmDelete?.title}"?</DialogTitle>
                        <DialogDescription>
                            The file moves to the Trash and {confirmDelete?.agents.map(a => agentMeta(a).label).join(", ")} won't load it in future sessions. You can restore it from the Trash.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                        <Button variant="destructive" onClick={() => confirmDelete && remove(confirmDelete)}>Forget</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

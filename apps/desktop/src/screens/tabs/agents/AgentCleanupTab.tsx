import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AgentChip, Empty, Section, Segmented, TabHeader } from "@/components/agents/AgentBits";
import { AGENT_IDS, CleanResult, DirtItem, RuntimeReport, agentMeta, fmtBytes } from "@/lib/agents";
import { CleanupTab } from "../CleanupTab";
import { track } from "@/lib/telemetry";

type Age = "7" | "30" | "90";

export function CleanupScreen({ runtime }: { runtime: RuntimeReport | null }) {
    const [view, setView] = useState<"agents" | "projects">("agents");
    const switcher = (
        <Segmented value={view} onChange={setView} options={[{ value: "agents", label: "Agent data" }, { value: "projects", label: "Projects & Docker" }]} />
    );
    if (view === "projects") {
        return (
            <div className="flex flex-col h-full">
                <div className="shrink-0 px-6 pt-4">{switcher}</div>
                <div className="flex-1 overflow-hidden"><CleanupTab /></div>
            </div>
        );
    }
    return <AgentCleanup runtime={runtime} switcher={switcher} />;
}

function AgentCleanup({ runtime, switcher }: { runtime: RuntimeReport | null; switcher: React.ReactNode }) {
    const { toast } = useToast();
    const [age, setAge] = useState<Age>("30");
    const [items, setItems] = useState<DirtItem[] | null>(null);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [confirm, setConfirm] = useState(false);
    const [cleaning, setCleaning] = useState(false);

    const scan = useCallback(() => {
        setItems(null);
        invoke<DirtItem[]>("agents_scan_dirt", { days: Number(age) })
            .then(list => {
                setItems(list);
                // Pre-select what's safe; history-losing items are opt-in.
                setPicked(new Set(list.filter(i => !i.caution).map(i => i.id)));
            })
            .catch(e => {
                setItems([]);
                toast({ variant: "destructive", title: "Scan failed", description: String(e) });
            });
    }, [age, toast]);

    useEffect(scan, [scan]);

    const running = useMemo(() => new Set<string>(runtime?.agents.map(a => a.agent) ?? []), [runtime]);
    const selected = (items ?? []).filter(i => picked.has(i.id));
    const selectedBytes = selected.reduce((n, i) => n + i.size_bytes, 0);
    const total = (items ?? []).reduce((n, i) => n + i.size_bytes, 0);
    const blocked = selected.filter(i => i.requires_closed && running.has(i.requires_closed));

    const clean = async () => {
        setConfirm(false);
        setCleaning(true);
        try {
            const r = await invoke<CleanResult>("agents_clean_dirt", { ids: [...picked], days: Number(age) });
            track("agent_data_cleaned", { items: picked.size, bytes: r.freed_bytes });
            toast({
                title: `Moved ${fmtBytes(r.freed_bytes)} to the Trash`,
                description: r.skipped.length ? `Skipped: ${r.skipped.slice(0, 2).join("; ")}${r.skipped.length > 2 ? "…" : ""}` : "Empty the Trash to free the space, or put anything back from there.",
            });
            scan();
        } catch (e) {
            toast({ variant: "destructive", title: "Cleanup failed", description: String(e) });
        } finally {
            setCleaning(false);
        }
    };

    const toggle = (id: string) =>
        setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    return (
        <div className="flex flex-col h-full animate-in fade-in duration-200">
            <TabHeader
                title="Cleanup"
                subtitle="Agents keep transcripts, checkpoints, snapshots and caches forever. Take back the space."
                actions={
                    <Button disabled={cleaning || selected.length === 0} onClick={() => setConfirm(true)}>
                        {cleaning ? <Loader2 className="animate-spin" /> : <Sparkles />}
                        Clean {selected.length > 0 ? fmtBytes(selectedBytes) : ""}
                    </Button>
                }
            >
                <div className="flex flex-wrap items-center gap-3 mt-3">
                    {switcher}
                    <span className="text-xs text-zinc-500 ml-2">Older than</span>
                    <Segmented<Age> value={age} onChange={setAge} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
                </div>
            </TabHeader>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 max-w-5xl">
                {items === null ? (
                    <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Measuring agent data…</div>
                ) : items.length === 0 ? (
                    <Empty icon={<CheckCircle2 className="h-6 w-6" />} title="Nothing to clean" body={`No agent data older than ${age} days.`} />
                ) : (
                    <>
                        <p className="text-sm text-zinc-400">
                            <span className="text-white font-semibold">{fmtBytes(total)}</span> of agent data can be removed.
                            Items marked <span className="text-amber-300">history</span> delete things you might want later, so they start unselected.
                        </p>
                        {AGENT_IDS.filter(a => items.some(i => i.agent === a)).map(a => {
                            const mine = items.filter(i => i.agent === a);
                            return (
                                <Section key={a} title={agentMeta(a).label} right={<span className="text-xs text-zinc-500 tabular-nums">{fmtBytes(mine.reduce((n, i) => n + i.size_bytes, 0))}</span>}>
                                    <div className="divide-y divide-white/5">
                                        {mine.map(i => {
                                            const isBlocked = !!i.requires_closed && running.has(i.requires_closed);
                                            return (
                                                <label key={i.id} className="px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-white/2">
                                                    <Checkbox checked={picked.has(i.id)} onCheckedChange={() => toggle(i.id)} className="mt-0.5" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="text-sm font-medium text-white">{i.label}</span>
                                                            {i.caution && <span className="text-[10px] uppercase tracking-wide text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded px-1.5">history</span>}
                                                            {isBlocked && (
                                                                <span className="inline-flex items-center gap-1 text-[11px] text-zinc-300 bg-white/5 border border-white/10 rounded px-1.5">
                                                                    <AlertTriangle className="h-3 w-3 text-amber-400" /> Quit {agentMeta(i.requires_closed!).label} first
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-zinc-500 mt-0.5">{i.description}</p>
                                                        <p className="text-[11px] font-mono text-zinc-600 truncate mt-1" title={i.paths_preview.join("\n")}>
                                                            {i.paths_preview[0]}{i.path_count > 1 ? `  +${i.path_count - 1} more` : ""}
                                                        </p>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <p className="text-sm text-white tabular-nums">{fmtBytes(i.size_bytes)}</p>
                                                        <p className="text-[11px] text-zinc-600">{i.file_count.toLocaleString()} files</p>
                                                    </div>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </Section>
                            );
                        })}
                    </>
                )}
            </div>

            <Dialog open={confirm} onOpenChange={setConfirm}>
                <DialogContent className="bg-zinc-950 border-white/10">
                    <DialogHeader>
                        <DialogTitle className="text-white">Move {fmtBytes(selectedBytes)} of agent data to the Trash?</DialogTitle>
                        <DialogDescription>Everything goes to the Trash, so you can put it back. Empty the Trash to actually free the space.</DialogDescription>
                    </DialogHeader>
                    <ul className="space-y-1.5 text-sm">
                        {selected.map(i => (
                            <li key={i.id} className="flex items-center gap-2">
                                <AgentChip agent={i.agent} className="w-28" />
                                <span className="flex-1 text-zinc-300">{i.label}</span>
                                <span className="text-zinc-400 tabular-nums">{fmtBytes(i.size_bytes)}</span>
                            </li>
                        ))}
                    </ul>
                    {selected.some(i => i.caution) && (
                        <p className="text-xs text-amber-300">Includes session history: those sessions can't be resumed afterwards.</p>
                    )}
                    {blocked.length > 0 && (
                        <p className="text-xs text-zinc-400">{blocked.map(b => agentMeta(b.requires_closed!).label).join(", ")} is running, so its caches will be skipped.</p>
                    )}
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={clean}>Move to Trash</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

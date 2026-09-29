import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Box, Cpu, Loader2, RefreshCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AgentChip, AgentDot, Empty, Section, Segmented, TabHeader } from "@/components/agents/AgentBits";
import { AttributedItem, CONFIDENCE_LABEL, RuntimeReport, agentMeta, fmtBytes, fmtDuration, projectName, shortPath, timeAgo } from "@/lib/agents";
import { ServicesTab } from "../ServicesTab";
import type { ActivePort, DockerContainer, SystemProcess } from "@/screens/Dashboard";
import { track } from "@/lib/telemetry";

interface Props {
    runtime: RuntimeReport | null;
    onRefresh: () => void;
    containers: DockerContainer[];
    ports: ActivePort[];
    processes: SystemProcess[];
    onKillProcess: (pid: string, name: string) => void;
    openSessionById: (agent: string, id: string) => void;
}

export function RuntimeTab({ runtime, onRefresh, containers, ports, processes, onKillProcess, openSessionById }: Props) {
    const [view, setView] = useState<"agents" | "all">("agents");
    if (view === "all") {
        return (
            <div className="flex flex-col h-full">
                <div className="shrink-0 px-6 pt-4">
                    <Segmented value={view} onChange={setView} options={[{ value: "agents", label: "From agents" }, { value: "all", label: "Everything running" }]} />
                </div>
                <div className="flex-1 overflow-hidden">
                    <ServicesTab containers={containers} ports={ports} processes={processes} onKillProcess={onKillProcess} />
                </div>
            </div>
        );
    }
    return (
        <AgentRuntime
            runtime={runtime}
            onRefresh={onRefresh}
            openSessionById={openSessionById}
            switcher={<Segmented value={view} onChange={setView} options={[{ value: "agents", label: "From agents" }, { value: "all", label: "Everything running" }]} />}
        />
    );
}

function AgentRuntime({ runtime, onRefresh, openSessionById, switcher }: {
    runtime: RuntimeReport | null; onRefresh: () => void; openSessionById: (agent: string, id: string) => void; switcher: React.ReactNode;
}) {
    const { toast } = useToast();
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [confirmKeys, setConfirmKeys] = useState<string[] | null>(null);

    const leftovers = useMemo(() => runtime?.items.filter(i => i.leftover) ?? [], [runtime]);
    const active = useMemo(() => runtime?.items.filter(i => !i.leftover) ?? [], [runtime]);

    const stop = async (keys: string[]) => {
        if (keys.length === 0) return;
        setBusy(true);
        try {
            const n = await invoke<number>("agents_stop", { keys });
            track("leftovers_stopped", { count: n, from: "runtime" });
            toast({ title: "Stopped", description: `${n} item${n === 1 ? "" : "s"} stopped.` });
            setPicked(new Set());
            onRefresh();
        } catch (e) {
            toast({ variant: "destructive", title: "Couldn't stop", description: String(e) });
        } finally {
            setBusy(false);
        }
    };

    // Stopping several things, or anything matched by inference, asks first.
    const requestStop = (keys: string[]) => {
        const items = runtime?.items.filter(i => keys.includes(i.key)) ?? [];
        if (items.length > 1 || items.some(i => i.confidence === "likely")) setConfirmKeys(keys);
        else stop(keys);
    };

    const toggle = (key: string) =>
        setPicked(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

    return (
        <div className="flex flex-col h-full animate-in fade-in duration-200">
            <TabHeader
                title="Runtime"
                subtitle="Servers, processes and containers your agents started, and the ones they left running after the session ended."
                actions={
                    <>
                        {runtime && <span className="text-[11px] text-zinc-600">Checked {timeAgo(runtime.generated_at)}</span>}
                        <Button size="sm" variant="ghost" className="text-zinc-400" onClick={onRefresh}><RefreshCw /> Refresh</Button>
                    </>
                }
            >
                <div className="mt-3">{switcher}</div>
            </TabHeader>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 max-w-6xl">
                {!runtime ? (
                    <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Scanning processes…</div>
                ) : (
                    <>
                        <Section
                            title={`Left behind · ${leftovers.length}`}
                            right={leftovers.length > 0 && (
                                <div className="flex items-center gap-2">
                                    {picked.size > 0 && (
                                        <Button size="sm" variant="ghost" className="text-zinc-300" disabled={busy} onClick={() => requestStop([...picked])}>
                                            Stop {picked.size} selected
                                        </Button>
                                    )}
                                    <Button size="sm" className="bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 border border-amber-500/30" disabled={busy} onClick={() => requestStop(leftovers.map(l => l.key))}>
                                        {busy ? <Loader2 className="animate-spin" /> : <Square />} Stop all · {fmtBytes(runtime.leftover_memory_bytes)}
                                    </Button>
                                </div>
                            )}
                        >
                            {leftovers.length === 0 ? (
                                <Empty title="Nothing left running" body="When an agent session ends but a dev server, test runner or container it started keeps going, it shows up here." />
                            ) : (
                                <div className="divide-y divide-white/5">
                                    {leftovers.map(i => (
                                        <ItemRow key={i.key} item={i} picked={picked.has(i.key)} onPick={() => toggle(i.key)} onStop={() => requestStop([i.key])} busy={busy} openSessionById={openSessionById} />
                                    ))}
                                </div>
                            )}
                        </Section>

                        <Section title={`Agents running · ${runtime.agents.length}`}>
                            {runtime.agents.length === 0 ? (
                                <p className="px-4 py-4 text-sm text-zinc-500">No agent processes are running.</p>
                            ) : (
                                <div className="divide-y divide-white/5">
                                    {runtime.agents.map(a => (
                                        <div key={a.pid} className="px-4 py-2.5 flex items-center gap-3">
                                            <AgentChip agent={a.agent} className="w-32" />
                                            <span className="flex-1 min-w-0 text-xs text-zinc-400 truncate">{a.cwd ? shortPath(a.cwd) : a.name}</span>
                                            <span className="text-xs text-zinc-500">pid {a.pid}</span>
                                            <span className="text-xs text-zinc-500 w-20 text-right">up {fmtDuration(Date.now() - a.started_at)}</span>
                                            <span className="text-xs text-zinc-300 tabular-nums w-16 text-right">{fmtBytes(a.memory_bytes)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Section>

                        <Section title={`Started by active agents · ${active.length}`}>
                            {active.length === 0 ? (
                                <p className="px-4 py-4 text-sm text-zinc-500">Nothing is running on behalf of an active agent.</p>
                            ) : (
                                <div className="divide-y divide-white/5">
                                    {active.map(i => (
                                        <ItemRow key={i.key} item={i} onStop={() => requestStop([i.key])} busy={busy} openSessionById={openSessionById} />
                                    ))}
                                </div>
                            )}
                        </Section>

                        <p className="text-xs text-zinc-600 leading-relaxed max-w-3xl">
                            Devian links a process to an agent when it runs under the agent, was seen under it earlier, or started in a project
                            while that agent's session was active there. "Likely" matches are inferred; check the command before stopping.
                        </p>
                    </>
                )}
            </div>

            <Dialog open={!!confirmKeys} onOpenChange={o => !o && setConfirmKeys(null)}>
                <DialogContent className="bg-zinc-950 border-white/10">
                    <DialogHeader>
                        <DialogTitle className="text-white">Stop {confirmKeys?.length === 1 ? "this" : `these ${confirmKeys?.length}`}?</DialogTitle>
                        <DialogDescription>Processes get a chance to exit cleanly, then are force-stopped. Containers are stopped, not removed.</DialogDescription>
                    </DialogHeader>
                    <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                        {runtime?.items.filter(i => confirmKeys?.includes(i.key)).map(i => (
                            <li key={i.key} className="flex items-center gap-2 text-sm">
                                <AgentDot agent={i.agent} size={7} />
                                <span className="text-white">{i.name}</span>
                                {i.ports.length > 0 && <span className="font-mono text-[11px] text-zinc-400">:{i.ports.join(", :")}</span>}
                                <span className="text-xs text-zinc-500 truncate flex-1">{projectName(i.project_path)}</span>
                                {i.confidence === "likely" && <span className="text-[10px] uppercase tracking-wide text-amber-300">inferred</span>}
                            </li>
                        ))}
                    </ul>
                    {runtime?.items.some(i => confirmKeys?.includes(i.key) && i.confidence === "likely") && (
                        <p className="text-xs text-amber-300">Inferred matches started in the project while an agent was working there. Make sure none of them is something you started yourself.</p>
                    )}
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setConfirmKeys(null)}>Cancel</Button>
                        <Button variant="destructive" onClick={() => { const k = confirmKeys ?? []; setConfirmKeys(null); stop(k); }}>Stop</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function ItemRow({ item, picked, onPick, onStop, busy, openSessionById }: {
    item: AttributedItem; picked?: boolean; onPick?: () => void; onStop: () => void; busy: boolean;
    openSessionById: (agent: string, id: string) => void;
}) {
    const Icon = item.kind === "container" ? Box : Cpu;
    return (
        <div className="px-4 py-3 flex items-start gap-3">
            {onPick && <Checkbox checked={picked} onCheckedChange={onPick} className="mt-1" aria-label={`Select ${item.name}`} />}
            <Icon className="h-4 w-4 text-zinc-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">{item.name}</span>
                    {item.ports.map(p => (
                        <span key={p} className="text-[11px] font-mono text-zinc-300 bg-white/5 border border-white/10 rounded px-1.5">:{p}</span>
                    ))}
                    <span className="text-xs text-zinc-500">{projectName(item.project_path)}</span>
                </div>
                <p className="font-mono text-[11px] text-zinc-500 truncate mt-0.5" title={item.command}>{item.command}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-zinc-500">
                    <span className="inline-flex items-center gap-1"><AgentDot agent={item.agent} size={6} />{agentMeta(item.agent).label}</span>
                    <span title={CONFIDENCE_LABEL[item.confidence]}>{item.confidence === "likely" ? "inferred: started here during a session" : CONFIDENCE_LABEL[item.confidence].toLowerCase()}</span>
                    <span>started {timeAgo(item.started_at)}</span>
                    {item.process_count > 1 && <span>{item.process_count} processes</span>}
                    {item.session_id && (
                        <button onClick={() => openSessionById(item.agent, item.session_id!)} className="text-zinc-400 hover:text-white underline-offset-2 hover:underline truncate max-w-[320px]">
                            from "{item.session_title}"
                        </button>
                    )}
                </div>
            </div>
            <span className="text-xs text-zinc-300 tabular-nums w-16 text-right pt-0.5">{item.memory_bytes ? fmtBytes(item.memory_bytes) : ""}</span>
            <Button size="sm" variant="ghost" className="text-zinc-400 hover:text-white" disabled={busy} onClick={onStop}>
                <Square /> Stop
            </Button>
        </div>
    );
}

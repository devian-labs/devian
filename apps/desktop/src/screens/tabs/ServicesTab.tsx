import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
    Server, Play, Square, RotateCw, Database, Globe, Cpu,
    HelpCircle, AlertTriangle, Trash2, CheckCircle2,
    ChevronDown, ChevronRight, Network, XCircle, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type DockerContainer = {
    ID: string; Names: string; Status: string; State: string; Image: string;
    ComposeService: string; ComposeProject: string;
    ComposeWorkingDir: string; ComposeConfigFiles: string;
    PortMappings: string[]; ProjectPath: string; ProjectName: string;
};
type ActivePort = { name: string; pid: string; user: string; port: string; full_address: string };
type SystemProcess = { pid: string; cpu: string; mem: string; rss: string; name: string };
type ServiceCategory = "database" | "webserver" | "appserver" | "background" | "unknown";

interface UnifiedService {
    id: string; name: string; displayName: string; category: ServiceCategory;
    status: "running" | "stopped"; port?: string; source: "docker" | "port";
    rawContainer?: DockerContainer; rawPort?: ActivePort;
    projectName?: string; image?: string;
    cpuPercent?: number; memMb?: number;
}

interface ServicesTabProps {
    containers: DockerContainer[];
    ports: ActivePort[];
    processes: SystemProcess[];
    onKillProcess: (pid: string, name: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SYSTEM_NOISE = ["launchd", "sshd", "mdnsresponder", "rapportd", "cupsd", "configd", "systemd", "avahi-daemon"];

function inferService(name: string, port?: string, image?: string): { displayName: string; category: ServiceCategory } {
    const n = ((name || "")).toLowerCase();
    const img = ((image || "")).toLowerCase().split(":")[0].split("/").pop() || "";
    if (["postgres", "postgresql"].some(k => n.includes(k) || img.includes(k))) return { displayName: "PostgreSQL", category: "database" };
    if (["redis", "redis-server"].some(k => n.includes(k) || img.includes(k))) return { displayName: "Redis", category: "database" };
    if (["mongo", "mongod"].some(k => n.includes(k) || img.includes(k))) return { displayName: "MongoDB", category: "database" };
    if (["mysql", "mysqld"].some(k => n.includes(k) || img.includes(k))) return { displayName: "MySQL", category: "database" };
    if (["elasticsearch", "elastic"].some(k => n.includes(k) || img.includes(k))) return { displayName: "Elasticsearch", category: "database" };
    if (["rabbitmq"].some(k => n.includes(k) || img.includes(k))) return { displayName: "RabbitMQ", category: "background" };
    if (["kafka"].some(k => n.includes(k) || img.includes(k))) return { displayName: "Kafka", category: "background" };
    if (["nginx"].some(k => n.includes(k) || img.includes(k))) return { displayName: "nginx", category: "webserver" };
    if (["caddy", "traefik"].some(k => n.includes(k) || img.includes(k))) return { displayName: n.includes("traefik") ? "Traefik" : "Caddy", category: "webserver" };
    if (["next-server", "next"].some(k => n.includes(k))) return { displayName: "Next.js", category: "appserver" };
    if (n.includes("vite")) return { displayName: "Vite", category: "appserver" };
    if (["node", "bun", "deno"].some(k => n.includes(k))) return { displayName: port ? `Node.js (:${port})` : "Node.js", category: "appserver" };
    if (["python", "uvicorn", "gunicorn", "flask", "fastapi"].some(k => n.includes(k))) return { displayName: "Python Server", category: "appserver" };
    if (["java", "spring", "tomcat"].some(k => n.includes(k))) return { displayName: "Java App", category: "appserver" };
    if (["ruby", "rails", "puma"].some(k => n.includes(k))) return { displayName: "Ruby App", category: "appserver" };
    return { displayName: name || `Unknown (:${port || "?"})`, category: "unknown" };
}

function catIcon(cat: ServiceCategory, cls = "h-4 w-4") {
    switch (cat) {
        case "database":  return <Database className={`${cls} text-blue-400`} />;
        case "webserver": return <Globe className={`${cls} text-purple-400`} />;
        case "appserver": return <Cpu className={`${cls} text-emerald-400`} />;
        case "background": return <Server className={`${cls} text-amber-400`} />;
        default: return <HelpCircle className={`${cls} text-zinc-500`} />;
    }
}

function fmtMb(mb: number): string {
    if (!mb || mb <= 0) return "—";
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${Math.round(mb)} MB`;
}

function safePct(s: string | undefined): number {
    if (!s) return 0;
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

function safeRss(s: string | undefined): number {
    if (!s) return 0;
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n / 1024; // KB → MB
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ServicesTab({ containers, ports, processes, onKillProcess }: ServicesTabProps) {
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState<"actions" | "activity">("actions");
    const [selectedService, setSelectedService] = useState<string | null>(null);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
        new Set(["active-dev", "background", "orphaned"])
    );

    // Build process lookup by PID
    const processByPid = useMemo(() => {
        const m = new Map<string, SystemProcess>();
        for (const p of (processes || [])) {
            if (p.pid) m.set(p.pid, p);
        }
        return m;
    }, [processes]);

    // Build unified service list
    const services = useMemo<UnifiedService[]>(() => {
        const list: UnifiedService[] = [];
        const seen = new Set<string>();

        for (const c of (containers || [])) {
            try {
                const rawName = c.ComposeService || c.Names?.replace(/^\//, "") || c.ID?.slice(0, 8) || "unknown";
                const port = c.PortMappings?.[0]?.split("->")?.[1]?.split("/")?.[0];
                const { displayName, category } = inferService(rawName, port, c.Image);
                seen.add(rawName.toLowerCase());
                list.push({
                    id: `docker:${c.ID}`, name: rawName, displayName, category,
                    status: c.State === "running" ? "running" : "stopped",
                    port, source: "docker", rawContainer: c,
                    projectName: c.ProjectName || undefined,
                    image: c.Image,
                });
            } catch { /* skip malformed container */ }
        }

        for (const p of (ports || [])) {
            try {
                if (!p.name || seen.has(p.name.toLowerCase())) continue;
                if (SYSTEM_NOISE.includes(p.name.toLowerCase())) continue;
                const { displayName, category } = inferService(p.name, p.port);
                seen.add(p.name.toLowerCase());
                const proc = processByPid.get(p.pid);
                list.push({
                    id: `port:${p.pid}:${p.port}`, name: p.name, displayName, category,
                    status: "running", port: p.port, source: "port", rawPort: p,
                    cpuPercent: safePct(proc?.cpu),
                    memMb: safeRss(proc?.rss),
                });
            } catch { /* skip malformed port */ }
        }

        return list;
    }, [containers, ports, processByPid]);

    const running = useMemo(() => services.filter(s => s.status === "running"), [services]);
    const stopped = useMemo(() => services.filter(s => s.status === "stopped"), [services]);
    const stoppedContainers = useMemo(() => (containers || []).filter(c => c.State === "exited"), [containers]);

    const portConflicts = useMemo(() => {
        const map = new Map<string, ActivePort[]>();
        for (const p of (ports || [])) {
            if (!p.port) continue;
            const arr = map.get(p.port) || [];
            map.set(p.port, [...arr, p]);
        }
        return [...map.entries()].filter(([, ps]) => ps.length > 1)
            .map(([port, ps]) => ({ port, services: ps }));
    }, [ports]);

    const orphanedServices = useMemo(() =>
        running.filter(s => !s.projectName && s.category === "unknown"),
        [running]
    );

    const totalMemMb = useMemo(() =>
        running.reduce((s, svc) => s + (svc.memMb || 0), 0),
        [running]
    );

    const totalCpu = useMemo(() =>
        running.reduce((s, svc) => s + (svc.cpuPercent || 0), 0),
        [running]
    );

    // Attention items
    const issues = useMemo(() => {
        const items: { id: string; severity: "warning" | "info"; title: string; detail: string; cta: string; action: string }[] = [];
        for (const c of portConflicts) {
            items.push({
                id: `conflict-${c.port}`, severity: "warning",
                title: `Port conflict on ${c.port}`,
                detail: `${c.services.map(s => s.name).join(" and ")} competing for the same port.`,
                cta: "Resolve", action: "port_conflict",
            });
        }
        if (stoppedContainers.length >= 3) {
            items.push({
                id: "stopped", severity: "info",
                title: `${stoppedContainers.length} stopped containers`,
                detail: "Exited containers are taking disk space and can be safely removed.",
                cta: "Cleanup", action: "cleanup_containers",
            });
        }
        if (orphanedServices.length > 0) {
            items.push({
                id: "orphaned", severity: "info",
                title: `${orphanedServices.length} unlinked service${orphanedServices.length > 1 ? "s" : ""}`,
                detail: "These services have no project association and may be safe to stop.",
                cta: "Review", action: "orphaned",
            });
        }
        return items;
    }, [portConflicts, stoppedContainers, orphanedServices]);

    // Service groups
    const activeDev = useMemo(() => running.filter(s => !!s.projectName), [running]);
    const backgroundSvcs = useMemo(() => running.filter(s => !s.projectName && s.category !== "unknown"), [running]);
    const orphaned = useMemo(() => running.filter(s => !s.projectName && s.category === "unknown"), [running]);

    // Intelligence text
    const intelligence = useMemo(() => {
        if (running.length === 0) return { lines: [], actions: [] };
        const projectCount = new Set(running.filter(s => s.projectName).map(s => s.projectName)).size;
        const lines: string[] = [];
        lines.push(`${running.length} service${running.length !== 1 ? "s" : ""} running${projectCount > 0 ? ` across ${projectCount} project${projectCount !== 1 ? "s" : ""}` : ""}.`);
        if (orphaned.length > 0) lines.push(`${orphaned.length} service${orphaned.length > 1 ? "s are" : " is"} running with no project association.`);
        if (portConflicts.length > 0) lines.push(`${portConflicts.length} port conflict${portConflicts.length > 1 ? "s" : ""} — multiple services competing for the same port.`);
        if (stoppedContainers.length > 0) lines.push(`${stoppedContainers.length} stopped container${stoppedContainers.length > 1 ? "s" : ""} can be cleaned up to recover disk space.`);
        if (totalMemMb > 2048) lines.push(`Total runtime memory is ${fmtMb(totalMemMb)}. Stopping idle services could free resources.`);
        const actions: string[] = [];
        if (stoppedContainers.length > 0) actions.push(`Remove ${stoppedContainers.length} stopped container${stoppedContainers.length > 1 ? "s" : ""}`);
        if (portConflicts.length > 0) actions.push(`Resolve port conflict on ${portConflicts[0].port}`);
        if (orphaned.length > 0) actions.push(`Review ${orphaned.length} unlinked service${orphaned.length > 1 ? "s" : ""}`);
        return { lines, actions };
    }, [running, orphaned, portConflicts, stoppedContainers, totalMemMb]);

    // Actions
    const handleDockerAction = async (action: "start" | "stop" | "restart", c: DockerContainer) => {
        const cmd = action === "start" ? "start_docker_container" : action === "stop" ? "stop_docker_container" : "restart_docker_container";
        try {
            await invoke(cmd, { id: c.ID || c.Names });
            toast({ title: `${action.charAt(0).toUpperCase() + action.slice(1)}ed`, description: c.Names });
        } catch (e) {
            toast({ variant: "destructive", title: `Failed to ${action}`, description: String(e) });
        }
    };

    const handlePruneContainers = async () => {
        try {
            await invoke("prune_docker_system");
            toast({ title: "Cleaned", description: "Stopped containers removed." });
        } catch (e) {
            toast({ variant: "destructive", title: "Failed", description: String(e) });
        }
    };

    const toggleGroup = (g: string) =>
        setExpandedGroups(prev => { const n = new Set(prev); if (n.has(g)) n.delete(g); else n.add(g); return n; });
    const toggleService = (id: string) =>
        setSelectedService(prev => prev === id ? null : id);

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col h-full bg-background animate-in fade-in duration-200">

            {/* Header + tabs */}
            <div className="shrink-0 px-5 py-4 border-b border-white/5">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <h2 className="text-lg font-bold text-white">Services</h2>
                        <p className="text-xs text-zinc-500 mt-0.5">Runtime intelligence &amp; optimization</p>
                    </div>
                </div>
                <div className="flex">
                    {(["actions", "activity"] as const).map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)}
                            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${activeTab === tab ? "text-white border-primary" : "text-zinc-500 border-transparent hover:text-zinc-300"}`}>
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Actions tab ───────────────────────────────────────────── */}
            {activeTab === "actions" && (
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

                    {/* Health summary */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <HealthCard label="Running" value={String(running.length)} sub="services" color="emerald" />
                        <HealthCard label="Memory" value={totalMemMb > 0 ? fmtMb(totalMemMb) : "—"} sub="total runtime" color={totalMemMb > 4096 ? "red" : "zinc"} />
                        <HealthCard label="CPU" value={totalCpu > 0.1 ? `${totalCpu.toFixed(1)}%` : "—"} sub="total runtime" color={totalCpu > 80 ? "red" : "zinc"} />
                        <HealthCard
                            label="Issues" value={String(issues.length)}
                            sub={issues.length > 0 ? "needs attention" : "all clear"}
                            color={issues.length > 0 ? "amber" : "emerald"}
                        />
                    </div>

                    {/* Attention Needed */}
                    {issues.length > 0 && (
                        <div className="bg-zinc-900 border border-amber-500/20 rounded-xl overflow-hidden">
                            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-amber-500/5">
                                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                                <span className="text-sm font-semibold text-white">Attention Needed</span>
                                <span className="ml-auto text-xs text-zinc-500">{issues.length} issue{issues.length > 1 ? "s" : ""}</span>
                            </div>
                            <div className="divide-y divide-white/4">
                                {issues.map(issue => (
                                    <div key={issue.id} className="flex items-center gap-3 px-4 py-3">
                                        <span className={issue.severity === "warning" ? "text-amber-400" : "text-zinc-500"}>
                                            {issue.severity === "warning"
                                                ? <XCircle className="h-4 w-4 shrink-0" />
                                                : <AlertTriangle className="h-4 w-4 shrink-0" />}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-white">{issue.title}</p>
                                            <p className="text-xs text-zinc-500 truncate mt-0.5">{issue.detail}</p>
                                        </div>
                                        <button
                                            onClick={() => { if (issue.action === "cleanup_containers") handlePruneContainers(); }}
                                            className={`text-xs font-medium px-3 py-1.5 rounded-lg border shrink-0 transition-colors ${
                                                issue.severity === "warning"
                                                    ? "text-amber-400 border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/15"
                                                    : "text-zinc-400 border-zinc-700 bg-zinc-800/50 hover:bg-zinc-700"}`}
                                        >
                                            {issue.cta}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Runtime Intelligence */}
                    {intelligence.lines.length > 0 && (
                        <div className="bg-zinc-900 border border-white/5 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <span className="text-sm font-semibold text-white">Runtime Summary</span>
                            </div>
                            <div className="space-y-1.5 mb-3">
                                {intelligence.lines.map((l, i) => (
                                    <p key={i} className="text-xs text-zinc-400 leading-relaxed">{l}</p>
                                ))}
                            </div>
                            {intelligence.actions.length > 0 && (
                                <div className="pt-3 border-t border-white/5 space-y-1.5">
                                    <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wide">Recommended</p>
                                    {intelligence.actions.map((a, i) => (
                                        <div key={i} className="flex items-center gap-2 text-xs text-zinc-400">
                                            <span className="h-4 w-4 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[9px] font-bold shrink-0">{i + 1}</span>
                                            {a}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Service Groups */}
                    <ServiceGroup id="active-dev" label="Active Development" description="Services linked to your projects"
                        services={activeDev} expanded={expandedGroups.has("active-dev")} onToggle={() => toggleGroup("active-dev")}
                        selectedService={selectedService} onSelectService={toggleService}
                        onDockerAction={handleDockerAction} onKillProcess={onKillProcess} accentColor="emerald" />

                    <ServiceGroup id="background" label="Background Services" description="Databases and utilities"
                        services={backgroundSvcs} expanded={expandedGroups.has("background")} onToggle={() => toggleGroup("background")}
                        selectedService={selectedService} onSelectService={toggleService}
                        onDockerAction={handleDockerAction} onKillProcess={onKillProcess} accentColor="blue" />

                    {orphaned.length > 0 && (
                        <ServiceGroup id="orphaned" label="Unlinked Services" description="No project association — review for cleanup"
                            services={orphaned} expanded={expandedGroups.has("orphaned")} onToggle={() => toggleGroup("orphaned")}
                            selectedService={selectedService} onSelectService={toggleService}
                            onDockerAction={handleDockerAction} onKillProcess={onKillProcess}
                            accentColor="amber" badge="Orphaned" />
                    )}

                    {running.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <Server className="h-10 w-10 text-zinc-700 mb-4" />
                            <p className="text-zinc-400 font-medium">No services running</p>
                            <p className="text-sm text-zinc-600 mt-1">Start Docker containers or dev servers to see them here.</p>
                        </div>
                    )}
                </div>
            )}

            {/* ── Activity tab ──────────────────────────────────────────── */}
            {activeTab === "activity" && (
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

                    {/* Port map */}
                    <div className="bg-zinc-900 border border-white/5 rounded-xl overflow-hidden">
                        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
                            <Network className="h-4 w-4 text-primary shrink-0" />
                            <span className="text-sm font-semibold text-white">Active Ports</span>
                            <span className="ml-auto text-xs text-zinc-600">
                                {(ports || []).filter(p => !SYSTEM_NOISE.includes(p.name?.toLowerCase())).length} active
                            </span>
                        </div>
                        {portConflicts.length > 0 && (
                            <div className="px-4 py-2.5 bg-amber-500/5 border-b border-white/5">
                                <div className="flex items-center gap-2 text-xs text-amber-400">
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                    {portConflicts.length} port conflict{portConflicts.length > 1 ? "s" : ""} detected
                                </div>
                                {portConflicts.map(c => (
                                    <div key={c.port} className="mt-1 ml-5 text-xs text-zinc-500">
                                        Port {c.port}: {c.services.map(s => s.name).join(", ")}
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="divide-y divide-white/4 max-h-64 overflow-y-auto">
                            {(ports || []).filter(p => !SYSTEM_NOISE.includes((p.name || "").toLowerCase())).slice(0, 30).map((p, i) => (
                                <div key={i} className="flex items-center gap-3 px-4 py-2">
                                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                                    <span className="text-xs text-zinc-400 flex-1 truncate">{p.name}</span>
                                    <span className="text-xs text-zinc-600 font-mono shrink-0">:{p.port}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Stopped services */}
                    {stopped.length > 0 && (
                        <div className="bg-zinc-900 border border-white/5 rounded-xl overflow-hidden">
                            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Square className="h-4 w-4 text-zinc-500 shrink-0" />
                                    <span className="text-sm font-semibold text-white">Stopped Services</span>
                                    <span className="text-xs text-zinc-600">({stopped.length})</span>
                                </div>
                                {stoppedContainers.length > 0 && (
                                    <Button size="sm" variant="ghost" className="h-7 text-xs text-zinc-500 hover:text-white" onClick={handlePruneContainers}>
                                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Clean All
                                    </Button>
                                )}
                            </div>
                            <div className="divide-y divide-white/4">
                                {stopped.map(svc => (
                                    <div key={svc.id} className="flex items-center gap-3 px-4 py-2.5 opacity-60">
                                        {catIcon(svc.category, "h-3.5 w-3.5")}
                                        <span className="text-sm text-zinc-400 flex-1 truncate">{svc.displayName}</span>
                                        {svc.port && <span className="text-xs text-zinc-600 font-mono shrink-0">:{svc.port}</span>}
                                        {svc.source === "docker" && svc.rawContainer && (
                                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-zinc-500 hover:text-emerald-400 shrink-0"
                                                onClick={() => handleDockerAction("start", svc.rawContainer!)}>
                                                <Play className="h-3 w-3 mr-0.5" />Start
                                            </Button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {stopped.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <CheckCircle2 className="h-10 w-10 text-zinc-700 mb-4" />
                            <p className="text-zinc-400 font-medium">No stopped services</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function HealthCard({ label, value, sub, color, onClick }: {
    label: string; value: string; sub: string;
    color: "emerald" | "red" | "amber" | "zinc";
    onClick?: () => void;
}) {
    const colors: Record<string, string> = {
        emerald: "text-emerald-400", red: "text-red-400",
        amber: "text-amber-400", zinc: "text-white",
    };
    return (
        <div className={`bg-zinc-900 border border-white/5 rounded-xl p-4 ${onClick ? "cursor-pointer hover:border-white/10 transition-colors" : ""}`} onClick={onClick}>
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-xl font-bold tabular-nums ${colors[color] || "text-white"}`}>{value}</p>
            <p className="text-[10px] text-zinc-600 mt-0.5">{sub}</p>
            {onClick && <div className="flex items-center gap-1 text-[10px] text-primary mt-1">Review <ArrowRight className="h-2.5 w-2.5" /></div>}
        </div>
    );
}

interface ServiceGroupProps {
    id: string; label: string; description: string; services: UnifiedService[];
    expanded: boolean; onToggle: () => void;
    selectedService: string | null; onSelectService: (id: string) => void;
    onDockerAction: (action: "start" | "stop" | "restart", c: DockerContainer) => void;
    onKillProcess: (pid: string, name: string) => void;
    accentColor: "emerald" | "blue" | "amber";
    badge?: string;
}

function ServiceGroup({ label, description, services, expanded, onToggle, selectedService, onSelectService, onDockerAction, onKillProcess, accentColor, badge }: ServiceGroupProps) {
    if (!services || services.length === 0) return null;
    const dotColors = { emerald: "bg-emerald-400", blue: "bg-blue-400", amber: "bg-amber-400" };
    return (
        <div className="bg-zinc-900 border border-white/5 rounded-xl overflow-hidden">
            <button onClick={onToggle}
                className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-white/2 transition-colors border-b border-white/5">
                {expanded ? <ChevronDown className="h-3.5 w-3.5 text-zinc-600 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-600 shrink-0" />}
                <div className={`h-2 w-2 rounded-full ${dotColors[accentColor] || "bg-zinc-500"} shrink-0`} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{label}</span>
                        {badge && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${accentColor === "amber" ? "text-amber-400 border-amber-500/20 bg-amber-500/5" : "text-zinc-400 border-zinc-700 bg-zinc-800"}`}>
                                {badge}
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-zinc-600 truncate">{description}</p>
                </div>
                <span className="text-xs text-zinc-600 shrink-0">{services.length}</span>
            </button>
            {expanded && (
                <div className="divide-y divide-white/4">
                    {services.map(svc => (
                        <ServiceRow key={svc.id} service={svc}
                            isSelected={selectedService === svc.id}
                            onSelect={() => onSelectService(svc.id)}
                            onDockerAction={onDockerAction}
                            onKillProcess={onKillProcess} />
                    ))}
                </div>
            )}
        </div>
    );
}

function ServiceRow({ service, isSelected, onSelect, onDockerAction, onKillProcess }: {
    service: UnifiedService; isSelected: boolean; onSelect: () => void;
    onDockerAction: (a: "start" | "stop" | "restart", c: DockerContainer) => void;
    onKillProcess: (pid: string, name: string) => void;
}) {
    const c = service.rawContainer;
    const p = service.rawPort;
    return (
        <div>
            <div
                role="button"
                tabIndex={0}
                aria-expanded={isSelected}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/2 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                onClick={onSelect}
                onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect(); } }}
            >
                {catIcon(service.category)}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white truncate">{service.displayName}</span>
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                        {service.port && <span className="text-xs text-zinc-500 font-mono">:{service.port}</span>}
                        {service.projectName && <span className="text-xs text-zinc-600 truncate">→ {service.projectName}</span>}
                        {!service.projectName && service.image && <span className="text-xs text-zinc-700 truncate">{(service.image.split(":")[0].split("/").pop()) || service.image}</span>}
                    </div>
                </div>
                {/* Resource metrics */}
                {(service.memMb != null && service.memMb > 0) && (
                    <div className="text-right shrink-0">
                        <p className="text-xs font-medium text-white">{fmtMb(service.memMb)}</p>
                        <p className="text-[10px] text-zinc-600">RAM</p>
                    </div>
                )}
                {(service.cpuPercent != null && service.cpuPercent > 0.1) && (
                    <div className="text-right shrink-0">
                        <p className="text-xs font-medium text-white">{service.cpuPercent.toFixed(1)}%</p>
                        <p className="text-[10px] text-zinc-600">CPU</p>
                    </div>
                )}
                {/* Action buttons */}
                <div className="flex items-center gap-1 shrink-0">
                    {c && (
                        <>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-zinc-500 hover:text-white hover:bg-white/5"
                                onClick={e => { e.stopPropagation(); onDockerAction("restart", c); }} title="Restart">
                                <RotateCw className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                                onClick={e => { e.stopPropagation(); onDockerAction("stop", c); }} title="Stop">
                                <Square className="h-3.5 w-3.5" />
                            </Button>
                        </>
                    )}
                    {p && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                            onClick={e => { e.stopPropagation(); onKillProcess(p.pid, service.displayName); }} title="Kill">
                            <Square className="h-3.5 w-3.5" />
                        </Button>
                    )}
                    {isSelected ? <ChevronDown className="h-3.5 w-3.5 text-zinc-600" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />}
                </div>
            </div>

            {/* Expanded detail */}
            {isSelected && (
                <div className="px-4 pb-4 pt-1 bg-black/10 border-t border-white/4 space-y-2">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                        <DetailPill label="Source" value={service.source === "docker" ? "Docker" : "Process"} />
                        {service.port && <DetailPill label="Port" value={`:${service.port}`} mono />}
                        {service.projectName && <DetailPill label="Project" value={service.projectName} />}
                        {service.image && <DetailPill label="Image" value={(service.image.split(":")[0].split("/").pop()) || service.image} />}
                        {(service.memMb != null && service.memMb > 0) && <DetailPill label="Memory" value={fmtMb(service.memMb)} />}
                        {(service.cpuPercent != null && service.cpuPercent > 0) && <DetailPill label="CPU" value={`${service.cpuPercent.toFixed(1)}%`} />}
                    </div>
                    {service.projectName ? (
                        <div className="text-xs text-emerald-400/80 bg-emerald-500/5 border border-emerald-500/15 rounded-lg px-3 py-2 flex items-start gap-2">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            Used by <strong className="ml-1">{service.projectName}</strong>. Stopping may affect that project.
                        </div>
                    ) : (
                        <div className="text-xs text-amber-400/80 bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2 flex items-start gap-2">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            No project association found. May be safe to stop if not actively used.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function DetailPill({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="bg-black/20 border border-white/5 rounded-lg px-2.5 py-1.5">
            <p className="text-[10px] text-zinc-600 uppercase tracking-wide">{label}</p>
            <p className={`text-xs text-zinc-300 mt-0.5 truncate ${mono ? "font-mono" : ""}`}>{value}</p>
        </div>
    );
}

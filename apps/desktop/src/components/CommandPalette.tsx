import { useState, useEffect, useRef, useMemo } from "react";
import { Search, FolderGit2, Server, Network, ArrowRight, Command, KeyRound, History } from "lucide-react";
import { agentMeta, projectName, timeAgo, type AgentSession } from "@/lib/agents";
import { TabId } from "@/components/Sidebar";

interface PaletteProject {
    name: string;
    path: string;
    stack: string[];
    activity_status: string;
    health_score: number;
}

interface PaletteContainer {
    Names: string;
    ComposeService: string;
    State: string;
    Image: string;
    PortMappings: string[];
    ProjectName: string;
}

interface PalettePort {
    name: string;
    port: string;
    pid: string;
}

interface EnvCache {
    projectName: string;
    projectPath: string;
    keys: string[];
}

interface PaletteResult {
    id: string;
    type: "project" | "service" | "port" | "env" | "session";
    label: string;
    sublabel: string;
    tab: TabId;
    badge?: string;
    badgeColor?: string;
    projectPath?: string;   // set for project + env results
    action?: "env";         // set for env var results → opens env manager
    sessionKey?: string;    // set for session results
}

interface CommandPaletteProps {
    containers: PaletteContainer[];
    ports: PalettePort[];
    sessions: AgentSession[];
    onNavigate: (tab: TabId, payload?: { projectPath?: string; openEnv?: boolean; sessionKey?: string }) => void;
    onClose: () => void;
}

const SYSTEM_NOISE = ["launchd", "sshd", "mdnsresponder", "rapportd", "cupsd", "configd"];

function loadEnvCaches(): EnvCache[] {
    const results: EnvCache[] = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key?.startsWith("devian_env_cache_")) continue;
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const parsed = JSON.parse(raw) as EnvCache;
            if (parsed.projectName && parsed.keys?.length) results.push(parsed);
        }
    } catch {}
    return results;
}

export function CommandPalette({ containers, ports, sessions, onNavigate, onClose }: CommandPaletteProps) {
    const [query, setQuery] = useState("");
    const [cursor, setCursor] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const projects = useMemo<PaletteProject[]>(() => {
        try {
            const cached = localStorage.getItem("devian_projects_cache");
            return cached ? JSON.parse(cached) : [];
        } catch { return []; }
    }, []);

    // Env caches loaded once on mount (snapshot is fine — updated on next project open)
    const envCaches = useMemo(() => loadEnvCaches(), []);

    const results = useMemo<PaletteResult[]>(() => {
        const q = query.trim().toLowerCase();

        const projectResults: PaletteResult[] = projects
            .filter(p =>
                !q ||
                p.name.toLowerCase().includes(q) ||
                (p.stack || []).some(s => s.toLowerCase().includes(q)) ||
                p.path.toLowerCase().includes(q)
            )
            .slice(0, q ? 8 : 5)
            .map(p => ({
                id: `project:${p.path}`,
                type: "project" as const,
                label: p.name,
                sublabel: p.path.replace(/^\/Users\/[^/]+/, "~"),
                tab: "projects" as TabId,
                badge: (p.stack || [])[0],
                badgeColor: "bg-primary/10 text-primary border-primary/20",
                projectPath: p.path,
            }));

        const serviceResults: PaletteResult[] = containers
            .filter(c =>
                !q ||
                (c.ComposeService || c.Names || "").toLowerCase().includes(q) ||
                (c.Image || "").toLowerCase().includes(q) ||
                (c.ProjectName || "").toLowerCase().includes(q)
            )
            .slice(0, q ? 6 : 4)
            .map(c => {
                const name = c.ComposeService || c.Names?.replace(/^\//, "") || c.Image?.split(":")[0] || "Service";
                const port = c.PortMappings?.[0]?.split("->")?.[1]?.split("/")?.[0];
                return {
                    id: `service:${name}`,
                    type: "service" as const,
                    label: name,
                    sublabel: [port ? `:${port}` : "", c.ProjectName].filter(Boolean).join("  ·  "),
                    tab: "runtime" as TabId,
                    badge: c.State === "running" ? "Running" : "Stopped",
                    badgeColor: c.State === "running"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-zinc-800 text-zinc-500 border-zinc-700",
                };
            });

        const portResults: PaletteResult[] = ports
            .filter(p => !SYSTEM_NOISE.includes(p.name.toLowerCase()))
            .filter(p =>
                !q ||
                p.name.toLowerCase().includes(q) ||
                p.port.includes(q)
            )
            .slice(0, q ? 4 : 0)
            .map(p => ({
                id: `port:${p.pid}:${p.port}`,
                type: "port" as const,
                label: p.name,
                sublabel: `Port ${p.port} · PID ${p.pid}`,
                tab: "runtime" as TabId,
            }));

        const sessionResults: PaletteResult[] = sessions
            .filter(s => !q || s.title.toLowerCase().includes(q) || (s.project_path ?? "").toLowerCase().includes(q))
            .slice(0, q ? 6 : 3)
            .map(s => ({
                id: `session:${s.agent}:${s.id}`,
                type: "session" as const,
                label: s.title,
                sublabel: `${agentMeta(s.agent).label} · ${projectName(s.project_path)} · ${timeAgo(s.updated_at)}`,
                tab: "sessions" as TabId,
                sessionKey: `${s.agent}:${s.id}`,
            }));

        // Env var results — only shown when there's a query
        const envResults: PaletteResult[] = !q ? [] : envCaches.flatMap(cache =>
            cache.keys
                .filter(k => k.toLowerCase().includes(q))
                .slice(0, 5)
                .map(k => ({
                    id: `env:${cache.projectPath}:${k}`,
                    type: "env" as const,
                    label: k,
                    sublabel: cache.projectName,
                    tab: "projects" as TabId,
                    badge: ".env",
                    badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
                    projectPath: cache.projectPath,
                    action: "env" as const,
                }))
        ).slice(0, 8);

        if (!q) return [...sessionResults, ...projectResults, ...serviceResults];
        return [...sessionResults, ...projectResults, ...serviceResults, ...portResults, ...envResults];
    }, [query, projects, containers, ports, envCaches, sessions]);

    useEffect(() => { setCursor(0); }, [query]);

    useEffect(() => {
        const el = listRef.current?.children[cursor] as HTMLElement;
        el?.scrollIntoView({ block: "nearest" });
    }, [cursor]);

    const handleSelect = (item: PaletteResult) => {
        if (item.sessionKey) {
            onNavigate(item.tab, { sessionKey: item.sessionKey });
        } else if (item.projectPath) {
            onNavigate(item.tab, {
                projectPath: item.projectPath,
                openEnv: item.action === "env",
            });
        } else {
            onNavigate(item.tab);
        }
        onClose();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor(c => Math.min(c + 1, results.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor(c => Math.max(c - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (results[cursor]) handleSelect(results[cursor]);
        } else if (e.key === "Escape") {
            onClose();
        }
    };

    const typeIcon = (type: PaletteResult["type"]) => {
        if (type === "project") return <FolderGit2 className="h-4 w-4 text-zinc-500 shrink-0" />;
        if (type === "service") return <Server className="h-4 w-4 text-zinc-500 shrink-0" />;
        if (type === "env") return <KeyRound className="h-4 w-4 text-zinc-500 shrink-0" />;
        if (type === "session") return <History className="h-4 w-4 text-zinc-500 shrink-0" />;
        return <Network className="h-4 w-4 text-zinc-500 shrink-0" />;
    };

    const typeGroups = useMemo(() => {
        const seen = new Set<string>();
        return results.map((r, i) => ({ ...r, showHeader: !seen.has(r.type) && (seen.add(r.type), true), index: i }));
    }, [results]);

    const groupLabels: Record<PaletteResult["type"], string> = {
        project: "Projects",
        service: "Services",
        port: "Ports",
        env: "Environment Variables",
        session: "Agent sessions",
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-xs"
            onClick={onClose}
        >
            <div
                className="w-full max-w-xl bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Input */}
                <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/10">
                    <Search className="h-4 w-4 text-zinc-500 shrink-0" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Search sessions, projects, services, env vars..."
                        className="flex-1 bg-transparent text-sm text-white placeholder:text-zinc-600 outline-hidden"
                    />
                    <kbd className="text-[10px] text-zinc-600 border border-zinc-700 rounded px-1.5 py-0.5 font-mono">esc</kbd>
                </div>

                {/* Results */}
                <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
                    {results.length === 0 && (
                        <div className="px-4 py-8 text-center text-sm text-zinc-600">
                            {query ? "No results found." : "Start typing to search."}
                        </div>
                    )}
                    {typeGroups.map(item => (
                        <div key={item.id}>
                            {item.showHeader && (
                                <div className="px-4 pt-3 pb-1">
                                    <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">
                                        {groupLabels[item.type]}
                                    </span>
                                </div>
                            )}
                            <button
                                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                                    item.index === cursor ? "bg-primary/10" : "hover:bg-white/5"
                                }`}
                                onClick={() => handleSelect(item)}
                                onMouseEnter={() => setCursor(item.index)}
                            >
                                {typeIcon(item.type)}
                                <div className="flex-1 min-w-0">
                                    <div className={`text-sm font-medium text-white truncate ${item.type === "env" ? "font-mono" : ""}`}>
                                        {item.label}
                                    </div>
                                    {item.sublabel && (
                                        <div className="text-xs text-zinc-600 truncate">{item.sublabel}</div>
                                    )}
                                </div>
                                {item.badge && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${item.badgeColor || "bg-zinc-800 text-zinc-500 border-zinc-700"}`}>
                                        {item.badge}
                                    </span>
                                )}
                                {item.index === cursor && (
                                    <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0" />
                                )}
                            </button>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="flex items-center gap-4 px-4 py-2.5 border-t border-white/5 bg-zinc-950/50">
                    <div className="flex items-center gap-1.5 text-[11px] text-zinc-600">
                        <Command className="h-3 w-3" /><span>K</span>
                        <span>to toggle</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-zinc-600">
                        <kbd className="border border-zinc-700 rounded px-1 font-mono">↑↓</kbd>
                        <span>navigate</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-zinc-600">
                        <kbd className="border border-zinc-700 rounded px-1 font-mono">↵</kbd>
                        <span>open</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

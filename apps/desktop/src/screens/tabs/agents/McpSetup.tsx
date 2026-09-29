import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Cable, Check, CheckCircle2, ChevronDown, Copy, Loader2, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AgentChip } from "@/components/agents/AgentBits";
import { AGENT_IDS, AgentId, agentMeta, shortPath } from "@/lib/agents";
import { track } from "@/lib/telemetry";

interface McpInfo {
    executable: string;
    args: string[];
    /** Set when Devian runs from a temporary location that mustn't go into configs. */
    warning: string | null;
}

export interface McpStatus {
    agent: AgentId;
    connected: boolean;
    can_connect: boolean;
    config_path: string;
    note: string | null;
}

function snippet(agent: AgentId, exe: string): string {
    const json = JSON.stringify({ mcpServers: { devian: { command: exe, args: ["--mcp"] } } }, null, 2);
    switch (agent) {
        case "claude":
            return `claude mcp add devian --scope user -- "${exe}" --mcp`;
        case "codex":
            return `[mcp_servers.devian]\ncommand = "${exe}"\nargs = ["--mcp"]`;
        case "opencode":
            return JSON.stringify({ mcp: { devian: { type: "local", command: [exe, "--mcp"] } } }, null, 2);
        default:
            return json;
    }
}

const TOOLS = [
    ["list_dev_servers", "what's on which port, for which project, started by which agent"],
    ["get_free_port", "a free port instead of guessing 3000 again"],
    ["project_runtime", "servers and containers already running for a project"],
    ["agent_leftovers", "what earlier sessions left running"],
    ["recent_agent_activity", "what other agents recently did in this project"],
];

export function useMcpStatus() {
    const [status, setStatus] = useState<McpStatus[] | null>(null);
    const refresh = useCallback(() => {
        invoke<McpStatus[]>("agents_mcp_status").then(setStatus).catch(() => setStatus([]));
    }, []);
    useEffect(refresh, [refresh]);
    return { status, refresh };
}

/** One row per agent: connected state, one-click connect, or a snippet to copy. */
export function McpConnectList({ installed, onChange }: { installed?: AgentId[]; onChange?: () => void }) {
    const { toast } = useToast();
    const { status, refresh } = useMcpStatus();
    const [info, setInfo] = useState<McpInfo | null>(null);
    const [busy, setBusy] = useState<AgentId | null>(null);
    const [open, setOpen] = useState<AgentId | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        invoke<McpInfo>("agents_mcp_info").then(setInfo).catch(() => setInfo(null));
    }, []);

    const exe = info?.executable ?? "/Applications/Devian.app/Contents/MacOS/devian-desktop";
    const order = AGENT_IDS.filter(a => !installed || installed.includes(a));

    const connect = async (agent: AgentId) => {
        setBusy(agent);
        try {
            const msg = await invoke<string>("agents_mcp_connect", { agent });
            track("mcp_connected", { agent });
            toast({ title: `Connected to ${agentMeta(agent).label}`, description: msg });
            refresh();
            onChange?.();
        } catch (e) {
            toast({ variant: "destructive", title: `Couldn't connect ${agentMeta(agent).label}`, description: String(e) });
            setOpen(agent);
        } finally {
            setBusy(null);
        }
    };

    const copy = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard unavailable */ }
    };

    if (!status) {
        return <div className="flex items-center gap-2 text-sm text-zinc-500 py-2"><Loader2 className="h-4 w-4 animate-spin" /> Checking agent configs…</div>;
    }

    const blocked = info?.warning ?? null;

    return (
        <div className="rounded-xl border border-white/5 divide-y divide-white/5 overflow-hidden">
            {blocked && (
                <p className="px-4 py-3 text-xs text-amber-200 bg-amber-500/10 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" /> {blocked}
                </p>
            )}
            {order.map(agent => {
                const s = status.find(x => x.agent === agent);
                if (!s) return null;
                return (
                    <div key={agent} className="bg-zinc-900/40">
                        <div className="flex items-center gap-3 px-4 py-3">
                            <AgentChip agent={agent} className="w-32 text-sm" />
                            <span className="flex-1 text-xs text-zinc-500 truncate" title={s.config_path}>
                                {s.connected ? shortPath(s.config_path) : s.note ?? shortPath(s.config_path)}
                            </span>
                            {s.connected ? (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                                    <CheckCircle2 className="h-4 w-4" /> Connected
                                </span>
                            ) : (
                                <>
                                    <button onClick={() => setOpen(open === agent ? null : agent)} className="text-xs text-zinc-500 hover:text-white inline-flex items-center gap-1">
                                        Manual <ChevronDown className={`h-3 w-3 transition-transform ${open === agent ? "rotate-180" : ""}`} />
                                    </button>
                                    {s.can_connect && (
                                        <Button size="sm" variant="secondary" disabled={busy !== null || !!blocked} onClick={() => connect(agent)}>
                                            {busy === agent ? <Loader2 className="animate-spin" /> : <Plug />} Connect
                                        </Button>
                                    )}
                                </>
                            )}
                        </div>
                        {open === agent && !s.connected && (
                            <div className="px-4 pb-3">
                                <p className="text-[11px] text-zinc-500 mb-1.5">
                                    {agent === "claude" ? "Run in a terminal:" : `Add to ${shortPath(s.config_path)}:`}
                                </p>
                                <div className="relative">
                                    <pre className="rounded-lg bg-black/40 border border-white/10 p-3 pr-10 text-[11px] font-mono text-zinc-200 whitespace-pre-wrap break-all">{snippet(agent, exe)}</pre>
                                    <button onClick={() => copy(snippet(agent, exe))} className="absolute top-2 right-2 p-1 rounded text-zinc-400 hover:text-white hover:bg-white/10" aria-label="Copy snippet">
                                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
            {/[\\/]target[\\/](debug|release)[\\/]/.test(exe) && (
                <p className="px-4 py-2 text-[11px] text-amber-300 bg-amber-500/5">Development build: connections point at your build folder. Use the installed app for everyday use.</p>
            )}
        </div>
    );
}

export function McpSetup() {
    return (
        <div className="space-y-4">
            <McpConnectList />
            <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
                <p className="flex items-center gap-2 text-xs font-medium text-zinc-300 mb-2">
                    <Cable className="h-3.5 w-3.5 text-primary" /> Read-only tools agents get
                </p>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                {TOOLS.map(([name, desc]) => (
                    <li key={name} className="flex gap-2">
                        <code className="text-zinc-200 font-mono shrink-0">{name}</code>
                        <span className="text-zinc-500">{desc}</span>
                    </li>
                ))}
                </ul>
            </div>
            <p className="text-[11px] text-zinc-600">Config files Devian edits are backed up next to the original as <code>*.devian-backup</code> first.</p>
        </div>
    );
}

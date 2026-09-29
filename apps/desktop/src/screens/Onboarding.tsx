import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, ArrowLeft, ArrowRight, Brain, CheckCircle2, History, Loader2, Lock, Server, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgentDot } from "@/components/agents/AgentBits";
import { McpConnectList } from "@/screens/tabs/agents/McpSetup";
import { AGENT_IDS, AgentId, AgentInfo, AgentSession, RuntimeReport, agentMeta, fmtTokens, localDayKey, tokensSince } from "@/lib/agents";
import { PREF, writePref } from "@/lib/prefs";
import { setTelemetryConsent, telemetryConfigured, track } from "@/lib/telemetry";
import devianLogo from "../../src-tauri/icons/128x128.png";

type Step = "welcome" | "scan" | "connect" | "finish";
const STEPS: Step[] = ["welcome", "scan", "connect", "finish"];

const EDITORS = ["VS Code", "Cursor", "Antigravity", "IntelliJ", "Sublime Text"];

interface Scan {
    agents: AgentInfo[];
    sessions: AgentSession[];
    runtime: RuntimeReport | null;
}

export default function Onboarding({ onComplete }: { onComplete: () => void }) {
    const [step, setStep] = useState<Step>("welcome");
    const [scan, setScan] = useState<Scan | null>(null);
    const [scanError, setScanError] = useState<string | null>(null);
    const [editor, setEditor] = useState("VS Code");
    const [terminal, setTerminal] = useState("Native Terminal");
    const [notify, setNotify] = useState(true);
    const [usage, setUsage] = useState(false);

    useEffect(() => {
        track("onboarding_step", { step });
    }, [step]);

    useEffect(() => {
        invoke<{ terminal: string; editor: string }>("get_user_settings")
            .then(s => { if (s.editor) setEditor(s.editor); if (s.terminal) setTerminal(s.terminal); })
            .catch(() => {});
    }, []);

    // Start scanning as soon as the user asks; results reveal on the scan step.
    const startScan = () => {
        setStep("scan");
        if (scan) return;
        Promise.all([
            invoke<AgentInfo[]>("agents_detect"),
            invoke<AgentSession[]>("agents_list_sessions"),
            invoke<RuntimeReport>("agents_runtime").catch(() => null),
        ])
            .then(([agents, sessions, runtime]) => setScan({ agents, sessions, runtime }))
            .catch(e => setScanError(String(e)));
    };

    const finish = async () => {
        try {
            await invoke("save_user_settings", { terminal, editor });
        } catch { /* keep going; settings can be changed later */ }
        writePref(PREF.notifyLeftovers, notify);
        if (telemetryConfigured) setTelemetryConsent(usage);
        writePref(PREF.onboarded, true);
        writePref(PREF.activeTab, "overview");
        track("onboarding_completed", { agents: scan?.agents.filter(a => a.installed).map(a => a.id) });
        onComplete();
    };

    const index = STEPS.indexOf(step);
    const installed = scan?.agents.filter(a => a.installed).map(a => a.id) ?? [];

    return (
        <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
            <header className="shrink-0 flex items-center justify-between px-8 pt-6">
                <div className="flex items-center gap-2.5">
                    <img src={devianLogo} alt="" className="h-7 w-7" />
                    <span className="font-semibold text-white">Devian</span>
                </div>
                <div className="flex items-center gap-1.5" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
                    {STEPS.map((s, i) => (
                        <span key={s} className={`h-1.5 rounded-full transition-all ${i === index ? "w-6 bg-primary" : i < index ? "w-1.5 bg-primary/60" : "w-1.5 bg-white/15"}`} />
                    ))}
                </div>
            </header>

            <main className="flex-1 overflow-y-auto flex items-center justify-center px-8 py-8">
                <div key={step} className="w-full max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
                    {step === "welcome" && <Welcome onNext={startScan} />}
                    {step === "scan" && <ScanStep scan={scan} error={scanError} />}
                    {step === "connect" && <ConnectStep installed={installed} />}
                    {step === "finish" && (
                        <FinishStep
                            editor={editor} setEditor={setEditor}
                            notify={notify} setNotify={setNotify}
                            usage={usage} setUsage={setUsage}
                        />
                    )}
                </div>
            </main>

            {step !== "welcome" && (
                <footer className="shrink-0 flex items-center justify-between px-8 py-5 border-t border-white/5">
                    <Button variant="ghost" className="text-zinc-400" onClick={() => setStep(STEPS[index - 1])}>
                        <ArrowLeft /> Back
                    </Button>
                    {step === "scan" && (
                        <Button disabled={!scan && !scanError} onClick={() => setStep(installed.length > 0 ? "connect" : "finish")}>
                            Continue <ArrowRight />
                        </Button>
                    )}
                    {step === "connect" && (
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" className="text-zinc-400" onClick={() => setStep("finish")}>Skip for now</Button>
                            <Button onClick={() => setStep("finish")}>Continue <ArrowRight /></Button>
                        </div>
                    )}
                    {step === "finish" && <Button onClick={finish}>Open Devian <ArrowRight /></Button>}
                </footer>
            )}
        </div>
    );
}

function Welcome({ onNext }: { onNext: () => void }) {
    const points = [
        { icon: History, title: "Every session, one timeline", body: "What you asked, the commands agents ran and the files they changed, with risky moves flagged." },
        { icon: Server, title: "Nothing left running", body: "Dev servers and containers an agent forgot are traced back to it and stopped in one click." },
        { icon: Brain, title: "Memory and usage in view", body: "Read what agents remember about you, and see the tokens they use per project." },
    ];
    return (
        <div className="text-center">
            <h1 className="text-4xl font-bold tracking-tight text-white leading-tight">
                Your agents do the work.<br />You stay in control.
            </h1>
            <p className="text-zinc-400 mt-4 max-w-lg mx-auto leading-relaxed">
                Devian shows what Claude Code, Codex, Cursor, OpenCode and Antigravity actually did on this machine.
            </p>
            <div className="grid grid-cols-3 gap-3 mt-10 text-left">
                {points.map(p => (
                    <div key={p.title} className="rounded-xl border border-white/5 bg-zinc-900/50 p-4">
                        <p.icon className="h-5 w-5 text-primary" />
                        <p className="text-sm font-semibold text-white mt-3">{p.title}</p>
                        <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{p.body}</p>
                    </div>
                ))}
            </div>
            <Button size="lg" className="mt-10 h-11 px-8 rounded-xl" onClick={onNext}>
                Find my agents <ArrowRight />
            </Button>
            <p className="mt-4 text-xs text-zinc-500 flex items-center justify-center gap-1.5">
                <Lock className="h-3.5 w-3.5" /> Reads agent history in place. Nothing leaves your machine, and no special permissions are needed.
            </p>
        </div>
    );
}

function ScanStep({ scan, error }: { scan: Scan | null; error: string | null }) {
    // Reveal agents one by one so the scan reads as progress rather than a spinner.
    const [revealed, setRevealed] = useState(0);
    useEffect(() => {
        if (!scan) return;
        if (revealed >= AGENT_IDS.length) return;
        const t = setTimeout(() => setRevealed(r => r + 1), 220);
        return () => clearTimeout(t);
    }, [scan, revealed]);

    const stats = useMemo(() => {
        if (!scan) return null;
        const week = new Date();
        week.setDate(week.getDate() - 6);
        return {
            sessions: scan.sessions.length,
            projects: new Set(scan.sessions.map(s => s.project_path).filter(Boolean)).size,
            week: tokensSince(scan.sessions, localDayKey(week)),
            risky: scan.sessions.reduce((n, s) => n + s.risky_count, 0),
            leftovers: scan.runtime?.leftover_count ?? 0,
        };
    }, [scan]);

    const done = scan && revealed >= AGENT_IDS.length;
    const found = scan?.agents.filter(a => a.installed) ?? [];

    return (
        <div>
            <h2 className="text-2xl font-bold text-white">{done ? (found.length ? "Here's what your agents have been up to" : "No agents found yet") : "Looking for your agents…"}</h2>
            <p className="text-sm text-zinc-500 mt-1">
                {!done
                    ? "Reading their local history. This takes a few seconds the first time."
                    : found.length
                        ? "Read straight from their local history on this machine. Nothing was uploaded."
                        : "Devian supports the agents below. Once you use one, its sessions show up here automatically."}
            </p>

            {error && <p className="text-sm text-red-400 mt-4">{error}</p>}

            <div className="mt-6 rounded-xl border border-white/5 divide-y divide-white/5 overflow-hidden">
                {AGENT_IDS.map((id, i) => {
                    const info = scan?.agents.find(a => a.id === id);
                    const shown = !!scan && i < revealed;
                    const mine = scan?.sessions.filter(s => s.agent === id) ?? [];
                    return (
                        <div key={id} className="flex items-center gap-3 px-4 py-3 bg-zinc-900/40">
                            <AgentDot agent={id} />
                            <span className="text-sm text-white w-32">{agentMeta(id).label}</span>
                            <span className="flex-1 text-xs text-zinc-500">
                                {!shown ? "" : info?.warning ? <span className="text-amber-300" title={info.warning}>Found, but couldn't read its history</span> : !info?.installed ? "Not installed" : `${mine.length} session${mine.length === 1 ? "" : "s"}${info.support === "partial" ? " · partial history" : ""}`}
                            </span>
                            {!shown ? (
                                <Loader2 className="h-4 w-4 text-zinc-600 animate-spin" />
                            ) : info?.installed ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                            ) : (
                                <span className="h-4 w-4 rounded-full border border-white/10" />
                            )}
                        </div>
                    );
                })}
            </div>

            {done && stats && found.length > 0 && (
                <div className="grid grid-cols-2 gap-3 mt-4 animate-in fade-in duration-500">
                    <Finding value={String(stats.sessions)} label={`sessions across ${stats.projects} project${stats.projects === 1 ? "" : "s"}`} />
                    <Finding value={fmtTokens(stats.week)} label="tokens in the last 7 days" />
                    <Finding
                        value={String(stats.risky)}
                        label="risky actions flagged, like force pushes and sudo"
                        warn={stats.risky > 0}
                    />
                    <Finding
                        value={String(stats.leftovers)}
                        label={stats.leftovers ? "things agents left running right now" : "leftover processes running"}
                        warn={stats.leftovers > 0}
                    />
                </div>
            )}
        </div>
    );
}

function Finding({ value, label, warn }: { value: string; label: string; warn?: boolean }) {
    return (
        <div className={`rounded-xl border px-4 py-3 ${warn ? "border-amber-500/25 bg-amber-500/5" : "border-white/5 bg-zinc-900/50"}`}>
            <p className="text-2xl font-semibold text-white tabular-nums flex items-center gap-2">
                {value}
                {warn && <AlertTriangle className="h-4 w-4 text-amber-400" />}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
        </div>
    );
}

function ConnectStep({ installed }: { installed: AgentId[] }) {
    return (
        <div>
            <h2 className="text-2xl font-bold text-white">Let your agents ask Devian</h2>
            <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
                Connected agents can check what's already running before starting another dev server, pick a free port, and see
                what other agents did in the same project. Devian is read-only to them: it can't stop or change anything.
            </p>
            <div className="mt-6">
                <McpConnectList installed={installed} />
            </div>
            <p className="text-xs text-zinc-600 mt-3">Devian backs up any config file before editing it. You can change this later in Settings.</p>
        </div>
    );
}

function FinishStep({ editor, setEditor, notify, setNotify, usage, setUsage }: {
    editor: string; setEditor: (v: string) => void;
    notify: boolean; setNotify: (v: boolean) => void;
    usage: boolean; setUsage: (v: boolean) => void;
}) {
    return (
        <div>
            <Sparkles className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-bold text-white mt-3">A couple of preferences</h2>
            <div className="mt-6 space-y-4">
                <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-4 flex items-center gap-4">
                    <div className="flex-1">
                        <p className="text-sm font-medium text-white">Open whole projects in</p>
                        <p className="text-xs text-zinc-500 mt-0.5">Memory and instruction files are edited right inside Devian.</p>
                    </div>
                    <Select value={editor} onValueChange={setEditor}>
                        <SelectTrigger className="w-44 bg-white/5 border-white/10 text-white"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-[#1a1a1e] border-white/10 text-white">
                            {EDITORS.map(e => <SelectItem key={e} value={e} className="text-white focus:bg-white/10 focus:text-white">{e}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <label className="rounded-xl border border-white/5 bg-zinc-900/40 p-4 flex items-start gap-3 cursor-pointer">
                    <Checkbox checked={notify} onCheckedChange={v => setNotify(v === true)} className="mt-0.5" />
                    <div>
                        <p className="text-sm font-medium text-white">Tell me when an agent leaves something running</p>
                        <p className="text-xs text-zinc-500 mt-0.5">A system notification when a session ends but its dev server, test runner or container keeps going.</p>
                    </div>
                </label>
                {telemetryConfigured && (
                    <label className="rounded-xl border border-white/5 bg-zinc-900/40 p-4 flex items-start gap-3 cursor-pointer">
                        <Checkbox checked={usage} onCheckedChange={v => setUsage(v === true)} className="mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-white">Share anonymous usage data and error reports</p>
                            <p className="text-xs text-zinc-500 mt-0.5">Which features get used and what breaks, so we fix the right things. Never your code, prompts, project names or agent history. Off unless you tick it.</p>
                        </div>
                    </label>
                )}
            </div>
        </div>
    );
}

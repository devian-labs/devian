import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, ArrowRight, Bot, Check, ChevronRight, CircleCheck, HardDrive, Loader2, Server, ShieldAlert, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { TabId } from "@/components/Sidebar";
import { AgentChip, AgentDot } from "@/components/agents/AgentBits";
import {
    AGENT_IDS, AgentInfo, AgentSession, DirtItem, RunningAgent, RuntimeReport, agentMeta, dailyByAgent, fmtBytes, fmtDuration,
    fmtTokens, localDayKey, projectName, shortPath, timeAgo, tokensSince,
} from "@/lib/agents";
import { PREF, ReviewedMap, isReviewed, usePref, writePref } from "@/lib/prefs";
import { useMcpStatus } from "./McpSetup";
import { track } from "@/lib/telemetry";

interface Props {
    sessions: AgentSession[];
    sessionsLoading: boolean;
    runtime: RuntimeReport | null;
    agents: AgentInfo[];
    setActiveTab: (tab: TabId) => void;
    openSession: (s: AgentSession) => void;
    openFlagged: () => void;
    onRuntimeChanged: () => void;
}

const sessionKey = (s: AgentSession) => `${s.agent}:${s.id}`;

export function OverviewTab({ sessions, sessionsLoading, runtime, agents, setActiveTab, openSession, openFlagged, onRuntimeChanged }: Props) {
    const { toast } = useToast();
    const [dirt, setDirt] = useState<DirtItem[] | null>(null);
    const [stopping, setStopping] = useState(false);
    const [reviewed] = usePref<ReviewedMap>(PREF.reviewed, {});

    useEffect(() => {
        invoke<DirtItem[]>("agents_scan_dirt", { days: 30 }).then(setDirt).catch(() => setDirt([]));
    }, []);

    // ── Derived numbers ──────────────────────────────────────────────────────
    const week = useMemo(() => {
        const days = dailyByAgent(sessions, 7);
        const tokens = days.map(d => d.total);
        const today = tokens[tokens.length - 1] ?? 0;
        const prior = tokens.slice(0, -1);
        const avg = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : 0;
        const perDay = days.map(d => sessions.filter(s => localDayKey(new Date(s.updated_at)) === d.day).length);
        const start = new Date();
        start.setDate(start.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        const recent = sessions.filter(s => s.updated_at >= start.getTime());
        const flagged = recent.filter(s => s.risky_count > 0);
        return {
            labels: days.map(d => d.day),
            tokens, today, avg,
            weekTokens: tokens.reduce((a, b) => a + b, 0),
            perDay,
            sessionCount: recent.length,
            projects: new Set(recent.map(s => s.project_path).filter(Boolean)).size,
            risky: recent.reduce((n, s) => n + s.risky_count, 0),
            unreviewed: flagged.filter(s => !isReviewed(reviewed, sessionKey(s), s.updated_at)),
        };
    }, [sessions, reviewed]);

    const leftovers = runtime?.items.filter(i => i.leftover) ?? [];
    const reclaimable = (dirt ?? []).reduce((n, d) => n + d.size_bytes, 0);
    const unreadable = agents.filter(a => a.warning);
    const noAgents = agents.length > 0 && !agents.some(a => a.installed) && !sessionsLoading && sessions.length === 0;

    const stopAll = async () => {
        setStopping(true);
        try {
            const n = await invoke<number>("agents_stop", { keys: leftovers.map(l => l.key) });
            track("leftovers_stopped", { count: n, from: "overview" });
            toast({ title: "Stopped leftovers", description: `${n} item${n === 1 ? "" : "s"} stopped.` });
            onRuntimeChanged();
        } catch (e) {
            toast({ variant: "destructive", title: "Couldn't stop everything", description: String(e) });
        } finally {
            setStopping(false);
        }
    };

    if (noAgents) return <NoAgents agents={agents} />;

    // ── Attention items, most urgent first ───────────────────────────────────
    const attention: AttentionItem[] = [];
    if (leftovers.length) {
        const inferred = leftovers.some(l => l.confidence === "likely");
        const who = [...new Set(leftovers.map(l => agentMeta(l.agent).label))].join(" and ");
        attention.push({
            key: "leftovers",
            icon: <Server className="h-4 w-4 text-amber-400" />,
            title: `${who} left ${leftovers.length} thing${leftovers.length === 1 ? "" : "s"} running${runtime?.leftover_memory_bytes ? ` · ${fmtBytes(runtime.leftover_memory_bytes)}` : ""}`,
            detail: leftovers.slice(0, 3).map(l => `${l.name}${l.ports.length ? ` :${l.ports[0]}` : ""} in ${projectName(l.project_path)}`).join(" · "),
            actions: inferred ? (
                // Inferred matches could be the user's own processes: confirm on Runtime.
                <Button size="sm" className="bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 border border-amber-500/30" onClick={() => setActiveTab("runtime")}>Review and stop</Button>
            ) : (
                <>
                    <Button size="sm" variant="ghost" className="text-zinc-400" onClick={() => setActiveTab("runtime")}>Review</Button>
                    <Button size="sm" className="bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 border border-amber-500/30" disabled={stopping} onClick={stopAll}>
                        {stopping ? <Loader2 className="animate-spin" /> : <Square />} Stop all
                    </Button>
                </>
            ),
        });
    }
    if (week.unreviewed.length) {
        const n = week.unreviewed.length;
        attention.push({
            key: "review",
            icon: <ShieldAlert className="h-4 w-4 text-amber-400" />,
            title: `${n} session${n === 1 ? "" : "s"} with risky actions to review`,
            detail: week.unreviewed.slice(0, 2).map(s => `"${s.title}"`).join(" · "),
            actions: <Button size="sm" variant="secondary" onClick={openFlagged}>Review</Button>,
        });
    }
    for (const a of unreadable) {
        attention.push({
            key: `warn-${a.id}`,
            icon: <AlertTriangle className="h-4 w-4 text-amber-400" />,
            title: `Couldn't read ${a.name} history`,
            detail: a.warning ?? "",
        });
    }
    if (reclaimable > 1024 ** 3) {
        attention.push({
            key: "cleanup",
            icon: <HardDrive className="h-4 w-4 text-zinc-400" />,
            title: `${fmtBytes(reclaimable)} of old agent data`,
            detail: "Old transcripts, checkpoints, snapshots and caches",
            actions: <Button size="sm" variant="ghost" className="text-zinc-300" onClick={() => setActiveTab("cleanup")}>Clean up</Button>,
        });
    }

    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    // Live agent count lives in the top bar; the header summarises what needs doing.
    const summary: ReactNode[] = [];
    if (leftovers.length) summary.push(<span key="l" className="text-amber-300">{leftovers.length} left running</span>);
    if (week.unreviewed.length) summary.push(<span key="r" className="text-amber-300">{week.unreviewed.length} session{week.unreviewed.length === 1 ? "" : "s"} to review</span>);
    if (!summary.length) summary.push(`${week.sessionCount} session${week.sessionCount === 1 ? "" : "s"} this week, nothing waiting on you`);

    const vsAvg = week.avg > 0 ? week.today / week.avg : null;

    return (
        <div className="flex-1 overflow-y-auto animate-in fade-in duration-200">
            <div className="w-full max-w-[1600px] px-6 py-6 space-y-5">
                <header className="flex items-end justify-between gap-4">
                    <div>
                        <h1 className="text-xl font-semibold text-white">{greeting}</h1>
                        <p className="text-sm text-zinc-500 mt-1 flex flex-wrap items-center gap-x-2">
                            {summary.map((s, i) => (
                                <span key={i} className="inline-flex items-center gap-2">
                                    {i > 0 && <span className="text-zinc-700">·</span>}
                                    {s}
                                </span>
                            ))}
                        </p>
                    </div>
                    <p className="text-xs text-zinc-600 shrink-0">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
                </header>

                <AttentionCard items={attention} loading={runtime === null || dirt === null} />

                <SetupStrip setActiveTab={setActiveTab} openFlagged={openFlagged} unreviewed={week.unreviewed.length} />

                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                    <Kpi
                        label="Tokens today"
                        value={fmtTokens(week.today)}
                        sub={vsAvg === null ? `${fmtTokens(week.weekTokens)} this week` : vsAvg >= 1.15 ? `${vsAvg.toFixed(1)}× your daily average` : vsAvg <= 0.85 ? "Below your daily average" : "About your daily average"}
                        spark={{ values: week.tokens, labels: week.labels, format: fmtTokens }}
                        onClick={() => setActiveTab("usage")}
                    />
                    <Kpi
                        label="Sessions this week"
                        value={String(week.sessionCount)}
                        sub={`Across ${week.projects} project${week.projects === 1 ? "" : "s"}`}
                        spark={{ values: week.perDay, labels: week.labels, format: v => `${v} session${v === 1 ? "" : "s"}` }}
                        onClick={() => setActiveTab("sessions")}
                    />
                    <Kpi
                        label="Risky actions this week"
                        value={String(week.risky)}
                        sub={week.unreviewed.length ? `${week.unreviewed.length} session${week.unreviewed.length === 1 ? "" : "s"} not reviewed` : week.risky ? "All reviewed" : "Nothing flagged"}
                        tone={week.unreviewed.length ? "warn" : "default"}
                        onClick={openFlagged}
                    />
                    <Kpi
                        label="Agent data to clean"
                        value={dirt === null ? "…" : fmtBytes(reclaimable)}
                        sub="Older than 30 days"
                        onClick={() => setActiveTab("cleanup")}
                    />
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
                    <Card
                        className="xl:col-span-8"
                        title="Recent sessions"
                        action={{ label: "All sessions", onClick: () => setActiveTab("sessions") }}
                    >
                        {sessionsLoading && sessions.length === 0 ? (
                            <SkeletonRows n={6} />
                        ) : sessions.length === 0 ? (
                            <p className="px-4 py-8 text-sm text-zinc-500 text-center">No sessions yet. Start one in any supported agent and it shows up here.</p>
                        ) : (
                            <div className="divide-y divide-white/5">
                                {sessions.slice(0, 8).map(s => (
                                    <SessionRow key={sessionKey(s)} s={s} open={s.risky_count > 0 && !isReviewed(reviewed, sessionKey(s), s.updated_at)} onClick={() => openSession(s)} />
                                ))}
                            </div>
                        )}
                    </Card>

                    <div className="xl:col-span-4 space-y-4">
                        <Card title="Working now" action={{ label: "Runtime", onClick: () => setActiveTab("runtime") }}>
                            <WorkingNow runtime={runtime} sessions={sessions} openSession={openSession} />
                        </Card>
                        <Card title="Agents" subtitle="Last 30 days" action={{ label: "Usage", onClick: () => setActiveTab("usage") }}>
                            <AgentsSummary agents={agents} sessions={sessions} />
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Building blocks ─────────────────────────────────────────────────────────

function Card({ title, subtitle, action, className = "", children }: {
    title: string; subtitle?: string; action?: { label: string; onClick: () => void }; className?: string; children: ReactNode;
}) {
    return (
        <section className={`rounded-xl border border-white/[0.06] bg-zinc-900/40 overflow-hidden ${className}`}>
            <div className="flex items-center gap-2 px-4 h-11 border-b border-white/5">
                <h3 className="text-sm font-semibold text-white">{title}</h3>
                {subtitle && <span className="text-xs text-zinc-600">{subtitle}</span>}
                {action && (
                    <button onClick={action.onClick} className="ml-auto text-xs text-zinc-500 hover:text-white inline-flex items-center gap-1 transition-colors">
                        {action.label} <ArrowRight className="h-3 w-3" />
                    </button>
                )}
            </div>
            {children}
        </section>
    );
}

interface AttentionItem {
    key: string;
    icon: ReactNode;
    title: string;
    detail: string;
    actions?: ReactNode;
}

function AttentionCard({ items, loading }: { items: AttentionItem[]; loading: boolean }) {
    if (!items.length) {
        if (loading) return null;
        return (
            <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-zinc-900/40 px-4 py-3 text-sm text-zinc-400">
                <CircleCheck className="h-4 w-4 text-emerald-400" /> Nothing needs your attention. No leftovers, and every risky session has been reviewed.
            </div>
        );
    }
    return (
        <section className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] overflow-hidden">
            <div className="flex items-center gap-2 px-4 h-10 border-b border-amber-500/10">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-white">Needs attention</h3>
                <span className="text-xs text-zinc-500">{items.length}</span>
            </div>
            <div className="divide-y divide-white/5">
                {items.map(it => (
                    <div key={it.key} className="flex items-center gap-3 px-4 py-3">
                        <span className="shrink-0">{it.icon}</span>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{it.title}</p>
                            {it.detail && <p className="text-xs text-zinc-500 truncate mt-0.5" title={it.detail}>{it.detail}</p>}
                        </div>
                        {it.actions && <div className="flex items-center gap-1.5 shrink-0">{it.actions}</div>}
                    </div>
                ))}
            </div>
        </section>
    );
}

function Kpi({ label, value, sub, spark, tone = "default", onClick }: {
    label: string; value: string; sub: string; tone?: "default" | "warn"; onClick: () => void;
    spark?: { values: number[]; labels: string[]; format: (v: number) => string };
}) {
    return (
        <button
            onClick={onClick}
            className={`group text-left rounded-xl border px-4 pt-3 pb-3 bg-zinc-900/40 transition-colors hover:bg-zinc-900 ${tone === "warn" ? "border-amber-500/25 hover:border-amber-500/40" : "border-white/[0.06] hover:border-white/15"}`}
        >
            <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
                <ChevronRight className="h-3.5 w-3.5 text-zinc-700 group-hover:text-zinc-400 transition-colors" />
            </div>
            <div className="flex items-end justify-between gap-3 mt-1.5">
                <p className="text-2xl font-semibold text-white tabular-nums leading-none">{value}</p>
                {spark && <Sparkline {...spark} />}
            </div>
            <p className={`text-xs mt-2 truncate ${tone === "warn" ? "text-amber-300/90" : "text-zinc-500"}`}>{sub}</p>
        </button>
    );
}

/** 7-day column sparkline; today is emphasised, earlier days recede. */
function Sparkline({ values, labels, format }: { values: number[]; labels: string[]; format: (v: number) => string }) {
    const max = Math.max(...values, 1);
    const w = 6, gap = 3, h = 26;
    return (
        <svg width={values.length * (w + gap) - gap} height={h} className="shrink-0 overflow-visible" role="img" aria-label="Last 7 days">
            {values.map((v, i) => {
                const bh = v > 0 ? Math.max(2, (v / max) * h) : 1;
                const today = i === values.length - 1;
                return (
                    <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={1.5}
                        className={today ? "fill-primary" : "fill-primary/35"}>
                        <title>{`${new Date(labels[i] + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}: ${format(v)}`}</title>
                    </rect>
                );
            })}
        </svg>
    );
}

function SessionRow({ s, open, onClick }: { s: AgentSession; open: boolean; onClick: () => void }) {
    return (
        <button onClick={onClick} className="group w-full text-left px-4 py-2.5 hover:bg-white/[0.03] flex items-center gap-3 transition-colors">
            <AgentDot agent={s.agent} />
            <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{s.title}</p>
                <p className="text-xs text-zinc-500 truncate mt-0.5">
                    <span className="text-zinc-400">{projectName(s.project_path)}</span>
                    {" · "}{agentMeta(s.agent).label} · {fmtDuration(s.updated_at - s.started_at)} · {s.command_count} commands · {s.files_changed} files
                </p>
            </div>
            {s.risky_count > 0 && (
                <span
                    className={`inline-flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 border shrink-0 ${open ? "text-amber-300 bg-amber-500/10 border-amber-500/20" : "text-zinc-500 border-white/10"}`}
                    title={open ? `${s.risky_count} risky action${s.risky_count === 1 ? "" : "s"}, not reviewed` : "Risky actions reviewed"}
                >
                    {open ? <AlertTriangle className="h-3 w-3" /> : <Check className="h-3 w-3" />}{s.risky_count}
                </span>
            )}
            <div className="text-right shrink-0 w-16">
                <p className="text-xs text-zinc-300 tabular-nums">{fmtTokens(s.total_tokens)}</p>
                <p className="text-[11px] text-zinc-600">{timeAgo(s.updated_at)}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-zinc-700 group-hover:text-zinc-400 shrink-0 transition-colors" />
        </button>
    );
}

/** The newest session of this agent in the directory it's running in. */
function liveSession(a: RunningAgent, sessions: AgentSession[]) {
    if (!a.cwd) return undefined;
    return sessions.find(s => s.agent === a.agent && !!s.project_path && (a.cwd!.startsWith(s.project_path) || s.project_path.startsWith(a.cwd!)));
}

function WorkingNow({ runtime, sessions, openSession }: { runtime: RuntimeReport | null; sessions: AgentSession[]; openSession: (s: AgentSession) => void }) {
    if (!runtime) return <SkeletonRows n={2} />;
    if (!runtime.agents.length) return <p className="px-4 py-6 text-sm text-zinc-500 text-center">No agents are running.</p>;
    return (
        <div className="divide-y divide-white/5">
            {runtime.agents.slice(0, 6).map(a => {
                const live = liveSession(a, sessions);
                const started = runtime.items.filter(i => !i.leftover && i.agent === a.agent && i.cwd && a.cwd && i.cwd.startsWith(a.cwd)).length;
                const body = (
                    <>
                        <span className="relative flex h-2 w-2 shrink-0">
                            <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: agentMeta(a.agent).color }} />
                            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: agentMeta(a.agent).color }} />
                        </span>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate" title={a.cwd ?? undefined}>{a.cwd ? projectName(a.cwd) : a.name}</p>
                            <p className="text-xs text-zinc-500 truncate mt-0.5">
                                {agentMeta(a.agent).label} · {fmtDuration(Date.now() - a.started_at)}
                                {started ? ` · ${started} process${started === 1 ? "" : "es"}` : ""}
                                {live ? ` · ${live.title}` : ""}
                            </p>
                        </div>
                        <span className="text-xs text-zinc-500 tabular-nums shrink-0">{fmtBytes(a.memory_bytes)}</span>
                    </>
                );
                return live ? (
                    <button key={a.pid} onClick={() => openSession(live)} className="group w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.03] transition-colors" title="Open this session">
                        {body}
                        <ChevronRight className="h-4 w-4 text-zinc-700 group-hover:text-zinc-400 shrink-0 transition-colors" />
                    </button>
                ) : (
                    <div key={a.pid} className="px-4 py-2.5 flex items-center gap-3">{body}</div>
                );
            })}
        </div>
    );
}

function AgentsSummary({ agents, sessions }: { agents: AgentInfo[]; sessions: AgentSession[] }) {
    const rows = useMemo(() => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 29);
        const key = localDayKey(cutoff);
        return AGENT_IDS.map(id => {
            const mine = sessions.filter(s => s.agent === id);
            return { id, info: agents.find(a => a.id === id), count: mine.length, tokens: tokensSince(mine, key), last: mine[0]?.updated_at ?? 0 };
        });
    }, [agents, sessions]);
    const active = rows.filter(r => r.count > 0);
    const quiet = rows.filter(r => r.count === 0);
    const total = active.reduce((n, r) => n + r.tokens, 0);

    if (!agents.length) return <SkeletonRows n={3} />;
    return (
        <div className="px-4 py-3 space-y-3">
            {total > 0 && (
                <div className="flex h-2 rounded-full overflow-hidden gap-[2px]" role="img" aria-label="Share of tokens by agent">
                    {active.filter(r => r.tokens > 0).map(r => (
                        <span key={r.id} style={{ flex: r.tokens, background: agentMeta(r.id).color }} title={`${agentMeta(r.id).label}: ${fmtTokens(r.tokens)} (${Math.round((r.tokens / total) * 100)}%)`} />
                    ))}
                </div>
            )}
            <div className="space-y-2">
                {active.map(r => (
                    <div key={r.id} className="flex items-center gap-2 text-xs">
                        <AgentChip agent={r.id} className="w-28" />
                        <span className="flex-1 text-zinc-500 truncate">
                            {r.info?.warning ? <span className="text-amber-300">Couldn't read history</span> : `${r.count} session${r.count === 1 ? "" : "s"} · ${timeAgo(r.last)}`}
                        </span>
                        <span className="text-zinc-300 tabular-nums">{fmtTokens(r.tokens)}</span>
                        {total > 0 && <span className="text-zinc-600 tabular-nums w-9 text-right">{Math.round((r.tokens / total) * 100)}%</span>}
                    </div>
                ))}
            </div>
            {quiet.length > 0 && (
                <p className="text-[11px] text-zinc-600 pt-1 border-t border-white/5">
                    No activity yet: {quiet.map(r => `${agentMeta(r.id).label}${r.info && !r.info.installed ? " (not installed)" : ""}`).join(", ")}
                </p>
            )}
        </div>
    );
}

function SkeletonRows({ n = 4 }: { n?: number }) {
    return (
        <div className="divide-y divide-white/5" aria-busy="true" aria-label="Loading">
            {Array.from({ length: n }).map((_, i) => (
                <div key={i} className="px-4 py-3 flex items-center gap-3">
                    <span className="h-2 w-2 rounded-full bg-white/10" />
                    <div className="flex-1 space-y-1.5">
                        <div className="h-3 rounded bg-white/[0.06] animate-pulse" style={{ width: `${60 - i * 7}%` }} />
                        <div className="h-2.5 w-1/3 rounded bg-white/[0.04] animate-pulse" />
                    </div>
                </div>
            ))}
        </div>
    );
}

/** Compact first-run checklist: only the steps left, one click each. */
function SetupStrip({ setActiveTab, openFlagged, unreviewed }: { setActiveTab: (t: TabId) => void; openFlagged: () => void; unreviewed: number }) {
    const [dismissed, setDismissed] = usePref<boolean>(PREF.checklistDismissed, false);
    const [visited] = usePref<string[]>(PREF.visited, []);
    const { status } = useMcpStatus();

    const steps = [
        { done: !!status?.some(s => s.connected), label: "Connect an agent", go: () => { writePref("devian_settings_section", "agents"); setActiveTab("settings"); } },
        { done: unreviewed === 0, label: "Review flagged sessions", go: openFlagged },
        { done: visited.includes("memory"), label: "Check agent memory", go: () => setActiveTab("memory") },
        { done: visited.includes("cleanup"), label: "Clean agent data", go: () => setActiveTab("cleanup") },
    ];
    const done = steps.filter(s => s.done).length;
    if (dismissed || status === null || done === steps.length) return null;
    const r = 7, c = 2 * Math.PI * r;

    return (
        <section className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] pl-3 pr-2 py-2">
            <svg width="20" height="20" viewBox="0 0 20 20" className="-rotate-90 shrink-0" aria-hidden>
                <circle cx="10" cy="10" r={r} className="fill-none stroke-white/10" strokeWidth="2.5" />
                <circle cx="10" cy="10" r={r} className="fill-none stroke-primary" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - done / steps.length)} />
            </svg>
            <p className="text-sm text-white shrink-0">Finish setting up <span className="text-zinc-500">{done}/{steps.length}</span></p>
            <div className="flex flex-wrap items-center gap-1.5 flex-1">
                {steps.map(s => s.done ? (
                    <button
                        key={s.label}
                        onClick={s.go}
                        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.06] px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                        aria-label={`${s.label} (done)`}
                    >
                        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
                            <Check className="h-2.5 w-2.5" />
                        </span>
                        {s.label}
                    </button>
                ) : (
                    <button key={s.label} onClick={s.go} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-zinc-900/60 px-2.5 py-1 text-xs text-zinc-300 hover:border-white/25 hover:text-white transition-colors">
                        {s.label} <ChevronRight className="h-3 w-3 text-zinc-500" />
                    </button>
                ))}
            </div>
            <button onClick={() => setDismissed(true)} className="p-1.5 rounded text-zinc-500 hover:text-white hover:bg-white/10 shrink-0" aria-label="Hide setup">
                <X className="h-3.5 w-3.5" />
            </button>
        </section>
    );
}

function NoAgents({ agents }: { agents: AgentInfo[] }) {
    return (
        <div className="flex-1 flex items-center justify-center p-8 animate-in fade-in duration-200">
            <div className="max-w-md text-center">
                <Bot className="h-8 w-8 text-zinc-600 mx-auto" />
                <h2 className="text-xl font-semibold text-white mt-4">No AI coding agents found yet</h2>
                <p className="text-sm text-zinc-500 mt-2 leading-relaxed">
                    Devian reads the history these agents keep on your machine. Use any of them once and your sessions,
                    usage and memory appear here automatically.
                </p>
                <div className="mt-6 rounded-xl border border-white/5 divide-y divide-white/5 text-left">
                    {AGENT_IDS.map(id => (
                        <div key={id} className="flex items-center gap-3 px-4 py-2.5">
                            <AgentChip agent={id} className="w-32" />
                            <span className="text-[11px] text-zinc-600 font-mono truncate">{shortPath(agents.find(a => a.id === id)?.data_dir)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

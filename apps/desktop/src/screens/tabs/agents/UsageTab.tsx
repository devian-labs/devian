import { useMemo, useState } from "react";
import { ArrowRight, BarChart3, Gauge, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccountCard } from "@/components/LimitsBar";
import { useInstances } from "@/lib/instances";
import { AgentChip, AgentDot, Empty, Section, Segmented, StatTile, TabHeader } from "@/components/agents/AgentBits";
import { AGENT_IDS, AgentId, AgentSession, ProviderLimits, agentMeta, costSince, dailyByAgent, fmtTokens, fmtUsd, localDayKey, projectName, shortPath, timeAgo } from "@/lib/agents";

type Range = "7" | "30" | "90";

function niceMax(v: number): number {
    if (v <= 0) return 1;
    const exp = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / exp;
    const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return step * exp;
}

interface UsageProps {
    sessions: AgentSession[];
    loading: boolean;
    limits: ProviderLimits[] | null;
    onRefreshLimits: () => Promise<unknown>;
    openSettings: () => void;
}

export function UsageTab({ sessions, loading, limits, onRefreshLimits, openSettings }: UsageProps) {
    const [range, setRange] = useState<Range>("30");
    const days = Number(range);

    const rows = useMemo(() => dailyByAgent(sessions, days), [sessions, days]);
    const since = rows[0]?.day ?? localDayKey(new Date());
    const agentsInRange = useMemo(() => AGENT_IDS.filter(a => rows.some(r => (r.by[a] ?? 0) > 0)), [rows]);

    // Sessions active in range, with only their in-range tokens counted.
    const inRange = useMemo(() => sessions
        .map(s => ({ s, tokens: Object.entries(s.daily_tokens || {}).reduce((n, [d, t]) => (d >= since ? n + t : n), 0) }))
        .filter(x => x.tokens > 0), [sessions, since]);

    const total = inRange.reduce((n, x) => n + x.tokens, 0);

    const byAgent = useMemo(() => AGENT_IDS.map(a => {
        const mine = inRange.filter(x => x.s.agent === a);
        // Per-kind split is proportional for sessions that straddle the range start.
        const kinds = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
        for (const { s, tokens } of mine) {
            const share = s.total_tokens ? tokens / s.total_tokens : 0;
            kinds.input += s.tokens.input * share;
            kinds.output += s.tokens.output * share;
            kinds.cache_read += s.tokens.cache_read * share;
            kinds.cache_write += s.tokens.cache_write * share;
        }
        return { agent: a, sessions: mine.length, tokens: mine.reduce((n, x) => n + x.tokens, 0), ...kinds };
    }).filter(r => r.sessions > 0).sort((a, b) => b.tokens - a.tokens), [inRange]);

    const byModel = useMemo(() => {
        const m = new Map<string, { agent: AgentId; tokens: number; sessions: number }>();
        for (const { s, tokens } of inRange) {
            const key = s.models[0] ?? "unknown model";
            const cur = m.get(key) ?? { agent: s.agent, tokens: 0, sessions: 0 };
            cur.tokens += tokens;
            cur.sessions += 1;
            m.set(key, cur);
        }
        return [...m.entries()].sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 8);
    }, [inRange]);

    const byProject = useMemo(() => {
        const m = new Map<string, { tokens: number; by: Partial<Record<AgentId, number>> }>();
        for (const { s, tokens } of inRange) {
            const key = s.project_path ?? "";
            const cur = m.get(key) ?? { tokens: 0, by: {} };
            cur.tokens += tokens;
            cur.by[s.agent] = (cur.by[s.agent] ?? 0) + tokens;
            m.set(key, cur);
        }
        return [...m.entries()].sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 10);
    }, [inRange]);

    const cacheRead = byAgent.reduce((n, r) => n + r.cache_read, 0);
    const peak = rows.reduce((best, r) => (r.total > best.total ? r : best), rows[0] ?? { day: "", total: 0, by: {} });

    return (
        <div className="flex flex-col h-full animate-in fade-in duration-200">
            <TabHeader
                title="Usage"
                subtitle="Tokens your agents used, read from their local logs. Nothing leaves your machine."
                actions={<Segmented<Range> value={range} onChange={setRange} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />}
            />
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 max-w-6xl">
                <PlanLimits limits={limits} onRefresh={onRefreshLimits} openSettings={openSettings} />
                <Spend sessions={sessions} />
                {loading && sessions.length === 0 ? (
                    <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Reading agent history…</div>
                ) : total === 0 ? (
                    <Empty icon={<BarChart3 className="h-6 w-6" />} title={`No token usage in the last ${days} days`} body="Usage appears here as soon as Claude Code, Codex, OpenCode or Cursor records a session." />
                ) : (
                    <>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <StatTile label={`Tokens · ${days} days`} value={fmtTokens(total)} sub={`${inRange.length} sessions`} />
                            <StatTile label="Daily average" value={fmtTokens(total / days)} />
                            <StatTile label="Busiest day" value={fmtTokens(peak.total)} sub={peak.day ? new Date(peak.day + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : ""} />
                            <StatTile label="Served from cache" value={`${Math.round((cacheRead / total) * 100)}%`} sub="of all tokens were cache reads" />
                        </div>

                        <Section title="Tokens per day">
                            <DailyChart rows={rows} agents={agentsInRange} />
                        </Section>

                        <Section title="By agent">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-[11px] uppercase tracking-wide text-zinc-500 border-b border-white/5">
                                        <th className="text-left font-medium px-4 py-2">Agent</th>
                                        <th className="text-right font-medium px-3 py-2">Sessions</th>
                                        <th className="text-right font-medium px-3 py-2">Input</th>
                                        <th className="text-right font-medium px-3 py-2">Output</th>
                                        <th className="text-right font-medium px-3 py-2">Cache read</th>
                                        <th className="text-right font-medium px-3 py-2">Cache write</th>
                                        <th className="text-right font-medium px-4 py-2">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5 tabular-nums">
                                    {byAgent.map(r => (
                                        <tr key={r.agent}>
                                            <td className="px-4 py-2"><AgentChip agent={r.agent} /></td>
                                            <td className="text-right px-3 py-2 text-zinc-400">{r.sessions}</td>
                                            <td className="text-right px-3 py-2 text-zinc-400">{fmtTokens(r.input)}</td>
                                            <td className="text-right px-3 py-2 text-zinc-400">{fmtTokens(r.output)}</td>
                                            <td className="text-right px-3 py-2 text-zinc-400">{fmtTokens(r.cache_read)}</td>
                                            <td className="text-right px-3 py-2 text-zinc-400">{fmtTokens(r.cache_write)}</td>
                                            <td className="text-right px-4 py-2 text-white font-medium">{fmtTokens(r.tokens)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Section>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <Section title="By project">
                                <div className="divide-y divide-white/5">
                                    {byProject.map(([path, v]) => (
                                        <div key={path} className="px-4 py-2.5">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm text-white truncate flex-1" title={path}>{path ? projectName(path) : "No project"}</span>
                                                <span className="text-xs text-zinc-300 tabular-nums">{fmtTokens(v.tokens)}</span>
                                            </div>
                                            <div className="flex h-1.5 mt-1.5 gap-[2px] rounded-full overflow-hidden" style={{ width: `${Math.max(4, (v.tokens / byProject[0][1].tokens) * 100)}%` }}>
                                                {AGENT_IDS.filter(a => v.by[a]).map(a => (
                                                    <span key={a} style={{ flex: v.by[a], background: agentMeta(a).color }} title={`${agentMeta(a).label}: ${fmtTokens(v.by[a]!)}`} />
                                                ))}
                                            </div>
                                            {path && <p className="text-[11px] text-zinc-600 truncate mt-1">{shortPath(path)}</p>}
                                        </div>
                                    ))}
                                </div>
                            </Section>
                            <Section title="By model">
                                <div className="divide-y divide-white/5">
                                    {byModel.map(([model, v]) => (
                                        <div key={model} className="px-4 py-2.5 flex items-center gap-3">
                                            <AgentDot agent={v.agent} />
                                            <span className="text-sm text-white font-mono truncate flex-1">{model}</span>
                                            <span className="text-xs text-zinc-500">{v.sessions} sessions</span>
                                            <span className="text-xs text-zinc-300 tabular-nums w-14 text-right">{fmtTokens(v.tokens)}</span>
                                        </div>
                                    ))}
                                </div>
                            </Section>
                        </div>
                        <p className="text-xs text-zinc-600 max-w-3xl leading-relaxed">
                            Totals include cache reads and writes, which is how agents bill context. Cursor and Antigravity keep most usage on
                            their servers, so their numbers here are partial. Costs aren't estimated because plans and prices vary; OpenCode's
                            own recorded cost is shown per session.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}

function DailyChart({ rows, agents }: { rows: ReturnType<typeof dailyByAgent>; agents: AgentId[] }) {
    const [hover, setHover] = useState<number | null>(null);
    const max = niceMax(Math.max(...rows.map(r => r.total), 1));
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
    const H = 200;
    const labelEvery = rows.length > 45 ? 14 : rows.length > 14 ? 7 : 1;
    const h = hover !== null ? rows[hover] : null;

    return (
        <div className="px-4 pt-3 pb-4">
            <div className="flex flex-wrap items-center gap-4 mb-3">
                {agents.map(a => (
                    <span key={a} className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: agentMeta(a).color }} />
                        {agentMeta(a).label}
                    </span>
                ))}
            </div>
            <div className="flex gap-2 mt-5">
                <div className="relative w-10 shrink-0" style={{ height: H }}>
                    {ticks.map(t => (
                        <span key={t} className="absolute right-0 text-[10px] text-zinc-500 tabular-nums -translate-y-1/2" style={{ bottom: (t / max) * H }}>
                            {fmtTokens(t)}
                        </span>
                    ))}
                </div>
                <div className="relative flex-1" style={{ height: H }} onMouseLeave={() => setHover(null)}>
                    {ticks.map(t => (
                        <div key={t} className="absolute left-0 right-0 h-px bg-white/[0.06]" style={{ bottom: (t / max) * H }} />
                    ))}
                    <div className="absolute inset-0 flex items-end">
                        {rows.map((r, i) => {
                            const segs = agents.filter(a => (r.by[a] ?? 0) > 0);
                            return (
                                <div
                                    key={r.day}
                                    className={`flex-1 h-full flex flex-col justify-end items-center ${hover === i ? "bg-white/[0.04]" : ""}`}
                                    onMouseEnter={() => setHover(i)}
                                >
                                    <div className="flex flex-col-reverse gap-[2px] w-full" style={{ maxWidth: 24, width: "70%" }}>
                                        {segs.map((a, si) => (
                                            <div
                                                key={a}
                                                style={{
                                                    height: Math.max(2, ((r.by[a] ?? 0) / max) * H - 2),
                                                    background: agentMeta(a).color,
                                                    borderRadius: si === segs.length - 1 ? "4px 4px 0 0" : 0,
                                                }}
                                            />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {h && hover !== null && (
                        <div
                            className="absolute z-10 top-0 pointer-events-none rounded-lg border border-white/10 bg-zinc-950/95 shadow-xl px-3 py-2 min-w-[150px]"
                            style={hover > rows.length / 2 ? { right: `${((rows.length - hover) / rows.length) * 100}%` } : { left: `${((hover + 1) / rows.length) * 100}%` }}
                        >
                            <p className="text-xs font-medium text-white mb-1">
                                {new Date(h.day + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                            </p>
                            {agents.filter(a => h.by[a]).map(a => (
                                <p key={a} className="flex items-center gap-2 text-xs text-zinc-400">
                                    <AgentDot agent={a} size={7} />
                                    <span className="flex-1">{agentMeta(a).label}</span>
                                    <span className="text-zinc-200 tabular-nums">{fmtTokens(h.by[a]!)}</span>
                                </p>
                            ))}
                            <p className="flex justify-between text-xs text-zinc-500 border-t border-white/10 mt-1 pt-1">
                                <span>Total</span><span className="text-white tabular-nums">{fmtTokens(h.total)}</span>
                            </p>
                        </div>
                    )}
                </div>
            </div>
            <div className="flex ml-12 mt-1.5">
                {rows.map((r, i) => (
                    <span key={r.day} className="flex-1 text-center text-[10px] text-zinc-500 whitespace-nowrap overflow-visible">
                        {(rows.length - 1 - i) % labelEvery === 0 ? new Date(r.day + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}
                    </span>
                ))}
            </div>
        </div>
    );
}

function PlanLimits({ limits, onRefresh, openSettings }: { limits: ProviderLimits[] | null; onRefresh: () => Promise<unknown>; openSettings: () => void }) {
    const [busy, setBusy] = useState(false);
    const shown = (limits ?? []).filter(l => l.status !== "off" && l.status !== "unsupported");
    if (!limits) return null;
    if (shown.length === 0) {
        return (
            <section className="rounded-xl border border-white/[0.06] bg-zinc-900/40 px-4 py-4 flex items-center gap-4">
                <Gauge className="h-5 w-5 text-primary shrink-0" />
                <div className="flex-1">
                    <p className="text-sm font-medium text-white">See your plan limits and when they reset</p>
                    <p className="text-xs text-zinc-500 mt-0.5">5-hour and weekly limits for Claude and Codex, per account, straight from Anthropic and OpenAI.</p>
                </div>
                <Button size="sm" variant="secondary" onClick={openSettings}>Choose accounts <ArrowRight /></Button>
            </section>
        );
    }
    const newest = Math.max(...shown.map(l => l.fetched_at));
    return (
        <Section
            title="Plan limits"
            right={
                <div className="flex items-center gap-2 text-xs text-zinc-600">
                    <span>Updated {timeAgo(newest)}</span>
                    <button
                        onClick={async () => { setBusy(true); try { await onRefresh(); } finally { setBusy(false); } }}
                        className="p-1 rounded text-zinc-500 hover:text-white hover:bg-white/10"
                        aria-label="Refresh limits"
                    >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={openSettings} className="text-zinc-500 hover:text-white">Accounts</button>
                </div>
            }
        >
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 divide-y md:divide-y-0 divide-white/5">
                {shown.map(a => <div key={a.id} className="md:border-r md:border-white/5 last:border-r-0"><AccountCard a={a} /></div>)}
            </div>
        </Section>
    );
}

/** API-equivalent spend per account over a few fixed periods. */
function Spend({ sessions }: { sessions: AgentSession[] }) {
    const { instances } = useInstances();
    const rows = useMemo(() => {
        const key = (offset: number) => { const d = new Date(); d.setDate(d.getDate() - offset); return localDayKey(d); };
        const today = key(0), yesterday = key(1), week = key(6), month = key(29);
        const groups = new Map<string, { label: string; agent: AgentId; list: AgentSession[]; estimated: boolean }>();
        for (const s of sessions) {
            if (!s.cost_usd) continue;
            const id = s.agent === "claude" ? `claude:${s.instance ?? ""}` : s.agent;
            const label = s.agent === "claude" ? (instances.find(i => i.id === s.instance)?.label ?? "Claude Code") : agentMeta(s.agent).label;
            const g = groups.get(id) ?? { label, agent: s.agent, list: [], estimated: false };
            g.list.push(s);
            g.estimated ||= s.cost_estimated;
            groups.set(id, g);
        }
        const out = [...groups.entries()].map(([id, g]) => ({
            id, label: g.label, agent: g.agent, estimated: g.estimated,
            today: costSince(g.list, today),
            yesterday: costSince(g.list, yesterday, yesterday),
            week: costSince(g.list, week),
            month: costSince(g.list, month),
        })).filter(r => r.month > 0 || r.today > 0).sort((a, b) => b.month - a.month);
        const total = (k: "today" | "yesterday" | "week" | "month") => out.reduce((n, r) => n + r[k], 0);
        return { out, totals: { today: total("today"), yesterday: total("yesterday"), week: total("week"), month: total("month") } };
    }, [sessions, instances]);

    if (rows.out.length === 0) return null;
    return (
        <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatTile label="Spend today" value={fmtUsd(rows.totals.today)} sub="API-equivalent" />
                <StatTile label="Yesterday" value={fmtUsd(rows.totals.yesterday)} />
                <StatTile label="Last 7 days" value={fmtUsd(rows.totals.week)} />
                <StatTile label="Last 30 days" value={fmtUsd(rows.totals.month)} />
            </div>
            <Section title="Spend by account">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-[11px] uppercase tracking-wide text-zinc-500 border-b border-white/5">
                            <th className="text-left font-medium px-4 py-2">Account</th>
                            <th className="text-right font-medium px-3 py-2">Today</th>
                            <th className="text-right font-medium px-3 py-2">Yesterday</th>
                            <th className="text-right font-medium px-3 py-2">7 days</th>
                            <th className="text-right font-medium px-4 py-2">30 days</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 tabular-nums">
                        {rows.out.map(r => (
                            <tr key={r.id}>
                                <td className="px-4 py-2">
                                    <span className="inline-flex items-center gap-2 text-zinc-200"><AgentDot agent={r.agent} />{r.label}</span>
                                    {!r.estimated && <span className="ml-2 text-[10px] text-zinc-600">reported by the agent</span>}
                                </td>
                                <td className="text-right px-3 py-2 text-zinc-300">{fmtUsd(r.today)}</td>
                                <td className="text-right px-3 py-2 text-zinc-400">{fmtUsd(r.yesterday)}</td>
                                <td className="text-right px-3 py-2 text-zinc-400">{fmtUsd(r.week)}</td>
                                <td className="text-right px-4 py-2 text-white font-medium">{fmtUsd(r.month)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="px-4 py-2.5 text-[11px] text-zinc-600 border-t border-white/5">
                    Claude figures are what this usage would cost at Anthropic's API list prices. Plans bill differently, and Bedrock and Vertex have their own pricing. Codex isn't priced.
                </p>
            </Section>
        </>
    );
}

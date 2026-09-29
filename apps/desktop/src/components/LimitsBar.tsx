import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { AlertTriangle, ArrowRight, Gauge, Loader2, RefreshCw, X } from "lucide-react";
import { AgentDot } from "@/components/agents/AgentBits";
import { AgentSession, LimitWindow, ProviderLimits, costSince, fmtUntil, fmtUsd, localDayKey } from "@/lib/agents";

type Level = "ok" | "warn" | "hot";
const level = (p: number): Level => (p >= 90 ? "hot" : p >= 70 ? "warn" : "ok");
const BAR: Record<Level, string> = { ok: "bg-primary", warn: "bg-amber-400", hot: "bg-red-400" };
const TEXT: Record<Level, string> = { ok: "text-zinc-300", warn: "text-amber-300", hot: "text-red-400" };

function WindowRow({ w }: { w: LimitWindow }) {
    const l = level(w.used_percent);
    return (
        <div>
            <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">{w.label}</span>
                <span className="tabular-nums">
                    <span className={TEXT[l]}>{Math.round(w.used_percent)}% used</span>
                    {w.resets_at && <span className="text-zinc-500"> · resets in {fmtUntil(w.resets_at)}</span>}
                </span>
            </div>
            <div className="h-1.5 mt-1 rounded-full bg-white/10 overflow-hidden" role="meter" aria-valuenow={Math.round(w.used_percent)} aria-valuemin={0} aria-valuemax={100} aria-label={w.label}>
                <div className={`h-full rounded-full ${BAR[l]} transition-[width] duration-500`} style={{ width: `${Math.min(100, Math.max(1, w.used_percent))}%` }} />
            </div>
        </div>
    );
}

export function AccountCard({ a }: { a: ProviderLimits }) {
    return (
        <div className="px-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
                <AgentDot agent={a.agent} />
                <span className="text-sm font-medium text-white truncate">{a.label}</span>
                {a.plan && <span className="text-[11px] text-zinc-500 truncate">{a.plan}</span>}
            </div>
            {a.status === "ok" ? (
                <>
                    {a.windows.length === 0 && <p className="text-xs text-zinc-500">No limits reported for this plan.</p>}
                    {a.windows.map(w => <WindowRow key={w.key} w={w} />)}
                    {a.extra?.enabled && (
                        <p className="text-[11px] text-zinc-500">
                            Extra usage is on{a.extra.used_percent != null ? `: ${Math.round(a.extra.used_percent)}% of this month's cap used` : ""}
                        </p>
                    )}
                </>
            ) : (
                <p className={`text-xs flex items-start gap-1.5 ${a.status === "error" || a.status === "expired" ? "text-amber-300" : "text-zinc-500"}`}>
                    {(a.status === "error" || a.status === "expired") && <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />}
                    {a.message}
                </p>
            )}
        </div>
    );
}

interface Props {
    limits: ProviderLimits[] | null;
    sessions: AgentSession[];
    onRefresh: () => Promise<unknown>;
    onOpenUsage: () => void;
    onSetup: () => void;
}

/** Top-bar readout of the tightest plan limit, with every account in a panel. */
export function LimitsBar({ limits, sessions, onRefresh, onOpenUsage, onSetup }: Props) {
    const [open, setOpen] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const live = (limits ?? []).filter(l => l.status === "ok");
    const shown = (limits ?? []).filter(l => l.status !== "off" && l.status !== "unsupported");

    // The window closest to running out, across every enabled account.
    const tightest = useMemo(() => {
        let best: { a: ProviderLimits; w: LimitWindow } | null = null;
        for (const a of live) for (const w of a.windows) if (!best || w.used_percent > best.w.used_percent) best = { a, w };
        return best;
    }, [live]);

    const spend = useMemo(() => {
        const today = localDayKey(new Date());
        const month = new Date();
        month.setDate(month.getDate() - 29);
        return { today: costSince(sessions, today), month: costSince(sessions, localDayKey(month)) };
    }, [sessions]);

    const refresh = async () => {
        setRefreshing(true);
        try { await onRefresh(); } finally { setRefreshing(false); }
    };

    if (!limits) return null;

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button
                    className={`inline-flex items-center gap-2 h-7 px-2 rounded-md text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary ${open ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"}`}
                    aria-label={tightest ? `Plan limits: ${tightest.a.label} ${tightest.w.label} ${Math.round(tightest.w.used_percent)}% used` : "Plan limits"}
                >
                    <Gauge className={`h-3.5 w-3.5 ${tightest ? TEXT[level(tightest.w.used_percent)] : "text-zinc-500"}`} />
                    {tightest ? (
                        <>
                            <span className={`tabular-nums ${TEXT[level(tightest.w.used_percent)]}`}>{Math.round(tightest.w.used_percent)}%</span>
                            <span className="w-8 h-1 rounded-full bg-white/10 overflow-hidden" aria-hidden>
                                <span className={`block h-full ${BAR[level(tightest.w.used_percent)]}`} style={{ width: `${Math.min(100, Math.max(2, tightest.w.used_percent))}%` }} />
                            </span>
                            {tightest.w.resets_at && <span className="text-zinc-500 tabular-nums">{fmtUntil(tightest.w.resets_at)}</span>}
                        </>
                    ) : (
                        <span className="text-zinc-500">{spend.today > 0 ? `${fmtUsd(spend.today)} today` : "Limits"}</span>
                    )}
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content align="end" sideOffset={6} collisionPadding={12} className="z-50 w-[360px] max-h-[70vh] overflow-y-auto rounded-xl border border-white/10 bg-zinc-950 text-white shadow-2xl outline-none animate-in fade-in-0 zoom-in-95 duration-100">
                    <div className="flex items-center gap-2 px-4 h-11 border-b border-white/5">
                        <p className="text-sm font-semibold flex-1">Plan limits</p>
                        <button onClick={refresh} className="p-1.5 rounded-md text-zinc-500 hover:text-white hover:bg-white/10" aria-label="Refresh limits" title="Refresh">
                            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        </button>
                        <Popover.Close className="p-1.5 rounded-md text-zinc-500 hover:text-white hover:bg-white/10" aria-label="Close">
                            <X className="h-3.5 w-3.5" />
                        </Popover.Close>
                    </div>
                    {shown.length === 0 ? (
                        <div className="px-4 py-4 space-y-3">
                            <p className="text-sm text-zinc-300">See your 5-hour and weekly limits, and when they reset.</p>
                            <p className="text-xs text-zinc-500 leading-relaxed">
                                Devian asks Anthropic and OpenAI directly, using the login Claude Code and Codex already saved. Turn it on per account.
                            </p>
                            <button onClick={() => { setOpen(false); onSetup(); }} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                                Choose accounts <ArrowRight className="h-3 w-3" />
                            </button>
                        </div>
                    ) : (
                        <div className="divide-y divide-white/5">{shown.map(a => <AccountCard key={a.id} a={a} />)}</div>
                    )}
                    <div className="flex items-center gap-3 px-4 py-2.5 border-t border-white/5 bg-white/[0.015]">
                        <div className="flex-1 text-xs">
                            <span className="text-zinc-300 tabular-nums">{fmtUsd(spend.today)}</span> <span className="text-zinc-500">today</span>
                            <span className="text-zinc-700"> · </span>
                            <span className="text-zinc-300 tabular-nums">{fmtUsd(spend.month)}</span> <span className="text-zinc-500">30 days</span>
                        </div>
                        <button onClick={() => { setOpen(false); onOpenUsage(); }} className="text-xs text-zinc-400 hover:text-white inline-flex items-center gap-1">
                            Usage <ArrowRight className="h-3 w-3" />
                        </button>
                    </div>
                    <p className="px-4 pb-2.5 text-[10px] text-zinc-600 bg-white/[0.015]">Spend is the API-equivalent cost of your local usage, at Anthropic's list prices.</p>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

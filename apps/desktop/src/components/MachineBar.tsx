import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as Popover from "@radix-ui/react-popover";
import { Battery, BatteryCharging, BatteryLow, Cpu, HardDrive, MemoryStick, Pin, Thermometer, X } from "lucide-react";
import { AgentDot } from "@/components/agents/AgentBits";
import { MachineStats, RuntimeReport, agentMeta, fmtBytes, fmtDuration } from "@/lib/agents";
import { readPref, usePref } from "@/lib/prefs";
import { REFRESH_MS, RefreshRate, SETTING } from "@/lib/settings";

const HISTORY = 30; // 2 minutes of samples
const HOVER_OPEN_MS = 180;
const HOVER_CLOSE_MS = 160;

type Level = "ok" | "warn" | "hot";
const LEVEL_TEXT: Record<Level, string> = { ok: "text-zinc-300", warn: "text-amber-300", hot: "text-red-400" };
const LEVEL_BAR: Record<Level, string> = { ok: "bg-zinc-400", warn: "bg-amber-400", hot: "bg-red-400" };

const pct = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);
const cpuLevel = (p: number): Level => (p >= 90 ? "hot" : p >= 75 ? "warn" : "ok");
const memLevel = (p: number): Level => (p >= 92 ? "hot" : p >= 80 ? "warn" : "ok");
const tempLevel = (t: number): Level => (t >= 95 ? "hot" : t >= 85 ? "warn" : "ok");
const diskLevel = (freePct: number): Level => (freePct <= 5 ? "hot" : freePct <= 12 ? "warn" : "ok");

const ALERT_EVERY_MS = 60 * 60 * 1000;

/** Hot machine / nearly full disk, at most once an hour each, when enabled. */
function checkAlerts(s: MachineStats, last: Record<string, number>, onAlert?: (title: string, message: string) => void) {
    if (!onAlert || !readPref<boolean>(SETTING.notifyHardware, true)) return;
    const now = Date.now();
    const fire = (key: string, title: string, message: string) => {
        if (now - (last[key] ?? 0) < ALERT_EVERY_MS) return;
        last[key] = now;
        onAlert(title, message);
    };
    if (s.cpu_temp !== null && s.cpu_temp >= 90) {
        const top = [...s.agents].sort((a, b) => b.cpu_percent - a.cpu_percent)[0];
        fire("temp", `Running hot: ${Math.round(s.cpu_temp)}°C`, top && top.cpu_percent > 5 ? `${agentMeta(top.agent).label} is using ${top.cpu_percent.toFixed(0)}% CPU.` : `CPU at ${Math.round(s.cpu_percent)}%.`);
    }
    const freePct = s.disk_total > 0 ? (s.disk_available / s.disk_total) * 100 : 100;
    if (s.disk_total > 0 && (freePct < 5 || s.disk_available < 5 * 1024 ** 3)) {
        fire("disk", `Disk almost full: ${fmtBytes(s.disk_available)} free`, "Cleanup can free old agent transcripts, caches and node_modules.");
    }
}

/** Polls machine stats while mounted, keeping a short history for trends. */
function useMachine(onAlert?: (title: string, message: string) => void) {
    const [refresh] = usePref<RefreshRate>(SETTING.refresh, "balanced");
    const pollMs = (REFRESH_MS[refresh] ?? REFRESH_MS.balanced).machine;
    const [stats, setStats] = useState<MachineStats | null>(null);
    const lastAlert = useRef<Record<string, number>>({});
    const alertRef = useRef(onAlert);
    alertRef.current = onAlert;
    const [history, setHistory] = useState<{ cpu: number; mem: number }[]>([]);
    const inflight = useRef(false);
    useEffect(() => {
        let alive = true;
        const tick = () => {
            if (inflight.current || document.hidden) return;
            inflight.current = true;
            invoke<MachineStats>("agents_machine")
                .then(s => {
                    // Ignore anything that isn't a stats object (e.g. an older backend).
                    if (!alive || !s || typeof s.cpu_percent !== "number" || !Array.isArray(s.agents)) return;
                    setStats(s);
                    checkAlerts(s, lastAlert.current, alertRef.current);
                    setHistory(h => [...h, { cpu: s.cpu_percent, mem: pct(s.memory_used, s.memory_total) }].slice(-HISTORY));
                })
                .catch(() => {})
                .finally(() => { inflight.current = false; });
        };
        tick();
        const id = setInterval(tick, pollMs);
        return () => { alive = false; clearInterval(id); };
    }, [pollMs]);
    return { stats, history };
}

function Meter({ value, level }: { value: number; level: Level }) {
    return (
        <span className="w-8 h-1 rounded-full bg-white/10 overflow-hidden" aria-hidden>
            <span className={`block h-full rounded-full transition-[width] duration-500 ${LEVEL_BAR[level]}`} style={{ width: `${Math.min(100, Math.max(2, value))}%` }} />
        </span>
    );
}

function Pill({ icon, value, level = "ok", meter }: { icon: ReactNode; value: string; level?: Level; meter?: number }) {
    return (
        <span className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md">
            <span className={level === "ok" ? "text-zinc-500" : LEVEL_TEXT[level]}>{icon}</span>
            <span className={`text-xs tabular-nums ${LEVEL_TEXT[level]}`}>{value}</span>
            {meter !== undefined && <Meter value={meter} level={level} />}
        </span>
    );
}

/** 2-minute trend; newest sample at the right edge, scales to its column. */
function Trend({ values, label }: { values: number[]; label: string }) {
    if (values.length < 2) return <div className="h-9 text-[11px] text-zinc-600 flex items-center">Collecting…</div>;
    const w = 200, h = 36;
    const xy = values.map((v, i) => [w - ((values.length - 1 - i) / (HISTORY - 1)) * w, h - (Math.min(100, Math.max(0, v)) / 100) * h] as const);
    const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const area = `${xy[0][0].toFixed(1)},${h} ${line} ${w},${h}`;
    const [lx, ly] = xy[xy.length - 1];
    return (
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-9 overflow-visible mt-1.5" role="img" aria-label={`${label}, last 2 minutes`}>
            <line x1="0" y1={h} x2={w} y2={h} className="stroke-white/10" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <polygon points={area} className="fill-primary/10" />
            <polyline points={line} className="fill-none stroke-primary" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <circle cx={lx} cy={ly} r="2.5" className="fill-primary" />
        </svg>
    );
}

function Row({ k, v, level = "ok" }: { k: ReactNode; v: string; level?: Level }) {
    return (
        <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-zinc-500 truncate">{k}</span>
            <span className={`tabular-nums shrink-0 ${LEVEL_TEXT[level]}`}>{v}</span>
        </div>
    );
}

function Col({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="px-4 py-3 min-w-0 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{title}</p>
            {children}
        </div>
    );
}

interface Props {
    runtime: RuntimeReport | null;
    onOpenRuntime: () => void;
    /** Raises an in-app + system notification. */
    onAlert?: (title: string, message: string) => void;
    /** Rendered just left of the hardware readings (the plan-limits widget). */
    limitsSlot?: ReactNode;
}

/** Slim bar above every page: live agents on the left, machine health on the right. */
export function MachineBar({ runtime, onOpenRuntime, onAlert, limitsSlot }: Props) {
    const { stats: s, history } = useMachine(onAlert);
    const working = runtime?.agents.length ?? 0;

    // Hover previews the panel; a click pins it open until Esc, an outside
    // click, or another click on the readings.
    const [open, setOpen] = useState(false);
    const [pinned, setPinned] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const timer = useRef<number | undefined>(undefined);
    const clearTimer = () => window.clearTimeout(timer.current);
    const hoverOpen = () => { clearTimer(); if (!open) timer.current = window.setTimeout(() => setOpen(true), HOVER_OPEN_MS); };
    const hoverClose = () => { clearTimer(); if (!pinned) timer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS); };
    // Whether the panel was pinned when it closed, for returning focus afterwards.
    const closedWhilePinned = useRef(false);
    const close = () => { clearTimer(); closedWhilePinned.current = pinned; setOpen(false); setPinned(false); };
    useEffect(() => clearTimer, []);

    const onTriggerClick = () => {
        clearTimer();
        if (open && pinned) close();
        else { setOpen(true); setPinned(true); }
    };

    const memP = s ? pct(s.memory_used, s.memory_total) : 0;
    const diskFreeP = s ? pct(s.disk_available, s.disk_total) : 100;
    const agentMem = s?.agents.reduce((n, a) => n + a.memory_bytes, 0) ?? 0;
    const agentCpu = s?.agents.reduce((n, a) => n + a.cpu_percent, 0) ?? 0;
    const hottest = s ? [...s.sensors].sort((a, b) => b.celsius - a.celsius).slice(0, 5) : [];
    const b = s?.battery;
    const BatteryIcon = b?.charging ? BatteryCharging : b && b.percent <= 20 ? BatteryLow : Battery;

    return (
        <div className="shrink-0 h-10 flex items-center justify-between gap-4 px-4 border-b border-white/5 bg-background">
            <button onClick={onOpenRuntime} className="inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-white transition-colors">
                {working > 0 ? (
                    <>
                        <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                        </span>
                        {working} agent{working === 1 ? "" : "s"} working
                    </>
                ) : (
                    <>
                        <span className="h-2 w-2 rounded-full bg-zinc-600" />
                        {runtime ? "No agents running" : "Checking agents…"}
                    </>
                )}
            </button>

            <div className="flex items-center gap-2">
            {limitsSlot}
            {limitsSlot && s && <span className="h-4 w-px bg-white/10" aria-hidden />}
            {s && (
                <Popover.Root open={open} onOpenChange={o => { if (!o) close(); }}>
                    <Popover.Anchor asChild>
                        <button
                            ref={trigger}
                            onClick={onTriggerClick}
                            onMouseEnter={hoverOpen}
                            onMouseLeave={hoverClose}
                            aria-haspopup="dialog"
                            aria-expanded={open}
                            aria-label={`Machine details: CPU ${Math.round(s.cpu_percent)}%, memory ${Math.round(memP)}%${s.cpu_temp !== null ? `, ${Math.round(s.cpu_temp)} degrees` : ""}`}
                            className={`flex items-center gap-0.5 rounded-lg px-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary ${open ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"}`}
                        >
                            <Pill icon={<Cpu className="h-3.5 w-3.5" />} value={`${Math.round(s.cpu_percent)}%`} meter={s.cpu_percent} level={cpuLevel(s.cpu_percent)} />
                            <Pill icon={<MemoryStick className="h-3.5 w-3.5" />} value={`${(s.memory_used / 1024 ** 3).toFixed(1)}/${Math.round(s.memory_total / 1024 ** 3)} GB`} meter={memP} level={memLevel(memP)} />
                            {s.cpu_temp !== null && <Pill icon={<Thermometer className="h-3.5 w-3.5" />} value={`${Math.round(s.cpu_temp)}°C`} level={tempLevel(s.cpu_temp)} />}
                            {s.disk_total > 0 && <Pill icon={<HardDrive className="h-3.5 w-3.5" />} value={`${fmtBytes(s.disk_available)} free`} level={diskLevel(diskFreeP)} />}
                            {b && <Pill icon={<BatteryIcon className="h-3.5 w-3.5" />} value={`${b.percent}%`} level={!b.charging && b.percent <= 10 ? "hot" : !b.charging && b.percent <= 20 ? "warn" : "ok"} />}
                        </button>
                    </Popover.Anchor>
                    <Popover.Portal>
                        <Popover.Content
                            align="end"
                            sideOffset={6}
                            collisionPadding={12}
                            onMouseEnter={clearTimer}
                            onMouseLeave={hoverClose}
                            // A hover preview shouldn't steal keyboard focus; a click should.
                            onOpenAutoFocus={e => { if (!pinned) e.preventDefault(); }}
                            // Return keyboard focus to the readings (Radix only does this for its own trigger).
                            onCloseAutoFocus={e => { e.preventDefault(); if (closedWhilePinned.current) trigger.current?.focus(); }}
                            // Clicks on the readings toggle via onTriggerClick instead.
                            onInteractOutside={e => { if (trigger.current?.contains(e.target as Node)) e.preventDefault(); }}
                            className="z-50 w-[680px] max-w-[calc(100vw-24px)] rounded-xl border border-white/10 bg-zinc-950 text-white shadow-2xl outline-none animate-in fade-in-0 zoom-in-95 duration-100"
                        >
                            <div className="flex items-center gap-3 px-4 h-11 border-b border-white/5">
                                <p className="text-sm font-semibold">{s.cpu_brand || "This machine"}</p>
                                <p className="text-xs text-zinc-500">{s.cpu_cores} cores · up {fmtDuration(s.uptime_secs * 1000)} · load {s.load_avg.map(l => l.toFixed(1)).join(" / ")}</p>
                                <div className="ml-auto flex items-center gap-1">
                                    <button
                                        onClick={() => setPinned(p => !p)}
                                        className={`p-1.5 rounded-md transition-colors ${pinned ? "text-primary bg-primary/10" : "text-zinc-500 hover:text-white hover:bg-white/10"}`}
                                        aria-label={pinned ? "Unpin panel" : "Keep panel open"}
                                        aria-pressed={pinned}
                                        title={pinned ? "Pinned open" : "Keep open"}
                                    >
                                        <Pin className="h-3.5 w-3.5" />
                                    </button>
                                    <Popover.Close className="p-1.5 rounded-md text-zinc-500 hover:text-white hover:bg-white/10" aria-label="Close">
                                        <X className="h-3.5 w-3.5" />
                                    </Popover.Close>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 divide-x divide-white/5">
                                <Col title="Load">
                                    <div>
                                        <Row k="CPU" v={`${Math.round(s.cpu_percent)}%`} level={cpuLevel(s.cpu_percent)} />
                                        <Trend values={history.map(x => x.cpu)} label="CPU" />
                                    </div>
                                    <div>
                                        <Row k="Memory" v={`${fmtBytes(s.memory_used)} of ${fmtBytes(s.memory_total)}`} level={memLevel(memP)} />
                                        <Trend values={history.map(x => x.mem)} label="Memory" />
                                    </div>
                                    {s.swap_total > 0 && <Row k="Swap" v={`${fmtBytes(s.swap_used)} of ${fmtBytes(s.swap_total)}`} />}
                                </Col>

                                <Col title="Temperature">
                                    {hottest.length ? (
                                        <>
                                            {s.cpu_temp !== null && (
                                                <p className={`text-2xl font-semibold tabular-nums ${LEVEL_TEXT[tempLevel(s.cpu_temp)]}`}>
                                                    {Math.round(s.cpu_temp)}°C <span className="text-xs font-normal text-zinc-500">hottest CPU sensor</span>
                                                </p>
                                            )}
                                            <div className="space-y-1.5 pt-1">
                                                {hottest.map(t => <Row key={t.label} k={t.label} v={`${Math.round(t.celsius)}°C`} level={tempLevel(t.celsius)} />)}
                                            </div>
                                        </>
                                    ) : (
                                        <p className="text-xs text-zinc-500">This system doesn't report temperatures to apps.</p>
                                    )}
                                </Col>

                                <Col title="Storage & power">
                                    {s.disk_total > 0 && (
                                        <div>
                                            <Row k="Disk" v={`${fmtBytes(s.disk_available)} free of ${fmtBytes(s.disk_total)}`} level={diskLevel(diskFreeP)} />
                                            <div className="h-1.5 mt-1.5 rounded-full bg-white/10 overflow-hidden">
                                                <div className={`h-full rounded-full ${LEVEL_BAR[diskLevel(diskFreeP)]}`} style={{ width: `${100 - diskFreeP}%` }} />
                                            </div>
                                        </div>
                                    )}
                                    {b && <Row k="Battery" v={`${b.percent}%${b.charging ? " · charging" : ""}`} />}
                                    {b?.time_left && <Row k={b.charging ? "Until full" : "Time left"} v={b.time_left.replace(/ (to full|left)$/, "")} />}
                                    <div className="pt-2 mt-1 border-t border-white/5 space-y-1.5">
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Used by agents</p>
                                        {s.agents.length === 0 ? (
                                            <p className="text-xs text-zinc-500">No agents running.</p>
                                        ) : (
                                            <>
                                                {s.agents.map(a => (
                                                    <Row
                                                        key={a.agent}
                                                        k={<span className="inline-flex items-center gap-1.5"><AgentDot agent={a.agent} size={7} />{agentMeta(a.agent).label}</span>}
                                                        v={`${fmtBytes(a.memory_bytes)} · ${a.cpu_percent.toFixed(1)}%`}
                                                    />
                                                ))}
                                                <p className="text-[11px] text-zinc-600 leading-snug">
                                                    {Math.round(pct(agentMem, s.memory_total))}% of memory, {agentCpu.toFixed(1)}% of CPU, incl. what they started.
                                                </p>
                                            </>
                                        )}
                                    </div>
                                </Col>
                            </div>
                        </Popover.Content>
                    </Popover.Portal>
                </Popover.Root>
            )}
            </div>
        </div>
    );
}

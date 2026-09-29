import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
    AlertTriangle, Bot, Check, CheckCheck, Clock, Code2, Copy, Sparkle, FileEdit, FilePlus, FolderOpen, Info, Loader2, MessageSquare, RotateCcw, Search, Terminal, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AgentChip, AgentDot, AgentFilter, Empty, Segmented, TabHeader } from "@/components/agents/AgentBits";
import {
    AGENT_IDS, AgentSession, RISK_HELP, SessionDetail, SessionEvent, fmtBytes, fmtDuration, fmtTokens, localDayKey, projectName,
} from "@/lib/agents";
import { PREF, ReviewedMap, isReviewed, usePref } from "@/lib/prefs";
import { fmtDateTime, fmtTime } from "@/lib/settings";

type EventFilter = "all" | "prompts" | "commands" | "files" | "flagged";
type ListFilter = "all" | "flagged" | "unreviewed";
const PAGE = 400;

const sessionKey = (s: Pick<AgentSession, "agent" | "id">) => `${s.agent}:${s.id}`;

function dayLabel(ms: number): string {
    const key = localDayKey(new Date(ms));
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (key === localDayKey(today)) return "Today";
    if (key === localDayKey(yesterday)) return "Yesterday";
    const d = new Date(ms);
    const sameYear = d.getFullYear() === today.getFullYear();
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
}

interface Props {
    sessions: AgentSession[];
    loading: boolean;
    focus: string | null;
    onFocusConsumed: () => void;
    preset: "flagged" | null;
    onPresetConsumed: () => void;
    editor: string;
}

export function SessionsTab({ sessions, loading, focus, onFocusConsumed, preset, onPresetConsumed, editor }: Props) {
    const [agent, setAgent] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [listFilter, setListFilter] = useState<ListFilter>("all");
    const [selected, setSelected] = useState<string | null>(null);
    const [reviewed, setReviewed] = usePref<ReviewedMap>(PREF.reviewed, {});
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (focus) {
            setSelected(focus);
            setAgent(null);
            setQuery("");
            setListFilter("all");
            onFocusConsumed();
        }
    }, [focus, onFocusConsumed]);

    useEffect(() => {
        if (preset === "flagged") {
            setListFilter("unreviewed");
            setAgent(null);
            setQuery("");
            onPresetConsumed();
        }
    }, [preset, onPresetConsumed]);

    const present = useMemo(() => AGENT_IDS.filter(a => sessions.some(s => s.agent === a)), [sessions]);
    const unreviewedCount = useMemo(
        () => sessions.filter(s => s.risky_count > 0 && !isReviewed(reviewed, sessionKey(s), s.updated_at)).length,
        [sessions, reviewed],
    );

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return sessions.filter(s =>
            (!agent || s.agent === agent) &&
            (listFilter === "all" || (s.risky_count > 0 && (listFilter === "flagged" || !isReviewed(reviewed, sessionKey(s), s.updated_at)))) &&
            (!q || s.title.toLowerCase().includes(q) || (s.project_path ?? "").toLowerCase().includes(q) || s.models.some(m => m.toLowerCase().includes(q)))
        );
    }, [sessions, agent, query, listFilter, reviewed]);

    // Select the first match when nothing (or something filtered out) is selected.
    useEffect(() => {
        if (filtered.length && !filtered.some(s => sessionKey(s) === selected) && !focus) {
            setSelected(sessionKey(filtered[0]));
        }
    }, [filtered, selected, focus]);

    const current = sessions.find(s => sessionKey(s) === selected) ?? null;

    // ↑/↓ (or j/k) move through the list when focus isn't in a text field.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            const dir = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
            if (!dir || !filtered.length) return;
            e.preventDefault();
            const i = filtered.findIndex(s => sessionKey(s) === selected);
            const next = filtered[Math.max(0, Math.min(filtered.length - 1, i + dir))];
            setSelected(sessionKey(next));
            listRef.current?.querySelector(`[data-key="${CSS.escape(sessionKey(next))}"]`)?.scrollIntoView({ block: "nearest" });
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [filtered, selected]);

    const setReviewedFor = (s: AgentSession, done: boolean) =>
        setReviewed(prev => {
            const next = { ...prev };
            if (done) next[sessionKey(s)] = s.updated_at;
            else delete next[sessionKey(s)];
            return next;
        });

    let lastDay = "";
    return (
        <div className="flex flex-col h-full animate-in fade-in duration-200">
            <TabHeader title="Sessions" subtitle="Every conversation your agents had on this machine: what you asked, what they ran, what they changed.">
                <div className="flex flex-wrap items-center gap-3 mt-3">
                    <AgentFilter value={agent} agents={present} onChange={setAgent} />
                    <div className="relative ml-auto">
                        <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            onKeyDown={e => { if (e.key === "Escape") { setQuery(""); (e.target as HTMLInputElement).blur(); } }}
                            placeholder="Search title, project, model"
                            className="h-8 w-60 rounded-lg bg-zinc-900 border border-white/10 pl-8 pr-3 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-white/20"
                        />
                    </div>
                </div>
            </TabHeader>

            <div className="flex-1 flex overflow-hidden">
                <div className="w-[360px] shrink-0 border-r border-white/5 flex flex-col">
                <div className="shrink-0 px-3 pt-3 pb-2 border-b border-white/5 space-y-2">
                    <Segmented<ListFilter>
                        stretch
                        value={listFilter}
                        onChange={setListFilter}
                        options={[
                            { value: "all", label: "All" },
                            { value: "unreviewed", label: `To review${unreviewedCount ? ` · ${unreviewedCount}` : ""}` },
                            { value: "flagged", label: "All flagged" },
                        ]}
                    />
                    <div className="flex items-center justify-between px-1 text-[11px] text-zinc-600">
                        <span>{filtered.length} session{filtered.length === 1 ? "" : "s"}</span>
                        <span className="flex items-center gap-2">
                            <span><kbd className="font-sans text-zinc-500">↑↓</kbd> move</span>
                            <span><kbd className="font-sans text-zinc-500">R</kbd> reviewed</span>
                        </span>
                    </div>
                </div>
                <div ref={listRef} className="flex-1 overflow-y-auto">
                    {loading && sessions.length === 0 ? (
                        <div className="flex items-center gap-2 p-4 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Reading agent history…</div>
                    ) : filtered.length === 0 ? (
                        listFilter === "unreviewed" ? (
                            <Empty icon={<CheckCheck className="h-6 w-6" />} title="All caught up" body="Every session with risky actions has been reviewed. New activity in a session puts it back here." />
                        ) : (
                            <Empty icon={<Bot className="h-6 w-6" />} title="No sessions match" body="Try a different agent or clear the search." />
                        )
                    ) : (
                        filtered.map(s => {
                            const key = sessionKey(s);
                            const day = dayLabel(s.updated_at);
                            const header = day !== lastDay ? day : null;
                            lastDay = day;
                            const open = s.risky_count > 0 && !isReviewed(reviewed, key, s.updated_at);
                            return (
                                <div key={key}>
                                    {header && (
                                        <p className="sticky top-0 z-[1] bg-background/95 backdrop-blur px-4 py-1.5 text-[11px] font-medium text-zinc-500 border-b border-white/5">{header}</p>
                                    )}
                                    <button
                                        data-key={key}
                                        onClick={() => setSelected(key)}
                                        className={`w-full text-left px-4 py-3 border-b border-white/5 flex gap-3 ${key === selected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"}`}
                                    >
                                        <span className="pt-1.5"><AgentDot agent={s.agent} /></span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-white truncate">{s.title}</p>
                                            <p className="text-xs text-zinc-500 truncate mt-0.5">{projectName(s.project_path)} · {fmtTime(s.updated_at)}</p>
                                            <div className="flex items-center gap-3 mt-1 text-[11px] text-zinc-500 tabular-nums">
                                                <span>{fmtTokens(s.total_tokens)} tokens</span>
                                                <span>{s.command_count} cmds</span>
                                                <span>{s.files_changed} files</span>
                                                {s.risky_count > 0 && (
                                                    <span className={`inline-flex items-center gap-0.5 ${open ? "text-amber-300" : "text-zinc-500"}`}>
                                                        {open ? <AlertTriangle className="h-3 w-3" /> : <Check className="h-3 w-3" />}{s.risky_count}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>
                </div>

                <div className="flex-1 overflow-hidden">
                    {current ? (
                        <SessionView
                            key={sessionKey(current)}
                            session={current}
                            editor={editor}
                            reviewed={isReviewed(reviewed, sessionKey(current), current.updated_at)}
                            onReviewed={done => setReviewedFor(current, done)}
                        />
                    ) : (
                        <Empty icon={<MessageSquare className="h-6 w-6" />} title="Pick a session" body="See the prompts, every command the agent ran, the files it touched and anything worth a second look." />
                    )}
                </div>
            </div>
        </div>
    );
}

function SessionView({ session, editor, reviewed, onReviewed }: {
    session: AgentSession; editor: string; reviewed: boolean; onReviewed: (done: boolean) => void;
}) {
    const { toast } = useToast();
    const [detail, setDetail] = useState<SessionDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<EventFilter>(session.risky_count > 0 && !reviewed ? "flagged" : "all");
    const [limit, setLimit] = useState(PAGE);

    useEffect(() => {
        invoke<SessionDetail>("agents_session_detail", { agent: session.agent, sourcePath: session.source_path, id: session.id })
            .then(setDetail)
            .catch(e => setError(String(e)));
    }, [session.agent, session.source_path, session.id]);

    const s = detail?.session ?? session;
    const flaggedCount = (detail?.events ?? []).filter(e => e.risk || e.notice).length;
    const events = useMemo(() => {
        const all = detail?.events ?? [];
        switch (filter) {
            case "prompts": return all.filter(e => e.kind === "prompt");
            case "commands": return all.filter(e => e.kind === "command");
            case "files": return all.filter(e => e.kind === "edit" || e.kind === "write");
            case "flagged": return all.filter(e => e.risk || e.notice);
            default: return all;
        }
    }, [detail, filter]);

    const run = (cmd: string, args: Record<string, string>) =>
        invoke(cmd, args).catch(e => toast({ variant: "destructive", title: "Couldn't open", description: String(e) }));

    // R toggles "reviewed" for sessions with risky actions.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement;
            if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "r" || s.risky_count === 0) return;
            if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
            e.preventDefault();
            onReviewed(!reviewed);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [s.risky_count, reviewed, onReviewed]);

    return (
        <div className="h-full flex flex-col">
            <div className="shrink-0 px-6 py-4 border-b border-white/5 space-y-3">
                <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                        <h3 className="text-base font-semibold text-white leading-snug">{s.title}</h3>
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            <MetaChip><AgentChip agent={s.agent} /></MetaChip>
                            {s.project_path && (
                                <MetaChip title={s.project_path}><FolderOpen className="h-3 w-3 text-zinc-500" />{projectName(s.project_path)}</MetaChip>
                            )}
                            <MetaChip title={`${fmtDateTime(s.started_at, { dateStyle: "medium", timeStyle: "short" })} – ${fmtDateTime(s.updated_at, { dateStyle: "medium", timeStyle: "short" })}`}>
                                <Clock className="h-3 w-3 text-zinc-500" />
                                {fmtDateTime(s.started_at)} · {fmtDuration(s.updated_at - s.started_at)}
                            </MetaChip>
                            {s.models.map(m => <MetaChip key={m}><Sparkle className="h-3 w-3 text-zinc-500" />{m}</MetaChip>)}
                        </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                        {s.project_path && (
                            <Button size="sm" variant="ghost" className="text-zinc-400" onClick={() => run("open_in_editor", { path: s.project_path!, editor })}>
                                <Code2 /> Open project
                            </Button>
                        )}
                        <Button size="sm" variant="ghost" className="text-zinc-400" title="Show the transcript file" onClick={() => run("open_in_finder", { path: s.source_path.replace(/[\\/][^\\/]*$/, "") })}>
                            <FolderOpen /> Transcript
                        </Button>
                    </div>
                </div>

                {s.risky_count > 0 && (
                    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${reviewed ? "border-white/5 bg-white/[0.02]" : "border-amber-500/25 bg-amber-500/5"}`}>
                        {reviewed ? <CheckCheck className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 text-amber-400" />}
                        <p className="flex-1 text-xs text-zinc-300">
                            {reviewed
                                ? "You've reviewed this session's risky actions."
                                : `${s.risky_count} risky action${s.risky_count === 1 ? "" : "s"} in this session. Check them, then mark it reviewed.`}
                        </p>
                        {reviewed ? (
                            <Button size="sm" variant="ghost" className="text-zinc-500 h-7" onClick={() => onReviewed(false)}><RotateCcw /> Undo</Button>
                        ) : (
                            <Button size="sm" variant="secondary" className="h-7" onClick={() => onReviewed(true)} title="Mark reviewed (R)">
                                <Check /> Mark reviewed <kbd className="ml-1 text-[10px] font-sans text-zinc-500">R</kbd>
                            </Button>
                        )}
                    </div>
                )}

                <TokenBar session={s} />

                {s.partial && (
                    <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                        <Info className="h-3.5 w-3.5" /> This agent keeps only part of its history on disk, so some details may be missing.
                    </p>
                )}

                <Segmented<EventFilter>
                    value={filter}
                    onChange={v => { setFilter(v); setLimit(PAGE); }}
                    options={[
                        { value: "all", label: "Everything" },
                        { value: "prompts", label: "Prompts" },
                        { value: "commands", label: `Commands · ${s.command_count}` },
                        { value: "files", label: `Files · ${s.files_changed}` },
                        { value: "flagged", label: `Flagged · ${flaggedCount}` },
                    ]}
                />
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-3">
                {error ? (
                    <p className="text-sm text-red-400">{error}</p>
                ) : !detail ? (
                    <div className="space-y-2 py-2" aria-busy="true">
                        {[70, 45, 60, 35].map(w => <div key={w} className="h-4 rounded bg-white/[0.05] animate-pulse" style={{ width: `${w}%` }} />)}
                    </div>
                ) : events.length === 0 ? (
                    <Empty title="Nothing here" body={filter === "flagged" ? "No risky or notable actions in this session." : undefined} />
                ) : (
                    <ol className="space-y-1">
                        {events.slice(0, limit).map((e, i) => <EventRow key={i} e={e} />)}
                        {events.length > limit && (
                            <li className="pt-2">
                                <Button size="sm" variant="ghost" className="text-zinc-400" onClick={() => setLimit(l => l + PAGE)}>
                                    Show {Math.min(PAGE, events.length - limit)} more of {events.length - limit}
                                </Button>
                            </li>
                        )}
                    </ol>
                )}
            </div>
        </div>
    );
}

function MetaChip({ children, title }: { children: ReactNode; title?: string }) {
    return (
        <span title={title} className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md border border-white/[0.06] bg-white/[0.02] text-xs text-zinc-300 max-w-[260px] truncate">
            {children}
        </span>
    );
}

/** Where the session's tokens went, as one proportional bar. */
function TokenBar({ session: s }: { session: AgentSession }) {
    const t = s.tokens;
    const parts = [
        { k: "Cache read", v: t.cache_read, cls: "bg-primary/30" },
        { k: "Cache write", v: t.cache_write, cls: "bg-primary/55" },
        { k: "Input", v: t.input, cls: "bg-primary/80" },
        { k: "Output", v: t.output, cls: "bg-primary" },
    ];
    const total = parts.reduce((n, p) => n + p.v, 0);
    return (
        <div className="rounded-lg border border-white/[0.06] bg-zinc-900/40 px-3 py-2.5">
            <div className="flex items-baseline gap-3">
                <p className="text-sm font-semibold text-white tabular-nums">{fmtTokens(s.total_tokens)} <span className="text-xs font-normal text-zinc-500">tokens</span></p>
                <p className="text-xs text-zinc-500 tabular-nums">
                    {s.command_count} commands · {s.files_changed} files · {s.cost_usd != null ? `$${s.cost_usd.toFixed(2)} reported` : `${fmtBytes(s.size_bytes)} transcript`}
                </p>
            </div>
            {total > 0 && (
                <>
                    <div className="flex h-1.5 mt-2 rounded-full overflow-hidden gap-[2px]" role="img" aria-label="Token breakdown">
                        {parts.filter(p => p.v > 0).map(p => <span key={p.k} className={p.cls} style={{ flex: p.v }} title={`${p.k}: ${fmtTokens(p.v)}`} />)}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                        {parts.map(p => (
                            <span key={p.k} className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
                                <span className={`h-2 w-2 rounded-sm ${p.cls}`} />
                                {p.k} <span className="text-zinc-300 tabular-nums">{fmtTokens(p.v)}</span>
                            </span>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

const KIND_ICON: Record<SessionEvent["kind"], typeof Terminal> = {
    prompt: MessageSquare,
    command: Terminal,
    edit: FileEdit,
    write: FilePlus,
    tool: Wrench,
    reply: Bot,
};

/** Splits `text` so the flagged fragment can be highlighted. */
function highlightParts(text: string, match: string | null) {
    if (!match) return null;
    const at = text.indexOf(match);
    return at < 0 ? null : { before: text.slice(0, at), hit: match, after: text.slice(at + match.length) };
}

function Highlighted({ text, match }: { text: string; match: string | null }) {
    const p = highlightParts(text, match);
    if (!p) return <>{text}</>;
    return <>{p.before}<mark className="rounded-sm bg-amber-400/25 text-amber-100 px-0.5 -mx-0.5">{p.hit}</mark>{p.after}</>;
}

/** A short window of `text` centred on the flagged fragment. */
function excerpt(text: string, match: string, radius = 90) {
    const at = text.indexOf(match);
    if (at < 0) return null;
    const start = Math.max(0, at - radius);
    const end = Math.min(text.length, at + match.length + radius);
    return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s*\n\s*/g, " ⏎ ")}${end < text.length ? "…" : ""}`;
}

function EventRow({ e }: { e: SessionEvent }) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const Icon = KIND_ICON[e.kind] ?? Wrench;
    const mono = e.kind === "command" || e.kind === "edit" || e.kind === "write";
    const long = e.text.length > 220 || e.text.includes("\n");
    const flag = e.risk ?? e.notice;
    // Collapsed long commands show the flagged part, not just the first lines.
    const snippet = !open && long && e.matched ? excerpt(e.text, e.matched) : null;
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(e.text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        } catch { /* clipboard unavailable */ }
    };
    const textCls = `${mono ? "font-mono text-[12px]" : "text-[13px]"} ${e.kind === "prompt" ? "text-white" : e.kind === "reply" ? "text-zinc-400" : "text-zinc-200"} whitespace-pre-wrap break-words`;
    return (
        <li className={`group flex gap-3 rounded-lg px-2 py-2 ${e.risk ? "bg-amber-500/[0.04] border border-amber-500/15" : "border border-transparent hover:bg-white/[0.02]"}`}>
            <span className="text-[11px] text-zinc-600 tabular-nums w-14 shrink-0 pt-0.5">
                {e.ts ? fmtTime(e.ts) : ""}
            </span>
            <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${e.kind === "prompt" ? "text-primary" : "text-zinc-500"}`} />
            <div className="flex-1 min-w-0">
                {flag && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
                        {e.risk ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded px-1.5 py-0.5">
                                <AlertTriangle className="h-3 w-3" /> {e.risk}
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-300 bg-white/5 border border-white/10 rounded px-1.5 py-0.5">
                                <Info className="h-3 w-3" /> {e.notice}
                            </span>
                        )}
                        {RISK_HELP[flag] && <span className="text-[11px] text-zinc-500">{RISK_HELP[flag]}</span>}
                    </div>
                )}
                <button onClick={() => long && setOpen(o => !o)} className={`block w-full text-left ${long ? "cursor-pointer" : "cursor-text"}`}>
                    {snippet ? (
                        <p className={textCls}><Highlighted text={snippet} match={e.matched} /></p>
                    ) : (
                        <p className={`${textCls} ${open ? "" : "line-clamp-3"}`}><Highlighted text={e.text} match={e.matched} /></p>
                    )}
                    {long && (
                        <span className="text-[11px] text-zinc-600 hover:text-zinc-400">
                            {open ? "Show less" : snippet ? `Show full command (${e.text.split("\n").length} lines)` : "Show all"}
                        </span>
                    )}
                </button>
                {e.detail && <p className="text-[11px] text-zinc-500 truncate mt-1">{e.detail}</p>}
            </div>
            {mono && (
                <button onClick={copy} className="self-start p-1 rounded text-zinc-600 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-white hover:bg-white/10 transition-opacity" aria-label="Copy">
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
            )}
        </li>
    );
}

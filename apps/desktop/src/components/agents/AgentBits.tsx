import type { ReactNode } from "react";
import { agentMeta } from "@/lib/agents";

export function AgentDot({ agent, size = 8 }: { agent: string; size?: number }) {
    return (
        <span
            className="inline-block rounded-full shrink-0"
            style={{ width: size, height: size, background: agentMeta(agent).color }}
            aria-hidden
        />
    );
}

/** Agent identity: colored dot + name in text ink (never colored text). */
export function AgentChip({ agent, className = "" }: { agent: string; className?: string }) {
    return (
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300 ${className}`}>
            <AgentDot agent={agent} />
            {agentMeta(agent).label}
        </span>
    );
}

export function TabHeader({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children?: ReactNode }) {
    return (
        <div className="shrink-0 px-6 pt-5 pb-4 border-b border-white/5">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h2 className="text-lg font-bold text-white">{title}</h2>
                    {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
                </div>
                {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
            </div>
            {children}
        </div>
    );
}

export function StatTile({ label, value, sub, onClick, tone = "default" }: {
    label: string; value: string; sub?: string; onClick?: () => void; tone?: "default" | "warn";
}) {
    const Comp = onClick ? "button" : "div";
    return (
        <Comp
            onClick={onClick}
            className={`text-left rounded-xl border px-4 py-3 bg-zinc-900/60 transition-colors ${tone === "warn" ? "border-amber-500/25" : "border-white/5"} ${onClick ? "hover:bg-zinc-900 hover:border-white/10 cursor-pointer" : ""}`}
        >
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
            <p className="text-2xl font-semibold text-white mt-1 tabular-nums">{value}</p>
            {sub && <p className="text-xs text-zinc-500 mt-0.5 truncate">{sub}</p>}
        </Comp>
    );
}

export function Section({ title, right, children, className = "" }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={`rounded-xl border border-white/5 bg-zinc-900/40 overflow-hidden ${className}`}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
                <h3 className="text-sm font-semibold text-white">{title}</h3>
                {right}
            </div>
            {children}
        </section>
    );
}

export function Empty({ icon, title, body }: { icon?: ReactNode; title: string; body?: string }) {
    return (
        <div className="flex flex-col items-center justify-center text-center py-12 px-6 gap-2">
            {icon && <div className="text-zinc-600 mb-1">{icon}</div>}
            <p className="text-sm font-medium text-zinc-300">{title}</p>
            {body && <p className="text-xs text-zinc-500 max-w-sm leading-relaxed">{body}</p>}
        </div>
    );
}

export function Segmented<T extends string>({ value, options, onChange, stretch = false }: {
    value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
    /** Fill the available width with equal segments. */
    stretch?: boolean;
}) {
    return (
        <div className={`${stretch ? "flex w-full" : "inline-flex"} rounded-lg border border-white/10 bg-zinc-900/60 p-0.5`} role="tablist">
            {options.map(o => (
                <button
                    key={o.value}
                    role="tab"
                    aria-selected={value === o.value}
                    onClick={() => onChange(o.value)}
                    className={`${stretch ? "flex-1" : ""} px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${value === o.value ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

export function AgentFilter({ value, agents, onChange }: {
    value: string | null; agents: string[]; onChange: (a: string | null) => void;
}) {
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <button
                onClick={() => onChange(null)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${value === null ? "border-white/20 bg-white/10 text-white" : "border-white/5 text-zinc-500 hover:text-zinc-300"}`}
            >
                All agents
            </button>
            {agents.map(a => (
                <button
                    key={a}
                    onClick={() => onChange(value === a ? null : a)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${value === a ? "border-white/20 bg-white/10 text-white" : "border-white/5 text-zinc-500 hover:text-zinc-300"}`}
                >
                    <AgentDot agent={a} size={7} />
                    {agentMeta(a).label}
                </button>
            ))}
        </div>
    );
}

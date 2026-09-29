import { LocalProject } from "../types";
import { Crown } from "lucide-react";

export function ProjectHealthPills({ project }: { project: LocalProject }) {
    const issues: { label: string; color: string }[] = [];
    if (project.is_stale) issues.push({ label: "Abandoned 90d+", color: "bg-red-500/10 text-red-400 border-red-500/20" });
    else if (project.activity_status === "inactive") issues.push({ label: "Inactive 30-90d", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" });
    if (project.project_size_bytes > 1_000_000_000) issues.push({ label: "Large project >1 GB", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" });
    if (project.total_dep_size_bytes > 500_000_000) issues.push({ label: "Heavy caches >500 MB", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" });
    if (issues.length === 0) {
        return <span className="text-xs text-emerald-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />No issues detected</span>;
    }
    return (
        <div className="flex flex-wrap gap-1.5">
            {issues.map((issue, i) => (
                <span key={i} className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${issue.color}`}>{issue.label}</span>
            ))}
        </div>
    );
}

export function ProBadge({ onClick }: { onClick?: () => void }) {
    return (
        <button
            onClick={(e) => { e.stopPropagation(); onClick?.(); }}
            className="flex items-center gap-1 text-[10px] font-bold bg-violet-500/15 text-violet-400 px-1.5 py-0.5 rounded border border-violet-500/20 hover:bg-violet-500/25 transition-colors"
        >
            <Crown className="w-2.5 h-2.5" /> PRO
        </button>
    );
}

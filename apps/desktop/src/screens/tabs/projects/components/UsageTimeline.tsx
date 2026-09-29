import { Clock, GitCommitHorizontal, Terminal, FolderOpen, Trash2, AlertTriangle } from "lucide-react";
import { LocalProject, UsageTimelineEvent } from "../types";
import { buildUsageTimeline, formatRelativeTime } from "../utils";

interface UsageTimelineProps {
    project: LocalProject;
}

const KIND_ICON: Record<UsageTimelineEvent["kind"], React.ReactNode> = {
    commit: <GitCommitHorizontal className="h-3.5 w-3.5" />,
    run: <Terminal className="h-3.5 w-3.5" />,
    opened: <FolderOpen className="h-3.5 w-3.5" />,
    deps_updated: <Clock className="h-3.5 w-3.5" />,
    archive_flag: <AlertTriangle className="h-3.5 w-3.5" />,
    clean: <Trash2 className="h-3.5 w-3.5" />,
};

const KIND_COLOR: Record<UsageTimelineEvent["kind"], string> = {
    commit: "text-primary bg-primary/10",
    run: "text-emerald-400 bg-emerald-500/10",
    opened: "text-zinc-400 bg-white/5",
    deps_updated: "text-blue-400 bg-blue-500/10",
    archive_flag: "text-amber-400 bg-amber-500/10",
    clean: "text-amber-400 bg-amber-500/10",
};

export function UsageTimeline({ project }: UsageTimelineProps) {
    const events = buildUsageTimeline(project);

    return (
        <div className="bg-zinc-900 border border-white/5 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    Usage Timeline
                </h3>
            </div>

            {events.length === 0 ? (
                <div className="px-4 py-8 text-center">
                    <p className="text-sm text-zinc-600">No usage activity recorded yet.</p>
                </div>
            ) : (
                <div className="p-4">
                    <div className="relative">
                        <div className="absolute left-[15px] top-0 bottom-0 w-px bg-white/5" />
                        <div className="space-y-4">
                            {events.map((e, i) => (
                                <div key={e.id + i} className="flex items-start gap-3 relative">
                                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 relative z-10 ${KIND_COLOR[e.kind]}`}>
                                        {KIND_ICON[e.kind]}
                                    </div>
                                    <div className="flex-1 min-w-0 pt-1">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <span className="text-sm text-white font-medium">{e.label}</span>
                                            <span className="text-xs text-zinc-600 shrink-0">
                                                {formatRelativeTime(Math.floor(e.timestamp / 1000))}
                                            </span>
                                        </div>
                                        {e.detail && (
                                            <p className="text-xs text-zinc-500 mt-0.5 truncate">{e.detail}</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

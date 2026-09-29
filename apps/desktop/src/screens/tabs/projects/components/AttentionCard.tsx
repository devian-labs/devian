import { AlertTriangle, Loader2, ShieldAlert, Trash2, RefreshCw, Archive, KeyRound } from "lucide-react";
import { HealthIssue } from "../types";

interface AttentionCardProps {
    issues: HealthIssue[];
    depLoading?: boolean;
    onFixVulnerabilities?: () => void;
    onUpdatePatches?: () => void;
    onCleanup?: () => void;
    onArchive?: () => void;
    onManageEnv?: () => void;
}

const SEVERITY_COLOR: Record<string, string> = {
    critical: "text-red-400",
    high:     "text-red-400",
    medium:   "text-amber-400",
    low:      "text-zinc-400",
};

const ISSUE_ICON: Record<HealthIssue["type"], React.ReactNode> = {
    vulnerability: <ShieldAlert className="h-4 w-4 shrink-0" />,
    outdated_deps: <RefreshCw className="h-4 w-4 shrink-0" />,
    large_cleanup: <Trash2 className="h-4 w-4 shrink-0" />,
    stale:         <Archive className="h-4 w-4 shrink-0" />,
    missing_env:   <KeyRound className="h-4 w-4 shrink-0" />,
};

// Button styles per severity
const BTN_STYLE: Record<string, string> = {
    critical: "text-red-400 border-red-500/25 bg-red-500/5 hover:bg-red-500/15",
    high:     "text-red-400 border-red-500/25 bg-red-500/5 hover:bg-red-500/15",
    medium:   "text-amber-400 border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/15",
    low:      "text-zinc-400 border-zinc-700 bg-zinc-800/50 hover:bg-zinc-700/60",
};

export function AttentionCard({
    issues, depLoading,
    onFixVulnerabilities, onUpdatePatches, onCleanup, onArchive, onManageEnv,
}: AttentionCardProps) {
    if (depLoading) {
        return (
            <div className="bg-zinc-900 border border-white/5 rounded-xl p-4">
                <div className="flex items-center gap-2 text-zinc-500 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Scanning dependencies for issues...
                </div>
            </div>
        );
    }

    if (issues.length === 0) return null;

    const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorted = [...issues].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

    const actionFor = (issue: HealthIssue) => {
        switch (issue.type) {
            case "vulnerability":  return { label: "Fix Vulnerabilities", handler: onFixVulnerabilities };
            case "outdated_deps":  return { label: "Update Patches",      handler: onUpdatePatches };
            case "large_cleanup":  return { label: "Clean Now",           handler: onCleanup };
            case "stale":          return { label: "Archive Project",     handler: onArchive };
            case "missing_env":    return { label: "Manage .env",         handler: onManageEnv };
        }
    };

    return (
        <div className="bg-zinc-900 border border-amber-500/20 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-amber-500/5">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <span className="text-sm font-semibold text-white">Attention Needed</span>
                <span className="ml-auto text-xs text-zinc-500">{issues.length} issue{issues.length > 1 ? "s" : ""}</span>
            </div>
            <div className="divide-y divide-white/4">
                {sorted.map((issue, i) => {
                    const { label, handler } = actionFor(issue);
                    const btnStyle = BTN_STYLE[issue.severity] ?? BTN_STYLE.low;
                    return (
                        <div key={i} className="flex items-center gap-3 px-4 py-3">
                            <span className={SEVERITY_COLOR[issue.severity]}>
                                {ISSUE_ICON[issue.type]}
                            </span>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-white">{issue.label}</p>
                                {issue.sublabel && (
                                    <p className="text-xs text-zinc-500 truncate mt-0.5">{issue.sublabel}</p>
                                )}
                            </div>
                            {handler && (
                                <button
                                    onClick={handler}
                                    className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${btnStyle}`}
                                >
                                    {label}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

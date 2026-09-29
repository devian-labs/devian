import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    FolderGit2, GitBranch, ArrowLeft,
    Terminal, Code2, FolderOpen, Archive, Trash2,
    Play, Loader2, Wrench, Sparkles,
} from "lucide-react";
import {
    LocalProject, ProjectHealthSummary, ArchiveIntelligence, PrimaryCTA, HealthStatus,
} from "../types";

// ── Health status config ───────────────────────────────────────────────────

const STATUS_CONFIG: Record<HealthStatus, { label: string; color: string; dot: string }> = {
    healthy: { label: "Healthy", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-400" },
    needs_attention: { label: "Needs Attention", color: "text-amber-400 bg-amber-500/10 border-amber-500/20", dot: "bg-amber-400" },
    inactive: { label: "Inactive", color: "text-zinc-400 bg-zinc-800 border-zinc-700", dot: "bg-zinc-500" },
    archive_candidate: { label: "Archive Candidate", color: "text-red-400 bg-red-500/10 border-red-500/20", dot: "bg-red-400" },
};

function scoreColor(s: number) {
    if (s >= 80) return "text-emerald-400";
    if (s >= 60) return "text-amber-400";
    if (s >= 40) return "text-orange-400";
    return "text-red-400";
}

const CTA_ICON: Record<PrimaryCTA["kind"], React.ReactNode> = {
    run: <Play className="h-4 w-4" />,
    fix_vulns: <Wrench className="h-4 w-4" />,
    clean: <Sparkles className="h-4 w-4" />,
    archive: <Archive className="h-4 w-4" />,
};

const CTA_CLASS: Record<PrimaryCTA["color"], string> = {
    primary: "bg-primary hover:bg-primary/90 text-white",
    destructive: "bg-red-600 hover:bg-red-700 text-white",
    warning: "bg-amber-600 hover:bg-amber-700 text-white",
};

// ── Main header ────────────────────────────────────────────────────────────

interface ProjectDetailPageHeaderProps {
    project: LocalProject;
    homeDir: string;
    health: ProjectHealthSummary;
    primaryCTA: PrimaryCTA;
    archiveConf: ArchiveIntelligence;
    activeTab: "overview" | "activity";
    archiving: boolean;
    onBack: () => void;
    onTabChange: (tab: "overview" | "activity") => void;
    onPrimaryAction: () => void;
    onOpenFinder: () => void;
    onOpenTerminal: () => void;
    onOpenEditor: () => void;
    onArchive: () => void;
    onDelete: () => void;
}

export function ProjectDetailPageHeader({
    project,
    homeDir,
    health,
    primaryCTA,
    activeTab,
    archiving,
    onBack,
    onTabChange,
    onPrimaryAction,
    onOpenFinder,
    onOpenTerminal,
    onOpenEditor,
    onArchive,
    onDelete,
}: ProjectDetailPageHeaderProps) {
    const displayPath = homeDir ? project.path.replace(homeDir, "~") : project.path;
    const statusCfg = STATUS_CONFIG[health.status];

    return (
        <div className="shrink-0 border-b border-white/5 bg-background">
            {/* Top bar: back + secondary actions */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
                <Button
                    variant="ghost" size="sm"
                    className="text-zinc-500 hover:text-white -ml-2 gap-1.5"
                    onClick={onBack}
                >
                    <ArrowLeft className="h-4 w-4" /> Projects
                </Button>

                {/* Secondary actions */}
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-500 hover:text-white" onClick={onOpenFinder} title="Open in Finder">
                        <FolderOpen className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-500 hover:text-white" onClick={onOpenTerminal} title="Open in Terminal">
                        <Terminal className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-500 hover:text-white" onClick={onOpenEditor} title="Open in Editor">
                        <Code2 className="h-4 w-4" />
                    </Button>
                    <div className="w-px h-4 bg-white/10 mx-1" />
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-500 hover:text-amber-400" onClick={onArchive} title="Archive Project" disabled={archiving}>
                        {archiving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-500 hover:text-red-400" onClick={onDelete} title="Delete Project">
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Project identity + health + CTA */}
            <div className="px-5 pb-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                            <FolderGit2 className="h-5 w-5 text-primary shrink-0" />
                            <h2 className="text-xl font-bold text-white truncate">{project.name}</h2>
                        </div>
                        <p className="text-xs text-zinc-500 font-mono mb-2 truncate">{displayPath}</p>

                        {/* Stack + branch + runtime version */}
                        <div className="flex flex-wrap gap-1.5">
                            {/* Runtime version badge — most prominent */}
                            {project.runtime_name && (
                                <Badge variant="secondary" className="text-[11px] px-1.5 py-0.5 bg-zinc-700 text-zinc-300 border-zinc-600 gap-1 font-mono">
                                    {project.runtime_name}{project.runtime_version ? ` ${project.runtime_version}` : ""}
                                </Badge>
                            )}
                            {project.stack.filter(s => s !== "Unknown").map((t, i) => (
                                <Badge key={i} variant="secondary" className="text-[11px] px-1.5 py-0.5 bg-primary/10 text-primary border-primary/20">
                                    {t}
                                </Badge>
                            ))}
                            {project.current_branch && project.current_branch !== "unknown" && (
                                <Badge variant="secondary" className="text-[11px] px-1.5 py-0.5 bg-blue-500/10 text-blue-400 border-blue-500/20 gap-1">
                                    <GitBranch className="h-3 w-3" />{project.current_branch}
                                </Badge>
                            )}
                        </div>

                        {/* Health score + status */}
                        <div className="flex items-center gap-4 mt-3">
                            <div className="flex items-baseline gap-1.5">
                                <span className={`text-2xl font-bold tabular-nums ${scoreColor(health.score)}`}>
                                    {health.score}
                                </span>
                                <span className="text-xs text-zinc-600">/ 100</span>
                            </div>
                            <Badge variant="outline" className={`text-[11px] h-5 px-2 border font-medium gap-1 ${statusCfg.color}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${statusCfg.dot}`} />
                                {statusCfg.label}
                            </Badge>
                        </div>
                    </div>

                    {/* Primary CTA */}
                    <Button
                        className={`shrink-0 gap-2 mt-6 ${CTA_CLASS[primaryCTA.color]}`}
                        onClick={onPrimaryAction}
                    >
                        {CTA_ICON[primaryCTA.kind]}
                        {primaryCTA.label}
                    </Button>
                </div>
            </div>

            {/* Tab bar */}
            <div className="flex px-5 gap-0">
                {(["overview", "activity"] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => onTabChange(tab)}
                        className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 transition-colors ${
                            activeTab === tab
                                ? "text-white border-primary"
                                : "text-zinc-500 border-transparent hover:text-zinc-300"
                        }`}
                    >
                        {tab}
                    </button>
                ))}
            </div>
        </div>
    );
}

// ── Legacy exports (kept for backwards compat with other code paths) ───────

export { };

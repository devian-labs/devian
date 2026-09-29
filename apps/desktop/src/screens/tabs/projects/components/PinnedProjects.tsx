import { Pin, Activity, Terminal, Code2, FolderOpen } from "lucide-react";
import { LocalProject } from "../types";
import { formatRelativeTime } from "../utils";

interface PinnedProjectsProps {
    projects: LocalProject[];
    onSelectProject: (project: LocalProject) => void;
    onOpenTerminal: (path: string) => void;
    onOpenEditor: (path: string) => void;
    onOpenFinder: (path: string) => void;
}

export function PinnedProjects({ projects, onSelectProject, onOpenTerminal, onOpenEditor, onOpenFinder }: PinnedProjectsProps) {
    if (projects.length === 0) return null;

    return (
        <div>
            <p className="text-[11px] font-semibold text-muted-foreground/60 mb-2.5 flex items-center gap-1.5"><Pin className="h-3.5 w-3.5 fill-muted-foreground/60" /> Pinned Repositories</p>
            <div className="grid grid-cols-4 gap-2">
                {projects.map((proj, i) => (
                    <div
                        key={`pin-${i}`}
                        className="flex flex-col gap-1.5 bg-surface-a10 border border-amber-500/15 rounded-xl px-3 py-2.5 cursor-pointer hover:bg-amber-500/5 hover:border-amber-500/30 transition-all group"
                        onClick={() => onSelectProject(proj)}
                    >
                        {/* Row 1: dot + name */}
                        <div className="flex items-center gap-2 min-w-0">
                            <Pin className="w-3 h-3 text-amber-400 shrink-0 fill-amber-400" />
                            <span className="text-sm font-medium text-white group-hover:text-amber-300 transition-colors truncate">{proj.name}</span>
                        </div>
                        {/* Row 2: last active left, actions right */}
                        <div className="flex items-center justify-between" onClick={e => e.stopPropagation()}>
                            <span className="text-[10px] text-muted-foreground/60">{formatRelativeTime(proj.last_commit_timestamp)}</span>
                            <div className="flex items-center gap-1.5">
                                <button onClick={() => onOpenTerminal(proj.path)} className="text-muted-foreground/40 hover:text-white transition-colors" title="Open in terminal">
                                    <Terminal className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => onOpenEditor(proj.path)} className="text-muted-foreground/40 hover:text-white transition-colors" title="Open in editor">
                                    <Code2 className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => onOpenFinder(proj.path)} className="text-muted-foreground/40 hover:text-white transition-colors" title="Open in Finder">
                                    <FolderOpen className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

interface RecentlyActiveProjectsProps {
    projects: LocalProject[];
    onSelectProject: (project: LocalProject) => void;
    onOpenTerminal: (path: string) => void;
    onOpenEditor: (path: string) => void;
    onOpenFinder: (path: string) => void;
}

export function RecentlyActiveProjects({ projects, onSelectProject, onOpenTerminal, onOpenEditor, onOpenFinder }: RecentlyActiveProjectsProps) {
    if (projects.length === 0) return null;

    return (
        <div>
            <p className="text-[11px] font-semibold text-muted-foreground/60 mb-2.5 flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> Recently Active</p>
            <div className="grid grid-cols-4 gap-2">
                {projects.map((proj, i) => (
                    <div
                        key={`rec-${i}`}
                        className="flex flex-col gap-1.5 bg-surface-a10 border border-emerald-500/15 rounded-xl px-3 py-2.5 cursor-pointer hover:bg-emerald-500/5 hover:border-emerald-500/30 transition-all group"
                        onClick={() => onSelectProject(proj)}
                    >
                        {/* Row 1: dot + name */}
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                            <span className="text-sm font-medium text-white group-hover:text-emerald-300 transition-colors truncate">{proj.name}</span>
                        </div>
                        {/* Row 2: last active left, actions right */}
                        <div className="flex items-center justify-between" onClick={e => e.stopPropagation()}>
                            <span className="text-[10px] text-muted-foreground/60">{formatRelativeTime(proj.last_commit_timestamp)}</span>
                            <div className="flex items-center gap-1.5">
                                <button onClick={() => onOpenTerminal(proj.path)} className="text-muted-foreground/40 hover:text-white transition-colors" title="Open in terminal">
                                    <Terminal className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => onOpenEditor(proj.path)} className="text-muted-foreground/40 hover:text-white transition-colors" title="Open in editor">
                                    <Code2 className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => onOpenFinder(proj.path)} className="text-muted-foreground/40 hover:text-white transition-colors" title="Open in Finder">
                                    <FolderOpen className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

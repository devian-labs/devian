import {
    ChevronRight, GitCommitHorizontal, FolderOpen, Terminal, Code2,
    Trash2, Pin, Archive, Tag as TagIcon
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    ContextMenuSeparator,
    ContextMenuShortcut,
    ContextMenuLabel
} from "@/components/ui/context-menu";
import { LocalProject, AVAILABLE_TAGS } from "../types";
import { formatBytes, formatRelativeTime } from "../utils";

interface ProjectCardProps {
    project: LocalProject;
    homeDir: string;
    deletingPaths: Set<string>;
    onSelectProject: (project: LocalProject) => void;
    onOpenFinder: (path: string) => void;
    onOpenTerminal: (path: string) => void;
    onOpenEditor: (path: string) => void;
    onToggleFavorite: (project: LocalProject, e?: React.MouseEvent) => void;
    onToggleTag: (project: LocalProject, tag: string, e?: React.MouseEvent) => void;
    onDeleteFolder: (basePath: string, folderName: string) => void;
    onArchive?: (path: string, name: string) => void;
}

export function ProjectCard({
    project,
    homeDir,
    deletingPaths,
    onSelectProject,
    onOpenFinder,
    onOpenTerminal,
    onOpenEditor,
    onToggleFavorite,
    onToggleTag,
    onDeleteFolder,
    onArchive,
}: ProjectCardProps) {
    const displayPath = homeDir ? project.path.replace(homeDir, "~") : project.path;
    const hasCleanable = project.dependency_folders.length > 0 && project.total_dep_size_bytes > 0;

    // Read vulnerability cache for this project
    let vulnCount = 0;
    let hasHighVuln = false;
    try {
        const key = `devian_dep_status_${btoa(project.path).replace(/=/g, "")}`;
        const cached = localStorage.getItem(key);
        if (cached) {
            const status = JSON.parse(cached);
            const highs = (status.vulnerabilities || []).filter(
                (v: { severity: string }) => v.severity === "high" || v.severity === "critical"
            );
            vulnCount = status.vulnerabilities?.length || 0;
            hasHighVuln = highs.length > 0;
        }
    } catch {}

    return (
        <ContextMenu>
            <ContextMenuTrigger className="block h-full">
                <Card
                    className="bg-surface-a10 border-white/5 hover:bg-white/3 transition-all duration-150 group cursor-pointer h-full flex flex-col"
                    onClick={() => onSelectProject(project)}
                    onDoubleClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                    }}
                >
                    <CardContent className="py-3.5 px-4 flex flex-col h-full gap-2.5">
                        {/* Title row */}
                        <div className="flex items-center gap-2">
                            <span
                                className={`w-2.5 h-2.5 rounded-full shrink-0 ${project.activity_status === "active" ? "bg-emerald-400" :
                                    project.activity_status === "inactive" ? "bg-amber-400" : "bg-red-400"
                                    }`}
                                title={project.activity_status}
                            />
                            <span className="text-sm font-semibold text-white truncate flex-1 flex items-center gap-2">
                                {project.name}
                            </span>
                            {project.health_score !== undefined && (
                                <span
                                    className={`text-[11px] font-bold tabular-nums shrink-0 ${
                                        project.health_score >= 80 ? "text-emerald-400" :
                                        project.health_score >= 60 ? "text-amber-400" : "text-red-400"
                                    }`}
                                    title={`Health score: ${project.health_score}/100`}
                                >
                                    {project.health_score}
                                </span>
                            )}
                            {vulnCount > 0 && (
                                <span
                                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                                        hasHighVuln
                                            ? "bg-red-500/10 text-red-400 border-red-500/20"
                                            : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                    }`}
                                    title={`${vulnCount} vulnerabilit${vulnCount > 1 ? "ies" : "y"} found`}
                                >
                                    {vulnCount} vuln{vulnCount > 1 ? "s" : ""}
                                </span>
                            )}
                            {project.project_size_bytes > 0 && (
                                <span className="text-xs text-muted-foreground shrink-0">{formatBytes(project.project_size_bytes)}</span>
                            )}

                            <button
                                onClick={(e) => onToggleFavorite(project, e)}
                                className="text-muted-foreground/50 hover:text-amber-400 transition-colors ml-1 focus:outline-hidden"
                                title={project.is_favorite ? "Unpin Project" : "Pin Project"}
                            >
                                <Pin className={`h-4 w-4 ${project.is_favorite ? "text-amber-400 fill-amber-400" : ""}`} />
                            </button>

                            <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary shrink-0 transition-colors" />
                        </div>

                        {/* Path */}
                        <p className="text-xs text-muted-foreground font-mono truncate">{displayPath}</p>

                        {/* Tech · runtime · cleanable · branch */}
                        <div className="flex items-center gap-1.5">
                            <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                                {/* Runtime version */}
                                {project.runtime_name && (
                                    <Badge variant="secondary" className="text-[11px] px-2 py-0.5 bg-zinc-800 text-zinc-400 border-zinc-700 font-mono">
                                        {project.runtime_name}{project.runtime_version ? ` ${project.runtime_version}` : ""}
                                    </Badge>
                                )}
                                {project.stack.filter(s => s !== "Unknown").length > 0
                                    ? project.stack.filter(s => s !== "Unknown").map((tech, i) => (
                                        <Badge key={i} variant="secondary" className="text-[11px] px-2 py-0.5 bg-primary/10 text-primary border-primary/20">{tech}</Badge>
                                    ))
                                    : <Badge variant="secondary" className="text-[11px] px-2 py-0.5 bg-white/5 text-muted-foreground border-white/10">Unknown</Badge>
                                }

                                {project.tags.map(tag => (
                                    <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0.5 bg-violet-500/10 text-violet-400 border-violet-500/20 capitalize">
                                        {tag}
                                    </Badge>
                                ))}

                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                {hasCleanable && (
                                    <Badge variant="secondary" className="text-[11px] px-2 py-0.5 bg-amber-500/10 text-amber-300 border-amber-500/20">
                                        {formatBytes(project.total_dep_size_bytes)} cleanable
                                    </Badge>
                                )}
                                </div>
                        </div>

                        {/* Last commit + Last modified */}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1.5 truncate">
                                <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 text-primary/40" />
                                <span className="truncate">{project.last_commit}</span>
                            </span>
                            {project.last_modified_timestamp > 0 && (
                                <span className="flex items-center gap-1 shrink-0 text-muted-foreground/60">
                                    Modified {formatRelativeTime(project.last_modified_timestamp)}
                                </span>
                            )}
                        </div>

                        {/* Quick Actions */}
                        <div className="flex items-center gap-1.5 pt-1.5 flex-wrap">
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-white hover:bg-white/10" onClick={(e) => { e.stopPropagation(); onOpenFinder(project.path); }}>
                                <FolderOpen className="h-3.5 w-3.5 mr-1" />Finder
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-white hover:bg-white/10" onClick={(e) => { e.stopPropagation(); onOpenTerminal(project.path); }}>
                                <Terminal className="h-3.5 w-3.5 mr-1" />Terminal
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-white hover:bg-white/10" onClick={(e) => { e.stopPropagation(); onOpenEditor(project.path); }}>
                                <Code2 className="h-3.5 w-3.5 mr-1" />Editor
                            </Button>
                            {project.activity_status === "abandoned" && onArchive && (
                                <Button
                                    variant="ghost" size="sm"
                                    className="h-7 px-2 text-xs text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/10 ml-auto"
                                    onClick={(e) => { e.stopPropagation(); onArchive(project.path, project.name); }}
                                >
                                    <Archive className="h-3.5 w-3.5 mr-1" />Archive
                                </Button>
                            )}
                        </div>

                        {/* Per-folder cleanup buttons (max 3) */}
                        {hasCleanable && (
                            <div className="flex flex-wrap gap-1.5 mt-auto pt-2">
                                {[...project.dependency_folders].filter(f => f.size_bytes > 0).sort((a, b) => b.size_bytes - a.size_bytes).slice(0, 3).map((f, fi) => (
                                    <Button
                                        key={fi} variant="outline" size="sm"
                                        className="h-7 text-xs px-2.5 border-amber-500/20 text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
                                        onClick={(e) => { e.stopPropagation(); onDeleteFolder(project.path, f.relative_path); }}
                                        disabled={deletingPaths.has(`${project.path}::${f.relative_path}`)}
                                    >
                                        <Trash2 className="h-3 w-3 mr-1" />
                                        {deletingPaths.has(`${project.path}::${f.relative_path}`)
                                            ? "Cleaning..."
                                            : `${f.relative_path} (${formatBytes(f.size_bytes)})`
                                        }
                                    </Button>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-64 bg-[#1a1a1e] border-white/10 text-white shadow-2xl">
                <ContextMenuItem onSelect={() => onOpenFinder(project.path)}>
                    <FolderOpen className="mr-2 h-4 w-4" />
                    Open in Finder
                    <ContextMenuShortcut>⌘O</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onOpenTerminal(project.path)}>
                    <Terminal className="mr-2 h-4 w-4" />
                    Open in Terminal
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onOpenEditor(project.path)}>
                    <Code2 className="mr-2 h-4 w-4" />
                    Open in Editor
                </ContextMenuItem>

                <ContextMenuSeparator className="bg-white/10" />

                <ContextMenuItem onSelect={(e) => onToggleFavorite(project, e as any)}>
                    <Pin className="mr-2 h-4 w-4" />
                    {project.is_favorite ? "Unpin Project" : "Pin Project"}
                </ContextMenuItem>

                <ContextMenuSeparator className="bg-white/10" />

                <ContextMenuLabel className="text-xs text-muted-foreground">Tags</ContextMenuLabel>
                {AVAILABLE_TAGS.map(tag => {
                    const hasTag = project.tags.includes(tag);
                    return (
                        <ContextMenuItem
                            key={tag}
                            onSelect={(e) => onToggleTag(project, tag, e as any)}
                            className="capitalize"
                        >
                            <div className="flex items-center justify-between w-full">
                                <span className="flex items-center">
                                    <TagIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                                    {tag}
                                </span>
                                {hasTag && <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />}
                            </div>
                        </ContextMenuItem>
                    );
                })}
            </ContextMenuContent>
        </ContextMenu>
    );
}

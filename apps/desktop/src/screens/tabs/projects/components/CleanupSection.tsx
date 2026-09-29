import { Trash2, HardDrive, Archive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LocalProject, DepFolder, CleanupPreviewItem, ArchiveIntelligence } from "../types";
import { formatBytes } from "../utils";

interface CleanupSectionProps {
    project: LocalProject;
    archiveIntelligence: ArchiveIntelligence;
    archiving: boolean;
    deletingPaths: Set<string>;
    onPreviewCleanup: (items: CleanupPreviewItem[], title: string) => void;
    onDeleteFolder: (basePath: string, folderName: string) => void;
    onArchive: () => void;
}

const FOLDER_CATEGORY: Record<string, { label: string; color: string; colorBg: string }> = {
    node_modules: { label: "node_modules", color: "text-amber-400", colorBg: "bg-amber-500" },
    ".venv": { label: ".venv", color: "text-blue-400", colorBg: "bg-blue-500" },
    venv: { label: "venv", color: "text-blue-400", colorBg: "bg-blue-500" },
    ".next": { label: ".next", color: "text-violet-400", colorBg: "bg-violet-500" },
    dist: { label: "dist", color: "text-emerald-400", colorBg: "bg-emerald-500" },
    build: { label: "build", color: "text-emerald-400", colorBg: "bg-emerald-500" },
    target: { label: "target", color: "text-red-400", colorBg: "bg-red-500" },
    ".cache": { label: ".cache", color: "text-zinc-400", colorBg: "bg-zinc-500" },
    coverage: { label: "coverage", color: "text-zinc-400", colorBg: "bg-zinc-500" },
    __pycache__: { label: "__pycache__", color: "text-zinc-400", colorBg: "bg-zinc-500" },
};

function toPreviewItems(project: LocalProject, folders: DepFolder[]): CleanupPreviewItem[] {
    return folders.map(f => ({
        key: `${project.path}::${f.relative_path}`,
        project_name: project.name,
        project_path: project.path,
        folder_name: f.name,
        folder_path: f.relative_path,
        size_bytes: f.size_bytes,
    }));
}

function ArchiveBar({ confidence, reasons, archiving, onArchive }: {
    confidence: number;
    reasons: string[];
    archiving: boolean;
    onArchive: () => void;
}) {
    const color = confidence >= 80 ? "bg-amber-500" : confidence >= 50 ? "bg-zinc-500" : "bg-zinc-700";
    const textColor = confidence >= 80 ? "text-amber-400" : "text-zinc-500";

    return (
        <div className="mt-4 pt-4 border-t border-white/5">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <Archive className="h-3.5 w-3.5 text-zinc-500" />
                    <span className="text-xs font-semibold text-zinc-400">Archive Confidence</span>
                </div>
                <span className={`text-sm font-bold tabular-nums ${textColor}`}>{confidence}%</span>
            </div>
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mb-3">
                <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${confidence}%` }} />
            </div>
            {reasons.length > 0 && (
                <ul className="space-y-1 mb-3">
                    {reasons.map((r, i) => (
                        <li key={i} className="text-xs text-zinc-500 flex items-center gap-1.5">
                            <span className="h-1 w-1 rounded-full bg-zinc-600 shrink-0" />
                            {r}
                        </li>
                    ))}
                </ul>
            )}
            {confidence >= 50 && (
                <Button
                    variant="outline" size="sm"
                    className="border-amber-500/20 text-amber-400 hover:bg-amber-500/10 w-full"
                    onClick={onArchive}
                    disabled={archiving}
                >
                    {archiving
                        ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Archiving...</>
                        : <><Archive className="h-3.5 w-3.5 mr-2" /> Archive Project</>
                    }
                </Button>
            )}
        </div>
    );
}

export function CleanupSection({
    project,
    archiveIntelligence,
    archiving,
    deletingPaths,
    onPreviewCleanup,
    onDeleteFolder,
    onArchive,
}: CleanupSectionProps) {
    const folders = [...project.dependency_folders]
        .filter(f => f.size_bytes > 0)
        .sort((a, b) => b.size_bytes - a.size_bytes);

    const total = folders.reduce((s, f) => s + f.size_bytes, 0);
    const hasCleanable = folders.length > 0;

    return (
        <div className="bg-zinc-900 border border-white/5 rounded-xl overflow-hidden" id="cleanup-section">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-primary" />
                    Cleanup Potential
                </h3>
                {hasCleanable && (
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-amber-400">{formatBytes(total)}</span>
                        <Button
                            variant="ghost" size="sm"
                            className="h-7 text-xs text-zinc-500 hover:text-white"
                            onClick={() => onPreviewCleanup(toPreviewItems(project, folders), `${project.name} cleanup`)}
                        >
                            <Trash2 className="h-3.5 w-3.5 mr-1" /> Preview All
                        </Button>
                    </div>
                )}
            </div>

            <div className="p-4">
                {!hasCleanable ? (
                    <p className="text-sm text-zinc-500 text-center py-4">
                        Project is clean — no reclaimable folders detected.
                    </p>
                ) : (
                    <div className="space-y-2">
                        {folders.map((f, i) => {
                            const cat = FOLDER_CATEGORY[f.name] ?? { label: f.name, color: "text-zinc-400", colorBg: "bg-zinc-500" };
                            const key = `${project.path}::${f.relative_path}`;
                            const isDeleting = deletingPaths.has(key);
                            const pct = total > 0 ? (f.size_bytes / total) * 100 : 0;
                            return (
                                <div key={i} className="flex items-center gap-3 group">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className={`text-xs font-medium font-mono ${cat.color}`}>{cat.label}</span>
                                            <span className="text-xs font-bold text-white">{formatBytes(f.size_bytes)}</span>
                                        </div>
                                        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${cat.colorBg}`}
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost" size="sm"
                                        className="h-7 w-7 p-0 text-zinc-700 hover:text-amber-400 hover:bg-amber-500/10 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                        disabled={isDeleting}
                                        onClick={() => onDeleteFolder(project.path, f.relative_path)}
                                        title={`Delete ${f.name}`}
                                    >
                                        {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                )}

                {archiveIntelligence.confidence >= 50 && (
                    <ArchiveBar
                        confidence={archiveIntelligence.confidence}
                        reasons={archiveIntelligence.reasons}
                        archiving={archiving}
                        onArchive={onArchive}
                    />
                )}
            </div>
        </div>
    );
}

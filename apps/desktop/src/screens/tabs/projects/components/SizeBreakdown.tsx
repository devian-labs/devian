import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Trash2, HardDrive } from "lucide-react";
import { LocalProject, DepFolder, CleanupPreviewItem } from "../types";
import { formatBytes } from "../utils";

interface SizeBreakdownProps {
    project: LocalProject;
    onPreviewCleanup: (items: CleanupPreviewItem[], title: string) => void;
}

interface CategoryRow {
    label: string;
    size: number;
    color: string;
    folders: DepFolder[];
    sub?: string;
}

export function SizeBreakdown({ project, onPreviewCleanup }: SizeBreakdownProps) {
    const depKeys = ["node_modules", "venv", ".venv", ".gradle"];
    const buildKeys = [".next", "dist", "build", "target"];
    const cacheKeys = [".cache", "__pycache__", "coverage"];

    const depFolders = project.dependency_folders.filter(f => depKeys.includes(f.name));
    const buildFolders = project.dependency_folders.filter(f => buildKeys.includes(f.name));
    const cacheFolders = project.dependency_folders.filter(f => cacheKeys.includes(f.name));
    const otherFolders = project.dependency_folders.filter(f => !depKeys.includes(f.name) && !buildKeys.includes(f.name) && !cacheKeys.includes(f.name));

    const depsTotal = depFolders.reduce((acc, f) => acc + f.size_bytes, 0);
    const buildTotal = buildFolders.reduce((acc, f) => acc + f.size_bytes, 0);
    const cacheTotal = cacheFolders.reduce((acc, f) => acc + f.size_bytes, 0);
    const otherTotal = otherFolders.reduce((acc, f) => acc + f.size_bytes, 0);

    const sourceTotal = Math.max(0, project.project_size_bytes - (depsTotal + buildTotal + cacheTotal + otherTotal));
    const total = project.project_size_bytes || 1;

    const rows: CategoryRow[] = [
        { label: "Source Code", size: sourceTotal, color: "bg-blue-500", folders: [] },
        { label: "Dependencies", size: depsTotal, color: "bg-amber-500", folders: depFolders, sub: "node_modules, etc" },
        { label: "Build Artifacts", size: buildTotal, color: "bg-violet-500", folders: buildFolders, sub: "dist, build, .next" },
        { label: "Cache & Tools", size: cacheTotal + otherTotal, color: "bg-emerald-500", folders: [...cacheFolders, ...otherFolders], sub: ".cache, coverage" },
    ].filter(r => r.size > 0 || r.label === "Source Code");

    const toCleanupItems = (folders: DepFolder[]): CleanupPreviewItem[] =>
        folders.map((folder) => ({
            key: `${project.path}::${folder.relative_path}`,
            project_name: project.name,
            project_path: project.path,
            folder_name: folder.name,
            folder_path: folder.relative_path,
            size_bytes: folder.size_bytes,
        }));

    return (
        <Card className="bg-surface-a10 border-white/5 overflow-hidden">
            <CardContent className="p-4">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-semibold text-zinc-500 flex items-center gap-2">
                        <HardDrive className="h-3 w-3" /> Size Breakdown
                    </h3>
                    <Button
                        variant="ghost" size="sm"
                        className="h-7 text-xs text-amber-300 hover:bg-amber-500/10 border border-amber-500/10"
                        disabled={project.dependency_folders.length === 0}
                        onClick={() => {
                            onPreviewCleanup(
                                toCleanupItems([...project.dependency_folders].sort((a, b) => b.size_bytes - a.size_bytes)),
                                `${project.name} cleanup preview`
                            );
                        }}
                    >
                        <Trash2 className="h-3 w-3 mr-1" /> Preview Cleanup
                    </Button>
                </div>

                <div className="space-y-4">
                    <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-white/5">
                        {rows.map((r, i) => (
                            <div
                                key={i}
                                className={r.color}
                                style={{ width: `${(r.size / total) * 100}%` }}
                            />
                        ))}
                    </div>

                    <div className="grid grid-cols-1 gap-1.5">
                        {rows.map((r, i) => (
                            <div key={i} className="flex items-center justify-between p-2 rounded-md hover:bg-white/2 transition-colors group">
                                <div className="flex items-center gap-3">
                                    <div className={`w-1 h-3 rounded-full ${r.color}`} />
                                    <div className="flex flex-col">
                                        <span className="text-xs font-semibold text-zinc-200">{r.label}</span>
                                        {r.sub && <span className="text-[10px] text-zinc-500">{r.sub}</span>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-6">
                                    {r.folders.length > 0 && (
                                        <Button
                                            variant="ghost" size="sm"
                                            className="h-7 px-2 text-[10px] text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                            onClick={() => {
                                                onPreviewCleanup(
                                                    toCleanupItems(r.folders),
                                                    `${project.name} ${r.label.toLowerCase()} cleanup`
                                                );
                                            }}
                                        >
                                            <Trash2 className="h-3 w-3 mr-1" /> Preview
                                        </Button>
                                    )}
                                    <div className="text-right min-w-[70px]">
                                        <div className="text-xs font-bold text-white">{formatBytes(r.size)}</div>
                                        <div className="text-[10px] text-zinc-500">{((r.size / total) * 100).toFixed(1)}%</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

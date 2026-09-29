import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sparkles, Trash2, CheckCircle2, Loader2, HardDrive, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { track } from "@/lib/telemetry";

interface CleanupCategory {
    id: string;
    name: string;
    description: string;
    sizeBytes: number;
    risk: "none" | "low" | "medium" | "high";
    confidence: 1 | 2 | 3;
}

interface DockerDf {
    Type: string;
    Size: string;
    Reclaimable: string;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function parseSizeToBytes(s: string): number {
    const cleaned = (s || "").replace(/\s*\(.*\)/, "").trim();
    if (cleaned.includes("GB")) return parseFloat(cleaned) * 1024 ** 3;
    if (cleaned.includes("MB")) return parseFloat(cleaned) * 1024 ** 2;
    if (cleaned.includes("KB")) return parseFloat(cleaned) * 1024;
    if (cleaned.includes("B")) return parseFloat(cleaned);
    return 0;
}

const RISK_CONFIG = {
    none: { label: "Safe", color: "border-emerald-500/20 text-emerald-400 bg-emerald-500/5" },
    low: { label: "Low Risk", color: "border-blue-500/20 text-blue-400 bg-blue-500/5" },
    medium: { label: "Medium Risk", color: "border-amber-500/20 text-amber-400 bg-amber-500/5" },
    high: { label: "High Risk", color: "border-red-500/20 text-red-400 bg-red-500/5" },
};

export function CleanupTab() {
    const { toast } = useToast();
    const [categories, setCategories] = useState<CleanupCategory[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [cleaning, setCleaning] = useState(false);
    const [done, setDone] = useState(false);
    const [scheduleEnabled, setScheduleEnabled] = useState(
        () => localStorage.getItem("devian_cleanup_schedule") === "weekly"
    );

    useEffect(() => { scan(); }, []);

    const scan = async () => {
        setLoading(true);
        const cats: CleanupCategory[] = [];

        // Dependency folders from project cache
        try {
            const cached = localStorage.getItem("devian_projects_cache");
            if (cached) {
                const projects = JSON.parse(cached);
                let totalDeps = 0;
                for (const p of projects) {
                    if (p.total_dep_size_bytes) totalDeps += p.total_dep_size_bytes;
                }
                if (totalDeps > 0) {
                    cats.push({
                        id: "dep_folders",
                        name: "Dependency Folders",
                        description: "node_modules, .venv, target, vendor directories across your projects. Reinstall anytime with your package manager.",
                        sizeBytes: totalDeps,
                        risk: "low",
                        confidence: 3,
                    });
                }
            }
        } catch {}

        // Docker categories
        try {
            const running = await invoke<boolean>("check_docker_status");
            if (running) {
                const df = await invoke<DockerDf[]>("fetch_docker_system_df");
                for (const item of df) {
                    if (item.Type === "Build Cache") {
                        const bytes = parseSizeToBytes(item.Size);
                        if (bytes > 0) {
                            cats.push({
                                id: "docker_build_cache",
                                name: "Docker Build Cache",
                                description: "Intermediate layers from Docker builds. Fully safe to remove — Docker rebuilds on next build.",
                                sizeBytes: bytes,
                                risk: "none",
                                confidence: 3,
                            });
                        }
                    }
                    if (item.Type === "Containers") {
                        const bytes = parseSizeToBytes(item.Reclaimable);
                        if (bytes > 0) {
                            cats.push({
                                id: "docker_stopped",
                                name: "Stopped Containers",
                                description: "Exited containers taking up disk space. Stopped containers can be removed safely if you no longer need their state.",
                                sizeBytes: bytes,
                                risk: "low",
                                confidence: 3,
                            });
                        }
                    }
                    if (item.Type === "Images") {
                        const bytes = parseSizeToBytes(item.Reclaimable);
                        if (bytes > 0) {
                            cats.push({
                                id: "docker_images",
                                name: "Unused Docker Images",
                                description: "Images not referenced by any container. Can be re-pulled from a registry when needed.",
                                sizeBytes: bytes,
                                risk: "low",
                                confidence: 2,
                            });
                        }
                    }
                    if (item.Type === "Volumes") {
                        const bytes = parseSizeToBytes(item.Reclaimable);
                        if (bytes > 0) {
                            cats.push({
                                id: "docker_volumes",
                                name: "Unused Docker Volumes",
                                description: "Volumes not mounted by any container. Review carefully — may contain database data.",
                                sizeBytes: bytes,
                                risk: "medium",
                                confidence: 2,
                            });
                        }
                    }
                }
            }
        } catch {}

        setCategories(cats);
        // Auto-select zero-risk items
        setSelected(new Set(cats.filter(c => c.risk === "none").map(c => c.id)));
        setLoading(false);
    };

    const toggle = (cat: CleanupCategory) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id);
            return next;
        });
    };

    const selectedBytes = useMemo(() =>
        categories.filter(c => selected.has(c.id)).reduce((s, c) => s + c.sizeBytes, 0),
        [categories, selected]
    );

    const totalReclaimable = useMemo(() =>
        categories.reduce((s, c) => s + c.sizeBytes, 0),
        [categories]
    );

    const handleClean = async () => {
        if (selected.size === 0) return;
        setCleaning(true);
        let freed = 0;
        const failed: string[] = [];

        for (const id of selected) {
            const cat = categories.find(c => c.id === id);
            if (!cat) continue;
            try {
                if (id === "docker_build_cache") {
                    await invoke("prune_all_docker_builds");
                } else if (id === "docker_stopped") {
                    await invoke("prune_docker_system");
                } else if (id === "docker_images" || id === "docker_volumes") {
                    await invoke("prune_docker_system");
                }
                await invoke("add_cleanup_entry", { resource: cat.name, sizeBytes: cat.sizeBytes }).catch(() => {});
                freed += cat.sizeBytes;
            } catch {
                failed.push(cat.name);
            }
        }

        setCleaning(false);
        setDone(true);
        localStorage.setItem("devian_last_auto_cleanup", Date.now().toString());
        track("cleanup_completed", { selected: [...selected], freed });

        if (failed.length > 0) {
            toast({ variant: "destructive", title: "Some items failed", description: failed.join(", ") });
            invoke("show_notification", { title: "Cleanup partially failed", body: `Some items could not be removed: ${failed.join(", ")}` }).catch(() => {});
        } else if (freed > 0) {
            toast({ title: "Cleanup complete", description: `Freed ${formatBytes(freed)}` });
            invoke("show_notification", { title: "Cleanup Complete", body: `Freed ${formatBytes(freed)} from your workspace.` }).catch(() => {});
        }

        setTimeout(() => { setDone(false); scan(); }, 2000);
    };

    if (loading) {
        return (
            <div className="flex flex-col h-full items-center justify-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm text-zinc-500">Scanning your environment...</p>
            </div>
        );
    }

    if (totalReclaimable === 0) {
        return (
            <div className="flex flex-col h-full items-center justify-center gap-4 text-center px-5">
                <div className="h-16 w-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                    <Sparkles className="h-8 w-8 text-emerald-400" />
                </div>
                <div>
                    <p className="text-lg font-semibold text-white">Your workspace is clean.</p>
                    <p className="text-sm text-zinc-500 mt-1">No reclaimable space detected. Check back after running builds.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-background animate-in fade-in duration-200">
            <div className="shrink-0 px-5 py-4 border-b border-white/5 flex items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-white">Cleanup</h2>
                    <p className="text-sm text-zinc-500 mt-0.5">
                        {formatBytes(totalReclaimable)} reclaimable · {categories.length} categories
                    </p>
                </div>
                <Button
                    onClick={handleClean}
                    disabled={selected.size === 0 || cleaning || done}
                    className={`gap-2 ${done ? "bg-emerald-600 hover:bg-emerald-600" : ""}`}
                >
                    {cleaning ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Cleaning...</>
                    ) : done ? (
                        <><CheckCircle2 className="h-4 w-4" /> Done</>
                    ) : (
                        <><Trash2 className="h-4 w-4" /> Clean {selected.size > 0 ? formatBytes(selectedBytes) : "Selected"}</>
                    )}
                </Button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {categories.map(cat => {
                    const isSelected = selected.has(cat.id);
                    return (
                        <div
                            key={cat.id}
                            onClick={() => toggle(cat)}
                            className={`flex items-center gap-4 px-4 py-4 rounded-lg border cursor-pointer transition-all ${
                                isSelected
                                    ? "bg-primary/5 border-primary/25"
                                    : "bg-zinc-900 border-white/5 hover:border-white/10"
                            }`}
                        >
                            <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggle(cat)}
                                className="shrink-0"
                                onClick={e => e.stopPropagation()}
                            />
                            <HardDrive className="h-4 w-4 text-zinc-500 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-semibold text-white">{cat.name}</span>
                                </div>
                                <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{cat.description}</p>
                            </div>
                            <div className="flex flex-col items-end gap-1.5 shrink-0 ml-2">
                                <span className="text-sm font-bold text-white">{formatBytes(cat.sizeBytes)}</span>
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline" className={`text-[10px] h-4 px-1.5 border font-medium ${RISK_CONFIG[cat.risk].color}`}>
                                        {RISK_CONFIG[cat.risk].label}
                                    </Badge>
                                    <div className="flex gap-0.5" title={`Confidence: ${cat.confidence}/3`}>
                                        {[1, 2, 3].map(dot => (
                                            <div
                                                key={dot}
                                                className={`h-1.5 w-1.5 rounded-full ${dot <= cat.confidence ? "bg-primary" : "bg-zinc-700"}`}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}

                <p className="text-xs text-zinc-700 text-center pt-2">
                    Confidence dots indicate certainty that cleanup is safe. High risk items are never auto-selected.
                </p>

                {/* Cleanup Scheduler */}
                <div className="border border-white/5 rounded-lg p-4 bg-zinc-900 flex items-center justify-between gap-4 mb-8">
                    <div className="flex items-start gap-3">
                        <CalendarClock className="h-4 w-4 text-zinc-500 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-white">Weekly Cleanup</p>
                            <p className="text-xs text-zinc-500 mt-0.5">
                                {scheduleEnabled
                                    ? "Devian will remind you to clean when overdue."
                                    : "Enable to get weekly cleanup reminders in your Workspace."}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => {
                            const next = !scheduleEnabled;
                            setScheduleEnabled(next);
                            localStorage.setItem("devian_cleanup_schedule", next ? "weekly" : "off");
                            if (next) localStorage.setItem("devian_last_auto_cleanup", Date.now().toString());
                        }}
                        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                            scheduleEnabled ? "bg-primary" : "bg-zinc-700"
                        }`}
                        role="switch"
                        aria-checked={scheduleEnabled}
                    >
                        <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                            scheduleEnabled ? "translate-x-4" : "translate-x-0"
                        }`} />
                    </button>
                </div>
            </div>
        </div>
    );
}

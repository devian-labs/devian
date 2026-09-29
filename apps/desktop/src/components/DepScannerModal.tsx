import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
    X, PackageSearch, ShieldAlert, TrendingUp, RefreshCw,
    ExternalLink, Loader2, CheckCircle2, AlertTriangle, ArrowRight,
    Zap, ChevronDown, ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OutdatedPackage {
    name: string;
    current: string;
    latest: string;
    ecosystem: string;
    update_type: "patch" | "minor" | "major" | "unknown";
    changelog_url: string;
}

export interface Vulnerability {
    name: string;
    severity: string;
    title: string;
    advisory_url: string;
    via: string[];
}

export interface UnusedDependency {
    name: string;
    dep_type: string;
}

export interface DepStatus {
    ecosystem: string;
    outdated: OutdatedPackage[];
    vulnerabilities: Vulnerability[];
    unused_dependencies: UnusedDependency[];
    error: string | null;
}

export interface UpdateResult {
    package: string;
    success: boolean;
    output: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const UPDATE_TYPE_META = {
    patch: { label: "Patch", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25", badge: "bg-emerald-400", tip: "Safe to update — bug fixes only" },
    minor: { label: "Minor", color: "text-amber-400 bg-amber-500/10 border-amber-500/25", badge: "bg-amber-400", tip: "New features, backward compatible — check changelog" },
    major: { label: "Major", color: "text-red-400 bg-red-500/10 border-red-500/25", badge: "bg-red-400", tip: "Breaking changes possible — read changelog carefully" },
    unknown: { label: "?", color: "text-muted-foreground bg-white/5 border-white/10", badge: "bg-muted-foreground", tip: "" },
};

const SEV_META = {
    critical: { color: "text-red-400 bg-red-500/10 border-red-500/25", dot: "bg-red-400" },
    high: { color: "text-orange-400 bg-orange-500/10 border-orange-500/25", dot: "bg-orange-400" },
    moderate: { color: "text-amber-400 bg-amber-500/10 border-amber-500/25", dot: "bg-amber-400" },
    low: { color: "text-blue-400 bg-blue-500/10 border-blue-500/25", dot: "bg-blue-400" },
};

const sevMeta = (s: string) => SEV_META[s as keyof typeof SEV_META] ?? SEV_META.low;

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
    projectPath: string;
    projectName: string;
    onClose: () => void;
}

export default function DepScannerModal({ projectPath, projectName, onClose }: Props) {
    const [status, setStatus] = useState<DepStatus | null>(null);
    const [scanning, setScanning] = useState(false);
    const [updatingPkg, setUpdatingPkg] = useState<Set<string>>(new Set());
    const [updatingAll, setUpdatingAll] = useState(false);
    const [removingUnused, setRemovingUnused] = useState(false);
    const [updateResults, setUpdateResults] = useState<Map<string, UpdateResult>>(new Map());
    const [expandedVuln, setExpandedVuln] = useState<Set<string>>(new Set());

    const scan = useCallback(async () => {
        setScanning(true);
        setUpdateResults(new Map());
        try {
            const result = await invoke<DepStatus>("check_dep_status", { path: projectPath });
            setStatus(result);
        } catch (e) {
            setStatus({ ecosystem: "unknown", outdated: [], vulnerabilities: [], unused_dependencies: [], error: String(e) });
        } finally {
            setScanning(false);
        }
    }, [projectPath]);

    const updatePackage = async (pkg: OutdatedPackage) => {
        setUpdatingPkg(prev => new Set(prev).add(pkg.name));
        try {
            const result = await invoke<UpdateResult>("update_npm_package", {
                path: projectPath,
                packageName: pkg.name,
                version: pkg.latest,
            });
            setUpdateResults(prev => new Map(prev).set(pkg.name, result));
            // Re-scan to get fresh status
            if (result.success) {
                const fresh = await invoke<DepStatus>("check_dep_status", { path: projectPath });
                setStatus(fresh);
            }
        } finally {
            setUpdatingPkg(prev => { const n = new Set(prev); n.delete(pkg.name); return n; });
        }
    };

    const updateAllPatches = async () => {
        setUpdatingAll(true);
        try {
            const results = await invoke<UpdateResult[]>("update_all_patch_packages", { path: projectPath });
            const map = new Map(results.map(r => [r.package, r]));
            setUpdateResults(map);
            const fresh = await invoke<DepStatus>("check_dep_status", { path: projectPath });
            setStatus(fresh);
        } finally {
            setUpdatingAll(false);
        }
    };

    const removeUnusedPackages = async () => {
        const packages = status?.unused_dependencies.map(dep => dep.name) ?? [];
        if (packages.length === 0) return;

        setRemovingUnused(true);
        try {
            const results = await invoke<UpdateResult[]>("remove_unused_npm_packages", {
                path: projectPath,
                packageNames: packages,
            });
            setUpdateResults(prev => {
                const next = new Map(prev);
                for (const result of results) next.set(result.package, result);
                return next;
            });
            const fresh = await invoke<DepStatus>("check_dep_status", { path: projectPath });
            setStatus(fresh);
        } finally {
            setRemovingUnused(false);
        }
    };

    const patchCount = status?.outdated.filter(p => p.update_type === "patch").length ?? 0;
    const unusedCount = status?.unused_dependencies.length ?? 0;

    return (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-[#111113] border border-white/8 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl animate-in zoom-in-[0.98] duration-150" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                            <PackageSearch className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-sm font-semibold text-white">Dependency Scanner</h2>
                            <p className="text-[11px] text-muted-foreground font-mono">{projectName}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {status && (
                            <Button variant="outline" size="sm"
                                className="h-8 text-xs border-white/10 text-muted-foreground hover:text-white"
                                onClick={scan} disabled={scanning}
                            >
                                <RefreshCw className={`h-3 w-3 mr-1.5 ${scanning ? "animate-spin" : ""}`} />
                                Rescan
                            </Button>
                        )}
                        <button onClick={onClose} className="text-muted-foreground hover:text-white transition-colors p-1">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">

                    {/* Initial state */}
                    {!status && !scanning && (
                        <div className="flex flex-col items-center justify-center py-16 gap-4">
                            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                                <PackageSearch className="h-8 w-8 text-primary" />
                            </div>
                            <div className="text-center">
                                <p className="text-white font-medium mb-1">Ready to scan {projectName}</p>
                                <p className="text-sm text-muted-foreground">Checks for outdated packages and security vulnerabilities using npm audit</p>
                            </div>
                            <Button onClick={scan} className="bg-primary text-white hover:bg-primary/90 mt-2">
                                <Zap className="h-4 w-4 mr-2" /> Run Dependency Scan
                            </Button>
                        </div>
                    )}

                    {/* Scanning */}
                    {scanning && (
                        <div className="flex flex-col items-center justify-center py-16 gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Running npm outdated & npm audit…</p>
                        </div>
                    )}

                    {/* Error */}
                    {status?.error && (
                        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
                            <p className="text-sm text-red-400 flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 shrink-0" />{status.error}
                            </p>
                        </div>
                    )}

                    {/* All good */}
                    {status && !status.error && status.outdated.length === 0 && status.vulnerabilities.length === 0 && unusedCount === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                            <div className="text-center">
                                <p className="text-white font-medium">All good!</p>
                                <p className="text-sm text-muted-foreground">No outdated, unused, or vulnerable packages found.</p>
                            </div>
                        </div>
                    )}

                    {status && !status.error && unusedCount > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <AlertTriangle className="h-4 w-4 text-amber-300" />
                                <h3 className="text-sm font-semibold text-white">Unused Dependencies</h3>
                                <Badge className="text-[10px] bg-amber-500/10 text-amber-300 border-amber-500/20">
                                    {unusedCount} packages
                                </Badge>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="ml-auto h-7 text-xs border-red-500/30 text-red-300 hover:bg-red-500/10"
                                    onClick={removeUnusedPackages}
                                    disabled={removingUnused || status.ecosystem !== "node"}
                                >
                                    {removingUnused
                                        ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Removing…</>
                                        : <>Remove unused deps</>
                                    }
                                </Button>
                            </div>

                            <div className="space-y-1.5">
                                {status.unused_dependencies.map((dep, i) => {
                                    const result = updateResults.get(dep.name);
                                    return (
                                        <div key={i} className="flex items-center gap-3 bg-surface-a10 border border-white/5 rounded-xl px-4 py-2.5">
                                            <code className="text-sm text-white font-medium flex-1 truncate">{dep.name}</code>
                                            <Badge className="text-[10px] bg-white/5 text-zinc-300 border-white/10">
                                                {dep.dep_type}
                                            </Badge>
                                            {result && (
                                                <span className={`text-[10px] ${result.success ? "text-emerald-400" : "text-red-400"}`}>
                                                    {result.success ? "✓ Removed" : "✗ Failed"}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Vulnerabilities */}
                    {status && !status.error && status.vulnerabilities.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <ShieldAlert className="h-4 w-4 text-red-400" />
                                <h3 className="text-sm font-semibold text-white">Vulnerabilities</h3>
                                <Badge className="ml-auto text-[10px] bg-red-500/15 text-red-400 border-red-500/25">
                                    {status.vulnerabilities.length} found
                                </Badge>
                            </div>
                            <div className="space-y-2">
                                {status.vulnerabilities.map((v, i) => {
                                    const meta = sevMeta(v.severity);
                                    const expanded = expandedVuln.has(v.name);
                                    return (
                                        <div key={i} className="bg-surface-a10 border border-white/5 rounded-xl overflow-hidden">
                                            <div className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                                                onClick={() => setExpandedVuln(prev => { const n = new Set(prev); expanded ? n.delete(v.name) : n.add(v.name); return n; })}
                                            >
                                                <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                                                <div className="flex-1 min-w-0">
                                                    <code className="text-sm text-white font-medium">{v.name}</code>
                                                    {v.title && <p className="text-xs text-muted-foreground truncate">{v.title}</p>}
                                                </div>
                                                <span className={`text-[10px] px-2 py-0.5 rounded border capitalize font-semibold shrink-0 ${meta.color}`}>{v.severity}</span>
                                                <button className="text-muted-foreground/40 hover:text-white ml-1">
                                                    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                </button>
                                            </div>
                                            {expanded && (
                                                <div className="px-4 pb-3 border-t border-white/5 pt-2.5 space-y-2">
                                                    {v.via.length > 0 && (
                                                        <p className="text-xs text-muted-foreground">Via: {v.via.join(" → ")}</p>
                                                    )}
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => openUrl(v.advisory_url)}
                                                            className="text-xs flex items-center gap-1 text-primary hover:text-primary/80 transition-colors"
                                                        >
                                                            <ExternalLink className="h-3 w-3" /> View Advisory
                                                        </button>
                                                        <button
                                                            onClick={() => openUrl(`https://www.google.com/search?q=${encodeURIComponent(`${v.name} npm vulnerability fix`)}`)}
                                                            className="text-xs flex items-center gap-1 text-muted-foreground hover:text-white transition-colors"
                                                        >
                                                            <ExternalLink className="h-3 w-3" /> Search Fix
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Outdated Packages */}
                    {status && !status.error && status.outdated.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <TrendingUp className="h-4 w-4 text-amber-400" />
                                <h3 className="text-sm font-semibold text-white">Outdated Packages</h3>
                                <Badge className="text-[10px] bg-amber-500/10 text-amber-300 border-amber-500/20">
                                    {status.outdated.length} packages
                                </Badge>
                                {patchCount > 0 && (
                                    <Button
                                        variant="outline" size="sm"
                                        className="ml-auto h-7 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                                        onClick={updateAllPatches}
                                        disabled={updatingAll || status.ecosystem !== "node"}
                                    >
                                        {updatingAll
                                            ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Updating…</>
                                            : <><Zap className="h-3 w-3 mr-1" />Update {patchCount} patch{patchCount > 1 ? "es" : ""}</>
                                        }
                                    </Button>
                                )}
                            </div>

                            <div className="space-y-1.5">
                                {status.outdated.map((pkg, i) => {
                                    const meta = UPDATE_TYPE_META[pkg.update_type] ?? UPDATE_TYPE_META.unknown;
                                    const isUpdating = updatingPkg.has(pkg.name);
                                    const result = updateResults.get(pkg.name);
                                    return (
                                        <div key={i} className="flex items-center gap-3 bg-surface-a10 border border-white/5 rounded-xl px-4 py-2.5 group">
                                            {/* Update type pill */}
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold shrink-0 w-14 text-center ${meta.color}`}>
                                                {meta.label}
                                            </span>

                                            {/* Package name */}
                                            <code className="text-sm text-white font-medium flex-1 truncate">{pkg.name}</code>

                                            {/* Version diff */}
                                            <span className="text-xs font-mono flex items-center gap-1.5 shrink-0 text-muted-foreground">
                                                <span className="text-muted-foreground/60">{pkg.current}</span>
                                                <ArrowRight className="h-3 w-3 text-muted-foreground/30" />
                                                <span className="text-white">{pkg.latest}</span>
                                            </span>

                                            {/* Actions */}
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                {result && (
                                                    <span className={`text-[10px] ${result.success ? "text-emerald-400" : "text-red-400"}`}>
                                                        {result.success ? "✓ Updated" : "✗ Failed"}
                                                    </span>
                                                )}
                                                {/* Patch → direct update button */}
                                                {pkg.update_type === "patch" && pkg.ecosystem === "node" && !result?.success && (
                                                    <Button variant="ghost" size="sm"
                                                        className="h-7 text-xs text-emerald-400 hover:bg-emerald-500/10 px-2"
                                                        onClick={() => updatePackage(pkg)}
                                                        disabled={isUpdating || updatingAll}
                                                        title={meta.tip}
                                                    >
                                                        {isUpdating
                                                            ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Updating</>
                                                            : <><Zap className="h-3 w-3 mr-1" />Update</>
                                                        }
                                                    </Button>
                                                )}
                                                {/* Minor/Major → changelog link */}
                                                {(pkg.update_type === "minor" || pkg.update_type === "major") && (
                                                    <button
                                                        onClick={() => openUrl(pkg.changelog_url)}
                                                        className="text-xs flex items-center gap-1 text-muted-foreground hover:text-white transition-colors px-2 py-1"
                                                        title="View changelog before updating"
                                                    >
                                                        <ExternalLink className="h-3 w-3" /> Changelog
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Legend */}
                            <div className="flex items-center gap-4 mt-3 px-1">
                                {(["patch", "minor", "major"] as const).map(t => (
                                    <span key={t} className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                                        <span className={`w-1.5 h-1.5 rounded-full ${UPDATE_TYPE_META[t].badge}`} />
                                        {UPDATE_TYPE_META[t].label} — {UPDATE_TYPE_META[t].tip.split("—")[0].trim()}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

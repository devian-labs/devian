import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
    ShieldAlert, RefreshCw, Loader2, CheckCircle2, ExternalLink,
    ChevronDown, ChevronRight, Package, Check, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LocalProject, RawDepStatus, RawVulnerability, RawOutdatedPkg } from "../types";
import { useToast } from "@/hooks/use-toast";

interface DependencyHealthProps {
    depStatus: RawDepStatus | null;
    loading: boolean;
    project: LocalProject;
    ignoredVulns: Set<string>;
    onIgnoreVuln: (name: string) => void;
    updatingPatches: boolean;
    onUpdatePatches: () => void;
    onRefresh: () => void;
}

// ── Ecosystem config ───────────────────────────────────────────────────────────

const ECO: Record<string, {
    label: string;
    badge: string;
    updateLabel: string;
    emptyMsg: string;
    noManifestMsg: string;
}> = {
    node:    { label: "npm",      badge: "bg-red-500/10 text-red-400 border-red-500/20",     updateLabel: "Update Patch Versions",          emptyMsg: "All npm packages up to date.",          noManifestMsg: "" },
    python:  { label: "pip",      badge: "bg-blue-500/10 text-blue-400 border-blue-500/20",  updateLabel: "Upgrade Patch Packages",          emptyMsg: "All pip packages up to date.",          noManifestMsg: "" },
    rust:    { label: "cargo",    badge: "bg-orange-500/10 text-orange-400 border-orange-500/20", updateLabel: "cargo update",             emptyMsg: "All Cargo dependencies up to date.",    noManifestMsg: "" },
    go:      { label: "go mod",   badge: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",  updateLabel: "go get -u=patch",                emptyMsg: "All Go modules up to date.",            noManifestMsg: "" },
    ruby:    { label: "bundler",  badge: "bg-red-400/10 text-red-300 border-red-400/20",     updateLabel: "bundle update --patch",          emptyMsg: "All gems up to date.",                  noManifestMsg: "" },
    maven:   { label: "maven",    badge: "bg-orange-400/10 text-orange-300 border-orange-400/20", updateLabel: "Update Maven Dependencies", emptyMsg: "All Maven dependencies up to date.",   noManifestMsg: "" },
    gradle:  { label: "gradle",   badge: "bg-green-500/10 text-green-400 border-green-500/20",   updateLabel: "Gradle Update",            emptyMsg: "All Gradle dependencies up to date.",   noManifestMsg: "" },
    php:     { label: "composer", badge: "bg-blue-400/10 text-blue-300 border-blue-400/20",  updateLabel: "composer update",                emptyMsg: "All Composer packages up to date.",     noManifestMsg: "" },
    unknown: { label: "unknown",  badge: "bg-zinc-800 text-zinc-400 border-zinc-700",        updateLabel: "Update Dependencies",            emptyMsg: "All dependencies appear up to date.",   noManifestMsg: "No supported manifest file found." },
};

function ecoConfig(eco: string) {
    return ECO[eco] ?? ECO.unknown;
}

// ── Scoring ────────────────────────────────────────────────────────────────────

const SEV_CONFIG: Record<string, { label: string; color: string }> = {
    critical: { label: "CRITICAL", color: "bg-red-500/10 text-red-400 border-red-500/20" },
    high:     { label: "HIGH",     color: "bg-red-500/10 text-red-400 border-red-500/20" },
    moderate: { label: "MODERATE", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
    low:      { label: "LOW",      color: "bg-zinc-800 text-zinc-400 border-zinc-700" },
};

function depScore(dep: RawDepStatus): number {
    let score = 100;
    for (const v of dep.vulnerabilities) {
        if (v.severity === "critical") score -= 20;
        else if (v.severity === "high") score -= 10;
        else if (v.severity === "moderate") score -= 5;
        else score -= 2;
    }
    const majors = dep.outdated.filter(o => o.update_type === "Major").length;
    const minors = dep.outdated.filter(o => o.update_type === "Minor").length;
    const patches = dep.outdated.filter(o => o.update_type === "Patch").length;
    score -= majors * 3 + minors * 2 + patches;
    return Math.max(0, Math.round(score));
}

function scoreColor(s: number) {
    if (s >= 80) return "text-emerald-400";
    if (s >= 60) return "text-amber-400";
    return "text-red-400";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DependencyHealth({
    depStatus, loading, project,
    ignoredVulns, onIgnoreVuln,
    updatingPatches, onUpdatePatches,
    onRefresh,
}: DependencyHealthProps) {
    const { toast } = useToast();
    const [vulnsOpen, setVulnsOpen] = useState(true);
    const [outdatedOpen, setOutdatedOpen] = useState(false);
    const [fixingVuln, setFixingVuln] = useState<string | null>(null);

    if (loading) {
        return (
            <div className="bg-zinc-900 border border-white/5 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                    <Package className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold text-white">Dependency Health</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-500 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Scanning dependencies...
                </div>
            </div>
        );
    }

    // No dep status loaded yet
    if (!depStatus) {
        return (
            <div className="bg-zinc-900 border border-white/5 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        <Package className="h-4 w-4 text-primary" />
                        Dependency Health
                    </h3>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-zinc-500 hover:text-white" onClick={onRefresh}>
                        <RefreshCw className="h-3.5 w-3.5 mr-1" /> Scan
                    </Button>
                </div>
                <p className="text-xs text-zinc-500">Run a scan to check for vulnerabilities and outdated packages.</p>
            </div>
        );
    }

    const eco = ecoConfig(depStatus.ecosystem);

    // Unknown ecosystem — no manifest
    if (depStatus.ecosystem === "unknown") {
        return (
            <div className="bg-zinc-900 border border-white/5 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-2">
                    <Package className="h-4 w-4 text-primary" />
                    Dependency Health
                </h3>
                <p className="text-xs text-zinc-500">{eco.noManifestMsg || depStatus.error || "No supported manifest file found."}</p>
            </div>
        );
    }

    // Ecosystem-specific error
    if (depStatus.error) {
        return (
            <div className="bg-zinc-900 border border-white/5 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        <Package className="h-4 w-4 text-primary" />
                        Dependency Health
                        <Badge variant="outline" className={`text-[10px] h-4 px-1.5 border ml-1 ${eco.badge}`}>{eco.label}</Badge>
                    </h3>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-zinc-500 hover:text-white" onClick={onRefresh}>
                        <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
                    </Button>
                </div>
                <p className="text-xs text-red-400">{depStatus.error}</p>
            </div>
        );
    }

    const score = depScore(depStatus);
    const visibleVulns = depStatus.vulnerabilities.filter(v => !ignoredVulns.has(v.name));
    const patches = depStatus.outdated.filter(o => o.update_type === "Patch");
    const minors  = depStatus.outdated.filter(o => o.update_type === "Minor");
    const majors  = depStatus.outdated.filter(o => o.update_type === "Major");
    const isClean = visibleVulns.length === 0 && depStatus.outdated.length === 0;

    const handleFixVuln = async (v: RawVulnerability) => {
        setFixingVuln(v.name);
        try {
            // Use ecosystem-aware fix; fall back to npm for node
            if (depStatus.ecosystem === "node") {
                await invoke("update_npm_package", { path: project.path, packageName: v.name, version: "latest" });
            } else {
                await invoke("update_package_to_latest", { path: project.path, packageName: v.name, ecosystem: depStatus.ecosystem });
            }
            toast({ title: "Package updated", description: `${v.name} updated to latest.` });
            onRefresh();
        } catch (e) {
            toast({ variant: "destructive", title: "Update failed", description: String(e) });
        } finally {
            setFixingVuln(null);
        }
    };

    return (
        <div className="bg-zinc-900 border border-white/5 rounded-xl overflow-hidden" id="dep-section">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Package className="h-4 w-4 text-primary" />
                    Dependency Health
                    <Badge variant="outline" className={`text-[10px] h-4 px-1.5 border ml-1 ${eco.badge}`}>
                        {eco.label}
                    </Badge>
                </h3>
                <div className="flex items-center gap-2">
                    {!isClean && (
                        <span className={`text-sm font-bold tabular-nums ${scoreColor(score)}`}>{score}</span>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-500 hover:text-white" onClick={onRefresh} title="Re-scan">
                        <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>

            {/* Tool hints */}
            {depStatus.tool_hints?.length > 0 && (
                <div className="px-4 py-2 border-b border-white/5 space-y-1.5">
                    {depStatus.tool_hints.map((hint, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-amber-400/80 bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2">
                            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <span>{hint.split(". Run: ")[0] || hint.split("Install: ")[0]}</span>
                                {(hint.includes(". Run: ") || hint.includes("Install: ")) && (
                                    <code className="block mt-1 font-mono text-amber-300 bg-black/20 px-2 py-0.5 rounded">
                                        {hint.split(". Run: ")[1] || hint.split("Install: ")[1] || hint.split("Run: ")[1]}
                                    </code>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {isClean ? (
                <div className="flex items-center gap-2 px-4 py-4 text-sm text-emerald-400">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    {eco.emptyMsg}
                </div>
            ) : (
                <div className="divide-y divide-white/4">

                    {/* Vulnerabilities */}
                    {visibleVulns.length > 0 && (
                        <div>
                            <button
                                onClick={() => setVulnsOpen(v => !v)}
                                className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-white/2 transition-colors"
                            >
                                {vulnsOpen ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />}
                                <ShieldAlert className="h-3.5 w-3.5 text-red-400" />
                                <span className="text-sm font-medium text-white">
                                    {visibleVulns.length} Vulnerabilit{visibleVulns.length > 1 ? "ies" : "y"}
                                </span>
                            </button>
                            {vulnsOpen && (
                                <div className="px-4 pb-3 space-y-2">
                                    {visibleVulns.map((v, i) => (
                                        <VulnerabilityRow
                                            key={i} vuln={v}
                                            isFixing={fixingVuln === v.name}
                                            onFix={() => handleFixVuln(v)}
                                            onIgnore={() => onIgnoreVuln(v.name)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Outdated packages */}
                    {depStatus.outdated.length > 0 && (
                        <div>
                            <button
                                onClick={() => setOutdatedOpen(v => !v)}
                                className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-white/2 transition-colors"
                            >
                                {outdatedOpen ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />}
                                <RefreshCw className="h-3.5 w-3.5 text-amber-400" />
                                <span className="text-sm font-medium text-white">
                                    {depStatus.outdated.length} Outdated
                                </span>
                                <div className="ml-auto flex items-center gap-2">
                                    {majors.length > 0 && <span className="text-xs text-red-400">{majors.length} major</span>}
                                    {minors.length > 0 && <span className="text-xs text-amber-400">{minors.length} minor</span>}
                                    {patches.length > 0 && <span className="text-xs text-zinc-400">{patches.length} patch</span>}
                                </div>
                            </button>

                            {outdatedOpen && (
                                <div className="px-4 pb-4 space-y-3">
                                    <UpdateCategoryRow
                                        label="Patch Updates"
                                        count={patches.length}
                                        packages={patches}
                                        color="text-zinc-300"
                                        description={`Safe to update. ${eco.updateLabel}.`}
                                        actionLabel={updatingPatches ? "Updating..." : eco.updateLabel}
                                        onAction={onUpdatePatches}
                                        actionLoading={updatingPatches}
                                    />
                                    {minors.length > 0 && (
                                        <UpdateCategoryRow
                                            label="Minor Updates"
                                            count={minors.length}
                                            packages={minors}
                                            color="text-amber-300"
                                            description="New features — review changelogs before updating."
                                            actionLabel="Review Minor Updates"
                                        />
                                    )}
                                    {majors.length > 0 && (
                                        <UpdateCategoryRow
                                            label="Major Updates"
                                            count={majors.length}
                                            packages={majors}
                                            color="text-red-300"
                                            description="Breaking changes possible — test thoroughly."
                                            actionLabel="Review Major Updates"
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function VulnerabilityRow({ vuln, isFixing, onFix, onIgnore }: {
    vuln: RawVulnerability;
    isFixing: boolean;
    onFix: () => void;
    onIgnore: () => void;
}) {
    const sev = SEV_CONFIG[vuln.severity?.toLowerCase()] ?? SEV_CONFIG.low;
    return (
        <div className="flex items-start gap-3 bg-black/20 border border-white/5 rounded-lg px-3 py-2.5">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">{vuln.name}</span>
                    <Badge variant="outline" className={`text-[10px] h-4 px-1.5 border font-bold ${sev.color}`}>
                        {sev.label}
                    </Badge>
                </div>
                {vuln.title && <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{vuln.title}</p>}
                {vuln.via?.length > 0 && <p className="text-[10px] text-zinc-600 mt-0.5">via: {vuln.via.join(", ")}</p>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
                {vuln.advisory_url && (
                    <a href={vuln.advisory_url} target="_blank" rel="noopener noreferrer"
                        className="text-zinc-600 hover:text-zinc-400 transition-colors" title="View advisory">
                        <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                )}
                <Button size="sm" variant="ghost"
                    className="h-6 px-2 text-[11px] text-zinc-500 hover:text-white hover:bg-white/5"
                    onClick={onIgnore}>Ignore</Button>
                <Button size="sm" variant="ghost"
                    className="h-6 px-2 text-[11px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                    onClick={onFix}
                    disabled={isFixing}>
                    {isFixing ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Check className="h-3 w-3 mr-0.5" />Fix</>}
                </Button>
            </div>
        </div>
    );
}

function UpdateCategoryRow({ label, count, packages, color, description, actionLabel, onAction, actionLoading }: {
    label: string; count: number; packages: RawOutdatedPkg[];
    color: string; description: string; actionLabel: string;
    /** Defaults to toggling the package list. */
    onAction?: () => void; actionLoading?: boolean;
}) {
    const [expanded, setExpanded] = useState(false);
    if (count === 0) return null;
    return (
        <div className="bg-black/20 border border-white/5 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold tabular-nums ${color}`}>{count}</span>
                    <span className="text-sm text-white">{label}</span>
                </div>
                <Button size="sm" variant="ghost"
                    className="h-6 text-[11px] text-zinc-400 hover:text-white hover:bg-white/5"
                    onClick={onAction ?? (() => setExpanded(v => !v))} disabled={actionLoading}>
                    {actionLoading && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                    {actionLabel}
                </Button>
            </div>
            <p className="text-xs text-zinc-600">{description}</p>
            {packages.length > 0 && (
                <button onClick={() => setExpanded(v => !v)}
                    className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors flex items-center gap-1">
                    {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {expanded ? "Hide" : "Show"} packages
                </button>
            )}
            {expanded && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                    {packages.map((p, i) => (
                        <span key={i} className="text-[10px] font-mono bg-white/5 border border-white/5 rounded px-1.5 py-0.5 text-zinc-400">
                            {p.name} {p.current} → {p.latest}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

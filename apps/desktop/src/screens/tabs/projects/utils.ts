export function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

const START_SCRIPT_PRIORITY: Record<string, number> = {
    dev: 100,
    start: 95,
    serve: 90,
    server: 85,
    web: 80,
    frontend: 78,
    api: 76,
    backend: 74,
    client: 72,
    app: 70,
};

export function scoreProjectScript(script: string): number {
    const normalized = script.trim().toLowerCase();
    if (!normalized) return 0;
    if (START_SCRIPT_PRIORITY[normalized]) return START_SCRIPT_PRIORITY[normalized];

    const parts = normalized.split(":");
    const last = parts[parts.length - 1];
    if (START_SCRIPT_PRIORITY[last]) {
        return START_SCRIPT_PRIORITY[last] - 5;
    }

    if (normalized.includes("dev")) return 60;
    if (normalized.includes("start")) return 58;
    if (normalized.includes("serve")) return 54;
    if (normalized.includes("server")) return 52;
    return 0;
}

export function isLikelyStartScript(script: string): boolean {
    return scoreProjectScript(script) >= 50;
}

export function sortProjectScripts(scripts: string[]): string[] {
    return [...scripts].sort((a, b) => {
        const diff = scoreProjectScript(b) - scoreProjectScript(a);
        if (diff !== 0) return diff;
        return a.localeCompare(b);
    });
}

export function getTopStartScripts(scripts: string[], limit = 3): string[] {
    return sortProjectScripts(scripts).filter(isLikelyStartScript).slice(0, limit);
}

export function formatRelativeTime(timestamp: number): string {
    if (!timestamp || timestamp <= 0) return "Unknown";
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
    if (diff < 2592000) return `${Math.floor(diff / 604800)} weeks ago`;
    if (diff < 31536000) return `${Math.floor(diff / 2592000)} months ago`;
    return `${Math.floor(diff / 31536000)} years ago`;
}

export function normalizeProjectData(p: any): any {
    const topLevelFiles = p.top_level_files || [];
    const inferredHasDockerfile = p.has_dockerfile || topLevelFiles.includes("Dockerfile");
    const inferredComposeFiles = p.docker_compose_files || topLevelFiles.filter((file: string) =>
        ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].includes(file)
    );
    const inferredHasDockerCompose = p.has_docker_compose || inferredComposeFiles.length > 0;

    return {
        ...p,
        dependency_folders: (p.dependency_folders || []).map((f: any) => ({
            ...f,
            relative_path: f.relative_path || f.name || "",
            last_accessed: f.last_accessed || 0,
        })),
        total_dep_size_bytes: p.total_dep_size_bytes || 0,
        project_size_bytes: p.project_size_bytes || 0,
        last_commit: p.last_commit || "No commits",
        last_commit_timestamp: p.last_commit_timestamp || 0,
        health_score: p.health_score ?? 100,
        is_stale: p.is_stale || false,
        missing_deps: p.missing_deps || false,
        has_env: p.has_env || false,
        scripts: p.scripts || [],
        stack: p.stack || [],
        current_branch: p.current_branch || "unknown",
        activity_status: p.activity_status || "unknown",
        days_since_commit: p.days_since_commit || 0,
        last_modified_timestamp: p.last_modified_timestamp || 0,
        tags: p.tags || [],
        is_favorite: p.is_favorite || false,
        runtime_name: p.runtime_name || "",
        runtime_version: p.runtime_version || "",
        runtime_source: p.runtime_source || "",
        frameworks: p.frameworks || [],
        gem_count: p.gem_count || 0,
        packages: p.packages || [],
        keywords: p.keywords || [],
        top_level_files: topLevelFiles,
        has_dockerfile: inferredHasDockerfile,
        has_docker_compose: inferredHasDockerCompose,
        docker_compose_files: inferredComposeFiles,
    };
}

export function filterAndSortProjects(
    projects: any[],
    searchQuery: string,
    techFilter: string,
    tagFilter: string,
    sortBy: string
): any[] {
    const filteredProjects = projects
        .filter(p => {
            const q = searchQuery.toLowerCase();
            const matchesSearch =
                p.name.toLowerCase().includes(q) ||
                p.stack.some((s: string) => s.toLowerCase().includes(q)) ||
                (p.packages && p.packages.some((pkg: string) => pkg.toLowerCase().includes(q))) ||
                (p.keywords && p.keywords.some((kw: string) => kw.toLowerCase().includes(q))) ||
                (p.top_level_files && p.top_level_files.some((f: string) => f.toLowerCase().includes(q)));

            const matchesTech = techFilter === "all" || p.stack.includes(techFilter);
            const matchesTag = tagFilter === "all" || p.tags.includes(tagFilter);

            return matchesSearch && matchesTech && matchesTag;
        })
        .sort((a, b) => {
            if (a.is_favorite !== b.is_favorite) {
                return a.is_favorite ? -1 : 1;
            }
            switch (sortBy) {
                case "size": return (b.project_size_bytes || 0) - (a.project_size_bytes || 0);
                case "recent": return (b.last_commit_timestamp || 0) - (a.last_commit_timestamp || 0);
                case "health": return (a.health_score || 0) - (b.health_score || 0);
                case "cleanable": return (b.total_dep_size_bytes || 0) - (a.total_dep_size_bytes || 0);
                case "technology": return (a.stack[0] || "").localeCompare(b.stack[0] || "");
                default: return a.name.localeCompare(b.name);
            }
        });

    return filteredProjects;
}

import type {
    LocalProject, RawDepStatus, HealthIssue, HealthStatus,
    ProjectHealthSummary, ArchiveIntelligence, PrimaryCTA,
    UsageTimelineEvent,
} from "./types";

export function computeArchiveIntelligence(p: LocalProject): ArchiveIntelligence {
    const reasons: string[] = [];
    let score = 0;
    const days = p.days_since_commit || 0;

    if (days > 730) { score += 40; reasons.push(`No commits in ${Math.floor(days / 365)} years`); }
    else if (days > 365) { score += 25; reasons.push("No commits in over a year"); }
    else if (days > 180) { score += 12; reasons.push("No commits in 6+ months"); }

    if (p.activity_status === "abandoned") { score += 20; reasons.push("Marked as abandoned"); }
    if (p.is_stale) { score += 10; reasons.push("Repository flagged as stale"); }
    if (!p.has_docker_compose && !(p.scripts?.length)) { score += 8; reasons.push("No launch configuration found"); }
    if (p.total_dep_size_bytes > 500 * 1024 ** 2) { score += 10; reasons.push("Large unused dependency cache"); }

    const confidence = Math.min(score, 99);
    return { confidence, recommended: confidence >= 70, reasons };
}

export function deriveHealthSummary(
    p: LocalProject,
    dep: RawDepStatus | null
): ProjectHealthSummary {
    const issues: HealthIssue[] = [];

    if (dep?.vulnerabilities?.length) {
        const hasCrit = dep.vulnerabilities.some(v => v.severity === "critical");
        issues.push({
            type: "vulnerability",
            severity: hasCrit ? "critical" : "high",
            count: dep.vulnerabilities.length,
            label: `${dep.vulnerabilities.length} Vulnerabilit${dep.vulnerabilities.length > 1 ? "ies" : "y"}`,
            sublabel: dep.vulnerabilities.slice(0, 3).map(v => v.name).join(", "),
            actionLabel: "Fix Vulnerabilities",
        });
    }

    if (dep) {
        const patches = dep.outdated.filter(o => o.update_type === "Patch").length;
        const minors = dep.outdated.filter(o => o.update_type === "Minor").length;
        const majors = dep.outdated.filter(o => o.update_type === "Major").length;
        const total = patches + minors + majors;
        if (total > 0) {
            issues.push({
                type: "outdated_deps",
                severity: majors > 0 ? "high" : minors > 0 ? "medium" : "low",
                count: total,
                label: `${total} Outdated Dependenc${total > 1 ? "ies" : "y"}`,
                sublabel: [majors && `${majors} major`, minors && `${minors} minor`, patches && `${patches} patch`].filter(Boolean).join(", "),
                actionLabel: "Review Updates",
            });
        }
    }

    if (p.total_dep_size_bytes > 200 * 1024 ** 2) {
        issues.push({
            type: "large_cleanup",
            severity: p.total_dep_size_bytes > 2 * 1024 ** 3 ? "high" : "low",
            count: 1,
            label: `${formatBytes(p.total_dep_size_bytes)} Reclaimable`,
            sublabel: `${p.dependency_folders.length} cleanable folder${p.dependency_folders.length > 1 ? "s" : ""}`,
            actionLabel: "Clean Project",
        });
    }

    const score = p.health_score ?? 100;
    let status: HealthStatus = "healthy";
    if (issues.some(i => i.severity === "critical")) status = "needs_attention";
    else if (score < 40 || p.activity_status === "abandoned") status = "archive_candidate";
    else if (score < 65 || p.is_stale) status = "inactive";
    else if (issues.length > 0) status = "needs_attention";

    return { score, status, issues };
}

export function derivePrimaryCTA(
    p: LocalProject,
    health: ProjectHealthSummary,
    archive: ArchiveIntelligence
): PrimaryCTA {
    const critVuln = health.issues.find(
        i => i.type === "vulnerability" && (i.severity === "critical" || i.severity === "high")
    );
    if (critVuln) return { kind: "fix_vulns", label: "Fix Vulnerabilities", color: "destructive" };

    if (archive.recommended && archive.confidence >= 80) {
        return { kind: "archive", label: "Archive Project", color: "warning" };
    }

    const bigCleanup = health.issues.find(i => i.type === "large_cleanup" && i.severity === "high");
    if (bigCleanup) return { kind: "clean", label: "Clean Project", color: "warning" };

    const topScript = getTopStartScripts(p.scripts || [])[0];
    return { kind: "run", label: topScript ? `Run  ${topScript}` : "Open Project", color: "primary" };
}

export function buildUsageTimeline(p: LocalProject): UsageTimelineEvent[] {
    const events: UsageTimelineEvent[] = [];

    if (p.last_commit_timestamp) {
        events.push({
            id: "commit",
            kind: "commit",
            label: "Last commit",
            detail: p.last_commit !== "No commits" ? p.last_commit : undefined,
            timestamp: p.last_commit_timestamp * 1000,
        });
    }
    if (p.last_modified_timestamp && p.last_modified_timestamp !== p.last_commit_timestamp) {
        events.push({
            id: "modified",
            kind: "opened",
            label: "Last file modified",
            timestamp: p.last_modified_timestamp * 1000,
        });
    }
    // Pull cleanup history from localStorage
    try {
        const history = JSON.parse(
            localStorage.getItem("devian_cleanup_history") || "[]"
        ) as Array<{ timestamp: number; resource: string }>;
        history
            .filter(h => h.resource?.toLowerCase().includes(p.name.toLowerCase()))
            .slice(0, 2)
            .forEach(c => {
                events.push({
                    id: `clean-${c.timestamp}`,
                    kind: "clean",
                    label: "Dependencies cleaned",
                    detail: c.resource,
                    timestamp: c.timestamp * 1000,
                });
            });
    } catch {}

    return events.sort((a, b) => b.timestamp - a.timestamp);
}

export function calculateStats(projects: any[]): {
    totalProjectSize: number;
    totalRecoverableBytes: number;
    allTechs: string[];
    staleCount: number;
    inactiveCount: number;
} {
    return {
        totalProjectSize: projects.reduce((sum, p) => sum + (p.project_size_bytes || 0), 0),
        totalRecoverableBytes: projects.reduce((sum, p) => sum + (p.total_dep_size_bytes || 0), 0),
        allTechs: Array.from(new Set(projects.flatMap(p => p.stack).filter(s => s !== "Unknown"))),
        staleCount: projects.filter(p => p.activity_status === "abandoned").length,
        inactiveCount: projects.filter(p => p.activity_status === "inactive").length,
    };
}

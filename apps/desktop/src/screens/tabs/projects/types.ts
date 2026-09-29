export interface DepFolder {
    name: string;
    relative_path: string;
    size_bytes: number;
    last_accessed: number;
}

export interface FrameworkVersion {
    name: string;
    version: string;
}

export interface LocalProject {
    name: string;
    path: string;
    stack: string[];
    status: string;
    dependency_folders: DepFolder[];
    total_dep_size_bytes: number;
    project_size_bytes: number;
    last_commit: string;
    last_commit_timestamp: number;
    health_score: number;
    is_stale: boolean;
    missing_deps: boolean;
    has_env: boolean;
    scripts: string[];
    current_branch: string;
    activity_status: string;
    days_since_commit: number;
    last_modified_timestamp: number;
    packages: string[];
    keywords: string[];
    top_level_files: string[];
    has_dockerfile: boolean;
    has_docker_compose: boolean;
    docker_compose_files: string[];
    tags: string[];
    is_favorite: boolean;
    runtime_name: string;
    runtime_version: string;
    runtime_source: string;
    frameworks: FrameworkVersion[];
    gem_count: number;
}

export interface Commit {
    hash: string;
    message: string;
    author: string;
    relative_time: string;
}

export interface CommitTimelinePoint {
    month: string;
    count: number;
}

export interface RepoInsightFile {
    path: string;
    size_bytes: number;
    line_count: number;
    change_count: number;
    hotspot_score: number;
}

export interface RepoInsights {
    total_lines_of_code: number;
    largest_files: RepoInsightFile[];
    most_modified_files: RepoInsightFile[];
    hotspots: RepoInsightFile[];
}

export interface GitBranchInfo {
    name: string;
    is_current: boolean;
}

export interface CleanupPreviewItem {
    key: string;
    project_name: string;
    project_path: string;
    folder_name: string;
    folder_path: string;
    size_bytes: number;
}

export interface RunningScript {
    key: string;
    project_path: string;
    script: string;
    pid: number;
    port: number | null;
}

export type SortOption = "name" | "size" | "recent" | "health" | "cleanable" | "technology";

export const AVAILABLE_TAGS = ["client", "personal", "startup", "experiment", "archive"];

// ── Health ─────────────────────────────────────────────────────────────────

export type HealthStatus = "healthy" | "needs_attention" | "inactive" | "archive_candidate";

export interface HealthIssue {
    type: "vulnerability" | "outdated_deps" | "stale" | "large_cleanup" | "missing_env";
    severity: "critical" | "high" | "medium" | "low";
    count: number;
    label: string;
    sublabel: string;
    actionLabel: string;
}

export interface ProjectHealthSummary {
    score: number;
    status: HealthStatus;
    issues: HealthIssue[];
}

// ── Raw dep status from Rust ───────────────────────────────────────────────

export interface RawVulnerability {
    name: string;
    severity: string;
    title: string;
    advisory_url: string;
    via: string[];
}

export interface RawOutdatedPkg {
    name: string;
    current: string;
    latest: string;
    ecosystem: string;
    update_type: "Patch" | "Minor" | "Major" | "Unknown";
    changelog_url: string | null;
}

export interface RawDepStatus {
    ecosystem: string;
    outdated: RawOutdatedPkg[];
    vulnerabilities: RawVulnerability[];
    unused_dependencies: { name: string; dep_type: string }[];
    error: string | null;
    tool_hints: string[];
}

// ── Archive Intelligence ───────────────────────────────────────────────────

export interface ArchiveIntelligence {
    confidence: number;
    recommended: boolean;
    reasons: string[];
}

// ── Primary CTA ────────────────────────────────────────────────────────────

export type PrimaryCTAKind = "run" | "fix_vulns" | "clean" | "archive";

export interface PrimaryCTA {
    kind: PrimaryCTAKind;
    label: string;
    color: "primary" | "destructive" | "warning";
}

// ── Project Runbook ────────────────────────────────────────────────────────

export interface ProjectRunbook {
    howToRun: string;
    requiredServices: string;
    environment: string;
    notes: string;
}

// ── Usage Timeline ─────────────────────────────────────────────────────────

export type TimelineEventKind = "commit" | "run" | "opened" | "deps_updated" | "archive_flag" | "clean";

export interface UsageTimelineEvent {
    id: string;
    label: string;
    detail?: string;
    timestamp: number;
    kind: TimelineEventKind;
}

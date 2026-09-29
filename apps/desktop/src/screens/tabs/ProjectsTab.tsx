import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import EnvManagerModal from "../../components/EnvManagerModal";
import { useProjectActions } from "./projects/hooks/useProjectActions";
import {
    CleanupPreviewItem, LocalProject, Commit, CommitTimelinePoint,
    GitBranchInfo, RepoInsights, RunningScript, SortOption, AVAILABLE_TAGS,
    RawDepStatus, ProjectRunbook as RunbookType,
} from "./projects/types";
import {
    formatBytes, normalizeProjectData, filterAndSortProjects, calculateStats,
    computeArchiveIntelligence, deriveHealthSummary, derivePrimaryCTA,
} from "./projects/utils";
import { ProjectDetailPageHeader } from "./projects/components/ProjectDetailView";
import { ActivityFilter } from "./projects/components/ProjectsListHeader";
import { CleanupPreviewModal } from "./projects/components/CleanupPreviewModal";
import { ProjectsListHeader } from "./projects/components/ProjectsListHeader";
import { StatsBar } from "./projects/components/StatsBar";
import { ProjectCard } from "./projects/components/ProjectCard";
import { PinnedProjects, RecentlyActiveProjects } from "./projects/components/PinnedProjects";
import { DeleteConfirmModal } from "./projects/components/DeleteConfirmModal";
import { AttentionCard } from "./projects/components/AttentionCard";
import { ProjectIntelligence } from "./projects/components/ProjectIntelligence";
import { DependencyHealth } from "./projects/components/DependencyHealth";
import { CleanupSection } from "./projects/components/CleanupSection";
import { ProjectRunbook } from "./projects/components/ProjectRunbook";
import { ActivityTab } from "./projects/components/ActivityTab";
import { track } from "@/lib/telemetry";

interface ProjectsTabProps {
    terminal: string;
    editor: string;
    paletteAction?: { path: string; openEnv: boolean } | null;
    onPaletteActionConsumed?: () => void;
}

type LinkedDockerContainer = {
    ID: string;
    Names: string;
    State: string;
    Status: string;
    Image: string;
    ComposeWorkingDir: string;
    ComposeConfigFiles: string;
    ProjectPath: string;
    ProjectName: string;
};

export function ProjectsTab({ terminal, editor, paletteAction, onPaletteActionConsumed }: ProjectsTabProps) {
    const { toast } = useToast();
    const projectActions = useProjectActions();

    // Core state
    const [projects, setProjects] = useState<LocalProject[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [hasScanned, setHasScanned] = useState(false);
    const [showScanInfo, setShowScanInfo] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [techFilter, setTechFilter] = useState("all");
    const [tagFilter, setTagFilter] = useState("all");
    const [sortBy, setSortBy] = useState<SortOption>("cleanable");
    const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");

    // Detail view state
    const [selectedProject, setSelectedProject] = useState<LocalProject | null>(null);
    const [projectCommits, setProjectCommits] = useState<Commit[]>([]);
    const [loadingCommits, setLoadingCommits] = useState(false);
    const [commitTimeline, setCommitTimeline] = useState<CommitTimelinePoint[]>([]);
    const [loadingTimeline, setLoadingTimeline] = useState(false);
    const [gitBranches, setGitBranches] = useState<GitBranchInfo[]>([]);
    const [loadingGitBranches, setLoadingGitBranches] = useState(false);
    const [gitAction, setGitAction] = useState<string | null>(null);
    const [repoInsights, setRepoInsights] = useState<RepoInsights | null>(null);
    const [repoInsightsLoading, setRepoInsightsLoading] = useState(false);
    const [repoInsightsError, setRepoInsightsError] = useState("");
    const [aiSummary, setAiSummary] = useState<string>("");
    const [aiLoading, setAiLoading] = useState(false);
    const [_projectNotes, setProjectNotes] = useState<string>("");
    const [savingNotes, setSavingNotes] = useState(false);
    const [archiving, setArchiving] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deletingProject, setDeletingProject] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState("");
    const [deletingPaths, setDeletingPaths] = useState<Set<string>>(new Set());
    const [cleaningAll, setCleaningAll] = useState(false);
    const [cleanupPreviewOpen, setCleanupPreviewOpen] = useState(false);
    const [cleanupPreviewTitle, setCleanupPreviewTitle] = useState("Cleanup preview");
    const [cleanupPreviewItems, setCleanupPreviewItems] = useState<CleanupPreviewItem[]>([]);
    const [linkedContainers, setLinkedContainers] = useState<LinkedDockerContainer[]>([]);
    const [loadingLinkedContainers, setLoadingLinkedContainers] = useState(false);
    const [projectDockerAction, setProjectDockerAction] = useState<"start" | "stop" | null>(null);
    const [projectLogsContainer, setProjectLogsContainer] = useState<LinkedDockerContainer | null>(null);
    const [projectLogsContent, setProjectLogsContent] = useState("");
    const [projectLogsLoading, setProjectLogsLoading] = useState(false);

    // Running scripts state
    const [runningScripts, setRunningScripts] = useState<Map<string, RunningScript>>(new Map());
    const [scriptConsole, setScriptConsole] = useState<Map<string, string[]>>(new Map());
    const [activeConsoleKey, setActiveConsoleKey] = useState<string | null>(null);

    // v2 detail view state
    const [detailTab, setDetailTab] = useState<"overview" | "activity">("overview");
    const [depHealth, setDepHealth] = useState<RawDepStatus | null>(null);
    const [depHealthLoading, setDepHealthLoading] = useState(false);
    const [ignoredVulns, setIgnoredVulns] = useState<Set<string>>(new Set());
    const [updatingPatches, setUpdatingPatches] = useState(false);
    const [runbook, setRunbook] = useState<RunbookType>({ howToRun: "", requiredServices: "", environment: "", notes: "" });
    const [envKeys, setEnvKeys] = useState<string[] | null>(null);
    const [configFiles, setConfigFiles] = useState<Array<{ name: string; kind: string; protected: boolean }>>([]);

    // Modals
    const [_showDepScanner, _setShowDepScanner] = useState(false);
    const [showEnvManager, setShowEnvManager] = useState<string | null>(null);
    // Pending env manager open from CommandPalette navigation
    const pendingEnvManagerRef = useRef<string | null>(null);

    // Load running scripts on mount
    useEffect(() => {
        invoke<RunningScript[]>("get_running_scripts").then(scripts => {
            setRunningScripts(new Map(scripts.map(s => [s.key, s])));
        }).catch(() => { });
    }, []);

    // Listen to background script events
    useEffect(() => {
        const unlisteners: Array<() => void> = [];
        const setup = async () => {
            unlisteners.push(await listen<RunningScript>("script:started", ({ payload }) => {
                setRunningScripts(prev => new Map(prev).set(payload.key, payload));
                setActiveConsoleKey(payload.key);
                setScriptConsole(prev => new Map(prev).set(payload.key, []));
            }));
            unlisteners.push(await listen<RunningScript>("script:port_detected", ({ payload }) => {
                setRunningScripts(prev => {
                    const next = new Map(prev);
                    const existing = next.get(payload.key);
                    if (!existing?.port) next.set(payload.key, payload);
                    return next;
                });
            }));
            unlisteners.push(await listen<{ key: string }>("script:stopped", ({ payload }) => {
                setRunningScripts(prev => { const next = new Map(prev); next.delete(payload.key); return next; });
            }));
            unlisteners.push(await listen<{ key: string, line: string, stream: string }>("script:output", ({ payload }) => {
                setScriptConsole(prev => {
                    const next = new Map(prev);
                    const lines = next.get(payload.key) || [];
                    next.set(payload.key, [...lines, payload.line].slice(-200));
                    return next;
                });
            }));
        };
        setup();
        return () => unlisteners.forEach(u => u());
    }, []);

    // Scan projects
    const scanProjects = useCallback(async () => {
        setIsScanning(true);
        try {
            const results = await invoke<LocalProject[]>("scan_local_projects");
            const normalized = results.map(normalizeProjectData);
            setProjects(normalized);
            setHasScanned(true);
            localStorage.setItem("devian_projects_cache", JSON.stringify(normalized));
            localStorage.setItem("devian_projects_cache_time", Date.now().toString());
            track("projects_scanned", { project_count: results.length });
            toast({ title: "Scan Complete", description: `Found ${results.length} repositories.` });
        } catch (error) {
            toast({ variant: "destructive", title: "Scan Failed", description: String(error) });
        } finally {
            setIsScanning(false);
        }
    }, [toast]);

    // Load cached projects on mount
    useEffect(() => {
        const cached = localStorage.getItem("devian_projects_cache");
        if (cached) {
            try {
                const parsed = JSON.parse(cached) as LocalProject[];
                const isStale = parsed.length > 0 && !Array.isArray(parsed[0].dependency_folders);
                if (isStale) {
                    localStorage.removeItem("devian_projects_cache");
                    scanProjects();
                } else {
                    const normalized = parsed.map(normalizeProjectData);
                    setProjects(normalized);
                    setHasScanned(true);
                }
            } catch { scanProjects(); }
        } else {
            scanProjects();
        }
    }, [scanProjects]);

    // Calculate stats
    const stats = calculateStats(projects);
    const isFiltering = searchQuery.trim() !== "" || techFilter !== "all" || tagFilter !== "all" || activityFilter !== "all";
    const filteredProjects = filterAndSortProjects(projects, searchQuery, techFilter, tagFilter, sortBy)
        .filter(p => {
            if (activityFilter === "stale") return p.activity_status === "abandoned" || p.is_stale;
            if (activityFilter === "cleanable") return p.total_dep_size_bytes > 0;
            return true;
        });

    // Project metadata management
    const handleUpdateProjectMetadata = async (projectPath: string, tags: string[], is_favorite: boolean) => {
        try {
            await invoke("update_project_metadata", { path: projectPath, tags, isFavorite: is_favorite });
            setProjects(prev => {
                const updated = prev.map(p => p.path === projectPath ? { ...p, tags, is_favorite } : p);
                localStorage.setItem("devian_projects_cache", JSON.stringify(updated));
                return updated;
            });
            if (selectedProject?.path === projectPath) {
                setSelectedProject(prev => prev ? { ...prev, tags, is_favorite } : null);
            }
        } catch (e) {
            toast({ variant: "destructive", title: "Failed to update project", description: String(e) });
        }
    };

    const toggleFavorite = (project: LocalProject, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        handleUpdateProjectMetadata(project.path, project.tags, !project.is_favorite);
    };

    const toggleTag = (project: LocalProject, tag: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        const newTags = project.tags.includes(tag)
            ? project.tags.filter(t => t !== tag)
            : [...project.tags, tag];
        handleUpdateProjectMetadata(project.path, newTags, project.is_favorite);
    };

    // Cleanup actions
    const handleDeleteFolder = async (basePath: string, folderName: string) => {
        const key = `${basePath}::${folderName}`;
        setDeletingPaths(prev => new Set(prev).add(key));
        try {
            await invoke("delete_dependency_folder", { basePath, folderName });
            toast({ title: "Cleaned", description: `Deleted ${folderName} from ${basePath.split("/").pop()}` });

            const p = projects.find(p => p.path === basePath);
            const matchedFolder = p?.dependency_folders.find(f => f.relative_path === folderName || f.name === folderName);
            const folderSize = matchedFolder?.size_bytes || 0;
            if (folderSize > 0) {
                await invoke("add_cleanup_entry", { resource: `Project Dep Cache: ${folderName}`, sizeBytes: folderSize }).catch(() => { });
            }

            setProjects(prev => prev.map(p => {
                if (p.path !== basePath) return p;
                const updatedFolders = p.dependency_folders.filter(f => f.relative_path !== folderName && f.name !== folderName);
                const removedSize = p.dependency_folders.find(f => f.relative_path === folderName || f.name === folderName)?.size_bytes || 0;
                track("dependency_folder_deleted", { size_bytes: removedSize });
                return {
                    ...p,
                    dependency_folders: updatedFolders,
                    total_dep_size_bytes: p.total_dep_size_bytes - removedSize,
                    project_size_bytes: p.project_size_bytes - removedSize,
                };
            }));
        } catch (e) {
            toast({ variant: "destructive", title: "Failed", description: String(e) });
        } finally {
            setDeletingPaths(prev => { const n = new Set(prev); n.delete(key); return n; });
        }
    };

    const handleCleanAll = async () => {
        const items = projects.flatMap((project) =>
            project.dependency_folders
                .filter((folder) => folder.size_bytes > 0)
                .map((folder) => ({
                    key: `${project.path}::${folder.relative_path}`,
                    project_name: project.name,
                    project_path: project.path,
                    folder_name: folder.name,
                    folder_path: folder.relative_path,
                    size_bytes: folder.size_bytes,
                }))
        ).sort((a, b) => b.size_bytes - a.size_bytes);

        setCleanupPreviewItems(items);
        setCleanupPreviewTitle("All repositories cleanup preview");
        setCleanupPreviewOpen(true);
    };

    const handleOpenCleanupPreview = (items: CleanupPreviewItem[], title: string) => {
        setCleanupPreviewItems(items.filter((item) => item.size_bytes > 0).sort((a, b) => b.size_bytes - a.size_bytes));
        setCleanupPreviewTitle(title);
        setCleanupPreviewOpen(true);
    };

    const handleConfirmCleanup = async (items: CleanupPreviewItem[]) => {

                setCleaningAll(true);

        let cleanedFolders = 0;
        let totalBytesCleaned = 0;

        for (const item of items) {
            try {
                await invoke("delete_dependency_folder", { basePath: item.project_path, folderName: item.folder_path });
                cleanedFolders++;
                totalBytesCleaned += item.size_bytes;
            } catch {
                // Skip failures so the rest of the selection can continue.
            }
        }

        if (totalBytesCleaned > 0) {
            await invoke("add_cleanup_entry", {
                resource: `Bulk Pruned ${cleanedFolders} Dependencies`,
                sizeBytes: totalBytesCleaned
            }).catch(() => { });
        }

        track("dependencies_clean_all", { bytes_cleaned: totalBytesCleaned, folders_cleaned: cleanedFolders });
        toast({
            title: "Cleanup Complete",
            description: cleanedFolders > 0
                ? `Cleaned ${cleanedFolders} folders and reclaimed ${formatBytes(totalBytesCleaned)}.`
                : "No folders were cleaned.",
        });

        setCleanupPreviewOpen(false);
        setCleaningAll(false);
        scanProjects();
    };

    // Script execution
    const handleRunScript = async (path: string, script: string) => {
        const key = `${path}::${script}`;
        if (runningScripts.has(key)) {
            try {
                await invoke("stop_running_script", { path, script });
                track('script_stopped');
                toast({ title: "Script Stopped", description: `npm run ${script} stopped.` });
            } catch (e) {
                toast({ variant: "destructive", title: "Stop Failed", description: String(e) });
            }
            return;
        }
        try {
            await invoke("run_script_background", { path, script });
            track('script_started');
            toast({ title: "Script Started", description: `Running npm run ${script} in background.` });
        } catch (e) {
            toast({ variant: "destructive", title: "Failed", description: String(e) });
        }
    };

    // Archive project
    const handleArchive = async (path: string, name: string) => {
        if (!confirm(`Archive "${name}"? This will create a .tar.gz and DELETE the original folder.`)) return;
        setArchiving(true);
        try {
            await invoke("archive_project", { path });
            track("project_archived");
            toast({ title: "Archived", description: `${name} has been archived.` });
            setSelectedProject(null);
            scanProjects();
        } catch (e) {
            toast({ variant: "destructive", title: "Archive Failed", description: String(e) });
        } finally {
            setArchiving(false);
        }
    };

    // Delete project
    const handleDeleteProject = async (project: LocalProject) => {
        setDeletingProject(true);
        try {
            const bytesDeleted = await invoke<number>("delete_project", { path: project.path });
            await invoke("add_cleanup_entry", {
                resource: `Deleted Project: ${project.name}`,
                sizeBytes: bytesDeleted
            }).catch(() => { });
            track("project_deleted", { bytes: bytesDeleted });
            toast({ title: "Project Deleted", description: `${project.name} removed (${formatBytes(bytesDeleted)} reclaimed)` });
            setShowDeleteConfirm(false);
            setDeleteConfirmText("");
            setSelectedProject(null);
            setProjects(prev => prev.filter(p => p.path !== project.path));
        } catch (e) {
            toast({ variant: "destructive", title: "Delete Failed", description: String(e) });
        } finally {
            setDeletingProject(false);
        }
    };

    // AI summary
    const handleAiSummary = async (project: LocalProject) => {
        setAiLoading(true);
        setAiSummary("");
        try {
            const summary = await projectActions.handleAiSummary(project, formatBytes);
            setAiSummary(summary);
            await invoke("save_ai_project_summary", { path: project.path, summary }).catch(() => { });
        } catch (e) {
            setAiSummary(`⚠️ ${String(e)}`);
        } finally {
            setAiLoading(false);
        }
    };

    const refreshGitBranches = async (projectPath: string) => {
        setLoadingGitBranches(true);
        try {
            const branches = await invoke<GitBranchInfo[]>("fetch_git_branches", { path: projectPath });
            setGitBranches(branches);
        } catch {
            setGitBranches([]);
        } finally {
            setLoadingGitBranches(false);
        }
    };

    const refreshSelectedProjectBranch = async (projectPath: string) => {
        try {
            const branch = await invoke<string>("fetch_git_branch", { path: projectPath });
            setSelectedProject(prev => prev && prev.path === projectPath ? { ...prev, current_branch: branch } : prev);
            setProjects(prev => prev.map(project => project.path === projectPath ? { ...project, current_branch: branch } : project));
        } catch {
            // Ignore branch refresh failures so actions can still report their own result.
        }
    };

    const refreshCommitTimeline = async (projectPath: string) => {
        setLoadingTimeline(true);
        try {
            const timeline = await invoke<CommitTimelinePoint[]>("fetch_commit_timeline", { path: projectPath });
            setCommitTimeline(timeline);
        } catch {
            setCommitTimeline([]);
        } finally {
            setLoadingTimeline(false);
        }
    };

    const runGitAction = async (action: string, command: string, path: string, extra: Record<string, string> = {}) => {
        setGitAction(action);
        try {
            const result = await invoke<string>(command, { path, ...extra });
            toast({
                title: "Git Action Complete",
                description: result || `${action} completed successfully.`,
            });
            await refreshGitBranches(path);
            await refreshSelectedProjectBranch(path);
            if (action === "pull" || action === "switch-branch" || action === "create-branch") {
                try {
                    const commits = await invoke<Commit[]>("fetch_project_commits", { path });
                    setProjectCommits(commits);
                } catch {
                    setProjectCommits([]);
                }
                await refreshCommitTimeline(path);
            }
        } catch (e) {
            toast({
                variant: "destructive",
                title: "Git Action Failed",
                description: String(e),
            });
        } finally {
            setGitAction(null);
        }
    };

    const handleAnalyzeRepository = async (project: LocalProject) => {
        setRepoInsightsLoading(true);
        setRepoInsightsError("");
        try {
            const insights = await invoke<RepoInsights>("analyze_repository_insights", { path: project.path });
            setRepoInsights(insights);
            track("repository_insights_analyzed", {
                total_lines_of_code: insights.total_lines_of_code,
            });
        } catch (e) {
            setRepoInsightsError(String(e));
        } finally {
            setRepoInsightsLoading(false);
        }
    };

    const getProjectLinkedContainers = useCallback(async (project: LocalProject) => {
        setLoadingLinkedContainers(true);
        try {
            const containers = await invoke<LinkedDockerContainer[]>("fetch_docker_containers");
            const linked = containers.filter((container) =>
                container.ProjectPath === project.path ||
                container.ComposeWorkingDir === project.path ||
                (container.ComposeConfigFiles || "")
                    .split(",")
                    .map((file) => file.trim())
                    .some((file) => file.startsWith(project.path))
            );
            setLinkedContainers(linked);
        } catch {
            setLinkedContainers([]);
        } finally {
            setLoadingLinkedContainers(false);
        }
    }, []);

    const openProjectContainerLogs = async (container: LinkedDockerContainer) => {
        setProjectLogsContainer(container);
        setProjectLogsLoading(true);
        try {
            const content = await invoke<string>("fetch_docker_container_logs", { id: container.ID, tail: 800 });
            setProjectLogsContent(content);
        } catch (e) {
            setProjectLogsContent(String(e));
        } finally {
            setProjectLogsLoading(false);
        }
    };

    const runProjectDockerAction = async (project: LocalProject, action: "start" | "stop") => {
        setProjectDockerAction(action);
        try {
            await invoke(action === "start" ? "start_project_docker_stack" : "stop_project_docker_stack", {
                path: project.path,
                name: project.name,
            });
            toast({
                title: action === "start" ? "Docker stack started" : "Docker stack stopped",
                description: `${project.name} ${action === "start" ? "is starting" : "has been stopped"}.`,
            });
            await getProjectLinkedContainers(project);
        } catch (e) {
            toast({
                variant: "destructive",
                title: "Docker stack action failed",
                description: String(e),
            });
        } finally {
            setProjectDockerAction(null);
        }
    };

    // Load dep health (used by DependencyHealth component and health summary)
    const loadDepHealth = useCallback(async (path: string, _force = false) => {
        setDepHealthLoading(true);
        setDepHealth(null);
        try {
            const status = await invoke<RawDepStatus>("check_dep_status", { path });
            setDepHealth(status);
            // Also cache for vulnerability badges on project cards
            try {
                const key = `devian_dep_status_${btoa(path).replace(/=/g, "")}`;
                localStorage.setItem(key, JSON.stringify(status));
            } catch {}
        } catch (e) {
            setDepHealth({ ecosystem: "unknown", outdated: [], vulnerabilities: [], unused_dependencies: [], error: String(e), tool_hints: [] });
        } finally {
            setDepHealthLoading(false);
        }
    }, []);

    // Open project detail
    const openProjectDetail = useCallback(async (project: LocalProject) => {
        setSelectedProject(project);
        setDetailTab("overview");
        setLoadingCommits(true);
        setLoadingTimeline(true);
        setLoadingGitBranches(true);
        setRepoInsights(null);
        setRepoInsightsError("");
        setRepoInsightsLoading(false);
        setGitBranches([]);
        setCommitTimeline([]);
        setGitAction(null);
        setAiSummary("");
        setLinkedContainers([]);
        setProjectLogsContainer(null);
        setProjectLogsContent("");
        setDepHealth(null);
        setIgnoredVulns(new Set());
        setEnvKeys(null);
        setConfigFiles([]);
        track("project_detail_viewed", { has_env: project.has_env });

        invoke<string>("load_ai_project_summary", { path: project.path })
            .then(cached => setAiSummary(cached))
            .catch(() => { });

        // Load full project config (notes + runbook)
        invoke<{ notes?: string; how_to_run?: string; required_services?: string; environment?: string }>(
            "read_project_config", { path: project.path }
        ).then(cfg => {
            setProjectNotes(cfg.notes || "");
            setRunbook({
                howToRun: cfg.how_to_run || "",
                requiredServices: cfg.required_services || "",
                environment: cfg.environment || "",
                notes: cfg.notes || "",
            });
        }).catch(() => {
            setProjectNotes("");
            setRunbook({ howToRun: "", requiredServices: "", environment: "", notes: "" });
        });

        // Load dep health (drives AttentionCard + DependencyHealth)
        loadDepHealth(project.path);

        // Load config file list (env + Rails sensitive files)
        invoke<Array<{ name: string; kind: string; protected: boolean }>>(
            "list_env_config_files", { path: project.path }
        ).then(files => {
            setConfigFiles(files);
            // Also load .env keys for display + global search cache
            if (project.has_env) {
                invoke<{ key: string; value: string }[]>("read_env_file", { path: project.path })
                    .then(vars => {
                        const keys = vars.map(v => v.key).filter(Boolean);
                        setEnvKeys(keys);
                        try {
                            const cacheKey = `devian_env_cache_${btoa(project.path).replace(/=/g, "")}`;
                            localStorage.setItem(cacheKey, JSON.stringify({
                                projectName: project.name,
                                projectPath: project.path,
                                keys,
                            }));
                        } catch {}
                    })
                    .catch(() => setEnvKeys([]));
            } else {
                setEnvKeys([]);
            }
        }).catch(() => {
            setConfigFiles([]);
            setEnvKeys([]);
        });

        try {
            const commits = await invoke<Commit[]>("fetch_project_commits", { path: project.path });
            setProjectCommits(commits);
        } catch { setProjectCommits([]); }
        finally { setLoadingCommits(false); }

        refreshGitBranches(project.path);
        refreshCommitTimeline(project.path);
        if (project.has_docker_compose || project.has_dockerfile || project.stack.includes("Docker")) {
            getProjectLinkedContainers(project);
        }
    }, [getProjectLinkedContainers]);

    const handleSaveRunbook = async (rb: RunbookType) => {
        if (!selectedProject) return;
        setSavingNotes(true);
        try {
            await invoke("write_project_config", {
                path: selectedProject.path,
                config: {
                    notes: rb.notes,
                    how_to_run: rb.howToRun,
                    required_services: rb.requiredServices,
                    environment: rb.environment,
                },
            });
        } catch (e) {
            toast({ variant: "destructive", title: "Failed to save runbook", description: String(e) });
        } finally {
            setSavingNotes(false);
        }
    };

    const handleUpdatePatches = async () => {
        if (!selectedProject) return;
        setUpdatingPatches(true);
        try {
            const results = await invoke<{ success: boolean; package: string; output: string }[]>(
                "update_all_patch_packages", { path: selectedProject.path }
            );
            const succeeded = results.filter(r => r.success).length;
            toast({ title: "Patch update complete", description: `Updated ${succeeded} packages.` });
            loadDepHealth(selectedProject.path, true);
            track("patch_update_completed", { succeeded, total: results.length });
        } catch (e) {
            toast({ variant: "destructive", title: "Patch update failed", description: String(e) });
        } finally {
            setUpdatingPatches(false);
        }
    };

    const handlePrimaryCTAAction = () => {
        if (!selectedProject) return;
        switch (primaryCTA.kind) {
            case "run": {
                const topScript = selectedProject.scripts?.[0];
                if (topScript) handleRunScript(selectedProject.path, topScript);
                else projectActions.handleOpenEditor(selectedProject.path, editor);
                break;
            }
            case "fix_vulns":
                setDetailTab("overview");
                break;
            case "clean":
                handleCleanAll();
                break;
            case "archive":
                handleArchive(selectedProject.path, selectedProject.name);
                break;
        }
    };

    // Handle CommandPalette navigation: open project detail (+ optional env manager)
    // Uses a prop instead of localStorage so it fires even when tab is already mounted
    useEffect(() => {
        if (!paletteAction || projects.length === 0) return;
        const matched = projects.find(p => p.path === paletteAction.path);
        if (!matched) return;
        onPaletteActionConsumed?.();
        if (paletteAction.openEnv) pendingEnvManagerRef.current = paletteAction.path;
        openProjectDetail(matched);
    }, [paletteAction, projects, openProjectDetail, onPaletteActionConsumed]);

    // Once the project detail renders, open the env manager if flagged
    useEffect(() => {
        if (selectedProject && pendingEnvManagerRef.current === selectedProject.path) {
            pendingEnvManagerRef.current = null;
            setShowEnvManager(selectedProject.path);
        }
    }, [selectedProject]);

    const homeDir = import.meta.env.VITE_HOME_DIR || "";

    // Computed health intelligence for selected project
    const archiveIntelligence = useMemo(
        () => selectedProject ? computeArchiveIntelligence(selectedProject) : { confidence: 0, recommended: false, reasons: [] },
        [selectedProject]
    );
    const healthSummary = useMemo(
        () => selectedProject ? deriveHealthSummary(selectedProject, depHealth) : { score: 100, status: "healthy" as const, issues: [] },
        [selectedProject, depHealth]
    );
    const primaryCTA = useMemo(
        () => selectedProject ? derivePrimaryCTA(selectedProject, healthSummary, archiveIntelligence) : { kind: "run" as const, label: "Open Project", color: "primary" as const },
        [selectedProject, healthSummary, archiveIntelligence]
    );

    // ===== DETAIL VIEW =====
    if (selectedProject) {
        const p = selectedProject;
        return (
            <div className="h-full flex flex-col bg-background">
                {/* Sticky enhanced header with tab bar */}
                <ProjectDetailPageHeader
                    project={p}
                    homeDir={homeDir}
                    health={healthSummary}
                    primaryCTA={primaryCTA}
                    archiveConf={archiveIntelligence}
                    activeTab={detailTab}
                    archiving={archiving}
                    onBack={() => { setSelectedProject(null); setDetailTab("overview"); }}
                    onTabChange={setDetailTab}
                    onPrimaryAction={handlePrimaryCTAAction}
                    onOpenFinder={() => projectActions.handleOpenFinder(p.path)}
                    onOpenTerminal={() => projectActions.handleOpenTerminal(p.path, terminal)}
                    onOpenEditor={() => projectActions.handleOpenEditor(p.path, editor)}
                    onArchive={() => handleArchive(p.path, p.name)}
                    onDelete={() => setShowDeleteConfirm(true)}
                />

                {/* Overview Tab */}
                {detailTab === "overview" && (
                    <div className="flex-1 overflow-y-auto p-5 space-y-4">
                        <AttentionCard
                            issues={healthSummary.issues}
                            depLoading={depHealthLoading}
                            onFixVulnerabilities={handleUpdatePatches}
                            onUpdatePatches={handleUpdatePatches}
                            onCleanup={handleCleanAll}
                            onArchive={() => handleArchive(p.path, p.name)}
                            onManageEnv={p.has_env ? () => setShowEnvManager(p.path) : undefined}
                        />
                        <ProjectIntelligence
                            project={p}
                            aiSummary={aiSummary}
                            aiLoading={aiLoading}
                            onGenerateSummary={handleAiSummary}
                            repoInsights={repoInsights}
                            repoInsightsLoading={repoInsightsLoading}
                            repoInsightsError={repoInsightsError}
                            onAnalyzeRepo={() => handleAnalyzeRepository(p)}
                        />
                        <DependencyHealth
                            depStatus={depHealth}
                            loading={depHealthLoading}
                            project={p}
                            ignoredVulns={ignoredVulns}
                            onIgnoreVuln={(name) => setIgnoredVulns(prev => new Set(prev).add(name))}
                            updatingPatches={updatingPatches}
                            onUpdatePatches={handleUpdatePatches}
                            onRefresh={() => loadDepHealth(p.path, true)}
                        />
                        {/* Environment & Config */}
                        <div className="bg-zinc-900 border border-white/5 rounded-xl overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                                    <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                                    Environment & Config
                                </h3>
                                {p.has_env && (
                                    <button
                                        onClick={() => setShowEnvManager(p.path)}
                                        className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                                    >
                                        Manage .env
                                    </button>
                                )}
                            </div>
                            <div className="p-4 space-y-3">
                                {/* Detected config files */}
                                {configFiles.length > 0 && (
                                    <div className="space-y-1.5">
                                        {configFiles.map((f, i) => (
                                            <div key={i} className="flex items-center justify-between gap-2">
                                                <span className="text-xs font-mono text-zinc-400">{f.name}</span>
                                                {f.protected && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/20 text-emerald-500/70 bg-emerald-500/5 shrink-0">
                                                        protected
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* .env variable keys */}
                                {envKeys === null ? (
                                    <div className="flex items-center gap-2 text-xs text-zinc-600">
                                        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/><path fill="currentColor" d="M4 12a8 8 0 018-8v8z" className="opacity-75"/></svg>
                                        Loading...
                                    </div>
                                ) : envKeys.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                        {envKeys.slice(0, 20).map((k, i) => (
                                            <span key={i} className="text-[11px] font-mono bg-black/20 border border-white/5 rounded px-2 py-0.5 text-zinc-400">
                                                {k}
                                            </span>
                                        ))}
                                        {envKeys.length > 20 && (
                                            <span className="text-[11px] text-zinc-600">+{envKeys.length - 20} more</span>
                                        )}
                                    </div>
                                ) : configFiles.length === 0 ? (
                                    <p className="text-xs text-zinc-600">No environment or config files detected.</p>
                                ) : null}
                            </div>
                        </div>

                        <CleanupSection
                            project={p}
                            archiveIntelligence={archiveIntelligence}
                            archiving={archiving}
                            deletingPaths={deletingPaths}
                            onPreviewCleanup={handleOpenCleanupPreview}
                            onDeleteFolder={handleDeleteFolder}
                            onArchive={() => handleArchive(p.path, p.name)}
                        />
                        <ProjectRunbook
                            runbook={runbook}
                            saving={savingNotes}
                            onChange={setRunbook}
                            onSave={handleSaveRunbook}
                        />
                    </div>
                )}

                {/* Activity Tab */}
                {detailTab === "activity" && (
                    <ActivityTab
                        project={p}
                        commits={projectCommits}
                        loadingCommits={loadingCommits}
                        commitTimeline={commitTimeline}
                        loadingTimeline={loadingTimeline}
                        branches={gitBranches}
                        loadingBranches={loadingGitBranches}
                        gitAction={gitAction}
                        linkedContainers={linkedContainers}
                        loadingLinkedContainers={loadingLinkedContainers}
                        projectDockerAction={projectDockerAction}
                        projectLogsContainer={projectLogsContainer}
                        projectLogsContent={projectLogsContent}
                        projectLogsLoading={projectLogsLoading}
                        runningScripts={runningScripts}
                        scriptConsole={scriptConsole}
                        activeConsoleKey={activeConsoleKey}
                        hasDockerStack={p.has_docker_compose || p.has_dockerfile || p.stack.includes("Docker") || linkedContainers.length > 0}
                        onFetch={() => runGitAction("fetch", "git_fetch", p.path)}
                        onPull={() => runGitAction("pull", "git_pull", p.path)}
                        onPush={() => runGitAction("push", "git_push", p.path)}
                        onStash={() => runGitAction("stash", "git_stash_changes", p.path)}
                        onCreateBranch={(name) => runGitAction("create-branch", "git_create_branch", p.path, { branchName: name })}
                        onSwitchBranch={(name) => runGitAction("switch-branch", "git_switch_branch", p.path, { branchName: name })}
                        onStartDockerStack={() => runProjectDockerAction(p, "start")}
                        onStopDockerStack={() => runProjectDockerAction(p, "stop")}
                        onViewContainerLogs={openProjectContainerLogs}
                        onCloseContainerLogs={() => setProjectLogsContainer(null)}
                        onSetActiveConsole={setActiveConsoleKey}
                        onRunScript={handleRunScript}
                    />
                )}

                {/* Modals */}
                <DeleteConfirmModal
                    project={p}
                    deleteConfirmText={deleteConfirmText}
                    deletingProject={deletingProject}
                    onConfirmTextChange={setDeleteConfirmText}
                    onDelete={() => handleDeleteProject(p)}
                    onCancel={() => { setShowDeleteConfirm(false); setDeleteConfirmText(""); }}
                    isOpen={showDeleteConfirm}
                />
                <CleanupPreviewModal
                    isOpen={cleanupPreviewOpen}
                    title={cleanupPreviewTitle}
                    items={cleanupPreviewItems}
                    cleaning={cleaningAll}
                    onClose={() => setCleanupPreviewOpen(false)}
                    onConfirm={handleConfirmCleanup}
                />
                {showEnvManager === p.path && (
                    <EnvManagerModal
                        projectPath={p.path}
                        onClose={() => setShowEnvManager(null)}
                    />
                )}
            </div>
        );
    }

    // ===== LIST VIEW =====
    return (
        <div className="flex flex-col h-full bg-background relative">
            <div className="flex-1 overflow-y-auto relative">

                {/* ── Scrollable header: title + stats ─────────────────── */}
                <div className="px-5 pt-5 pb-4">
                    <div className="flex items-start justify-between gap-4 mb-1">
                        <div>
                            <div className="flex items-center gap-3">
                                <h2 className="text-xl font-bold tracking-tight text-white">Projects</h2>
                                <button
                                    onClick={() => setShowScanInfo(!showScanInfo)}
                                    className="text-muted-foreground hover:text-primary transition-colors focus:outline-hidden"
                                >
                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                                </button>
                                <span className="text-xs font-semibold bg-primary/10 text-primary border border-primary/20 rounded-full px-2 py-0.5">
                                    {filteredProjects.length}
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                All your local repositories, sorted by cleanup potential.
                            </p>
                        </div>
                        <button
                            onClick={scanProjects}
                            disabled={isScanning}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50 shrink-0"
                        >
                            <svg className={`h-3.5 w-3.5 ${isScanning ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                            {isScanning ? "Scanning..." : "Rescan"}
                        </button>
                    </div>

                    {showScanInfo && (
                        <div className="mt-3 bg-primary/5 border border-primary/20 rounded-xl p-4 text-sm text-muted-foreground animate-in slide-in-from-top-2 fade-in relative">
                            <button onClick={() => setShowScanInfo(false)} className="absolute top-3 right-3 text-muted-foreground hover:text-white">
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                            </button>
                            <p className="font-medium text-white mb-1">How scanning works</p>
                            <p className="leading-relaxed text-xs">
                                Devian uses <strong>Full Disk Access</strong> to scan your home directory up to <strong>10 levels deep</strong> for <code>.git</code> repositories. Dependency folders (node_modules, target, .venv) are skipped for speed.
                            </p>
                        </div>
                    )}

                    {hasScanned && projects.length > 0 && (
                        <div className="mt-4">
                            <StatsBar
                                totalProjectSize={stats.totalProjectSize}
                                totalRecoverableBytes={stats.totalRecoverableBytes}
                                staleCount={stats.staleCount}
                                inactiveCount={stats.inactiveCount}
                                cleaningAll={cleaningAll}
                                hasScanned={hasScanned}
                                projectCount={projects.length}
                                onPreviewCleanup={handleCleanAll}
                            />
                        </div>
                    )}
                </div>

                {/* ── Sticky: chips + search pins here once title scrolls off ── */}
                <div className="sticky top-0 z-10 bg-background border-b border-white/5">
                    <ProjectsListHeader
                        searchQuery={searchQuery}
                        techFilter={techFilter}
                        tagFilter={tagFilter}
                        sortBy={sortBy}
                        activityFilter={activityFilter}
                        allTechs={stats.allTechs}
                        availableTags={AVAILABLE_TAGS}
                        onSearchChange={setSearchQuery}
                        onTechFilterChange={setTechFilter}
                        onTagFilterChange={setTagFilter}
                        onSortChange={(v) => setSortBy(v as SortOption)}
                        onActivityFilterChange={setActivityFilter}
                    />
                </div>

                {/* ── Project list ──────────────────────────────────────── */}
                <div className="p-5 pt-4 relative">
                {isScanning && hasScanned && (
                    <div className="mb-4 animate-in fade-in duration-200 flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        Scanning for repositories...
                    </div>
                )}

                {/* Pinned/Recent projects */}
                {!isScanning && hasScanned && !isFiltering && (() => {
                    const pinnedProjects = [...projects].filter(p => p.is_favorite).slice(0, 4);
                    const recentActive = [...projects]
                        .filter(p => !p.is_favorite && p.last_commit_timestamp > 0 && p.activity_status === "active")
                        .sort((a, b) => b.last_commit_timestamp - a.last_commit_timestamp)
                        .slice(0, 4);

                    if (pinnedProjects.length === 0 && recentActive.length === 0) return null;

                    return (
                        <div className="mb-6 space-y-5">
                            {pinnedProjects.length > 0 && (
                                <PinnedProjects
                                    projects={pinnedProjects}
                                    onSelectProject={openProjectDetail}
                                    onOpenTerminal={() => { }}
                                    onOpenEditor={() => { }}
                                    onOpenFinder={() => { }}
                                />
                            )}
                            {recentActive.length > 0 && (
                                <RecentlyActiveProjects
                                    projects={recentActive}
                                    onSelectProject={openProjectDetail}
                                    onOpenTerminal={() => { }}
                                    onOpenEditor={() => { }}
                                    onOpenFinder={() => { }}
                                />
                            )}
                        </div>
                    );
                })()}

                {/* Projects list */}
                {isScanning && !hasScanned ? (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm">Scanning for repositories...</p>
                    </div>
                ) : filteredProjects.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                        <p>No projects match your search.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                        {filteredProjects.map((project, idx) => (
                            <ProjectCard
                                key={idx}
                                project={project}
                                homeDir={homeDir}
                                deletingPaths={deletingPaths}
                                onSelectProject={openProjectDetail}
                                onOpenFinder={projectActions.handleOpenFinder}
                                onOpenTerminal={(p) => projectActions.handleOpenTerminal(p, terminal)}
                                onOpenEditor={(p) => projectActions.handleOpenEditor(p, editor)}
                                onToggleFavorite={toggleFavorite}
                                onToggleTag={toggleTag}
                                onDeleteFolder={handleDeleteFolder}
                                onArchive={handleArchive}
                            />
                        ))}
                    </div>
                )}
                </div>{/* end p-5 projects div */}
            </div>{/* end overflow-y-auto */}
            <CleanupPreviewModal
                isOpen={cleanupPreviewOpen}
                title={cleanupPreviewTitle}
                items={cleanupPreviewItems}
                cleaning={cleaningAll}
                onClose={() => setCleanupPreviewOpen(false)}
                onConfirm={handleConfirmCleanup}
            />
        </div>
    );
}

import { Loader2, Play, Square, ScrollText, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    LocalProject, Commit, CommitTimelinePoint, GitBranchInfo,
} from "../types";
import { CommitsSection } from "./CommitsSection";
import { RepoActivityTimeline } from "./RepoActivityTimeline";
import { RepositoryControls } from "./RepositoryControls";
import { UsageTimeline } from "./UsageTimeline";
import { ScriptsConsole } from "./ScriptsConsole";

interface LinkedContainer {
    ID: string;
    Names: string;
    State: string;
    Status: string;
    Image: string;
    ComposeWorkingDir: string;
    ComposeConfigFiles: string;
    ProjectPath: string;
    ProjectName: string;
}

interface ActivityTabProps {
    project: LocalProject;
    commits: Commit[];
    loadingCommits: boolean;
    commitTimeline: CommitTimelinePoint[];
    loadingTimeline: boolean;
    branches: GitBranchInfo[];
    loadingBranches: boolean;
    gitAction: string | null;
    linkedContainers: LinkedContainer[];
    loadingLinkedContainers: boolean;
    projectDockerAction: "start" | "stop" | null;
    projectLogsContainer: LinkedContainer | null;
    projectLogsContent: string;
    projectLogsLoading: boolean;
    runningScripts: Map<string, { key: string; script: string; pid: number; port: number | null; project_path: string }>;
    scriptConsole: Map<string, string[]>;
    activeConsoleKey: string | null;
    hasDockerStack: boolean;
    onFetch: () => void;
    onPull: () => void;
    onPush: () => void;
    onStash: () => void;
    onCreateBranch: (name: string) => void;
    onSwitchBranch: (name: string) => void;
    onStartDockerStack: () => void;
    onStopDockerStack: () => void;
    onViewContainerLogs: (container: LinkedContainer) => void;
    onCloseContainerLogs: () => void;
    onSetActiveConsole: (key: string | null) => void;
    onRunScript: (path: string, script: string) => void;
}

export function ActivityTab({
    project,
    commits, loadingCommits,
    commitTimeline, loadingTimeline,
    branches, loadingBranches,
    gitAction,
    linkedContainers, loadingLinkedContainers,
    projectDockerAction,
    projectLogsContainer, projectLogsContent, projectLogsLoading,
    runningScripts, scriptConsole, activeConsoleKey,
    hasDockerStack,
    onFetch, onPull, onPush, onStash, onCreateBranch, onSwitchBranch,
    onStartDockerStack, onStopDockerStack,
    onViewContainerLogs, onCloseContainerLogs,
    onSetActiveConsole, onRunScript,
}: ActivityTabProps) {
    return (
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Usage Timeline */}
            <UsageTimeline project={project} />

            {/* Scripts Console */}
            <ScriptsConsole
                project={project}
                runningScripts={runningScripts}
                scriptConsole={scriptConsole}
                activeConsoleKey={activeConsoleKey}
                onSetActiveConsole={onSetActiveConsole}
                onRunScript={onRunScript}
            />

            {/* Repository Controls (git) */}
            <RepositoryControls
                project={project}
                branches={branches}
                loadingBranches={loadingBranches}
                activeAction={gitAction}
                onFetch={onFetch}
                onPull={onPull}
                onPush={onPush}
                onStash={onStash}
                onCreateBranch={onCreateBranch}
                onSwitchBranch={onSwitchBranch}
            />

            {/* Commit History */}
            <CommitsSection commits={commits} loading={loadingCommits} />

            {/* Activity Graph */}
            <RepoActivityTimeline timeline={commitTimeline} loading={loadingTimeline} />

            {/* Docker Stack */}
            {hasDockerStack && (
                <div className="bg-zinc-900 border border-white/5 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                            <Boxes className="h-4 w-4 text-primary" />
                            Project Containers
                        </h3>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" className="border-white/10 text-white hover:bg-white/10 h-7"
                                disabled={projectDockerAction !== null} onClick={onStartDockerStack}>
                                {projectDockerAction === "start" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                                Start
                            </Button>
                            <Button variant="outline" size="sm" className="border-white/10 text-white hover:bg-white/10 h-7"
                                disabled={projectDockerAction !== null} onClick={onStopDockerStack}>
                                {projectDockerAction === "stop" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Square className="h-3 w-3 mr-1" />}
                                Stop
                            </Button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        {loadingLinkedContainers ? (
                            <div className="flex items-center gap-2 text-xs text-zinc-500">
                                <Loader2 className="h-3 w-3 animate-spin" /> Loading containers...
                            </div>
                        ) : linkedContainers.length > 0 ? (
                            linkedContainers.map(c => (
                                <div key={c.ID} className="flex items-center justify-between gap-3 bg-black/20 border border-white/5 rounded-lg px-3 py-2.5">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-white truncate">{c.Names}</p>
                                        <p className="text-xs text-zinc-500 truncate">{c.Image} · {c.Status}</p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${c.State === "running" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-zinc-700 bg-zinc-800 text-zinc-500"}`}>
                                            {c.State}
                                        </span>
                                        <Button variant="ghost" size="sm" className="h-6 text-xs text-zinc-500 hover:text-white hover:bg-white/5"
                                            onClick={() => onViewContainerLogs(c)}>
                                            <ScrollText className="h-3 w-3 mr-1" /> Logs
                                        </Button>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <p className="text-xs text-zinc-600 py-2">No linked containers found. Try starting the stack.</p>
                        )}
                    </div>
                </div>
            )}

            {/* Logs modal */}
            {projectLogsContainer && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onCloseContainerLogs}>
                    <div className="bg-[#1a1a1e] border border-white/10 rounded-xl max-w-4xl w-full max-h-[80vh] shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b border-white/10 flex items-center justify-between">
                            <div>
                                <h3 className="text-base font-semibold text-white">Container Logs</h3>
                                <p className="text-xs text-zinc-500">{projectLogsContainer.Names}</p>
                            </div>
                            <Button variant="ghost" size="sm" className="text-zinc-500 hover:text-white" onClick={onCloseContainerLogs}>
                                Close
                            </Button>
                        </div>
                        <div className="flex-1 overflow-y-auto bg-black/30 p-4 font-mono text-xs text-zinc-300 whitespace-pre-wrap">
                            {projectLogsLoading ? "Loading logs..." : projectLogsContent || "No logs."}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

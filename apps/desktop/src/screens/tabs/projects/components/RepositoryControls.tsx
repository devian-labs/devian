import { useState } from "react";
import { ArrowDownToLine, ArrowRightLeft, ArrowUpToLine, GitBranch, GitFork, Loader2, PackageOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { GitBranchInfo, LocalProject } from "../types";

interface RepositoryControlsProps {
    project: LocalProject;
    branches: GitBranchInfo[];
    loadingBranches: boolean;
    activeAction: string | null;
    onFetch: () => void;
    onPull: () => void;
    onPush: () => void;
    onStash: () => void;
    onCreateBranch: (name: string) => void;
    onSwitchBranch: (name: string) => void;
}

export function RepositoryControls({
    project,
    branches,
    loadingBranches,
    activeAction,
    onFetch,
    onPull,
    onPush,
    onStash,
    onCreateBranch,
    onSwitchBranch,
}: RepositoryControlsProps) {
    const [newBranchName, setNewBranchName] = useState("");
    const [selectedBranch, setSelectedBranch] = useState(project.current_branch !== "unknown" ? project.current_branch : "");

    const branchOptions = branches.length > 0 ? branches : (
        project.current_branch && project.current_branch !== "unknown"
            ? [{ name: project.current_branch, is_current: true }]
            : []
    );

    return (
        <div className="bg-surface-a10 border border-white/5 rounded-lg p-4 space-y-4 shadow-xs">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        <GitFork className="h-4 w-4 text-primary" /> Repository Controls
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                        Quick Git actions for this repository without leaving Devian.
                    </p>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-muted-foreground hover:text-white"
                    onClick={onFetch}
                    disabled={activeAction !== null}
                >
                    {activeAction === "fetch" || loadingBranches ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                    )}
                </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    className="border-white/10 text-white hover:bg-white/10"
                    onClick={onFetch}
                    disabled={activeAction !== null}
                >
                    {activeAction === "fetch" ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-2" />}
                    Fetch
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    className="border-white/10 text-white hover:bg-white/10"
                    onClick={onPull}
                    disabled={activeAction !== null}
                >
                    {activeAction === "pull" ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <ArrowDownToLine className="h-3.5 w-3.5 mr-2" />}
                    Pull
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    className="border-white/10 text-white hover:bg-white/10"
                    onClick={onPush}
                    disabled={activeAction !== null}
                >
                    {activeAction === "push" ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <ArrowUpToLine className="h-3.5 w-3.5 mr-2" />}
                    Push
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    className="border-white/10 text-white hover:bg-white/10"
                    onClick={onStash}
                    disabled={activeAction !== null}
                >
                    {activeAction === "stash" ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <PackageOpen className="h-3.5 w-3.5 mr-2" />}
                    Stash Changes
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/5 bg-black/10 p-3 space-y-3">
                    <div>
                        <p className="text-xs font-semibold text-white flex items-center gap-1.5">
                            <GitBranch className="h-3.5 w-3.5 text-blue-300" />
                            Create Branch
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                            Create and check out a new branch from <span className="text-white">{project.current_branch}</span>.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Input
                            value={newBranchName}
                            onChange={(e) => setNewBranchName(e.target.value)}
                            placeholder="feature/new-work"
                            className="bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/50"
                            disabled={activeAction !== null}
                        />
                        <Button
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                            disabled={activeAction !== null || newBranchName.trim() === ""}
                            onClick={() => {
                                const value = newBranchName.trim();
                                onCreateBranch(value);
                                setNewBranchName("");
                                setSelectedBranch(value);
                            }}
                        >
                            {activeAction === "create-branch" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}
                        </Button>
                    </div>
                </div>

                <div className="rounded-lg border border-white/5 bg-black/10 p-3 space-y-3">
                    <div>
                        <p className="text-xs font-semibold text-white flex items-center gap-1.5">
                            <ArrowRightLeft className="h-3.5 w-3.5 text-emerald-300" />
                            Switch Branch
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                            Jump between local branches without opening the terminal.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={activeAction !== null || branchOptions.length === 0}>
                            <SelectTrigger className="bg-white/5 border-white/10 text-white">
                                <SelectValue placeholder={loadingBranches ? "Loading branches..." : "Select branch"} />
                            </SelectTrigger>
                            <SelectContent className="bg-[#1a1a1e] border-white/10 text-white">
                                {branchOptions.map((branch) => (
                                    <SelectItem key={branch.name} value={branch.name}>
                                        {branch.name}{branch.is_current ? " (current)" : ""}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            disabled={activeAction !== null || selectedBranch === "" || selectedBranch === project.current_branch}
                            onClick={() => onSwitchBranch(selectedBranch)}
                        >
                            {activeAction === "switch-branch" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Switch"}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

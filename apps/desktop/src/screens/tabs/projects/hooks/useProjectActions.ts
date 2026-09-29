import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "@/hooks/use-toast";
import { LocalProject } from "../types";
import { formatBytes } from "../utils";
import { track } from "@/lib/telemetry";

export function useProjectActions() {
    const { toast } = useToast();

    const handleOpenFinder = useCallback(async (path: string) => {
        try {
            await invoke("open_in_finder", { path });
            track("project_opened", { method: 'finder' });
        } catch (e) {
            toast({ variant: "destructive", title: "Failed", description: String(e) });
        }
    }, [toast]);

    const handleOpenTerminal = useCallback(async (path: string, terminal: string) => {
        try {
            await invoke("open_in_terminal", { path, terminal });
            track("project_opened", { method: 'terminal' });
        } catch (e) {
            toast({ variant: "destructive", title: "Failed", description: String(e) });
        }
    }, [toast]);

    const handleOpenEditor = useCallback(async (path: string, editor: string) => {
        try {
            await invoke("open_in_editor", { path, editor });
            track("project_opened", { method: 'editor' });
        } catch (e) {
            toast({ variant: "destructive", title: "Failed", description: String(e) });
        }
    }, [toast]);

    const handleDeleteFolder = useCallback(async (basePath: string, folderName: string) => {
        try {
            await invoke("delete_dependency_folder", { basePath, folderName });
            toast({ title: "Cleaned", description: `Deleted ${folderName} from ${basePath.split("/").pop()}` });

            const folderSize = 0; // This will be calculated context
            if (folderSize > 0) {
                await invoke("add_cleanup_entry", { resource: `Project Dep Cache: ${folderName}`, sizeBytes: folderSize }).catch(() => { });
            }

            track("dependency_folder_deleted", { size_bytes: folderSize });
        } catch (e) {
            toast({ variant: "destructive", title: "Failed", description: String(e) });
        }
    }, [toast]);

    const handleArchive = useCallback(async (path: string, name: string) => {
        if (!confirm(`Archive "${name}"? This will create a .tar.gz and DELETE the original folder.`)) return;
        
        try {
            await invoke("archive_project", { path });
            track("project_archived");
            toast({ title: "Archived", description: `${name} has been archived.` });
            return true;
        } catch (e) {
            toast({ variant: "destructive", title: "Archive Failed", description: String(e) });
            return false;
        }
    }, [toast]);

    const handleDeleteProject = useCallback(async (project: LocalProject) => {
        try {
            const bytesDeleted = await invoke<number>("delete_project", { path: project.path });
            await invoke("add_cleanup_entry", {
                resource: `Deleted Project: ${project.name}`,
                sizeBytes: bytesDeleted
            }).catch(() => { });
            track("project_deleted", { bytes: bytesDeleted });
            toast({ title: "Project Deleted", description: `${project.name} removed (${formatBytes(bytesDeleted)} reclaimed)` });
            return true;
        } catch (e) {
            toast({ variant: "destructive", title: "Delete Failed", description: String(e) });
            return false;
        }
    }, [toast]);

    const handleAiSummary = useCallback(async (project: LocalProject, formatBytesHelper: typeof formatBytes) => {
        try {
            const context = await invoke<string>("get_project_context", { path: project.path });
            const prompt = `You are an expert software architect. Analyze this project and provide a professional, beautifully formatted markdown overview. 

Use the following strict structural constraints:
1. Use ## for main section headers (Overview, Tech Stack, Key Highlights).
2. Use ### for sub-headers if needed.
3. Use **Key:** Value format for specific details.
4. Ensure double newlines between every section and every header.
5. Do NOT include any introduction or ending text.

Sections to include:
## Project Overview
A 2-3 sentence professional summary of the project's purpose.

## Logic & Architecture
Categorize the stack (Frontend, Backend, Database, Utilities). Highlight specific impressive libraries.

## Vital Signs & State
Structural features, current maintenance activity, and notable file patterns.

Project: ${project.name}
Branch: ${project.current_branch}
Stack: ${project.stack.join(", ")}
Size: ${formatBytesHelper(project.project_size_bytes)}
Last Commit: ${project.last_commit}

${context}`;
            const result = await invoke<string>("ai_generate_summary", { prompt });
            return result;
        } catch (e) {
            return `⚠️ ${String(e)}`;
        }
    }, []);

    return {
        handleOpenFinder,
        handleOpenTerminal,
        handleOpenEditor,
        handleDeleteFolder,
        handleArchive,
        handleDeleteProject,
        handleAiSummary,
    };
}

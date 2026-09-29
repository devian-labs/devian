import { Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LocalProject } from "../types";
import { formatBytes } from "../utils";

interface DeleteConfirmModalProps {
    project: LocalProject;
    deleteConfirmText: string;
    deletingProject: boolean;
    onConfirmTextChange: (text: string) => void;
    onDelete: () => void;
    onCancel: () => void;
    isOpen: boolean;
}

export function DeleteConfirmModal({
    project,
    deleteConfirmText,
    deletingProject,
    onConfirmTextChange,
    onDelete,
    onCancel,
    isOpen,
}: DeleteConfirmModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onCancel}>
            <div className="bg-[#1a1a1e] border border-white/10 rounded-xl p-6 max-w-md w-full space-y-4 shadow-2xl animate-in zoom-in-[0.98] duration-150" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                        <Trash2 className="h-5 w-5 text-red-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-white">Delete Project</h3>
                        <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
                    </div>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 space-y-1">
                    <p className="text-sm text-red-300">
                        This will permanently delete <strong>{project.name}</strong> ({formatBytes(project.project_size_bytes)}) from disk.
                    </p>
                    <p className="text-xs text-red-300/60 font-mono">{project.path}</p>
                </div>
                <div>
                    <label className="text-xs text-muted-foreground">Type <strong className="text-white">{project.name}</strong> to confirm:</label>
                    <Input
                        value={deleteConfirmText}
                        onChange={(e) => onConfirmTextChange(e.target.value)}
                        placeholder={project.name}
                        className="mt-1.5 bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/40"
                        autoFocus
                    />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                    <Button
                        variant="ghost" size="sm"
                        className="text-muted-foreground hover:text-white"
                        onClick={onCancel}
                        disabled={deletingProject}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="destructive" size="sm"
                        className="bg-red-600 hover:bg-red-700"
                        disabled={deleteConfirmText !== project.name || deletingProject}
                        onClick={onDelete}
                    >
                        {deletingProject ? (
                            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Deleting...</>
                        ) : (
                            <><Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete Forever</>
                        )}
                    </Button>
                </div>
            </div>
        </div>
    );
}

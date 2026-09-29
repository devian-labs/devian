import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { CleanupPreviewItem } from "../types";
import { formatBytes } from "../utils";

interface CleanupPreviewModalProps {
    isOpen: boolean;
    title: string;
    items: CleanupPreviewItem[];
    cleaning: boolean;
    onClose: () => void;
    onConfirm: (items: CleanupPreviewItem[]) => void;
}

export function CleanupPreviewModal({
    isOpen,
    title,
    items,
    cleaning,
    
    onClose,
    onConfirm,
}: CleanupPreviewModalProps) {
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!isOpen) return;
        setSelectedKeys(new Set(items.map((item) => item.key)));
    }, [isOpen, items]);

    const selectedItems = useMemo(
        () => items.filter((item) => selectedKeys.has(item.key)),
        [items, selectedKeys]
    );

    const groupedByFolder = useMemo(() => {
        const folderMap = new Map<string, number>();
        for (const item of selectedItems) {
            folderMap.set(item.folder_name, (folderMap.get(item.folder_name) || 0) + item.size_bytes);
        }
        return [...folderMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([folder, size]) => ({ folder, size }));
    }, [selectedItems]);

    const totalSelectedBytes = selectedItems.reduce((sum, item) => sum + item.size_bytes, 0);
    const allSelected = items.length > 0 && selectedItems.length === items.length;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-[#1a1a1e] border border-white/10 rounded-xl max-w-3xl w-full shadow-2xl animate-in zoom-in-[0.98] duration-150 overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-white/10 bg-white/2">
                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center">
                                    <Sparkles className="h-5 w-5 text-amber-300" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-white">Cleanup Preview</h3>
                                    <p className="text-sm text-muted-foreground">{title}</p>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground pl-[52px]">
                                Review the exact folders before cleaning so nothing gets removed by surprise.
                            </p>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-white"
                            onClick={onClose}
                            disabled={cleaning}
                        >
                            Cancel
                        </Button>
                    </div>
                </div>

                <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
                        <div className="flex items-center justify-between gap-3 mb-4">
                            <div>
                                <p className="text-sm font-medium text-amber-200">Total reclaimable</p>
                                <p className="text-2xl font-bold text-white">{formatBytes(totalSelectedBytes)}</p>
                            </div>
                            <Badge variant="secondary" className="bg-amber-500/10 text-amber-300 border-amber-500/20">
                                {selectedItems.length} of {items.length} selected
                            </Badge>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                            {groupedByFolder.map((group) => (
                                <div
                                    key={group.folder}
                                    className="rounded-md border border-amber-500/10 bg-black/10 px-3 py-2 flex items-center justify-between gap-3 text-sm"
                                >
                                    <span className="font-mono text-white truncate">{group.folder}</span>
                                    <span className="text-amber-200 shrink-0">{formatBytes(group.size)}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <label className="flex items-center gap-3 text-sm text-white">
                                <Checkbox
                                    checked={allSelected}
                                    onCheckedChange={(checked) => {
                                        setSelectedKeys(checked ? new Set(items.map((item) => item.key)) : new Set());
                                    }}
                                />
                                Select all cleanup targets
                            </label>
                            <p className="text-xs text-muted-foreground">
                                Per-folder breakdown across your selected repositories
                            </p>
                        </div>

                        <div className="space-y-2">
                            {items.map((item) => (
                                <label
                                    key={item.key}
                                    className="flex items-start justify-between gap-3 rounded-lg border border-white/5 bg-white/2 px-4 py-3 hover:bg-white/4 transition-colors"
                                >
                                    <div className="flex items-start gap-3 min-w-0">
                                        <Checkbox
                                            checked={selectedKeys.has(item.key)}
                                            onCheckedChange={(checked) => {
                                                setSelectedKeys((prev) => {
                                                    const next = new Set(prev);
                                                    if (checked) next.add(item.key);
                                                    else next.delete(item.key);
                                                    return next;
                                                });
                                            }}
                                        />
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-sm font-medium text-white font-mono">{item.folder_name}</p>
                                                <Badge variant="secondary" className="bg-white/5 text-zinc-300 border-white/10">
                                                    {item.project_name}
                                                </Badge>
                                            </div>
                                            <p className="text-xs text-muted-foreground truncate mt-1">
                                                {item.project_path} · {item.folder_path}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="shrink-0 text-right">
                                        <p className="text-sm font-semibold text-white">{formatBytes(item.size_bytes)}</p>
                                        <p className="text-[11px] text-muted-foreground">reclaimable</p>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-white/10 bg-black/20 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                        Only selected folders will be deleted.
                    </p>
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-white"
                            onClick={onClose}
                            disabled={cleaning}
                        >
                            Back
                        </Button>
                        <Button
                            size="sm"
                            className="bg-amber-600 hover:bg-amber-700 text-white"
                            disabled={selectedItems.length === 0 || cleaning}
                            onClick={() => onConfirm(selectedItems)}
                        >
                            {cleaning ? (
                                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Cleaning...</>
                            ) : (
                                <><Trash2 className="h-3.5 w-3.5 mr-1.5" /> Clean Selected</>
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
